import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { timelineOf, useStore } from '../store';
import { frameAt, positionIn, type PhaseTrack, type Timeline } from '../model/engine';
import { clamp, dist, pathLength, smoothStroke, toPath } from '../model/geometry';
import type { Team, Vec } from '../model/types';
import { Pitch } from './Pitch';

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const FULL: Box = { x0: -13, x1: 113, y0: -5, y1: 75 };

/** The area every player covers across the whole play, padded, so the camera never moves mid-play. */
function fitBox(tl: Timeline): Box {
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

type Drag =
  | { kind: 'move'; id: string; off: Vec }
  | { kind: 'run'; id: string; pts: Vec[] }
  | { kind: 'blocked'; from: Vec };

export function Board() {
  const play = useStore((s) => s.play);
  const time = useStore((s) => s.time);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const playing = useStore((s) => s.playing);

  const tl = timelineOf(play);
  const frame = frameAt(tl, time);
  const ph = tl.phases[phaseIdx];
  const teamOf: Record<string, Team> = {};
  for (const p of play.players) teamOf[p.id] = p.team;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [stroke, setStroke] = useState<Vec[] | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  // Stand the pitch upright (attack running up) on portrait screens.
  const { x0, x1, y0, y1 } = view === 'full' ? FULL : fitBox(tl);
  const W = x1 - x0;
  const H = y1 - y0;
  const vertical = size.h > size.w * 1.05;
  const viewBox = vertical ? `${y0} ${-x1} ${H} ${W}` : `${x0} ${y0} ${W} ${H}`;
  const upright = vertical ? 'rotate(90)' : undefined;

  const toPitch = (e: PointerEvent): Vec => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(gRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const capture = (e: PointerEvent) => {
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* not every pointer can be captured */
    }
  };

  const onPlayerDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    const st = useStore.getState();
    st.goPhase(st.phaseIdx); // edit from the start of the phase
    const origin = timelineOf(st.play).phases[st.phaseIdx].startPos[id];
    capture(e);

    if (st.tool === 'select') {
      st.select(id);
      const p = toPitch(e);
      drag.current =
        st.phaseIdx === 0 ? { kind: 'move', id, off: { x: origin.x - p.x, y: origin.y - p.y } } : { kind: 'blocked', from: p };
    } else if (st.tool === 'run') {
      st.select(id);
      drag.current = { kind: 'run', id, pts: [origin] };
      setStroke([origin]);
    } else {
      st.addPass(id, st.tool);
    }
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPitch(e);
    if (d.kind === 'move') {
      useStore.getState().updatePlayer(d.id, { x: clamp(p.x + d.off.x, -12, 112), y: clamp(p.y + d.off.y, -4, 74) }, `move:${d.id}`);
    } else if (d.kind === 'run') {
      if (dist(d.pts[d.pts.length - 1], p) > 0.4) {
        d.pts.push(p);
        setStroke([...d.pts]);
      }
    } else if (dist(d.from, p) > 1.5) {
      useStore.getState().notify('In later phases players start where they finished — use Run to move them');
      drag.current = null;
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'run') {
      const pts = smoothStroke(d.pts);
      if (pathLength(pts) >= 1.5) useStore.getState().setRun(d.id, pts);
      setStroke(null);
    }
  };

  const onBackgroundDown = () => {
    const st = useStore.getState();
    if (st.tool === 'select' || st.tool === 'run') st.select(null);
  };

  const ball = frame.ball;
  const ballScale = ball ? 1 + ball.height / 10 : 1;

  return (
    <div className="board" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          {(['attack', 'defence', 'pass', 'kick'] as const).map((k) => (
            <marker
              key={k}
              id={`arrow-${k}`}
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerUnits="userSpaceOnUse"
              markerWidth="2.2"
              markerHeight="2.2"
              orient="auto"
            >
              <path d="M0 0L10 5L0 10z" className={`arrowhead ${k}`} />
            </marker>
          ))}
        </defs>
        <g ref={gRef} transform={vertical ? 'rotate(-90)' : undefined}>
          <Pitch />
          <Annotations ph={ph} teamOf={teamOf} selected={selected} dim={playing} />
          {stroke && <path d={toPath(stroke)} className="stroke" />}

          {play.players.map((p) => {
            const pos = frame.players[p.id];
            if (!pos) return null;
            return (
              <g
                key={p.id}
                className={`player ${p.team}`}
                transform={`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`}
                onPointerDown={(e) => onPlayerDown(e, p.id)}
              >
                <circle r={2.8} className="hit" />
                {selected === p.id && <circle r={2.25} className="ring" />}
                <circle r={1.55} className="token" />
                <g transform={upright}>
                  <text className="num" dy="0.05em">
                    {p.num}
                  </text>
                  {p.name && (
                    <text className="name" y={2.9}>
                      {p.name}
                    </text>
                  )}
                </g>
              </g>
            );
          })}

          {ball && (
            <g className="ball" pointerEvents="none">
              {ball.height > 0.2 && <ellipse cx={ball.pos.x} cy={ball.pos.y} rx={0.7} ry={0.45} className="shadow" />}
              <g
                transform={`translate(${(ball.pos.x + (ball.holder ? 1.2 : 0)).toFixed(2)} ${(
                  ball.pos.y - (ball.holder ? 1.2 : 0)
                ).toFixed(2)}) scale(${ballScale})`}
              >
                <ellipse rx={0.85} ry={0.55} transform="rotate(-30)" />
              </g>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
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
      {ph.passes.map((pt) => {
        const a = positionIn(ph, pt.from, pt.pass.at);
        const b = positionIn(ph, pt.pass.to, pt.pass.at + pt.flight);
        if (pt.pass.kind === 'pass') {
          return <path key={pt.pass.id} d={toPath([a, b])} className="pass" markerEnd="url(#arrow-pass)" />;
        }
        // Kicks bow sideways so they read differently from passes.
        const d = dist(a, b) || 1;
        const bow = Math.min(d * 0.25, 8);
        const cx = (a.x + b.x) / 2 - ((b.y - a.y) / d) * bow;
        const cy = (a.y + b.y) / 2 + ((b.x - a.x) / d) * bow;
        return (
          <path
            key={pt.pass.id}
            d={`M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`}
            className="kick"
            markerEnd="url(#arrow-kick)"
          />
        );
      })}
    </g>
  );
}
