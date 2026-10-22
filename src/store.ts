import { create } from 'zustand';
import type { BallAction, Pass, Play, Player, Run, Team, Vec } from './model/types';
import { buildTimeline, phaseIndexAt, type Timeline } from './model/engine';
import { clamp } from './model/geometry';
import { uid } from './model/uid';
import { makePreset } from './model/presets';

export type Tool = 'select' | 'run' | 'pass' | 'kick';
export type View = 'full' | 'fit';
/** ns: attack runs up the screen. ew: attack runs left to right. */
export type Orientation = 'ns' | 'ew';

/** The player whose timing box is open (docked in the corner of the pitch). */
export interface Popover {
  id: string;
}

/** An action started from a player's popover, waiting for the next drag (run) or tap (receiver). */
export interface Pending {
  kind: 'run' | BallAction;
  id: string;
}

const ORIENTATION_KEY = 'rugbyphases:orientation';
function savedOrientation(): Orientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === 'ew' ? 'ew' : 'ns';
  } catch {
    return 'ns';
  }
}

let cache: { play: Play | null; tl: Timeline | null } = { play: null, tl: null };

/** Timeline for a play, memoised on the play object (plays are immutable). */
export function timelineOf(play: Play): Timeline {
  if (cache.play !== play) cache = { play, tl: buildTimeline(play) };
  return cache.tl!;
}

const HISTORY = 100;
/** Edits with the same key this close together become one undo step (drags, sliders, typing). */
const COALESCE_MS = 1500;
let toastTimer: number | undefined;

interface State {
  play: Play;
  past: Play[];
  future: Play[];
  lastKey: string | null;
  lastAt: number;

  phaseIdx: number;
  time: number;
  playing: boolean;
  rate: number;

  tool: Tool;
  selected: string | null;
  view: View;
  orientation: Orientation;
  exportOpen: boolean;
  popover: Popover | null;
  pending: Pending | null;
  toast: string | null;
  libraryOpen: boolean;

  commit(fn: (p: Play) => void, key?: string): void;
  undo(): void;
  redo(): void;
  load(play: Play): void;

  seek(t: number): void;
  goPhase(i: number): void;
  togglePlay(): void;
  tick(dt: number): void;

  setTool(tool: Tool): void;
  select(id: string | null): void;
  setView(view: View): void;
  setOrientation(o: Orientation): void;
  setExportOpen(open: boolean): void;
  openPopover(p: Popover): void;
  closePopover(): void;
  startPending(kind: Pending['kind']): void;
  finishPending(): void;
  cancelPending(): void;
  setRate(rate: number): void;
  setLibraryOpen(open: boolean): void;
  notify(msg: string): void;

  addPhase(): void;
  deletePhase(i: number): void;
  addPlayer(team: Team): void;
  removePlayer(id: string): void;
  updatePlayer(id: string, patch: Partial<Player>, key?: string): void;
  giveBall(id: string): void;
  setRun(id: string, absPts: Vec[]): void;
  updateRun(id: string, patch: Partial<Run>, key?: string): void;
  clearRun(id: string): void;
  addPass(to: string, kind: BallAction): void;
  updatePass(passId: string, patch: Partial<Pass>, key?: string): void;
  removePass(passId: string): void;
}

