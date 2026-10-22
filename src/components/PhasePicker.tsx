import { useStore } from '../store';
import { loadLibrary } from '../storage';

/** Choose a saved play whose phases are added onto the end of the open play. */
export function PhasePicker() {
  const open = useStore((s) => s.pickerOpen);
  const currentId = useStore((s) => s.play.id);
  if (!open) return null;

  const st = useStore.getState();
  const close = () => st.setPickerOpen(false);
  const plays = Object.values(loadLibrary())
    .filter((p) => p.id !== currentId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="modal-back" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Add phases from a play</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <p className="muted">
          Its phases are added after phase {st.play.phases.length}. Players are matched by team and number, and carry on
          from where they finished.
        </p>
        {plays.length === 0 && <p className="muted">No other saved plays yet. Build or import one from Plays first.</p>}
        <ul className="saved">
          {plays.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name || 'Untitled'}</strong>
                <span className="muted">
                  {p.phases.length} phase{p.phases.length === 1 ? '' : 's'}
                  {p.phases[0]?.note ? ` · ${p.phases[0].note}` : ''}
                </span>
              </div>
              <button
                className="primary"
                onClick={() => {
                  st.appendPlay(p);
                  close();
                }}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
