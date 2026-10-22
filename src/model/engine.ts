import { SPEEDS, type BallAction, type Pass, type Play, type Run, type Vec } from './types';
import { clamp, dist, lerp, pathLength, pointAlong } from './geometry';

/** Seconds a player takes to reach full speed. */
const ACCEL = 0.5;
/** Pause at the end of each phase so the shape can be read. */
const HOLD = 0.8;
const MIN_PHASE = 1.5;

export interface RunTrack {
  run: Run;
  path: Vec[];
  len: number;
  /** Phase-local time the player arrives at the end of the run. */
  end: number;
}

export interface PassTrack {
  pass: Pass;
  from: string;
  flight: number;
  /** Peak height in metres (kicks only). */
  height: number;
}

export interface PhaseTrack {
  start: number;
  duration: number;
  startPos: Record<string, Vec>;
  startHolder: string | null;
  endHolder: string | null;
  runs: Record<string, RunTrack>;
  passes: PassTrack[];
}

export interface Timeline {
  phases: PhaseTrack[];
  total: number;
}

export const runPath = (origin: Vec, run: Run): Vec[] => [
  origin,
  ...run.pts.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y })),
];

function distanceAt(run: Run, len: number, t: number) {
  const tt = t - run.delay;
  if (tt <= 0) return 0;
  const v = SPEEDS[run.speed];
  const d = tt < ACCEL ? (v * tt * tt) / (2 * ACCEL) : v * (tt - ACCEL / 2);
  return Math.min(d, len);
}

function runEnd(run: Run, len: number) {
  const v = SPEEDS[run.speed];
  const accelDist = (v * ACCEL) / 2;
  return run.delay + (len <= accelDist ? Math.sqrt((2 * ACCEL * len) / v) : len / v + ACCEL / 2);
}

export function positionIn(ph: PhaseTrack, id: string, t: number): Vec {
  const r = ph.runs[id];
  if (!r) return ph.startPos[id];
  return pointAlong(r.path, distanceAt(r.run, r.len, t));
}

export const flightTime = (kind: BallAction, d: number) =>
  kind === 'kick' ? clamp(d / 20, 0.9, 3) : clamp(d / 14, 0.3, 1.4);

/**
 * Resolve a play into absolute timings. Each phase starts from where the
 * previous one ended, and lasts until every run and pass has finished.
 */
export function buildTimeline(play: Play): Timeline {
  let pos: Record<string, Vec> = {};
  for (const p of play.players) pos[p.id] = { x: p.x, y: p.y };
  let holder = play.ball && pos[play.ball] ? play.ball : null;
  let start = 0;
  const phases: PhaseTrack[] = [];

  for (const phase of play.phases) {
    const ph: PhaseTrack = {
      start,
      duration: 0,
      startPos: pos,
      startHolder: holder,
      endHolder: holder,
      runs: {},
      passes: [],
    };
    let end = 0;

    for (const [id, run] of Object.entries(phase.runs)) {
      if (!pos[id] || run.pts.length === 0) continue;
      const path = runPath(pos[id], run);
      const len = pathLength(path);
      const e = runEnd(run, len);
      ph.runs[id] = { run, path, len, end: e };
      end = Math.max(end, e);
    }

    let h = holder;
    for (const pass of [...phase.passes].sort((a, b) => a.at - b.at)) {
      if (!h || !pos[pass.to] || pass.to === h) continue;
      const d = dist(positionIn(ph, h, pass.at), positionIn(ph, pass.to, pass.at));
      const flight = flightTime(pass.kind, d);
      const height = pass.kind === 'kick' ? clamp(d * 0.35, 3, 18) : 0;
      ph.passes.push({ pass, from: h, flight, height });
      h = pass.to;
      end = Math.max(end, pass.at + flight);
    }
    ph.endHolder = h;
    ph.duration = Math.max(MIN_PHASE, end + HOLD);
    phases.push(ph);

    const next: Record<string, Vec> = {};
    for (const id of Object.keys(pos)) next[id] = positionIn(ph, id, Infinity);
    pos = next;
    holder = h;
    start += ph.duration;
  }
  return { phases, total: start };
}

export function phaseIndexAt(tl: Timeline, t: number) {
  let i = 0;
  for (let k = 0; k < tl.phases.length; k++) if (tl.phases[k].start <= t + 1e-6) i = k;
  return i;
}

export interface BallState {
  pos: Vec;
  height: number;
  holder: string | null;
  flying: PassTrack | null;
}

export interface Frame {
  phase: number;
  local: number;
  players: Record<string, Vec>;
  ball: BallState | null;
}

/** Everything on the pitch at absolute time `t`. */
export function frameAt(tl: Timeline, t: number): Frame {
  const i = phaseIndexAt(tl, t);
  const ph = tl.phases[i];
  const local = clamp(t - ph.start, 0, ph.duration);
  const players: Record<string, Vec> = {};
  for (const id of Object.keys(ph.startPos)) players[id] = positionIn(ph, id, local);

  let holder = ph.startHolder;
  let ball: BallState | null = null;
  for (const pt of ph.passes) {
    if (local < pt.pass.at) break;
    if (local < pt.pass.at + pt.flight) {
      const u = (local - pt.pass.at) / pt.flight;
      const from = positionIn(ph, pt.from, pt.pass.at);
      // Aim at where the receiver is now, so the ball meets a moving runner.
      ball = {
        pos: lerp(from, players[pt.pass.to], u),
        height: 4 * pt.height * u * (1 - u),
        holder: null,
        flying: pt,
      };
      break;
    }
    holder = pt.pass.to;
  }
  if (!ball && holder) ball = { pos: players[holder], height: 0, holder, flying: null };
  return { phase: i, local, players, ball };
}
