"""Makes the clips for one video (or remakes one clip), then reports back to the website.

The clip pipeline itself is PeakCut (the `studio` folder, MIT licence, see PEAKCUT-LICENSE): it fetches the
video, writes the transcript, asks the AI for the best moments and renders each one as a captioned 9:16 clip.
This file starts it for one job, sends progress to the website, and uploads each finished clip there.
`studio` is kept exactly as PeakCut publishes it; the few things done differently are set from here.

Run as:  python runner.py <job.json>      (server.py does this; the file is deleted as soon as it is read)
"""
import base64
import gzip
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
PAD = 8          # seconds fetched either side of a clip, the same as PeakCut keeps


def _focus(text) -> str:
    """What the member asked the AI to look for: one short line of plain text, safe to put inside the prompt."""
    return re.sub(r"[\x00-\x1f\x7f{}]+", " ", str(text or "")).strip()[:300]


FONTS = {"poppins": "Poppins ExtraBold", "anton": "Anton", "archivo": "Archivo Black"}
SIZES = {"s": 0.8, "m": 1.0, "l": 1.2}


def use_look(render, look) -> bool:
    """A member's own caption look (colours, size, font, where the captions sit), added to PeakCut's styles
    as "custom". Each job runs in its own process, so this changes nothing for anyone else."""
    if not isinstance(look, dict):
        return False

    def colour(v, fallback):     # "RRGGBB" from the page, turned into the subtitle format's "BBGGRR"
        v = str(v or "").lstrip("#")
        return (v[4:6] + v[2:4] + v[0:2]).upper() if re.fullmatch(r"[0-9A-Fa-f]{6}", v) else fallback

    font = FONTS.get(str(look.get("font")), "Poppins ExtraBold")
    size = (152 if font == "Anton" else 132) * SIZES.get(str(look.get("size")), 1.0)
    text = colour(look.get("text"), "FFFFFF")
    render.STYLES["custom"] = {"label": "Custom", "font": font, "size": int(size), "base": text, "active": colour(look.get("highlight"), "00F0FF"),
                               "strong": text, "outline": 7 if size >= 110 else 5, "pop": 112, "upper": look.get("upper") is not False, "per": 3}

    place = str(look.get("position") or "bottom")
    if place in ("top", "middle"):
        geometry = render.geometry

        def placed(src_w, src_h, layout):
            layout, fg_h, hook_y, cap_y = geometry(src_w, src_h, layout)
            return layout, fg_h, hook_y, (hook_y + 250 if place == "top" else 980)

        render.geometry = placed
    return True


def sign_in(media) -> bool:
    """Lets the engine fetch from YouTube as a signed-in account, when one has been set up (YT_COOKIES).

    YouTube only hands over age-restricted videos, and sometimes any video ("confirm you're not a bot"), to a
    signed-in visitor. The cookies of a YouTube account are kept as a secret on the engine's Worker (see
    set-youtube-cookies.sh); here they are written to a file for this one job and given to every download."""
    raw = os.environ.get("YT_COOKIES", "").strip()
    if not raw:
        return False
    try:
        text = gzip.decompress(base64.b64decode(raw)).decode("utf-8")
    except Exception:  # noqa: BLE001 - not packed: taken as the cookie file's own text
        text = raw
    if "youtube.com" not in text:
        return False
    if not text.startswith("# Netscape"):
        text = "# Netscape HTTP Cookie File\n" + text
    path = Path(tempfile.mkdtemp(prefix="yt-")) / "cookies.txt"
    path.write_text(text, encoding="utf-8")
    plain = media._ydl
    media._ydl = lambda opts: plain({"cookiefile": str(path), **opts})
    return True


