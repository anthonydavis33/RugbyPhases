import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { timelineOf, useStore } from '../store';
import { distanceAt, frameAt } from '../model/engine';
import { cameraRect, fitBox, viewBoxOf } from '../model/camera';
import { clamp, dist, nearestOnPath, pathLength, resample, smoothStroke, warpPath } from '../model/geometry';
import type { Vec } from '../model/types';
import { Scene } from './Scene';

/** Movement (in metres) below which a press on a player counts as a tap rather than a drag. */
const TAP_SLOP = 0.6;
/** Movement (in pixels) below which a press on the grass is a tap rather than a pan. */
const PAN_SLOP = 4;

type Drag =
  | { kind: 'move'; id: string; off: Vec; from: Vec; moved: boolean }
  /** shift moves the finger's path so it starts at the player (runs drawn from anywhere). */
  | { kind: 'run'; id: string; pts: Vec[]; pending?: boolean; shift?: Vec }
  | { kind: 'blocked'; id: string; from: Vec; moved: boolean }
  /** Reshaping a run: `base` is the run as it was, resampled; `from`/`grab` are metres along it. */
  | { kind: 'bend'; id: string; base: Vec[]; start: Vec; from: number; grab: number; moved: boolean }
  /** Positions in pixels within the pitch area. */
  | { kind: 'pan'; from: Vec; last: Vec; moved: boolean }
  | { kind: 'pinch'; dist: number; mid: Vec };

