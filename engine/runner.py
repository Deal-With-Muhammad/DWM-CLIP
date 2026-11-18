"""Makes the clips for one video (or remakes one clip), then reports back to the website.

The clip pipeline itself is PeakCut (the `studio` folder, MIT licence, see PEAKCUT-LICENSE): it fetches the
video, writes the transcript, asks the AI for the best moments and renders each one as a captioned 9:16 clip.
This file starts it for one job, sends progress to the website, and uploads each finished clip there.
`studio` is kept exactly as PeakCut publishes it; the few things done differently are set from here.

Run as:  python runner.py <job.json>      (server.py does this; the file is deleted as soon as it is read)
         python runner.py --check <link>  (looks at a link without making anything, and prints what it found)
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

import editing
import live_source

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
        return "YouTube is turning our servers away right now. Try again in a few minutes, or use a Twitch or Kick link."
    if isinstance(e, live_source.NoRecording) or "live stream couldn't be fetched" in s or "isn't in its recording yet" in s or "only just started" in s:
        return s
    if re.search(r"is a live stream|live event will begin|Premieres in|is offline", s, re.I):
        return "This stream hasn't started, is offline, or keeps no recording while it's live. Paste the link again once it's on air, or after it has ended."
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
    if DROPPED.search(s):
        return "The connection to the video site kept dropping. Please try again in a few minutes."
    if re.search(r"Unsupported URL|is not a valid URL|Unable to recognize|no video (formats|could be) found|not a single video|youtube:tab|channel/playlist", s, re.I):
        return "That link doesn't lead to a video. Paste the link of one video or one live stream."
    # Anything else the downloader says about a video: its own sentence, without the tool's labels in front.
    plain = re.match(r"ERROR: \[[\w:+-]+\] [^:\s]+: (.{8,300})", s, re.S)
    if plain:
        return plain.group(1).strip()
    return None


# YouTube asking our server to prove it isn't a robot: a refusal of the address the container got, not of the video.
REFUSED = re.compile(r"not a bot|confirm you.?re not|isn't letting .* download", re.I)
# A download that broke off part way. The same video usually comes through on the next try.
DROPPED = re.compile(r"timed out|Connection reset|IncompleteRead|Connection aborted|Temporary failure in name resolution|Remote end closed", re.I)
# Other parts of the world a job can be handed to (Cloudflare's names), in the order they are tried. Looked at
# on 2026-11-19: YouTube turned away our containers in Frankfurt, Warsaw and Seattle, and accepted the ones in
# London, Amsterdam, Chicago, Atlanta, Singapore, Tokyo and Sydney.
PLACES = ["weur", "enam", "apac", "apac-ne"]


def whereabouts() -> dict:
    """Where this container reaches the internet from: Cloudflare's nearest location and the country of its address."""
    try:
        text = httpx.get("https://www.cloudflare.com/cdn-cgi/trace", timeout=4, trust_env=False).text
        got = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
        return {"colo": got.get("colo", ""), "country": got.get("loc", ""), "ip": got.get("ip", "")}
    except Exception:  # noqa: BLE001 - only for the logs
        return {}


def move(spec) -> bool:
    """A container starts near the member who asked, and YouTube turns away the addresses of some places, so
    the same member was refused time after time while others got through. The whole job is handed to a
    container in another part of the world, and this one stops. True when another one has taken it."""
    engine, secret = str(spec.get("engine") or ""), os.environ.get("ENGINE_SECRET", "")
    tried = [str(p) for p in spec.get("tried") or [spec.get("place") or ""]]
    nxt = next((p for p in PLACES if p not in tried), None)
    if not engine.startswith("https://") or not secret or nxt is None or len(tried) >= 4:
        return False
    try:
        r = httpx.post(engine.rstrip("/") + "/jobs", json=dict(spec, place=nxt, tried=tried + [nxt]), trust_env=False,
                       headers={"Authorization": "Bearer " + secret}, timeout=httpx.Timeout(90, connect=10))
        return r.status_code < 300
    except httpx.HTTPError:
        return False


