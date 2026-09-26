import { glyph } from '../core/charset';
import { hash2, hash3 } from '../core/hash';
import { fontBits } from '../world/font';
import {
  SIGN_BAND_PAD, SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_SCALES, SIGN_TEXTS, VSIGN_CHAR_H, VSIGN_PAD,
} from '../world/signs';
import { fxC, fyC, put, span, time, windowLit } from './surface';

export const F_GENERIC = 0;
export const F_GLASS = 1;
export const F_BRICK = 2;
export const F_STONE = 3;
export const F_WOOD = 4;
export const F_METAL = 5;

/** Storey heights per facade; building heights are built as multiples so the top floor is whole. */
export const FLOOR_H = [3.2, 3.6, 3.0, 3.3, 3.0, 4.5];

/** Seed bits: style 0-1, lit level 2-4, warm 5, id 6-17, facade 18-20. Stays under 2^24 for Float32. */
export function facadeSeed(facade: number, style: number, lit: number, warm: number, id: number): number {
  return (style & 3) | ((lit & 7) << 2) | ((warm & 1) << 5) | ((id & 4095) << 6) | ((facade & 7) << 18);
}

/** Window opening inside one bay of one storey, as fractions of the bay: u0, u1, v0, v1. */
export type WinRect = readonly [number, number, number, number];

export interface FacadeWindows {
  colW: number;
  /** Shop-floor openings, or null when the ground floor has none. */
  ground: WinRect | null;
  upper: WinRect;
}

const COL_W = [2.6, 3.4, 1.8, 2.2];
const GENERIC_WIN: readonly WinRect[] = [[0.22, 0.78, 0.3, 0.85], [0, 1, 0.35, 0.8], [0.3, 0.7, 0.12, 1], [0.3, 0.7, 0.42, 0.76]];

/**
 * Where each facade draws its windows. The shaders below test against these same rectangles, and
 * interiors cut their wall openings from them, so looking out of a window lines up with the facade.
 */
export function facadeWindows(seed: number): FacadeWindows {
  const style = seed & 3;
  switch ((seed >> 18) & 7) {
    case F_GLASS: return { colW: 1.6, ground: [0.03, 1, 0.06, 1], upper: [0.03, 1, 0.06, 1] };
    case F_BRICK: return { colW: 2.4, ground: [0.2, 0.8, 0, 0.72], upper: [0.3, 0.7, 0.25, 0.8] };
    case F_STONE: return { colW: 2.3, ground: [0.14, 0.86, 0, 0.86], upper: [0.3, 0.7, 0.06, 0.88] };
    case F_WOOD: return { colW: 1.8, ground: [0.1, 0.9, 0, 0.75], upper: [0.2, 0.8, 0.3, 0.82] };
    case F_METAL: return { colW: 6, ground: null, upper: [0, 0.5, 0.55, 0.85] };
    default: return { colW: COL_W[style], ground: [0.08, 0.92, 0.06, 0.72], upper: GENERIC_WIN[style] };
  }
}

function inWin(w: WinRect, lu: number, lv: number): boolean {
  return lu > w[0] && lu < w[1] && lv > w[2] && lv < w[3];
}

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PIPE = glyph('|');
const G_DASH = glyph('-');
const G_EQ = glyph('=');
const G_HASH = glyph('#');
const G_PLUS = glyph('+');
const G_O = glyph('O');
const G_SLASH = glyph('/');
const G_US = glyph('_');
const G_CARET = glyph('^');
const G_FULL = glyph('█');
const G_DARK = glyph('▓');
const G_MED = glyph('▒');
const WIN_GLYPH = [G_HASH, G_EQ, G_DARK, G_O];
const GROUND_GENERIC: WinRect = [0.08, 0.92, 0.06, 0.72];
const W_BRICK = facadeWindows(F_BRICK << 18);
const W_STONE = facadeWindows(F_STONE << 18);
const W_WOOD = facadeWindows(F_WOOD << 18);

const SHOP: readonly (readonly [number, number, number])[] = [
  [255, 170, 90], [255, 110, 190], [120, 240, 220], [255, 230, 140],
];
const SHUTTERS: readonly (readonly [number, number, number])[] = [
  [60, 110, 80], [60, 80, 130], [140, 50, 45], [110, 90, 60],
];
const AWNINGS: readonly (readonly [number, number, number])[] = [
  [190, 40, 45], [40, 110, 70], [35, 50, 110], [200, 140, 40],
];
const CREAM: readonly [number, number, number] = [235, 228, 210];

