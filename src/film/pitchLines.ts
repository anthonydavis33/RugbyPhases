import type { Vec } from '../model/types';

/** A marking on a rugby union pitch, in pitch metres (see model/types for axes). */
export interface PitchLine {
  a: Vec;
  b: Vec;
  dashed?: boolean;
}

export const PITCH_LINES: PitchLine[] = [
  { a: { x: -10, y: 0 }, b: { x: 110, y: 0 } },
  { a: { x: -10, y: 70 }, b: { x: 110, y: 70 } },
  ...[-10, 0, 22, 50, 78, 100, 110].map((x) => ({ a: { x, y: 0 }, b: { x, y: 70 } })),
  ...[5, 40, 60, 95].map((x) => ({ a: { x, y: 0 }, b: { x, y: 70 }, dashed: true })),
  ...[5, 15, 55, 65].map((y) => ({ a: { x: 0, y }, b: { x: 100, y }, dashed: true })),
];

/**
 * Spots a coach can pick out on video: where lines cross, and the posts.
 * Clicks on the pitch map snap to these.
 */
export const LANDMARKS: Vec[] = [
  ...[0, 5, 22, 40, 50, 60, 78, 95, 100].flatMap((x) => [0, 5, 15, 55, 65, 70].map((y) => ({ x, y }))),
  ...[-10, 110].flatMap((x) => [0, 70].map((y) => ({ x, y }))),
  ...[0, 100].flatMap((x) => [32.2, 37.8].map((y) => ({ x, y }))),
];

const SNAP = 3;

/** The nearest landmark within snapping distance, or the point itself. */
export function snapToLandmark(p: Vec): { pos: Vec; snapped: boolean } {
  let best: Vec | null = null;
  let bd = SNAP;
  for (const l of LANDMARKS) {
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best ? { pos: best, snapped: true } : { pos: p, snapped: false };
}