def check(url: str) -> dict:
    """What a link is, before anything is made from it: its name and length, or why it can't be clipped."""
    out = {"ok": False, "where": whereabouts()}
    try:
        from studio import media, safe
        signed_in = sign_in(media)
        try:
            i, _raw = live_source.look(url, media)
            if i["kind"] != "video" or not i["title"]:
                raise RuntimeError("That link is a channel or playlist, not a single video. Paste the link of one video.")
            out.update(ok=True, title=i["title"][:200], uploader=i["uploader"][:120], seconds=round(i["duration"]), live=i["is_live"],
                       thumb=i["thumbnail"] if str(i["thumbnail"]).startswith("https://") else "")
            if i["is_live"]:
                # On air: how much has been broadcast so far, and whether the site keeps it to cut from.
                stream = live_source.open_live(url, media)
                if not stream:
                    raise RuntimeError("This is a live stream with nothing recorded to clip from.")
                so_far = stream.length()
                if so_far < 120:
                    raise live_source.NoRecording("This stream has only just started. Give it a few minutes, then paste the link again.")
                out.update(seconds=round(so_far), title=(stream.title or i["title"])[:200])
        except Exception as e:  # noqa: BLE001
            out.update(ok=False, refused=bool(REFUSED.search(str(e))), error=explain(e, signed_in) or safe.friendly(e, 300))
    except Exception as e:  # noqa: BLE001
        out.update(ok=False, error=str(e)[-300:])
    return out


def liveliest(brain, db, words, n, min_len, max_len, duration, taken) -> list:
    """Up to n stretches of the video that no clip covers yet, the loudest first. Where there is talking, a
    stretch starts on a line and ends where a sentence ends, the same as a clip the AI picked."""
    import numpy as np
    z = brain.loud_zscore(db)
    lines = brain.make_lines(words, z)
    said = np.array([w["s"] for w in words]) if words else np.zeros(0)
    length = min((min_len + max_len) / 2, duration)
    least = min(min_len, duration) - 1
    picks = []

    def clear(s, e):
        return all(e <= a - 2 or s >= b + 2 for a, b in list(taken) + [(p["start"], p["end"]) for p in picks])

    for must_talk in (True, False):
        for sec in np.argsort(-z, kind="stable")[:2000]:
            if len(picks) >= n:
                return picks
            # Most of the stretch comes before the loud second: what led up to it, then the reaction.
            e = min(duration, max(0.0, float(sec) - length * 0.6) + length)
            s = max(0.0, e - length)
            if e - s < least or not clear(s, e):
                continue
            talk = int(np.searchsorted(said, e, "right") - np.searchsorted(said, s, "left"))
            if must_talk and talk < 8:
                continue
            if talk:
                s, e = brain._snap({"start": s, "end": e}, lines, words, min_len, max_len, duration)
                if e - s < least or not clear(s, e):
                    continue
            picks.append({"start": round(s, 2), "end": round(e, 2), "text": " ".join(w["w"] for w in words if s <= w["s"] <= e)})
    return picks


def main(spec_path: str):
    if spec_path == "--check":
        os.environ["PEAKCUT_DATA"] = tempfile.mkdtemp(prefix="clipcheck-")
        os.environ["PEAKCUT_UPDATE_CHECK"] = "0"
        sys.path.insert(0, str(HERE))
        print("CHECK " + json.dumps(check(sys.argv[2])), flush=True)
        return 0
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


def clip_head(clip: dict, look=None, video_title="", base=0.0) -> dict:
    meta = {k: clip.get(k) for k in ("title", "hook", "description", "hashtags", "score", "category", "start", "end", "layout", "style")}
    if base:
        meta["start"], meta["end"] = round(clip["start"] + base, 2), round(clip["end"] + base, 2)
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
AI_PICKED = [False]     # the AI has picked moments for at least one part of this video
AI_WAITED = [0.0]       # seconds spent waiting for the AI service's rate limit to pass, over the whole video
AI_SKIPPED = [0]        # parts of the video the AI never answered for, which were left without clips


