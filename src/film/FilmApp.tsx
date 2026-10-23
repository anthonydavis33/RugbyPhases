import { useEffect, useRef } from 'react';
import { ModeTabs } from '../components/ModeTabs';
import { Toast } from '../components/Controls';
import { useStore } from '../store';
import { demoFilm } from './demo';
import { FilmPitch } from './FilmPitch';
import { applyHomography, invertHomography, orientTowards } from './homography';
import { emptyFilm, keyframeHomography, useFilm } from './store';
import type { Film } from './types';
import { VideoPane } from './VideoPane';

/** One video frame at Veo's 29.97 fps, for frame-by-frame stepping. */
const FRAME = 1 / 29.97;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'clip';

export function FilmApp() {
  const playing = useFilm((s) => s.playing);
  const videoUrl = useFilm((s) => s.videoUrl);

  // Without a video, a timer drives playback of the tracks.
  useEffect(() => {
    if (!playing || videoUrl) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const s = useFilm.getState();
      const t = s.time + ((now - last) / 1000) * s.rate;
      last = now;
      if (t >= s.duration) {
        s.setTime(s.duration);
        s.setPlaying(false);
        return;
      }
      s.setTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, videoUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const s = useFilm.getState();
      if (e.key === ' ') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        s.setPlaying(false);
        const step = (e.shiftKey ? 1 : FRAME) * (e.key === 'ArrowRight' ? 1 : -1);
        s.seek(s.time + step);
      } else if (e.key === 'Escape') {
        if (s.pendingImg) s.addImagePoint(null);
        else s.setCalibrating(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="film-app">
      <FilmTopBar />
      <main className="film-video">
        <VideoPane />
      </main>
      <section className="film-board">
        <FilmPitch />
      </section>
      <FilmTransport />
      <aside className="panel film-panel">
        <CalibrationPanel />
        <TracksPanel />
      </aside>
      <Toast />
    </div>
  );
}

function FilmTopBar() {
  const name = useFilm((s) => s.film.name);
  const videoInput = useRef<HTMLInputElement>(null);
  const filmInput = useRef<HTMLInputElement>(null);
  const notify = (m: string) => useStore.getState().notify(m);

  const openVideo = (file: File | undefined) => {
    if (!file) return;
    const st = useFilm.getState();
    // A different clip starts a fresh film; re-opening the same clip keeps its marking.
    if (st.film.video?.name !== file.name) st.load({ ...emptyFilm(), name: file.name.replace(/\.[^.]+$/, '') });
    useFilm.setState((s) => ({ film: { ...s.film, video: { name: file.name, width: 0, height: 0, duration: 0 } } }));
    st.setVideo(URL.createObjectURL(file));
  };

  const openFilm = async (file: File | undefined) => {
    if (!file) return;
    try {
      const film = JSON.parse(await file.text()) as Film;
      if (film.format !== 'rugby-phases-film') throw new Error();
      useFilm.getState().load(film);
      notify(`Opened “${film.name}”${film.video ? ` — open ${film.video.name} to see the video` : ''}`);
    } catch {
      notify('That file isn’t a Rugby Phases film file');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◖◗</span>
      </div>
      <ModeTabs />
      <input
        className="play-name"
        value={name}
        aria-label="Clip name"
        onChange={(e) => useFilm.setState((s) => ({ film: { ...s.film, name: e.target.value } }))}
      />
      <div className="topbar-actions">
        <button onClick={() => videoInput.current?.click()}>Open video…</button>
        <button
          onClick={() => {
            const play = useStore.getState().play;
            useFilm.getState().setVideo(null);
            useFilm.getState().load(demoFilm(play));
            notify(`Demo film made from “${play.name}”`);
          }}
          title="Pretend tracking data made from the play open in the Plays tab"
        >
          Demo film
        </button>
        <button onClick={() => filmInput.current?.click()}>Open film file…</button>
        <button
          className="primary"
          onClick={() => {
            const f = useFilm.getState().film;
            download(`${slug(f.name)}.film.json`, JSON.stringify(f));
          }}
        >
          Save film file
        </button>
        <input ref={videoInput} type="file" accept="video/*" hidden onChange={(e) => (openVideo(e.target.files?.[0]), (e.target.value = ''))} />
        <input
          ref={filmInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => (openFilm(e.target.files?.[0]), (e.target.value = ''))}
        />
      </div>
    </header>
  );
}

function FilmTransport() {
  const time = useFilm((s) => s.time);
  const duration = useFilm((s) => s.duration);
  const playing = useFilm((s) => s.playing);
  const rate = useFilm((s) => s.rate);
  const keyframes = useFilm((s) => s.film.keyframes);
  const st = useFilm.getState();
  const rates = [0.25, 0.5, 1];

  return (
    <div className="timeline film-transport">
      <div className="transport">
        <button className="play-btn" onClick={st.togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => st.seek(time - FRAME)} title="Back one frame (←)" aria-label="Back one frame">
          ‹
        </button>
        <button onClick={() => st.seek(time + FRAME)} title="Forward one frame (→)" aria-label="Forward one frame">
          ›
        </button>
        <div className="scrub">
          <div className="ticks keyframe-ticks">
            {duration > 0 && keyframes.map((k) => <span key={k.t} style={{ left: `${(k.t / duration) * 100}%` }} />)}
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.001}
            value={time}
            aria-label="Scrub"
            onChange={(e) => {
              st.setPlaying(false);
              st.seek(Number(e.target.value));
            }}
          />
        </div>
        <span className="clock">
          {time.toFixed(2)} / {duration.toFixed(1)}s
        </span>
        <button className="rate" onClick={() => st.setRate(rates[(rates.indexOf(rate) + 1) % rates.length])}>
          {rate}×
        </button>
      </div>
    </div>
  );
}

/** Average distance (video pixels) between where points were clicked and where the fit puts them. */
function fitError(points: { img: { x: number; y: number }; pitch: { x: number; y: number } }[]): number | null {
  const h = keyframeHomography(points);
  const g = h && invertHomography(h);
  if (!g) return null;
  const errs = points.map((p) => {
    const q = applyHomography(orientTowards(g, p.pitch), p.pitch);
    return q ? Math.hypot(q.x - p.img.x, q.y - p.img.y) : Infinity;
  });
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

function CalibrationPanel() {
  const film = useFilm((s) => s.film);
  const calibrating = useFilm((s) => s.calibrating);
  const videoUrl = useFilm((s) => s.videoUrl);
  const st = useFilm.getState();
  const followed = film.camera.filter((c) => c.h).length;

  return (
    <section>
      <header>
        <h3>Pitch marking</h3>
      </header>
      {!videoUrl ? (
        <p className="muted">Open a video to mark where the pitch is.</p>
      ) : (
        <>
          <ol className="steps">
            <li>Pause on a frame where several pitch lines are clear.</li>
            <li>Click a line crossing (or post) on the video, then the same spot on the pitch map.</li>
            <li>Mark at least 4 spots, spread out. Lines appear on the video — check they sit on the real ones.</li>
          </ol>
          <button className={`block${calibrating ? ' primary' : ''}`} onClick={() => st.setCalibrating(!calibrating)}>
            {calibrating ? 'Done marking' : 'Mark reference points'}
          </button>
        </>
      )}

      {film.keyframes.length > 0 && (
        <>
          <h4>Reference frames</h4>
          <ul className="keyframes">
            {film.keyframes.map((k) => {
              const err = k.points.length >= 4 ? fitError(k.points) : null;
              return (
                <li key={k.t}>
                  <button className="small" onClick={() => (st.setPlaying(false), st.seek(k.t))}>
                    {k.t.toFixed(2)}s
                  </button>
                  <span className="muted">
                    {k.points.length} point{k.points.length === 1 ? '' : 's'}
                    {err !== null && ` · ${err < 8 ? 'good fit' : err < 25 ? 'rough fit' : 'check points'} (${err.toFixed(0)}px)`}
                  </span>
                  <button className="icon-btn" onClick={() => st.removeKeyframe(k.t)} aria-label="Delete reference frame">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4>Camera following</h4>
      {followed ? (
        <p className="muted">
          Followed through {followed} of {film.camera.length} moments. Scrub the clip — the lines should stay on the real
          pitch markings.
        </p>
      ) : (
        <p className="muted">
          Not followed yet. Save the film file, then run the camera-follow tool on it with the video (see
          processor/README.md), and open the file it writes.
        </p>
      )}
    </section>
  );
}

function TracksPanel() {
  const film = useFilm((s) => s.film);
  const selected = useFilm((s) => s.selectedTrack);
  const st = useFilm.getState();
  if (film.tracks.length === 0) return null;
  const known = film.tracks.filter((t) => t.num).length;

  return (
    <section>
      <header>
        <h3>Players</h3>
        <span className="muted">
          {film.tracks.length} tracked · {known} numbered
        </span>
      </header>
      <ul className="tracks">
        {film.tracks.map((t) => (
          <li key={t.id} className={selected === t.id ? 'on' : ''} onClick={() => st.selectTrack(selected === t.id ? null : t.id)}>
            <span className={`dot small ${t.team ?? 'defence'}`}>{t.num || '?'}</span>
            <select
              value={t.team ?? ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => st.updateTrack(t.id, { team: (e.target.value || null) as typeof t.team })}
              aria-label="Team"
            >
              <option value="">Unknown team</option>
              <option value="attack">Us</option>
              <option value="defence">Opposition</option>
            </select>
            <input
              type="number"
              min={0}
              max={99}
              value={t.num || ''}
              placeholder="No."
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => st.updateTrack(t.id, { num: Number(e.target.value) || 0 })}
              aria-label="Shirt number"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
