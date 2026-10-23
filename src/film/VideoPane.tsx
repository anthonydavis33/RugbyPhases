import { useEffect, useRef, type PointerEvent } from 'react';
import type { Vec } from '../model/types';
import { applyHomography, invertHomography, orientTowards } from './homography';
import { PITCH_LINES } from './pitchLines';
import { cameraAt, keyframeAt, keyframeHomography, registerVideo, useFilm } from './store';
import type { Homography } from './types';

/** Points per pitch line when projecting, so lines are clipped cleanly at the horizon. */
const STEPS = 32;

const SOURCE_LABEL = {
  marked: 'Reference frame',
  followed: 'Camera followed',
  nearest: 'From nearest reference frame — will drift as the camera pans',
};

export function VideoPane() {
  const videoUrl = useFilm((s) => s.videoUrl);
  const film = useFilm((s) => s.film);
  const time = useFilm((s) => s.time);
  const playing = useFilm((s) => s.playing);
  const calibrating = useFilm((s) => s.calibrating);
  const pendingImg = useFilm((s) => s.pendingImg);
  const videoRef = useRef<HTMLVideoElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    registerVideo(videoRef.current);
    return () => registerVideo(null);
  }, [videoUrl]);

  // While playing, the video is the clock.
  useEffect(() => {
    if (!playing || !videoUrl) return;
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) useFilm.getState().setTime(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, videoUrl]);

  if (!videoUrl) {
    return (
      <div className="video-pane empty">
        <p>
          <strong>No video loaded.</strong>
          <br />
          Open a clip (e.g. a Veo download) to mark the pitch and check tracking, or make a demo film from one of your plays.
        </p>
      </div>
    );
  }

  const W = film.video?.width ?? 1920;
  const H = film.video?.height ?? 1080;
  const cam = cameraAt(film, time);
  const kf = keyframeAt(film, time);
  const kfH = kf && kf.points.length >= 4 ? keyframeHomography(kf.points) : null;

  const toImage = (e: PointerEvent): Vec => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  return (
    <div className={`video-pane${calibrating ? ' calibrating' : ''}`}>
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          const st = useFilm.getState();
          st.setDuration(v.duration);
          const name = decodeURIComponent(videoUrl.split('/').pop() ?? 'video');
          useFilm.setState((s) => ({
            film: { ...s.film, video: { name: s.film.video?.name ?? name, width: v.videoWidth, height: v.videoHeight, duration: v.duration } },
          }));
        }}
        onSeeked={(e) => useFilm.getState().setTime(e.currentTarget.currentTime)}
        onEnded={() => useFilm.getState().setPlaying(false)}
      />
      <svg
        ref={svgRef}
        className="video-overlay"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={calibrating ? (e) => useFilm.getState().addImagePoint(toImage(e)) : undefined}
      >
        <defs>
          <clipPath id="video-frame">
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        {cam && (
          <g clipPath="url(#video-frame)">
            <PitchOverlay h={cam.h} w={W} hgt={H} />
          </g>
        )}
        {kf?.points.map((p, i) => {
          // Where this frame's fit puts the marked pitch spot: far from the click means a mistake.
          const g = kfH && invertHomography(kfH);
          const back = g ? applyHomography(orientTowards(g, p.pitch), p.pitch) : null;
          return (
            <g key={i} className="calib-mark">
              {back && <line x1={p.img.x} y1={p.img.y} x2={back.x} y2={back.y} className="residual" />}
              <circle cx={p.img.x} cy={p.img.y} r={14} />
              <text x={p.img.x} y={p.img.y}>
                {i + 1}
              </text>
            </g>
          );
        })}
        {pendingImg && <circle cx={pendingImg.x} cy={pendingImg.y} r={16} className="calib-pending" />}
      </svg>
      {cam && <div className={`overlay-source ${cam.source}`}>{SOURCE_LABEL[cam.source]}</div>}
      {calibrating && (
        <div className="calib-hint">
          {pendingImg ? 'Now click the same spot on the pitch map →' : 'Click a line crossing or post on the video'}
        </div>
      )}
    </div>
  );
}

/** The pitch markings drawn onto the video through the camera's homography. */
function PitchOverlay({ h, w, hgt }: { h: Homography; w: number; hgt: number }) {
  const inv = invertHomography(h);
  if (!inv) return null;
  // A pitch point the camera can definitely see: wherever the middle of the picture lands.
  const centre = applyHomography(h, { x: w / 2, y: hgt * 0.75 });
  const g = centre ? orientTowards(inv, centre) : inv;
  const limit = Math.max(w, hgt) * 4;

  return (
    <g className="pitch-overlay">
      {PITCH_LINES.map((l, i) => {
        // Project in small steps and break the line where it goes behind the camera or far off screen.
        const runs: Vec[][] = [[]];
        for (let k = 0; k <= STEPS; k++) {
          const u = k / STEPS;
          const p = applyHomography(g, { x: l.a.x + (l.b.x - l.a.x) * u, y: l.a.y + (l.b.y - l.a.y) * u });
          if (p && Math.abs(p.x - w / 2) < limit && Math.abs(p.y - hgt / 2) < limit) runs[runs.length - 1].push(p);
          else if (runs[runs.length - 1].length) runs.push([]);
        }
        return runs
          .filter((r) => r.length > 1)
          .map((r, j) => (
            <polyline
              key={`${i}-${j}`}
              points={r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              className={l.dashed ? 'dashed' : undefined}
            />
          ));
      })}
    </g>
  );
}
