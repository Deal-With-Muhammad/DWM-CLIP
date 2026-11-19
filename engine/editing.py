"""How a clip is edited, on top of PeakCut's renderer.

PeakCut cuts one unbroken stretch out of the video and keeps one heading on it from the first frame to the
last. Here a clip is treated the way a person editing it would:

- The heading comes in, stays a few seconds and leaves. The AI may give one to three more headings for later
  moments of the clip ("beats"), so the text on screen follows what is happening.
- Stretches where nobody speaks and nothing loud happens are cut out, and every other piece is moved in a
  little closer, so a cut looks meant.
- In the "follow" layout the streamer is cut out and shown above the game, and the cut-out follows their head
  (follow.py finds and follows the face; here it is fitted into the clip).

`install(render, brain)` puts this in place for one job. PeakCut's own files are not changed.
"""
import re
import shutil
import subprocess
import threading
import traceback

import numpy as np

import follow

HOOK_SECONDS = 4.5       # how long the opening heading stays
BEAT_SECONDS = 3.2       # how long a later heading stays
MIN_PAUSE = 1.4          # a gap in the talking shorter than this is left alone
KEEP_AFTER, KEEP_BEFORE = 0.35, 0.25     # a breath kept after the last word and before the next
MIN_CUT = 0.8            # a cut shorter than this isn't worth the jump
LOUDER_BY = 5.0          # dB above the usual sound between words: louder than this is "something happened"
MOST = 0.4               # never more than this share of a clip is cut out
ZOOM = 1.06              # how far every other piece moves in

NOW = threading.local()  # what the clip being drawn in this thread needs: its later headings, its cuts, how it follows the streamer
SHORTEST = [0.0]         # the shortest a clip may end up, in seconds (the member's chosen length band)

BEATS_RULE = """- beats: the hook leaves the screen after about four seconds. Give one to three more headings for later in the
  clip, each with "at" (the [seconds] value of the line it belongs to) and "text" (at most 4 words, ALL CAPS).
  A beat names what is happening right then: the turn, the payoff, the reaction ("HE HAS NO IDEA", "THERE IT IS").
  Keep them at least 5 seconds apart and never repeat the hook. Give an empty list for a clip that needs none.
"""


# ---------------------------------------------------------------------------------------------- the headings
def teach_beats(brain, roman):
    """Asks the AI for the later headings and keeps them, as seconds from the start of the clip."""
    if "- beats:" in brain.RULES:
        return
    brain.RULES = brain.RULES.replace("- title: at most 70", BEATS_RULE + "- title: at most 70", 1)
    brain.SCHEMA["items"]["properties"]["beats"] = {
        "type": "ARRAY",
        "items": {"type": "OBJECT", "properties": {"at": {"type": "NUMBER"}, "text": {"type": "STRING"}}, "required": ["at", "text"]},
    }
    plain = brain._tidy

    def tidy(c, s, e, game=None):
        out = plain(c, s, e, game)
        beats, last = [], 0.0
        given = [b for b in (c.get("beats") if isinstance(c.get("beats"), list) else []) if isinstance(b, dict)]
        for b in sorted(given, key=lambda b: brain._num(b.get("at"), -1)):
            t = brain._num(b.get("at"), -1) - s
            text = roman.to_roman(brain._text(b.get("text"), 40)).upper()
            if not text or text == out["hook"] or t < 3.0 or t > (e - s) - 2.0 or t - last < 3.0:
                continue
            beats.append({"t": round(t, 2), "text": text})
            last = t
            if len(beats) == 3:
                break
        out["beats"] = beats
        return out

    brain._tidy = tidy


def _timed(render, line: str, a: float, b: float) -> str:
    """One of PeakCut's heading lines, shown from a to b: it slides up as it fades in, and fades out."""
    line = re.sub(r"^(Dialogue: \d+),[^,]+,[^,]+,", lambda m: f"{m.group(1)},{render._ts(a)},{render._ts(b)},", line, count=1)
    line = re.sub(r"\\pos\((-?\d+),(-?\d+)\)", lambda m: f"\\move({m.group(1)},{int(m.group(2)) + 34},{m.group(1)},{m.group(2)},0,220)", line, count=1)
    return line.replace("\\fad(160,0)", "\\fad(160,260)")


def _headings(render):
    plain = render._hook_events

    def events(hook, dur, y):
        if not hook.split():
            return []               # no heading asked for: none later either
        later = [(t, text) for t, text in getattr(NOW, "beats", None) or [] if 2.0 < t < dur - 1.0]
        shown = [(0.0, hook)] + later
        out = []
        for i, (t, text) in enumerate(shown):
            stay = HOOK_SECONDS if i == 0 else BEAT_SECONDS
            until = min(t + stay, shown[i + 1][0] - 0.15 if i + 1 < len(shown) else dur, dur)
            if until - t < 0.8:
                continue
            out += [_timed(render, line, t, until) for line in plain(render._clean(text), until - t, y)]
        return out

    render._hook_events = events


