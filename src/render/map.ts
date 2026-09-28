import type { FrameBuffer } from './framebuffer';
import type { World } from '../world/world';
import { glyph } from '../core/charset';
import { HOODS, HOOD_BLOCKS, H_DOCKS, H_DOWNTOWN, H_JAPAN, hoodAt, hoodOfRegion, isBeach } from '../world/hoods';
import { HALF, KIND_CITY, KIND_PARK, LOT_EDGE, P, ROAD_HALF, blockKind, hasPond } from '../world/layout';
import { KIND_POLICE, KIND_TAXI } from '../world/traffic';
import { REGION, TRAIN_LEN, isRailRow, railZ } from '../world/train';

/** A map panel on the character grid. The rectangle includes its one-cell border. */
export interface MapView {
  col: number;
  row: number;
  w: number;
  h: number;
  /** World point shown at the centre. */
  cx: number;
  cz: number;
  /** Metres per column; rows cover more ground because cells are taller than wide. */
  mpc: number;
  /** Cell height / cell width in pixels. */
  aspect: number;
  full: boolean;
}

const G_SPACE = 0;
const G_DASH = glyph('-');
const G_PIPE = glyph('|');
const G_PLUS = glyph('+');
const G_EQ = glyph('=');
const G_HASH = glyph('#');
const G_QUOTE = glyph('"');
const G_TILDE = glyph('~');
const G_o = glyph('o');
const G_STAR = glyph('*');
const G_AT = glyph('@');
const G_E = glyph('E');
const G_DARK = glyph('▓');
const G_FULL = glyph('█');
const ARROWS = ['^', '/', '>', '\\', 'v', '/', '<', '\\'].map((c) => glyph(c));

const FRAME: readonly [number, number, number] = [125, 255, 176];
const FRAME_BG: readonly [number, number, number] = [2, 10, 6];

let fg: Uint32Array = new Uint32Array(0);
let bg: Uint32Array = new Uint32Array(0);
let cols = 0;
let rows = 0;

function c8(v: number): number {
  return v > 255 ? 255 : v < 0 ? 0 : v | 0;
}

function set(col: number, row: number, gl: number, r: number, g: number, b: number, br: number, bgc: number, bb: number): void {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return;
  const i = row * cols + col;
  fg[i] = (gl << 24) | (c8(b) << 16) | (c8(g) << 8) | c8(r);
  bg[i] = (c8(bb) << 16) | (c8(bgc) << 8) | c8(br);
}

/** Replace only the glyph and its colour, keeping the terrain background underneath. */
function mark(col: number, row: number, gl: number, r: number, g: number, b: number): void {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return;
  fg[row * cols + col] = (gl << 24) | (c8(b) << 16) | (c8(g) << 8) | c8(r);
}

function text(col: number, row: number, s: string, c: readonly [number, number, number], back: readonly [number, number, number]): void {
  for (let k = 0; k < s.length; k++) set(col + k, row, glyph(s[k]), c[0], c[1], c[2], back[0], back[1], back[2]);
}

interface Inner {
  c0: number;
  r0: number;
  w: number;
  h: number;
  mpr: number;
}

function inner(v: MapView): Inner {
  return { c0: v.col + 1, r0: v.row + 1, w: v.w - 2, h: v.h - 2, mpr: v.mpc * v.aspect };
}

/** Grid cell of a world point, or null when it falls outside the panel. */
function toCell(v: MapView, n: Inner, x: number, z: number): [number, number] | null {
  const c = Math.floor(n.c0 + n.w / 2 + (x - v.cx) / v.mpc);
  const r = Math.floor(n.r0 + n.h / 2 - (z - v.cz) / n.mpr);
  if (c < n.c0 || r < n.r0 || c >= n.c0 + n.w || r >= n.r0 + n.h) return null;
  return [c, r];
}

export function mapToWorld(v: MapView, col: number, row: number): [number, number] | null {
  const n = inner(v);
  if (col < n.c0 || row < n.r0 || col >= n.c0 + n.w || row >= n.r0 + n.h) return null;
  return [v.cx + (col + 0.5 - (n.c0 + n.w / 2)) * v.mpc, v.cz - (row + 0.5 - (n.r0 + n.h / 2)) * n.mpr];
}

