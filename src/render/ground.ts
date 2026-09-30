import { glyph } from '../core/charset';
import { hash2, hash3, valueNoise } from '../core/hash';
import {
  HOODS, H_DOCKS, H_DOWNTOWN, H_ESTATES, H_FARMLAND, H_JAPAN, H_MEDINA, H_OLDTOWN, H_PARIS, H_SEAFRONT, H_SUBURB,
  hoodAt, inCity, isBeach, roadEW, roadNS,
} from '../world/hoods';
import {
  CROP_CORN, CROP_HAY, CROP_PASTURE, CROP_PLOWED, CROP_SOY, FARM, FIELD_BLOCKS, ROWS_ALONG_X, farmAt, farmD, farmU, fieldAt,
} from '../world/fields';
import {
  HALF, KIND_CITY, KIND_PARK, KIND_PLAZA, LAMP_OFF, LAMP_SPACING, LOT_EDGE, P, ROAD_HALF, blockKind, hasPond, isLandmark,
} from '../world/layout';
import type { Camera } from './camera';
import { lampsOn, put, putRaw } from './surface';
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
const G_FULL = glyph('█');
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
/** Cell footprint in x and in z (metres): the width a line of constant x (or z) needs to cover a cell. */
let FPX = 0;
let FPZ = 0;

/** Debug views of the ground: 0 normal, 1 solid cells in their own colour, 2 solid cells coloured by zone. */
let debugView = 0;
let ZONE = 0;
const Z_ROAD = 0, Z_CENTRE = 1, Z_EDGE = 2, Z_STOP = 3, Z_ZEBRA = 4, Z_KERB = 5, Z_WALK = 6, Z_JOINT = 7, Z_LOT = 8;
const ZONE_COLORS: readonly (readonly [number, number, number])[] = [
  [40, 40, 46], [255, 200, 0], [255, 255, 255], [255, 0, 255], [0, 200, 255], [255, 40, 40], [110, 110, 150], [0, 255, 120], [60, 120, 60],
];

/** `flat` shows each ground cell as a solid block of its colour, `zones` as a solid block per kind of surface. */
export function setGroundDebug(view: 'flat' | 'zones' | null): void {
  debugView = view === 'flat' ? 1 : view === 'zones' ? 2 : 0;
}

/**
 * `fp` is the ground footprint of one cell in metres, for textures; `fpx`, `fpz` are its extent in x and z,
 * for lines, which must be widened to stay a cell wide but no more, or they swell with distance.
 * `vx`, `vy` are the cell's view ray offsets from the camera axis (right and up, per unit forward).
 */
export function groundCell(
  o: number, X: number, Z: number, t: number, fp: number, vx: number, vy: number, fpx: number, fpz: number,
): void {
  cellVx = vx; cellVy = vy;
  FPX = fpx; FPZ = fpz;
  const bi = Math.floor(X / P), bj = Math.floor(Z / P);
  const lx = X - bi * P, lz = Z - bj * P;
  const sx = lx < HALF ? lx : lx - P;
  const sz = lz < HALF ? lz : lz - P;
  const ax = sx < 0 ? -sx : sx, az = sz < 0 ? -sz : sz;
  const hood = hoodAt(bi, bj);
  BK = 0.2;
  SEA = false;
  let onX: boolean, onZ: boolean;
  if (hood === H_FARMLAND) {
    country(bi, bj, X, Z, ax, az, sx, sz, lx, lz, fp);
    onX = CX;
    onZ = CZ;
  } else {
    onX = ax < ROAD_HALF;
    onZ = az < ROAD_HALF;
    if (onX || onZ) {
      ZONE = Z_ROAD;
      road(hood, X, Z, onX, onZ, ax, az, sx, sz, lx, lz, fp);
    } else if (ax < LOT_EDGE || az < LOT_EDGE) {
      ZONE = Z_WALK;
      sidewalk(hood, X, Z, ax, az, fp);
    } else {
      ZONE = Z_LOT;
      lot(hood, bi, bj, X, Z, lx - HALF, lz - HALF, fp);
    }
  }
  if (debugView === 2) {
    const c = ZONE_COLORS[ZONE];
    putRaw(o, G_FULL, c[0], c[1], c[2], c[0], c[1], c[2]);
    return;
  }
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

  // No street lamps out in the country: only the farms' yard lights, and the fields dark between them.
  const l = lampsOn > 0 ? (hood === H_FARMLAND ? YARD : lampLight(ax, az, lx, lz)) * lampsOn : 0;
  if (l > 0) {
    const c = HOODS[hood].lamp;
    R += c[0] * 0.68 * l; G += c[1] * 0.6 * l; B += c[2] * 0.45 * l; BK += 0.3 * l;
  }
  if (rain && fp < 0.6 && (hash3(Math.floor(X * 1.5), Math.floor(Z * 1.5), tick) & 255) === 0) {
    GL = G_QUOTE; R = 150; G = 170; B = 200;
  }
  if (debugView === 1) put(o, G_FULL, R, G, B, 1, t, 0);
  else put(o, GL, R, G, B, BK, t, 0);
}

