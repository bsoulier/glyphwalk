import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import { put, putRaw } from './materials';
import { glyph } from '../core/charset';
import { hash2, hash3, valueNoise } from '../core/hash';
import {
  HALF, KIND_PARK, KIND_PLAZA, LAMP_OFF, LAMP_SPACING, LOT_EDGE, P, ROAD_HALF, blockKind, hasPond,
} from '../world/layout';

export interface SkyEnv {
  time: number;
  rain: boolean;
  flash: number;
}

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_DASH = glyph('-');
const G_PIPE = glyph('|');
const G_EQ = glyph('=');
const G_PLUS = glyph('+');
const G_TILDE = glyph('~');
const G_COMMA = glyph(',');
const G_QUOTE = glyph("'");
const G_STAR = glyph('*');
const G_AT = glyph('@');
const GRASS = [glyph(','), glyph("'"), glyph('"'), glyph('.')];

const MOON_X = 0.55, MOON_Y = 0.42, MOON_Z = 0.72;
const MOON_LEN = Math.hypot(MOON_X, MOON_Y, MOON_Z);
const LAMP_R2 = 8.5 * 8.5;

let time = 0;
let tick = 0;
let rain = false;
let flash = 0;
let nsVertical = false;
// Star lattice is one unit per cell so each star lands in a single cell.
let starScaleX = 1;
let starScaleY = 1;

export function drawBackground(fb: FrameBuffer, cam: Camera, env: SkyEnv): void {
  const { cols, rows, depth } = fb;
  time = env.time;
  tick = Math.floor(env.time * 10);
  rain = env.rain;
  flash = env.flash;
  nsVertical = Math.abs(cam.cY) > Math.SQRT1_2;
  starScaleX = cam.fx;
  starScaleY = cam.fy;

  const { fx, fy, cY, sY, cP, sP, far } = cam;
  const cxs = cam.cx, cys = cam.cy;
  const rX = cY, rZ = -sY;
  const uX = -sY * sP, uY = cP, uZ = -cY * sP;
  const fX = sY * cP, fY = sP, fZ = cY * cP;
  const camX = cam.x, camY = cam.y, camZ = cam.z;
  const invFx = 1 / fx;

  for (let row = 0; row < rows; row++) {
    const vy = -(row + 0.5 - cys) / fy;
    const dY = uY * vy + fY;
    const baseX = uX * vy + fX, baseZ = uZ * vy + fZ;
    let o = row * cols;
    // With no camera roll, every cell in a row hits the ground at the same depth.
    const t = dY < -1e-6 ? -camY / dY : Infinity;
    if (t < far) {
      const vyN = -(row + 1.5 - cys) / fy;
      const dYN = uY * vyN + fY;
      const tN = dYN < -1e-6 ? -camY / dYN : far;
      const fp = Math.max(t * invFx, Math.abs(tN - t));
      const iz = 1 / t;
      for (let col = 0; col < cols; col++, o++) {
        if (depth[o] !== 0) continue;
        const vx = (col + 0.5 - cxs) * invFx;
        ground(o, camX + t * (baseX + rX * vx), camZ + t * (baseZ + rZ * vx), t, fp);
        depth[o] = iz;
      }
    } else {
      for (let col = 0; col < cols; col++, o++) {
        if (depth[o] !== 0) continue;
        const vx = (col + 0.5 - cxs) * invFx;
        sky(o, baseX + rX * vx, dY, baseZ + rZ * vx);
      }
    }
  }
}

function alongDist(a: number): number {
  if (a < LAMP_SPACING) return LAMP_SPACING - a;
  if (a > P - LAMP_SPACING) return a - (P - LAMP_SPACING);
  const m = a - LAMP_SPACING * Math.round(a / LAMP_SPACING);
  return m < 0 ? -m : m;
}

function lampLight(ax: number, az: number, lx: number, lz: number): number {
  let best = 0;
  const dx = ax - LAMP_OFF;
  if (dx > -9 && dx < 9) {
    const dz = alongDist(lz);
    const d2 = dx * dx + dz * dz;
    if (d2 < LAMP_R2) best = 1 - d2 / LAMP_R2;
  }
  const dz = az - LAMP_OFF;
  if (dz > -9 && dz < 9) {
    const dxa = alongDist(lx);
    const d2 = dz * dz + dxa * dxa;
    if (d2 < LAMP_R2) {
      const l = 1 - d2 / LAMP_R2;
      if (l > best) best = l;
    }
  }
  return best * best;
}

