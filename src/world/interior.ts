import type { Camera } from '../render/camera';
import { drawBoxYaw, drawFace, drawPoint, sphereVisible } from '../render/raster';
import { FLOOR_H, facadeWindows } from '../render/facades';
import { FLOOR_CARPET } from '../render/interiors';
import { M_CEILING, M_FLOOR, M_GLOW, M_PAINT, M_PLASTER, M_SIGN } from '../render/materials';
import { glyph } from '../core/charset';
import { hash2, mulberry32 } from '../core/hash';
import { type Builder, type Rect, type Side, LIGHT_LAMP, sideOf } from './build';
import { BOX_E, BOX_N, BOX_S, BOX_W, FACE_STRIDE, FaceList } from './faces';
import { type Program, Room } from './furniture';
import { EYE_H } from './layout';
import { SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS, TEXT_LIFT, TEXT_OPEN, signSeed, type RGB } from './signs';

/** Wall thickness between the facade and the inner wall surface. */
export const WALL_T = 0.2;
/** Door openings are sized for a person with a 1.7 m eye height, not for the storey. */
export const DOOR_H = 2.4;
const SLAB = 0.25;
const LIFT_HALF = 1.0;
const LIFT_DEPTH = 2.0;
const LIFT_WALL = 0.15;
const LIFT_OPEN = 0.6;
const LIFT_OPEN_H = 2.3;
/** Cab floor to cab ceiling; the cab doors cover all of it so no opening shows while moving. */
const CAB_H = 2.45;
/** From this close the lobby is drawn behind the door; further away a lit panel stands in for it. */
const LOOK_IN = 32;

export interface Level {
  y: number;
  /** Clear height from floor to ceiling. */
  h: number;
  /** Storey number on the facade (0 = ground). */
  k: number;
  name: string;
  faces: Float32Array;
  lights: Float32Array;
}

export interface Door {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  w: number;
}

export interface Interior {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  top: number;
  label: string;
  levels: Level[];
  shaft: Float32Array;
  /** Floor of the lift cab; null for single-storey shops. */
  lift: Rect | null;
  /** Cab doors across the shaft opening, on the cab side, facing into the room. */
  liftDoor: Door | null;
  plug: Float32Array;
  door: Door;
}

export interface EnterSpec {
  rect: Rect;
  /** Street side with the door (Lot side numbering). */
  side: number;
  h: number;
  mat: number;
  color: RGB;
  seed: number;
  capMat: number;
  mask: number;
  doorW: number;
  label: string;
  /** Text over the door for buildings without a shop sign of their own; -1 for none. */
  sign: number;
  /** Small glowing OPEN plate beside a shop door. */
  open: boolean;
  canopy: boolean;
  /** Ground, middle and top floor; null skips that level. */
  programs: readonly [Program, Program | null, Program | null];
  /** The shop's sign text, reused on its menu board. */
  text: number;
}

type Hole = [number, number, number, number];

/** Vertical quad between two ground points with the given horizontal normal; endpoints in any order. */
function vquad(
  L: FaceList, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number,
  nx: number, nz: number, vBase: number, mat: number, c: RGB, seed: number,
): void {
  // FaceList.wall puts the normal at up x (p1 - p0), which is (-nz, nx) rotated back to n.
  if ((x1 - x0) * -nz + (z1 - z0) * nx < 0) L.wall(x1, z1, x0, z0, y0, y1, vBase, mat, c[0], c[1], c[2], seed);
  else L.wall(x0, z0, x1, z1, y0, y1, vBase, mat, c[0], c[1], c[2], seed);
}

function hquad(L: FaceList, r: Rect, y: number, up: boolean, mat: number, c: RGB, seed: number): void {
  const { x0, z0, x1, z1 } = r;
  if (up) L.poly(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, x0, z0, x1, z0, x1, z1, x0, z1, mat, c[0], c[1], c[2], seed);
  else L.poly(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, x0, z1, x1, z1, x1, z0, x0, z0, mat, c[0], c[1], c[2], seed);
}

