import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Play } from './model/types';
import { uid } from './model/uid';

const LIBRARY_KEY = 'rugbyphases:plays';
const LAST_KEY = 'rugbyphases:last';
const SHARE_PARAM = 'play=';

// Storage can be unavailable (private browsing, blocked site data), so every
// access is guarded and the app keeps working without it.
export function loadLibrary(): Record<string, Play> {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeLibrary(lib: Record<string, Play>) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}

export function savePlay(play: Play) {
  writeLibrary({ ...loadLibrary(), [play.id]: play });
  try {
    localStorage.setItem(LAST_KEY, play.id);
  } catch {
    /* ignore */
  }
}

export function deletePlay(id: string) {
  const lib = loadLibrary();
  delete lib[id];
  writeLibrary(lib);
}

export function lastPlay(): Play | null {
  try {
    const id = localStorage.getItem(LAST_KEY);
    return id ? (loadLibrary()[id] ?? null) : null;
  } catch {
    return null;
  }
}

// ---------- playbook files ----------
// A playbook is a plain JSON file holding any number of plays. It never leaves
// the device unless the coach sends it, so each team keeps its plays private.

const PLAYBOOK_FORMAT = 'rugby-phases-playbook';

export function playbookFile(plays: Play[]): File {
  const data = { format: PLAYBOOK_FORMAT, version: 1, exported: new Date().toISOString(), plays };
  const date = new Date().toISOString().slice(0, 10);
  return new File([JSON.stringify(data, null, 1)], `rugby-playbook-${date}.json`, { type: 'application/json' });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isPlay(v: unknown): v is Play {
  const p = v as Play;
  return (
    !!p &&
    typeof p.id === 'string' &&
    Array.isArray(p.players) &&
    p.players.every((x) => typeof x.id === 'string' && (x.team === 'attack' || x.team === 'defence') && isNum(x.num) && isNum(x.x) && isNum(x.y)) &&
    Array.isArray(p.phases) &&
    p.phases.length > 0 &&
    p.phases.every((ph) => typeof ph.runs === 'object' && Array.isArray(ph.passes))
  );
}

/** Reads a playbook file (or a single exported play). Throws a coach-readable message if it isn't one. */
export function parsePlaybook(text: string): Play[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a Rugby Phases playbook.');
  }
  const list = (data as { plays?: unknown })?.plays ?? (Array.isArray(data) ? data : [data]);
  const plays = (Array.isArray(list) ? list : []).filter(isPlay);
  if (plays.length === 0) throw new Error('No plays found in that file.');
  return plays.map((p) => ({
    ...p,
    name: typeof p.name === 'string' ? p.name : 'Imported play',
    ball: typeof p.ball === 'string' ? p.ball : null,
    updated: isNum(p.updated) ? p.updated : Date.now(),
    phases: p.phases.map((ph) => ({ ...ph, id: ph.id ?? uid(), note: typeof ph.note === 'string' ? ph.note : '' })),
  }));
}

/**
 * Adds plays to the library. A play already here unchanged is skipped; one
 * with the same id but different content is kept as a copy, so importing
 * never overwrites a coach's own edits.
 */
export function importPlays(plays: Play[]): { added: number; skipped: number } {
  const lib = loadLibrary();
  let added = 0;
  let skipped = 0;
  for (const play of plays) {
    const existing = lib[play.id];
    if (existing && JSON.stringify(existing) === JSON.stringify(play)) {
      skipped++;
      continue;
    }
    const copy = existing ? { ...play, id: uid(), name: `${play.name} (imported)` } : play;
    lib[copy.id] = copy;
    added++;
  }
  writeLibrary(lib);
  return { added, skipped };
}

/** The whole play travels in the URL hash, so no server is needed to share it. */
export function shareUrl(play: Play) {
  const data = compressToEncodedURIComponent(JSON.stringify(play));
  return `${location.origin}${location.pathname}#${SHARE_PARAM}${data}`;
}

export function readSharedPlay(): Play | null {
  const hash = location.hash.slice(1);
  if (!hash.startsWith(SHARE_PARAM)) return null;
  try {
    const json = decompressFromEncodedURIComponent(hash.slice(SHARE_PARAM.length));
    const play = json ? (JSON.parse(json) as Play) : null;
    return play && Array.isArray(play.players) && Array.isArray(play.phases) ? play : null;
  } catch {
    return null;
  }
}