/** `fp` is the ground footprint of one cell in metres; details thinner than that are dropped or widened. */
function ground(o: number, X: number, Z: number, t: number, fp: number): void {
  const bi = Math.floor(X / P), bj = Math.floor(Z / P);
  const lx = X - bi * P, lz = Z - bj * P;
  const sx = lx < HALF ? lx : lx - P;
  const sz = lz < HALF ? lz : lz - P;
  const ax = sx < 0 ? -sx : sx, az = sz < 0 ? -sz : sz;
  let gl: number, r: number, g: number, b: number;
  let bgk = 0.2;
  const onX = ax < ROAD_HALF, onZ = az < ROAD_HALF;

  if (onX || onZ) {
    r = 50; g = 54; b = 62;
    if (fp < 0.3) {
      const h = hash2(Math.floor(X * 3), Math.floor(Z * 3)) & 7;
      gl = h < 2 ? G_COLON : h < 5 ? G_DOT : G_SPACE;
    } else gl = fp < 1.4 ? G_COLON : G_DASH;

    if (onX !== onZ) {
      const a = onX ? ax : az;
      const s = onX ? sx : sz;
      const along = onX ? lz : lx;
      const cross = onX ? az : ax;
      if (cross < ROAD_HALF + 3.6) {
        if (fp < 0.9) {
          if ((Math.floor((s + ROAD_HALF) / 0.9) & 1) === 0) {
            gl = G_EQ; r = 175; g = 175; b = 172; bgk = 0.3;
          }
        } else {
          gl = G_EQ; r = 115; g = 115; b = 115;
        }
      } else {
        const w = fp * 0.45 > 0.12 ? fp * 0.45 : 0.12;
        const vertical = onX === nsVertical;
        if (a < w && (Math.floor(along / 3) & 1) === 0) {
          gl = vertical ? G_PIPE : G_DASH; r = 210; g = 170; b = 60; bgk = 0.3;
        } else if (Math.abs(a - (ROAD_HALF - 0.4)) < w) {
          gl = vertical ? G_PIPE : G_DASH; r = 150; g = 150; b = 150; bgk = 0.25;
        }
      }
    }
    if (rain && fp < 2.5 && valueNoise(X * 0.18, Z * 0.18, 5) > 0.66) {
      r = 38; g = 58; b = 92; bgk = 0.35;
      if (fp < 0.6 && ((Math.floor(X * 2 + time * 2) + Math.floor(Z * 3)) & 7) === 0) gl = G_TILDE;
    }
  } else if (ax < LOT_EDGE || az < LOT_EDGE) {
    r = 104; g = 96; b = 84;
    if (ax < ROAD_HALF + 0.3 || az < ROAD_HALF + 0.3) {
      gl = G_EQ; r = 138; g = 132; b = 122;
    } else if (fp < 0.3) {
      const a = X * 0.66, c = Z * 0.66;
      const eu = a - Math.floor(a) < 0.14, ev = c - Math.floor(c) < 0.14;
      gl = eu && ev ? G_PLUS : eu ? G_PIPE : ev ? G_DASH : G_DOT;
    } else gl = G_COLON;
  } else {
    const kind = blockKind(bi, bj);
    if (kind === KIND_PARK) {
      const dcx = lx - HALF, dcz = lz - HALF;
      if (hasPond(bi, bj) && dcx * dcx + dcz * dcz < 81) {
        r = 30; g = 62; b = 120; bgk = 0.4;
        gl = fp > 0.6 || ((Math.floor(X * 1.2 + time * 1.5) + Math.floor(Z * 2.2)) & 3) === 0 ? G_TILDE : G_DASH;
      } else if (Math.abs(dcx) < 1.6 || Math.abs(dcz) < 1.6) {
        gl = G_DOT; r = 120; g = 108; b = 84;
      } else {
        const h = hash2(Math.floor(X * 2), Math.floor(Z * 2));
        gl = fp < 0.6 ? GRASS[h & 3] : G_COMMA;
        const q = 0.8 + ((h >> 4) & 15) / 60;
        r = 40 * q; g = 96 * q; b = 48 * q;
      }
    } else if (kind === KIND_PLAZA) {
      const chk = (Math.floor(X * 0.5) + Math.floor(Z * 0.5)) & 1;
      gl = chk ? G_PLUS : G_DOT;
      r = chk ? 104 : 84; g = chk ? 96 : 78; b = chk ? 116 : 94;
    } else {
      gl = G_DOT; r = 58; g = 58; b = 62;
    }
  }

  const l = lampLight(ax, az, lx, lz);
  if (l > 0) {
    r += 175 * l; g += 125 * l; b += 55 * l; bgk += 0.3 * l;
  }
  if (rain && fp < 0.6 && (hash3(Math.floor(X * 1.5), Math.floor(Z * 1.5), tick) & 255) === 0) {
    gl = G_QUOTE; r = 150; g = 170; b = 200;
  }
  put(o, gl, r, g, b, bgk, t, 0);
}

function sky(o: number, dx: number, dy: number, dz: number): void {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const el = dy / len;
  const e = el > 0 ? el : 0;
  const glow = Math.exp(-e * 9);
  let r = 3 + 25 * glow;
  let g = 5 + 20 * glow;
  let b = 10 + 33 * glow;
  if (flash > 0) {
    r += 38 * flash; g += 42 * flash; b += 58 * flash;
  }
  let gl = G_SPACE, fr = 0, fgc = 0, fbl = 0;

  if (el > 0.015) {
    const az = Math.atan2(dx, dz);
    const md = (dx * MOON_X + dy * MOON_Y + dz * MOON_Z) / (len * MOON_LEN);
    if (md > 0.9994) {
      gl = G_AT; fr = 235; fgc = 232; fbl = 205;
      r += 40; g += 40; b += 36;
    } else {
      if (md > 0.996) {
        const h = (md - 0.996) * 250;
        r += 22 * h; g += 22 * h; b += 26 * h;
      }
      const h = hash2(Math.floor(az * starScaleX), Math.floor(el * starScaleY));
      if ((h & 1023) < 5) {
        const tw = ((h >>> 12) + tick) & 15;
        const q = 120 + ((h >>> 20) & 127) - (tw < 2 ? 70 : 0);
        gl = (h >>> 28) === 0 ? G_STAR : (h >>> 27) & 1 ? G_PLUS : G_DOT;
        fr = q; fgc = q; fbl = q + 20;
      }
    }
    if (rain) {
      const n = valueNoise(az * 2.5 + time * 0.03, el * 9, 91);
      if (n > 0.55) {
        const c = (n - 0.55) * 2.2;
        r += 26 * c; g += 26 * c; b += 32 * c;
        if (gl !== G_AT) {
          gl = c > 0.5 ? G_COLON : G_DOT;
          fr = r * 1.6; fgc = g * 1.6; fbl = b * 1.6;
        }
      }
    }
  }
  putRaw(o, gl, fr, fgc, fbl, r, g, b);
}