export const useStore = create<State>()((set, get) => {
  /** After the play changes, keep the playhead on a valid phase start. */
  const settle = () => {
    const { play, phaseIdx, selected, popover } = get();
    const tl = timelineOf(play);
    const i = clamp(phaseIdx, 0, tl.phases.length - 1);
    set({
      phaseIdx: i,
      time: tl.phases[i].start,
      playing: false,
      selected: selected && play.players.some((p) => p.id === selected) ? selected : null,
      popover: popover && play.players.some((p) => p.id === popover.id) ? popover : null,
    });
  };
  const phase = (p: Play) => p.phases[get().phaseIdx];

  return {
    play: makePreset('backline'),
    past: [],
    future: [],
    lastKey: null,
    lastAt: 0,

    phaseIdx: 0,
    time: 0,
    playing: false,
    rate: 1,

    tool: 'select',
    selected: null,
    view: 'fit',
    orientation: savedOrientation(),
    exportOpen: false,
    popover: null,
    pending: null,
    toast: null,
    libraryOpen: false,

    commit(fn, key) {
      const { play, past, lastKey, lastAt } = get();
      const next = structuredClone(play);
      fn(next);
      next.updated = Date.now();
      const now = Date.now();
      const merge = key != null && key === lastKey && now - lastAt < COALESCE_MS;
      set({
        play: next,
        past: merge ? past : [...past.slice(-HISTORY + 1), play],
        future: [],
        lastKey: key ?? null,
        lastAt: now,
      });
      settle();
    },
    undo() {
      const { past, play, future } = get();
      if (!past.length) return;
      set({ play: past[past.length - 1], past: past.slice(0, -1), future: [play, ...future], lastKey: null });
      settle();
    },
    redo() {
      const { past, play, future } = get();
      if (!future.length) return;
      set({ play: future[0], past: [...past, play], future: future.slice(1), lastKey: null });
      settle();
    },
    load(play) {
      set({ play, past: [], future: [], lastKey: null, phaseIdx: 0, time: 0, playing: false, selected: null, popover: null, pending: null });
    },

    seek(t) {
      const tl = timelineOf(get().play);
      const time = clamp(t, 0, tl.total);
      set({ time, phaseIdx: phaseIndexAt(tl, time) });
    },
    goPhase(i) {
      const tl = timelineOf(get().play);
      set({
        phaseIdx: i,
        time: tl.phases[i].start,
        playing: false,
        popover: i === get().phaseIdx ? get().popover : null,
        pending: i === get().phaseIdx ? get().pending : null,
      });
    },
    togglePlay() {
      const { playing, time, play } = get();
      if (!playing && time >= timelineOf(play).total - 0.05) set({ time: 0, phaseIdx: 0 });
      set({ playing: !playing, pending: null });
    },
    tick(dt) {
      const { time, rate, play } = get();
      const tl = timelineOf(play);
      const t = time + dt * rate;
      if (t >= tl.total) set({ time: tl.total, phaseIdx: tl.phases.length - 1, playing: false });
      else set({ time: t, phaseIdx: phaseIndexAt(tl, t) });
    },

    setTool: (tool) => set({ tool, popover: null, pending: null }),
    select: (selected) => set({ selected }),
    setView: (view) => set({ view }),
    setOrientation(orientation) {
      set({ orientation });
      try {
        localStorage.setItem(ORIENTATION_KEY, orientation);
      } catch {
        /* ignore */
      }
    },
    setExportOpen: (exportOpen) => set({ exportOpen, playing: false }),
    openPopover: (popover) => set({ popover }),
    closePopover: () => set({ popover: null }),
    startPending(kind) {
      const popover = get().popover;
      if (popover) set({ pending: { kind, id: popover.id }, popover: null, selected: popover.id });
    },
    finishPending() {
      const pending = get().pending;
      // Reopen the box so the new pass or run can be timed straight away.
      set({ pending: null, popover: pending ? { id: pending.id } : null });
    },
    cancelPending: () => set({ pending: null }),
    setRate: (rate) => set({ rate }),
    setLibraryOpen: (libraryOpen) => set({ libraryOpen, playing: false }),
    notify(msg) {
      set({ toast: msg });
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
    },

    addPhase() {
      get().commit((p) => p.phases.push({ id: uid(), runs: {}, passes: [], note: '' }));
      get().goPhase(get().play.phases.length - 1);
    },
    deletePhase(i) {
      if (get().play.phases.length <= 1) return;
      get().commit((p) => p.phases.splice(i, 1));
      get().goPhase(Math.min(i, get().play.phases.length - 1));
    },
    addPlayer(team) {
      const { play, view, phaseIdx } = get();
      const taken = new Set(play.players.filter((p) => p.team === team).map((p) => p.num));
      let num = 1;
      while (taken.has(num)) num++;
      const id = uid();
      const cx = view === 'fit' ? 45 : 50;
      get().commit((p) =>
        p.players.push({ id, team, num, x: cx + (team === 'attack' ? -6 : 6), y: 32 + Math.random() * 6 }),
      );
      set({ selected: id, tool: 'select' });
      if (phaseIdx > 0) get().notify('New players are placed in phase 1 — go there to position them');
    },
    removePlayer(id) {
      get().commit((p) => {
        p.players = p.players.filter((x) => x.id !== id);
        if (p.ball === id) p.ball = null;
        for (const ph of p.phases) {
          delete ph.runs[id];
          ph.passes = ph.passes.filter((x) => x.to !== id);
        }
      });
    },
    updatePlayer(id, patch, key) {
      get().commit((p) => Object.assign(p.players.find((x) => x.id === id)!, patch), key);
    },
    giveBall(id) {
      get().commit((p) => {
        p.ball = id;
      });
    },
    setRun(id, absPts) {
      const origin = timelineOf(get().play).phases[get().phaseIdx].startPos[id];
      const pts = absPts.slice(1).map((v) => ({ x: v.x - origin.x, y: v.y - origin.y }));
      get().commit((p) => {
        const ph = phase(p);
        const old = ph.runs[id];
        ph.runs[id] = { pts, delay: old?.delay ?? 0, speed: old?.speed ?? 'run' };
      });
    },
    updateRun(id, patch, key) {
      get().commit((p) => Object.assign(phase(p).runs[id], patch), key);
    },
    clearRun(id) {
      get().commit((p) => {
        delete phase(p).runs[id];
      });
    },
    addPass(to, kind) {
      const { play, phaseIdx } = get();
      const ph = timelineOf(play).phases[phaseIdx];
      const from = ph.endHolder;
      const byId = (id: string) => play.players.find((x) => x.id === id);
      if (!from) return get().notify('Nobody has the ball — select a player in phase 1 and tap “Give ball”');
      if (from === to) return get().notify('That player already has the ball — tap a teammate');

      // Default timing: after the last pass lands, but no earlier than when the
      // receiver is a little over halfway through their run.
      const last = ph.passes[ph.passes.length - 1];
      let at = last ? last.pass.at + last.flight + 0.3 : 0.4;
      const r = ph.runs[to];
      if (r) at = Math.max(at, r.run.delay + (r.end - r.run.delay) * 0.55 - 0.4);
      at = Math.round(at * 10) / 10;

      get().commit((p) => {
        phase(p).passes.push({ id: uid(), to, at, kind });
      });
      get().notify(`${kind === 'kick' ? 'Kick' : 'Pass'} #${byId(from)?.num} → #${byId(to)?.num}`);
    },
    updatePass(passId, patch, key) {
      get().commit((p) => Object.assign(phase(p).passes.find((x) => x.id === passId)!, patch), key);
    },
    removePass(passId) {
      get().commit((p) => {
        const ph = phase(p);
        ph.passes = ph.passes.filter((x) => x.id !== passId);
      });
    },
  };
});