/** `r` with the rectangle `h` cut out, as up to four rectangles. */
function minus(r: Rect, h: Rect | null): Rect[] {
  if (!h || h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) return [r];
  const out: Rect[] = [];
  if (h.z0 > r.z0) out.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: h.z0 });
  if (h.z1 < r.z1) out.push({ x0: r.x0, z0: h.z1, x1: r.x1, z1: r.z1 });
  const za = Math.max(r.z0, h.z0), zb = Math.min(r.z1, h.z1);
  if (h.x0 > r.x0) out.push({ x0: r.x0, z0: za, x1: h.x0, z1: zb });
  if (h.x1 < r.x1) out.push({ x0: h.x1, z0: za, x1: r.x1, z1: zb });
  return out;
}

/**
 * Split the wall rectangle [u0,u1] x [y0,y1] around its holes into solid rectangles. Columns with the
 * same vertical profile are merged, so a row of windows costs one sill strip, one lintel strip and a pier each.
 */
function holedWall(emit: (ua: number, ub: number, ya: number, yb: number) => void, u0: number, u1: number, y0: number, y1: number, holes: Hole[]): void {
  const hs: Hole[] = [];
  for (const h of holes) {
    const a = Math.max(u0, h[0]), b = Math.min(u1, h[1]), c = Math.max(y0, h[2]), d = Math.min(y1, h[3]);
    if (b - a > 1e-3 && d - c > 1e-3) hs.push([a, b, c, d]);
  }
  const xs = [u0, u1];
  for (const h of hs) xs.push(h[0], h[1]);
  xs.sort((p, q) => p - q);
  let runStart = u0, runKey = '', run: number[] = [];
  const flush = (end: number) => {
    for (let k = 0; k < run.length; k += 2) emit(runStart, end, run[k], run[k + 1]);
  };
  for (let k = 0; k < xs.length - 1; k++) {
    const xa = xs[k], xb = xs[k + 1];
    if (xb - xa < 1e-4) continue;
    const mid = (xa + xb) / 2;
    const cover = hs.filter((h) => h[0] <= mid && mid <= h[1]).map((h) => [h[2], h[3]]).sort((p, q) => p[0] - q[0]);
    const solid: number[] = [];
    let y = y0;
    for (const [a, b] of cover) {
      if (a > y) solid.push(y, a);
      y = Math.max(y, b);
    }
    if (y < y1) solid.push(y, y1);
    const key = solid.map((v) => v.toFixed(3)).join(',');
    if (key !== runKey) {
      flush(xa);
      runStart = xa;
      runKey = key;
      run = solid;
    }
  }
  flush(u1);
}

/** Axis-aligned box given in side coordinates: u along the facade, o outward from it. */
function sideBox(L: FaceList, s: Side, ua: number, ub: number, oa: number, ob: number, y0: number, y1: number, mat: number, c: RGB, seed = 0): void {
  const xa = s.p0x + s.tx * ua + s.nx * oa, za = s.p0z + s.tz * ua + s.nz * oa;
  const xb = s.p0x + s.tx * ub + s.nx * ob, zb = s.p0z + s.tz * ub + s.nz * ob;
  L.box(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), mat, c[0], c[1], c[2], seed);
}

function signFace(L: FaceList, s: Side, uc: number, y0: number, out: number, text: number, scale: number, c: RGB): number {
  const wu = SIGN_TEXTS[text].length * SIGN_CHAR_W + 2 * SIGN_PAD;
  const w = wu * scale, h = SIGN_H * scale;
  const ax = s.p0x + s.tx * (uc - w / 2) + s.nx * out, az = s.p0z + s.tz * (uc - w / 2) + s.nz * out;
  const bx = ax + s.tx * w, bz = az + s.tz * w;
  L.poly(ax, y0, az, bx, y0, bz, bx, y0 + h, bz, ax, y0 + h, az, 0, 0, wu, 0, wu, SIGN_H, 0, SIGN_H, M_SIGN, c[0], c[1], c[2], signSeed(text, 1, scale));
  return w;
}

const GLOW: RGB = [255, 226, 170];
const LIFT_STEEL: RGB = [150, 154, 160];

/**
 * A building you can walk into. Replaces the plain box and footprint collider: the street facade gets
 * a person-sized door, the inside gets three storeys (ground, middle, top) whose floors sit exactly on
 * the facade's storey lines and whose walls open where the facade draws windows.
 */
