import { FILM_TAB, useFilm } from '../film/store';

/** Switch between designing plays and reviewing film. Hidden while the Film tab is turned off. */
export function ModeTabs() {
  const mode = useFilm((s) => s.mode);
  const setMode = useFilm((s) => s.setMode);
  // Still shown if a dev link opened Film, so there's a way back to Plays.
  if (!FILM_TAB && mode !== 'film') return null;
  return (
    <div className="mode-tabs" role="tablist">
      <button role="tab" aria-selected={mode === 'plays'} className={mode === 'plays' ? 'on' : ''} onClick={() => setMode('plays')}>
        Plays
      </button>
      <button role="tab" aria-selected={mode === 'film'} className={mode === 'film' ? 'on' : ''} onClick={() => setMode('film')}>
        Film
      </button>
    </div>
  );
}