# ------------------------------------------------------------------------------------------------- the cuts
def _levels(src, start: float, span: float):
    """How loud the clip is, in dB, ten times a second. None if the sound can't be read."""
    try:
        p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{span:.2f}", "-i", str(src), "-vn", "-ac", "1",
                            "-ar", "8000", "-f", "s16le", "-"], capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    x = np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32)
    n = len(x) // 800
    if p.returncode != 0 or n < 20:
        return None
    return 20 * np.log10(np.sqrt((x[: n * 800].reshape(n, 800) ** 2).mean(axis=1)) + 1.0)


def quiet_parts(src, start: float, end: float, words: list, shortest: float) -> list:
    """The stretches to cut out, as (from, to) in seconds from the start of the clip.

    A stretch is cut when nobody speaks in it and it sounds like the rest of the time between words: a pause, a
    wait, dead air. A stretch with no words that is clearly louder than that (a laugh, a shot, a crash) is the
    clip, and stays, with a little kept either side of it.
    Nothing is cut that would leave the clip shorter than `shortest`."""
    span = end - start
    said = sorted((max(0.0, w["s"] - start), min(span, w["e"] - start)) for w in words if w["e"] > start and w["s"] < end)
    room = min(span * MOST, span - shortest)
    if len(said) < 4 or room < MIN_CUT:
        return []           # hardly any talking: the picture is the clip, leave it alone
    level = _levels(src, start, span)
    if level is None:
        return []
    talking = np.zeros(len(level), dtype=bool)
    for a, b in said:
        talking[int(a * 10): int(b * 10) + 1] = True
    if talking.sum() < 10 or (~talking).sum() < 10:
        return []
    usual = float(np.median(level[~talking]))
    if usual > float(np.median(level[talking])) + 3.0:
        return []           # it is louder between the words than during them: the pauses are the action
    calm = level < usual + LOUDER_BY
    cuts = []
    for (_, a), (b, _) in zip(said, said[1:]):
        if b - a < MIN_PAUSE:
            continue
        lo, hi = int(round((a + KEEP_AFTER) * 10)), int(round((b - KEEP_BEFORE) * 10))
        i = lo
        while i < hi:               # each run of calm tenths inside the pause, with a little kept round anything loud
            if i >= len(calm) or not calm[i]:
                i += 1
                continue
            j = i
            while j < hi and j < len(calm) and calm[j]:
                j += 1
            x, y = i / 10 + (0.3 if i > lo else 0.0), j / 10 - (0.3 if j < hi else 0.0)
            if y - x >= MIN_CUT:
                cuts.append((round(x, 2), round(y, 2)))
            i = j + 1
    # The longest pauses go first; the last one that fits is shortened to what there is still room for.
    kept = []
    for x, y in sorted(cuts, key=lambda c: c[0] - c[1]):
        take = min(y - x, room)
        if take < MIN_CUT:
            break
        kept.append((x, round(x + take, 2)))
        room -= take
    return sorted(kept)


def _pieces(span: float, cuts: list) -> list:
    """What is left of the clip once the cuts are made: (from, to) in seconds from its start."""
    out, t = [], 0.0
    for a, b in cuts:
        if a - t > 0.05:
            out.append((t, a))
        t = b
    if span - t > 0.05:
        out.append((t, span))
    return out


def _mover(cuts: list):
    """Where a moment of the clip lands once the cuts are made."""
    def move(t):
        gone = 0.0
        for a, b in cuts:
            if t >= b:
                gone += b - a
            elif t > a:
                return a - gone
        return t - gone
    return move


