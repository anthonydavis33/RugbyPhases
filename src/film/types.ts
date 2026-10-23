import type { Team, Vec } from '../model/types';

/** A 3×3 homography, row-major. Ours always map video pixels → pitch metres. */
export type Homography = number[];

/** One player followed through the film. */
export interface FilmTrack {
  id: string;
  /** Null until known (detection may not tell which team a player is on). */
  team: Team | null;
  /** Shirt number, 0 when unknown. */
  num: number;
  name?: string;
  /** Pitch position (metres) at each sample, or null when off camera / lost. */
  pos: ([number, number] | null)[];
}

/** A video point the coach matched to a spot on the pitch. */
export interface CalibPoint {
  img: Vec;
  pitch: Vec;
}

/** A reference frame: a moment where the coach marked 4+ matching points. */
export interface Keyframe {
  t: number;
  points: CalibPoint[];
}

/** Where the camera was looking at one sample, from the camera-follow tool. */
export interface CameraSample {
  t: number;
  /** Video pixels → pitch metres, or null when the tool lost the camera. */
  h: Homography | null;
  /** Match quality (inlier count); higher is more trustworthy. */
  q?: number;
}

/**
 * Everything known about one clip. Saved as a .json "film file" that the
 * processing tools read and add to, and the Film tab plays back.
 */
export interface Film {
  format: 'rugby-phases-film';
  version: 1;
  id: string;
  name: string;
  video?: { name: string; width: number; height: number; duration: number };
  /** Samples per second for tracks and camera. */
  fps: number;
  tracks: FilmTrack[];
  keyframes: Keyframe[];
  camera: CameraSample[];
}
