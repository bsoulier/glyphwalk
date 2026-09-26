import { glyph } from '../core/charset';
import { hash2, hash3 } from '../core/hash';
import { fontBits } from '../world/font';
import { SIGN_BAND_PAD, SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS } from '../world/signs';

export const M_WALL = 1;
export const M_ROOF = 2;
export const M_CAR = 3;
export const M_GLASS = 4;
export const M_WHEEL = 5;
export const M_SKIN = 6;
export const M_CLOTH = 7;
export const M_LAMP = 8;
export const M_LEAF = 9;
export const M_TRUNK = 10;
export const M_SIGN = 11;
export const M_RAIL = 12;
export const M_TRAIN = 13;
export const M_CONCRETE = 14;
export const M_GLOW = 15;

export const FLOOR_H = 3.2;
const COL_W = [2.6, 3.4, 1.8, 2.2];

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PIPE = glyph('|');
const G_DASH = glyph('-');
const G_EQ = glyph('=');
const G_HASH = glyph('#');
const G_PLUS = glyph('+');
const G_O = glyph('O');
const G_o = glyph('o');
const G_SLASH = glyph('/');
const G_QMARK = glyph('?');
const G_FULL = glyph('█');
const G_DARK = glyph('▓');
const G_MED = glyph('▒');
const WIN_GLYPH = [G_HASH, G_EQ, G_DARK, G_O];
const LEAF_GLYPHS = [glyph('&'), glyph('%'), glyph('*'), glyph('#')];
const SHOP: readonly (readonly [number, number, number])[] = [
  [255, 170, 90], [255, 110, 190], [120, 240, 220], [255, 230, 140],
];
const SIGN_GLYPHS = SIGN_TEXTS.map((t) => Array.from(t, (c) => glyph(c)));
const SIGN_BITS = SIGN_TEXTS.map((t) => Array.from(t, (c) => fontBits(c)));
const SIGN_BAND = SIGN_H - 2 * SIGN_BAND_PAD;

let fgBuf: Uint32Array = new Uint32Array(0);
let bgBuf: Uint32Array = new Uint32Array(0);
let fxC = 1;
let fyC = 1;
let fogStart = 80;
let fogInv = 0.01;
let time = 0;
let hazeR = 14;
let hazeG = 18;
let hazeB = 28;

export function beginMaterials(
  fg: Uint32Array, bg: Uint32Array, fx: number, fy: number, far: number, t: number,
  haze: readonly [number, number, number],
): void {
  fgBuf = fg;
  bgBuf = bg;
  fxC = fx;
  fyC = fy;
  time = t;
  fogStart = far * 0.4;
  fogInv = 1 / (far - fogStart);
  hazeR = haze[0];
  hazeG = haze[1];
  hazeB = haze[2];
}

function c8(v: number): number {
  return v > 255 ? 255 : v < 0 ? 0 : v | 0;
}

export function putRaw(i: number, gl: number, r: number, g: number, b: number, br: number, bgc: number, bb: number): void {
  fgBuf[i] = (gl << 24) | (c8(b) << 16) | (c8(g) << 8) | c8(r);
  bgBuf[i] = (c8(bb) << 16) | (c8(bgc) << 8) | c8(br);
}

/**
 * Write one cell with distance fog. `bgk` scales the colour into the cell background, which is what
 * makes surfaces read as solid instead of floating glyphs. Emissive cells resist fog so lights carry far.
 */
export function put(i: number, gl: number, r: number, g: number, b: number, bgk: number, z: number, emissive: number): void {
  let f = 1;
  if (z > fogStart) {
    const x = (z - fogStart) * fogInv;
    f = x >= 1 ? 0 : 1 - x * x;
    if (emissive > 0) f += (Math.sqrt(f) - f) * emissive;
  }
  const k = 1 - f;
  const hr = hazeR * k, hg = hazeG * k, hb = hazeB * k;
  const fr = r * f, fgn = g * f, fbl = b * f;
  fgBuf[i] = (gl << 24) | (c8(fbl + hb) << 16) | (c8(fgn + hg) << 8) | c8(fr + hr);
  bgBuf[i] = (c8(fbl * bgk + hb) << 16) | (c8(fgn * bgk + hg) << 8) | c8(fr * bgk + hr);
}

