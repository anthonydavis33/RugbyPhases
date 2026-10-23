import { buildTimeline, frameAt } from '../model/engine';
import type { Play } from '../model/types';
import { uid } from '../model/uid';
import type { Film, FilmTrack } from './types';

/** How far either side of the ball (metres along the pitch) the pretend camera sees. */
const CAMERA_HALF_WIDTH = 24;
const JITTER = 0.25;

/**
 * Pretend tracking data made from a play, for trying the Film tab before real
 * footage is processed: positions wobble slightly, players far from the ball
 * drop out as if off camera, and the opposition's numbers are unknown.
 */
export function demoFilm(play: Play): Film {
  const tl = buildTimeline(play);
  const fps = 10;
  const n = Math.ceil(tl.total * fps) + 1;
  const tracks: FilmTrack[] = play.players.map((p) => ({
    id: uid(),
    team: p.team,
    num: p.team === 'attack' ? p.num : 0,
    pos: [],
  }));

  let cam = 50;
  for (let i = 0; i < n; i++) {
    const f = frameAt(tl, i / fps);
    // The camera eases towards the ball, like a follow-cam.
    if (f.ball) cam += (f.ball.pos.x - cam) * (i === 0 ? 1 : 0.15);
    play.players.forEach((p, k) => {
      const at = f.players[p.id];
      const seen = at && Math.abs(at.x - cam) < CAMERA_HALF_WIDTH;
      tracks[k].pos.push(
        seen ? [+(at.x + (Math.random() - 0.5) * JITTER).toFixed(2), +(at.y + (Math.random() - 0.5) * JITTER).toFixed(2)] : null,
      );
    });
  }

  return {
    format: 'rugby-phases-film',
    version: 1,
    id: uid(),
    name: `Demo: ${play.name}`,
    fps,
    tracks,
    keyframes: [],
    camera: [],
  };
}