/**
 * Joint lines of width `w` repeating every 1 unit, seen with a cell footprint of `f` units. A joint is never
 * drawn thinner than a cell, which is what breaks thin lines into moire; callers stop drawing joints once they
 * would be only a few cells apart.
 */
function joint(u: number, w: number, f: number): boolean {
  return u - Math.floor(u) < (w > f ? w : f);
}

/** Width `w` of a painted line, or the cell footprint across it when that is larger. */
function wide(w: number, f: number): number {
  return w > f ? w : f;
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
      GL = jx < FPX / 4 + 0.02 ? lineGlyph(true) : jz < FPZ / 4 + 0.02 ? lineGlyph(false)
        : (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_DOT : G_SPACE;
    } else if (fp < 0.3) {
      const h = hash2(Math.floor(X * 3), Math.floor(Z * 3)) & 7;
      GL = h < 2 ? G_COLON : h < 5 ? G_DOT : G_SPACE;
    } else GL = fp < 1.4 ? G_COLON : G_DASH;
    if (onX !== onZ) markings(hood, onX, ax, az, sx, sz, lx, lz);
  }
  if (rain && fp < 2.5 && valueNoise(X * 0.18, Z * 0.18, 5) > 0.66) {
    R = 38; G = 58; B = 92; BK = 0.35;
    if (fp < 0.6 && ((Math.floor(X * 2 + time * 2) + Math.floor(Z * 3)) & 7) === 0) GL = G_TILDE;
  }
}