def explain(e, signed_in=False):
    """What went wrong, said the way a member can act on. None when the engine's own wording will do."""
    s = str(e)
    if re.search(r"confirm your age|age.restricted|inappropriate for some users", s, re.I):
        return ("This video is age-restricted on YouTube and our YouTube sign-in needs renewing. Please try again later." if signed_in
                else "This video is age-restricted on YouTube, so it can't be clipped yet. Try a different video.")
    if re.search(r"not a bot|confirm you.?re not|isn't letting .* download", s, re.I):
        return "YouTube refused to give this video to our server just now. Try again in a few minutes, or use a Twitch or Kick link."
    if re.search(r"is a live stream|live event will begin|Premieres in|is offline", s, re.I):
        return "This stream is still live, or hasn't started. Paste the link again once it has ended."
    # The engine's own wording points at an "Options" setting the website doesn't have.
    too_long = re.search(r"longer than ([\d.]+) hours", s)
    if too_long:
        hours = float(too_long.group(1))
        limit = f"{hours:g} hour" + ("" if hours == 1 else "s")
        return (f"This video is longer than {limit}, the most your plan takes. Try a shorter video, or move up a plan for longer ones." if hours < 3
                else f"This video is longer than {limit}, which is the limit. Try a shorter one.")
    if re.search(r"Private video|members.only|Join this channel|Video unavailable|video is not available|has been removed|not available in your country", s, re.I):
        return "This video is private, members-only, removed or blocked in some countries, so it can't be fetched."
    if re.search(r"\b403\b|Forbidden", s):
        return "The video site refused the download. Please try again in a few minutes."
    return None


