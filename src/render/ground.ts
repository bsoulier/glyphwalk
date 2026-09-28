import { glyph } from '../core/charset';
import { hash2, hash3, valueNoise } from '../core/hash';
import {
  HOODS, H_DOCKS, H_DOWNTOWN, H_ESTATES, H_JAPAN, H_MEDINA, H_OLDTOWN, H_PARIS, H_SEAFRONT, H_SUBURB, hoodAt, isBeach,
} from '../world/hoods';
import {
  HALF, KIND_CITY, KIND_PARK, KIND_PLAZA, LAMP_OFF, LAMP_SPACING, LOT_EDGE, P, ROAD_HALF, blockKind, hasPond,
} from '../world/layout';
import type { Camera } from './camera';
import { lampsOn, put } from './surface';
import { SNOW } from './weather';

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_DASH = glyph('-');
const G_PIPE = glyph('|');
const G_SLASH = glyph('/');
const G_BSLASH = glyph('\\');
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
let snow = false;

// Ground-plane parts of the camera basis (right, up, forward) and the current cell's view ray offsets, so lines
// on the ground can pick a glyph that follows their slope on screen.
let camFx = 1, camFy = 1;
let rXw = 1, rZw = 0, uXw = 0, uZw = 0, fXw = 0, fZw = 1;
let cellVx = 0, cellVy = 0;

export function beginGround(t: number, raining: boolean, snowing: boolean, cam: Camera): void {
  time = t;
  tick = Math.floor(t * 10);
  rain = raining;
  snow = snowing;
  camFx = cam.fx; camFy = cam.fy;
  rXw = cam.cY; rZw = -cam.sY;
  uXw = -cam.sY * cam.sP; uZw = -cam.cY * cam.sP;
  fXw = cam.sY * cam.cP; fZw = cam.cY * cam.cP;
}

/**
 * Glyph for a line on the ground running along world Z (or X), chosen by the line's slope in cells at the
 * current cell: a joint that crosses the screen horizontally must be drawn with `-`, one that recedes with `|`,
 * and anything in between with a slash, or the line breaks into staircases of the wrong stroke.
 */
function lineGlyph(alongZ: boolean): number {
  const wr = alongZ ? rZw : rXw, wu = alongZ ? uZw : uXw, wf = alongZ ? fZw : fXw;
  const dc = camFx * (wr - cellVx * wf);
  const dr = camFy * (cellVy * wf - wu);
  const ac = dc < 0 ? -dc : dc, ar = dr < 0 ? -dr : dr;
  if (ar > ac * 2) return G_PIPE;
  if (ac > ar * 2) return G_DASH;
  return (dc > 0) === (dr > 0) ? G_BSLASH : G_SLASH;
}

// Output of the per-neighbourhood painters, kept in module scope so nothing is allocated per cell.
let GL = 0;
let R = 0;
let G = 0;
let B = 0;
let BK = 0.2;
/** Open water, which snow does not settle on. */
let SEA = false;

/**
 * `fp` is the ground footprint of one cell in metres; details thinner than that are dropped or widened.
 * `vx`, `vy` are the cell's view ray offsets from the camera axis (right and up, per unit forward).
 */