function markings(
  hood: number, onX: boolean, ax: number, az: number, sx: number, sz: number, lx: number, lz: number,
): void {
  const a = onX ? ax : az;
  const s = onX ? sx : sz;
  const along = onX ? lz : lx;
  const cross = onX ? az : ax;
  // Footprints across the road (for lines along it) and along the road (for lines across it).
  const fl = onX ? FPX : FPZ, fa = onX ? FPZ : FPX;
  // Stop line across the approach lane only (right-hand traffic arrives on the right of the centre line).
  const toward = onX ? sz : sx;
  const approach = onX ? s * toward < 0 : s * toward > 0;
  if (approach && Math.abs(cross - 10.05) < wide(0.25, fa * 0.5)) {
    GL = G_EQ; R = 200; G = 200; B = 196; BK = 0.3; ZONE = Z_STOP;
    return;
  }
  if (hood !== H_DOCKS && cross < ROAD_HALF + 3.6) {
    if (fl < 0.4) {
      if ((Math.floor((s + ROAD_HALF) / 0.9) & 1) === 0) {
        GL = G_EQ; R = 175; G = 175; B = 172; BK = 0.3; ZONE = Z_ZEBRA;
      }
    } else {
      GL = G_EQ; R = 115; G = 115; B = 115; ZONE = Z_ZEBRA;
    }
    return;
  }
  // Residential streets have no lane lines, only the stop lines and crossings above.
  if (hood === H_SUBURB || hood === H_ESTATES) return;
  const w = wide(0.12, fl * 0.5);
  const dashes = hood !== H_DOCKS && fa <= 1.2;
  if (hood !== H_JAPAN && a < w && (!dashes || (Math.floor(along / 3) & 1) === 0)) {
    GL = lineGlyph(onX); BK = 0.3; ZONE = Z_CENTRE;
    const k = hood !== H_DOCKS && !dashes ? 0.6 : 1;
    if (hood === H_PARIS) { R = 210 * k; G = 210 * k; B = 205 * k; }
    else { R = 210 * k; G = 170 * k; B = 60 * k; }
  } else if (fl < 0.28 && Math.abs(a - (ROAD_HALF - 0.4)) < w) {
    // The edge line stops where the strip of road between it and the kerb is under a cell wide, or the two
    // lines would keep merging and splitting apart down the street.
    GL = lineGlyph(onX); R = 150; G = 150; B = 150; BK = 0.25; ZONE = Z_EDGE;
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
  if (ax < ROAD_HALF + wide(0.3, FPX) || az < ROAD_HALF + wide(0.3, FPZ)) {
    GL = G_EQ;
    ZONE = Z_KERB;
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
  // Each family of joints fades on its own, once its lines would be only a few cells apart.
  const inv = 1 / tile, fu = FPX * inv, fv = FPZ * inv;
  const stagger = hood === H_OLDTOWN || hood === H_MEDINA;
  const du = fu < 0.16 && (!stagger || fv < 0.16), dv = fv < 0.16;
  if (du || dv) {
    const c = Z * inv;
    const a = X * inv + (stagger ? (Math.floor(c) & 1) * 0.5 : 0);
    const w = 0.05 * inv;
    const eu = du && joint(a, w, fu), ev = dv && joint(c, w, fv);
    GL = eu && ev ? G_PLUS : eu ? lineGlyph(true) : ev ? lineGlyph(false) : G_DOT;
    if (eu || ev) ZONE = Z_JOINT;
  } else GL = G_COLON;
}

/** Courtyards, parks and squares. `dx`, `dz` are offsets from the block centre. */
function lot(hood: number, bi: number, bj: number, X: number, Z: number, dx: number, dz: number, fp: number): void {
  if (hood === H_SEAFRONT && isBeach(bi, bj)) return beach(X, dz, fp);
  const kind = isLandmark(bi, bj) ? KIND_PLAZA : blockKind(bi, bj);
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
  if (hood === H_DOCKS) return yard(X, Z);
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

// ---- the farmland outside the city ----

/** Country road: two lanes (cars run at +-LANE) and a paved strip each side. */
const C_HALF = 4.4;
const F_SIZE = FIELD_BLOCKS * P;
/** Set by `country`: the cell is on a road along z (x constant) / along x, for the snow pass. */
let CX = false;
let CZ = false;
/** Set by `country`: light from a farm's yard light on the cell, 0 to 1. */
let YARD = 0;
const YARD_R2 = 15 * 15;

/**
 * Farmland: country roads along the section lines, gravel shoulders and a grass verge, then fields. The
 * street along the edge of the city is still a city street, paved like the district it borders.
 */
function country(
  bi: number, bj: number, X: number, Z: number, ax: number, az: number, sx: number, sz: number, lx: number, lz: number, fp: number,
): void {
  YARD = 0;
  const nx = lx < HALF ? bi : bi + 1, nz = lz < HALF ? bj : bj + 1;
  const ns = roadNS(nx, bj), ew = roadEW(nz, bi);
  const nsCity = ns && (inCity(nx - 1, bj) || inCity(nx, bj));
  const ewCity = ew && (inCity(bi, nz - 1) || inCity(bi, nz));
  const hx = nsCity ? ROAD_HALF : C_HALF, hz = ewCity ? ROAD_HALF : C_HALF;
  CX = ns && ax < hx;
  CZ = ew && az < hz;
  if (CX || CZ) {
    ZONE = Z_ROAD;
    if ((CX && nsCity) || (CZ && ewCity)) {
      const city = CX && nsCity ? hoodAt(inCity(nx - 1, bj) ? nx - 1 : nx, bj) : hoodAt(bi, inCity(bi, nz - 1) ? nz - 1 : nz);
      road(city, X, Z, CX, CZ, ax, az, sx, sz, lx, lz, fp);
    } else countryRoad(X, Z, ax, az, fp);
    return;
  }
  const farm = farmAt(bi, bj);
  let fu = 0, fd = 0;
  if (farm >= 0) {
    fu = farmU(farm, lx, lz);
    fd = farmD(farm, lx, lz);
    const du = fu - FARM.light[0], dd = fd - FARM.light[1], l2 = du * du + dd * dd;
    if (l2 < YARD_R2) YARD = (1 - l2 / YARD_R2) * (1 - l2 / YARD_R2);
    // The drive runs from the road over the shoulder and verge to the yard, grass growing between the ruts.
    const off = fu - FARM.driveU;
    if (off > -FARM.driveHalf && off < FARM.driveHalf && fd < FARM.yard[1] + 1) {
      ZONE = Z_WALK;
      if (off > -0.4 && off < 0.4 && fp < 0.6) grass(X, Z, fp);
      else gravel(X, Z, 136, 124, 104);
      return;
    }
  }
  const e = Math.min(ns ? ax - hx : 99, ew ? az - hz : 99);
  if (e < 1.2) {
    ZONE = Z_WALK;
    gravel(X, Z, 128, 118, 100);
    return;
  }
  ZONE = Z_LOT;
  if (e < 3.5) {
    grass(X, Z, fp);
    return;
  }
  if (farm >= 0) {
    farmyard(X, Z, fp, fu, fd);
    return;
  }
  const fx = X - Math.floor(X / F_SIZE) * F_SIZE, fz = Z - Math.floor(Z / F_SIZE) * F_SIZE;
  if (Math.min(fx, F_SIZE - fx, fz, F_SIZE - fz) < 1.6) {
    // A strip of rough grass between neighbouring fields.
    grass(X, Z, fp);
    R *= 0.8; G *= 0.85; B *= 0.8;
    return;
  }
  field(X, Z, fp, fieldAt(bi, bj));
}

function countryRoad(X: number, Z: number, ax: number, az: number, fp: number): void {
  R = 58; G = 58; B = 62; BK = 0.22;
  if (fp < 0.3) {
    const h = hash2(Math.floor(X * 3), Math.floor(Z * 3)) & 7;
    GL = h < 2 ? G_COLON : h < 5 ? G_DOT : G_SPACE;
  } else GL = fp < 1.4 ? G_COLON : G_DASH;
  if (CX === CZ) return;
  const a = CX ? ax : az, fl = CX ? FPX : FPZ;
  const w = wide(0.1, fl * 0.5);
  // A double yellow line down the middle and a white line along each edge.
  if (Math.abs(a - 0.15) < w) {
    GL = lineGlyph(CX); R = 225; G = 185; B = 55; BK = 0.3; ZONE = Z_CENTRE;
  } else if (fl < 0.3 && Math.abs(a - (C_HALF - 0.35)) < w) {
    GL = lineGlyph(CX); R = 190; G = 190; B = 185; BK = 0.25; ZONE = Z_EDGE;
  }
}

/**
 * Crop rows are lines across the field every `s` metres, drawn like paving joints: one glyph wide and
 * following their slope on screen until they would be only a few cells apart, then a flat tone.
 */
function rows(c: number, fc: number, s: number, w: number): boolean {
  const f = fc / s;
  if (f >= 0.35) return false;
  return joint(c / s, w / s, f);
}

function field(X: number, Z: number, fp: number, f: number): void {
  const alongX = (f & ROWS_ALONG_X) !== 0;
  const c = alongX ? Z : X, fc = alongX ? FPZ : FPX;
  const h = hash2(Math.floor(X * 2), Math.floor(Z * 2));
  const q = 0.9 + (h & 15) / 80;
  BK = 0.28;
  switch (f & 7) {
    case CROP_CORN:
    case CROP_SOY: {
      const soy = (f & 7) === CROP_SOY;
      if (fc / 0.76 >= 0.35) {
        GL = soy ? G_COMMA : GRASS[2];
        R = (soy ? 54 : 64) * q; G = (soy ? 96 : 114) * q; B = (soy ? 42 : 44) * q;
      } else if (rows(c, fc, 0.76, soy ? 0.4 : 0.3)) {
        GL = lineGlyph(!alongX);
        R = (soy ? 50 : 66) * q; G = (soy ? 100 : 132) * q; B = (soy ? 40 : 46) * q;
      } else {
        GL = G_DOT; R = 74 * q; G = 58 * q; B = 40 * q;
      }
      return;
    }
    case CROP_PLOWED:
      if (fc / 0.9 >= 0.35) {
        GL = G_TILDE; R = 96 * q; G = 72 * q; B = 50 * q;
      } else if (rows(c, fc, 0.9, 0.45)) {
        GL = lineGlyph(!alongX); R = 116 * q; G = 88 * q; B = 60 * q;
      } else {
        GL = G_SPACE; R = 70 * q; G = 52 * q; B = 36 * q; BK = 0.4;
      }
      return;
    case CROP_HAY:
      // Mown, with the hay raked into windrows.
      if (rows(c, fc, 5, 0.9)) {
        GL = lineGlyph(!alongX); R = 184 * q; G = 172 * q; B = 98 * q;
      } else {
        GL = fp < 0.6 ? GRASS[h & 3] : G_COMMA; R = 118 * q; G = 150 * q; B = 70 * q;
      }
      return;
    case CROP_PASTURE:
      GL = fp < 0.6 ? GRASS[h & 3] : G_COMMA;
      R = 56 * q; G = 122 * q; B = 52 * q;
      return;
    default: {
      // Wheat, rippling as the wind runs over it.
      const wave = 0.86 + 0.14 * Math.sin(X * 0.21 + Z * 0.13 + time * 1.6);
      GL = fp < 0.6 ? GRASS[(h >> 2) & 3] : G_COMMA;
      R = 208 * q * wave; G = 174 * q * wave; B = 92 * q * wave; BK = 0.32;
    }
  }
}

/** A farmstead's ground, in its frame: packed earth in the yard, a mown lawn on the house's side of the drive, rough grass beyond. */
function farmyard(X: number, Z: number, fp: number, u: number, d: number): void {
  const [u0, d0, u1, d1] = FARM.yard;
  if (u > u0 && u < u1 && d > d0 && d < d1) {
    const h = hash2(Math.floor(X * 2), Math.floor(Z * 2));
    const q = 0.86 + (h & 15) / 70;
    GL = fp < 0.5 && (h & 7) < 2 ? G_COMMA : G_DOT;
    R = 124 * q; G = 108 * q; B = 84 * q; BK = 0.34;
    return;
  }
  if (u < FARM.driveU) lawn(X, Z, fp, 1, false);
  else grass(X, Z, fp);
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
function yard(X: number, Z: number): void {
  R = 78; G = 78; B = 76; BK = 0.3;
  const gx = X / 6.4 - Math.floor(X / 6.4) < FPX / 6.4 + 0.015, gz = Z / 6.4 - Math.floor(Z / 6.4) < FPZ / 6.4 + 0.015;
  if (gx || gz) {
    GL = gx && gz ? G_PLUS : gx ? lineGlyph(true) : lineGlyph(false);
    R = 190; G = 160; B = 50;
  } else GL = (hash2(Math.floor(X * 2), Math.floor(Z * 2)) & 15) === 0 ? G_COLON : G_DOT;
}