const SIGN_GLYPHS = SIGN_TEXTS.map((t) => Array.from(t, (c) => glyph(c)));
const SIGN_BITS = SIGN_TEXTS.map((t) => Array.from(t, (c) => fontBits(c)));
const SIGN_BAND = SIGN_H - 2 * SIGN_BAND_PAD;

export function wall(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  switch ((seed >> 18) & 7) {
    case F_GLASS: glass(i, u, v, z, r, g, b, sh, seed); break;
    case F_BRICK: brick(i, u, v, z, r, g, b, sh, seed); break;
    case F_STONE: stone(i, u, v, z, r, g, b, sh, seed); break;
    case F_WOOD: wood(i, u, v, z, r, g, b, sh, seed); break;
    case F_METAL: metal(i, u, v, z, r, g, b, sh, seed); break;
    default: generic(i, u, v, z, r, g, b, sh, seed);
  }
}

/** Each window has a fixed hash, so as `windowLit` rises at dusk they switch on one by one. */
function litThreshold(seed: number, base: number): number {
  return (base + ((seed >> 2) & 7) * 0.055) * 1024 * windowLit;
}

/**
 * Distant windows: 2^L windows merge into one world-anchored block that is lit or dark as a whole.
 * At L = 0 the hash matches the near-field window, so the switch between the two is seamless.
 */
function farWindows(
  i: number, cu: number, cv: number, cellsU: number, cellsV: number, seed: number, litP: number,
  lr: number, lg: number, lb: number, litGl: number, wr: number, wg: number, wb: number, wallGl: number, wallK: number, z: number,
): void {
  let lu = 0;
  while (lu < 7 && cellsU * (1 << lu) < 1.1) lu++;
  let lv = 0;
  while (lv < 7 && cellsV * (1 << lv) < 1.1) lv++;
  const h = hash3(seed, (cu >> lu) + 7919 * lu, (cv >> lv) + 7919 * lv);
  if ((h & 1023) < litP) {
    const q = 0.55 + ((h >>> 10) & 63) / 180;
    put(i, litGl, lr * q, lg * q, lb * q, 0.3, z, 1);
  } else put(i, wallGl, wr, wg, wb, wallK, z, 0);
}

function generic(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const style = seed & 3;
  const colW = COL_W[style];
  const fh = FLOOR_H[F_GENERIC];
  const litP = litThreshold(seed, 0.14);
  const warm = (seed >> 5) & 1;
  const cellsU = (colW * fxC) / z;
  const cellsV = (fh * fyC) / z;
  const fu = u / colW, fv = v / fh;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const k = sh * 0.85;
  const lr = warm ? 255 : 160, lg = warm ? 196 : 205, lb = warm ? 110 : 255;

  if (cellsU >= 2.2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    if (inWin(cv === 0 ? GROUND_GENERIC : GENERIC_WIN[style], lu, lv)) {
      const h = hash3(seed, cu, cv);
      if (cv === 0) shopWindow(i, u, v, z, h);
      else if ((h & 1023) < litP) {
        const q = 0.7 + ((h >>> 10) & 63) / 210;
        put(i, WIN_GLYPH[style], lr * q, lg * q, lb * q, 0.38, z, 1);
      } else put(i, G_DOT, r * 0.22 + 12, g * 0.22 + 16, b * 0.22 + 26, 0.55, z, 0);
      return;
    }
    const gl = lu * cellsU < 1 ? G_PIPE : lv * cellsV < 1 ? G_DASH : style & 1 ? G_DOT : G_COLON;
    put(i, gl, r * k, g * k, b * k, 0.24, z, 0);
    return;
  }
  farWindows(i, cu, cv, cellsU, cellsV, seed, litP, lr, lg, lb, style === 1 ? G_EQ : G_COLON, r * k, g * k, b * k, G_DOT, 0.26, z);
}