export function shade(
  i: number, mat: number, u: number, v: number, z: number,
  r: number, g: number, b: number, sh: number, seed: number,
): void {
  switch (mat) {
    case M_WALL: wall(i, u, v, z, r, g, b, sh, seed); break;
    case M_ROOF: roof(i, u, v, z, r, g, b, sh); break;
    case M_SIGN: sign(i, u, v, z, r, g, b, seed); break;
    case M_CAR: put(i, G_EQ, r * sh, g * sh, b * sh, 0.5, z, 0); break;
    case M_GLASS: put(i, G_SLASH, 110 * sh, 160 * sh, 190 * sh, 0.3, z, 0); break;
    case M_WHEEL: put(i, G_O, 72, 72, 78, 0.25, z, 0); break;
    case M_SKIN: put(i, G_o, r * sh, g * sh, b * sh, 0.35, z, 0); break;
    case M_CLOTH: put(i, G_HASH, r * sh, g * sh, b * sh, 0.4, z, 0); break;
    case M_LAMP: put(i, G_DARK, r, g, b, 0.55, z, 1); break;
    case M_LEAF: leaf(i, u, v, z, r, g, b, sh, seed); break;
    case M_TRUNK: put(i, G_PIPE, r * sh, g * sh, b * sh, 0.3, z, 0); break;
    case M_RAIL: put(i, G_EQ, r * sh, g * sh, b * sh, 0.3, z, 0); break;
    case M_TRAIN: train(i, u, v, z, r, g, b, sh); break;
    case M_CONCRETE: put(i, G_COLON, r * sh, g * sh, b * sh, 0.28, z, 0); break;
    case M_GLOW: put(i, G_FULL, r, g, b, 0.6, z, 1); break;
    default: put(i, G_QMARK, 255, 0, 255, 0.5, z, 0);
  }
}

/**
 * Facade with a window grid measured in metres. When a window column shrinks below ~2 cells the
 * pattern switches to a "mip" level: 2^L windows merge into one stable, world-anchored block that is
 * lit or dark as a whole. That keeps distant towers readable instead of shimmering.
 */
function wall(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const style = seed & 3;
  const colW = COL_W[style];
  const litP = (0.14 + ((seed >> 2) & 7) * 0.055) * 1024;
  const warm = (seed >> 5) & 1;
  const cellsU = (colW * fxC) / z;
  const cellsV = (FLOOR_H * fyC) / z;
  const fu = u / colW, fv = v / FLOOR_H;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const k = sh * 0.85;

  if (cellsU >= 2.2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    let win: boolean;
    if (cv === 0) win = lu > 0.08 && lu < 0.92 && lv > 0.06 && lv < 0.72;
    else if (style === 0) win = lu > 0.22 && lu < 0.78 && lv > 0.3 && lv < 0.85;
    else if (style === 1) win = lv > 0.35 && lv < 0.8;
    else if (style === 2) win = lu > 0.3 && lu < 0.7 && lv > 0.12;
    else win = lu > 0.3 && lu < 0.7 && lv > 0.42 && lv < 0.76;

    if (win) {
      const h = hash3(seed, cu, cv);
      if (cv === 0) {
        if ((h & 3) !== 0) {
          const s = SHOP[(h >> 3) & 3];
          const cpmU = fxC / z, cpmV = fyC / z;
          const mu = u / 1.3, mv = v / 0.55;
          if (cpmU > 5 && (mu - Math.floor(mu)) * 1.3 * cpmU < 1) put(i, G_PIPE, s[0] * 0.4, s[1] * 0.4, s[2] * 0.4, 0.25, z, 0);
          else if (cpmV > 4 && (mv - Math.floor(mv)) * 0.55 * cpmV < 1) put(i, G_EQ, s[0] * 0.75, s[1] * 0.75, s[2] * 0.75, 0.35, z, 1);
          else put(i, G_MED, s[0], s[1], s[2], 0.45, z, 1);
        } else put(i, G_DOT, 30, 36, 48, 0.5, z, 0);
      } else if ((h & 1023) < litP) {
        const q = 0.7 + ((h >>> 10) & 63) / 210;
        if (warm) put(i, WIN_GLYPH[style], 255 * q, 196 * q, 110 * q, 0.38, z, 1);
        else put(i, WIN_GLYPH[style], 160 * q, 205 * q, 255 * q, 0.38, z, 1);
      } else put(i, G_DOT, r * 0.22 + 12, g * 0.22 + 16, b * 0.22 + 26, 0.55, z, 0);
      return;
    }
    const gl = lu * cellsU < 1 ? G_PIPE : lv * cellsV < 1 ? G_DASH : style & 1 ? G_DOT : G_COLON;
    put(i, gl, r * k, g * k, b * k, 0.24, z, 0);
    return;
  }

  let lu = 0;
  while (lu < 7 && cellsU * (1 << lu) < 1.1) lu++;
  let lv = 0;
  while (lv < 7 && cellsV * (1 << lv) < 1.1) lv++;
  const h = hash3(seed, (cu >> lu) + 7919 * lu, (cv >> lv) + 7919 * lv);
  if ((h & 1023) < litP) {
    const q = 0.55 + ((h >>> 10) & 63) / 180;
    const gl = style === 1 ? G_EQ : G_COLON;
    if (warm) put(i, gl, 255 * q, 190 * q, 105 * q, 0.3, z, 1);
    else put(i, gl, 150 * q, 195 * q, 255 * q, 0.3, z, 1);
  } else put(i, G_DOT, r * k, g * k, b * k, 0.26, z, 0);
}

