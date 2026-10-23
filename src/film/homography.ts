import type { Vec } from '../model/types';
import type { Homography } from './types';

/** Solve A·x = b by Gaussian elimination with partial pivoting. Null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const mul = (a: Homography, b: Homography): Homography => {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};

/** Similarity transform moving points to their centroid with mean distance √2 (Hartley normalisation). */
function normaliser(pts: Vec[]): Homography {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
  const k = Math.SQRT2 / d;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/**
 * The homography mapping each `src` point onto its `dst` point (least squares
 * when there are more than 4). Null if the points are degenerate, e.g. three
 * in a line.
 */
export function solveHomography(src: Vec[], dst: Vec[]): Homography | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const Ts = normaliser(src);
  const Td = normaliser(dst);
  const s = src.map((p) => applyRaw(Ts, p));
  const d = dst.map((p) => applyRaw(Td, p));
  // Normal equations for the 8 unknowns (h33 = 1).
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * v;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  s.forEach((p, i) => {
    const q = d[i];
    add([p.x, p.y, 1, 0, 0, 0, -p.x * q.x, -p.y * q.x], q.x);
    add([0, 0, 0, p.x, p.y, 1, -p.x * q.y, -p.y * q.y], q.y);
  });
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  const H = mul(invertHomography(Td)!, mul(Hn, Ts));
  // Scale so the marked points are in front of the camera (the horizon may cut through the picture).
  const centroid = { x: src.reduce((a, p) => a + p.x, 0) / src.length, y: src.reduce((a, p) => a + p.y, 0) / src.length };
  return orientTowards(
    H.map((v) => v / Math.abs(H[8])),
    centroid,
  );
}

function applyRaw(h: Homography, p: Vec): Vec {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/**
 * Map a point. Returns null when it lands behind the camera (w ≤ 0), which
 * happens when projecting far pitch points that are above the horizon.
 */
export function applyHomography(h: Homography, p: Vec): Vec | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (w <= 1e-9) return null;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * j - c * i), b * f - c * e, B, a * j - c * g, -(a * f - c * d), C, -(a * i - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

/**
 * Make an inverse-mapped homography keep points in front of the camera
 * positive. A homography is only defined up to scale, and the sign matters
 * for applyHomography's behind-the-camera test.
 */
export function orientTowards(h: Homography, inFront: Vec): Homography {
  const w = h[6] * inFront.x + h[7] * inFront.y + h[8];
  return w < 0 ? h.map((v) => -v) : h;
}
