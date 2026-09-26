import { MODES, type Mode } from '../game/player';

/** Where the last session ended, so a reload carries on from the same spot. */
export interface ResumeView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: Mode;
  /** Storey the walker stood on, 0 at street level. */
  floor: number;
  hour: number;
  /** The city it belongs to; a view saved in another seed's city could be inside a building. */
  seed: number;
}

const KEY = 'glyphwalk.view.v1';

export function loadResume(seed: number): ResumeView | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ResumeView | null;
    if (!v || v.seed !== seed || !MODES.includes(v.mode)) return null;
    const nums = [v.x, v.y, v.z, v.yaw, v.pitch, v.floor, v.hour];
    return nums.every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}

export function saveResume(v: ResumeView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage full or blocked: the next visit simply starts at the default spot.
  }
}
