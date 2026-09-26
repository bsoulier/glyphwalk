import { hash3 } from '../core/hash';
import type { RGB } from './signs';
import { worldSeed } from './layout';

/** Neighbourhoods tile the grid in square regions of this many blocks, so borders run along streets. */
export const HOOD_BLOCKS = 4;

export const H_DOWNTOWN = 0;
export const H_JAPAN = 1;
export const H_OLDTOWN = 2;
export const H_PARIS = 3;
export const H_DOCKS = 4;

export interface Hood {
  name: string;
  weight: number;
  lamp: RGB;
  lampH: number;
}

export const HOODS: readonly Hood[] = [
  { name: 'DOWNTOWN', weight: 3, lamp: [215, 228, 255], lampH: 5.4 },
  { name: 'JAPANTOWN', weight: 2, lamp: [255, 170, 120], lampH: 5.0 },
  { name: 'OLD TOWN', weight: 2, lamp: [255, 180, 90], lampH: 4.2 },
  { name: 'LE MARAIS', weight: 2, lamp: [255, 215, 150], lampH: 5.0 },
  { name: 'DOCKLANDS', weight: 1, lamp: [255, 140, 50], lampH: 6.5 },
];

const PICK: number[] = [];
HOODS.forEach((h, k) => {
  for (let n = 0; n < h.weight; n++) PICK.push(k);
});

export function hoodOfRegion(ri: number, rj: number): number {
  if (ri === 0 && rj === 0) return H_DOWNTOWN;
  return PICK[hash3(ri, rj, worldSeed ^ 0x40d) % PICK.length];
}

// Neighbouring ground cells almost always share a region, so remembering the last answer skips the hash.
let memoRi = 0x7fffffff;
let memoRj = 0;
let memoHood = 0;

export function hoodAt(bi: number, bj: number): number {
  const ri = Math.floor(bi / HOOD_BLOCKS), rj = Math.floor(bj / HOOD_BLOCKS);
  if (ri !== memoRi || rj !== memoRj) {
    memoRi = ri;
    memoRj = rj;
    memoHood = hoodOfRegion(ri, rj);
  }
  return memoHood;
}

/** Nearest region of the given type, searching outward in square rings of regions. */
export function nearestRegion(hood: number, bi: number, bj: number): [number, number] | null {
  const ri = Math.floor(bi / HOOD_BLOCKS), rj = Math.floor(bj / HOOD_BLOCKS);
  for (let rad = 0; rad < 48; rad++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let di = -rad; di <= rad; di++) {
      for (let dj = -rad; dj <= rad; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        if (hoodOfRegion(ri + di, rj + dj) !== hood) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = [ri + di, rj + dj];
        }
      }
    }
    if (best) return best;
  }
  return null;
}
