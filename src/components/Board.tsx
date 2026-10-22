import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { timelineOf, useStore } from '../store';
import { frameAt } from '../model/engine';
import { clamp, dist, pathLength, smoothStroke } from '../model/geometry';
import type { Vec } from '../model/types';
import { FULL, Scene, fitBox, viewBoxOf } from './Scene';

/** Movement (in metres) below which a press counts as a tap rather than a drag. */
const TAP_SLOP = 0.6;

type Drag =
  | { kind: 'move'; id: string; off: Vec; from: Vec; moved: boolean }
  /** shift moves the finger's path so it starts at the player (runs drawn from anywhere). */
  | { kind: 'run'; id: string; pts: Vec[]; pending?: boolean; shift?: Vec }
  | { kind: 'blocked'; id: string; from: Vec; moved: boolean };

export function Board() {
  const play = useStore((s) => s.play);
  const time = useStore((s) => s.time);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const orientation = useStore((s) => s.orientation);
  const playing = useStore((s) => s.playing);
  const tool = useStore((s) => s.tool);
  const pending = useStore((s) => s.pending);
  useStore((s) => s.activeOption); // re-render when a different option is chosen

  const tl = timelineOf(play);
  const frame = frameAt(tl, time);
  // While choosing who gets the ball, the passer's teammates are highlighted.
  const passer = playing
    ? null
    : pending
      ? pending.kind === 'run'
        ? null
        : pending.id
      : tool === 'pass' || tool === 'kick'
        ? tl.phases[phaseIdx].endHolder
        : null;
  const vertical = orientation === 'ns';
  const vb = viewBoxOf(view === 'full' ? FULL : fitBox(tl), vertical);

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [stroke, setStroke] = useState<Vec[] | null>(null);

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

  /**
   * Finish an action started from a player's popover. A pending run is drawn by
   * the next drag, wherever it starts; a pending pass or kick goes to the next
   * player tapped. Returns true if the press was used up.
   */
  const handlePending = (e: PointerEvent, tapped: string | null) => {
    const st = useStore.getState();
    const pending = st.pending;
    if (!pending) return false;
    st.goPhase(st.phaseIdx); // a slider preview may have moved the playhead
    if (pending.kind === 'run') {
      const origin = timelineOf(st.play).phases[st.phaseIdx].startPos[pending.id];
      const p = toPitch(e);
      capture(e);
      drag.current = {
        kind: 'run',
        id: pending.id,
        pts: [origin],
        pending: true,
        shift: { x: origin.x - p.x, y: origin.y - p.y },
      };
      setStroke([origin]);
    } else if (!tapped) {
      st.cancelPending();
    } else if (tapped === pending.id) {
      st.notify('Tap the player receiving the ' + pending.kind);
    } else {
      if (pending.kind === 'option') st.addOption(pending.altOf!, tapped);
      else st.addPass(tapped, pending.kind);
      st.finishPending();
    }
    return true;
  };

  const onPlayerDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button === 2) return; // right-click is handled by onPlayerMenu
    if (handlePending(e, id)) return;
    const st = useStore.getState();
    st.closePopover();
    st.goPhase(st.phaseIdx); // edit from the start of the phase
    const origin = timelineOf(st.play).phases[st.phaseIdx].startPos[id];
    capture(e);

    if (st.tool === 'pass' || st.tool === 'kick') {
      st.addPass(id, st.tool);
      return;
    }
    st.select(id);
    const p = toPitch(e);
    if (st.tool === 'run') {
      drag.current = { kind: 'run', id, pts: [origin] };
      setStroke([origin]);
    } else if (st.phaseIdx === 0) {
      drag.current = { kind: 'move', id, off: { x: origin.x - p.x, y: origin.y - p.y }, from: p, moved: false };
    } else {
      drag.current = { kind: 'blocked', id, from: p, moved: false };
    }
  };

  const onPlayerMenu = (e: MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    st.goPhase(st.phaseIdx);
    st.select(id);
    st.openPopover({ id });
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    let p = toPitch(e);
    if (d.kind === 'run' && d.shift) p = { x: p.x + d.shift.x, y: p.y + d.shift.y };
    if (d.kind === 'move') {
      if (!d.moved && dist(d.from, p) < TAP_SLOP) return;
      d.moved = true;
      useStore.getState().updatePlayer(d.id, { x: clamp(p.x + d.off.x, -12, 112), y: clamp(p.y + d.off.y, -4, 74) }, `move:${d.id}`);
    } else if (d.kind === 'run') {
      if (dist(d.pts[d.pts.length - 1], p) > 0.4) {
        d.pts.push(p);
        setStroke([...d.pts]);
      }
    } else if (!d.moved && dist(d.from, p) > 1.5) {
      d.moved = true;
      useStore.getState().notify('In later phases players start where they finished — use Run to move them');
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useStore.getState();
    if (d.kind === 'run') {
      setStroke(null);
      const pts = smoothStroke(d.pts);
      if (pathLength(pts) >= 1.5) {
        st.setRun(d.id, pts);
        if (d.pending) st.finishPending();
      } else if (d.pending) {
        st.notify('Drag to draw the run');
      } else {
        st.openPopover({ id: d.id }); // a tap, not a run
      }
    } else if (!d.moved) {
      st.openPopover({ id: d.id });
    }
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if (handlePending(e, null)) return;
    const st = useStore.getState();
    st.closePopover();
    if (st.tool === 'select' || st.tool === 'run') st.select(null);
  };

  return (
    <div className="board">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Scene
          play={play}
          phase={tl.phases[phaseIdx]}
          frame={frame}
          vertical={vertical}
          dimLines={playing}
          selected={selected}
          passer={passer}
          stroke={stroke}
          gRef={gRef}
          onPlayerDown={onPlayerDown}
          onPlayerMenu={onPlayerMenu}
        />
      </svg>
    </div>
  );
}