export function enterable(B: Builder, spec: EnterSpec): void {
  const { rect: r, side, h } = spec;
  const s = sideOf(r, side);
  const fw = facadeWindows(spec.seed);
  // Storeys follow the facade the building wears, which is what you see when you look out.
  const fh = FLOOR_H[(spec.seed >> 18) & 7];
  const floors = Math.floor((h + 0.01) / fh);
  const depth = side === 0 || side === 2 ? r.z1 - r.z0 : r.x1 - r.x0;
  const doorW = Math.min(spec.doorW, s.len - 1.4);

  // Centre the door on a facade bay near the middle; on warehouses, between two roller doors.
  let uc = fw.ground === null ? Math.max(1, Math.round(s.len / 16)) * 8 : (Math.floor(s.len / fw.colW / 2) + 0.5) * fw.colW;
  const edge = WALL_T + LIFT_HALF + LIFT_WALL + 0.2;
  uc = s.len > 2 * edge ? Math.min(s.len - edge, Math.max(edge, uc)) : s.len / 2;
  const t0 = uc - doorW / 2, t1 = uc + doorW / 2;

  // --- shell: the usual box minus the front wall, which is rebuilt around the door ---
  const bits = [BOX_S, BOX_E, BOX_N, BOX_W];
  const [cr, cg, cb] = spec.color;
  B.faces.box(r.x0, 0, r.z0, r.x1, h, r.z1, spec.mat, cr, cg, cb, spec.seed, spec.capMat, spec.mask & ~bits[side]);
  const front = (ua: number, ub: number, ya: number, yb: number) => {
    if (ub - ua < 1e-3 || yb - ya < 1e-3) return;
    const ax = s.p0x + s.tx * ua, az = s.p0z + s.tz * ua, bx = s.p0x + s.tx * ub, bz = s.p0z + s.tz * ub;
    B.faces.poly(ax, ya, az, bx, ya, bz, bx, yb, bz, ax, yb, az, ua, ya, ub, ya, ub, yb, ua, yb, spec.mat, cr, cg, cb, spec.seed);
  };
  front(0, t0, 0, h);
  front(t1, s.len, 0, h);
  front(t0, t1, DOOR_H, h);
  // Reveals, so the opening reads as a hole through a thick wall.
  const ix = -s.nx * WALL_T, iz = -s.nz * WALL_T;
  const px = (u: number) => s.p0x + s.tx * u, pz = (u: number) => s.p0z + s.tz * u;
  const rev: RGB = [cr * 0.7, cg * 0.7, cb * 0.7];
  vquad(B.faces, px(t0), pz(t0), px(t0) + ix, pz(t0) + iz, 0, DOOR_H, s.tx, s.tz, 0, M_PAINT, rev, 0);
  vquad(B.faces, px(t1), pz(t1), px(t1) + ix, pz(t1) + iz, 0, DOOR_H, -s.tx, -s.tz, 0, M_PAINT, rev, 0);
  {
    const ax = px(t0), az = pz(t0), bx = px(t1), bz = pz(t1);
    B.faces.poly(ax + ix, DOOR_H, az + iz, bx + ix, DOOR_H, bz + iz, bx, DOOR_H, bz, ax, DOOR_H, az, 0, 0, doorW, 0, doorW, WALL_T, 0, WALL_T, M_PAINT, rev[0], rev[1], rev[2], 0);
  }

  // --- the visible cue: glowing door frame, canopy, light, and a name plate or OPEN sign ---
  sideBox(B.faces, s, t0 - 0.12, t0, 0, 0.06, 0, DOOR_H + 0.12, M_GLOW, GLOW);
  sideBox(B.faces, s, t1, t1 + 0.12, 0, 0.06, 0, DOOR_H + 0.12, M_GLOW, GLOW);
  sideBox(B.faces, s, t0 - 0.12, t1 + 0.12, 0, 0.06, DOOR_H, DOOR_H + 0.12, M_GLOW, GLOW);
  if (spec.canopy) sideBox(B.props, s, t0 - 0.5, t1 + 0.5, 0, 1.1, DOOR_H + 0.3, DOOR_H + 0.42, M_PAINT, [40, 40, 46]);
  B.lights.push(px(uc) + s.nx * 0.7, DOOR_H + 0.25, pz(uc) + s.nz * 0.7, 255, 220, 160, LIGHT_LAMP);
  if (spec.sign >= 0) signFace(B.props, s, uc, DOOR_H + (spec.canopy ? 0.55 : 0.2), 0.14, spec.sign, 0.5, [255, 235, 190]);
  if (spec.open && t1 + 1.5 < s.len) signFace(B.props, s, t1 + 0.85, 1.35, 0.1, TEXT_OPEN, 0.25, [120, 255, 150]);

  // --- local room frame: a along the front wall, d inward from it ---
  const ox = s.p0x + s.tx * WALL_T - s.nx * WALL_T, oz = s.p0z + s.tz * WALL_T - s.nz * WALL_T;
  const ax = s.tx, az = s.tz, dx = -s.nx, dz = -s.nz;
  const W = s.len - 2 * WALL_T, D = depth - 2 * WALL_T;
  const toWorld = (a0: number, d0: number, a1: number, d1: number): Rect => {
    const xa = ox + ax * a0 + dx * d0, za = oz + az * a0 + dz * d0;
    const xb = ox + ax * a1 + dx * d1, zb = oz + az * a1 + dz * d1;
    return { x0: Math.min(xa, xb), z0: Math.min(za, zb), x1: Math.max(xa, xb), z1: Math.max(za, zb) };
  };

  const ks: { k: number; p: Program }[] = [{ k: 0, p: spec.programs[0] }];
  const mid = Math.floor(floors / 2);
  if (spec.programs[1] && mid > 0 && mid < floors - 1) ks.push({ k: mid, p: spec.programs[1] });
  if (spec.programs[2] && floors > 1) ks.push({ k: floors - 1, p: spec.programs[2] });
  const hasLift = ks.length > 1 && D > LIFT_DEPTH + 5;
  if (!hasLift) ks.length = 1;

  // Wide lobbies get the lift straight across from the door; narrow houses tuck it into a back corner.
  const ca = W >= 9 ? uc - WALL_T : W - LIFT_HALF - LIFT_WALL;
  const la0 = ca - LIFT_HALF, la1 = ca + LIFT_HALF, ld0 = D - LIFT_DEPTH;
  const liftLocal = [la0 - LIFT_WALL, ld0 - LIFT_WALL, la1 + LIFT_WALL, D] as const;
  const shaftRect = hasLift ? toWorld(...liftLocal) : null;
  const topCeil = (ks[ks.length - 1].k + 1) * fh - SLAB;

  // --- colliders: thin walls with a gap at the door, instead of the whole footprint ---
  const T = WALL_T + 0.05;
  for (let sd = 0; sd < 4; sd++) {
    const ss = sideOf(r, sd);
    const piece = (u0: number, u1: number, y0: number) => {
      const xa = ss.p0x + ss.tx * u0, za = ss.p0z + ss.tz * u0;
      const xb = ss.p0x + ss.tx * u1 - ss.nx * T, zb = ss.p0z + ss.tz * u1 - ss.nz * T;
      const x0 = Math.min(xa, xb), z0 = Math.min(za, zb), x1 = Math.max(xa, xb), z1 = Math.max(za, zb);
      if (y0 === 0) B.colliders.push(x0, z0, x1, z1);
      else B.levelColliders.push(x0, z0, x1, z1, y0, 1e5);
    };
    if (sd === side) {
      piece(0, t0, 0);
      piece(t1, ss.len, 0);
      piece(t0, t1, DOOR_H);
    } else piece(0, ss.len, 0);
  }

  // --- lift shaft: one set of walls through every storey, open at the three served floors ---
  const shaft = new FaceList();
  let lift: Rect | null = null;
  let liftDoor: Door | null = null;
  if (hasLift) {
    const W_ = LIFT_WALL;
    const band = Math.round(fh * 100);
    const wv = (a0: number, d0: number, a1: number, d1: number, y0: number, y1: number, na: number, nd: number, c: RGB, seed = 0) => {
      const p = toWorld(a0, d0, a0, d0), q = toWorld(a1, d1, a1, d1);
      vquad(shaft, p.x0, p.z0, q.x0, q.z0, y0, y1, ax * na + dx * nd, az * na + dz * nd, y0, M_PLASTER, c, seed);
    };
    const inner: RGB = [120, 124, 130], outer: RGB = spec.programs[0].wall;
    wv(la0 - W_, ld0 - W_, la0 - W_, D, 0, topCeil, -1, 0, outer);
    wv(la0, ld0, la0, D, 0, topCeil, 1, 0, inner, band);
    wv(la1 + W_, ld0 - W_, la1 + W_, D, 0, topCeil, 1, 0, outer);
    wv(la1, ld0, la1, D, 0, topCeil, -1, 0, inner, band);
    wv(la0, D, la1, D, 0, topCeil, 0, -1, inner, band);
    const holes = ks.map(({ k }): Hole => [ca - LIFT_OPEN, ca + LIFT_OPEN, k * fh, k * fh + LIFT_OPEN_H]);
    holedWall((u0, u1, y0, y1) => wv(u0, ld0 - W_, u1, ld0 - W_, y0, y1, 0, -1, outer), la0 - W_, la1 + W_, 0, topCeil, holes);
    holedWall((u0, u1, y0, y1) => wv(u0, ld0, u1, ld0, y0, y1, 0, 1, inner, band), la0, la1, 0, topCeil, holes);
    for (const { k } of ks) {
      const y = k * fh;
      wv(ca - LIFT_OPEN, ld0 - W_, ca - LIFT_OPEN, ld0, y, y + LIFT_OPEN_H, 1, 0, LIFT_STEEL);
      wv(ca + LIFT_OPEN, ld0 - W_, ca + LIFT_OPEN, ld0, y, y + LIFT_OPEN_H, -1, 0, LIFT_STEEL);
    }
    hquad(shaft, toWorld(la0, ld0, la1, D), topCeil, false, M_CEILING, [200, 210, 220], 0);
    for (const [a0, d0, a1, d1] of [
      [la0 - W_, ld0 - W_, la0, D], [la1, ld0 - W_, la1 + W_, D],
      [la0 - W_, ld0 - W_, ca - LIFT_OPEN, ld0], [ca + LIFT_OPEN, ld0 - W_, la1 + W_, ld0],
    ]) {
      const q = toWorld(a0, d0, a1, d1);
      B.colliders.push(q.x0, q.z0, q.x1, q.z1);
    }
    lift = toWorld(la0 + 0.05, ld0 + 0.05, la1 - 0.05, D - 0.05);
    const dc = toWorld(ca, ld0 + 0.06, ca, ld0 + 0.06);
    liftDoor = { x: dc.x0, z: dc.z0, tx: ax, tz: az, nx: -dx, nz: -dz, w: 2 * LIFT_OPEN };
  }

  // --- storeys ---
  const levels: Level[] = [];
  const innerRect: Rect = { x0: r.x0 + WALL_T, z0: r.z0 + WALL_T, x1: r.x1 - WALL_T, z1: r.z1 - WALL_T };
  const back = (side + 2) & 3;
  for (const { k, p } of ks) {
    const y = k * fh, ceil = (k + 1) * fh - SLAB;
    const L = new FaceList();
    const lights: number[] = [];
    for (let sd = 0; sd < 4; sd++) {
      const ss = sideOf(r, sd);
      const holes: Hole[] = [];
      const wr = k === 0 ? fw.ground : fw.upper;
      if (wr) {
        for (let c = 0; c * fw.colW < ss.len; c++) {
          holes.push([(c + wr[0]) * fw.colW, (c + wr[1]) * fw.colW, (k + wr[2]) * fh, (k + wr[3]) * fh]);
        }
      }
      if (k === 0 && sd === side) holes.push([t0, t1, 0, DOOR_H]);
      if (shaftRect && sd === back) {
        const ua = (shaftRect.x0 - ss.p0x) * ss.tx + (shaftRect.z0 - ss.p0z) * ss.tz;
        const ub = (shaftRect.x1 - ss.p0x) * ss.tx + (shaftRect.z1 - ss.p0z) * ss.tz;
        holes.push([Math.min(ua, ub), Math.max(ua, ub), y - 1, ceil + 1]);
      }
      const inx = -ss.nx * WALL_T, inz = -ss.nz * WALL_T;
      holedWall((u0, u1, ya, yb) => {
        vquad(L, ss.p0x + ss.tx * u0 + inx, ss.p0z + ss.tz * u0 + inz, ss.p0x + ss.tx * u1 + inx, ss.p0z + ss.tz * u1 + inz,
          ya, yb, -ss.nx, -ss.nz, ya - y, M_PLASTER, p.wall, 0);
      }, WALL_T, ss.len - WALL_T, y, ceil, holes);
    }
    for (const q of minus(innerRect, shaftRect)) {
      hquad(L, q, y + 0.02, true, M_FLOOR, p.floorC, p.floor);
      hquad(L, q, ceil, false, M_CEILING, p.light, 0);
    }
    const room = new Room(
      { ox, oz, ax, az, dx, dz, W, D, y: y + 0.02, H: ceil - y - 0.02 },
      L, lights, B.levelColliders, mulberry32(hash2(spec.seed, k * 7919 + 1)),
      k === 0 ? [t0 - WALL_T, t1 - WALL_T] : null, hasLift ? liftLocal : null, spec.text,
    );
    if (hasLift) {
      room.wallSign(TEXT_LIFT, ca, ld0 - LIFT_WALL - 0.02, LIFT_OPEN_H + 0.1, 0.25, 'front', [200, 230, 255]);
      room.box(ca + LIFT_OPEN + 0.15, ld0 - LIFT_WALL - 0.04, ca + LIFT_OPEN + 0.3, ld0 - LIFT_WALL, 1.05, 1.25, M_GLOW, [255, 200, 120]);
    }
    p.build(room);
    const name = k === 0 ? 'GROUND' : k === floors - 1 ? `TOP FLOOR ${k}` : `FLOOR ${k}`;
    levels.push({ y, h: ceil - y, k, name: `${name} - ${p.name}`, faces: L.toArray(), lights: new Float32Array(lights) });
  }

  const plug = new FaceList();
  vquad(plug, px(t0) + ix, pz(t0) + iz, px(t1) + ix, pz(t1) + iz, 0, DOOR_H, s.nx, s.nz, 0, M_GLOW, [150, 120, 80], 0);

  B.interiors.push({
    x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, top: h, label: spec.label, levels,
    shaft: shaft.toArray(), lift, liftDoor, plug: plug.toArray(),
    door: { x: px(uc) + ix / 2, z: pz(uc) + iz / 2, tx: s.tx, tz: s.tz, nx: s.nx, nz: s.nz, w: doorW },
  });
  B.maxH = Math.max(B.maxH, h);
}

