import { hash3 } from '../core/hash';
import { worldSeed } from './layout';

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
