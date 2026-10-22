import { useRef, useState } from 'react';
import { useStore } from '../store';
import { PRESETS, makePreset } from '../model/presets';
import { deletePlay, importPlays, loadLibrary, parsePlaybook, playbookFile } from '../storage';

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Library() {
  const open = useStore((s) => s.libraryOpen);
  return open ? <LibraryPanel /> : null;
}

function LibraryPanel() {
  const current = useStore((s) => s.play);
  const [, refresh] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const st = useStore.getState();
  const close = () => st.setLibraryOpen(false);
  // Include the open play as it is now, even if autosave hasn't caught up.
  const plays = Object.values({ ...loadLibrary(), [current.id]: current }).sort((a, b) => b.updated - a.updated);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChosen = plays.length > 0 && plays.every((p) => chosen.has(p.id));

  const exportChosen = () => {
    const list = plays.filter((p) => chosen.has(p.id));
    download(playbookFile(list));
    st.notify(`Exported ${list.length} play${list.length === 1 ? '' : 's'}`);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { added, skipped } = importPlays(parsePlaybook(await file.text()));
      st.notify(
        added
          ? `Imported ${added} play${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} already here` : ''}`
          : 'Those plays are already on this device',
      );
      refresh((n) => n + 1);
    } catch (e) {
      st.notify((e as Error).message);
    }
  };

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

        <div className="saved-head">
          <h4>Saved on this device</h4>
          <button className="small" onClick={() => fileInput.current?.click()}>
            Import file…
          </button>
          <button className="small primary" disabled={chosen.size === 0} onClick={exportChosen}>
            Export {chosen.size || ''}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              onImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="muted">
          Plays stay on this device. Tick plays and Export to save them to a playbook file — import it on another
          device or send it to your coaching staff.
        </p>
        {plays.length > 1 && (
          <label className="check select-all">
            <input
              type="checkbox"
              checked={allChosen}
              onChange={() => setChosen(allChosen ? new Set() : new Set(plays.map((p) => p.id)))}
            />
            Select all
          </label>
        )}
        <ul className="saved">
          {plays.map((p) => (
            <li key={p.id} className={p.id === current.id ? 'current' : ''}>
              <input
                type="checkbox"
                className="pick"
                checked={chosen.has(p.id)}
                onChange={() => toggle(p.id)}
                aria-label={`Select ${p.name}`}
              />
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
                disabled={p.id === current.id}
                onClick={() => {
                  if (confirm(`Delete “${p.name}”?`)) {
                    deletePlay(p.id);
                    setChosen((prev) => {
                      const next = new Set(prev);
                      next.delete(p.id);
                      return next;
                    });
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
