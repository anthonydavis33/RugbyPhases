// Pitch coordinates are in metres. x runs along the pitch: 0 and 100 are the
// try lines, -10 and 110 the dead-ball lines. y runs across: 0 and 70 are the
// touchlines. The attack always runs toward x = 100.
export interface Vec {
  x: number;
  y: number;
}

export type Team = 'attack' | 'defence';

export interface Player {
  id: string;
  team: Team;
  num: number;
  name?: string;
  /** Starting position at the beginning of phase 1. */
  x: number;
  y: number;
}

export type Speed = 'walk' | 'jog' | 'run' | 'sprint';

/** Metres per second for each speed. */
export const SPEEDS: Record<Speed, number> = { walk: 2, jog: 4, run: 6, sprint: 8 };

export interface Run {
  /** Path points as offsets from where the player starts the phase. */
  pts: Vec[];
  /** Seconds after the phase starts before the player sets off. */
  delay: number;
  speed: Speed;
}

export type BallAction = 'pass' | 'kick';

/**
 * A pass or kick. The passer is never stored: whoever holds the ball at that
 * moment throws it, so deleting or reordering passes never leaves the chain broken.
 */
export interface Pass {
  id: string;
  to: string;
  /** Seconds into the phase when the ball leaves the passer's hands. */
  at: number;
  kind: BallAction;
  /**
   * Set on an option: the id of the main-line pass this is an alternative to
   * ("10 passes to 12, or to 13"). Options are drawn but only played when chosen.
   */
  altOf?: string;
}

export interface Phase {
  id: string;
  runs: Record<string, Run>;
  passes: Pass[];
  note: string;
}

export interface Play {
  id: string;
  name: string;
  players: Player[];
  /** Who has the ball at the start of phase 1. */
  ball: string | null;
  phases: Phase[];
  updated: number;
}
