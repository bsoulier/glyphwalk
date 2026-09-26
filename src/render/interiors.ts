import { glyph } from '../core/charset';
import { hash2, hash3 } from '../core/hash';
import { fxC, fyC, put, time } from './surface';

/**
 * Indoor surfaces. They are always seen close up, so every cell is large and patterns can be sized in
 * real metres; each shader still falls back to a flat tone when its pattern would be under a cell.
 */

export const FLOOR_TILES = 0;
export const FLOOR_PARQUET = 1;
export const FLOOR_CARPET = 2;
export const FLOOR_TATAMI = 3;
export const FLOOR_CONCRETE = 4;
export const FLOOR_CHECKER = 5;

export const GOODS_MIXED = 0;
export const GOODS_BAKERY = 1;
export const GOODS_BOTTLES = 2;
export const GOODS_BOOKS = 3;

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PIPE = glyph('|');
const G_DASH = glyph('-');
const G_EQ = glyph('=');
const G_HASH = glyph('#');
const G_PLUS = glyph('+');
const G_US = glyph('_');
const G_o = glyph('o');
const G_MED = glyph('▒');
const G_DARK = glyph('▓');
const SCREEN_GLYPHS = [G_EQ, G_DASH, G_HASH, G_MED, G_SPACE, G_DOT];

const GOODS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[220, 60, 60], [60, 140, 220], [240, 200, 70], [90, 190, 110], [230, 230, 230], [200, 110, 200]],
  [[210, 150, 80], [180, 110, 50], [235, 190, 120], [160, 90, 45], [245, 225, 170]],
  [[90, 200, 110], [230, 170, 60], [200, 220, 235], [170, 60, 40], [120, 170, 230]],
  [[150, 40, 40], [40, 70, 130], [60, 110, 70], [190, 160, 110], [90, 60, 40], [30, 30, 36]],
];

/**
 * Painted wall; v is height above the storey's floor, so the skirting board sits on every floor.
 * A non-zero seed is a storey height in centimetres: the wall then repeats a floor slab band at that
 * interval, which is what makes a lift shaft visibly scroll past during a ride.
 */
export function plaster(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  const cpm = fyC / z;
  if (seed > 0) {
    const period = seed / 100;
    v -= Math.floor(v / period) * period;
    if (v > period - 0.3) {
      put(i, G_EQ, r * 0.35, g * 0.35, b * 0.35, 0.5, z, 0);
      return;
    }
  }
  if (v < 0.12 && cpm * 0.12 > 0.6) {
    put(i, G_US, r * 0.5, g * 0.5, b * 0.5, 0.45, z, 0);
    return;
  }
  const k = 0.78 + sh * 0.22;
  const speck = cpm > 6 && (hash2(Math.floor(u * 5), Math.floor(v * 5)) & 31) === 0;
  put(i, speck ? G_DOT : G_SPACE, r * k * 0.7, g * k * 0.7, b * k * 0.7, 0.62, z, 0);
}