function shopWindow(i: number, u: number, v: number, z: number, h: number): void {
  if ((h & 3) === 0) {
    put(i, G_DOT, 30, 36, 48, 0.5, z, 0);
    return;
  }
  const s = SHOP[(h >> 3) & 3];
  const cpmU = fxC / z, cpmV = fyC / z;
  const mu = u / 1.3, mv = v / 0.55;
  if (cpmU > 5 && (mu - Math.floor(mu)) * 1.3 * cpmU < 1) put(i, G_PIPE, s[0] * 0.4, s[1] * 0.4, s[2] * 0.4, 0.25, z, 0);
  else if (cpmV > 4 && (mv - Math.floor(mv)) * 0.55 * cpmV < 1) put(i, G_EQ, s[0] * 0.75, s[1] * 0.75, s[2] * 0.75, 0.35, z, 1);
  else put(i, G_MED, s[0], s[1], s[2], 0.45, z, 1);
}

/** Downtown curtain wall: steel mullions, floor slabs, offices lit in runs of four bays. */
function glass(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const colW = 1.6, fh = FLOOR_H[F_GLASS];
  const litP = litThreshold(seed, 0.16);
  const warm = (seed >> 5) & 1;
  const cellsU = (colW * fxC) / z, cellsV = (fh * fyC) / z;
  const fu = u / colW, fv = v / fh;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const bay = cu >> 2;
  const lr = warm ? 255 : 190, lg = warm ? 222 : 218, lb = warm ? 170 : 255;
  if (cellsU >= 2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    if (lu * cellsU < 1) { put(i, G_PIPE, 150 * sh, 160 * sh, 176 * sh, 0.3, z, 0); return; }
    if (lv * cellsV < 1) { put(i, G_DASH, r * 0.7 * sh, g * 0.7 * sh, b * 0.7 * sh, 0.35, z, 0); return; }
    const h = hash3(seed, bay, cv);
    if ((h & 1023) < litP) {
      const q = 0.75 + ((h >>> 10) & 63) / 250;
      put(i, G_MED, lr * q, lg * q, lb * q, 0.5, z, 1);
    } else put(i, G_SLASH, r * 0.45 * sh + 10, g * 0.5 * sh + 16, b * 0.6 * sh + 30, 0.45, z, 0);
    return;
  }
  let lu = 0;
  while (lu < 7 && cellsU * 4 * (1 << lu) < 1.1) lu++;
  let lv = 0;
  while (lv < 7 && cellsV * (1 << lv) < 1.1) lv++;
  const h = hash3(seed, (bay >> lu) + 7919 * lu, (cv >> lv) + 7919 * lv);
  if ((h & 1023) < litP) {
    const q = 0.6 + ((h >>> 10) & 63) / 200;
    put(i, G_EQ, lr * q, lg * q, lb * q, 0.35, z, 1);
  } else put(i, G_DOT, r * 0.5 * sh + 8, g * 0.55 * sh + 12, b * 0.65 * sh + 22, 0.35, z, 0);
}

/** Old Town row house: brick (style 0-1) or pastel plaster (2-3), small windows with shutters. */
function brick(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const style = seed & 3;
  const colW = 2.4, fh = FLOOR_H[F_BRICK];
  const litP = litThreshold(seed, 0.2);
  const cellsU = (colW * fxC) / z, cellsV = (fh * fyC) / z;
  const fu = u / colW, fv = v / fh;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const k = sh * 0.88;
  if (cellsU >= 2.2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    const up = W_BRICK.upper;
    if (cv === 0) {
      if (inWin(W_BRICK.ground as WinRect, lu, lv)) {
        if (hash3(seed, cu, 0) & 1) put(i, G_MED, 255, 190, 110, 0.45, z, 1);
        else put(i, G_PIPE, 96, 64, 42, 0.55, z, 0);
        return;
      }
    } else if (lv > up[2] && lv < up[3]) {
      if (lu > up[0] && lu < up[1]) {
        const h = hash3(seed, cu, cv);
        if ((h & 1023) < litP) put(i, G_PLUS, 255, 200, 120, 0.4, z, 1);
        else put(i, G_DOT, 30, 32, 40, 0.55, z, 0);
        return;
      }
      if ((lu > 0.17 && lu < 0.3) || (lu > 0.7 && lu < 0.83)) {
        const s = SHUTTERS[(seed >> 6) & 3];
        put(i, G_EQ, s[0] * sh, s[1] * sh, s[2] * sh, 0.5, z, 0);
        return;
      }
    }
    if (style < 2 && fyC / z > 8) {
      const course = Math.floor(v / 0.3);
      const brickId = Math.floor((u + (course & 1) * 0.3) / 0.6);
      const q = k * (0.82 + (hash2(brickId, course) & 31) / 120);
      const mortar = (v / 0.3 - course) * 0.3 * (fyC / z) < 1;
      put(i, mortar ? G_US : G_EQ, r * q, g * q, b * q, 0.35, z, 0);
    } else put(i, style < 2 ? G_COLON : G_DOT, r * k, g * k, b * k, style < 2 ? 0.3 : 0.45, z, 0);
    return;
  }
  farWindows(i, cu, cv, cellsU, cellsV, seed, litP, 255, 200, 120, G_COLON, r * k, g * k, b * k, G_DOT, 0.35, z);
}

