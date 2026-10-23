"""Follow a Veo camera through a clip, starting from coach-marked reference frames.

The Veo camera is fixed on its pole; "following" is a digital pan and zoom of a
fixed wide view. So every frame is the same scene seen from the same point, and
any two frames are related by a homography. That holds for the background
(trees, buildings) as well as the pitch, which gives plenty of features to match.

For each sampled moment we match image features against the nearest reference
frame and fit the homography between the two pictures with RANSAC (moving
players are rejected as outliers). Chaining that with the reference frame's
picture -> pitch mapping gives where the camera is looking. If a moment has
panned too far from the reference to match well, we chain from its neighbour
instead.

Usage:
    python follow.py VIDEO FILM_JSON [-o OUT_JSON]

FILM_JSON is a film file saved from the Film tab, with at least one reference
frame of 4+ points. The result is written back with a "camera" entry for every
sample, which the Film tab draws as pitch lines over the video.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass

import cv2
import numpy as np

# Work on half-size frames: plenty of detail for matching, four times faster.
SCALE = 0.5
# Matches needed to trust a direct match against a reference frame.
MIN_DIRECT = 60
# Matches needed to trust a frame-to-frame link when chaining.
MIN_CHAIN = 30
# RANSAC tolerance in full-size video pixels.
RANSAC_PX = 3.0


@dataclass
class Features:
    pts: np.ndarray  # keypoint positions in full-size video pixels
    desc: np.ndarray


def make_mask(w: int, h: int) -> np.ndarray:
    """Ignore the Veo logo burned into the bottom-right: it never moves, which would fight the pan."""
    mask = np.full((h, w), 255, np.uint8)
    mask[int(h * 0.82) :, int(w * 0.82) :] = 0
    return mask


def features(sift, frame: np.ndarray, mask: np.ndarray) -> Features:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
    kps, desc = sift.detectAndCompute(small, mask)
    pts = np.float32([k.pt for k in kps]) / SCALE if kps else np.zeros((0, 2), np.float32)
    return Features(pts, desc if desc is not None else np.zeros((0, 128), np.float32))


def on_pitch(f: Features, H: np.ndarray, ground: tuple[float, float], margin: float = 8.0) -> Features:
    """Keep only features that land on the pitch (plus a margin).

    The grass is a flat plane, so it follows a homography exactly however Veo
    builds its picture; trees and buildings don't, quite, and would pull the fit.
    """
    if len(f.pts) == 0:
        return f
    p = cv2.perspectiveTransform(f.pts.reshape(-1, 1, 2).astype(np.float64), H).reshape(-1, 2)
    w = H[2, 0] * f.pts[:, 0] + H[2, 1] * f.pts[:, 1] + H[2, 2]
    # In front of the camera means w has the same sign as at `ground`, the bottom middle of the
    # picture (always grass in sideline footage).
    w_ground = H[2, 0] * ground[0] + H[2, 1] * ground[1] + H[2, 2]
    keep = (np.sign(w) == np.sign(w_ground)) & (p[:, 0] > -10 - margin) & (p[:, 0] < 110 + margin)
    keep &= (p[:, 1] > -margin) & (p[:, 1] < 70 + margin)
    return Features(f.pts[keep], f.desc[keep])


def match(matcher, a: Features, b: Features) -> tuple[np.ndarray | None, int]:
    """Homography taking picture `a` onto picture `b`, and how many matches support it."""
    if len(a.desc) < 8 or len(b.desc) < 8:
        return None, 0
    pairs = matcher.knnMatch(a.desc, b.desc, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 8:
        return None, 0
    src = a.pts[[m.queryIdx for m in good]]
    dst = b.pts[[m.trainIdx for m in good]]
    H, inliers = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_PX)
    if H is None:
        return None, 0
    return H, int(inliers.sum())


def read_frame_at(path: str, t: float) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        sys.exit(f"Couldn't read the frame at {t:.2f}s")
    return frame


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("film")
    ap.add_argument("-o", "--out", help="where to write the result (default: overwrite FILM_JSON)")
    args = ap.parse_args()

    with open(args.film, encoding="utf-8") as f:
        film = json.load(f)
    refs = [k for k in film.get("keyframes", []) if len(k["points"]) >= 4]
    if not refs:
        sys.exit("The film file has no reference frame with 4+ points. Mark one in the Film tab first.")

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"Couldn't open {args.video}")
    vfps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = film.get("fps", 10)
    n = int(total / vfps * fps)
    wanted = {round(i / fps * vfps): i for i in range(n)}

    ground = (w / 2, h * 0.95)
    sift = cv2.SIFT_create(nfeatures=3000)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    mask = cv2.resize(make_mask(w, h), None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_NEAREST)

    print(f"Reading {n} moments from {total} frames ({vfps:.2f} fps)…", flush=True)
    feats: list[Features | None] = [None] * n
    frame_no = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        i = wanted.get(frame_no)
        if i is not None:
            feats[i] = features(sift, frame, mask)
        frame_no += 1
    cap.release()
    # The container's frame count can overstate the video; keep only moments actually read.
    while feats and feats[-1] is None:
        feats.pop()
    n = len(feats)

    # Each reference frame: its picture's features, and picture -> pitch from the coach's points.
    references = []
    for k in refs:
        img = np.float32([[p["img"]["x"], p["img"]["y"]] for p in k["points"]])
        pitch = np.float32([[p["pitch"]["x"], p["pitch"]["y"]] for p in k["points"]])
        H_pitch, _ = cv2.findHomography(img, pitch, 0)
        ref_feats = on_pitch(features(sift, read_frame_at(args.video, k["t"]), mask), H_pitch, ground)
        print(f"Reference frame {k['t']:.2f}s: {len(ref_feats.pts)} features on the pitch", flush=True)
        references.append((k["t"], ref_feats, H_pitch))

    camera: list[dict] = [{"t": round(i / fps, 4), "h": None} for i in range(n)]
    homs: list[np.ndarray | None] = [None] * n
    direct = chained = lost = 0

    # Each moment belongs to its nearest reference frame; walk outwards from each one so a
    # moment that can't match its reference directly can chain from the neighbour just done.
    owner = [min(range(len(references)), key=lambda r: abs(references[r][0] - i / fps)) for i in range(n)]
    for r, (t_ref, ref_feats, H_ref) in enumerate(references):
        start = min(n - 1, max(0, round(t_ref * fps)))
        for step in (1, -1):
            i = start if step == 1 else start - 1
            while 0 <= i < n and owner[i] == r:
                f = feats[i]
                H = None
                if f is not None:
                    F, q = match(matcher, f, ref_feats)
                    if F is not None and q >= MIN_DIRECT:
                        H = H_ref @ F
                        direct += 1
                    else:
                        prev = i - step
                        if 0 <= prev < n and homs[prev] is not None and feats[prev] is not None:
                            F, q = match(matcher, f, on_pitch(feats[prev], homs[prev], ground))
                            if F is not None and q >= MIN_CHAIN:
                                H = homs[prev] @ F
                                chained += 1
                if H is None:
                    lost += 1
                    camera[i]["q"] = 0
                else:
                    H = H / H[2, 2]
                    homs[i] = H
                    camera[i] = {"t": round(i / fps, 4), "h": [round(float(v), 9) for v in H.ravel()], "q": q}
                i += step

    film["camera"] = camera
    out = args.out or args.film
    with open(out, "w", encoding="utf-8") as f:
        json.dump(film, f)
    print(f"Done: {direct} matched to a reference frame, {chained} chained, {lost} lost. Wrote {out}")


if __name__ == "__main__":
    main()
