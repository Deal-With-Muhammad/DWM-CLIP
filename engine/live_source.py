"""A stream that is on air right now, as something clips can be cut from.

A live link never finishes downloading, so it can't be fetched like a video. But YouTube, Twitch and Kick all
keep what has been broadcast so far, in small numbered pieces of a few seconds each. Asking for the pieces
that cover a stretch of time gives that stretch, whether it is the first minute of the stream or the last.

`open_live(url, media)` returns the stream behind a link, or None when the link is not live. A stream gives:
  length()                  seconds broadcast so far
  align(t)                  the start of the piece that holds second t (a download starts on a piece)
  audio(a, b, dir, stem)    the sound from a to b
  video(a, b, dir, stem)    the picture and sound from a to b (from the piece holding a, or exactly a)
Times are seconds from the start of the stream, the same as in the recording the site keeps afterwards.
"""
import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse


class NoRecording(RuntimeError):
    """The stream is live, but the site keeps no recording of it to cut from."""


def _name(title) -> str:
    """yt-dlp adds the date and time to the title of anything live; the stream's own name is what the member knows."""
    return re.sub(r"\s\d{4}-\d\d-\d\d \d\d:\d\d$", "", str(title or "")).strip()


def _host(url: str) -> str:
    return (urlparse((url or "").strip()).hostname or "").lower()


