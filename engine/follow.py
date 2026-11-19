"""Follows the streamer.

A stream is a wide picture: the game, and somewhere in it the person playing. The "follow" layout cuts that
person out and shows them above the game, and the cut-out moves with their head, so they stay in the picture
when they lean, stand up or slide out of their chair.

- `survey` looks at a few frames spread through a piece of video and says where a face keeps turning up.
- `agree` compares pieces from different parts of the video. A streamer sits in the same place all video
  long; a face in the game does not. Only a face seen in the same place in two pieces is taken as the streamer.
- `plan` follows that face through one clip, five times a second, and works out a calm camera path for it.
  It returns None when the face isn't there: the clip is then made the ordinary way, and says so.
- `graph` turns the plan into the ffmpeg filter that draws the clip.

A video that is one big camera picture (someone talking, no game) gets one panel that follows them instead of
two panels showing the same person twice.

Faces are found with YuNet (face/yunet.onnx, MIT licence, from github.com/opencv/opencv_zoo) through OpenCV.
"""
import subprocess
from pathlib import Path

import numpy as np

MODEL = Path(__file__).resolve().parent / "face" / "yunet.onnx"
OUT_W, OUT_H = 1080, 1920
TOP_H = 640              # the streamer's panel; the game gets the 1280 below it
RATE = 5.0               # how often the face is looked for while following, in times a second
SURE = 0.7               # how sure the detector must be that something is a face
SMALLEST = 14            # a face smaller than this many pixels (as looked at) is not trusted
BIG_FACE = 0.16          # a face this tall (as a part of the frame's height) and in the upper half of the picture
                         # means the camera is the whole picture; a big streamer over a game sits low, cut off by the edge
HEAD_ROOM = 2.5          # the streamer's panel is this many faces tall
EDGE = 12                # how sharp a lasting line must be (out of 255) to be the side of a webcam box
MOST_ZOOM = 3.2          # the cut-out is never blown up more than this
BAND = 0.05              # the camera stays put until the head has moved this far across the panel


def _detector(w: int, h: int):
    import cv2
    return cv2.FaceDetectorYN.create(str(MODEL), "", (w, h), SURE, 0.3, 50)


def _even(v) -> int:
    return max(2, int(round(v / 2)) * 2)


def _read(cmd, w: int, h: int, most: int = 100000):
    """The frames ffmpeg writes, one at a time."""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = w * h * 3
    try:
        for _ in range(most):
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        if p.poll() is None:
            p.kill()
        p.wait()


def _faces(det, frame) -> list:
    """(centre x, centre y, width, height) of every face in the frame, the surest first."""
    _, found = det.detect(frame)
    if found is None:
        return []
    out = [(float(f[0] + f[2] / 2), float(f[1] + f[3] / 2), float(f[2]), float(f[3]), float(f[14])) for f in found
           if f[14] >= SURE and f[3] >= SMALLEST and f[2] > 0]
    return sorted(out, key=lambda f: -f[4])


