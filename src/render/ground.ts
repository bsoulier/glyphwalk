import { glyph } from '../core/charset';
import { hash2, hash3, valueNoise } from '../core/hash';
import { HOODS, H_DOCKS, H_DOWNTOWN, H_JAPAN, H_OLDTOWN, H_PARIS, hoodAt } from '../world/hoods';
import {
  HALF, KIND_CITY, KIND_PARK, KIND_PLAZA, LAMP_OFF, LAMP_SPACING, LOT_EDGE, P, ROAD_HALF, blockKind, hasPond,
} from '../world/layout';
import { put } from './surface';

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
const G_o = glyph('o');
const GRASS = [glyph(','), glyph("'"), glyph('"'), glyph('.')];

const LAMP_R2 = 8.5 * 8.5;

let time = 0;
let tick = 0;
let rain = false;
let nsVertical = false;

export function beginGround(t: number, raining: boolean, lookingAlongZ: boolean): void {
  time = t;
  tick = Math.floor(t * 10);
  rain = raining;
  nsVertical = lookingAlongZ;
}

// Output of the per-neighbourhood painters, kept in module scope so nothing is allocated per cell.
let GL = 0;
let R = 0;
let G = 0;
let B = 0;
let BK = 0.2;

/** `fp` is the ground footprint of one cell in metres; details thinner than that are dropped or widened. */
export function groundCell(o: number, X: number, Z: number, t: number, fp: number): void {
  const bi = Math.floor(X / P), bj = Math.floor(Z / P);
  const lx = X - bi * P, lz = Z - bj * P;
  const sx = lx < HALF ? lx : lx - P;
  const sz = lz < HALF ? lz : lz - P;
  const ax = sx < 0 ? -sx : sx, az = sz < 0 ? -sz : sz;
  const hood = hoodAt(bi, bj);
  BK = 0.2;
  const onX = ax < ROAD_HALF, onZ = az < ROAD_HALF;
  if (onX || onZ) road(hood, X, Z, onX, onZ, ax, az, sx, sz, lx, lz, fp);
  else if (ax < LOT_EDGE || az < LOT_EDGE) sidewalk(hood, X, Z, ax, az, fp);
  else lot(hood, bi, bj, X, Z, lx - HALF, lz - HALF, fp);

  const l = lampLight(ax, az, lx, lz);
  if (l > 0) {
    const c = HOODS[hood].lamp;
    R += c[0] * 0.68 * l; G += c[1] * 0.6 * l; B += c[2] * 0.45 * l; BK += 0.3 * l;
  }
  if (rain && fp < 0.6 && (hash3(Math.floor(X * 1.5), Math.floor(Z * 1.5), tick) & 255) === 0) {
    GL = G_QUOTE; R = 150; G = 170; B = 200;
  }
  put(o, GL, R, G, B, BK, t, 0);
}

function alongDist(a: number): number {
  if (a < LAMP_SPACING) return LAMP_SPACING - a;
  if (a > P - LAMP_SPACING) return a - (P - LAMP_SPACING);
  const m = a - LAMP_SPACING * Math.round(a / LAMP_SPACING);
  return m < 0 ? -m : m;
}

/** Light pools under the street lamps, computed from the lamp grid rather than a light list. */
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

