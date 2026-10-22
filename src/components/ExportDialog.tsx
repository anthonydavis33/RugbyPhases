import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ExportFormat } from '../export/exporter';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; progress: number }
  | { kind: 'done'; file: File; url: string }
  | { kind: 'error'; message: string };

// The exporter pulls in the encoders, so it is only loaded when someone exports.
const loadExporter = () => import('../export/exporter');

export function ExportDialog() {
  const open = useStore((s) => s.exportOpen);
  return open ? <ExportPanel /> : null;
}

function ExportPanel() {
  const play = useStore((s) => s.play);
  const view = useStore((s) => s.view);
  const orientation = useStore((s) => s.orientation);
  const option = useStore((s) => s.activeOption);
  const close = () => useStore.getState().setExportOpen(false);

  const [mp4, setMp4] = useState<boolean | null>(null);
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [lines, setLines] = useState(true);
  const [notes, setNotes] = useState(true);
  const [title, setTitle] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    loadExporter()
      .then((m) => m.canExportMp4())
      .then((ok) => {
        setMp4(ok);
        if (!ok) setFormat('gif');
      });
    return () => abort.current?.abort();
  }, []);

  // Free the previous result when it is replaced or the dialog closes.
  const url = status.kind === 'done' ? status.url : null;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setStatus({ kind: 'working', progress: 0 });
    try {
      const m = await loadExporter();
      const blob = await m.exportPlay(
        play,
        { format, lines, notes, title, view, orientation, option },
        (progress) => setStatus({ kind: 'working', progress }),
        ac.signal,
      );
      const file = new File([blob], m.fileName(play, format, option), { type: blob.type });
      setStatus({ kind: 'done', file, url: URL.createObjectURL(file) });
    } catch (e) {
      if ((e as Error).name === 'AbortError') setStatus({ kind: 'idle' });
      else setStatus({ kind: 'error', message: (e as Error).message || 'Export failed' });
    }
  };

  const canShare = status.kind === 'done' && !!navigator.canShare?.({ files: [status.file] });
  const share = async (file: File) => {
    try {
      await navigator.share({ files: [file], title: play.name });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useStore.getState().notify('Sharing failed — try Download instead');
    }
  };

  return (
    <div className="modal-back" onPointerDown={status.kind === 'working' ? undefined : close}>
      <div className="modal export" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Export “{play.name}”</h2>
          <button className="icon-btn" onClick={close} aria-label="Close" disabled={status.kind === 'working'}>
            ×
          </button>
        </header>

        {status.kind === 'done' ? (
          <>
            <div className="preview">
              {status.file.type === 'video/mp4' ? (
                <video src={status.url} controls autoPlay loop muted playsInline />
              ) : (
                <img src={status.url} alt={`Animated GIF of ${play.name}`} />
              )}
            </div>
            <p className="muted">
              {status.file.name} · {(status.file.size / 1024 / 1024).toFixed(1)} MB
            </p>
            <div className="actions">
              <button onClick={() => setStatus({ kind: 'idle' })}>Back</button>
              <a className="button" href={status.url} download={status.file.name}>
                Download
              </a>
              {canShare && (
                <button className="primary" onClick={() => share(status.file)}>
                  Share…
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h4>Format</h4>
            <div className="choices">
              <button className={format === 'mp4' ? 'on' : ''} disabled={mp4 === false} onClick={() => setFormat('mp4')}>
                <strong>Video (MP4)</strong>
                <span>{mp4 === false ? 'Not supported in this browser' : 'Sharp and small — best for WhatsApp'}</span>
              </button>
              <button className={format === 'gif' ? 'on' : ''} onClick={() => setFormat('gif')}>
                <strong>GIF</strong>
                <span>Loops anywhere, even in email and slides</span>
              </button>
            </div>

            <h4>Show</h4>
            <label className="check">
              <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />
              Running lines and passes
            </label>
            <label className="check">
              <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
              Coaching notes
            </label>
            <label className="check">
              <input type="checkbox" checked={title} onChange={(e) => setTitle(e.target.checked)} />
              Play name and phase
            </label>
            <p className="muted">
              Uses the current view: {orientation === 'ns' ? 'north–south' : 'east–west'},{' '}
              {view === 'full' ? 'full pitch' : 'zoomed to the play'}
              {option ? ', playing the selected option' : ''}.
            </p>

            {status.kind === 'error' && <p className="error">{status.message}</p>}

            {status.kind === 'working' ? (
              <div className="progress-row">
                <div className="progress">
                  <div style={{ width: `${Math.round(status.progress * 100)}%` }} />
                </div>
                <span className="muted">{Math.round(status.progress * 100)}%</span>
                <button onClick={() => abort.current?.abort()}>Cancel</button>
              </div>
            ) : (
              <div className="actions">
                <button className="primary" onClick={start}>
                  Export {format === 'mp4' ? 'video' : 'GIF'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
