import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
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
