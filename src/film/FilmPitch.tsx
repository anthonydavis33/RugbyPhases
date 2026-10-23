import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Scene } from '../components/Scene';
import { FULL, viewBoxOf } from '../model/camera';
import type { Frame, PhaseTrack } from '../model/engine';
import type { Play, Vec } from '../model/types';
import { applyHomography } from './homography';
import { snapToLandmark } from './pitchLines';
import { cameraAt, keyframeAt, trackAt, useFilm } from './store';
import type { Film, Homography } from './types';

const NO_PHASE: PhaseTrack = {
  start: 0,
  duration: 0,
  startPos: {},
  startHolder: null,
  endHolder: null,
  runs: {},
  passes: [],
  options: [],
};

/** Tracks as players the shared Scene can draw. Team-less players show as the opposition until assigned. */
const asPlay = (film: Film): Play => ({
  id: film.id,
  name: film.name,
  ball: null,
  phases: [],
  updated: 0,
  players: film.tracks.map((t) => ({ id: t.id, team: t.team ?? 'defence', num: t.num, name: t.name, x: 0, y: 0 })),
});

/** Ground beyond this (metres past the pitch) counts as "not the pitch" when tracing what's in shot. */
const FAR = 4;
const onGround = (p: Vec | null): p is Vec => !!p && p.x > -10 - FAR && p.x < 110 + FAR && p.y > -FAR && p.y < 70 + FAR;

/**
 * The part of the pitch in shot. The bottom of the picture is always grass;
 * each column is traced upwards until it leaves the pitch area (the top of a
 * sideline picture is usually trees and sky, which don't map onto the ground).
 */
function footprint(h: Homography, w: number, hgt: number): Vec[] {
  const steps = 16;
  const bottom: Vec[] = [];
  const top: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    const b = applyHomography(h, { x, y: hgt });
    if (!onGround(b)) continue;
    bottom.push(b);
    // Binary search for the highest point in this column still on the pitch area.
    let lo = 0;
    let hi = hgt;
    if (onGround(applyHomography(h, { x, y: 0 }))) hi = 0;
    else {
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (onGround(applyHomography(h, { x, y: mid }))) hi = mid;
        else lo = mid;
      }
    }
    top.push(applyHomography(h, { x, y: hi })!);
  }
  return [...bottom, ...top.reverse()];
}

export function FilmPitch() {
  const film = useFilm((s) => s.film);
  const time = useFilm((s) => s.time);
  const calibrating = useFilm((s) => s.calibrating);
  const pendingImg = useFilm((s) => s.pendingImg);
  const selected = useFilm((s) => s.selectedTrack);
  const gRef = useRef<SVGGElement>(null);
  const [hover, setHover] = useState<Vec | null>(null);

  const play = useMemo(() => asPlay(film), [film]);
  const players: Record<string, Vec> = {};
  const dimmed = new Set<string>();
  for (const t of film.tracks) {
    const at = trackAt(t, film.fps, time);
    if (!at) continue;
    players[t.id] = at.pos;
    if (!at.seen) dimmed.add(t.id);
  }
  const frame: Frame = { phase: 0, local: 0, players, ball: null };
  // Always east–west here: matches a sideline camera (near touchline at the bottom), so marking is easy.
  const vertical = false;
  const vb = viewBoxOf(FULL, vertical);
  const cam = cameraAt(film, time);
  const shot = cam && film.video ? footprint(cam.h, film.video.width, film.video.height) : [];
  const kf = keyframeAt(film, time);

  const toPitch = (e: PointerEvent): Vec => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(gRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const picking = calibrating && !!pendingImg;

  return (
    <div className={`film-pitch${picking ? ' picking' : ''}`}>
      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={picking ? (e) => setHover(snapToLandmark(toPitch(e)).pos) : undefined}
        onPointerLeave={() => setHover(null)}
        onPointerDown={picking ? (e) => useFilm.getState().addPitchPoint(snapToLandmark(toPitch(e)).pos) : undefined}
      >
        <Scene
          play={play}
          phase={NO_PHASE}
          frame={frame}
          vertical={vertical}
          showLines={false}
          selected={selected}
          dimmed={dimmed}
          gRef={gRef}
        />
        {/* Drawn in the same rotated space as the pitch. */}
        <g transform={vertical ? 'rotate(-90)' : undefined} pointerEvents="none">
          {shot.length > 2 && <polygon points={shot.map((p) => `${p.x},${p.y}`).join(' ')} className="camera-shot" />}
          {kf?.points.map((p, i) => (
            <g key={i} className="calib-mark pitch" transform={`translate(${p.pitch.x} ${p.pitch.y})`}>
              <circle r={1.6} />
              <text transform={vertical ? 'rotate(90)' : undefined}>{i + 1}</text>
            </g>
          ))}
          {picking && hover && <circle cx={hover.x} cy={hover.y} r={1.8} className="calib-pending" />}
        </g>
      </svg>
      {film.tracks.length === 0 && !calibrating && (
        <div className="film-pitch-note">No player tracks yet — this fills in once a clip is processed.</div>
      )}
    </div>
  );
}