export function floor(i: number, u: number, v: number, z: number, r: number, g: number, b: number, seed: number): void {
  const cpm = fxC / z;
  switch (seed & 7) {
    case FLOOR_TILES: {
      const fu = u / 0.8, fv = v / 0.8;
      const eu = (fu - Math.floor(fu)) * 0.8 * cpm < 1, ev = (fv - Math.floor(fv)) * 0.8 * cpm < 1;
      if (cpm > 4 && (eu || ev)) put(i, eu && ev ? G_PLUS : eu ? G_PIPE : G_DASH, r * 0.55, g * 0.55, b * 0.55, 0.5, z, 0);
      else {
        const q = 0.9 + (hash2(Math.floor(fu), Math.floor(fv)) & 15) / 100;
        put(i, G_SPACE, r * q, g * q, b * q, 0.62, z, 0);
      }
      return;
    }
    case FLOOR_PARQUET: {
      const plank = Math.floor(u / 0.2);
      const pv = (v + plank * 0.37) / 1.2;
      const seam = cpm > 5 && (pv - Math.floor(pv)) * 1.2 * cpm < 1;
      const q = 0.8 + (hash2(plank, Math.floor(pv)) & 31) / 130;
      if (seam) put(i, G_DASH, r * 0.5, g * 0.5, b * 0.5, 0.45, z, 0);
      else put(i, cpm > 5 && (u / 0.2 - plank) * 0.2 * cpm < 1 ? G_PIPE : G_EQ, r * q, g * q, b * q, 0.5, z, 0);
      return;
    }
    case FLOOR_CARPET: {
      const h = hash2(Math.floor(u * 6), Math.floor(v * 6));
      put(i, cpm > 6 && (h & 7) === 0 ? G_COLON : G_SPACE, r * 0.8, g * 0.8, b * 0.8, 0.6, z, 0);
      return;
    }
    case FLOOR_TATAMI: {
      const mu = u / 0.9, mv = v / 1.8;
      const border = cpm > 3 && ((mu - Math.floor(mu)) * 0.9 * cpm < 1 || (mv - Math.floor(mv)) * 1.8 * cpm < 1);
      if (border) put(i, G_HASH, 40, 60, 40, 0.5, z, 0);
      else put(i, cpm > 7 ? G_EQ : G_SPACE, r, g, b, 0.55, z, 0);
      return;
    }
    case FLOOR_CHECKER: {
      const light = ((Math.floor(u / 0.5) + Math.floor(v / 0.5)) & 1) === 0;
      const q = light ? 1 : 0.2;
      put(i, G_SPACE, r * q, g * q, b * q, 0.7, z, 0);
      return;
    }
    default: {
      const joint = cpm > 3 && ((u / 4 - Math.floor(u / 4)) * 4 * cpm < 1 || (v / 4 - Math.floor(v / 4)) * 4 * cpm < 1);
      put(i, joint ? G_DASH : G_COLON, r * 0.7, g * 0.7, b * 0.7, 0.45, z, 0);
    }
  }
}

/** Suspended ceiling: a 1.2 m grid where every other panel in both directions is a glowing light. */
export function ceiling(i: number, u: number, v: number, z: number, r: number, g: number, b: number): void {
  const cpm = fxC / z;
  const fu = u / 1.2, fv = v / 1.2;
  const cu = Math.floor(fu), cv = Math.floor(fv);
  if (cpm > 3 && ((fu - cu) * 1.2 * cpm < 1 || (fv - cv) * 1.2 * cpm < 1)) {
    put(i, G_PLUS, r * 0.3, g * 0.3, b * 0.3, 0.3, z, 0);
    return;
  }
  if (((cu | cv) & 1) === 0) put(i, G_MED, r, g, b, 0.75, z, 1);
  else put(i, G_SPACE, r * 0.45, g * 0.45, b * 0.45, 0.5, z, 0);
}

export function woodgrain(i: number, v: number, z: number, r: number, g: number, b: number, sh: number): void {
  const q = sh * (0.85 + (hash2(Math.floor(v * 9), 7) & 15) / 80);
  put(i, fyC / z > 12 ? G_EQ : G_DASH, r * q, g * q, b * q, 0.55, z, 0);
}

/** Rows of products, bottles or book spines: narrow vertical stripes, each a colour from the palette. */
export function goods(i: number, u: number, v: number, z: number, seed: number): void {
  const pal = GOODS[seed & 3];
  const w = (seed & 3) === GOODS_BOOKS ? 0.07 : 0.14;
  const s = Math.floor(u / w);
  const h = hash3(s, Math.floor(v / 0.4), seed);
  const c = pal[h % pal.length];
  const glow = (seed & 3) === GOODS_BOTTLES ? 1 : 0;
  if ((w * fxC) / z < 1) {
    put(i, G_COLON, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 0.5, z, glow);
    return;
  }
  const edge = (u / w - s) * w * (fxC / z) < 1;
  const gl = edge ? G_PIPE : (seed & 3) === GOODS_BOTTLES ? G_o : (seed & 3) === GOODS_BAKERY ? G_DARK : G_HASH;
  put(i, gl, c[0], c[1], c[2], 0.5, z, glow);
}

/** Monitors, TVs and arcade screens: scrolling rows of noise in the base colour. */
export function screen(i: number, u: number, v: number, z: number, r: number, g: number, b: number): void {
  const row = Math.floor(v * 14 - time * 2);
  const h = hash3(Math.floor(u * 10), row, Math.floor(time * 3));
  const gl = SCREEN_GLYPHS[h % SCREEN_GLYPHS.length];
  const q = 0.6 + (h & 63) / 160;
  put(i, gl, r * q, g * q, b * q, 0.55, z, 1);
}