function road(
  hood: number, X: number, Z: number, onX: boolean, onZ: boolean,
  ax: number, az: number, sx: number, sz: number, lx: number, lz: number, fp: number,
): void {
  if (hood === H_OLDTOWN) cobbles(X, Z, fp, 92, 84, 74);
  else {
    if (hood === H_DOCKS) { R = 80; G = 78; B = 74; BK = 0.3; }
    else if (hood === H_PARIS) { R = 56; G = 58; B = 70; }
    else if (hood === H_JAPAN) { R = 62; G = 62; B = 68; }
    else { R = 50; G = 54; B = 62; }
    if (hood === H_DOCKS && fp < 0.3) {
      const jx = X / 4 - Math.floor(X / 4), jz = Z / 4 - Math.floor(Z / 4);
      const jw = fp / 4 + 0.02;
      GL = jx < jw ? G_PIPE : jz < jw ? G_DASH : (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_DOT : G_SPACE;
    } else if (fp < 0.3) {
      const h = hash2(Math.floor(X * 3), Math.floor(Z * 3)) & 7;
      GL = h < 2 ? G_COLON : h < 5 ? G_DOT : G_SPACE;
    } else GL = fp < 1.4 ? G_COLON : G_DASH;
    if (onX !== onZ) markings(hood, onX, ax, az, sx, sz, lx, lz, fp);
  }
  if (rain && fp < 2.5 && valueNoise(X * 0.18, Z * 0.18, 5) > 0.66) {
    R = 38; G = 58; B = 92; BK = 0.35;
    if (fp < 0.6 && ((Math.floor(X * 2 + time * 2) + Math.floor(Z * 3)) & 7) === 0) GL = G_TILDE;
  }
}

function markings(
  hood: number, onX: boolean, ax: number, az: number, sx: number, sz: number, lx: number, lz: number, fp: number,
): void {
  const a = onX ? ax : az;
  const s = onX ? sx : sz;
  const along = onX ? lz : lx;
  const cross = onX ? az : ax;
  if (hood !== H_DOCKS && cross < ROAD_HALF + 3.6) {
    if (fp < 0.9) {
      if ((Math.floor((s + ROAD_HALF) / 0.9) & 1) === 0) {
        GL = G_EQ; R = 175; G = 175; B = 172; BK = 0.3;
      }
    } else {
      GL = G_EQ; R = 115; G = 115; B = 115;
    }
    return;
  }
  const w = fp * 0.45 > 0.12 ? fp * 0.45 : 0.12;
  const gl = onX === nsVertical ? G_PIPE : G_DASH;
  if (hood !== H_JAPAN && a < w && (hood === H_DOCKS || (Math.floor(along / 3) & 1) === 0)) {
    GL = gl; BK = 0.3;
    if (hood === H_PARIS) { R = 210; G = 210; B = 205; }
    else { R = 210; G = 170; B = 60; }
  } else if (Math.abs(a - (ROAD_HALF - 0.4)) < w) {
    GL = gl; R = 150; G = 150; B = 150; BK = 0.25;
  }
}

/** Setts in staggered rows; each stone gets an `o` at its centre and its own tint when close enough. */
function cobbles(X: number, Z: number, fp: number, r: number, g: number, b: number): void {
  BK = 0.28;
  if (fp < 0.14) {
    const row = Math.floor(Z / 0.42);
    const cu = X / 0.46 + (row & 1) * 0.5;
    const col = Math.floor(cu);
    const fu = cu - col, fv = Z / 0.42 - row;
    const q = 0.82 + (hash2(col, row) & 31) / 100;
    R = r * q; G = g * q; B = b * q;
    GL = fu > 0.2 && fu < 0.8 && fv > 0.2 && fv < 0.8 ? G_o : G_DOT;
  } else {
    R = r; G = g; B = b;
    GL = fp < 0.7 ? G_COLON : G_DASH;
  }
}

function sidewalk(hood: number, X: number, Z: number, ax: number, az: number, fp: number): void {
  let tile: number;
  switch (hood) {
    case H_JAPAN: R = 116; G = 86; B = 74; tile = 0.6; break;
    case H_OLDTOWN: R = 104; G = 96; B = 86; tile = 0.9; break;
    case H_PARIS: R = 140; G = 130; B = 110; tile = 1.2; break;
    case H_DOCKS: R = 88; G = 88; B = 86; tile = 3; break;
    default: R = 118; G = 118; B = 122; tile = 2;
  }
  if (ax < ROAD_HALF + 0.3 || az < ROAD_HALF + 0.3) {
    GL = G_EQ;
    if (hood === H_DOCKS) {
      const yellow = (Math.floor((X + Z) / 0.7) & 1) === 0;
      R = yellow ? 210 : 40; G = yellow ? 170 : 40; B = yellow ? 40 : 44;
    } else {
      R += 34; G += 36; B += 38;
    }
    return;
  }
  if (fp < tile * 0.2) {
    const inv = 1 / tile;
    const c = Z * inv;
    const a = X * inv + (hood === H_OLDTOWN ? (Math.floor(c) & 1) * 0.5 : 0);
    const eu = a - Math.floor(a) < 0.1, ev = c - Math.floor(c) < 0.1;
    GL = eu && ev ? G_PLUS : eu ? G_PIPE : ev ? G_DASH : G_DOT;
  } else GL = G_COLON;
}

/** Courtyards, parks and squares. `dx`, `dz` are offsets from the block centre. */
function lot(hood: number, bi: number, bj: number, X: number, Z: number, dx: number, dz: number, fp: number): void {
  const kind = blockKind(bi, bj);
  if (kind === KIND_CITY) {
    switch (hood) {
      case H_OLDTOWN: grass(X, Z, fp); return;
      case H_JAPAN: gravel(X, Z, 118, 116, 108); return;
      case H_PARIS: gravel(X, Z, 130, 120, 100); return;
      case H_DOCKS: GL = G_DOT; R = 70; G = 70; B = 68; return;
      default: checker(X, Z); return;
    }
  }
  if (hood === H_DOCKS) return yard(X, Z, fp);
  const pond = kind === KIND_PARK && (hood === H_DOWNTOWN || hood === H_JAPAN) && hasPond(bi, bj);
  if (pond && dx * dx + dz * dz < 81) {
    R = 30; G = 62; B = 120; BK = 0.4;
    GL = fp > 0.6 || ((Math.floor(X * 1.2 + time * 1.5) + Math.floor(Z * 2.2)) & 3) === 0 ? G_TILDE : G_DASH;
    return;
  }
  const adx = Math.abs(dx), adz = Math.abs(dz);
  switch (hood) {
    case H_JAPAN:
      if (kind === KIND_PARK && (adx < 1.2 || adz < 1.2)) { GL = G_DOT; R = 132; G = 130; B = 122; BK = 0.35; }
      else raked(Z, fp);
      return;
    case H_OLDTOWN:
      if (kind === KIND_PLAZA || adx < 1.8 || adz < 1.8) cobbles(X, Z, fp, 100, 92, 80);
      else grass(X, Z, fp);
      return;
    case H_PARIS:
      if (adx > 7 && adx < 15 && adz > 7 && adz < 15) grass(X, Z, fp);
      else gravel(X, Z, 152, 140, 112);
      return;
    default:
      if (kind === KIND_PLAZA) checker(X, Z);
      else if (adx < 1.6 || adz < 1.6) { GL = G_DOT; R = 120; G = 108; B = 84; }
      else grass(X, Z, fp);
  }
}

function grass(X: number, Z: number, fp: number): void {
  const h = hash2(Math.floor(X * 2), Math.floor(Z * 2));
  GL = fp < 0.6 ? GRASS[h & 3] : G_COMMA;
  const q = 0.8 + ((h >> 4) & 15) / 60;
  R = 40 * q; G = 96 * q; B = 48 * q;
}

function gravel(X: number, Z: number, r: number, g: number, b: number): void {
  const h = hash2(Math.floor(X * 3), Math.floor(Z * 3));
  GL = (h & 7) === 0 ? G_COMMA : G_DOT;
  R = r; G = g; B = b; BK = 0.3;
}

function checker(X: number, Z: number): void {
  const chk = (Math.floor(X * 0.5) + Math.floor(Z * 0.5)) & 1;
  GL = chk ? G_PLUS : G_DOT;
  R = chk ? 104 : 84; G = chk ? 96 : 78; B = chk ? 116 : 94;
}

/** Raked gravel of a zen garden: parallel furrows, merged to a flat tone once they are sub-cell. */
function raked(Z: number, fp: number): void {
  R = 168; G = 165; B = 152; BK = 0.35;
  if (fp < 0.25) {
    const f = Z / 0.35 - Math.floor(Z / 0.35);
    GL = f < 0.5 ? G_TILDE : G_SPACE;
  } else GL = G_DASH;
}

/** Container yard concrete with a yellow painted bay grid. */
function yard(X: number, Z: number, fp: number): void {
  R = 78; G = 78; B = 76; BK = 0.3;
  const w = fp / 6.4 + 0.015;
  const gx = X / 6.4 - Math.floor(X / 6.4) < w, gz = Z / 6.4 - Math.floor(Z / 6.4) < w;
  if (gx || gz) {
    GL = gx && gz ? G_PLUS : gx ? G_PIPE : G_DASH;
    R = 190; G = 160; B = 50;
  } else GL = (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_COLON : G_DOT;
}
