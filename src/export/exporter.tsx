import { renderToStaticMarkup } from 'react-dom/server';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import sceneCss from '../scene.css?raw';
import { buildTimeline, frameAt, type Timeline } from '../model/engine';
import { clamp } from '../model/geometry';
import type { Play } from '../model/types';
import { Scene } from '../components/Scene';
import type { ViewRect } from '../model/camera';
import type { Orientation } from '../store';

export type ExportFormat = 'mp4' | 'gif';

export interface ExportOptions {
  format: ExportFormat;
  lines: boolean;
  notes: boolean;
  title: boolean;
  /** The part of the pitch to film, in view space: what's on screen when exporting. */
  viewBox: ViewRect;
  orientation: Orientation;
  /** Option pass to play instead of the main line (see buildTimeline). */
  option: string | null;
}

const SETTINGS: Record<ExportFormat, { fps: number; maxDim: number }> = {
  mp4: { fps: 30, maxDim: 1280 },
  gif: { fps: 15, maxDim: 640 },
};
/** Seconds of still frame before the play starts and after it ends. */
const LEAD_IN = 0.6;
const HOLD_END = 1.5;

export async function canExportMp4() {
  try {
    return typeof VideoEncoder !== 'undefined' && (await canEncodeVideo('avc', { width: 720, height: 1280 }));
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  s.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

/** e.g. "crash-ball.mp4", or "crash-ball-option-13.mp4" when an option is exported. */
export const fileName = (play: Play, format: ExportFormat, option: string | null = null) => {
  const opt = option && play.phases.flatMap((ph) => ph.passes).find((p) => p.id === option);
  const to = opt && play.players.find((p) => p.id === opt.to);
  return `${slug(play.name) || 'play'}${to ? `-option-${to.num}` : ''}.${format}`;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not draw a frame of the play'));
    };
    img.src = url;
  });
}

/** Draws frames of a play onto a canvas: the pitch scene, then title and coaching-note overlays. */
class FrameRenderer {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  private readonly vb: ViewRect;
  private readonly vertical: boolean;
  private lastSvg = '';

  constructor(
    private readonly play: Play,
    private readonly tl: Timeline,
    private readonly opts: ExportOptions,
  ) {
    this.vertical = opts.orientation === 'ns';
    this.vb = opts.viewBox;
    const scale = SETTINGS[opts.format].maxDim / Math.max(this.vb.w, this.vb.h);
    this.canvas.width = even(this.vb.w * scale);
    this.canvas.height = even(this.vb.h * scale);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: opts.format === 'gif' })!;
  }

  async draw(t: number) {
    const { play, tl, opts, vb, canvas, ctx } = this;
    const frame = frameAt(tl, t);
    const svg = renderToStaticMarkup(
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width={canvas.width}
        height={canvas.height}
      >
        <style>{sceneCss}</style>
        <Scene play={play} phase={tl.phases[frame.phase]} frame={frame} vertical={this.vertical} showLines={opts.lines} dimLines />
      </svg>,
    );
    // Still frames (lead-in, hold, pauses) reuse what is already on the canvas.
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    ctx.drawImage(await loadSvg(svg), 0, 0, canvas.width, canvas.height);
    this.drawOverlay(frame.phase);
  }

  private drawOverlay(phaseIdx: number) {
    const { ctx, canvas, play, opts } = this;
    const w = canvas.width;
    const h = canvas.height;
    const u = Math.min(w, h) / 26;
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${u}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

    if (opts.title) {
      const phases = play.phases.length;
      const label = phases > 1 ? `${play.name} · Phase ${phaseIdx + 1}/${phases}` : play.name;
      const tw = Math.min(ctx.measureText(label).width, w - 3 * u);
      box(ctx, u * 0.6, u * 0.6, tw + u * 1.4, u * 2, u);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, u * 1.3, u * 1.6, tw);
    }

    const note = opts.notes ? play.phases[phaseIdx]?.note.trim() : '';
    if (note) {
      ctx.font = `500 ${u}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const lines = wrap(ctx, note, w - u * 4).slice(0, 4);
      const lh = u * 1.35;
      const bh = lines.length * lh + u * 1.2;
      const by = h - bh - u * 0.8;
      box(ctx, u * 0.8, by, w - u * 1.6, bh, u * 0.6);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(u * 0.8, by, u * 0.3, bh);
      ctx.fillStyle = '#fff';
      lines.forEach((line, i) => ctx.fillText(line, u * 1.8, by + u * 0.6 + lh * (i + 0.5)));
    }
  }
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.fillStyle = 'rgba(8, 15, 28, 0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/** Render the whole play to an MP4 or GIF, frame by frame (not in real time, so it's smooth on slow devices). */
export async function exportPlay(
  play: Play,
  opts: ExportOptions,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const tl = buildTimeline(play, opts.option);
  const r = new FrameRenderer(play, tl, opts);
  const { fps } = SETTINGS[opts.format];
  const frames = Math.ceil((LEAD_IN + tl.total + HOLD_END) * fps);
  const timeAt = (i: number) => clamp(i / fps - LEAD_IN, 0, tl.total);

  if (opts.format === 'mp4') {
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(r.canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    try {
      for (let i = 0; i < frames; i++) {
        checkAbort(signal);
        await r.draw(timeAt(i));
        await source.add(i / fps, 1 / fps);
        onProgress((i + 1) / frames);
      }
    } catch (e) {
      await output.cancel();
      throw e;
    }
    await output.finalize();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  }

  // GIF: one shared palette, sampled from a frame in every phase so all colours that appear are covered.
  const samples: Uint8ClampedArray[] = [];
  for (const ph of tl.phases) {
    await r.draw(ph.start + ph.duration / 2);
    samples.push(r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height).data);
  }
  const pixels = new Uint8ClampedArray(samples.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  for (const s of samples) {
    pixels.set(s, offset);
    offset += s.length;
  }
  const palette = quantize(pixels, 256);

  const gif = GIFEncoder();
  const { width, height } = r.canvas;
  for (let i = 0; i < frames; i++) {
    checkAbort(signal);
    await r.draw(timeAt(i));
    const index = applyPalette(r.ctx.getImageData(0, 0, width, height).data, palette);
    gif.writeFrame(index, width, height, i === 0 ? { palette, delay: 1000 / fps, repeat: 0 } : { delay: 1000 / fps });
    onProgress((i + 1) / frames);
    // Let the progress bar paint.
    if (i % 5 === 0) await new Promise((res) => setTimeout(res));
  }
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
}