def keep_ai_reason(ai, brain=None):
    """The engine turns a refused AI call into a sentence about its own dashboard and drops what the service
    said. That reply (which model, which limit) is what tells a member, or us, what to change, so it is kept."""
    call = ai.call
    waited = set()

    def kept(model, *a, **k):
        try:
            out = call(model, *a, **k)
        except Exception as e:  # noqa: BLE001 - noted, then left to the engine as before
            AI_SAID.setdefault(str(model), str(e)[:400])     # the first reply for each model tried
            # A free key answers only a few questions a minute, and the engine's own retries all fall inside
            # that minute. Once per model for each question (a long video is asked about part by part), wait
            # for the next minute and ask again before giving up on it: ten minutes of waiting at most a video.
            asked = (model, hash(a[0]) if a else 0)
            if "HTTP 429" not in str(e) or asked in waited or AI_WAITED[0] >= 600 or k.get("timeout") or (len(a) > 2 and a[2]):
                raise
            waited.add(asked)
            AI_WAITED[0] += 45
            time.sleep(45)
            out = call(model, *a, **k)
        if brain is not None and len(a) > 1 and a[1] is brain.SCHEMA:
            AI_PICKED[0] = True
        return out

    ai.call = kept


def no_stamp(brain):
    """With no answer from the AI the engine takes the loudest moments and puts "WAIT FOR IT" on every one of
    them, titled "Loud moment". The same heading on every clip is worse than none: these go out without one."""
    loudest = brain.fallback_by_loudness

    def plain(*a, **k):
        if AI_PICKED[0]:
            # The AI is picking the moments of this video and only this part got no answer. A clip from here
            # would be the odd one out, with no heading or title: the part is left out, and the clips it would
            # have had are looked for in the parts that follow.
            AI_SKIPPED[0] += 1
            return []
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

    live = {"on": False, "base": 0.0, "url": "", "whole": True, "hours": 0}
    part = {"on": False, "from": 0.0, "hours": 0}      # a video longer than the plan takes at once: the stretch that is clipped
    kept = {}                                           # the video's sound and loudness, for clips added at the end
    try:
        from studio import auth, brain, ctx, db, facecam, jobs, media, render, roman, safe

        no_stamp(brain)
        editing.install(render, brain, roman)
        from studio import ai as ai_service
        keep_ai_reason(ai_service, brain)

        db.init()
        user = auth.local_user()
        uid = user["id"] if isinstance(user, dict) else getattr(user, "id", auth.LOCAL_ID)
        ctx.set_uid(uid)
        render.install_fonts()
        signed_in = sign_in(media)
        options = dict(spec.get("options") or {})
        tighten = options.pop("tighten", False) is True
        editing.SHORTEST[0] = float(options.get("min_len") or 0)
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
            return draw(src, out_dir, name, dict(clip, tighten=tighten), words, src_w, src_h)

        render.render_clip = render_clip

        # The video's sound and how loud each second is are worked out once by the engine. They are kept, so
        # that clips can still be added once it has finished (see top_up).
        load, loud = media.load_audio, media.loudness_per_second

        def load_audio(wav):
            sound = load(wav)
            if Path(wav).name == "audio.wav":
                kept["audio"] = sound
            return sound

        def loudness(sound):
            kept["db"] = loud(sound)
            return kept["db"]

        media.load_audio, media.loudness_per_second = load_audio, loudness

        # The title is read first: it names the game (GTA VI and so on), which decides the hooks and hashtags.
        where = whereabouts()
        print("engine at", spec["id"], where.get("colo"), where.get("country"), "place:", spec.get("place") or "near the member", flush=True)
        tell({"status": "running", "stage": "Opening the video", "progress": 0.01, "where": f"{where.get('colo', '')} {where.get('country', '')}".strip()})
        first, raw = live_source.look(spec["url"], media)
        if first["kind"] != "video":
            raise RuntimeError("That link is a channel or playlist, not a single video. Paste the link of one video.")
        name = first["title"]
        most = float(spec.get("max_hours") or 3) * 3600
        if not first["is_live"]:
            # A video longer than the plan takes at once is not turned away: one stretch of it is clipped, as long
            # as the plan allows, from where the member chose (the start, if they didn't). The engine sees that
            # stretch as a video starting at zero, the same as it does for a live stream.
            long = first["duration"] > most + 1
            stream = live_source.open_recording(spec["url"], media, raw, part=long)
            if long:
                try:
                    start = float(spec.get("from") or 0)
                except (TypeError, ValueError):
                    start = 0.0
                live["base"] = stream.align(min(max(0.0, start), stream.length() - most))
                part.update(on=True, hours=most / 3600)
                part["from"] = live["base"]
                live_source.use(media, stream, live["base"], min(most, stream.length() - live["base"]))
            elif stream:
                live_source.use(media, stream)      # a stream that ended a short while ago: its pieces are fetched by number
        if first["is_live"]:
            # On air right now: the clips come from what has been broadcast so far. The most recent hours are
            # looked at, as many as the plan takes, and the engine sees them as a video that starts at zero.
            tell({"status": "running", "stage": "Opening the live stream", "progress": 0.02})
            stream = live_source.open_live(spec["url"], media)
            if not stream:
                raise RuntimeError("This is a live stream with nothing recorded to clip from.")
            so_far = stream.length()
            if so_far < 120:
                raise live_source.NoRecording("This stream has only just started. Give it a few minutes, then paste the link again.")
            # A piece of the recording is up to twelve seconds long, and the stretch must not run over the plan's hours.
            live["base"] = stream.align(so_far - most + 15) if so_far > most else 0.0
            live.update(on=True, url=stream.url, whole=live["base"] == 0, hours=most / 3600)
            live_source.use(media, stream, live["base"], so_far - live["base"])
            name = stream.title or name
        job = jobs.create({"type": "url", "url": spec["url"], "name": name}, options, enqueue=False)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        if REFUSED.search(str(e)):
            tell({"status": "running", "stage": "YouTube turned this server away, trying another one", "progress": 0.01})
            if move(spec):
                return 0
        try:
            from studio import safe as _safe
            why = explain(e, bool(os.environ.get("YT_COOKIES"))) or _safe.friendly(e, 300)
        except Exception:  # noqa: BLE001
            why = str(e)[-300:]
        tell({"status": "error", "stage": "Stopped", "progress": 0, "error": why})
        return 1

    moved = []

    def top_up():
        """The member asked for a number of clips. The AI is told to skip weak moments and may pick fewer; a busy
        AI service leaves parts of a video unread; a video with almost no talking is never shown to it at all.
        Whatever the reason, the clips still missing are made from the liveliest stretches no clip covers yet."""
        o = job["options"]
        made = lambda: sum(1 for c in job["clips"] if c.get("status") == "done")     # noqa: E731
        want = int(o["max_clips"]) - made()
        sound, db_ = kept.get("audio"), kept.get("db")
        if want <= 0 or sound is None or db_ is None or full:
            return
        try:
            words = json.loads((Path(job["dir"]) / "words.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            words = []
        kept["quiet"] = len(words) < 8
        length = float(job.get("duration") or len(db_))
        picks = liveliest(brain, db_, words, want + 2, int(o["min_len"]), int(o["max_len"]), length, [(c["start"], c["end"]) for c in job["clips"]])
        answered = bool((job.get("ai") or {}).get("model"))
        for pick in picks:
            if made() >= int(o["max_clips"]):
                break
            job.update(status="running", stage="Making one more clip", progress=0.95)
            text = pick.pop("text")
            # A heading and title for it, when the AI has been answering for this video. Without them the clip
            # goes out plain, under the video's own title.
            said = brain.describe(text, job.get("title") or "", job.get("uploader") or "", job.get("game") or None, timeout=45) if answered else {}
            c = {"score": 50, "category": "other", "hook": "", "title": "", "description": "", "hashtags": [], "highlight_words": [], **said,
                 "reason": "Picked as one of the liveliest parts, to make up the number of clips asked for.", **pick,
                 "id": f"clip{len(job['clips']) + 1:02d}", "style": o["style"], "layout": o["layout"], "captions": o.get("captions", True),
                 "status": "queued", "version": 0}
            c["score"] = c["score"] or 50
            box = find_facecam(job) if o["layout"] == "gameplay" else None
            if box:
                c["facecam"] = box
            job["clips"].append(c)
            here = job.get("source_path") and Path(job["source_path"]).is_file()
            if job["source"]["type"] == "url" and not here:
                jobs._fetch_piece(job, c, sound)
            if c["status"] != "error":
                jobs.render_one(job, c, words)
            if c.get("status") == "done":
                kept["topped"] = kept.get("topped", 0) + 1
        kept["room"] = made() < int(o["max_clips"])       # still short: the video has no more room for clips of this length
        job.update(status="done", stage="Done" if made() else "Done, but nothing clip-worthy was found", progress=1.0)

    def run():
        ctx.set_uid(uid)
        try:
            # A video site sometimes refuses one download ("403 Forbidden"), or the connection drops part way,
            # and the next try goes through. Before any clip exists, the video is simply started again, twice at most.
            for attempt in range(3):
                try:
                    jobs._run_job(job)
                    break
                except Exception as e:  # noqa: BLE001
                    if job["clips"]:
                        raise
                    if REFUSED.search(str(e)):
                        # YouTube won't serve this container's address at all: another one, elsewhere, takes the video.
                        job.update(status="running", stage="YouTube turned this server away, trying another one", error=None)
                        if move(spec):
                            moved.append(True)
                            return
                        raise
                    if attempt == 2 or not (re.search(r"\b403\b|Forbidden", str(e)) or DROPPED.search(str(e))):
                        raise
                    traceback.print_exc()
                    media._yt_refused_until = 0.0
                    job.update(status="running", stage="The video site refused the download, trying again", error=None)
                    time.sleep(6 + 6 * attempt)
            try:
                top_up()
            except Exception:  # noqa: BLE001 - the clips already made are not lost over an extra one
                traceback.print_exc()
                job.update(status="done", stage="Done" if job["clips"] else "Done, but nothing clip-worthy was found", progress=1.0)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            for c in job["clips"]:
                if c.get("status") in ("queued", "rendering"):
                    c.update(status="error", error="The video stopped before this clip was made.")
            job.update(status="error", error=explain(e, signed_in) or safe.friendly(e), stage="Stopped")

    sent, last, full = set(), None, False
    told = [0.0]        # when the website last heard from this video
    worker = threading.Thread(target=run, daemon=True)
    worker.start()

    def words_near(clip) -> list:
        """The words spoken around this clip, kept so the clip can be remade later without the whole video."""
        try:
            words = json.loads((Path(job["dir"]) / "words.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            words = []
        return [w for w in words if clip["start"] - PAD - 2 <= w["s"] <= clip["end"] + PAD + 2]

    base = live["base"]

    def at(words) -> list:
        """Words on the stream's own clock (a live stream is looked at from `base`, which the engine calls zero)."""
        return [dict(w, s=round(w["s"] + base, 2), e=round(w["e"] + base, 2)) for w in words or []] if base else list(words or [])

    def upload(clip) -> bool:
        """One finished clip: the cover picture, what is needed to remake it, then the video. False once storage is full."""
        folder = Path(job["dir"]) / "clips"
        head = clip_head(clip, spec.get("look"), job.get("title"), base)
        cover, video = folder / str(clip.get("cover")), folder / str(clip.get("file"))
        if not (clip.get("file") and video.is_file()):
            return True
        if clip.get("cover") and cover.is_file():
            send(web, spec["id"], clip["id"], "cover", cover, "image/jpeg", head)
        span = clip.get("fixed_for")
        data = {"start": round(clip["start"] + base, 2), "end": round(clip["end"] + base, 2), "hook": clip.get("hook") or "",
                "highlight_words": clip.get("highlight_words") or [],
                "facecam": clip.get("facecam"), "facecam_dims": looked.get("dims"), "quality": int(job["options"]["quality"]), "words": at(words_near(clip)),
                "fixed_words": at(clip.get("fixed_words")),
                "fixed_for": [round(span[0] + base, 2), round(span[1] + base, 2), *span[2:]] if span and base else span,
                # The later headings, when on the stream's clock each one comes in; whether quiet stretches are cut.
                "beats": [{"at": round(clip["start"] + base + b["t"], 2), "text": b["text"]} for b in clip.get("beats") or []],
                "tighten": tighten, "live": live["on"], "source": live["url"]}
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
            "title": job.get("title") or "", "uploader": job.get("uploader") or "", "duration": round(first["duration"] if part["on"] else (job.get("duration") or 0) + base),
            # A live stream: where its recording is, and how much of it the clips were picked from.
            "live": live["on"], "source_url": live["url"], "live_whole": live["whole"], "live_hours": live["hours"],
            # A video longer than the plan takes at once: where the stretch that was clipped starts, and how long it is.
            "part": part["on"], "part_from": round(part["from"]), "part_hours": part["hours"],
            # Clips added at the end to make up the number asked for; whether the video had no more room; no talking in it.
            "asked": int((job.get("options") or {}).get("max_clips") or 0), "topped": kept.get("topped", 0),
            "no_room": bool(kept.get("room")), "quiet": bool(kept.get("quiet")),
            "game": job.get("game") or "", "error": job.get("error"),
            "model": (job.get("ai") or {}).get("model"), "tokens": (job.get("ai") or {}).get("tokens", 0),
            "note": (job.get("ai") or {}).get("note") or "",
            "ai_error": ai_error(job),
            "ai_skipped": AI_SKIPPED[0],
            # Each model tried and what the service replied, the member's own choice first.
            "ai_said": [{"model": m, "error": e} for m, e in AI_SAID.items()][:4] if not (job.get("ai") or {}).get("model") else [],
            "failed": [{"id": c["id"], "error": c.get("error") or ""} for c in job["clips"] if c.get("status") == "error"],
            "found": len(job["clips"]), "storage_full": full,
            # Whether the streamer's webcam was found: None until it has been looked for.
            "facecam": (bool(looked.get("box")) if looked.get("done") else None) if asked_cam else None,
        }
        # The website closes a video it hasn't heard from in 15 minutes, as one that has crashed. A slow AI
        # service can keep one step going that long with nothing new to say, so it hears from us every minute.
        if final or body != last or time.time() - told[0] > 60:
            if tell(body) == 410:                     # the job was deleted on the website: stop working on it
                os._exit(0)
            last, told[0] = body, time.time()

    while worker.is_alive():
        report()
        time.sleep(1.5)
    if moved:
        return 0                                  # another container has the video now, and reports on it from here
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
        editing.install(render)
        sign_in(media)
        if spec.get("live"):            # made from a live stream: if it is still on air, this piece comes from it too
            try:
                stream = live_source.open_live(spec["url"], media)
            except Exception:  # noqa: BLE001 - not on air any more, or not saying: the link is fetched as a video
                stream = None
            if stream:
                live_source.use(media, stream)
        if not spec.get("live") or not stream:
            # A YouTube stream that ended a short while ago is still in numbered pieces, which are fetched by number.
            try:
                _, raw = live_source.look(spec["url"], media)
                ended = None if raw.get("is_live") else live_source.open_recording(spec["url"], media, raw)
                if ended:
                    live_source.use(media, ended)
            except Exception:  # noqa: BLE001 - the link is fetched the ordinary way, and says what is wrong there
                traceback.print_exc()
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
        beats = [{"t": round(float(b["at"]) - start, 2), "text": roman.to_roman(str(b.get("text") or ""))[:40]}
                 for b in spec.get("beats") or [] if isinstance(b, dict) and isinstance(b.get("at"), (int, float))]
        local = {"id": clip["n"], "start": start - want, "end": end - want, "hook": roman.to_roman(str(clip.get("hook") or ""))[:60],
                 "style": clip.get("style") or "bounce", "layout": clip.get("layout") or "crop", "captions": bool(clip.get("captions", True)),
                 "highlight_words": clip.get("highlight_words") or [], "facecam": face,
                 "beats": beats, "tighten": spec.get("tighten") is True}
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