/** Paris limestone: rusticated shop floor, tall French windows, iron balconies on floors 2 and 5. */
function stone(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const colW = 2.3, fh = FLOOR_H[F_STONE];
  const litP = litThreshold(seed, 0.18);
  const cellsU = (colW * fxC) / z, cellsV = (fh * fyC) / z;
  const fu = u / colW, fv = v / fh;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const k = sh * 0.9;
  if (cellsU >= 2.2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    if (cv === 0) {
      if (inWin(W_STONE.ground as WinRect, lu, lv)) {
        const h = hash3(seed, cu, 0);
        if ((h & 3) !== 0) put(i, G_MED, 255, 205, 130, 0.45, z, 1);
        else put(i, G_DOT, 34, 32, 36, 0.5, z, 0);
        return;
      }
      const gv = v / 0.45;
      const groove = (gv - Math.floor(gv)) * 0.45 * (fyC / z) < 1;
      put(i, groove ? G_DASH : G_DOT, r * k, g * k, b * k, 0.5, z, 0);
      return;
    }
    if ((cv === 2 || cv === 5) && Math.abs(lv - 0.28) * cellsV < 0.5) {
      put(i, G_EQ, 46, 46, 52, 0.2, z, 0);
      return;
    }
    if (inWin(W_STONE.upper, lu, lv)) {
      const h = hash3(seed, cu, cv);
      if ((h & 1023) < litP) {
        const q = 0.75 + ((h >>> 10) & 63) / 250;
        put(i, G_HASH, 255 * q, 215 * q, 150 * q, 0.4, z, 1);
      } else put(i, G_DOT, 36, 40, 52, 0.55, z, 0);
      return;
    }
    put(i, G_DOT, r * k, g * k, b * k, 0.5, z, 0);
    return;
  }
  farWindows(i, cu, cv, cellsU, cellsV, seed, litP, 255, 215, 150, G_COLON, r * k, g * k, b * k, G_DOT, 0.5, z);
}

/** Japantown: dark slatted wood, glowing shoji screens; style 3 is red lacquer for temples. */
function wood(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const colW = 1.8, fh = FLOOR_H[F_WOOD];
  const litP = litThreshold(seed, 0.3);
  const cellsU = (colW * fxC) / z, cellsV = (fh * fyC) / z;
  const fu = u / colW, fv = v / fh;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  const k = sh * 0.9;
  if (cellsU >= 2.2 && cellsV >= 2) {
    const lu = fu - cu, lv = fv - cv;
    if (cv === 0 && inWin(W_WOOD.ground as WinRect, lu, lv)) {
      const h = hash3(seed, cu, 0);
      if ((h & 3) !== 0) put(i, G_MED, 255, 140, 90, 0.5, z, 1);
      else put(i, G_PIPE, 60, 30, 30, 0.5, z, 0);
      return;
    }
    if (inWin(W_WOOD.upper, lu, lv)) {
      const lit = (hash3(seed, cu, cv) & 1023) < litP;
      const cpmU = fxC / z, cpmV = fyC / z;
      const gu = u / 0.45, gv = v / 0.45;
      const grid = cpmU > 7 && ((gu - Math.floor(gu)) * 0.45 * cpmU < 1 || (gv - Math.floor(gv)) * 0.45 * cpmV < 1);
      const q = lit ? 1 : 0.35;
      put(i, grid ? G_PLUS : G_MED, 255 * q, 228 * q, 180 * q, 0.5, z, lit ? 1 : 0);
      return;
    }
    const su = u / 0.3;
    const slat = fxC / z > 5 && (su - Math.floor(su)) * 0.3 * (fxC / z) < 1;
    put(i, slat ? G_PIPE : G_SPACE, r * k, g * k, b * k, 0.55, z, 0);
    return;
  }
  farWindows(i, cu, cv, cellsU, cellsV, seed, litP, 255, 222, 170, G_COLON, r * k, g * k, b * k, G_SPACE, 0.55, z);
}

