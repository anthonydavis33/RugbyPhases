import { timelineOf, useStore } from '../store';
import type { Speed } from '../model/types';

const SPEED_LABELS: [Speed, string][] = [
  ['walk', 'Walk'],
  ['jog', 'Jog'],
  ['run', 'Run'],
  ['sprint', 'Sprint'],
];

export function Inspector() {
  const play = useStore((s) => s.play);
  const phaseIdx = useStore((s) => s.phaseIdx);
  const selected = useStore((s) => s.selected);
  useStore((s) => s.activeOption); // the chosen option changes the ball list
  const st = useStore.getState();

  const ph = timelineOf(play).phases[phaseIdx];
  const phase = play.phases[phaseIdx];
  const byId = Object.fromEntries(play.players.map((p) => [p.id, p]));
  const sel = selected ? byId[selected] : undefined;
  const run = sel ? phase.runs[sel.id] : undefined;

  return (
    <div className="inspector">
      {sel && (
        <section>
          <header>
            <span className={`dot ${sel.team}`}>{sel.num}</span>
            <h3>{sel.name || `${sel.team === 'attack' ? 'Attack' : 'Defence'} #${sel.num}`}</h3>
            <button className="icon-btn" onClick={() => st.select(null)} aria-label="Close">
              ×
            </button>
          </header>
          <div className="row">
            <label className="field narrow">
              No.
              <input
                type="number"
                min={1}
                max={99}
                value={sel.num}
                onChange={(e) => st.updatePlayer(sel.id, { num: Number(e.target.value) || 0 }, `num:${sel.id}`)}
              />
            </label>
            <label className="field">
              Name
              <input
                value={sel.name ?? ''}
                placeholder="Optional"
                onChange={(e) => st.updatePlayer(sel.id, { name: e.target.value }, `name:${sel.id}`)}
              />
            </label>
          </div>
          {phaseIdx === 0 && (
            <button className="block" disabled={play.ball === sel.id} onClick={() => st.giveBall(sel.id)}>
              {play.ball === sel.id ? '● Starts with the ball' : 'Give ball'}
            </button>
          )}

          <h4>Run in phase {phaseIdx + 1}</h4>
          {run ? (
            <>
              <div className="seg">
                {SPEED_LABELS.map(([s, label]) => (
                  <button key={s} className={run.speed === s ? 'on' : ''} onClick={() => st.updateRun(sel.id, { speed: s })}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="field">
                Start after {run.delay.toFixed(1)}s
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.1}
                  value={run.delay}
                  onChange={(e) => st.updateRun(sel.id, { delay: Number(e.target.value) }, `delay:${sel.id}`)}
                />
              </label>
              <button className="block" onClick={() => st.clearRun(sel.id)}>
                Clear run
              </button>
            </>
          ) : (
            <p className="muted">No run yet. Choose Run and drag from this player.</p>
          )}
          <button className="block danger" onClick={() => st.removePlayer(sel.id)}>
            Remove player
          </button>
        </section>
      )}

      <section>
        <header>
          <h3>Phase {phaseIdx + 1}</h3>
          {play.phases.length > 1 && (
            <button className="small danger" onClick={() => st.deletePhase(phaseIdx)}>
              Delete phase
            </button>
          )}
        </header>
        <label className="field">
          Coaching note
          <textarea
            rows={3}
            value={phase.note}
            placeholder="Shown on screen during this phase, e.g. “12 holds the 13 defender”"
            onChange={(e) =>
              st.commit((p) => {
                p.phases[phaseIdx].note = e.target.value;
              }, `note:${phase.id}`)
            }
          />
        </label>

        <h4>Ball</h4>
        {ph.passes.length === 0 ? (
          <p className="muted">No passes yet. Choose Pass or Kick and tap the receiver.</p>
        ) : (
          <ol className="passes">
            {ph.passes.map((pt) => {
              const from = byId[pt.from];
              const to = byId[pt.pass.to];
              const max = Math.ceil(Math.max(ph.duration, pt.pass.at) + 1);
              return (
                <li key={pt.pass.id}>
                  <div className="pass-head">
                    <span className={`kind ${pt.pass.kind}`}>{pt.pass.kind === 'kick' ? 'Kick' : 'Pass'}</span>
                    <span className={`dot small ${from?.team}`}>{from?.num}</span>→
                    <span className={`dot small ${to?.team}`}>{to?.num}</span>
                    <span className="muted at">at {pt.pass.at.toFixed(1)}s</span>
                    <button className="icon-btn" onClick={() => st.removePass(pt.pass.id)} aria-label="Delete pass">
                      ×
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={max}
                    step={0.1}
                    value={pt.pass.at}
                    aria-label="Pass timing"
                    onChange={(e) => st.updatePass(pt.pass.id, { at: Number(e.target.value) }, `at:${pt.pass.id}`)}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {!sel && (
        <section className="help">
          <h4>How it works</h4>
          <ol>
            <li>
              <b>Move</b> players to set the starting shape.
            </li>
            <li>
              <b>Run</b>: drag from a player to draw their line.
            </li>
            <li>
              <b>Pass</b> or <b>Kick</b>: tap the receiver. The ball goes from whoever has it.
            </li>
            <li>
              Add a <b>Phase</b> to carry on from where everyone finished.
            </li>
            <li>
              Press <b>▶</b>, then <b>Share</b> to send it to the team.
            </li>
          </ol>
        </section>
      )}
    </div>
  );
}
