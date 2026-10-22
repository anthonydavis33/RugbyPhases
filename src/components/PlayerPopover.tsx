import type { ReactNode } from 'react';
import { timelineOf, useStore, type Pending } from '../store';
import type { Pass } from '../model/types';

/** Show the pitch at `t` seconds into the current phase. */
function preview(t: number) {
  const s = useStore.getState();
  s.seek(timelineOf(s.play).phases[s.phaseIdx].start + t);
}

/** One pass, kick or option: who it goes to, a timing slider, and delete. */
function PassRow({
  pass,
  label,
  max,
  extra,
  className = '',
}: {
  pass: Pass;
  label: ReactNode;
  max: number;
  extra?: ReactNode;
  className?: string;
}) {
  const st = useStore.getState();
  const to = st.play.players.find((p) => p.id === pass.to);
  return (
    <div className={`pb-row ${className}`}>
      <span className="pb-label">
        {label}→<span className={`dot small ${to?.team}`}>{to?.num}</span>
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(max, Math.ceil(pass.at + 1))}
        step={0.1}
        value={pass.at}
        aria-label={`When the ball goes to #${to?.num}`}
        onChange={(e) => {
          const at = Number(e.target.value);
          st.updatePass(pass.id, { at }, `at:${pass.id}`);
          preview(at);
        }}
      />
      <span className="muted at">{pass.at.toFixed(1)}s</span>
      {extra}
      <button className="icon-btn" onClick={() => st.removePass(pass.id)} aria-label="Delete">
        ×
      </button>
    </div>
  );
}

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
  const activeOption = useStore((s) => s.activeOption);
  // Stay open while an action started here is waiting, so the pitch doesn't resize mid-drag.
  const id = pop?.id ?? pending?.id;
  const player = id && play.players.find((p) => p.id === id);
  if (!player) return null;

  const st = useStore.getState();
  const ph = timelineOf(play).phases[phaseIdx];
  const passes = ph.passes.filter((pt) => pt.from === player.id);
  const raw = play.phases[phaseIdx].passes;
  const run = play.phases[phaseIdx].runs[player.id];
  const max = Math.ceil(ph.duration + 1);
  // New passes go from whoever ends up with the ball, so only they can add one.
  const hasBall = ph.endHolder === player.id;

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
        // Edit the stored pass, not the resolved one (which may have an option swapped in).
        const main = raw.find((p) => p.id === pt.pass.id) ?? pt.pass;
        const options = raw.filter((p) => p.altOf === main.id);
        const addingOption = pending?.kind === 'option' && pending.altOf === main.id;
        return (
          <div key={main.id} className="pb-group">
            <PassRow
              pass={main}
              label={<span className={`kind ${main.kind}`}>{main.kind === 'kick' ? 'Kick' : 'Pass'}</span>}
              max={max}
              extra={
                <button
                  className={`small${addingOption ? ' on' : ''}`}
                  onClick={() => (addingOption ? st.finishPending() : (pending && st.finishPending(), st.startPending('option', main.id)))}
                  title="Add an alternative receiver for this pass"
                >
                  + Option
                </button>
              }
            />
            {options.map((opt) => (
              <PassRow
                key={opt.id}
                pass={opt}
                className="option-row"
                label={
                  <>
                    <span className="muted">or</span>
                    <button
                      className={`kind ${opt.kind} kind-toggle`}
                      onClick={() => st.updatePass(opt.id, { kind: opt.kind === 'kick' ? 'pass' : 'kick' })}
                      title="Switch between pass and kick"
                    >
                      {opt.kind === 'kick' ? 'Kick' : 'Pass'}
                    </button>
                  </>
                }
                max={max}
                extra={
                  <button
                    className={`small${activeOption === opt.id ? ' on' : ''}`}
                    onClick={() => {
                      st.setActiveOption(opt.id);
                      st.togglePlay();
                    }}
                    title="Play this option"
                  >
                    ▶
                  </button>
                }
              />
            ))}
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