export function drawMap(fb: FrameBuffer, world: World, v: MapView, yaw: number, time: number): void {
  fg = fb.fg;
  bg = fb.bg;
  cols = fb.cols;
  rows = fb.rows;
  const n = inner(v);
  terrain(v, n);
  if (v.full) labels(v, n);
  shuttles(world, v, n);
  for (const car of world.cars.list) {
    const cell = toCell(v, n, car.x, car.z);
    if (!cell) continue;
    if (car.kind === KIND_TAXI) mark(cell[0], cell[1], G_o, 255, 220, 60);
    else if (car.kind === KIND_POLICE) mark(cell[0], cell[1], G_STAR, 120, 160, 255);
    else mark(cell[0], cell[1], G_o, car.r * 0.6 + 100, car.g * 0.6 + 100, car.b * 0.6 + 100);
  }
  entrances(world, v, n);
  player(v, n, yaw, time);
  frame(v);
}

/**
 * Each cell samples the same layout functions the city is generated from. Roads are widened to at
 * least one cell so they never drop out between samples when zoomed out.
 */
function terrain(v: MapView, n: Inner): void {
  const hx = Math.max(ROAD_HALF, v.mpc * 0.5), hz = Math.max(ROAD_HALF, n.mpr * 0.5);
  const walks = v.mpc < 6;
  for (let r = 0; r < n.h; r++) {
    const Z = v.cz - (r + 0.5 - n.h / 2) * n.mpr;
    const bj = Math.floor(Z / P);
    const lz = Z - bj * P;
    const az = Math.abs(lz < HALF ? lz : lz - P);
    const onZ = az < hz;
    const rail = onZ && isRailRow(Math.round(Z / P));
    for (let c = 0; c < n.w; c++) {
      const X = v.cx + (c + 0.5 - n.w / 2) * v.mpc;
      const bi = Math.floor(X / P);
      const lx = X - bi * P;
      const ax = Math.abs(lx < HALF ? lx : lx - P);
      const onX = ax < hx;
      const col = n.c0 + c, row = n.r0 + r;
      if (onX || onZ) {
        if (rail && !onX) set(col, row, G_EQ, 150, 162, 190, 22, 22, 30);
        else set(col, row, onX && onZ ? G_PLUS : onX ? G_PIPE : G_DASH, 105, 105, 118, 16, 16, 22);
        continue;
      }
      if (walks && (ax < LOT_EDGE || az < LOT_EDGE)) {
        set(col, row, G_SPACE, 0, 0, 0, 38, 38, 44);
        continue;
      }
      const hood = hoodAt(bi, bj);
      const m = HOODS[hood].map;
      const kind = blockKind(bi, bj);
      if (isBeach(bi, bj)) {
        if (lz > HALF + 1.5) set(col, row, G_TILDE, 80, 190, 210, 14, 44, 70);
        else set(col, row, G_SPACE, 0, 0, 0, 120, 104, 72);
      } else if (kind === KIND_CITY || hood === H_DOCKS) {
        set(col, row, G_DARK, m[0] * 0.75, m[1] * 0.75, m[2] * 0.75, m[0] * 0.28, m[1] * 0.28, m[2] * 0.28);
      } else if (kind === KIND_PARK) {
        const dx = lx - HALF, dz = lz - HALF;
        const pond = (hood === H_DOWNTOWN || hood === H_JAPAN) && hasPond(bi, bj) && dx * dx + dz * dz < 81;
        if (pond) set(col, row, G_TILDE, 70, 120, 210, 14, 28, 60);
        else set(col, row, G_QUOTE, 70, 165, 85, 14, 42, 20);
      } else {
        set(col, row, G_PLUS, m[0] * 0.9, m[1] * 0.9, m[2] * 0.9, m[0] * 0.18, m[1] * 0.18, m[2] * 0.18);
      }
    }
  }
}

/** District names, placed on the block just north-east of each district's central crossroads. */
function labels(v: MapView, n: Inner): void {
  const wCells = REGION / v.mpc;
  const halfW = (n.w / 2) * v.mpc, halfH = (n.h / 2) * n.mpr;
  const ri0 = Math.floor((v.cx - halfW) / REGION), ri1 = Math.floor((v.cx + halfW) / REGION);
  const rj0 = Math.floor((v.cz - halfH) / REGION), rj1 = Math.floor((v.cz + halfH) / REGION);
  for (let ri = ri0; ri <= ri1; ri++) {
    for (let rj = rj0; rj <= rj1; rj++) {
      const h = HOODS[hoodOfRegion(ri, rj)];
      const name = ` ${h.name} `;
      if (name.length > wCells * 0.9) continue;
      const x = (ri * HOOD_BLOCKS + 2) * P + HALF, z = (rj * HOOD_BLOCKS + 2) * P + HALF;
      const cell = toCell(v, n, x, z);
      if (!cell) continue;
      const c0 = Math.max(n.c0, Math.min(n.c0 + n.w - name.length, cell[0] - Math.floor(name.length / 2)));
      const m = h.map;
      text(c0, cell[1], name, [Math.min(255, m[0] + 40), Math.min(255, m[1] + 40), Math.min(255, m[2] + 40)], [0, 0, 0]);
    }
  }
}