export function groundCell(o: number, X: number, Z: number, t: number, fp: number, vx: number, vy: number): void {
  cellVx = vx; cellVy = vy;
  const bi = Math.floor(X / P), bj = Math.floor(Z / P);
  const lx = X - bi * P, lz = Z - bj * P;
  const sx = lx < HALF ? lx : lx - P;
  const sz = lz < HALF ? lz : lz - P;
  const ax = sx < 0 ? -sx : sx, az = sz < 0 ? -sz : sz;
  const hood = hoodAt(bi, bj);
  BK = 0.2;
  SEA = false;
  const onX = ax < ROAD_HALF, onZ = az < ROAD_HALF;
  if (onX || onZ) road(hood, X, Z, onX, onZ, ax, az, sx, sz, lx, lz, fp);
  else if (ax < LOT_EDGE || az < LOT_EDGE) sidewalk(hood, X, Z, ax, az, fp);
  else lot(hood, bi, bj, X, Z, lx - HALF, lz - HALF, fp);
  if (snow && !SEA) {
    // Roads are churned to grey slush with darker tyre tracks; everything else lies under snow.
    let k = 0.85;
    if (onX || onZ) {
      const lane = (onX ? ax : az) % 3.5;
      k = lane > 1.2 && lane < 2.3 ? 0.38 : 0.7;
    }
    R += (SNOW[0] - R) * k; G += (SNOW[1] - G) * k; B += (SNOW[2] - B) * k;
    // A bright cell background makes snow read as a solid surface rather than scattered glyphs.
    BK = BK + (0.62 - BK) * k;
  }

  const l = lampsOn > 0 ? lampLight(ax, az, lx, lz) * lampsOn : 0;
  if (l > 0) {
    const c = HOODS[hood].lamp;
    R += c[0] * 0.68 * l; G += c[1] * 0.6 * l; B += c[2] * 0.45 * l; BK += 0.3 * l;
  }
  if (rain && fp < 0.6 && (hash3(Math.floor(X * 1.5), Math.floor(Z * 1.5), tick) & 255) === 0) {
    GL = G_QUOTE; R = 150; G = 170; B = 200;
  }
  put(o, GL, R, G, B, BK, t, 0);
}

/**
 * Joint lines of width `w` repeating every 1 unit, seen with a cell footprint of `f` units. A joint is never
 * drawn thinner than a cell, which is what breaks thin lines into moire; callers stop drawing joints once they
 * would be only a few cells apart.
 */
