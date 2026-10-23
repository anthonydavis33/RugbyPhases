import type { MouseEvent, PointerEvent, Ref } from 'react';
import { positionIn, remainingPath, type Frame, type PassTrack, type PhaseTrack } from '../model/engine';
import { clamp, dist, lerp, pathLength, toPath } from '../model/geometry';
import type { Play, Team, Vec } from '../model/types';
import { Pitch } from './Pitch';

/** Player token sizes, in metres. */
const TOKEN_R = 1.25;
const RING_R = 1.8;
/** Touch target: bigger than the token so it is easy to hit with a finger. */
const HIT_R = 2.4;
const BALL_OFFSET = 1;

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
  /** Players drawn faded (e.g. off camera in film playback). */
  dimmed?: Set<string>;
  stroke?: Vec[] | null;
  gRef?: Ref<SVGGElement>;
  onPlayerDown?: (e: PointerEvent, id: string) => void;
  onPlayerMenu?: (e: MouseEvent, id: string) => void;
  /** When set, run lines can be grabbed and reshaped. */
  onRunDown?: (e: PointerEvent, id: string) => void;
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
  dimmed,
  stroke = null,
  gRef,
  onPlayerDown,
  onPlayerMenu,
  onRunDown,
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
        {showLines && (
          <Annotations
            ph={phase}
            local={frame.local}
            teamOf={teamOf}
            selected={selected}
            dim={dimLines}
            onRunDown={onRunDown}
          />
        )}
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
              className={`player ${p.team}${pickClass(p.id)}${dimmed?.has(p.id) ? ' faded' : ''}`}
              transform={`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`}
              onPointerDown={onPlayerDown && ((e) => onPlayerDown(e, p.id))}
              onContextMenu={onPlayerMenu && ((e) => onPlayerMenu(e, p.id))}
            >
              {(selected === p.id || passer === p.id) && <circle r={RING_R} className="ring" />}
              {passerTeam && p.id !== passer && teamOf[p.id] === passerTeam && <circle r={RING_R} className="pulse" />}
              <circle r={TOKEN_R} className="token" />
              <g transform={upright}>
                <text className="num" dy="0.05em">
                  {p.num || '?'}
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

/**
 * A pass (straight) or kick (bowed sideways so it reads differently) from
 * passer to receiver. Once the ball is away, only the stretch it has still to
 * travel is drawn, and the line is gone when it's caught.
 */
function BallLine({
  ph,
  pt,
  local,
  className,
  marker,
}: {
  ph: PhaseTrack;
  pt: PassTrack;
  local: number;
  className: string;
  marker: string;
}) {
  const u = clamp((local - pt.pass.at) / pt.flight, 0, 1);
  if (u >= 1) return null;
  const a = positionIn(ph, pt.from, pt.pass.at);
  const b = positionIn(ph, pt.pass.to, pt.pass.at + pt.flight);
  if (pt.pass.kind === 'pass') {
    return <path d={toPath([lerp(a, b, u), b])} className={className} markerEnd={`url(#arrow-${marker})`} />;
  }
  const d = dist(a, b) || 1;
  const bow = Math.min(d * 0.25, 8);
  const c = { x: (a.x + b.x) / 2 - ((b.y - a.y) / d) * bow, y: (a.y + b.y) / 2 + ((b.x - a.x) / d) * bow };
  // The rest of the curve from u onwards (de Casteljau split of the quadratic).
  const c2 = lerp(c, b, u);
  const s = lerp(lerp(a, c, u), c2, u);
  return <path d={`M${s.x} ${s.y}Q${c2.x} ${c2.y} ${b.x} ${b.y}`} className={className} markerEnd={`url(#arrow-${marker})`} />;
}

/** Runs shorter than this (metres left to go) aren't drawn, so a finished run leaves no stray arrowhead. */
const MIN_RUN_LEFT = 0.3;

function Annotations({
  ph,
  local,
  teamOf,
  selected,
  dim,
  onRunDown,
}: {
  ph: PhaseTrack;
  /** Phase-local time: runs and passes are drawn only ahead of the player or ball. */
  local: number;
  teamOf: Record<string, Team>;
  selected: string | null;
  dim: boolean;
  onRunDown?: (e: PointerEvent, id: string) => void;
}) {
  return (
    <g className={`annotations${dim ? ' dim' : ''}`} pointerEvents="none">
      {Object.entries(ph.runs).map(([id, r]) => {
        const ahead = remainingPath(r, local);
        if (pathLength(ahead) < MIN_RUN_LEFT) return null;
        const d = toPath(ahead);
        const end = ahead[ahead.length - 1];
        return (
          <g key={id}>
            <path
              d={d}
              className={`run ${teamOf[id]}${selected === id ? ' selected' : ''}`}
              markerEnd={`url(#arrow-${teamOf[id]})`}
            />
            {onRunDown && (
              <>
                {/* A wide invisible stroke, so the line is easy to grab with a finger. */}
                <path d={d} className="run-hit" pointerEvents="stroke" onPointerDown={(e) => onRunDown(e, id)} />
                {selected === id && (
                  <circle
                    cx={end.x}
                    cy={end.y}
                    r={0.75}
                    className="run-handle"
                    pointerEvents="all"
                    onPointerDown={(e) => onRunDown(e, id)}
                  />
                )}
              </>
            )}
          </g>
        );
      })}
      {ph.options.map((pt) => (
        <BallLine
          key={pt.pass.id}
          ph={ph}
          pt={pt}
          local={local}
          className={`option ${pt.pass.kind}-option`}
          marker="option"
        />
      ))}
      {ph.passes.map((pt) => (
        <BallLine key={pt.pass.id} ph={ph} pt={pt} local={local} className={pt.pass.kind} marker={pt.pass.kind} />
      ))}
    </g>
  );
}
