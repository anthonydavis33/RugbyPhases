import { useState } from 'react';
import { useStore } from '../store';
import { PRESETS, makePreset } from '../model/presets';
import { deletePlay, loadLibrary } from '../storage';

export function Library() {
  const open = useStore((s) => s.libraryOpen);
  const currentId = useStore((s) => s.play.id);
  const [, refresh] = useState(0);
  if (!open) return null;

  const st = useStore.getState();
  const close = () => st.setLibraryOpen(false);
  const plays = Object.values(loadLibrary()).sort((a, b) => b.updated - a.updated);

  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Plays</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <h4>Start a new play</h4>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                st.load(makePreset(p.key));
                close();
              }}
            >
              <strong>{p.title}</strong>
              <span>{p.desc}</span>
            </button>
          ))}
        </div>
        <h4>Saved on this device</h4>
        {plays.length === 0 && <p className="muted">Nothing saved yet — plays save automatically as you edit.</p>}
        <ul className="saved">
          {plays.map((p) => (
            <li key={p.id} className={p.id === currentId ? 'current' : ''}>
              <div>
                <strong>{p.name || 'Untitled'}</strong>
                <span className="muted">
                  {p.phases.length} phase{p.phases.length === 1 ? '' : 's'} · {new Date(p.updated).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => {
                  st.load(p);
                  close();
                }}
              >
                Open
              </button>
              <button
                className="danger"
                disabled={p.id === currentId}
                onClick={() => {
                  if (confirm(`Delete “${p.name}”?`)) {
                    deletePlay(p.id);
                    refresh((n) => n + 1);
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