function shuttles(world: World, v: MapView, n: Inner): void {
  const halfW = (n.w / 2) * v.mpc, halfH = (n.h / 2) * n.mpr;
  const ri0 = Math.floor((v.cx - halfW) / REGION), ri1 = Math.floor((v.cx + halfW) / REGION);
  const rj0 = Math.floor((v.cz - halfH) / REGION) - 1, rj1 = Math.floor((v.cz + halfH) / REGION) + 1;
  for (let rj = rj0; rj <= rj1; rj++) {
    if (Math.abs(railZ(rj) - v.cz) > halfH) continue;
    for (let ri = ri0; ri <= ri1; ri++) {
      const s = world.rail.shuttle(ri, rj);
      for (let x = s.x - TRAIN_LEN / 2; x <= s.x + TRAIN_LEN / 2; x += v.mpc) {
        const cell = toCell(v, n, x, s.z);
        if (cell) mark(cell[0], cell[1], G_HASH, 235, 240, 250);
      }
    }
  }
}

/** Doors you can walk through, for blocks already generated (the map never generates city on its own). */
function entrances(world: World, v: MapView, n: Inner): void {
  const halfW = (n.w / 2) * v.mpc, halfH = (n.h / 2) * n.mpr;
  const i0 = Math.floor((v.cx - halfW) / P), i1 = Math.floor((v.cx + halfW) / P);
  const j0 = Math.floor((v.cz - halfH) / P), j1 = Math.floor((v.cz + halfH) / P);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const b = world.city.peek(i, j);
      if (!b) continue;
      for (const it of b.interiors) {
        const cell = toCell(v, n, it.door.x, it.door.z);
        if (cell) set(cell[0], cell[1], G_E, 255, 255, 255, 90, 60, 10);
      }
    }
  }
}

function player(v: MapView, n: Inner, yaw: number, time: number): void {
  const cell = toCell(v, n, v.cx, v.cz);
  if (!cell) return;
  const on = (Math.floor(time * 3) & 1) === 0;
  set(cell[0], cell[1], G_AT, 255, on ? 255 : 220, on ? 120 : 60, 60, 40, 0);
  const dc = Math.sin(yaw) / v.mpc, dr = -Math.cos(yaw) / n.mpr;
  const len = Math.hypot(dc, dr) || 1;
  const sector = ((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8;
  set(Math.round(cell[0] + (dc / len) * 1.6), Math.round(cell[1] + (dr / len) * 1.6), ARROWS[sector], 255, 255, 160, 40, 30, 0);
}

function frame(v: MapView): void {
  const [r, g, b] = FRAME;
  const [br, bgc, bb] = FRAME_BG;
  const x1 = v.col + v.w - 1, y1 = v.row + v.h - 1;
  for (let c = v.col; c <= x1; c++) {
    const corner = c === v.col || c === x1;
    set(c, v.row, corner ? G_PLUS : G_DASH, r, g, b, br, bgc, bb);
    set(c, y1, corner ? G_PLUS : G_DASH, r, g, b, br, bgc, bb);
  }
  for (let rr = v.row + 1; rr < y1; rr++) {
    set(v.col, rr, G_PIPE, r, g, b, br, bgc, bb);
    set(x1, rr, G_PIPE, r, g, b, br, bgc, bb);
  }
  const north = ' N ';
  text(v.col + Math.floor((v.w - north.length) / 2), v.row, north, [255, 255, 255], FRAME_BG);
  if (!v.full) {
    const here = HOODS[hoodAt(Math.floor(v.cx / P), Math.floor(v.cz / P))].name;
    if (here.length + 4 < v.w) text(v.col + 2, y1, ` ${here} `, FRAME, FRAME_BG);
    return;
  }
  text(v.col + 2, v.row, ` MAP ${v.mpc} m/col `, FRAME, FRAME_BG);
  const help = ' +/- zoom   click: jump there   M: map off ';
  if (help.length + 40 < v.w) text(x1 - help.length - 1, v.row, help, FRAME, FRAME_BG);
  let c = v.col + 2;
  for (const h of HOODS) {
    if (c + h.name.length + 4 > x1) break;
    set(c, y1, G_SPACE, 0, 0, 0, br, bgc, bb);
    set(c + 1, y1, G_FULL, h.map[0], h.map[1], h.map[2], br, bgc, bb);
    text(c + 2, y1, ` ${h.name} `, FRAME, FRAME_BG);
    c += h.name.length + 5;
  }
  const key = ' o car  o taxi  # monorail  E entrance  @ you ';
  if (c + key.length < x1) text(c, y1, key, FRAME, FRAME_BG);
}
