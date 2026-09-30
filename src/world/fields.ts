import { hash3 } from '../core/hash';
import { HOOD_BLOCKS, inCity } from './hoods';
import { P, worldSeed } from './layout';

export const CROP_CORN = 0;
export const CROP_SOY = 1;
export const CROP_WHEAT = 2;
export const CROP_PASTURE = 3;
export const CROP_HAY = 4;
export const CROP_PLOWED = 5;

/** Fields are quarter sections, FIELD_BLOCKS x FIELD_BLOCKS blocks, each sown with one crop. */
export const FIELD_BLOCKS = 2;
/** Weighted like the Midwest: mostly corn and soybeans. */
const CROPS = [CROP_CORN, CROP_CORN, CROP_CORN, CROP_SOY, CROP_SOY, CROP_WHEAT, CROP_WHEAT, CROP_PASTURE, CROP_PASTURE, CROP_HAY, CROP_PLOWED];
/** Bit set in `fieldAt` when the rows run along x rather than along z. */
export const ROWS_ALONG_X = 8;

// The ground painter asks for every cell and neighbouring cells share a field, so remember the last one.
let memoI = 0x7fffffff;
let memoJ = 0;
let memoField = 0;

/** Crop of the field that block (bi, bj) lies in (low 3 bits), with ROWS_ALONG_X set when its rows run along x. */
export function fieldAt(bi: number, bj: number): number {
  const fi = Math.floor(bi / FIELD_BLOCKS), fj = Math.floor(bj / FIELD_BLOCKS);
  if (fi !== memoI || fj !== memoJ) {
    memoI = fi;
    memoJ = fj;
    const h = hash3(fi, fj, worldSeed ^ 0xf1e1d);
    memoField = CROPS[h % CROPS.length] | ((h >> 12) & 1 ? ROWS_ALONG_X : 0);
  }
  return memoField;
}

/** Bit set in `farmAt` for a grain farm (bins and a machine shed) rather than a dairy (silos, a paddock and cows). */
export const FARM_GRAIN = 4;
/** Bit set in `farmAt` when the farmstead is laid out mirrored, the house on the right of the drive. */
export const FARM_FLIP = 8;
/** Share of the sections with a farmstead, in percent: one every few hundred metres. */
const FARM_SHARE = 55;

/**
 * Where things stand in a farmstead, in its own frame: `u` along its road, left to right seen from the road,
 * `d` in from the road's centre line, both 0 to P. Shared by the builder, the ground painter and the map.
 * Rectangles are [u0, d0, u1, d1].
 */
export const FARM = {
  driveU: 30,
  driveHalf: 1.8,
  yard: [18, 34, 63, 63],
  house: [5, 15, 16, 23],
  barn: [20, 44, 34, 62],
  light: [36, 39],
} as const;

let farmSI = 0x7fffffff;
let farmSJ = 0;
let farmBI = 0;
let farmBJ = 0;
let farmVal = -1;

/**
 * The farmstead in block (bi, bj): -1 for none, else the side of the block its drive leaves by (0 south,
 * 1 east, 2 north, 3 west), with FARM_GRAIN and FARM_FLIP. Every section outside the city may have one,
 * in one of the two middle blocks along one of its sides, so it faces a country road and not a crossroads.
 */
export function farmAt(bi: number, bj: number): number {
  const si = Math.floor(bi / HOOD_BLOCKS), sj = Math.floor(bj / HOOD_BLOCKS);
  if (si !== farmSI || sj !== farmSJ) {
    farmSI = si;
    farmSJ = sj;
    farmVal = -1;
    const h = hash3(si, sj, worldSeed ^ 0xfa12) >>> 0;
    const i0 = si * HOOD_BLOCKS, j0 = sj * HOOD_BLOCKS, far = HOOD_BLOCKS - 1;
    if (h % 100 < FARM_SHARE && !inCity(i0, j0)) {
      let side = (h >>> 8) & 3;
      const k = 1 + ((h >>> 10) & 1);
      // Farms face a country road: by the city, the other side of the section.
      const across = (s: number): boolean => inCity(i0 + (s === 1 ? HOOD_BLOCKS : s === 3 ? -1 : k), j0 + (s === 2 ? HOOD_BLOCKS : s === 0 ? -1 : k));
      if (across(side)) side ^= 2;
      farmBI = side === 1 ? i0 + far : side === 3 ? i0 : i0 + k;
      farmBJ = side === 2 ? j0 + far : side === 0 ? j0 : j0 + k;
      farmVal = side | ((h >>> 12) & 1 ? FARM_GRAIN : 0) | ((h >>> 13) & 1 ? FARM_FLIP : 0);
    }
  }
  return farmVal >= 0 && bi === farmBI && bj === farmBJ ? farmVal : -1;
}

/** `u` of block-local (lx, lz) in the frame of farmstead `f` (see FARM); matches `plotFrame` on the block. */
export function farmU(f: number, lx: number, lz: number): number {
  const s = f & 3;
  const u = s === 0 ? lx : s === 1 ? lz : s === 2 ? P - lx : P - lz;
  return f & FARM_FLIP ? P - u : u;
}

/** `d` of block-local (lx, lz) in the frame of farmstead `f`. */
export function farmD(f: number, lx: number, lz: number): number {
  const s = f & 3;
  return s === 0 ? lz : s === 1 ? P - lx : s === 2 ? P - lz : lx;
}
