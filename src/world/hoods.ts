import { hash3 } from '../core/hash';
import type { RGB } from './signs';
import { P, worldSeed } from './layout';

/** Neighbourhoods tile the grid in square regions of this many blocks, so borders run along streets. */
export const HOOD_BLOCKS = 4;
/** Width of one district region, in metres. */
export const REGION = HOOD_BLOCKS * P;

export const H_DOWNTOWN = 0;
export const H_JAPAN = 1;
export const H_OLDTOWN = 2;
export const H_PARIS = 3;
export const H_DOCKS = 4;
export const H_SUBURB = 5;
export const H_ESTATES = 6;
export const H_SEAFRONT = 7;
export const H_MEDINA = 8;

export interface Hood {
  name: string;
  weight: number;
  /**
   * Districts in the second set are placed by their own roll over a share of the regions, so every
   * other region keeps the district it had before they existed and old links still land in the same place.
   */
  second?: true;
  lamp: RGB;
  lampH: number;
  /** Colour of the district on the map. */
  map: RGB;
}

export const HOODS: readonly Hood[] = [
  { name: 'DOWNTOWN', weight: 3, lamp: [215, 228, 255], lampH: 5.4, map: [90, 140, 220] },
  { name: 'JAPANTOWN', weight: 2, lamp: [255, 170, 120], lampH: 5.0, map: [230, 80, 90] },
  { name: 'OLD TOWN', weight: 2, lamp: [255, 180, 90], lampH: 4.2, map: [220, 140, 70] },
  { name: 'LE MARAIS', weight: 2, lamp: [255, 215, 150], lampH: 5.0, map: [225, 210, 150] },
  { name: 'DOCKLANDS', weight: 1, lamp: [255, 140, 50], lampH: 6.5, map: [70, 180, 170] },
  { name: 'MAPLE HEIGHTS', weight: 3, second: true, lamp: [255, 205, 150], lampH: 4.6, map: [130, 205, 100] },
  { name: 'SILVER HILLS', weight: 2, second: true, lamp: [255, 228, 180], lampH: 4.0, map: [200, 204, 222] },
  { name: 'SEAFRONT', weight: 2, second: true, lamp: [255, 190, 170], lampH: 5.6, map: [255, 130, 180] },
  { name: 'MEDINA', weight: 2, second: true, lamp: [255, 170, 80], lampH: 4.0, map: [240, 190, 60] },
];

/** Percentage of regions (other than the city centre) that go to the second set of districts. */
const SECOND_SHARE = 42;

const PICK: number[] = [];
const PICK_SECOND: number[] = [];
HOODS.forEach((h, k) => {
  for (let n = 0; n < h.weight; n++) (h.second ? PICK_SECOND : PICK).push(k);
});

export function hoodOfRegion(ri: number, rj: number): number {
  if (ri === 0 && rj === 0) return H_DOWNTOWN;
  if (hash3(ri, rj, worldSeed ^ 0x5eb) % 100 < SECOND_SHARE) {
    return PICK_SECOND[hash3(ri, rj, worldSeed ^ 0x6c1) % PICK_SECOND.length];
  }
  return PICK[hash3(ri, rj, worldSeed ^ 0x40d) % PICK.length];
}

/** Block position inside its district region, 0 .. HOOD_BLOCKS - 1 on each axis. */
export function inRegion(b: number): number {
  return b - Math.floor(b / HOOD_BLOCKS) * HOOD_BLOCKS;
}

/** The Seafront's northern row of blocks is beach and sea instead of buildings. */
export function isBeach(bi: number, bj: number): boolean {
  return inRegion(bj) === HOOD_BLOCKS - 1 && hoodAt(bi, bj) === H_SEAFRONT;
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