// ---- drawing ----

const G_o = glyph('o');
const F = new Float64Array(FACE_STRIDE);
const CAB_FLOOR: RGB = [90, 80, 70];

function drawList(f: Float32Array): void {
  for (let o = 0; o < f.length; o += FACE_STRIDE) drawFace(f, o);
}

function drawLights(l: Float32Array): void {
  for (let o = 0; o < l.length; o += 6) drawPoint(l[o], l[o + 1], l[o + 2], G_o, l[o + 3], l[o + 4], l[o + 5], 0.6, 1);
}

function flat(r: Rect, y: number, up: boolean, mat: number, c: RGB, seed: number): void {
  const { x0, z0, x1, z1 } = r;
  if (up) {
    F[0] = x0; F[1] = y; F[2] = z0; F[3] = x1; F[4] = y; F[5] = z0; F[6] = x1; F[7] = y; F[8] = z1; F[9] = x0; F[10] = y; F[11] = z1;
    F[12] = x0; F[13] = z0; F[14] = x1; F[15] = z0; F[16] = x1; F[17] = z1; F[18] = x0; F[19] = z1;
  } else {
    F[0] = x0; F[1] = y; F[2] = z1; F[3] = x1; F[4] = y; F[5] = z1; F[6] = x1; F[7] = y; F[8] = z0; F[9] = x0; F[10] = y; F[11] = z0;
    F[12] = x0; F[13] = z1; F[14] = x1; F[15] = z1; F[16] = x1; F[17] = z0; F[18] = x0; F[19] = z0;
  }
  F[20] = 0; F[21] = up ? 1 : -1; F[22] = 0;
  F[23] = mat; F[24] = c[0]; F[25] = c[1]; F[26] = c[2]; F[27] = seed;
  drawFace(F, 0);
}

