import { create } from 'zustand';
import type { Vec } from '../model/types';
import { uid } from '../model/uid';
import { useStore } from '../store';
import { orientTowards, solveHomography } from './homography';
import type { CalibPoint, Film, FilmTrack, Homography, Keyframe } from './types';

export type Mode = 'plays' | 'film';

/**
 * Whether the Film tab is offered. Hidden for now while it's an experiment:
 * the code, saved marking and processor tools are all kept, and setting this
 * to true brings the Plays | Film tabs back.
 */
export const FILM_TAB = false;

const FILM_KEY = 'rugbyphases:film';
/** Reference frames this close in time count as the same frame. */
const SAME_FRAME = 0.02;

export const emptyFilm = (): Film => ({
  format: 'rugby-phases-film',
  version: 1,
  id: uid(),
  name: 'New clip',
  fps: 10,
  tracks: [],
  keyframes: [],
  camera: [],
});

function savedFilm(): Film {
  try {
    const f = JSON.parse(localStorage.getItem(FILM_KEY) ?? 'null');
    return f?.format === 'rugby-phases-film' ? f : emptyFilm();
  } catch {
    return emptyFilm();
  }
}

// The <video> element drives time while a clip is loaded.
let videoEl: HTMLVideoElement | null = null;
export const registerVideo = (el: HTMLVideoElement | null) => {
  videoEl = el;
};

interface FilmState {
  mode: Mode;
  film: Film;
  videoUrl: string | null;
  time: number;
  /** Length of the clip: the video's, or the tracks' when there is no video. */
  duration: number;
  playing: boolean;
  rate: number;
  /** Marking reference points: a video point waiting for its pitch spot. */
  calibrating: boolean;
  pendingImg: Vec | null;
  selectedTrack: string | null;

  setMode(mode: Mode): void;
  load(film: Film): void;
  setVideo(url: string | null, info?: Film['video']): void;
  setTime(t: number): void;
  seek(t: number): void;
  setDuration(d: number): void;
  togglePlay(): void;
  setPlaying(p: boolean): void;
  setRate(r: number): void;
  setCalibrating(on: boolean): void;
  addImagePoint(p: Vec | null): void;
  addPitchPoint(p: Vec): void;
  removePoint(kfTime: number, index: number): void;
  removeKeyframe(kfTime: number): void;
  selectTrack(id: string | null): void;
  updateTrack(id: string, patch: Partial<FilmTrack>): void;
}

const tracksDuration = (f: Film) => Math.max(0, ...f.tracks.map((t) => t.pos.length), f.camera.length) / f.fps;

export const useFilm = create<FilmState>()((set, get) => {
  const edit = (fn: (f: Film) => void) => {
    const film = structuredClone(get().film);
    fn(film);
    set({ film });
  };

  return {
    mode: 'plays',
    film: savedFilm(),
    videoUrl: null,
    time: 0,
    duration: 0,
    playing: false,
    rate: 1,
    calibrating: false,
    pendingImg: null,
    selectedTrack: null,

    setMode: (mode) => set({ mode, playing: false }),
    load(film) {
      set({ film, time: 0, playing: false, pendingImg: null, selectedTrack: null });
      if (!videoEl) set({ duration: tracksDuration(film) });
    },
    setVideo(videoUrl, info) {
      const prev = get().videoUrl;
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      set({ videoUrl, time: 0, playing: false });
      if (info) edit((f) => (f.video = info));
      if (!videoUrl) set({ duration: tracksDuration(get().film) });
    },
    setTime: (time) => set({ time }),
    seek(t) {
      const time = Math.max(0, Math.min(t, get().duration));
      if (videoEl) videoEl.currentTime = time;
      set({ time });
    },
    setDuration: (duration) => set({ duration }),
    togglePlay() {
      const { playing, time, duration } = get();
      if (!playing && time >= duration - 0.05) get().seek(0);
      get().setPlaying(!playing);
    },
    setPlaying(playing) {
      if (videoEl) {
        if (playing) void videoEl.play();
        else videoEl.pause();
      }
      set({ playing });
    },
    setRate(rate) {
      if (videoEl) videoEl.playbackRate = rate;
      set({ rate });
    },

    setCalibrating: (calibrating) => {
      if (calibrating) get().setPlaying(false);
      set({ calibrating, pendingImg: null });
    },
    addImagePoint: (pendingImg) => set({ pendingImg }),
    addPitchPoint(pitch) {
      const { pendingImg: img, time } = get();
      if (!img) return;
      edit((f) => {
        let kf = f.keyframes.find((k) => Math.abs(k.t - time) < SAME_FRAME);
        if (!kf) {
          kf = { t: time, points: [] };
          f.keyframes.push(kf);
          f.keyframes.sort((a, b) => a.t - b.t);
        }
        kf.points.push({ img, pitch });
      });
      set({ pendingImg: null });
      const n = keyframeAt(get().film, time)?.points.length ?? 0;
      if (n < 4) useStore.getState().notify(`Point ${n} of 4 — mark ${4 - n} more`);
      else if (n === 4) useStore.getState().notify('Pitch lines are drawn on the video — check they sit on the real lines');
    },
    removePoint(kfTime, index) {
      edit((f) => {
        const kf = f.keyframes.find((k) => k.t === kfTime);
        if (!kf) return;
        kf.points.splice(index, 1);
        if (kf.points.length === 0) f.keyframes = f.keyframes.filter((k) => k !== kf);
      });
    },
    removeKeyframe(kfTime) {
      edit((f) => {
        f.keyframes = f.keyframes.filter((k) => k.t !== kfTime);
      });
    },

    selectTrack: (selectedTrack) => set({ selectedTrack }),
    updateTrack(id, patch) {
      edit((f) => Object.assign(f.tracks.find((t) => t.id === id)!, patch));
    },
  };
});