# ----------------------------------------------------------------------------------------- where the face is
def survey(src, src_w: int, src_h: int, start: float = 0.0, span: float = 40.0) -> list:
    """Where faces keep turning up in this stretch of video.

    Returns the places, the most constant first: {"spot": [cx, cy, w, h] as parts of the frame, "share": the
    part of the frames it was seen in, "n": how many frames, "spread": how far it wanders, in faces}."""
    aw = _even(min(960, src_w))
    ah = _even(aw * src_h / src_w)
    seek = ["-ss", f"{max(0.0, start):.2f}", "-t", f"{span:.2f}", "-i", str(src), "-an"]
    out = ["-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    scale = f"scale={aw}:{ah}:flags=fast_bilinear"
    det = _detector(aw, ah)
    # The frames a video can be opened at (one every few seconds) cost almost nothing to read. A piece with too
    # few of them is read through instead, a frame every second or so.
    seen = [_faces(det, f) for f in _read(["ffmpeg", "-v", "error", "-skip_frame", "nokey", *seek, "-fps_mode", "passthrough", "-vf", scale, *out], aw, ah, 48)]
    if len(seen) < 8:
        rate = max(0.25, min(1.0, 14 / max(1.0, span)))
        seen = [_faces(det, f) for f in _read(["ffmpeg", "-v", "error", "-skip_frame", "noref", *seek, "-vf", f"fps={rate:.3f},{scale}", *out], aw, ah, 48)]
    if len(seen) < 4:
        return []
    groups = []         # each: {"at": [frame numbers], "f": [faces]}
    for i, faces in enumerate(seen):
        for f in faces:
            best, near = None, 1e9
            for g in groups:
                if g["at"][-1] == i:
                    continue            # one face a frame for each place
                m = np.median(np.array(g["f"]), axis=0)
                d = float(np.hypot(f[0] - m[0], f[1] - m[1]))
                if d < 0.8 * max(f[3], m[3]) and 0.55 < f[3] / m[3] < 1.8 and d < near:
                    best, near = g, d
            if best is None:
                groups.append({"at": [i], "f": [f]})
            else:
                best["at"].append(i)
                best["f"].append(f)
    found = []
    for g in groups:
        a = np.array(g["f"])
        m = np.median(a, axis=0)
        if len(a) < 4:
            continue
        spread = float(np.median(np.hypot(a[:, 0] - m[0], a[:, 1] - m[1])) / max(1.0, m[3]))
        found.append({"spot": [round(float(m[0]) / aw, 4), round(float(m[1]) / ah, 4), round(float(m[2]) / aw, 4), round(float(m[3]) / ah, 4)],
                      "share": round(len(a) / len(seen), 3), "n": len(a), "spread": round(spread, 3)})
    return sorted(found, key=lambda c: -c["share"])


def _same(a, b, aspect: float) -> bool:
    """Two places (as parts of the frame) that are the same seat: close together, and a face of about one size."""
    d = float(np.hypot((a[0] - b[0]) * aspect, a[1] - b[1]))
    return d < 0.75 * max(a[3], b[3]) and 0.6 < a[3] / b[3] < 1.67


def agree(surveys: list, aspect: float):
    """The streamer's place: a face that is there a good part of the time in two pieces of the video, in the same
    place both times. Returns [cx, cy, w, h] as parts of the frame, or None."""
    best, score = None, 0.0
    for i, one in enumerate(surveys):
        for other in surveys[i + 1:]:
            for a in one:
                for b in other:
                    if a["share"] >= 0.4 and b["share"] >= 0.4 and _same(a["spot"], b["spot"], aspect) and a["share"] + b["share"] > score:
                        best, score = [round(float(x + y) / 2, 4) for x, y in zip(a["spot"], b["spot"])], a["share"] + b["share"]
    return best


def alone(found: list):
    """With nothing to compare against (one clip, looked at by itself), a face is only taken as the streamer when
    it is there most of the time and stays where it is. A face in the game comes and goes with every cut."""
    for c in found:
        if c["share"] >= 0.6 and c["n"] >= 6 and c["spread"] <= 0.6:
            return c["spot"]
    return None


# -------------------------------------------------------------------------------------------- one clip
def _track(src, start: float, span: float, src_w: int, src_h: int, spot):
    """The face near `spot`, looked for RATE times a second: (cx, cy, w, h) in the source's pixels, or None for
    each moment it wasn't seen. With it, the webcam's box round that face (see _box), or None."""
    cx, cy, fw, fh = spot[0] * src_w, spot[1] * src_h, spot[2] * src_w, spot[3] * src_h
    # A good part of the picture round the streamer is read, wide enough to hold a whole webcam box with them
    # anywhere in it, at a size where their face is about 56 pixels tall.
    x0, y0 = int(max(0, cx - 8 * fw)) // 2 * 2, int(max(0, cy - 5 * fh)) // 2 * 2
    rw = min(_even(min(src_w, cx + 8 * fw) - x0 - 1), (src_w - x0) // 2 * 2)
    rh = min(_even(min(src_h, cy + 5 * fh) - y0 - 1), (src_h - y0) // 2 * 2)
    s = min(1.0, 56 / max(1.0, fh), 800 / rw, 800 / rh)
    dw, dh = _even(rw * s), _even(rh * s)
    # The face is looked for in a small window that moves with it, which is quick. Only when it has been gone
    # for two seconds is the whole of that part searched.
    ww, wh = min(dw, _even(6.4 * fw * s)), min(dh, _even(5.6 * fh * s))
    near, wide = _detector(ww, wh), None
    cmd = ["ffmpeg", "-v", "error", "-skip_frame", "noref", "-ss", f"{max(0.0, start):.2f}", "-t", f"{span:.2f}", "-i", str(src), "-an",
           "-vf", f"crop={rw}:{rh}:{x0}:{y0},fps={RATE:g},scale={dw}:{dh}:flags=fast_bilinear", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
    out, last, size, missed, grey = [], (cx, cy), fh, 0, []
    for i, frame in enumerate(_read(cmd, dw, dh, int(span * RATE) + 2)):
        if i % 2 == 0 and len(grey) < 200:
            grey.append(frame[:, :, 1].copy())      # the green of the picture is close enough to its brightness
        lost = missed > 2 * RATE
        if lost:
            wide = wide or _detector(dw, dh)
            ox, oy, faces = 0, 0, _faces(wide, frame)
        else:
            ox = int(min(max(0, (last[0] - x0) * s - ww / 2), dw - ww))
            oy = int(min(max(0, (last[1] - y0) * s - wh / 2), dh - wh))
            faces = _faces(near, np.ascontiguousarray(frame[oy:oy + wh, ox:ox + ww]))
        hit = None
        for f in faces:
            px, py, pw, ph = x0 + (ox + f[0]) / s, y0 + (oy + f[1]) / s, f[2] / s, f[3] / s
            if not 0.5 < ph / size < 2.0:
                continue
            d = float(np.hypot(px - last[0], py - last[1]))
            if (d < 1.6 * max(ph, size) or lost) and (hit is None or d < hit[4]):
                hit = (px, py, pw, ph, d)
        if hit:
            out.append(hit[:4])
            last, size, missed = hit[:2], 0.8 * size + 0.2 * hit[3], 0
        else:
            out.append(None)
            missed += 1
    box = None
    hits = [h for h in out if h]
    if len(hits) >= 5:
        try:
            m = np.median(np.array(hits), axis=0)
            face = ((m[0] - x0) * s, (m[1] - y0) * s, m[2] * s, m[3] * s)
            found = _box(grey, face, (x0 == 0, y0 == 0, x0 + rw >= src_w - 1, y0 + rh >= src_h - 1))
            if found:
                l, t, r, b = found
                box = [x0 + l / s, y0 + t / s, x0 + r / s, y0 + b / s]
        except Exception:  # noqa: BLE001 - without a box the face alone says where to cut
            box = None
    return out, box


def _runs(ok, lo: int, hi: int) -> list:
    """The middle of each unbroken run of True in ok[lo:hi]."""
    out, i = [], max(0, lo)
    hi = min(hi, len(ok))
    while i < hi:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j + 1 < hi and ok[j + 1]:
            j += 1
        out.append((i + j) // 2)
        i = j + 1
    return out


def _box(grey: list, face, flush):
    """The webcam's own box round the streamer's face: (left, top, right, bottom) in the small picture's pixels,
    or None when it has none (a streamer cut out of their background, or one who is the whole picture).

    The edge of a webcam box is a straight line that never moves while the game beside it does. So the lines
    that last through the whole clip are found, and the smallest box made of them that holds the head is taken.
    Something square behind the streamer (a poster, a window) is not mistaken for it: their own body covers its
    lower edge. `flush` says which sides of the small picture are the frame's own edge, which can be a side too."""
    if len(grey) < 8:
        return None
    g = np.stack(grey).astype(np.int16)
    _, h, w = g.shape
    fx, fy, fw, fh = face
    vx = np.median(np.abs(np.diff(g, axis=2)), axis=0) > EDGE       # between column x and x + 1
    hy = np.median(np.abs(np.diff(g, axis=1)), axis=0) > EDGE       # between row y and y + 1
    v, z = vx.copy(), hy.copy()                                     # a line may sit a pixel to either side
    v[:, 1:] |= vx[:, :-1]
    v[:, :-1] |= vx[:, 1:]
    z[1:] |= hy[:-1]
    z[:-1] |= hy[1:]
    cv = np.vstack([np.zeros((1, w - 1)), np.cumsum(v, axis=0)])
    cz = np.hstack([np.zeros((h - 1, 1)), np.cumsum(z, axis=1)])

    def upright(pos, a, b):         # how much of the line at `pos`, from row a to row b, is really there
        return 1.0 if pos in (0, w) else float(cv[b, pos - 1] - cv[a, pos - 1]) / max(1, b - a)

    def level(pos, a, b):
        return 1.0 if pos in (0, h) else float(cz[pos - 1, b] - cz[pos - 1, a]) / max(1, b - a)

    ya, yb = int(max(0, fy - 0.6 * fh)), int(min(h, fy + 0.6 * fh))
    xa, xb = int(max(0, fx - 0.6 * fw)), int(min(w, fx + 0.6 * fw))
    if yb - ya < 4 or xb - xa < 4:
        return None
    by_face_x = (cv[yb] - cv[ya]) / (yb - ya) >= 0.8                # lines that run past the face, top to bottom
    by_face_y = (cz[:, xb] - cz[:, xa]) / (xb - xa) >= 0.8
    lefts = [q + 1 for q in _runs(by_face_x, 0, int(fx - 0.7 * fw))][-6:] + ([0] if flush[0] else [])
    rights = [q + 1 for q in _runs(by_face_x, int(fx + 0.7 * fw), w - 1)][:6] + ([w] if flush[2] else [])
    tops = [q + 1 for q in _runs(by_face_y, 0, int(fy - 0.8 * fh))][-6:] + ([0] if flush[1] else [])
    bottoms = [q + 1 for q in _runs(by_face_y, int(fy + 0.8 * fh), h - 1)][:6] + ([h] if flush[3] else [])
    best, area = None, 1e18
    for l in lefts:
        for r in rights:
            for t in tops:
                for b in bottoms:
                    real = (l != 0) + (r != w) + (t != 0) + (b != h)
                    if not real or not 0.55 <= (r - l) / max(1, b - t) <= 3.2:
                        continue
                    sure = min(upright(l, t, b), upright(r, t, b), level(t, l, r), level(b, l, r))
                    if sure >= (0.75 if real > 1 else 0.9) and (r - l) * (b - t) < area:
                        best, area = (l, t, r, b), (r - l) * (b - t)
    return best


def _smooth(v, seconds: float):
    sigma = seconds * RATE
    k = int(3 * sigma) + 1
    kernel = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    return np.convolve(np.pad(v, k, mode="edge"), kernel / kernel.sum(), mode="valid")


def _camera(v, band: float):
    """A camera that follows `v` the way a person holding it would: it lets small movements go, and moves when
    the head has gone further than `band` from where the camera points."""
    v = np.asarray(v, dtype=np.float64)
    if len(v) >= 5:         # one wrong reading (another face, a hand) doesn't move the camera
        p = np.pad(v, 2, mode="edge")
        v = np.median(np.stack([p[i:i + len(v)] for i in range(5)]), axis=0)
    v = _smooth(v, 0.45)
    cam = np.empty_like(v)
    at = float(np.median(v[: max(1, int(RATE))]))
    for i, target in enumerate(v):
        if target - at > band:
            at = target - band
        elif at - target > band:
            at = target + band
        cam[i] = at
    return _smooth(cam, 0.35)


def plan(src, start: float, end: float, src_w: int, src_h: int, spot=None):
    """How to follow the streamer through this clip, or None when they aren't in it.

    `spot` is where the streamer sits, if the video as a whole has been looked at ([cx, cy, w, h] as parts of
    the frame). Without one the clip is looked at by itself, and a face is only believed when it is there most
    of the time."""
    if not MODEL.is_file() or src_h >= src_w or end - start < 2:
        return None
    span = end - start
    seen, box, least = [], None, 0.2
    if spot:
        seen, box = _track(src, start, span, src_w, src_h, spot)
    if not spot or sum(1 for s in seen if s) < max(5, least * len(seen)):
        # Not at their usual place in this clip (or no usual place is known): look at the whole picture.
        spot, least = alone(survey(src, src_w, src_h, start, span)), 0.45
        if not spot:
            return None
        seen, box = _track(src, start, span, src_w, src_h, spot)
    hits = [i for i, s in enumerate(seen) if s]
    if len(hits) < max(5, least * len(seen)):
        return None
    a = np.array([seen[i] for i in hits])
    idx = np.arange(len(seen))
    xs, ys = np.interp(idx, hits, a[:, 0]), np.interp(idx, hits, a[:, 1])
    fw, fh = float(np.median(a[:, 2])), float(np.median(a[:, 3]))
    mx, my = float(np.median(a[:, 0])), float(np.median(a[:, 1]))
    # Inside the webcam's box, when it has one, and never outside the picture.
    area = [0.0, 0.0, float(src_w), float(src_h)]
    if box:
        inset = 3.0     # the line itself, and the sliver of game beside it, stay out
        area = [box[0] + inset if box[0] > 1 else 0.0, box[1] + inset if box[1] > 1 else 0.0,
                box[2] - inset if box[2] < src_w - 1 else float(src_w), box[3] - inset if box[3] < src_h - 1 else float(src_h)]
        box = [area[0], area[1], area[2] - area[0], area[3] - area[1]]
    solo = fh >= BIG_FACE * src_h and my <= 0.52 * src_h
    if solo:
        # The camera is the whole picture: one tall panel, as high as the video, that follows them sideways.
        pw, ph = OUT_W, OUT_H
        ch = src_h // 2 * 2
        cw = min(src_w // 2 * 2, _even(ch * pw / ph))
        if area[2] - area[0] < cw:
            area[0], area[2] = 0.0, float(src_w)
        area[1], area[3] = 0.0, float(src_h)
        lift = 0.0
    else:
        pw, ph = OUT_W, TOP_H
        ch = HEAD_ROOM * fh
        if box is None:
            ch = max(ch, ph / MOST_ZOOM)        # a tiny face is not blown up into a blur
        cw = ch * pw / ph
        fit = min(1.0, (area[2] - area[0]) / cw, (area[3] - area[1]) / ch)
        cw, ch = _even(cw * fit), _even(ch * fit)
        cw, ch = min(cw, src_w // 2 * 2), min(ch, src_h // 2 * 2)
        lift = 0.06 * ch                        # the face sits a little above the middle, with room for the shoulders
    camx = np.clip(_camera(xs, BAND * cw) - cw / 2, area[0], max(area[0], area[2] - cw))
    camy = np.clip(_camera(ys + lift, BAND * ch) - ch / 2, area[1], max(area[1], area[3] - ch))
    if solo:
        camy[:] = 0.0
    game = None
    if not solo:
        # The game's panel is the middle of the picture. If the streamer's corner would show in it a second
        # time, it is moved aside, as long as the middle of the game stays well inside.
        gh = src_h // 2 * 2
        gw = min(src_w // 2 * 2, _even(gh * OUT_W / (OUT_H - TOP_H)))
        gx = (src_w - gw) / 2
        ax0, ax1 = (box[0], box[0] + box[2]) if box else (float(camx.min()), float(camx.max()) + cw)
        if ax1 > gx and ax0 < gx + gw:
            right, left = ax1 - gx, gx + gw - ax0
            room = 0.2 * gw
            if right <= left and gx + min(right, room) + gw <= src_w:
                gx += min(right, room)
            elif left < right and gx - min(left, room) >= 0:
                gx -= min(left, room)
        game = [int(gx) // 2 * 2, 0, gw, gh]
    return {"solo": solo, "panel": [pw, ph], "crop": [int(cw), int(ch)], "cam": [[float(x), float(y)] for x, y in zip(camx, camy)],
            "game": game, "share": round(len(hits) / len(seen), 3), "box": [round(v) for v in box] if box else None,
            "spot": [round(mx / src_w, 4), round(my / src_h, 4), round(fw / src_w, 4), round(fh / src_h, 4)]}


# ----------------------------------------------------------------------------------------- drawing it
def _keys(times, values, tol: float) -> list:
    """The few points of a path that matter: with straight lines between them it is never more than `tol` off."""
    keep = {0, len(times) - 1}
    stack = [(0, len(times) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        t = np.asarray(times[a:b + 1])
        line = values[a] + (values[b] - values[a]) * (t - times[a]) / max(1e-9, times[b] - times[a])
        off = np.abs(np.asarray(values[a:b + 1]) - line)
        i = int(off.argmax())
        if off[i] > tol:
            keep.add(a + i)
            stack += [(a, a + i), (a + i, b)]
    return sorted(keep)


def _expr(times, values, lo: float, hi: float) -> str:
    """A path as something ffmpeg can work out for every frame: where it starts, plus each stretch it moves in."""
    values = [min(hi, max(lo, v)) for v in values]
    keys = _keys(times, values, 0.75)
    out = f"{values[0]:.1f}"
    for a, b in zip(keys, keys[1:]):
        d, dt = values[b] - values[a], times[b] - times[a]
        if abs(d) >= 0.5 and dt > 0:
            out += f"{d / dt:+.3f}*clip(t-{times[a]:.3f},0,{dt:.3f})"
    return out


def graph(p: dict, fps, pieces=None) -> str:
    """The ffmpeg filter that draws the clip, from `[0:v]` to `[v0]`. `pieces` are the parts of the clip that are
    kept when its quiet stretches are cut out, as (from, to) in seconds: the path is cut the same way."""
    cw, ch = p["crop"]
    pw, ph = p["panel"]
    cam = np.array(p["cam"])
    n = len(cam)
    step = 1.0 / RATE
    if not pieces:
        pieces = [(0.0, (n - 1) * step)]
    times, xs, ys, at = [], [], [], 0.0
    grid = np.arange(n) * step
    for a, b in pieces:
        inside = [a] + [float(t) for t in grid if a < t < b] + [b]
        for t in inside:
            # Where one piece ends and the next begins the camera may jump: that is a cut, and looks like one.
            times.append(at + (t - a) + (0.001 if times and at + (t - a) <= times[-1] else 0.0))
            xs.append(float(np.interp(t, grid, cam[:, 0])))
            ys.append(float(np.interp(t, grid, cam[:, 1])))
        at += b - a
    # The part of the picture the camera ever looks at is cut out and brought to the clip's size once; the
    # camera then moves inside that, in steps too small to see.
    rx, ry = int(min(xs)) // 2 * 2, int(min(ys)) // 2 * 2
    rw, rh = _even(max(xs) + cw - rx + 1), _even(max(ys) + ch - ry + 1)
    f = pw / cw
    sw, sh = max(pw, _even(rw * f)), max(ph, _even(rh * f))
    x = _expr(times, [(v - rx) * sw / rw for v in xs], 0, sw - pw)
    y = _expr(times, [(v - ry) * sh / rh for v in ys], 0, sh - ph)
    follow = f"crop={rw}:{rh}:{rx}:{ry},scale={sw}:{sh},crop=w={pw}:h={ph}:x='{x}':y='{y}',setsar=1"
    if p["solo"]:
        return f"[0:v]fps={fps},{follow}[v0];"
    gx, gy, gw, gh = p["game"]
    return (f"[0:v]fps={fps},split=2[fg][fs];"
            f"[fg]crop={gw}:{gh}:{gx}:{gy},scale={OUT_W}:{OUT_H - TOP_H},setsar=1[game];"
            f"[fs]{follow}[face];"
            f"[face][game]vstack=inputs=2[v0];")