/** Docklands: corrugated cladding, roller doors every 8 m, a strip of high windows per storey. */
function metal(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const k = sh * 0.85;
  const du = u / 8, dl = du - Math.floor(du);
  if (v < 4.3 && dl > 0.2 && dl < 0.8) {
    if ((hash3(seed, Math.floor(du), 1) & 7) === 0) put(i, G_MED, 255, 170, 80, 0.5, z, 1);
    else {
      const sv = v / 0.35;
      put(i, (sv - Math.floor(sv)) * 0.35 * (fyC / z) < 1 ? G_EQ : G_DASH, 92, 98, 110, 0.4, z, 0);
    }
    return;
  }
  const fv = v / FLOOR_H[F_METAL], cv = Math.floor(fv), lv = fv - cv;
  if (cv >= 1 && lv > 0.55 && lv < 0.85 && (Math.floor(u / 3) & 1) === 0) {
    if ((hash3(seed, Math.floor(u / 3), cv) & 1023) < litThreshold(seed, 0.1)) put(i, G_EQ, 255, 175, 90, 0.35, z, 1);
    else put(i, G_EQ, 40, 46, 56, 0.4, z, 0);
    return;
  }
  put(i, fxC / z > 3 ? G_PIPE : G_COLON, r * k, g * k, b * k, 0.35, z, 0);
}

/** Pitched tile roofs; rows of `^` read as a roof at any size, collapsing to `=` far away. */
export function tiles(i: number, v: number, z: number, r: number, g: number, b: number, sh: number): void {
  const rowsPer = (0.4 * fyC) / z;
  let gl = G_EQ;
  if (rowsPer > 1.5) {
    const f = v / 0.4 - Math.floor(v / 0.4);
    gl = f * rowsPer < 1 ? G_US : G_CARET;
  }
  put(i, gl, r * sh, g * sh, b * sh, 0.5, z, 0);
}

/** Paris slate mansard with a dormer per window bay (bays line up with the stone facade below). */
export function mansard(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const colW = 2.3;
  const cellsU = (colW * fxC) / z;
  const fu = u / colW, cu = Math.floor(fu), lu = fu - cu;
  if (v > 0.9 && v < 2.5) {
    const h = hash3(seed, cu, 99);
    const lit = (h & 1023) < litThreshold(seed, 0.12);
    if (cellsU >= 2.2 && lu > 0.32 && lu < 0.68) {
      if (lit) put(i, G_HASH, 255, 210, 140, 0.4, z, 1);
      else put(i, G_DOT, 30, 34, 44, 0.55, z, 0);
      return;
    }
    if (cellsU < 2.2 && cellsU >= 0.8 && lit) {
      put(i, G_COLON, 230, 190, 125, 0.3, z, 1);
      return;
    }
  }
  const su = u / 0.55;
  const seam = fxC / z > 6 && (su - Math.floor(su)) * 0.55 * (fxC / z) < 1;
  put(i, seam ? G_PIPE : G_SLASH, r * sh, g * sh, b * sh, 0.5, z, 0);
}

export function awning(i: number, u: number, z: number, seed: number): void {
  const c = AWNINGS[seed & 3];
  if ((0.5 * fxC) / z < 1) {
    put(i, G_EQ, (c[0] + CREAM[0]) * 0.5, (c[1] + CREAM[1]) * 0.5, (c[2] + CREAM[2]) * 0.5, 0.6, z, 0);
    return;
  }
  const s = (Math.floor(u / 0.5) & 1) === 0 ? c : CREAM;
  put(i, G_EQ, s[0], s[1], s[2], 0.6, z, 0);
}

export function corrugated(i: number, z: number, r: number, g: number, b: number, sh: number): void {
  put(i, fxC / z > 2.5 ? G_PIPE : G_COLON, r * sh, g * sh, b * sh, 0.45, z, 0);
}

/** Seconds per window in which a street sign may lose power, and how long the outage stutters. */
const STUTTER_WINDOW = 5;
const STUTTER_S = 1.3;

/**
 * Brightness of the whole sign: buzzing ones dip at random, and now and then any street sign (id > 0)
 * loses power, stutters dark with a few blinks, and comes back.
 */