export function Board() {
  const play = useStore((s) => s.play);
  const time = useStore((s) => s.time);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const selected = useStore((s) => s.selected);
  const camera = useStore((s) => s.camera);
  const stage = useStore((s) => s.stage);
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
  // The camera fixes pixels-per-metre, so layout changes crop or reveal rather than rescale.
  const vb = camera && stage.w > 0 ? cameraRect(camera, stage) : viewBoxOf(fitBox(tl), vertical);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Pointers down on the grass, for pinch zoom. */
  const pointers = useRef(new Map<number, Vec>());
  const [stroke, setStroke] = useState<Vec[] | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) =>
      useStore.getState().setStage({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, []);

  // Frame the play when there's no camera yet: first load, a new play, or a new pitch direction.
  useEffect(() => {
    if (!camera && stage.w > 1 && stage.h > 1) useStore.getState().fitView('play');
  }, [camera, stage]);

  // Wheel / trackpad pinch zooms around the cursor. Native listener so the page doesn't scroll.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const k = e.ctrlKey ? 0.01 : 0.0015; // trackpad pinches arrive as small ctrl+wheel steps
      useStore.getState().zoomBy(Math.exp(-delta * k), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const toPitch = (e: PointerEvent): Vec => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(gRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const toScreen = (e: PointerEvent): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
  const handlePending = (e: PointerEvent, tapped: string) => {
    const st = useStore.getState();
    const pending = st.pending;
    if (!pending) return false;
    st.goPhase(st.phaseIdx); // a slider preview may have moved the playhead
    if (pending.kind === 'run') {
      startPendingRun(e);
    } else if (tapped === pending.id) {
      st.notify('Tap the player receiving the ' + pending.kind);
    } else {
      if (pending.kind === 'option') st.addOption(pending.altOf!, tapped);
      else st.addPass(tapped, pending.kind);
      st.finishPending();
    }
    return true;
  };

  const startPendingRun = (e: PointerEvent) => {
    const st = useStore.getState();
    const id = st.pending!.id;
    const origin = timelineOf(st.play).phases[st.phaseIdx].startPos[id];
    const p = toPitch(e);
    capture(e);
    drag.current = { kind: 'run', id, pts: [origin], pending: true, shift: { x: origin.x - p.x, y: origin.y - p.y } };
    setStroke([origin]);
  };

  const onPlayerDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button === 2) return; // right-click is handled by onPlayerMenu
    if (handlePending(e, id)) return;
    const st = useStore.getState();
    st.closePopover();
    const ph = timelineOf(st.play).phases[st.phaseIdx];
    const origin = ph.startPos[id];
    // Scrubbed into the phase? Tapping keeps the moment in view; only drawing a new run goes back to the start.
    const atStart = st.time - ph.start < 0.01;
    capture(e);

    if (st.tool === 'pass' || st.tool === 'kick') {
      st.addPass(id, st.tool);
      return;
    }
    st.select(id);
    const p = toPitch(e);
    if (st.tool === 'run') {
      st.goPhase(st.phaseIdx);
      drag.current = { kind: 'run', id, pts: [origin] };
      setStroke([origin]);
    } else if (st.phaseIdx === 0 && atStart) {
      drag.current = { kind: 'move', id, off: { x: origin.x - p.x, y: origin.y - p.y }, from: p, moved: false };
    } else {
      drag.current = { kind: 'blocked', id, from: p, moved: false };
    }
  };

  /** Grab a run line: bend it around the grabbed point, or move its end. Only the part ahead of the player changes. */
  const onRunDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button === 2) return;
    const st = useStore.getState();
    const ph = timelineOf(st.play).phases[st.phaseIdx];
    const r = ph.runs[id];
    if (!r) return;
    st.closePopover();
    st.select(id);
    capture(e);
    const base = resample(r.path, 0.8);
    const len = pathLength(base);
    const from = distanceAt(r.run, r.len, clamp(st.time - ph.start, 0, ph.duration));
    const p = toPitch(e);
    const s = nearestOnPath(base, p).s;
    // Near the arrowhead moves the destination; anywhere else bends the line.
    const grab = len - s < Math.max(2, len * 0.15) ? len : s;
    drag.current = { kind: 'bend', id, base, start: p, from, grab, moved: false };
  };

  const onPlayerMenu = (e: MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    st.goPhase(st.phaseIdx);
    st.select(id);
    st.openPopover({ id });
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button === 2) return;
    if (useStore.getState().pending?.kind === 'run') {
      startPendingRun(e);
      return;
    }
    capture(e);
    const p = toScreen(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      // Second finger down: switch from panning to pinch zoom.
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pinch', dist: dist(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    } else {
      drag.current = { kind: 'pan', from: p, last: p, moved: false };
    }
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const st = useStore.getState();

    if (d.kind === 'pan' || d.kind === 'pinch') {
      if (!pointers.current.has(e.pointerId)) return;
      const s = toScreen(e);
      pointers.current.set(e.pointerId, s);
      if (d.kind === 'pinch') {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        const nd = dist(a, b);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (d.dist > 0) st.zoomBy(nd / d.dist, mid);
        st.panBy(mid.x - d.mid.x, mid.y - d.mid.y);
        drag.current = { kind: 'pinch', dist: nd, mid };
      } else {
        if (!d.moved && dist(d.from, s) < PAN_SLOP) return;
        if (!d.moved) setPanning(true);
        d.moved = true;
        st.panBy(s.x - d.last.x, s.y - d.last.y);
        d.last = s;
      }
      return;
    }

    let p = toPitch(e);
    if (d.kind === 'run' && d.shift) p = { x: p.x + d.shift.x, y: p.y + d.shift.y };
    if (d.kind === 'bend') {
      if (!d.moved && dist(d.start, p) < TAP_SLOP) return;
      d.moved = true;
      const delta = { x: p.x - d.start.x, y: p.y - d.start.y };
      st.setRun(d.id, warpPath(d.base, delta, d.from, d.grab), `bend:${d.id}`);
    } else if (d.kind === 'move') {
      if (!d.moved && dist(d.from, p) < TAP_SLOP) return;
      d.moved = true;
      st.updatePlayer(d.id, { x: clamp(p.x + d.off.x, -12, 112), y: clamp(p.y + d.off.y, -4, 74) }, `move:${d.id}`);
    } else if (d.kind === 'run') {
      if (dist(d.pts[d.pts.length - 1], p) > 0.4) {
        d.pts.push(p);
        setStroke([...d.pts]);
      }
    } else if (!d.moved && dist(d.from, p) > 1.5) {
      d.moved = true;
      st.notify(
        st.phaseIdx === 0
          ? 'Drag their running line to change where they go — or go back to the start to move them'
          : 'Players start where they finished — drag their running line to change where they go',
      );
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === 'pinch') {
      // Lifting one finger of a pinch ends it; the remaining finger doesn't start a pan.
      if (pointers.current.size === 0) drag.current = null;
      return;
    }
    drag.current = null;
    if (!d) return;
    const st = useStore.getState();
    if (d.kind === 'pan') {
      setPanning(false);
      if (d.moved) return;
      // A tap on the grass: cancel a waiting pass/kick, or put down the selected player.
      if (st.pending) st.cancelPending();
      else {
        st.closePopover();
        if (st.tool === 'select' || st.tool === 'run') st.select(null);
      }
    } else if (d.kind === 'run') {
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

  return (
    <div className="board" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={panning ? 'panning' : undefined}
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
          onRunDown={!playing && !pending && (tool === 'select' || tool === 'run') ? onRunDown : undefined}
        />
      </svg>
    </div>
  );
}