// Keep the clip's marking and tracks across reloads (the video itself must be re-opened).
let saveTimer: number | undefined;
useFilm.subscribe((s, prev) => {
  if (s.film === prev.film) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(FILM_KEY, JSON.stringify(useFilm.getState().film));
    } catch {
      /* storage full or blocked: the film file export still works */
    }
  }, 400);
});

export const keyframeAt = (f: Film, t: number): Keyframe | undefined =>
  f.keyframes.find((k) => Math.abs(k.t - t) < SAME_FRAME);

/** The homography a keyframe's points define, once it has 4. */
export const keyframeHomography = (points: CalibPoint[]): Homography | null =>
  solveHomography(
    points.map((p) => p.img),
    points.map((p) => p.pitch),
  );

/** Where the camera was looking at `t`, and how we know: followed, a reference frame, or guessed from the nearest one. */
export function cameraAt(f: Film, t: number): { h: Homography; source: 'followed' | 'marked' | 'nearest' } | null {
  const kf = keyframeAt(f, t);
  if (kf && kf.points.length >= 4) {
    const h = keyframeHomography(kf.points);
    if (h) return { h, source: 'marked' };
  }
  if (f.camera.length) {
    const s = f.camera[Math.min(f.camera.length - 1, Math.max(0, Math.round(t * f.fps)))];
    // The bottom middle of a sideline picture is always grass, so it must be in front of the camera.
    const ground = { x: (f.video?.width ?? 1920) / 2, y: (f.video?.height ?? 1080) * 0.95 };
    if (s?.h) return { h: orientTowards(s.h, ground), source: 'followed' };
  }
  let best: { h: Homography; d: number } | null = null;
  for (const k of f.keyframes) {
    if (k.points.length < 4) continue;
    const h = keyframeHomography(k.points);
    if (h && (!best || Math.abs(k.t - t) < best.d)) best = { h, d: Math.abs(k.t - t) };
  }
  return best ? { h: best.h, source: 'nearest' } : null;
}

/** A track's pitch position at `t`, interpolated; `seen` is false when it's a last-known spot. */
export function trackAt(track: FilmTrack, fps: number, t: number): { pos: Vec; seen: boolean } | null {
  const f = t * fps;
  const i = Math.floor(f);
  const a = track.pos[i];
  const b = track.pos[i + 1];
  if (a && b) {
    const u = f - i;
    return { pos: { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u }, seen: true };
  }
  if (a) return { pos: { x: a[0], y: a[1] }, seen: true };
  // Off camera: hold the last place we saw them.
  for (let k = Math.min(i, track.pos.length - 1); k >= 0; k--) {
    const p = track.pos[k];
    if (p) return { pos: { x: p[0], y: p[1] }, seen: false };
  }
  return null;
}
