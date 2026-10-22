import { timelineOf, useStore, type Tool } from '../store';
import { shareUrl } from '../storage';

export function TopBar() {
  const name = useStore((s) => s.play.name);
  const commit = useStore((s) => s.commit);
  const setLibraryOpen = useStore((s) => s.setLibraryOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);

  const share = async () => {
    const st = useStore.getState();
    const url = shareUrl(st.play);
    try {
      await navigator.clipboard.writeText(url);
      st.notify('Share link copied — it opens the play in any browser');
    } catch {
      window.prompt('Copy this link to share the play', url);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◖◗</span>
        <span className="brand-name">Rugby Phases</span>
      </div>
      <input
        className="play-name"
        value={name}
        aria-label="Play name"
        onChange={(e) =>
          commit((p) => {
            p.name = e.target.value;
          }, 'name')
        }
      />
      <div className="topbar-actions">
        <button onClick={() => setLibraryOpen(true)}>Plays</button>
        <button onClick={() => setExportOpen(true)}>Export</button>
        <button className="primary" onClick={share}>
          Share
        </button>
      </div>
    </header>
  );
}

const TOOLS: { tool: Tool; label: string; icon: string; key: string }[] = [
  { tool: 'select', label: 'Move', icon: '✥', key: 'M' },
  { tool: 'run', label: 'Run', icon: '➜', key: 'R' },
  { tool: 'pass', label: 'Pass', icon: '⇢', key: 'P' },
  { tool: 'kick', label: 'Kick', icon: '⤴', key: 'K' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const orientation = useStore((s) => s.orientation);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();

  return (
    <div className="toolbar" role="toolbar">
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool${tool === t.tool ? ' on' : ''}`}
            onClick={() => st.setTool(t.tool)}
            title={`${t.label} (${t.key})`}
          >
            <span className="icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="group">
        <button onClick={() => st.addPlayer('attack')}>
          <span className="swatch attack" />+ Attack
        </button>
        <button onClick={() => st.addPlayer('defence')}>
          <span className="swatch defence" />+ Defence
        </button>
      </div>
      <div className="group">
        <button onClick={st.undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={st.redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button onClick={() => st.setView(view === 'full' ? 'fit' : 'full')}>
          {view === 'full' ? 'Zoom to play' : 'Full pitch'}
        </button>
        <button
          onClick={() => st.setOrientation(orientation === 'ns' ? 'ew' : 'ns')}
          title="Switch pitch direction"
          aria-label={orientation === 'ns' ? 'Pitch runs north–south' : 'Pitch runs east–west'}
        >
          <span className="icon">{orientation === 'ns' ? '↕' : '↔'}</span>
          {orientation === 'ns' ? 'N/S' : 'E/W'}
        </button>
      </div>
    </div>
  );
}

export function Hint() {
  const tool = useStore((s) => s.tool);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const playing = useStore((s) => s.playing);
  const play = useStore((s) => s.play);
  const pending = useStore((s) => s.pending);
  if (playing) return null;
  const holderId = timelineOf(play).phases[phaseIdx].endHolder;
  const holder = play.players.find((p) => p.id === holderId);
  const pendingNum = pending && play.players.find((p) => p.id === pending.id)?.num;

  let text: string;
  if (pending) {
    text =
      pending.kind === 'run'
        ? `Drag anywhere to draw #${pendingNum}’s run · Esc to cancel`
        : `Tap who #${pendingNum} ${pending.kind === 'kick' ? 'kicks' : 'passes'} to · Esc to cancel`;
  } else if (tool === 'select') {
    text = phaseIdx === 0 ? 'Drag players to set the starting shape' : 'Tap a player to edit them';
  } else if (tool === 'run') {
    text = 'Drag from a player to draw their run';
  } else if (!holder) {
    text = 'Nobody has the ball — pick a player in phase 1 and tap “Give ball”';
  } else {
    text = `#${holder.num} has the ball — tap who ${tool === 'kick' ? 'the kick goes to' : 'to pass to'}`;
  }
  return <div className="hint">{text}</div>;
}

export function NoteOverlay() {
  const play = useStore((s) => s.play);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const note = play.phases[phaseIdx]?.note.trim();
  if (!note) return null;
  return <div className="note-overlay">{note}</div>;
}

export function Timeline() {
  const play = useStore((s) => s.play);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const tl = timelineOf(play);
  const st = useStore.getState();
  const rates = [0.5, 1, 2];

  return (
    <div className="timeline">
      <div className="transport">
        <button className="play-btn" onClick={st.togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="scrub">
          <div className="ticks">
            {tl.phases.slice(1).map((p, i) => (
              <span key={i} style={{ left: `${(p.start / tl.total) * 100}%` }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={tl.total}
            step={0.01}
            value={time}
            aria-label="Scrub"
            onChange={(e) => st.seek(Number(e.target.value))}
          />
        </div>
        <span className="clock">
          {time.toFixed(1)} / {tl.total.toFixed(1)}s
        </span>
        <button className="rate" onClick={() => st.setRate(rates[(rates.indexOf(rate) + 1) % rates.length])}>
          {rate}×
        </button>
      </div>
      <div className="phases">
        {play.phases.map((p, i) => (
          <button key={p.id} className={i === phaseIdx ? 'on' : ''} onClick={() => st.goPhase(i)}>
            Phase {i + 1}
          </button>
        ))}
        <button className="add" onClick={st.addPhase}>
          + Phase
        </button>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast">{toast}</div> : null;
}
