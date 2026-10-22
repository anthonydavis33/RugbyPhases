import { useEffect } from 'react';
import { useStore } from './store';
import { Board } from './components/Board';
import { Hint, NoteOverlay, Timeline, Toast, Toolbar, TopBar } from './components/Controls';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';

export function App() {
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      useStore.getState().tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        st.togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selected) {
        st.removePlayer(st.selected);
      } else if (k === 'm') st.setTool('select');
      else if (k === 'r') st.setTool('run');
      else if (k === 'p') st.setTool('pass');
      else if (k === 'k') st.setTool('kick');
      else if (e.key === 'Escape') st.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <Toolbar />
      <main className="stage">
        <Board />
        <Hint />
        <NoteOverlay />
      </main>
      <Timeline />
      <aside className="panel">
        <Inspector />
      </aside>
      <Toast />
      <Library />
    </div>
  );
}
