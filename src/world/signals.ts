import type { Camera } from '../render/camera';
import { drawBoxYaw, drawFace, drawPoint, drawVLine, sphereVisible } from '../render/raster';
import { M_CONCRETE, M_PAINT, M_SIGN } from '../render/materials';
import { glyph } from '../core/charset';
import { hash3 } from '../core/hash';
import { FACE_STRIDE } from './faces';
import { P, worldSeed } from './layout';
import { SIGN_CHAR_W, SIGN_H, SIGN_PAD, TEXT_STOP, TEXT_WALK, signSeed } from './signs';

/**
 * Every intersection runs the same cycle shifted by its own offset, so a signal's state is a pure
 * function of time: nothing is stored, and cars, pedestrians and the renderer always agree.
 *   0-12  north/south green      12-14  amber
 *  14-26  east/west green        26-28  amber
 *  28-35  all cars red, pedestrians cross every arm at once (scramble)
 *  35-37  clearance: cars still red, STOP flashes
 */
export const SIG_CYCLE = 37;
const NS_GREEN = 12;
const NS_AMBER = 14;
const EW_GREEN = 26;
const EW_AMBER = 28;
const WALK_END = 35;

export const RED = 0;
export const AMBER = 1;
export const GREEN = 2;

/** Distance from the intersection centre to the corner poles, on both axes. */
const POLE = 9.9;
/** Car signal heads are only worth drawing as geometry this close; beyond it they are single dots. */
const DETAIL_DIST = 70;
const DRAW_DIST = 170;

export function signalPhase(i: number, j: number, t: number): number {
  const off = (hash3(i, j, worldSeed ^ 0x5161) % (SIG_CYCLE * 100)) * 0.01;
  return (t + off) % SIG_CYCLE;
}

export function carLight(ph: number, alongZ: boolean): number {
  if (alongZ) return ph < NS_GREEN ? GREEN : ph < NS_AMBER ? AMBER : RED;
  if (ph < NS_AMBER) return RED;
  return ph < EW_GREEN ? GREEN : ph < EW_AMBER ? AMBER : RED;
}

/** While pedestrians may start crossing, the seconds left before cars move again; otherwise 0. */
export function walkWindow(ph: number): number {
  return ph >= EW_AMBER && ph < WALK_END ? SIG_CYCLE - ph : 0;
}

const G_PIPE = glyph('|');
const G_O = glyph('O');
const G_o = glyph('o');
const G_STAR = glyph('*');

const LAMP_ON: readonly (readonly [number, number, number])[] = [[255, 50, 40], [255, 180, 40], [60, 255, 120]];
const LAMP_Y = [5.1, 4.75, 4.4];
const PLATE_W = 4 * SIGN_CHAR_W + 2 * SIGN_PAD;
const PLATE_SCALE = 0.25;
const SEED_STOP = signSeed(TEXT_STOP, 1, PLATE_SCALE);
const SEED_WALK = signSeed(TEXT_WALK, 1, PLATE_SCALE);

const F = new Float64Array(FACE_STRIDE);

/** Pedestrian plate on the pole, facing (nx, nz). */
function plate(px: number, pz: number, nx: number, nz: number, y0: number, walk: boolean, dim: number): void {
  const w = PLATE_W * PLATE_SCALE, h = SIGN_H * PLATE_SCALE;
  const tx = -nz, tz = nx;
  const cx = px + nx * 0.12, cz = pz + nz * 0.12;
  const ax = cx - tx * w * 0.5, az = cz - tz * w * 0.5;
  const bx = cx + tx * w * 0.5, bz = cz + tz * w * 0.5;
  F[0] = ax; F[1] = y0; F[2] = az;
  F[3] = bx; F[4] = y0; F[5] = bz;
  F[6] = bx; F[7] = y0 + h; F[8] = bz;
  F[9] = ax; F[10] = y0 + h; F[11] = az;
  F[12] = 0; F[13] = 0; F[14] = PLATE_W; F[15] = 0; F[16] = PLATE_W; F[17] = SIGN_H; F[18] = 0; F[19] = SIGN_H;
  F[20] = nx; F[21] = 0; F[22] = nz;
  F[23] = M_SIGN;
  if (walk) { F[24] = 170 * dim; F[25] = 255 * dim; F[26] = 190 * dim; }
  else { F[24] = 255 * dim; F[25] = 70 * dim; F[26] = 50 * dim; }
  F[27] = walk ? SEED_WALK : SEED_STOP;
  drawFace(F, 0);
}

/**
 * Four poles per intersection, one on each corner. Each carries the car signal for traffic arriving
 * from the opposite side (right-hand traffic sees it on the far right) and a STOP / WALK plate facing
 * each of its two crossings.
 */
export function drawSignals(cam: Camera, t: number): void {
  const i0 = Math.ceil((cam.x - DRAW_DIST) / P), i1 = Math.floor((cam.x + DRAW_DIST) / P);
  const j0 = Math.ceil((cam.z - DRAW_DIST) / P), j1 = Math.floor((cam.z + DRAW_DIST) / P);
  const blink = Math.floor(t * 2.5) & 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const ix = i * P, iz = j * P;
      const d = Math.hypot(ix - cam.x, iz - cam.z);
      if (d > DRAW_DIST || !sphereVisible(ix, 3, iz, 16)) continue;
      const ph = signalPhase(i, j, t);
      const near = d < DETAIL_DIST;
      const walk = walkWindow(ph) > 0;
      const pedDim = walk || ph < WALK_END || blink ? 1 : 0.3;
      for (let k = 0; k < 4; k++) {
        const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1;
        const px = ix + sx * POLE, pz = iz + sz * POLE;
        const alongZ = sx === sz;
        const fx = alongZ ? 0 : -sx, fz = alongZ ? -sz : 0;
        const light = carLight(ph, alongZ);
        const c = LAMP_ON[light];
        if (!near) {
          drawPoint(px + fx * 0.2, LAMP_Y[light], pz + fz * 0.2, G_STAR, c[0], c[1], c[2], 0.5, 1);
          continue;
        }
        drawVLine(px, 0, 5.4, pz, 0.07, G_PIPE, 70, 72, 80, M_CONCRETE);
        drawBoxYaw(px, 4.75, pz, Math.atan2(fx, fz), 0.2, 0.55, 0.14, M_PAINT, 34, 36, 40, 0);
        for (let s = 0; s < 3; s++) {
          const on = s === light;
          const q = on ? 1 : 0.16;
          const lc = LAMP_ON[s];
          drawPoint(px + fx * 0.17, LAMP_Y[s], pz + fz * 0.17, on ? G_O : G_o, lc[0] * q, lc[1] * q, lc[2] * q, 0.5, on ? 1 : 0);
        }
        plate(px, pz, -sx, 0, 2.5, walk, pedDim);
        plate(px, pz, 0, -sz, 3.05, walk, pedDim);
      }
    }
  }
}
