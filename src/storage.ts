import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Play } from './model/types';

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