function signOn(seed: number): number {
  if (((seed >> 8) & 7) === 0 && (hash2(seed, Math.floor(time * 7)) & 255) < 60) return 0.25;
  if (seed >> 14 !== 0) {
    const w = Math.floor(time / STUTTER_WINDOW);
    if (hash2(seed ^ 0x3c3, w) % 30 === 0 && time - w * STUTTER_WINDOW < STUTTER_S) {
      return (hash2(seed, Math.floor(time * 20)) & 3) === 0 ? 1 : 0.08;
    }
  }
  return 1;
}

/** Index of a burnt-out letter (one street sign in twelve has one), or -1. It still blinks on now and then. */
function deadLetter(seed: number, len: number): number {
  if (seed >> 14 === 0 || len < 3) return -1;
  const h = hash2(seed, 0x51d);
  if (h % 12 !== 0) return -1;
  if ((hash2(seed, Math.floor(time * 9)) & 15) === 0) return -1;
  return (h >>> 8) % len;
}

/**
 * Horizontal sign in sign units (u, v are metres / scale). Three levels of detail by letter size:
 * a glowing bar, the real letter at each letter's centre cell, then a 3x5 block font up close.
 */
export function sign(i: number, u: number, v: number, z: number, r: number, g: number, b: number, seed: number): void {
  const ti = (seed & 255) % SIGN_TEXTS.length;
  const scale = SIGN_SCALES[(seed >> 11) & 7] ?? 1;
  const gls = SIGN_GLYPHS[ti];
  const on = signOn(seed);
  // Cells per letter as actually projected, which shrinks when the sign is seen from the side.
  const du = Math.abs(span.du);
  const cw = du > 1e-6 ? SIGN_CHAR_W / du : (SIGN_CHAR_W * scale * fxC) / z;
  if (cw < 1.1) {
    put(i, G_EQ, r * 0.8 * on, g * 0.8 * on, b * 0.8 * on, 0.35, z, 1);
    return;
  }
  const tu = (u - SIGN_PAD) / SIGN_CHAR_W;
  const k = Math.floor(tu);
  const vb = (SIGN_H - SIGN_BAND_PAD - v) / SIGN_BAND;
  const dim = 0.4 * on;
  if (k < 0 || k >= gls.length || vb < 0 || vb >= 1 || k === deadLetter(seed, gls.length)) {
    put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
    return;
  }
  const rowsPerBand = (SIGN_BAND * scale * fyC) / z;
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

/** Vertical blade sign: u spans the 1 m width, letters stack downward from the top in 0.9 m boxes. */
export function vsign(i: number, u: number, v: number, z: number, r: number, g: number, b: number, seed: number): void {
  const ti = (seed & 255) % SIGN_TEXTS.length;
  const gls = SIGN_GLYPHS[ti];
  const on = signOn(seed);
  const dim = 0.4 * on;
  const height = gls.length * VSIGN_CHAR_H + 2 * VSIGN_PAD;
  const rowsPerChar = (VSIGN_CHAR_H * fyC) / z;
  const colsPerChar = (fxC) / z;
  if (rowsPerChar < 1.1) {
    put(i, G_PIPE, r * 0.8 * on, g * 0.8 * on, b * 0.8 * on, 0.4, z, 1);
    return;
  }
  const tv = (height - VSIGN_PAD - v) / VSIGN_CHAR_H;
  const k = Math.floor(tv);
  if (k < 0 || k >= gls.length || u < 0.08 || u > 0.92 || k === deadLetter(seed, gls.length)) {
    put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
    return;
  }
  if (rowsPerChar >= 6 && colsPerChar >= 4) {
    const bx = Math.floor(((u - 0.08) / 0.84) * 3), by = Math.floor((tv - k) * 6);
    const lit = by < 5 && ((SIGN_BITS[ti][k] >> (14 - by * 3 - bx)) & 1) === 1;
    if (lit) put(i, G_FULL, r * on, g * on, b * on, 0.7, z, 1);
    else put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
    return;
  }
  const atCentreV = Math.abs(tv - k - 0.5) * rowsPerChar < 0.5;
  const atCentreU = colsPerChar < 1 || Math.abs(u - 0.5) * colsPerChar < 0.5;
  if (atCentreU && atCentreV) put(i, gls[k], r * on, g * on, b * on, 0.3, z, 1);
  else put(i, G_SPACE, r * dim, g * dim, b * dim, 0.45, z, 1);
}
