"""Makes the clips for one video, then reports back to the website.

The clip pipeline itself is PeakCut (the `studio` folder, MIT licence, see PEAKCUT-LICENSE): it fetches the
video, writes the transcript, asks the AI for the best moments and renders each one as a captioned 9:16 clip.
This file only starts it for one job, sends progress to the website, and uploads each finished clip there.

Run as:  python runner.py <job.json>      (server.py does this; the file is deleted as soon as it is read)
"""
import base64
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent


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

    def tell(body: dict):
        """Progress for the website. A lost message is not worth stopping a video for: the next one carries on."""
        try:
            return web.post("/progress", params={"job": spec["id"]}, json=body).status_code
        except httpx.HTTPError:
            return 0

    try:
        sys.path.insert(0, str(HERE))
        from studio import auth, ctx, db, jobs, media, render, safe

        db.init()
        user = auth.local_user()
        uid = user["id"] if isinstance(user, dict) else getattr(user, "id", auth.LOCAL_ID)
        ctx.set_uid(uid)
        render.install_fonts()
        # The title is read first: it names the game (GTA VI and so on), which decides the hooks and hashtags.
        tell({"status": "running", "stage": "Opening the video", "progress": 0.01})
        name = media.info(spec["url"])["title"]
        job = jobs.create({"type": "url", "url": spec["url"], "name": name}, spec.get("options") or {}, enqueue=False)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        try:
            from studio import safe as _safe
            why = _safe.friendly(e, 300)
        except Exception:  # noqa: BLE001
            why = str(e)[-300:]
        tell({"status": "error", "stage": "Stopped", "progress": 0, "error": why})
        shutil.rmtree(work, ignore_errors=True)
        return 1

    def run():
        ctx.set_uid(uid)
        try:
            jobs._run_job(job)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            for c in job["clips"]:
                if c.get("status") in ("queued", "rendering"):
                    c.update(status="error", error="The video stopped before this clip was made.")
            job.update(status="error", error=safe.friendly(e), stage="Stopped")

    worker = threading.Thread(target=run, daemon=True)
    worker.start()

    sent, last, full = set(), None, False

    def upload(clip) -> bool:
        """One finished clip: the cover picture, then the video with its title and tags. False once storage is full."""
        folder = Path(job["dir"]) / "clips"
        meta = {k: clip.get(k) for k in ("title", "hook", "description", "hashtags", "score", "category", "start", "end", "layout")}
        head = {"x-clip-meta": base64.urlsafe_b64encode(json.dumps(meta).encode()).decode()}
        for part, name, kind in (("cover", clip.get("cover"), "image/jpeg"), ("video", clip.get("file"), "video/mp4")):
            f = folder / str(name)
            if not name or not f.is_file():
                continue
            for attempt in range(3):
                try:
                    with f.open("rb") as body:
                        r = web.put("/clip", params={"job": spec["id"], "clip": clip["id"], "part": part}, content=body,
                                    headers={**head, "content-type": kind, "content-length": str(f.stat().st_size)})
                    if r.status_code == 413:
                        return False
                    if r.status_code < 300:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(2 + 3 * attempt)
            f.unlink(missing_ok=True)                 # it is on the website now (or could not be sent): free the disk
        return True

    def report(final=False):
        nonlocal last, full
        for c in list(job["clips"]):
            if c.get("status") == "done" and c["id"] not in sent and not full:
                sent.add(c["id"])
                if not upload(c):
                    full = True
        body = {
            "status": job["status"] if final or job["status"] != "done" else "running",
            "stage": job.get("stage") or "", "progress": round(float(job.get("progress") or 0), 3),
            "title": job.get("title") or "", "uploader": job.get("uploader") or "", "duration": job.get("duration") or 0,
            "game": job.get("game") or "", "error": job.get("error"),
            "model": (job.get("ai") or {}).get("model"), "tokens": (job.get("ai") or {}).get("tokens", 0),
            "note": (job.get("ai") or {}).get("note") or "",
            "failed": [{"id": c["id"], "error": c.get("error") or ""} for c in job["clips"] if c.get("status") == "error"],
            "found": len(job["clips"]), "storage_full": full,
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
    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
