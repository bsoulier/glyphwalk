import { glyph } from '../core/charset';
import { hash3 } from '../core/hash';
import { awning, corrugated, mansard, sign, tiles, vsign, wall } from './facades';
import { ceiling, floor, goods, plaster, screen, woodgrain } from './interiors';
import { beginSurface, fxC, lampsOn, put, time } from './surface';

export { put, putRaw } from './surface';
export const beginMaterials = beginSurface;

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
export const M_TILES = 16;
export const M_MANSARD = 17;
export const M_AWNING = 18;
export const M_VSIGN = 19;
export const M_CORRUGATED = 20;
export const M_PAINT = 21;
export const M_WATER = 22;
export const M_PLASTER = 23;
export const M_FLOOR = 24;
export const M_CEILING = 25;
export const M_WOOD = 26;
export const M_GOODS = 27;
export const M_SCREEN = 28;
/** Neon tube in its base colour: lit at night along with the street lamps, a pale unlit tube by day. */
export const M_NEON = 29;
export const M_PICKET = 30;
/** Swimming pool: turquoise, rippling, and glowing from underwater lamps at night. */
export const M_POOL = 31;

const G_SPACE = 0;
const G_CARET = glyph('^');
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PIPE = glyph('|');
const G_EQ = glyph('=');
const G_HASH = glyph('#');
const G_PLUS = glyph('+');
const G_O = glyph('O');
const G_o = glyph('o');
const G_SLASH = glyph('/');
const G_TILDE = glyph('~');
const G_DASH = glyph('-');
const G_QMARK = glyph('?');
const G_FULL = glyph('█');
const G_DARK = glyph('▓');
const LEAF_GLYPHS = [glyph('&'), glyph('%'), glyph('*'), glyph('#')];

export function shade(
  i: number, mat: number, u: number, v: number, z: number,
  r: number, g: number, b: number, sh: number, seed: number,
): void {
  switch (mat) {
    case M_WALL: wall(i, u, v, z, r, g, b, sh, seed); break;
    case M_ROOF: roof(i, u, v, z, r, g, b, sh); break;
    case M_SIGN: sign(i, u, v, z, r, g, b, seed); break;
    case M_VSIGN: vsign(i, u, v, z, r, g, b, seed); break;
    case M_TILES: tiles(i, v, z, r, g, b, sh); break;
    case M_MANSARD: mansard(i, u, v, z, r, g, b, sh, seed); break;
    case M_AWNING: awning(i, u, z, seed); break;
    case M_CORRUGATED: corrugated(i, z, r, g, b, sh); break;
    case M_CAR: put(i, G_EQ, r * sh, g * sh, b * sh, 0.5, z, 0); break;
    case M_GLASS: put(i, G_SLASH, 110 * sh, 160 * sh, 190 * sh, 0.3, z, 0); break;
    case M_WHEEL: put(i, G_O, 72, 72, 78, 0.25, z, 0); break;
    case M_SKIN: put(i, G_o, r * sh, g * sh, b * sh, 0.35, z, 0); break;
    case M_CLOTH: put(i, G_HASH, r * sh, g * sh, b * sh, 0.4, z, 0); break;
    case M_PAINT: put(i, G_HASH, r * sh, g * sh, b * sh, 0.5, z, 0); break;
    case M_LAMP: put(i, G_DARK, r, g, b, 0.55, z, 1); break;
    case M_LEAF: leaf(i, u, v, z, r, g, b, sh, seed); break;
    case M_TRUNK: put(i, G_PIPE, r * sh, g * sh, b * sh, 0.3, z, 0); break;
    case M_RAIL: put(i, G_EQ, r * sh, g * sh, b * sh, 0.3, z, 0); break;
    case M_TRAIN: train(i, u, v, z, r, g, b, sh, seed); break;
    case M_CONCRETE: put(i, G_COLON, r * sh, g * sh, b * sh, 0.28, z, 0); break;
    case M_GLOW: put(i, G_FULL, r, g, b, 0.6, z, 1); break;
    case M_WATER: water(i, u, v, z); break;
    case M_PLASTER: plaster(i, u, v, z, r, g, b, sh, seed); break;
    case M_FLOOR: floor(i, u, v, z, r, g, b, seed); break;
    case M_CEILING: ceiling(i, u, v, z, r, g, b); break;
    case M_WOOD: woodgrain(i, v, z, r, g, b, sh); break;
    case M_GOODS: goods(i, u, v, z, seed); break;
    case M_SCREEN: screen(i, u, v, z, r, g, b); break;
    case M_NEON:
      if (lampsOn > 0.3) put(i, G_FULL, r, g, b, 0.7, z, 1);
      else put(i, G_EQ, (r * 0.4 + 120) * sh, (g * 0.4 + 120) * sh, (b * 0.4 + 120) * sh, 0.45, z, 0);
      break;
    case M_PICKET: picket(i, v, z, r, g, b, sh); break;
    case M_POOL: pool(i, u, v, z); break;
    default: put(i, G_QMARK, 255, 0, 255, 0.5, z, 0);
  }
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

/** Car sides: a band of lit windows, with the heads and shoulders of passengers (chosen by `seed`) in some. */
function train(i: number, u: number, v: number, z: number, r: number, g: number, b: number, sh: number, seed: number): void {
  if (v > 1.1 && v < 2.1) {
    const wu = u / 1.6, w = Math.floor(wu);
    const lu = wu - w;
    if ((1.6 * fxC) / z < 1.5) put(i, G_EQ, 220, 190, 130, 0.35, z, 1);
    else if (lu > 0.15 && lu < 0.85) {
      const aboard = seed > 0 && (hash3(w, seed, 0x7ea1) & 3) === 0 && lu > 0.32 && lu < 0.68 && v < 1.9;
      if (aboard) put(i, v > 1.58 ? G_o : G_DARK, 70, 52, 44, 0.55, z, 0);
      else put(i, G_DARK, 255, 215, 150, 0.4, z, 1);
    } else put(i, G_PIPE, r * sh, g * sh, b * sh, 0.35, z, 0);
    return;
  }
  put(i, G_EQ, r * sh, g * sh, b * sh, 0.35, z, 0);
}

/** Pointed pickets of a garden fence; `v` is height above the ground, so the points sit on top. */
function picket(i: number, v: number, z: number, r: number, g: number, b: number, sh: number): void {
  const near = fxC / z > 4;
  put(i, near ? (v > 0.86 ? G_CARET : G_PIPE) : G_EQ, r * sh, g * sh, b * sh, near ? 0.3 : 0.5, z, 0);
}

function pool(i: number, u: number, v: number, z: number): void {
  const ripple = ((Math.floor(u * 1.7 + time * 0.9) + Math.floor(v * 2.1 - time * 0.6)) & 3) === 0;
  const glow = lampsOn;
  put(i, fxC / z > 3 && !ripple ? G_DASH : G_TILDE, 70 + 40 * glow, 190 + 40 * glow, 215 + 30 * glow, 0.6, z, glow > 0.3 ? 1 : 0);
}

function water(i: number, u: number, v: number, z: number): void {
  const ripple = ((Math.floor(u * 1.4 + time * 1.5) + Math.floor(v * 2.2)) & 3) === 0;
  put(i, fxC / z > 3 && !ripple ? G_DASH : G_TILDE, 40, 80, 140, 0.45, z, 0);
}