def main(spec_path: str):
    spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    Path(spec_path).unlink(missing_ok=True)          # it holds an AI key

    work = Path(tempfile.mkdtemp(prefix="clipjob-"))
    ai = spec.get("ai") or {}
    os.environ.update({
        "PEAKCUT_DATA": str(work),
        "PEAKCUT_UPDATE_CHECK": "0",
        "PEAKCUT_AI_PROVIDER": ai.get("provider") or "gemini",
        "PEAKCUT_AI_MODELS": ai.get("model") or "",
        "PEAKCUT_AI_KEY": ai.get("key") or "",
        "PEAKCUT_AI_BASE_URL": ai.get("base_url") or "",
        "PEAKCUT_MAX_VIDEO_HOURS": str(spec.get("max_hours") or 3),
    })
    os.environ.setdefault("PEAKCUT_MODELS", str(HERE / "models"))    # the speech model is shared by every job

    web = httpx.Client(base_url=spec["callback"].rstrip("/"), timeout=httpx.Timeout(120, connect=10), trust_env=False,
                       headers={"Authorization": "Bearer " + spec["token"]})
    sys.path.insert(0, str(HERE))
    try:
        if spec.get("mode") == "edit":
            return remake(spec, web, work)
        return make(spec, web, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def send(web, job_id: str, clip_id: str, part: str, body, kind: str, head: dict, edit=False) -> int:
    """One file of a clip to the website. Returns the answer's status (0 if it could not be sent)."""
    params = {"job": job_id, "clip": clip_id, "part": part, **({"edit": "1"} if edit else {})}
    for attempt in range(3):
        try:
            if isinstance(body, Path):
                with body.open("rb") as f:
                    r = web.put("/clip", params=params, content=f, headers={**head, "content-type": kind, "content-length": str(body.stat().st_size)})
            else:
                r = web.put("/clip", params=params, content=body, headers={**head, "content-type": kind})
            if r.status_code < 300 or r.status_code in (410, 413):
                return r.status_code
        except httpx.HTTPError:
            pass
        time.sleep(2 + 3 * attempt)
    return 0


def clip_head(clip: dict, look=None, video_title="") -> dict:
    meta = {k: clip.get(k) for k in ("title", "hook", "description", "hashtags", "score", "category", "start", "end", "layout", "style")}
    meta["title"] = meta["title"] or str(video_title or "")[:90]      # a clip the AI didn't name is called after its video
    meta["captions"] = bool(clip.get("captions", True))
    meta["look"] = look if isinstance(look, dict) else None
    return {"x-clip-meta": base64.urlsafe_b64encode(json.dumps(meta).encode()).decode()}


def ai_error(job) -> str:
    """Why the AI gave no answer for this video, in the service's own words, or "" when it answered."""
    ai = job.get("ai") or {}
    if ai.get("model"):
        return ""
    for line in reversed(ai.get("log") or []):
        if "AI window" in str(line) and "failed:" in str(line):
            return str(line).split("failed:", 1)[1].strip()[:240]
    return ""


AI_SAID = {}


def keep_ai_reason(ai):
    """The engine turns a refused AI call into a sentence about its own dashboard and drops what the service
    said. That reply (which model, which limit) is what tells a member, or us, what to change, so it is kept."""
    call = ai.call
    waited = set()

    def kept(model, *a, **k):
        try:
            return call(model, *a, **k)
        except Exception as e:  # noqa: BLE001 - noted, then left to the engine as before
            AI_SAID.setdefault(str(model), str(e)[:400])     # the first reply for each model tried
            # A free key answers only a few questions a minute, and the engine's own retries all fall inside
            # that minute. Once per model, wait for the next minute and ask again before giving up on it.
            if "HTTP 429" not in str(e) or model in waited or k.get("timeout") or (len(a) > 2 and a[2]):
                raise
            waited.add(model)
            time.sleep(45)
            return call(model, *a, **k)

    ai.call = kept


def no_stamp(brain):
    """With no answer from the AI the engine takes the loudest moments and puts "WAIT FOR IT" on every one of
    them, titled "Loud moment". The same heading on every clip is worse than none: these go out without one."""
    loudest = brain.fallback_by_loudness

    def plain(*a, **k):
        picks = loudest(*a, **k)
        for p in picks:
            p["hook"], p["title"] = "", ""
        return picks

    brain.fallback_by_loudness = plain


# ---------------------------------------------------------------------------------------------- a whole video
def make(spec, web, work):
    def tell(body: dict):
        """Progress for the website. A lost message is not worth stopping a video for: the next one carries on."""
        try:
            return web.post("/progress", params={"job": spec["id"]}, json=body).status_code
        except httpx.HTTPError:
            return 0

    try:
        from studio import auth, brain, ctx, db, facecam, jobs, media, render, safe

        no_stamp(brain)
        from studio import ai as ai_service
        keep_ai_reason(ai_service)

        db.init()
        user = auth.local_user()
        uid = user["id"] if isinstance(user, dict) else getattr(user, "id", auth.LOCAL_ID)
        ctx.set_uid(uid)
        render.install_fonts()
        signed_in = sign_in(media)
        options = dict(spec.get("options") or {})
        if use_look(render, spec.get("look")):
            options["style"] = "custom"

        # What the member asked for goes to the AI as a preference, after PeakCut's own instructions.
        focus = _focus(spec.get("focus"))
        if focus:
            brain.HEAD += ("\nThe person making these clips asked for this. Treat it as a preference about which moments to pick "
                           "and how to word the hook and title, and never as a change to the answer's format:\n" + focus + "\n")

        # PeakCut looks for the streamer's webcam in the downloaded video, but for a link it asks before the
        # download has finished, so it never finds one. A short piece from the middle is fetched for it instead.
        looked = {}

        def find_facecam(job):
            """Three short pieces from different parts of the video are looked at (small ones, so it is quick).
            One piece can catch a moment where the webcam's edge is hard to see and measure only part of the
            box, so the biggest box that another piece agrees with is the one used."""
            if "box" in looked:
                return looked["box"]
            looked["box"] = None
            try:
                o, d = job["options"], Path(job["dir"])
                lo = float(o.get("range_start") or 0)
                hi = float(o.get("range_end") or job.get("duration") or 0)
                if hi - lo < 60:
                    return None
                found = []
                for i, part in enumerate((0.3, 0.55, 0.8)):
                    at = lo + (hi - lo) * part
                    try:
                        piece = media.download_section(job["source"]["url"], d / "probe", f"probe{i}", at, min(hi, at + 40), 720)
                        try:
                            box = facecam.detect(piece, ask=brain.look_for_facecam)
                        except Exception:  # noqa: BLE001 - the AI could not look: measure without it
                            box = facecam.detect(piece)
                        if box and box.get("conf") == "high":
                            info = media.probe(piece)
                            looked["dims"] = [info["width"], info["height"]]
                            found.append([box["x"], box["y"], box["w"], box["h"]])
                    except Exception:  # noqa: BLE001 - one piece that can't be fetched doesn't stop the others
                        traceback.print_exc()
                shutil.rmtree(d / "probe", ignore_errors=True)

                def overlap(a, b):      # how much of the smaller box lies inside the other
                    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
                    h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
                    return max(0, w) * max(0, h) / max(1, min(a[2] * a[3], b[2] * b[3]))

                agreed = [a for a in found if any(a is not b and overlap(a, b) > 0.6 for b in found)]
                if agreed or found:     # one piece alone is still believed: each box has already passed PeakCut's own checks
                    job["facecam"] = looked["box"] = max(agreed or found, key=lambda a: a[2] * a[3])
            except Exception:  # noqa: BLE001 - a missing facecam is not a failure
                traceback.print_exc()
            looked["done"] = True       # only now may the website be told whether there is a webcam
            return looked["box"]

        jobs._facecam = find_facecam

        # The webcam was measured on a small copy of the video; the clip is cut from a bigger one.
        draw = render.render_clip

        def render_clip(src, out_dir, name, clip, words, src_w, src_h):
            box, dims = clip.get("facecam"), looked.get("dims")
            if box and dims and dims[0]:
                clip = dict(clip, facecam=[round(v * src_w / dims[0]) for v in box])
            return draw(src, out_dir, name, clip, words, src_w, src_h)

        render.render_clip = render_clip

        # The title is read first: it names the game (GTA VI and so on), which decides the hooks and hashtags.
        tell({"status": "running", "stage": "Opening the video", "progress": 0.01})
        name = media.info(spec["url"])["title"]
        job = jobs.create({"type": "url", "url": spec["url"], "name": name}, options, enqueue=False)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        try:
            from studio import safe as _safe
            why = explain(e, bool(os.environ.get("YT_COOKIES"))) or _safe.friendly(e, 300)
        except Exception:  # noqa: BLE001
            why = str(e)[-300:]
        tell({"status": "error", "stage": "Stopped", "progress": 0, "error": why})
        return 1

    def run():
        ctx.set_uid(uid)
        try:
            # A video site sometimes refuses one download ("403 Forbidden") and accepts the next. Before any
            # clip exists, the video is simply started again, twice at most.
            for attempt in range(3):
                try:
                    jobs._run_job(job)
                    break
                except Exception as e:  # noqa: BLE001
                    if attempt == 2 or job["clips"] or not re.search(r"\b403\b|Forbidden", str(e)):
                        raise
                    traceback.print_exc()
                    job.update(status="running", stage="The video site refused the download, trying again", error=None)
                    time.sleep(6 + 6 * attempt)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            for c in job["clips"]:
                if c.get("status") in ("queued", "rendering"):
                    c.update(status="error", error="The video stopped before this clip was made.")
            job.update(status="error", error=explain(e, signed_in) or safe.friendly(e), stage="Stopped")

    worker = threading.Thread(target=run, daemon=True)
    worker.start()

    sent, last, full = set(), None, False

    def words_near(clip) -> list:
        """The words spoken around this clip, kept so the clip can be remade later without the whole video."""
        try:
            words = json.loads((Path(job["dir"]) / "words.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            words = []
        return [w for w in words if clip["start"] - PAD - 2 <= w["s"] <= clip["end"] + PAD + 2]

    def upload(clip) -> bool:
        """One finished clip: the cover picture, what is needed to remake it, then the video. False once storage is full."""
        folder = Path(job["dir"]) / "clips"
        head = clip_head(clip, spec.get("look"), job.get("title"))
        cover, video = folder / str(clip.get("cover")), folder / str(clip.get("file"))
        if not (clip.get("file") and video.is_file()):
            return True
        if clip.get("cover") and cover.is_file():
            send(web, spec["id"], clip["id"], "cover", cover, "image/jpeg", head)
        data = {"start": clip["start"], "end": clip["end"], "hook": clip.get("hook") or "", "highlight_words": clip.get("highlight_words") or [],
                "facecam": clip.get("facecam"), "facecam_dims": looked.get("dims"), "quality": int(job["options"]["quality"]), "words": words_near(clip),
                "fixed_words": clip.get("fixed_words") or [], "fixed_for": clip.get("fixed_for")}
        send(web, spec["id"], clip["id"], "data", json.dumps(data).encode(), "application/json", head)
        code = send(web, spec["id"], clip["id"], "video", video, "video/mp4", head)
        for f in (cover, video):
            f.unlink(missing_ok=True)                 # on the website now (or could not be sent): free the disk
        return code != 413

    def report(final=False):
        nonlocal last, full
        for c in list(job["clips"]):
            if c.get("status") == "done" and c["id"] not in sent and not full:
                sent.add(c["id"])
                if not upload(c):
                    full = True
        asked_cam = (job.get("options") or {}).get("layout") == "gameplay"
        body = {
            "status": job["status"] if final or job["status"] != "done" else "running",
            "stage": job.get("stage") or "", "progress": round(float(job.get("progress") or 0), 3),
            "title": job.get("title") or "", "uploader": job.get("uploader") or "", "duration": job.get("duration") or 0,
            "game": job.get("game") or "", "error": job.get("error"),
            "model": (job.get("ai") or {}).get("model"), "tokens": (job.get("ai") or {}).get("tokens", 0),
            "note": (job.get("ai") or {}).get("note") or "",
            "ai_error": ai_error(job),
            # Each model tried and what the service replied, the member's own choice first.
            "ai_said": [{"model": m, "error": e} for m, e in AI_SAID.items()][:4] if not (job.get("ai") or {}).get("model") else [],
            "failed": [{"id": c["id"], "error": c.get("error") or ""} for c in job["clips"] if c.get("status") == "error"],
            "found": len(job["clips"]), "storage_full": full,
            # Whether the streamer's webcam was found: None until it has been looked for.
            "facecam": (bool(looked.get("box")) if looked.get("done") else None) if asked_cam else None,
        }
        if final or body != last:
            if tell(body) == 410:                     # the job was deleted on the website: stop working on it
                os._exit(0)
            last = body

    while worker.is_alive():
        report()
        time.sleep(1.5)
    if job["status"] not in ("done", "error"):
        job.update(status="error", error="The video stopped unexpectedly.", stage="Stopped")
    report(final=True)
    return 0


# ---------------------------------------------------------------------------------------------- one clip again
def remake(spec, web, work):
    """A member changed a clip (its hook, captions, layout or where it starts and ends): fetch just that part of
    the video again and render it with the new settings. The words were saved when the clip was first made."""
    clip = spec["clip"]

    def done(error=None):
        try:
            web.post("/edit", params={"job": spec["job"], "clip": clip["n"]}, json={"ok": error is None, "error": error})
        except httpx.HTTPError:
            pass

    try:
        from studio import media, render, roman, safe

        render.install_fonts()
        sign_in(media)
        if use_look(render, clip.get("look")):
            clip = dict(clip, style="custom")
        start, end = float(clip["start"]), float(clip["end"])
        if not 3 <= end - start <= 180:
            raise RuntimeError("A clip can be 3 to 180 seconds long.")
        want = max(0.0, start - PAD)
        piece = media.download_section(spec["url"], work / "src", "piece", want, end + PAD, int(spec.get("quality") or 720), exact=True)
        meta = media.probe(piece)
        end = min(end, want + meta["duration"])

        # The tidied caption words are used when the clip still covers the same seconds; otherwise the words as heard.
        same = spec.get("fixed_for") and spec["fixed_for"][:2] == [round(start, 2), round(end, 2)] and spec.get("fixed_words")
        words = spec["fixed_words"] if same else [w for w in spec.get("words") or [] if start - 1 <= w["s"] <= end + 1]
        near = [dict(w, s=w["s"] - want, e=w["e"] - want) for w in roman.words(words)] if clip.get("captions", True) else []

        # The webcam's box was measured on a small copy of the video: bring it to this piece's size.
        face, dims = clip.get("facecam"), clip.get("facecam_dims")
        if face and dims and dims[0]:
            face = [round(v * meta["width"] / dims[0]) for v in face]
        local = {"id": clip["n"], "start": start - want, "end": end - want, "hook": roman.to_roman(str(clip.get("hook") or ""))[:60],
                 "style": clip.get("style") or "bounce", "layout": clip.get("layout") or "crop", "captions": bool(clip.get("captions", True)),
                 "highlight_words": clip.get("highlight_words") or [], "facecam": face}
        out = render.render_clip(piece, work / "out", clip["n"], local, near, meta["width"], meta["height"])
        shown = dict(clip, id=clip["n"], start=round(start, 2), end=round(end, 2), layout=out["layout"], hook=local["hook"])
        head = clip_head(shown, clip.get("look"))
        send(web, spec["job"], clip["n"], "cover", work / "out" / out["cover"], "image/jpeg", head, edit=True)
        code = send(web, spec["job"], clip["n"], "video", work / "out" / out["file"], "video/mp4", head, edit=True)
        if code == 413:
            return done("Your storage is full, so the new version wasn't saved.") or 1
        if not 200 <= code < 300:
            return done("The new version couldn't be saved. Please try again.") or 1
        done()
        return 0
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        try:
            from studio import safe as _safe
            why = explain(e, bool(os.environ.get("YT_COOKIES"))) or _safe.friendly(e, 300)
        except Exception:  # noqa: BLE001
            why = str(e)[-300:]
        done(why)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