def _ffmpeg(args: list, timeout=1800):
    p = subprocess.run(["ffmpeg", "-y", "-v", "error", *args], capture_output=True, text=True, errors="replace", timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {p.stderr[-600:]}")


def _get(ydl, url, tries=3):
    last = None
    for n in range(tries):
        try:
            r = ydl.urlopen(url)
            try:
                return r.read()
            finally:
                r.close()
        except Exception as e:  # noqa: BLE001 - one refused piece is asked for again
            last = e
            time.sleep(1 + 2 * n)
    raise last


def _save(ydl, urls: list, out: Path, on_progress=None, threads=8):
    """Every piece, in order, into one file. A few at a time, so a slow piece never holds the rest in memory."""
    def one(u):
        try:
            return _get(ydl, u)
        except Exception:  # noqa: BLE001
            return None

    missing = 0
    out.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(threads) as pool, out.open("wb") as f:
        for i in range(0, len(urls), 24):
            for data in pool.map(one, urls[i: i + 24]):
                if data:
                    f.write(data)
                else:
                    missing += 1
            if on_progress:
                on_progress(min(1.0, (i + 24) / len(urls)))
    # One lost piece moves the sound a few seconds, which the clip step corrects by ear. Many lost is a failure.
    if not urls or missing > max(1, len(urls) // 25):
        raise RuntimeError("This part of the live stream couldn't be fetched. Please try again in a few minutes.")
    return out


def _cut_exact(piece: Path, out: Path, skip: float, length: float):
    """The piece again, starting exactly `skip` seconds in (a piece starts where the site cut it, not where asked)."""
    _ffmpeg(["-ss", f"{skip:.3f}", "-i", str(piece), "-t", f"{length:.3f}", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
    piece.unlink(missing_ok=True)
    return out


class Stream:
    title = uploader = thumbnail = ""
    url = ""            # the link that keeps pointing at this broadcast once it has ended

    def length(self) -> float:
        raise NotImplementedError

    def align(self, t: float) -> float:
        raise NotImplementedError


# ------------------------------------------------------------------------------------------------- YouTube
class YouTubeLive(Stream):
    """YouTube numbers the pieces of a live stream from its start (piece n covers n times the piece length), and
    hands over any of them while the stream is on air."""

    def __init__(self, url, media):
        self.url, self._media = url, media
        self._load()

    def _load(self):
        with self._media._youtube_guard(self.url):
            self.ydl = self._media._ydl({"live_from_start": True})
            i = self.ydl.extract_info(self.url, download=False)
        fm = [f for f in i.get("formats") or [] if f.get("is_from_start") and f.get("url") and f.get("target_duration")]
        self.sound = sorted((f for f in fm if f.get("vcodec") in (None, "none")), key=lambda f: f.get("abr") or f.get("tbr") or 0)
        self.picture = [f for f in fm if f.get("vcodec") not in (None, "none")]
        if not i.get("is_live") or not self.sound or not self.picture:
            raise NoRecording("YouTube isn't giving out the earlier parts of this live stream. Try again once it has ended.")
        self.step = float(self.sound[0]["target_duration"])
        self.title = _name(i.get("title"))
        self.uploader = i.get("uploader") or i.get("channel") or ""
        self.thumbnail = i.get("thumbnail") or ""

    def _head(self) -> int:
        """The number of the newest piece."""
        from yt_dlp.networking import HEADRequest
        r = self.ydl.urlopen(HEADRequest(self.sound[0]["url"]))
        try:
            return int(r.headers["X-Head-Seqnum"])
        finally:
            r.close()

    def length(self) -> float:
        return max(0.0, (self._head() - 1) * self.step)      # the newest piece may still be being written

    def align(self, t: float) -> float:
        return int(max(0.0, t) // self.step) * self.step

    def _pieces(self, fmt, a, b) -> list:
        from yt_dlp.utils import update_url_query
        first, last = int(max(0.0, a) // self.step), int(max(0.0, b - 0.01) // self.step)
        return [update_url_query(fmt["url"], {"sq": str(n)}) for n in range(first, last + 1)]

    def _fetch(self, pick, a, b, out, on_progress=None):
        try:
            return _save(self.ydl, self._pieces(pick(), a, b), out, on_progress)
        except Exception:  # noqa: BLE001 - the addresses run out after a few hours: ask for fresh ones once
            self._load()
            return _save(self.ydl, self._pieces(pick(), a, b), out, on_progress)

    def _video_format(self, height):
        fits = [f for f in self.picture if (f.get("height") or 0) <= height] or self.picture
        return max(fits, key=lambda f: ((f.get("height") or 0), str(f.get("vcodec") or "").startswith("avc1"), f.get("tbr") or 0))

    def audio(self, a, b, out_dir: Path, stem: str, on_progress=None) -> Path:
        raw = self._fetch(lambda: self.sound[0], a, b, Path(out_dir) / f"{stem}.pieces", on_progress)    # the smallest: it is only listened to
        out = Path(out_dir) / f"{stem}.m4a"
        _ffmpeg(["-i", str(raw), "-vn", "-c:a", "copy", str(out)])
        raw.unlink(missing_ok=True)
        return out

    def video(self, a, b, out_dir: Path, stem: str, height=720, exact=False) -> Path:
        out_dir = Path(out_dir)
        v = self._fetch(lambda: self._video_format(height), a, b, out_dir / f"{stem}.v.pieces")
        s = self._fetch(lambda: self.sound[-1], a, b, out_dir / f"{stem}.a.pieces")
        out = out_dir / f"{stem}.mp4"
        whole = out_dir / f"{stem}.whole.mp4" if exact else out
        _ffmpeg(["-i", str(v), "-i", str(s), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", str(whole)])
        v.unlink(missing_ok=True)
        s.unlink(missing_ok=True)
        return _cut_exact(whole, out, a - self.align(a), b - a) if exact else out


# ------------------------------------------------------------------------------------------- Twitch and Kick
class HlsRecording(Stream):
    """Twitch and Kick write the stream into a recording while it is on air: a list of ten-second files that
    grows as the stream goes on. Each size of the picture has its own list."""

    def __init__(self, ydl, renditions: list, sound, title="", uploader="", thumbnail="", url=""):
        self.ydl, self.sound = ydl, sound
        self.renditions = sorted(renditions)             # [(height, address of the list)]
        self.title, self.uploader, self.thumbnail, self.url = title, uploader, thumbnail, url
        if not self.renditions:
            raise NoRecording("There is no recording of this live stream to clip from yet.")

    def _list(self, address) -> list:
        """[(start, length, address)] for every file in a list, as it stands right now."""
        out, t, length = [], 0.0, None
        for line in _get(self.ydl, address).decode("utf-8", "replace").splitlines():
            line = line.strip()
            if line.startswith("#EXTINF:"):
                length = float(re.match(r"#EXTINF:([\d.]+)", line).group(1))
            elif line and not line.startswith("#") and length is not None:
                out.append((t, length, urljoin(address, line)))
                t += length
                length = None
        return out

    def length(self) -> float:
        files = self._list(self.renditions[0][1])
        return files[-1][0] + files[-1][1] if files else 0.0

    def align(self, t: float) -> float:
        starts = [s for s, _, _ in self._list(self.renditions[0][1]) if s <= t + 0.01]
        return starts[-1] if starts else 0.0

    def _fetch(self, address, a, b, out, on_progress=None):
        files = [(s, n, u) for s, n, u in self._list(address) if s + n > a + 0.01 and s < b]
        if not files:
            raise RuntimeError("That part of the live stream isn't in its recording yet. Try again in a minute.")
        return _save(self.ydl, [u for _, _, u in files], out, on_progress), files[0][0]

    def audio(self, a, b, out_dir: Path, stem: str, on_progress=None) -> Path:
        raw, _ = self._fetch(self.sound or self.renditions[0][1], a, b, Path(out_dir) / f"{stem}.ts", on_progress)
        out = Path(out_dir) / f"{stem}.m4a"
        _ffmpeg(["-i", str(raw), "-vn", "-c:a", "copy", str(out)])
        raw.unlink(missing_ok=True)
        return out

    def video(self, a, b, out_dir: Path, stem: str, height=720, exact=False) -> Path:
        out_dir = Path(out_dir)
        fits = [r for r in self.renditions if r[0] <= height] or self.renditions[:1]
        raw, began = self._fetch(fits[-1][1], a, b, out_dir / f"{stem}.ts")
        out = out_dir / f"{stem}.mp4"
        whole = out_dir / f"{stem}.whole.mp4" if exact else out
        _ffmpeg(["-i", str(raw), "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", str(whole)])
        raw.unlink(missing_ok=True)
        return _cut_exact(whole, out, a - began, b - a) if exact else out


def _twitch(url, media):
    ydl = media._ydl({})
    i = ydl.extract_info(url, download=False)
    if not i.get("is_live"):
        return None
    vod = i
    if not re.search(r"twitch\.tv/videos/\d+", url):
        # A channel link: the broadcast being recorded is the newest of the channel's past broadcasts.
        channel = (re.search(r"twitch\.tv/([A-Za-z0-9_]+)", url) or [None, ""])[1]
        entries = (ydl.extract_info(f"https://www.twitch.tv/{channel}/videos?filter=archives&sort=time", download=False).get("entries") or [])
        vod = ydl.extract_info(entries[0]["url"], download=False) if entries and entries[0].get("url") else {}
        began_together = abs((vod.get("timestamp") or 0) - (i.get("timestamp") or 0)) < 900
        if not vod.get("is_live") or not began_together:
            raise NoRecording("This Twitch channel doesn't keep recordings of its streams, so there is nothing to clip from while it's live.")
    fm = [f for f in vod.get("formats") or [] if f.get("url") and "m3u8" in str(f.get("protocol") or "")]
    sound = next((f["url"] for f in fm if f.get("vcodec") in (None, "none")), None)
    return HlsRecording(ydl, [(int(f["height"]), f["url"]) for f in fm if f.get("height")], sound,
                        _name(vod.get("title") or i.get("description") or i.get("title")), vod.get("uploader") or i.get("uploader") or "",
                        vod.get("thumbnail") or i.get("thumbnail") or "", vod.get("webpage_url") or url)


def _kick(url, media):
    from yt_dlp.networking import Request
    m = re.match(r"https?://(?:www\.)?kick\.com/([A-Za-z0-9_-]+)(?:/videos/([0-9a-f-]{36}))?/?(?:[?#].*)?$", url.strip())
    if not m:
        return None
    slug, uuid = m.group(1), m.group(2)
    ydl = media._ydl({})
    try:
        rows = json.loads(_get(ydl, Request(f"https://kick.com/api/v2/channels/{slug}/videos", headers={"Accept": "application/json"})))
    except Exception:  # noqa: BLE001 - Kick wouldn't say: the link is handled like any other
        return None
    rows = rows if isinstance(rows, list) else []
    v = next((r for r in rows if isinstance(r, dict) and r.get("is_live") and (not uuid or (r.get("video") or {}).get("uuid") == uuid)), None)
    if not v or not v.get("source"):
        return None
    sizes, height = [], None
    for line in _get(ydl, v["source"]).decode("utf-8", "replace").splitlines():
        line = line.strip()
        if line.startswith("#EXT-X-STREAM-INF"):
            found = re.search(r"RESOLUTION=\d+x(\d+)", line)
            height = int(found.group(1)) if found else None
        elif line and not line.startswith("#") and height:
            sizes.append((height, urljoin(v["source"], line)))
            height = None
    thumb = v.get("thumbnail")
    return HlsRecording(ydl, sizes, None, str(v.get("session_title") or ""), str((v.get("channel") or {}).get("slug") or slug),
                        str((thumb.get("src") if isinstance(thumb, dict) else thumb) or ""),
                        f"https://kick.com/{slug}/videos/{(v.get('video') or {}).get('uuid')}")


def open_live(url: str, media):
    """The stream behind this link when it is on air now, else None. Raises NoRecording when it is on air but
    nothing of it is kept to cut from."""
    host = _host(url)
    if host == "kick.com" or host.endswith(".kick.com"):
        return _kick(url, media)
    if host == "twitch.tv" or host.endswith(".twitch.tv"):
        return _twitch(url, media)
    if media.is_youtube(url):
        return YouTubeLive(url, media)
    return None


def use(media, stream, base=0.0, span=None):
    """From here on the engine's downloads come from the live stream. With a `span`, the engine sees the stretch
    from `base` as a whole video that starts at zero (for making clips); without, times are the stream's own."""
    end = None if span is None else base + span
    if span is not None:
        media.info = lambda url: {"title": stream.title, "uploader": stream.uploader, "duration": float(span), "is_live": False,
                                  "thumbnail": stream.thumbnail, "kind": "video"}
        media.download_audio = lambda url, job_dir, on_progress=None: stream.audio(base, end, Path(job_dir), "audio_src", on_progress)
        media.download = lambda url, job_dir, height=720: stream.video(base, end, Path(job_dir), "source", height)
        media.youtube_words = lambda url: None                  # a stream has no transcript until it has ended
        media.youtube_english_words = lambda url: None

    def section(url, out_dir, stem, start, finish, height=720, exact=False):
        return stream.video(base + max(0.0, start), base + finish if end is None else min(end, base + finish), Path(out_dir), stem, height, exact)

    media.download_section = section
