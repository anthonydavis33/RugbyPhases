import type { Play, Player, Team } from './types';
import { uid } from './uid';

/** [shirt number, x, y] */
type Spot = [number, number, number];

const side = (team: Team, spots: Spot[]): Player[] =>
  spots.map(([num, x, y]) => ({ id: uid(), team, num, x, y }));

interface Layout {
  name: string;
  attack: Spot[];
  defence: Spot[];
  /** Attacking shirt number that starts with the ball. */
  ball: number | null;
}

const LAYOUTS = {
  backline: {
    name: 'Backline attack',
    ball: 9,
    attack: [
      [9, 38.5, 21], [10, 33, 27], [12, 31.5, 34], [13, 30, 41], [15, 25, 46], [11, 28.5, 54], [14, 33, 9],
      [1, 36.5, 26.5], [2, 36, 28.5], [3, 36.5, 30.5], [4, 34.5, 37], [5, 34, 39.5],
      [6, 40.5, 19.5], [7, 41, 21.5], [8, 37, 15],
    ],
    defence: [
      [2, 44, 12], [9, 43.5, 19], [1, 44, 24], [3, 44, 28], [4, 44.5, 32], [5, 45, 36], [6, 45, 40],
      [10, 45.5, 44], [12, 46, 48], [13, 46.5, 53], [11, 48, 60], [7, 44, 16], [8, 52, 26],
      [14, 50, 6], [15, 65, 36],
    ],
  },
  lineout: {
    name: 'Lineout',
    ball: 2,
    attack: [
      [2, 40, -1.2], [1, 39.5, 6], [4, 39.5, 7.5], [3, 39.5, 9], [5, 39.5, 10.5], [6, 39.5, 12],
      [8, 39.5, 13.5], [7, 39.5, 15], [9, 37.5, 17], [10, 30, 24], [12, 28, 32], [13, 26, 40],
      [11, 24, 52], [14, 22, 62], [15, 18, 42],
    ],
    defence: [
      [2, 41, 3], [1, 40.5, 6], [4, 40.5, 7.5], [3, 40.5, 9], [5, 40.5, 10.5], [6, 40.5, 12],
      [8, 40.5, 13.5], [7, 40.5, 15], [9, 42, 17], [10, 50, 24], [12, 50, 32], [13, 51, 40],
      [11, 53, 52], [14, 54, 62], [15, 70, 36],
    ],
  },
  scrum: {
    name: 'Scrum',
    ball: 9,
    attack: [
      [1, 39.6, 24], [2, 39.6, 25], [3, 39.6, 26], [4, 38.5, 24.5], [5, 38.5, 25.5], [6, 38.5, 23.2],
      [7, 38.5, 26.8], [8, 37.4, 25], [9, 39.5, 22.5], [10, 32, 30], [12, 30, 37], [13, 28, 44],
      [11, 26, 55], [14, 34, 12], [15, 22, 46],
    ],
    defence: [
      [3, 40.4, 24], [2, 40.4, 25], [1, 40.4, 26], [5, 41.5, 24.5], [4, 41.5, 25.5], [7, 41.5, 23.2],
      [6, 41.5, 26.8], [8, 42.6, 25], [9, 40.8, 22], [10, 47, 31], [12, 47.5, 38], [13, 48, 45],
      [11, 50, 56], [14, 48, 13], [15, 66, 38],
    ],
  },
  sevens: {
    name: 'Sevens',
    ball: 4,
    attack: [[4, 38.5, 30], [5, 33, 36], [6, 31, 44], [7, 29, 56], [3, 35, 24], [2, 36, 17], [1, 40.5, 31]],
    defence: [[1, 45, 20], [2, 45, 26], [3, 45, 32], [4, 45.5, 38], [5, 46, 46], [6, 47, 56], [7, 60, 38]],
  },
  blank: { name: 'New play', ball: null, attack: [], defence: [] },
} satisfies Record<string, Layout>;

export type PresetKey = keyof typeof LAYOUTS;

export const PRESETS: { key: PresetKey; title: string; desc: string }[] = [
  { key: 'backline', title: 'Backline attack', desc: '15 v 15 off a ruck' },
  { key: 'lineout', title: 'Lineout', desc: '15 v 15, attacking throw' },
  { key: 'scrum', title: 'Scrum', desc: '15 v 15, attacking put-in' },
  { key: 'sevens', title: 'Sevens', desc: '7 v 7 off a ruck' },
  { key: 'blank', title: 'Blank pitch', desc: 'Add your own players' },
];

export function makePreset(key: PresetKey): Play {
  const l: Layout = LAYOUTS[key];
  const attack = side('attack', l.attack);
  const defence = side('defence', l.defence);
  return {
    id: uid(),
    name: l.name,
    players: [...attack, ...defence],
    ball: attack.find((p) => p.num === l.ball)?.id ?? null,
    phases: [{ id: uid(), runs: {}, passes: [], note: '' }],
    updated: Date.now(),
  };
}