def _cut_render(render, config):
    plain = render._render_in

    def render_in(work, src, out_dir, name, start, end, layout, fg_h, ass, face=None):
        cut = getattr(NOW, "cut", None)
        lay = render._filter(layout, fg_h, face)
        first = f"[0:v]fps={config.OUT_FPS},"
        if not cut or not lay.startswith(first):
            return plain(work, src, out_dir, name, start, end, layout, fg_h, ass, face=face)
        (work / f"{name}.ass").write_text(ass, encoding="utf-8")
        (work / "f").mkdir()
        for f in config.FONTS_DIR.glob("*.ttf"):
            shutil.copyfile(f, work / "f" / f.name)
        pieces, n = cut["pieces"], len(cut["pieces"])
        closer = f",crop=trunc(iw/{ZOOM}/2)*2:trunc(ih/{ZOOM}/2)*2,scale={cut['w']}:{cut['h']}" if cut["zoom"] else ""
        v = first + f"split={n}" + "".join(f"[s{i}]" for i in range(n)) + ";"
        a = f"[0:a:0]asplit={n}" + "".join(f"[r{i}]" for i in range(n)) + ";"
        for i, (x, y) in enumerate(pieces):
            v += f"[s{i}]trim=start={x:.3f}:end={y:.3f},setpts=PTS-STARTPTS{closer if i % 2 else ''},setsar=1[x{i}];"
            a += (f"[r{i}]atrim=start={x:.3f}:end={y:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,"
                  f"afade=t=out:st={max(0.0, y - x - 0.012):.3f}:d=0.012[y{i}];")
        fc = (v + a + "".join(f"[x{i}][y{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[cutv][cuta];"
              + "[cutv]" + lay[len(first):] + f"[v0]ass={name}.ass:fontsdir=f[v];[cuta]loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
        cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{cut['span']:.2f}", "-i", str(src), "-filter_complex", fc,
               "-map", "[v]", "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart",
               "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "21", "-preset", "veryfast", f"{name}.mp4"]
        p = subprocess.run(cmd, cwd=work, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=render.RENDER_SECONDS)
        if p.returncode != 0:
            raise RuntimeError(f"Render failed: {p.stderr[-1200:]}")
        cover_t = min(1.2, (end - start) / 2)
        render.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{cover_t:.2f}", "-i", f"{name}.mp4", "-frames:v", "1", "-q:v", "3", f"{name}.jpg"], cwd=work)
        for ext in ("mp4", "jpg", "ass"):
            shutil.move(str(work / f"{name}.{ext}"), str(out_dir / f"{name}.{ext}"))
        return {"file": f"{name}.mp4", "cover": f"{name}.jpg", "layout": layout}

    render._render_in = render_in


def _edit(render, config):
    draw = render.render_clip

    def render_clip(src, out_dir, name, clip, words, src_w, src_h):
        start, end = clip["start"], clip["end"]
        span = end - start
        beats = [(float(b["t"]), str(b["text"])) for b in clip.get("beats") or [] if isinstance(b, dict) and "t" in b]
        asked = clip.get("layout") == "follow" and src_w > src_h      # a video that is already tall has nothing to cut out
        cuts = []
        if clip.get("tighten"):
            try:
                cuts = quiet_parts(src, start, end, words, max(SHORTEST[0], 5.0, span * (1 - MOST)))
            except Exception:  # noqa: BLE001 - a clip without cuts is still a clip
                cuts = []
        way = None
        if asked:
            # The streamer is looked for in this clip. If they aren't in it, the clip is made the ordinary way
            # (the picture fills the screen) and marked as such, so the member is told and nothing is pretended.
            try:
                way = follow.plan(src, start, end, src_w, src_h, clip.get("streamer"))
            except Exception:  # noqa: BLE001 - a clip that doesn't follow is still a clip
                traceback.print_exc()
            if not way:
                clip = dict(clip, layout="crop")
        NOW.cut, NOW.follow = None, None
        pieces = None
        if cuts:
            move = _mover(cuts)
            pieces = _pieces(span, cuts)
            words = [dict(w, s=start + move(w["s"] - start), e=start + move(w["e"] - start)) for w in words if start - 0.05 <= w["s"] < end]
            beats = [(move(t), text) for t, text in beats]
            clip = dict(clip, end=round(start + sum(b - a for a, b in pieces), 2))
            # Moving in on every other piece needs an even picture and nothing cut out of it by position.
            zoom = not way and not (clip.get("layout") == "gameplay" and clip.get("facecam")) and src_w % 2 == 0 and src_h % 2 == 0
            NOW.cut = {"pieces": pieces, "span": span, "zoom": zoom, "w": src_w, "h": src_h}
        if way:
            NOW.follow = {"solo": way["solo"], "filter": follow.graph(way, config.OUT_FPS, pieces)}
        NOW.beats = beats
        try:
            out = draw(src, out_dir, name, clip, words, src_w, src_h)
        finally:
            NOW.cut, NOW.beats, NOW.follow = None, [], None
        out["cut"] = round(sum(b - a for a, b in cuts), 2)       # seconds taken out, for the record
        if asked:
            # Whether the streamer was followed in this clip, and where they sit (kept, so a change to the clip
            # later follows the same person).
            out["followed"], out["streamer"] = bool(way), way["spot"] if way else None
        return out

    render.render_clip = render_clip


def _follow(render):
    """The "follow" layout: where the heading and captions go, and the filter that draws it."""
    render.LAYOUTS["follow"] = "The streamer above the game, following their head"
    where, lay = render.geometry, render._filter

    def geometry(src_w, src_h, layout):
        way = getattr(NOW, "follow", None)
        if layout != "follow" or not way:
            return where(src_w, src_h, "crop" if layout == "follow" else layout)
        # Two panels: the heading sits on the line where they meet. One panel: the same places as a full picture.
        return "follow", render.H, (300 if way["solo"] else follow.TOP_H), 1380

    def _filter(layout, fg_h, facecam=None):
        way = getattr(NOW, "follow", None)
        if layout == "follow":
            return way["filter"] if way else lay("crop", fg_h, None)
        return lay(layout, fg_h, facecam)

    render.geometry, render._filter = geometry, _filter


def install(render, brain=None, roman=None, config=None):
    """Call once per job, before any clip is drawn."""
    if config is None:
        from studio import config
    _headings(render)
    _follow(render)
    _cut_render(render, config)
    _edit(render, config)
    if brain is not None:
        if roman is None:
            from studio import roman
        teach_beats(brain, roman)
