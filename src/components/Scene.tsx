import type { MouseEvent, PointerEvent, Ref } from 'react';
import { positionIn, type Frame, type PassTrack, type PhaseTrack, type Timeline } from '../model/engine';
import { dist, toPath } from '../model/geometry';
import type { Play, Team, Vec } from '../model/types';
import { Pitch } from './Pitch';

/** Player token sizes, in metres. */
const TOKEN_R = 1.25;
const RING_R = 1.8;
/** Touch target: bigger than the token so it is easy to hit with a finger. */
const HIT_R = 2.4;
const BALL_OFFSET = 1;

/** A rectangle of the pitch, in pitch metres. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export const FULL: Box = { x0: -13, x1: 113, y0: -5, y1: 75 };

/** The area every player covers across the whole play, padded, so the camera never moves mid-play. */
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
 * The SVG viewBox for a pitch box. When vertical, the scene is rotated -90°
 * so the attack (towards x = 100) runs up the screen.
 */
export function viewBoxOf(box: Box, vertical: boolean) {
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  return vertical ? { x: box.y0, y: -box.x1, w: H, h: W } : { x: box.x0, y: box.y0, w: W, h: H };
}

interface SceneProps {
  play: Play;
  phase: PhaseTrack;
  frame: Frame;
  vertical: boolean;
  showLines?: boolean;
  dimLines?: boolean;
  selected?: string | null;
  /** While choosing a receiver: the player with the ball. Their teammates are highlighted. */
  passer?: string | null;
  stroke?: Vec[] | null;
  gRef?: Ref<SVGGElement>;
  onPlayerDown?: (e: PointerEvent, id: string) => void;
  onPlayerMenu?: (e: MouseEvent, id: string) => void;
}

/** Everything drawn inside the pitch SVG. Pure, so it can also be rendered to a string for export. */
export function Scene({
  play,
  phase,
  frame,
  vertical,
  showLines = true,
  dimLines = false,
  selected = null,
  passer = null,
  stroke = null,
  gRef,
  onPlayerDown,
  onPlayerMenu,
}: SceneProps) {
  const teamOf: Record<string, Team> = {};
  for (const p of play.players) teamOf[p.id] = p.team;
  const upright = vertical ? 'rotate(90)' : undefined;
  const ball = frame.ball;
  const ballScale = ball ? 1 + ball.height / 10 : 1;
  const passerTeam = passer ? teamOf[passer] : null;

  const pickClass = (id: string) =>
    !passerTeam ? '' : id === passer ? ' passer' : teamOf[id] === passerTeam ? ' target' : ' faded';

  return (
    <>
      <defs>
        {(['attack', 'defence', 'pass', 'kick', 'option'] as const).map((k) => (
          <marker
            key={k}
            id={`arrow-${k}`}
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="2"
            markerHeight="2"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" className={`arrowhead ${k}`} />
          </marker>
        ))}
      </defs>
      <g ref={gRef} transform={vertical ? 'rotate(-90)' : undefined}>
        <Pitch />
        {showLines && <Annotations ph={phase} teamOf={teamOf} selected={selected} dim={dimLines} />}
        {stroke && <path d={toPath(stroke)} className="stroke" />}

        {/* Enlarged touch targets sit beneath every token, so a visible token always wins over a neighbour's halo. */}
        {onPlayerDown && (
          <g className="hits">
            {play.players.map((p) => {
              const pos = frame.players[p.id];
              if (!pos) return null;
              return (
                <circle
                  key={p.id}
                  cx={pos.x}
                  cy={pos.y}
                  r={HIT_R}
                  className="hit"
                  onPointerDown={(e) => onPlayerDown(e, p.id)}
                  onContextMenu={onPlayerMenu && ((e) => onPlayerMenu(e, p.id))}
                />
              );
            })}
          </g>
        )}

        {play.players.map((p) => {
          const pos = frame.players[p.id];
          if (!pos) return null;
          return (
            <g
              key={p.id}
              data-id={p.id}
              className={`player ${p.team}${pickClass(p.id)}`}
              transform={`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`}
              onPointerDown={onPlayerDown && ((e) => onPlayerDown(e, p.id))}
              onContextMenu={onPlayerMenu && ((e) => onPlayerMenu(e, p.id))}
            >
              {(selected === p.id || passer === p.id) && <circle r={RING_R} className="ring" />}
              {passerTeam && p.id !== passer && teamOf[p.id] === passerTeam && <circle r={RING_R} className="pulse" />}
              <circle r={TOKEN_R} className="token" />
              <g transform={upright}>
                <text className="num" dy="0.05em">
                  {p.num}
                </text>
                {p.name && (
                  <text className="name" y={2.35}>
                    {p.name}
                  </text>
                )}
              </g>
            </g>
          );
        })}

        {ball && (
          <g className="ball" pointerEvents="none">
            {ball.height > 0.2 && <ellipse cx={ball.pos.x} cy={ball.pos.y} rx={0.6} ry={0.4} className="shadow" />}
            <g
              transform={`translate(${(ball.pos.x + (ball.holder ? BALL_OFFSET : 0)).toFixed(2)} ${(
                ball.pos.y - (ball.holder ? BALL_OFFSET : 0)
              ).toFixed(2)}) scale(${ballScale})`}
            >
              <ellipse rx={0.75} ry={0.48} transform="rotate(-30)" />
            </g>
          </g>
        )}
      </g>
    </>
  );
}

/** A pass (straight) or kick (bowed sideways so it reads differently) from passer to receiver. */
function BallLine({ ph, pt, className, marker }: { ph: PhaseTrack; pt: PassTrack; className: string; marker: string }) {
  const a = positionIn(ph, pt.from, pt.pass.at);
  const b = positionIn(ph, pt.pass.to, pt.pass.at + pt.flight);
  if (pt.pass.kind === 'pass') {
    return <path d={toPath([a, b])} className={className} markerEnd={`url(#arrow-${marker})`} />;
  }
  const d = dist(a, b) || 1;
  const bow = Math.min(d * 0.25, 8);
  const cx = (a.x + b.x) / 2 - ((b.y - a.y) / d) * bow;
  const cy = (a.y + b.y) / 2 + ((b.x - a.x) / d) * bow;
  return <path d={`M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`} className={className} markerEnd={`url(#arrow-${marker})`} />;
}

function Annotations({
  ph,
  teamOf,
  selected,
  dim,
}: {
  ph: PhaseTrack;
  teamOf: Record<string, Team>;
  selected: string | null;
  dim: boolean;
}) {
  return (
    <g className={`annotations${dim ? ' dim' : ''}`} pointerEvents="none">
      {Object.entries(ph.runs).map(([id, r]) => (
        <path
          key={id}
          d={toPath(r.path)}
          className={`run ${teamOf[id]}${selected === id ? ' selected' : ''}`}
          markerEnd={`url(#arrow-${teamOf[id]})`}
        />
      ))}
      {ph.options.map((pt) => (
        <BallLine key={pt.pass.id} ph={ph} pt={pt} className={`option ${pt.pass.kind}-option`} marker="option" />
      ))}
      {ph.passes.map((pt) => (
        <BallLine key={pt.pass.id} ph={ph} pt={pt} className={pt.pass.kind} marker={pt.pass.kind} />
      ))}
    </g>
  );
}
