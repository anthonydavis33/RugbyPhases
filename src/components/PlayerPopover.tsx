import { timelineOf, useStore, type Pending } from '../store';

const ACTIONS: { kind: Pending['kind']; label: string; icon: string; key: string; needsBall: boolean }[] = [
  { kind: 'run', label: 'Move', icon: '➜', key: 'M', needsBall: false },
  { kind: 'pass', label: 'Pass', icon: '⇢', key: 'P', needsBall: true },
  { kind: 'kick', label: 'Kick', icon: '⤴', key: 'K', needsBall: true },
];

/**
 * Bar for the tapped player, laid out between the pitch and the timeline so it
 * never covers either: when their passes and kicks leave their hands, when
 * their run starts, and buttons to add a run, pass or kick. Dragging a slider
 * moves the playhead to that moment so you can see the effect.
 */
export function PlayerPopover() {
  const pop = useStore((s) => s.popover);
  const pending = useStore((s) => s.pending);
  const play = useStore((s) => s.play);
  const phaseIdx = useStore((s) => s.phaseIdx);
  // Stay open while an action started here is waiting, so the pitch doesn't resize mid-drag.
  const id = pop?.id ?? pending?.id;
  const player = id && play.players.find((p) => p.id === id);
  if (!player) return null;

  const st = useStore.getState();
  const ph = timelineOf(play).phases[phaseIdx];
  const byId = Object.fromEntries(play.players.map((p) => [p.id, p]));
  const passes = ph.passes.filter((pt) => pt.from === player.id);
  const run = play.phases[phaseIdx].runs[player.id];
  const max = Math.ceil(ph.duration + 1);
  // New passes go from whoever ends up with the ball, so only they can add one.
  const hasBall = ph.endHolder === player.id;

  /** Show the pitch at `t` seconds into this phase. */
  const preview = (t: number) => {
    const s = useStore.getState();
    s.seek(timelineOf(s.play).phases[s.phaseIdx].start + t);
  };

  const close = () => {
    st.cancelPending();
    st.closePopover();
  };

  const toggle = (kind: Pending['kind']) => {
    if (pending?.kind === kind) st.finishPending(); // second press cancels, back to the bar
    else {
      if (pending) st.finishPending();
      st.startPending(kind);
    }
  };

  return (
    <div className="player-bar">
      <div className="pb-head">
        <span className={`dot small ${player.team}`}>{player.num}</span>
        <strong>{player.name || `#${player.num}`}</strong>
        <span className="muted">Phase {phaseIdx + 1}</span>
        <div className="pb-actions">
          {ACTIONS.map((a) => {
            const blocked = a.needsBall && !hasBall;
            return (
              <button
                key={a.kind}
                className={pending?.kind === a.kind ? 'on' : ''}
                onClick={() => toggle(a.kind)}
                disabled={blocked}
                title={blocked ? `#${player.num} doesn’t have the ball` : `${a.label} (${a.key})`}
              >
                <span className="icon">{a.icon}</span>
                {a.label}
              </button>
            );
          })}
        </div>
        <button className="icon-btn" onClick={close} aria-label="Close">
          ×
        </button>
      </div>

      {passes.map((pt) => {
        const to = byId[pt.pass.to];
        return (
          <div key={pt.pass.id} className="pb-row">
            <span className="pb-label">
              <span className={`kind ${pt.pass.kind}`}>{pt.pass.kind === 'kick' ? 'Kick' : 'Pass'}</span>→
              <span className={`dot small ${to?.team}`}>{to?.num}</span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(max, Math.ceil(pt.pass.at + 1))}
              step={0.1}
              value={pt.pass.at}
              aria-label={`When #${player.num} ${pt.pass.kind}es to #${to?.num}`}
              onChange={(e) => {
                const at = Number(e.target.value);
                st.updatePass(pt.pass.id, { at }, `at:${pt.pass.id}`);
                preview(at);
              }}
            />
            <span className="muted at">{pt.pass.at.toFixed(1)}s</span>
            <button className="icon-btn" onClick={() => st.removePass(pt.pass.id)} aria-label="Delete">
              ×
            </button>
          </div>
        );
      })}

      {run && (
        <div className="pb-row">
          <span className="pb-label">
            <span className="kind run">Run</span>starts
          </span>
          <input
            type="range"
            min={0}
            max={6}
            step={0.1}
            value={run.delay}
            aria-label={`When #${player.num} starts running`}
            onChange={(e) => {
              const delay = Number(e.target.value);
              st.updateRun(player.id, { delay }, `delay:${player.id}`);
              preview(delay);
            }}
          />
          <span className="muted at">{run.delay.toFixed(1)}s</span>
          <button className="icon-btn" onClick={() => st.clearRun(player.id)} aria-label="Clear run">
            ×
          </button>
        </div>
      )}

      {passes.length === 0 && !run && !pending && (
        <p className="muted">No pass, kick or run for #{player.num} in this phase yet.</p>
      )}
    </div>
  );
}