function joint(u: number, w: number, f: number): boolean {
  return u - Math.floor(u) < (w > f ? w : f);
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
  else if (hood === H_MEDINA) cobbles(X, Z, fp, 150, 124, 92);
  else {
    if (hood === H_DOCKS) { R = 80; G = 78; B = 74; BK = 0.3; }
    else if (hood === H_PARIS) { R = 56; G = 58; B = 70; }
    else if (hood === H_JAPAN) { R = 62; G = 62; B = 68; }
    else if (hood === H_SUBURB) { R = 66; G = 66; B = 68; }
    else if (hood === H_ESTATES) { R = 42; G = 44; B = 48; }
    else { R = 50; G = 54; B = 62; }
    if (hood === H_DOCKS && fp < 0.3) {
      const jx = X / 4 - Math.floor(X / 4), jz = Z / 4 - Math.floor(Z / 4);
      const jw = fp / 4 + 0.02;
      GL = jx < jw ? lineGlyph(true) : jz < jw ? lineGlyph(false)
        : (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_DOT : G_SPACE;
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
  // Stop line across the approach lane only (right-hand traffic arrives on the right of the centre line).
  const toward = onX ? sz : sx;
  const approach = onX ? s * toward < 0 : s * toward > 0;
  const sw = fp * 0.5 > 0.25 ? fp * 0.5 : 0.25;
  if (approach && Math.abs(cross - 10.05) < sw) {
    GL = G_EQ; R = 200; G = 200; B = 196; BK = 0.3;
    return;
  }
  if (hood !== H_DOCKS && cross < ROAD_HALF + 3.6) {
    if (fp < 0.4) {
      if ((Math.floor((s + ROAD_HALF) / 0.9) & 1) === 0) {
        GL = G_EQ; R = 175; G = 175; B = 172; BK = 0.3;
      }
    } else {
      GL = G_EQ; R = 115; G = 115; B = 115;
    }
    return;
  }
  // Residential streets have no lane lines, only the stop lines and crossings above.
  if (hood === H_SUBURB || hood === H_ESTATES) return;
  const w = fp * 0.45 > 0.12 ? fp * 0.45 : 0.12;
  if (hood !== H_JAPAN && a < w && (hood === H_DOCKS || fp > 1.2 || (Math.floor(along / 3) & 1) === 0)) {
    GL = lineGlyph(onX); BK = 0.3;
    const k = hood !== H_DOCKS && fp > 1.2 ? 0.6 : 1;
    if (hood === H_PARIS) { R = 210 * k; G = 210 * k; B = 205 * k; }
    else { R = 210 * k; G = 170 * k; B = 60 * k; }
  } else if (Math.abs(a - (ROAD_HALF - 0.4)) < w) {
    GL = lineGlyph(onX); R = 150; G = 150; B = 150; BK = 0.25;
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
    case H_SUBURB: R = 150; G = 146; B = 138; tile = 1.5; break;
    case H_ESTATES: R = 150; G = 140; B = 122; tile = 0.9; break;
    case H_MEDINA: R = 172; G = 142; B = 104; tile = 0.8; break;
    default: R = 118; G = 118; B = 122; tile = 2;
  }
  const kerb = ROAD_HALF + (fp > 0.3 ? fp : 0.3);
  if (ax < kerb || az < kerb) {
    GL = G_EQ;
    if (hood === H_DOCKS) {
      if (fp > 0.3) { R = 125; G = 105; B = 42; return; }
      const yellow = (Math.floor((X + Z) / 0.7) & 1) === 0;
      R = yellow ? 210 : 40; G = yellow ? 170 : 40; B = yellow ? 40 : 44;
    } else {
      R += 34; G += 36; B += 38;
    }
    return;
  }
  const m = ax < az ? ax : az;
  // Grass verge between the kerb and the footpath, where the street trees and lamps stand.
  if ((hood === H_SUBURB && m < 7.7) || (hood === H_ESTATES && m < 8.8)) {
    lawn(X, Z, fp, hood === H_ESTATES ? 1.1 : 0.95, false);
    return;
  }
  if (hood === H_SEAFRONT) return promenade(X, Z, az < ax, fp);
  const inv = 1 / tile, f = fp * inv;
  if (f < 0.16) {
    const c = Z * inv;
    const a = X * inv + (hood === H_OLDTOWN || hood === H_MEDINA ? (Math.floor(c) & 1) * 0.5 : 0);
    const w = 0.05 * inv;
    const eu = joint(a, w, f), ev = joint(c, w, f);
    GL = eu && ev ? G_PLUS : eu ? lineGlyph(true) : ev ? lineGlyph(false) : G_DOT;
  } else GL = G_COLON;
}

/** Courtyards, parks and squares. `dx`, `dz` are offsets from the block centre. */
function lot(hood: number, bi: number, bj: number, X: number, Z: number, dx: number, dz: number, fp: number): void {
  if (hood === H_SEAFRONT && isBeach(bi, bj)) return beach(X, dz, fp);
  const kind = blockKind(bi, bj);
  if (kind === KIND_CITY) {
    switch (hood) {
      case H_OLDTOWN: grass(X, Z, fp); return;
      case H_JAPAN: gravel(X, Z, 118, 116, 108); return;
      case H_PARIS: gravel(X, Z, 130, 120, 100); return;
      case H_DOCKS: GL = G_DOT; R = 70; G = 70; B = 68; return;
      case H_SUBURB: lawn(X, Z, fp, 1, true); return;
      case H_ESTATES: lawn(X, Z, fp, 1.15, true); return;
      case H_SEAFRONT: sand(X, Z, fp, 1); return;
      case H_MEDINA: gravel(X, Z, 164, 132, 96); return;
      default: checker(X, Z, fp); return;
    }
  }
  if (hood === H_MEDINA && kind === KIND_PLAZA) return cobbles(X, Z, fp, 176, 146, 106);
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
    case H_SUBURB:
    case H_ESTATES:
      if (adx < 1.6 || adz < 1.6) { GL = G_DOT; R = 150; G = 140; B = 118; BK = 0.35; }
      else lawn(X, Z, fp, 1, false);
      return;
    case H_SEAFRONT:
      if (adx < 1.6 || adz < 1.6) promenade(X, Z, adx > adz, fp);
      else sand(X, Z, fp, 1);
      return;
    default:
      if (kind === KIND_PLAZA) checker(X, Z, fp);
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

/** Mown lawn: grass glyphs, with light and dark mowing stripes on private lawns until they merge. */
function lawn(X: number, Z: number, fp: number, k: number, stripes: boolean): void {
  const h = hash2(Math.floor(X * 2), Math.floor(Z * 2));
  GL = fp < 0.6 ? GRASS[h & 3] : G_COMMA;
  let q = k * (0.9 + ((h >> 4) & 15) / 90);
  if (stripes && fp < 0.8) q *= (Math.floor(X / 1.8) & 1) === 0 ? 1.12 : 0.9;
  R = 46 * q; G = 118 * q; B = 50 * q; BK = 0.3;
}

function sand(X: number, Z: number, fp: number, k: number): void {
  const h = hash2(Math.floor(X * 3), Math.floor(Z * 3));
  GL = fp < 0.5 && (h & 7) === 0 ? G_COMMA : G_DOT;
  const q = k * (0.94 + (h & 15) / 160);
  R = 214 * q; G = 190 * q; B = 142 * q; BK = 0.55;
}

/**
 * Seafront promenade in the black-and-white wave mosaic of a beach boulevard; the waves run along the
 * street. `alongX` is true for the sidewalks beside roads that run along x.
 */
function promenade(X: number, Z: number, alongX: boolean, fp: number): void {
  if (fp > 0.6) { GL = G_DOT; R = 140; G = 134; B = 128; BK = 0.45; return; }
  const a = alongX ? X : Z, c = alongX ? Z : X;
  const w = c * 0.9 + Math.sin(a * 0.75) * 0.9;
  const dark = (Math.floor(w) & 1) === 1;
  GL = dark ? G_COLON : G_DOT;
  if (dark) { R = 52; G = 50; B = 54; } else { R = 214; G = 208; B = 196; }
  BK = 0.5;
}

/** Beach blocks: dry sand, a wet band and foam where the swash runs up, then the sea deepening away from it. */
function beach(X: number, dz: number, fp: number): void {
  const shore = 1.5 + Math.sin(X * 0.07 + time * 0.55) * 0.7 + Math.sin(X * 0.19 - time * 0.3) * 0.3;
  const d = dz - shore;
  if (d < -1.4) return sand(X, dz, fp, 1);
  if (d < 0) {
    sand(X, dz, fp, 0.78);
    GL = G_DOT;
    return;
  }
  SEA = true;
  if (d < 0.8 && fp < 1.2) {
    GL = G_TILDE; R = 228; G = 236; B = 240; BK = 0.55;
    return;
  }
  const deep = d > 16 ? 1 : d / 16;
  R = 64 - 34 * deep; G = 176 - 94 * deep; B = 186 - 36 * deep; BK = 0.45;
  GL = fp > 0.6 || ((Math.floor(X * 1.1 + time * 1.2) + Math.floor(dz * 2)) & 3) === 0 ? G_TILDE : G_DASH;
}

function gravel(X: number, Z: number, r: number, g: number, b: number): void {
  const h = hash2(Math.floor(X * 3), Math.floor(Z * 3));
  GL = (h & 7) === 0 ? G_COMMA : G_DOT;
  R = r; G = g; B = b; BK = 0.3;
}

function checker(X: number, Z: number, fp: number): void {
  if (fp > 0.8) {
    GL = G_COLON; R = 94; G = 87; B = 105;
    return;
  }
  const chk = (Math.floor(X * 0.5) + Math.floor(Z * 0.5)) & 1;
  GL = chk ? G_PLUS : G_DOT;
  R = chk ? 104 : 84; G = chk ? 96 : 78; B = chk ? 116 : 94;
}

/** Raked gravel of a zen garden: parallel furrows, merged to a flat tone once they are sub-cell. */
function raked(Z: number, fp: number): void {
  R = 168; G = 165; B = 152; BK = 0.35;
  if (fp < 0.15) {
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
    GL = gx && gz ? G_PLUS : gx ? lineGlyph(true) : lineGlyph(false);
    R = 190; G = 160; B = 50;
  } else GL = (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_COLON : G_DOT;
}