function roof(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number): void {
  const cells = (4 * fxC) / z;
  let gl = G_COLON;
  if (cells > 3) {
    const a = u * 0.25, c = v * 0.25;
    const eu = (a - Math.floor(a)) * cells < 1, ev = (c - Math.floor(c)) * cells < 1;
    gl = eu && ev ? G_PLUS : eu || ev ? G_DOT : G_SPACE;
  }
  const k = 0.55 * sh;
  put(i, gl, r * k, g * k, b * k, 0.45, z, 0);
}

/**
 * Three levels of detail, chosen by how many cells one letter covers:
 *  - under a cell: a glowing bar
 *  - a few cells: the real letter in the cell at the letter's centre (reads like a terminal)
 *  - 5+ rows tall: a 3x5 bitmap font made of solid blocks
 */
function sign(i: number, u: number, v: number, z: number, r: number, g: number, b: number, seed: number): void {
  const ti = (seed & 255) % SIGN_TEXTS.length;
  const gls = SIGN_GLYPHS[ti];
  let on = 1;
  if (((seed >> 8) & 7) === 0 && (hash2(seed, Math.floor(time * 7)) & 255) < 60) on = 0.25;
  const cw = (SIGN_CHAR_W * fxC) / z;
  if (cw < 1.1) {
    put(i, G_EQ, r * 0.8 * on, g * 0.8 * on, b * 0.8 * on, 0.35, z, 1);
    return;
  }
  const tu = (u - SIGN_PAD) / SIGN_CHAR_W;
  const k = Math.floor(tu);
  const vb = (SIGN_H - SIGN_BAND_PAD - v) / SIGN_BAND;
  const dim = 0.4 * on;
  if (k < 0 || k >= gls.length || vb < 0 || vb >= 1) {
    put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
    return;
  }
  const rowsPerBand = (SIGN_BAND * fyC) / z;
  if (rowsPerBand >= 5) {
    const bx = Math.floor((tu - k) * 4), by = Math.floor(vb * 5);
    const lit = bx < 3 && ((SIGN_BITS[ti][k] >> (14 - by * 3 - bx)) & 1) === 1;
    if (lit) put(i, G_FULL, r * on, g * on, b * on, 0.7, z, 1);
    else put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
    return;
  }
  const atCentreU = Math.abs(tu - k - 0.5) * cw < 0.5;
  const atCentreV = rowsPerBand < 1 || Math.abs(vb - 0.5) * rowsPerBand < 0.5;
  if (atCentreU && atCentreV) put(i, gls[k], r * on, g * on, b * on, 0.3, z, 1);
  else put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
}

function leaf(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  let gl = LEAF_GLYPHS[1];
  let q = sh;
  if (fxC / z > 3) {
    const h = hash3(Math.floor(u * 2.5), Math.floor(v * 2.5), seed);
    gl = LEAF_GLYPHS[h & 3];
    q *= 0.75 + ((h >> 4) & 15) / 60;
  }
  put(i, gl, r * q, g * q, b * q, 0.35, z, 0);
}

function train(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number): void {
  if (v > 1.1 && v < 2.1) {
    const wu = u / 1.6;
    const lu = wu - Math.floor(wu);
    if ((1.6 * fxC) / z < 1.5) put(i, G_EQ, 220, 190, 130, 0.35, z, 1);
    else if (lu > 0.15 && lu < 0.85) put(i, G_DARK, 255, 215, 150, 0.4, z, 1);
    else put(i, G_PIPE, r * sh, g * sh, b * sh, 0.35, z, 0);
    return;
  }
  put(i, G_EQ, r * sh, g * sh, b * sh, 0.35, z, 0);
}
