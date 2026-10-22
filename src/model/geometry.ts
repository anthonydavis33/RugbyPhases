import type { Vec } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function pathLength(pts: Vec[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/** The point `s` metres along a polyline. */
export function pointAlong(pts: Vec[], s: number): Vec {
  if (pts.length === 1 || s <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (s <= d) return d === 0 ? pts[i] : lerp(pts[i - 1], pts[i], s / d);
    s -= d;
  }
  return pts[pts.length - 1];
}

function perpDist(p: Vec, a: Vec, b: Vec) {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}

/** Ramer–Douglas–Peucker: drop points that sit within `tol` of the line. */
export function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), tol);
  return [...left.slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** Chaikin corner cutting, keeping both endpoints. */
export function chaikin(pts: Vec[], iterations = 2): Vec[] {
  let out = pts;
  for (let k = 0; k < iterations && out.length > 2; k++) {
    const next: Vec[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      next.push(lerp(out[i], out[i + 1], 0.25), lerp(out[i], out[i + 1], 0.75));
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Turn a wobbly finger-drawn stroke into a clean running line. */
export const smoothStroke = (raw: Vec[]) => chaikin(simplify(raw, 0.6), 2);

export const toPath = (pts: Vec[]) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
