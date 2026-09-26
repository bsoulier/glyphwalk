import { glyph } from '../core/charset';
import {
  M_AWNING, M_CONCRETE, M_LAMP, M_LEAF, M_ROOF, M_SIGN, M_TRUNK, M_VSIGN, M_WATER,
} from '../render/materials';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP, FaceList } from './faces';
import type { Hood } from './hoods';
import { HALF, LAMP_OFF, LAMP_SPACING, P, TREE_OFF, hasPond } from './layout';
import {
  SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS, VSIGN_CHAR_H, VSIGN_PAD, VSIGN_W, signSeed, type RGB,
} from './signs';

export const G_PIPE = glyph('|');

/** Light kinds stored in Block.lights. */
export const LIGHT_LAMP = 0;
export const LIGHT_BLINK = 1;
export const LIGHT_LANTERN = 2;
/** Stand-in dot for props (like blade signs) once they are too far to be drawn as geometry. */
export const LIGHT_FAR = 3;

export interface Builder {
  rng: () => number;
  hood: number;
  faces: FaceList;
  props: FaceList;
  poles: number[];
  lights: number[];
  colliders: number[];
  maxH: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A building plot with the side that faces the street: 0 south, 1 east, 2 north, 3 west. */
export interface Lot extends Rect {
  side: number;
}

/** One face of a rectangle: start point, tangent (viewer's right when facing it) and outward normal. */
export interface Side {
  p0x: number;
  p0z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  len: number;
}

export function sideOf(r: Rect, side: number): Side {
  switch (side) {
    case 0: return { p0x: r.x0, p0z: r.z0, tx: 1, tz: 0, nx: 0, nz: -1, len: r.x1 - r.x0 };
    case 1: return { p0x: r.x1, p0z: r.z0, tx: 0, tz: 1, nx: 1, nz: 0, len: r.z1 - r.z0 };
    case 2: return { p0x: r.x1, p0z: r.z1, tx: -1, tz: 0, nx: 0, nz: 1, len: r.x1 - r.x0 };
    default: return { p0x: r.x0, p0z: r.z1, tx: 0, tz: -1, nx: -1, nz: 0, len: r.z1 - r.z0 };
  }
}

export function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

export function jitter(rng: () => number, c: RGB, amount = 0.15): RGB {
  const k = 1 - amount + rng() * amount * 2;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Sides of `r` that sit on the lot boundary, i.e. face a street. */
export function streetSides(r: Rect, lot: Rect, tol = 3): number[] {
  const s: number[] = [];
  if (r.z0 - lot.z0 < tol) s.push(0);
  if (lot.x1 - r.x1 < tol) s.push(1);
  if (lot.z1 - r.z1 < tol) s.push(2);
  if (r.x0 - lot.x0 < tol) s.push(3);
  return s;
}

/** Row-house plots around the block perimeter; the middle stays open as a courtyard. */
export function perimeterLots(rng: () => number, r: Rect, depth: number, minW: number, maxW: number): Lot[] {
  const out: Lot[] = [];
  const split = (a: number, b: number, emit: (s: number, e: number) => void) => {
    let s = a;
    while (b - s > 0.01) {
      let w = minW + rng() * (maxW - minW);
      if (b - s - w < minW) w = b - s;
      emit(s, s + w);
      s += w;
    }
  };
  split(r.x0, r.x1, (s, e) => out.push({ x0: s, z0: r.z0, x1: e, z1: r.z0 + depth, side: 0 }));
  split(r.x0, r.x1, (s, e) => out.push({ x0: s, z0: r.z1 - depth, x1: e, z1: r.z1, side: 2 }));
  split(r.z0 + depth, r.z1 - depth, (s, e) => out.push({ x0: r.x1 - depth, z0: s, x1: r.x1, z1: e, side: 1 }));
  split(r.z0 + depth, r.z1 - depth, (s, e) => out.push({ x0: r.x0, z0: s, x1: r.x0 + depth, z1: e, side: 3 }));
  return out;
}

export function wallSign(
  B: Builder, s: Side, texts: readonly number[], colors: readonly RGB[], y0: number, scale: number,
): boolean {
  const { rng } = B;
  const maxChars = Math.floor((s.len / scale - 1 - 2 * SIGN_PAD) / SIGN_CHAR_W);
  const fits = texts.filter((k) => SIGN_TEXTS[k].length <= maxChars);
  if (fits.length === 0) return false;
  const ti = pick(rng, fits);
  const wu = SIGN_TEXTS[ti].length * SIGN_CHAR_W + 2 * SIGN_PAD;
  const W = wu * scale, H = SIGN_H * scale;
  const t0 = 0.3 + rng() * Math.max(0, s.len - W - 0.6);
  const ax = s.p0x + s.tx * t0 + s.nx * 0.3, az = s.p0z + s.tz * t0 + s.nz * 0.3;
  const bx = ax + s.tx * W, bz = az + s.tz * W;
  const c = pick(rng, colors);
  const seed = signSeed(ti, Math.floor(rng() * 8), scale);
  B.faces.poly(
    ax, y0, az, bx, y0, bz, bx, y0 + H, bz, ax, y0 + H, az,
    0, 0, wu, 0, wu, SIGN_H, 0, SIGN_H, M_SIGN, c[0], c[1], c[2], seed,
  );
  return true;
}

/** Double-sided vertical sign sticking out of the wall, readable from both directions along the street. */
export function bladeSign(
  B: Builder, s: Side, t: number, y0: number, texts: readonly number[], colors: readonly RGB[], maxH: number,
): void {
  const { rng } = B;
  const fits = texts.filter((k) => SIGN_TEXTS[k].length * VSIGN_CHAR_H + 2 * VSIGN_PAD <= maxH);
  if (fits.length === 0) return;
  const ti = pick(rng, fits);
  const H = SIGN_TEXTS[ti].length * VSIGN_CHAR_H + 2 * VSIGN_PAD;
  const qx = s.p0x + s.tx * t + s.nx * 0.25, qz = s.p0z + s.tz * t + s.nz * 0.25;
  const ex = qx + s.nx * VSIGN_W, ez = qz + s.nz * VSIGN_W;
  const c = pick(rng, colors);
  const seed = signSeed(ti, Math.floor(rng() * 8), 1);
  const y1 = y0 + H;
  B.props.poly(qx, y0, qz, ex, y0, ez, ex, y1, ez, qx, y1, qz, 0, 0, 1, 0, 1, H, 0, H, M_VSIGN, c[0], c[1], c[2], seed);
  B.props.poly(ex, y0, ez, qx, y0, qz, qx, y1, qz, ex, y1, ez, 0, 0, 1, 0, 1, H, 0, H, M_VSIGN, c[0], c[1], c[2], seed);
  B.lights.push((qx + ex) / 2, y0 + H / 2, (qz + ez) / 2, c[0], c[1], c[2], LIGHT_FAR);
}

export function lanterns(B: Builder, s: Side, y: number, spacing: number): void {
  let k = 0;
  for (let t = 0.8; t < s.len - 0.8; t += spacing, k++) {
    const red = (k & 1) === 0;
    B.lights.push(
      s.p0x + s.tx * t + s.nx * 0.45, y, s.p0z + s.tz * t + s.nz * 0.45,
      255, red ? 70 : 200, red ? 40 : 120, LIGHT_LANTERN,
    );
  }
}

/** Striped awning hanging from the wall between t0 and t1 along the side. */
export function awning(B: Builder, s: Side, t0: number, t1: number, y: number, depth: number, stripe: number): void {
  const ax = s.p0x + s.tx * t0, az = s.p0z + s.tz * t0;
  const bx = s.p0x + s.tx * t1, bz = s.p0z + s.tz * t1;
  const fx = s.nx * depth, fz = s.nz * depth;
  const w = t1 - t0, lo = y - 0.6, val = lo - 0.35;
  const P_ = B.props;
  P_.poly(ax + fx, lo, az + fz, bx + fx, lo, bz + fz, bx, y, bz, ax, y, az, 0, 0, w, 0, w, depth, 0, depth, M_AWNING, 0, 0, 0, stripe);
  P_.poly(bx + fx, lo, bz + fz, ax + fx, lo, az + fz, ax, y, az, bx, y, bz, w, 0, 0, 0, 0, depth, w, depth, M_AWNING, 0, 0, 0, stripe);
  P_.poly(ax + fx, val, az + fz, bx + fx, val, bz + fz, bx + fx, lo, bz + fz, ax + fx, lo, az + fz, 0, 0, w, 0, w, 0.35, 0, 0.35, M_AWNING, 0, 0, 0, stripe);
}

/** Gable roof; the two gable triangles reuse the facade material so window rows continue into the attic. */
export function gableRoof(
  list: FaceList, r: Rect, y: number, rise: number, ridgeAlongX: boolean, over: number,
  roofMat: number, rc: RGB, roofSeed: number, wallMat: number, wc: RGB, wallSeed: number,
): void {
  const { x0, z0, x1, z1 } = r;
  const yt = y + rise;
  if (ridgeAlongX) {
    const zm = (z0 + z1) / 2, L = x1 - x0 + 2 * over, S = Math.hypot(zm - z0, rise), D = z1 - z0;
    list.poly(x0 - over, y, z0, x1 + over, y, z0, x1 + over, yt, zm, x0 - over, yt, zm, 0, 0, L, 0, L, S, 0, S, roofMat, rc[0], rc[1], rc[2], roofSeed);
    list.poly(x1 + over, y, z1, x0 - over, y, z1, x0 - over, yt, zm, x1 + over, yt, zm, 0, 0, L, 0, L, S, 0, S, roofMat, rc[0], rc[1], rc[2], roofSeed);
    list.poly(x0, y, z1, x0, y, z0, x0, yt, zm, x0, yt, zm, 0, y, D, y, D / 2, yt, D / 2, yt, wallMat, wc[0], wc[1], wc[2], wallSeed);
    list.poly(x1, y, z0, x1, y, z1, x1, yt, zm, x1, yt, zm, 0, y, D, y, D / 2, yt, D / 2, yt, wallMat, wc[0], wc[1], wc[2], wallSeed);
  } else {
    const xm = (x0 + x1) / 2, L = z1 - z0 + 2 * over, S = Math.hypot(xm - x0, rise), W = x1 - x0;
    list.poly(x0, y, z1 + over, x0, y, z0 - over, xm, yt, z0 - over, xm, yt, z1 + over, 0, 0, L, 0, L, S, 0, S, roofMat, rc[0], rc[1], rc[2], roofSeed);
    list.poly(x1, y, z0 - over, x1, y, z1 + over, xm, yt, z1 + over, xm, yt, z0 - over, 0, 0, L, 0, L, S, 0, S, roofMat, rc[0], rc[1], rc[2], roofSeed);
    list.poly(x0, y, z0, x1, y, z0, xm, yt, z0, xm, yt, z0, 0, y, W, y, W / 2, yt, W / 2, yt, wallMat, wc[0], wc[1], wc[2], wallSeed);
    list.poly(x1, y, z1, x0, y, z1, xm, yt, z1, xm, yt, z1, 0, y, W, y, W / 2, yt, W / 2, yt, wallMat, wc[0], wc[1], wc[2], wallSeed);
  }
}

/**
 * Four sloped trapezoids from the eave rectangle (grown by `over`) up to a top rectangle (shrunk by `ins`).
 * Covers mansards (steep, small inset) and pagoda eaves (wide overhang, big inset).
 */
export function hipRoof(
  list: FaceList, r: Rect, y: number, rise: number, ins: number, over: number,
  mat: number, c: RGB, seed: number, topMat = 0, under = false,
): void {
  const maxIns = Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2 - 0.05;
  const inset = Math.min(ins, maxIns);
  const bx0 = r.x0 - over, bz0 = r.z0 - over, bx1 = r.x1 + over, bz1 = r.z1 + over;
  const tx0 = r.x0 + inset, tz0 = r.z0 + inset, tx1 = r.x1 - inset, tz1 = r.z1 - inset;
  const yt = y + rise;
  const S = Math.hypot(inset + over, rise);
  const W = bx1 - bx0, D = bz1 - bz0;
  const [cr, cg, cb] = c;
  list.poly(bx0, y, bz0, bx1, y, bz0, tx1, yt, tz0, tx0, yt, tz0, 0, 0, W, 0, tx1 - bx0, S, tx0 - bx0, S, mat, cr, cg, cb, seed);
  list.poly(bx1, y, bz0, bx1, y, bz1, tx1, yt, tz1, tx1, yt, tz0, 0, 0, D, 0, tz1 - bz0, S, tz0 - bz0, S, mat, cr, cg, cb, seed);
  list.poly(bx1, y, bz1, bx0, y, bz1, tx0, yt, tz1, tx1, yt, tz1, 0, 0, W, 0, bx1 - tx0, S, bx1 - tx1, S, mat, cr, cg, cb, seed);
  list.poly(bx0, y, bz1, bx0, y, bz0, tx0, yt, tz0, tx0, yt, tz1, 0, 0, D, 0, bz1 - tz0, S, bz1 - tz1, S, mat, cr, cg, cb, seed);
  if (topMat !== 0 && tx1 - tx0 > 0.05 && tz1 - tz0 > 0.05) {
    const w = tx1 - tx0, d = tz1 - tz0;
    list.poly(tx0, yt, tz0, tx1, yt, tz0, tx1, yt, tz1, tx0, yt, tz1, 0, 0, w, 0, w, d, 0, d, topMat, cr, cg, cb, seed);
  }
  if (under && over > 0) {
    list.poly(bx0, y, bz1, bx1, y, bz1, bx1, y, bz0, bx0, y, bz0, 0, 0, W, 0, W, D, 0, D, M_ROOF, cr * 0.6, cg * 0.6, cb * 0.6, seed);
  }
}

export function streetLamps(B: Builder, bx: number, bz: number, hood: Hood): void {
  const h = hood.lampH;
  const [lr, lg, lb] = hood.lamp;
  const lamp = (x: number, z: number) => {
    B.poles.push(x, 0, h, z, 0.09, 72, 76, 86, G_PIPE, M_CONCRETE);
    B.props.box(x - 0.32, h, z - 0.32, x + 0.32, h + 0.22, z + 0.32, M_LAMP, lr, lg, lb, 0, M_LAMP, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
    B.lights.push(x, h - 0.05, z, lr, lg, lb, LIGHT_LAMP);
  };
  for (let k = 1; k <= 3; k++) {
    const a = k * LAMP_SPACING;
    lamp(bx + a, bz + LAMP_OFF);
    lamp(bx + P - LAMP_OFF, bz + a);
    lamp(bx + a, bz + P - LAMP_OFF);
    lamp(bx + LAMP_OFF, bz + a);
  }
}

export const TREE_ROUND = 0;
export const TREE_CHERRY = 1;
export const TREE_PLANE = 2;

const TREE_COLORS: readonly (readonly RGB[])[] = [
  [[52, 128, 60], [70, 140, 52], [40, 110, 76]],
  [[240, 150, 190], [250, 182, 212], [226, 124, 170]],
  [[110, 135, 70], [96, 126, 62], [126, 142, 80]],
];

export function tree(B: Builder, x: number, z: number, s: number, kind = TREE_ROUND): void {
  const trunkH = (kind === TREE_PLANE ? 3.4 : 2.2) * s;
  B.poles.push(x, 0, trunkH + 0.3, z, 0.18 * s, 95, 70, 45, G_PIPE, M_TRUNK);
  const c = pick(B.rng, TREE_COLORS[kind]);
  const seed = Math.floor(B.rng() * 65536);
  const cw = (kind === TREE_CHERRY ? 1.7 : 1.5) * s;
  const ch = (kind === TREE_PLANE ? 2.6 : kind === TREE_CHERRY ? 1.6 : 2.2) * s;
  B.props.box(x - cw, trunkH, z - cw, x + cw, trunkH + ch, z + cw, M_LEAF, c[0], c[1], c[2], seed, M_LEAF, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  const tw = cw * 0.6;
  B.props.box(x - tw, trunkH + ch, z - tw, x + tw, trunkH + ch + (kind === TREE_CHERRY ? 0.7 : 1.0) * s, z + tw, M_LEAF, c[0], c[1], c[2], seed + 1);
  B.maxH = Math.max(B.maxH, trunkH + ch + 1);
}

/** Trees along all four sidewalks at the given distances along each side. */
export function streetTrees(
  B: Builder, bx: number, bz: number, kind: number, s: number, along: readonly number[], off = TREE_OFF,
): void {
  for (const a of along) {
    tree(B, bx + a, bz + off, s, kind);
    tree(B, bx + P - off, bz + a, s, kind);
    tree(B, bx + a, bz + P - off, s, kind);
    tree(B, bx + off, bz + a, s, kind);
  }
}

/** Park with a grid of trees, keeping the cross paths and any pond clear. */
export function park(B: Builder, i: number, j: number, lot: Rect, kind: number, pondAllowed: boolean): void {
  const pond = pondAllowed && hasPond(i, j);
  const cx = i * P + HALF, cz = j * P + HALF;
  const step = (lot.x1 - lot.x0 - 8) / 3;
  for (let gx = 0; gx < 4; gx++) {
    for (let gz = 0; gz < 4; gz++) {
      const tx = lot.x0 + 4 + gx * step + (B.rng() - 0.5) * 3;
      const tz = lot.z0 + 4 + gz * step + (B.rng() - 0.5) * 3;
      if (pond && Math.hypot(tx - cx, tz - cz) < 11) continue;
      if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3) continue;
      tree(B, tx, tz, 1 + B.rng() * 0.5, kind);
    }
  }
}

export function fountain(B: Builder, cx: number, cz: number, radius: number, c: RGB): void {
  const [r, g, b] = c;
  B.faces.box(cx - radius, 0, cz - radius, cx + radius, 0.7, cz + radius, M_CONCRETE, r, g, b, 0, M_WATER);
  B.faces.box(cx - 0.5, 0.7, cz - 0.5, cx + 0.5, 2.6, cz + 0.5, M_CONCRETE, r, g, b, 0);
  B.faces.box(cx - 1.4, 2.6, cz - 1.4, cx + 1.4, 2.9, cz + 1.4, M_CONCRETE, r, g, b, 0, M_WATER, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  B.colliders.push(cx - radius, cz - radius, cx + radius, cz + radius);
  B.maxH = Math.max(B.maxH, 3);
}

export function chimney(B: Builder, x: number, z: number, y0: number, y1: number, hw: number, hd: number, c: RGB): void {
  B.props.box(x - hw, y0, z - hd, x + hw, y1, z + hd, M_CONCRETE, c[0], c[1], c[2], 0);
  B.maxH = Math.max(B.maxH, y1);
}
