import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
import { FILM_TAB, emptyFilm, useFilm } from './film/store';
import { lastPlay, readSharedPlay, savePlay } from './storage';
import './scene.css';
import './styles.css';

const shared = readSharedPlay();
if (shared) {
  useStore.getState().load(shared);
  history.replaceState(null, '', location.pathname + location.search);
  useStore.getState().notify('Opened a shared play — it’s now saved on this device');
} else {
  const last = lastPlay();
  if (last) useStore.getState().load(last);
}

// ?video=<url>&film=<url> opens the Film tab with that clip (handy for local sample footage).
// While the tab is hidden this only works on the dev server.
const params = new URLSearchParams(location.search);
const videoParam = params.get('video');
const filmParam = params.get('film');
if ((FILM_TAB || import.meta.env.DEV) && (videoParam || filmParam || params.get('mode') === 'film')) {
  const film = useFilm.getState();
  film.setMode('film');
  if (filmParam) {
    fetch(filmParam)
      .then((r) => r.json())
      .then((f) => useFilm.getState().load(f))
      .catch(() => useStore.getState().notify('Couldn’t load that film file'));
  }
  if (videoParam) {
    // A different clip starts a fresh film; the same clip keeps its saved marking.
    const name = decodeURIComponent(videoParam.split('/').pop() ?? 'video');
    if (!filmParam && film.film.video?.name !== name) {
      film.load({ ...emptyFilm(), name: name.replace(/\.[^.]+$/, ''), video: { name, width: 0, height: 0, duration: 0 } });
    }
    film.setVideo(videoParam);
  }
}

// Autosave shortly after edits settle.
let saveTimer: number | undefined;
savePlay(useStore.getState().play);
useStore.subscribe((s, prev) => {
  if (s.play === prev.play) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => savePlay(useStore.getState().play), 400);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