export function levelAt(it: Interior, y: number): Level | null {
  for (const lv of it.levels) if (y >= lv.y - 0.3 && y < lv.y + lv.h + 0.2) return lv;
  return null;
}

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x > r.x0 + margin && x < r.x1 - margin && z > r.z0 + margin && z < r.z1 - margin;
}

/** Standing far enough into the cab to call the lift, so the closing doors pass in front of you. */
export function inCab(it: Interior, x: number, z: number): boolean {
  return it.lift !== null && inRect(it.lift, x, z, 0.4);
}

/** Steel cab doors sliding out of the jambs; `closed` runs from 0 (open, not drawn) to 1. */
function cabDoors(d: Door, y: number, closed: number): void {
  if (closed <= 0) return;
  const half = d.w / 2 + 0.03;
  const leaf = half * Math.min(1, closed);
  const yaw = Math.atan2(d.nx, d.nz);
  for (const s of [-1, 1]) {
    const c = s * (half - leaf / 2);
    drawBoxYaw(d.x + d.tx * c, y + CAB_H / 2, d.z + d.tz * c, yaw, leaf / 2, CAB_H / 2, 0.03, M_PAINT, LIFT_STEEL[0], LIFT_STEEL[1], LIFT_STEEL[2], 0);
  }
}

/** Glass sliding doors: only the frames are drawn, so the lit room shows through; they part as you come near. */
function doorLeaves(d: Door, cam: Camera): void {
  const dist = Math.hypot(cam.x - d.x, cam.z - d.z);
  if (dist > 30) return;
  const open = Math.min(1, Math.max(0, (4.5 - dist) / 2));
  const yaw = Math.atan2(d.nx, d.nz);
  const half = d.w / 4;
  const c: RGB = [70, 74, 82];
  for (const side of [-1, 1]) {
    const off = side * (half + open * d.w * 0.48);
    const cx = d.x + d.tx * off, cz = d.z + d.tz * off;
    for (const e of [-1, 1]) {
      const ex = cx + d.tx * e * (half - 0.03), ez = cz + d.tz * e * (half - 0.03);
      drawBoxYaw(ex, DOOR_H / 2, ez, yaw, 0.03, DOOR_H / 2, 0.025, M_PAINT, c[0], c[1], c[2], 0);
    }
    for (const y of [0.05, DOOR_H - 0.05, 1.0]) drawBoxYaw(cx, y, cz, yaw, half, y === 1.0 ? 0.02 : 0.05, 0.025, M_PAINT, c[0], c[1], c[2], 0);
  }
}

