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
  /** The ball's path as played (main line, or with the chosen option swapped in). */
  passes: PassTrack[];
  /** Alternatives not being played, drawn as option lines from the same passer. */
  options: PassTrack[];
}

export interface Timeline {
  phases: PhaseTrack[];
  total: number;
}

export const runPath = (origin: Vec, run: Run): Vec[] => [
  origin,
  ...run.pts.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y })),
];

/** How far along their run (metres) a player is at phase-local time `t`. */
export function distanceAt(run: Run, len: number, t: number) {
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

/** The part of a run still ahead of the player at phase-local time `t` (the whole run before they set off). */
export function remainingPath(r: RunTrack, t: number): Vec[] {
  const d = distanceAt(r.run, r.len, t);
  if (d <= 0) return r.path;
  let walked = 0;
  for (let i = 1; i < r.path.length; i++) {
    const seg = dist(r.path[i - 1], r.path[i]);
    if (walked + seg >= d) return [lerp(r.path[i - 1], r.path[i], seg ? (d - walked) / seg : 1), ...r.path.slice(i)];
    walked += seg;
  }
  return [r.path[r.path.length - 1]];
}

export const flightTime =(kind: BallAction, d: number) =>
  kind === 'kick' ? clamp(d / 20, 0.9, 3) : clamp(d / 14, 0.3, 1.4);

const kickHeight = (kind: BallAction, d: number) => (kind === 'kick' ? clamp(d * 0.35, 3, 18) : 0);

/**
 * Resolve a play into absolute timings. Each phase starts from where the
 * previous one ended, and lasts until every run and pass has finished.
 * `option` is the id of an option pass to play instead of its main-line pass.
 */
export function buildTimeline(play: Play, option: string | null = null): Timeline {
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
      options: [],
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

    // The main line, with the chosen option (if it's in this phase) swapped in.
    // The swapped pass keeps the main pass's id so editing still targets it.
    const alts = phase.passes.filter((p) => p.altOf);
    const chosen = option ? alts.find((p) => p.id === option) : undefined;
    const main = phase.passes
      .filter((p) => !p.altOf)
      .map((p) => (chosen && p.id === chosen.altOf ? { ...p, to: chosen.to, kind: chosen.kind, at: chosen.at } : p))
      .sort((a, b) => a.at - b.at);

    let h = holder;
    /** When the current holder actually has the ball: nobody passes before they've caught it. */
    let ready = 0;
    for (const raw of main) {
      if (!h || !pos[raw.to] || raw.to === h) continue;
      const pass = raw.at < ready ? { ...raw, at: ready } : raw;
      const d = dist(positionIn(ph, h, pass.at), positionIn(ph, pass.to, pass.at));
      const flight = flightTime(pass.kind, d);
      ph.passes.push({ pass, from: h, flight, height: kickHeight(pass.kind, d) });
      h = pass.to;
      ready = pass.at + flight;
      end = Math.max(end, ready);
    }

    // Options not being played (including the main pass an option replaced) are
    // drawn from whoever throws the pass they belong to. They don't affect timing.
    const shown = [...alts.filter((p) => p !== chosen), ...phase.passes.filter((p) => p.id === chosen?.altOf)];
    for (const alt of shown) {
      const base = ph.passes.find((t) => t.pass.id === (alt.altOf ?? alt.id));
      if (!base || !pos[alt.to] || alt.to === base.from) continue;
      const d = dist(positionIn(ph, base.from, alt.at), positionIn(ph, alt.to, alt.at));
      ph.options.push({ pass: alt, from: base.from, flight: flightTime(alt.kind, d), height: kickHeight(alt.kind, d) });
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
      // Throw to where the receiver will be when they catch it: a straight line
      // that meets a moving runner, matching the pass line drawn on the pitch.
      const catchAt = positionIn(ph, pt.pass.to, pt.pass.at + pt.flight);
      ball = {
        pos: lerp(from, catchAt, u),
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
