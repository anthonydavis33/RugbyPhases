import type { Timeline } from './engine';
import { clamp } from './geometry';
import type { Vec } from './types';

/** A rectangle of the pitch, in pitch metres. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export const FULL: Box = { x0: -13, x1: 113, y0: -5, y1: 75 };

/** A rectangle in view space: SVG user units after the scene's rotation (metres). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel size of the pitch area on screen. */
export interface Size {
  w: number;
  h: number;
}

/**
 * What the coach is looking at: the view-space point at the top-left of the
 * pitch area, and pixels per metre. Anchoring the top-left (not the centre)
 * means the pitch area growing or shrinking only reveals or crops the bottom
 * and right; nothing already on screen moves or rescales.
 */
export interface Camera {
  left: number;
  top: number;
  scale: number;
}

/** The area every player covers across the whole play, padded. */
export function fitBox(tl: Timeline): Box {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (p: Vec) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  };
  for (const ph of tl.phases) {
    Object.values(ph.startPos).forEach(add);
    for (const r of Object.values(ph.runs)) r.path.forEach(add);
  }
  if (x0 === Infinity) return FULL;
  const grow = (lo: number, hi: number, min: number, pad: number): [number, number] => {
    const extra = Math.max(0, min - (hi - lo)) / 2 + pad;
    return [lo - extra, hi + extra];
  };
  [x0, x1] = grow(x0, x1, 36, 6);
  [y0, y1] = grow(y0, y1, 26, 5);
  return {
    x0: Math.max(FULL.x0, x0),
    x1: Math.min(FULL.x1, x1),
    y0: Math.max(FULL.y0, y0),
    y1: Math.min(FULL.y1, y1),
  };
}

/**
 * A pitch box in view space. When vertical, the scene is rotated -90° so the
 * attack (towards x = 100) runs up the screen: view (x, y) = pitch (y, -x).
 */
export function viewBoxOf(box: Box, vertical: boolean): ViewRect {
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  return vertical ? { x: box.y0, y: -box.x1, w: H, h: W } : { x: box.x0, y: box.y0, w: W, h: H };
}

/** The camera that shows `box` as large as possible, centred, in a pitch area of `size`. */
export function fitCamera(box: Box, vertical: boolean, size: Size): Camera {
  const vb = viewBoxOf(box, vertical);
  const scale = Math.min(size.w / vb.w, size.h / vb.h);
  return { scale, left: vb.x - (size.w / scale - vb.w) / 2, top: vb.y - (size.h / scale - vb.h) / 2 };
}

/** The part of view space the camera shows. */
export const cameraRect = (c: Camera, size: Size): ViewRect => ({
  x: c.left,
  y: c.top,
  w: size.w / c.scale,
  h: size.h / c.scale,
});

/** Keep at least a quarter of the screen's worth of pitch in view, so it can't be lost. */
function clampCamera(c: Camera, size: Size, vertical: boolean): Camera {
  const f = viewBoxOf(FULL, vertical);
  const w = size.w / c.scale;
  const h = size.h / c.scale;
  const m = Math.min(w, h) * 0.25;
  return { ...c, left: clamp(c.left, f.x - w + m, f.x + f.w - m), top: clamp(c.top, f.y - h + m, f.y + f.h - m) };
}

/** Zoom by `factor`, keeping the point under `at` (pixels within the pitch area) still. */
export function zoomCamera(c: Camera, factor: number, at: Vec, size: Size, vertical: boolean): Camera {
  const full = fitCamera(FULL, vertical, size).scale;
  const scale = clamp(c.scale * factor, full * 0.6, full * 10);
  const vx = c.left + at.x / c.scale;
  const vy = c.top + at.y / c.scale;
  return clampCamera({ scale, left: vx - at.x / scale, top: vy - at.y / scale }, size, vertical);
}

/** Move the view with a drag of (dx, dy) pixels. */
export const panCamera = (c: Camera, dx: number, dy: number, size: Size, vertical: boolean) =>
  clampCamera({ ...c, left: c.left - dx / c.scale, top: c.top - dy / c.scale }, size, vertical);

/** The pitch point at the centre of the screen. */
export function cameraCentre(c: Camera, size: Size, vertical: boolean): Vec {
  const vx = c.left + size.w / c.scale / 2;
  const vy = c.top + size.h / c.scale / 2;
  return vertical ? { x: -vy, y: vx } : { x: vx, y: vy };
}