/**
 * Inside: the storey the camera stands on, plus the lift shaft and cab. Outside: the lobby when the
 * door faces you and is close enough to look through, otherwise a warm panel that fills the doorway.
 * `liftDoors` is how far the cab doors are closed (0 open, 1 shut); they stay shut while the cab moves,
 * so between floors there is never an opening to see through. Returns true when the camera is inside.
 */
export function drawInterior(it: Interior, cam: Camera, liftDoors: number): boolean {
  const inside = inRect(it, cam.x, cam.z) && cam.y < it.top;
  let cabY = 0;
  let inShaft = false;
  if (inside) {
    const feet = cam.y - EYE_H;
    const lv = levelAt(it, feet);
    if (lv) {
      drawList(lv.faces);
      drawLights(lv.lights);
      cabY = lv.y;
    }
    if (it.lift && inRect(it.lift, cam.x, cam.z)) {
      cabY = feet;
      inShaft = true;
    }
  } else {
    const d = it.door;
    const dx = cam.x - d.x, dz = cam.z - d.z;
    if (dx * d.nx + dz * d.nz <= 0 || !sphereVisible(d.x, DOOR_H / 2, d.z, d.w)) return false;
    if (dx * dx + dz * dz > LOOK_IN * LOOK_IN || cam.y > 25) {
      drawList(it.plug);
      return false;
    }
    drawList(it.levels[0].faces);
    drawLights(it.levels[0].lights);
  }
  if (it.lift) {
    drawList(it.shaft);
    flat(it.lift, cabY + 0.02, true, M_FLOOR, CAB_FLOOR, FLOOR_CARPET);
    flat(it.lift, cabY + CAB_H, false, M_CEILING, [230, 235, 255], 0);
    if (inShaft && it.liftDoor) cabDoors(it.liftDoor, cabY, liftDoors);
  }
  doorLeaves(it.door, cam);
  return inside;
}
