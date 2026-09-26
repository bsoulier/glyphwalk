import type { Camera } from '../render/camera';
import { sphereVisible } from '../render/raster';
import {
  FLOOR_H, M_CONCRETE, M_LAMP, M_LEAF, M_RAIL, M_ROOF, M_SIGN, M_TRUNK, M_WALL,
} from '../render/materials';
import { glyph } from '../core/charset';
import { hash3, mulberry32 } from '../core/hash';
import {
  BOX_BOTTOM, BOX_DEFAULT, BOX_N, BOX_S, BOX_SIDES, BOX_TOP, FaceList,
} from './faces';
import {
  DISTRICTS, KIND_CITY, KIND_PARK, LAMP_H, LAMP_OFF, LAMP_SPACING, LOT_EDGE, P, RAIL_Y, TREE_OFF,
  blockKind, districtAt, hasPond, heightScale, worldSeed,
} from './layout';
import { NEON, SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS } from './signs';

/** x, y0, y1, z, halfWidth, r, g, b, glyph, material */
export const POLE_STRIDE = 10;
/** x, y, z, r, g, b, kind (0 steady, 1 blinking) */
export const LIGHT_STRIDE = 7;

export interface Block {
  i: number;
  j: number;
  kind: number;
  faces: Float32Array;
  props: Float32Array;
  poles: Float32Array;
  lights: Float32Array;
  colliders: Float32Array;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  dist: number;
  lastUsed: number;
}

const G_PIPE = glyph('|');
const TREE_GREENS: readonly (readonly [number, number, number])[] = [[52, 128, 60], [70, 140, 52], [40, 110, 76]];

function key(i: number, j: number): number {
  return (i + 32768) * 65536 + (j + 32768);
}

export class City {
  private readonly cache = new Map<number, Block>();
  private readonly visible: Block[] = [];
  private frame = 0;
  private warm = false;
  genPerFrame = 12;

  get cachedBlocks(): number {
    return this.cache.size;
  }

  get(i: number, j: number): Block {
    const k = key(i, j);
    let b = this.cache.get(k);
    if (!b) {
      b = generateBlock(i, j);
      this.cache.set(k, b);
    }
    return b;
  }

  /** Visible blocks sorted front to back, so the depth test rejects hidden cells before shading them. */
  collect(cam: Camera): Block[] {
    this.frame++;
    const out = this.visible;
    out.length = 0;
    const far = cam.far;
    const i0 = Math.floor((cam.x - far) / P), i1 = Math.floor((cam.x + far) / P);
    const j0 = Math.floor((cam.z - far) / P), j1 = Math.floor((cam.z + far) / P);
    let budget = this.warm ? this.genPerFrame : Infinity;
    for (let i = i0; i <= i1; i++) {
      const dx = Math.max(i * P - cam.x, 0, cam.x - (i + 1) * P);
      for (let j = j0; j <= j1; j++) {
        const dz = Math.max(j * P - cam.z, 0, cam.z - (j + 1) * P);
        if (dx * dx + dz * dz > far * far) continue;
        const k = key(i, j);
        let b = this.cache.get(k);
        if (!b) {
          if (budget <= 0) continue;
          budget--;
          b = generateBlock(i, j);
          this.cache.set(k, b);
        }
        b.lastUsed = this.frame;
        if (!sphereVisible(b.cx, b.cy, b.cz, b.radius)) continue;
        b.dist = Math.hypot(b.cx - cam.x, b.cz - cam.z);
        out.push(b);
      }
    }
    this.warm = true;
    out.sort((a, b) => a.dist - b.dist);
    if (this.cache.size > 1400) {
      for (const [k, b] of this.cache) if (b.lastUsed < this.frame - 240) this.cache.delete(k);
    }
    return out;
  }

  collides(x: number, z: number, r: number): boolean {
    const i0 = Math.floor((x - r) / P), i1 = Math.floor((x + r) / P);
    const j0 = Math.floor((z - r) / P), j1 = Math.floor((z + r) / P);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = this.get(i, j).colliders;
        for (let o = 0; o < c.length; o += 4) {
          if (x + r > c[o] && x - r < c[o + 2] && z + r > c[o + 1] && z - r < c[o + 3]) return true;
        }
      }
    }
    return false;
  }
}

interface Builder {
  rng: () => number;
  faces: FaceList;
  props: FaceList;
  poles: number[];
  lights: number[];
  colliders: number[];
  maxH: number;
}

export function generateBlock(i: number, j: number): Block {
  const bx = i * P, bz = j * P;
  const kind = blockKind(i, j);
  const B: Builder = {
    rng: mulberry32(hash3(i, j, worldSeed)),
    faces: new FaceList(),
    props: new FaceList(),
    poles: [],
    lights: [],
    colliders: [],
    maxH: 7,
  };
  const x0 = bx + LOT_EDGE + 0.5, x1 = bx + P - LOT_EDGE - 0.5;
  const z0 = bz + LOT_EDGE + 0.5, z1 = bz + P - LOT_EDGE - 0.5;

  if (kind === KIND_CITY) buildCityLot(B, i, j, x0, z0, x1, z1);
  else if (kind === KIND_PARK) buildPark(B, i, j, x0, z0, x1, z1);
  else buildPlaza(B, x0, z0, x1, z1);

  addLamps(B, bx, bz);
  if (kind === KIND_CITY && B.rng() < 0.4) addStreetTrees(B, bx, bz);
  if (j === 0) addMonorail(B, bx);

  const half = P / 2;
  return {
    i, j, kind,
    faces: B.faces.toArray(),
    props: B.props.toArray(),
    poles: new Float32Array(B.poles),
    lights: new Float32Array(B.lights),
    colliders: new Float32Array(B.colliders),
    cx: bx + half,
    cy: B.maxH / 2,
    cz: bz + half,
    radius: Math.sqrt(half * half * 2 + (B.maxH / 2) ** 2) + 2,
    dist: 0,
    lastUsed: 0,
  };
}

function buildCityLot(B: Builder, i: number, j: number, x0: number, z0: number, x1: number, z1: number): void {
  const { rng } = B;
  const scale = heightScale(i, j);
  const district = DISTRICTS[districtAt(i, j)];
  const layout = rng();
  const mx = x0 + (x1 - x0) * (0.35 + rng() * 0.3);
  const mz = z0 + (z1 - z0) * (0.35 + rng() * 0.3);
  const gap = 0.8;
  const rects: [number, number, number, number][] = [];
  if (layout < 0.2) rects.push([x0, z0, x1, z1]);
  else if (layout < 0.4) rects.push([x0, z0, mx - gap, z1], [mx + gap, z0, x1, z1]);
  else if (layout < 0.6) rects.push([x0, z0, x1, mz - gap], [x0, mz + gap, x1, z1]);
  else {
    rects.push(
      [x0, z0, mx - gap, mz - gap], [mx + gap, z0, x1, mz - gap],
      [x0, mz + gap, mx - gap, z1], [mx + gap, mz + gap, x1, z1],
    );
  }
  for (const [a, b, c, d] of rects) {
    const inset = rng() < 0.3 ? rng() * 2.5 : 0;
    building(B, a + inset, b + inset, c - inset, d - inset, x0, z0, x1, z1, scale, district);
  }
}

function building(
  B: Builder, x0: number, z0: number, x1: number, z1: number,
  lx0: number, lz0: number, lx1: number, lz1: number,
  scale: number, district: (typeof DISTRICTS)[number],
): void {
  const { rng, faces } = B;
  const floors = Math.max(2, Math.round((scale * (0.35 + rng() * 0.9)) / FLOOR_H));
  const h = floors * FLOOR_H + 0.6;
  const base = district.base[Math.floor(rng() * district.base.length)];
  const jit = 0.85 + rng() * 0.3;
  const r = base[0] * jit, g = base[1] * jit, b = base[2] * jit;
  const style = Math.floor(rng() * 4);
  const lit = Math.floor(rng() * 8);
  const warm = rng() < district.warm ? 1 : 0;
  const seed = style | (lit << 2) | (warm << 5) | (Math.floor(rng() * 4096) << 6);

  let tx0 = x0, tz0 = z0, tx1 = x1, tz1 = z1;
  if (h > 45 && rng() < 0.55) {
    const hb = Math.round((h * 0.62) / FLOOR_H) * FLOOR_H;
    faces.box(x0, 0, z0, x1, hb, z1, M_WALL, r, g, b, seed, M_ROOF);
    const ins = Math.min(4, (x1 - x0) * 0.18, (z1 - z0) * 0.18);
    tx0 = x0 + ins; tz0 = z0 + ins; tx1 = x1 - ins; tz1 = z1 - ins;
    faces.box(tx0, hb, tz0, tx1, h, tz1, M_WALL, r, g, b, seed, M_ROOF, BOX_DEFAULT);
  } else {
    faces.box(x0, 0, z0, x1, h, z1, M_WALL, r, g, b, seed, M_ROOF);
  }
  B.colliders.push(x0, z0, x1, z1);
  B.maxH = Math.max(B.maxH, h);

  if (h > 50 && rng() < 0.5) {
    const ax = (tx0 + tx1) / 2, az = (tz0 + tz1) / 2;
    const ah = 6 + rng() * 14;
    B.poles.push(ax, h, h + ah, az, 0.15, 125, 125, 135, G_PIPE, 0);
    B.lights.push(ax, h + ah, az, 255, 40, 40, 1);
    B.maxH = Math.max(B.maxH, h + ah);
  }
  if (rng() < 0.55) addSign(B, x0, z0, x1, z1, lx0, lz0, lx1, lz1);
}

function addSign(
  B: Builder, x0: number, z0: number, x1: number, z1: number,
  lx0: number, lz0: number, lx1: number, lz1: number,
): void {
  const { rng } = B;
  const sides: number[] = [];
  if (z0 - lz0 < 3) sides.push(0);
  if (lx1 - x1 < 3) sides.push(1);
  if (lz1 - z1 < 3) sides.push(2);
  if (x0 - lx0 < 3) sides.push(3);
  if (sides.length === 0) return;
  const side = sides[Math.floor(rng() * sides.length)];
  const wallLen = side % 2 === 0 ? x1 - x0 : z1 - z0;
  const maxChars = Math.floor((wallLen - 1 - 2 * SIGN_PAD) / SIGN_CHAR_W);
  const fits = SIGN_TEXTS.map((t, k) => (t.length <= maxChars ? k : -1)).filter((k) => k >= 0);
  if (fits.length === 0) return;
  const ti = fits[Math.floor(rng() * fits.length)];
  const W = SIGN_TEXTS[ti].length * SIGN_CHAR_W + 2 * SIGN_PAD;
  const y0 = 4 + rng() * 2.5, y1 = y0 + SIGN_H;
  const t0 = 0.25 + rng() * Math.max(0, wallLen - W - 0.5);
  const off = 0.3;
  const neon = NEON[Math.floor(rng() * NEON.length)];
  const seed = ti | (Math.floor(rng() * 8) << 8);
  const f = B.faces;
  switch (side) {
    case 0: f.wall(x0 + t0, z0 - off, x0 + t0 + W, z0 - off, y0, y1, 0, M_SIGN, neon[0], neon[1], neon[2], seed); break;
    case 1: f.wall(x1 + off, z0 + t0, x1 + off, z0 + t0 + W, y0, y1, 0, M_SIGN, neon[0], neon[1], neon[2], seed); break;
    case 2: f.wall(x1 - t0, z1 + off, x1 - t0 - W, z1 + off, y0, y1, 0, M_SIGN, neon[0], neon[1], neon[2], seed); break;
    default: f.wall(x0 - off, z1 - t0, x0 - off, z1 - t0 - W, y0, y1, 0, M_SIGN, neon[0], neon[1], neon[2], seed);
  }
}

function tree(B: Builder, x: number, z: number, s: number): void {
  const trunkH = 2.2 * s;
  B.poles.push(x, 0, trunkH + 0.3, z, 0.18 * s, 95, 70, 45, G_PIPE, M_TRUNK);
  const c = TREE_GREENS[Math.floor(B.rng() * TREE_GREENS.length)];
  const seed = Math.floor(B.rng() * 65536);
  const cw = 1.5 * s;
  B.props.box(x - cw, trunkH, z - cw, x + cw, trunkH + 2.2 * s, z + cw, M_LEAF, c[0], c[1], c[2], seed, M_LEAF, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  const tw = cw * 0.6;
  B.props.box(x - tw, trunkH + 2.2 * s, z - tw, x + tw, trunkH + 3.2 * s, z + tw, M_LEAF, c[0], c[1], c[2], seed + 1);
}

function buildPark(B: Builder, i: number, j: number, x0: number, z0: number, x1: number, z1: number): void {
  const pond = hasPond(i, j);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const step = (x1 - x0 - 8) / 3;
  for (let gx = 0; gx < 4; gx++) {
    for (let gz = 0; gz < 4; gz++) {
      const tx = x0 + 4 + gx * step + (B.rng() - 0.5) * 3;
      const tz = z0 + 4 + gz * step + (B.rng() - 0.5) * 3;
      if (pond && Math.hypot(tx - cx, tz - cz) < 11) continue;
      if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3) continue;
      tree(B, tx, tz, 1 + B.rng() * 0.5);
    }
  }
  B.maxH = Math.max(B.maxH, 9);
}

function buildPlaza(B: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const { rng, faces } = B;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const top = 10 + rng() * 8;
  faces.box(cx - 3, 0, cz - 3, cx + 3, 1.2, cz + 3, M_CONCRETE, 120, 115, 110, 0);
  faces.box(cx - 0.9, 1.2, cz - 0.9, cx + 0.9, top, cz + 0.9, M_CONCRETE, 145, 140, 132, 0);
  B.lights.push(cx, top + 0.4, cz, 120, 220, 255, 0);
  B.colliders.push(cx - 3, cz - 3, cx + 3, cz + 3);
  const kioskSeed = 3 | (7 << 2) | (1 << 5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const kx = cx + sx * 12, kz = cz + sz * 12;
    faces.box(kx - 1.6, 0, kz - 1.6, kx + 1.6, 2.9, kz + 1.6, M_WALL, 140, 120, 150, kioskSeed | (Math.floor(rng() * 4096) << 6), M_ROOF);
    B.colliders.push(kx - 1.6, kz - 1.6, kx + 1.6, kz + 1.6);
    B.props.box(kx - sx * 5 - 1, 0, kz - 0.25, kx - sx * 5 + 1, 0.5, kz + 0.25, M_CONCRETE, 110, 100, 90, 0);
  }
  B.maxH = Math.max(B.maxH, top + 1);
}

function addLamps(B: Builder, bx: number, bz: number): void {
  const lamp = (x: number, z: number) => {
    B.poles.push(x, 0, LAMP_H, z, 0.09, 72, 76, 86, G_PIPE, M_CONCRETE);
    B.props.box(x - 0.32, LAMP_H, z - 0.32, x + 0.32, LAMP_H + 0.22, z + 0.32, M_LAMP, 255, 220, 150, 0, M_LAMP, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
    B.lights.push(x, LAMP_H - 0.05, z, 255, 214, 140, 0);
  };
  for (let k = 1; k <= 3; k++) {
    const a = k * LAMP_SPACING;
    lamp(bx + a, bz + LAMP_OFF);
    lamp(bx + P - LAMP_OFF, bz + a);
    lamp(bx + a, bz + P - LAMP_OFF);
    lamp(bx + LAMP_OFF, bz + a);
  }
}

function addStreetTrees(B: Builder, bx: number, bz: number): void {
  for (const a of [24, 40]) {
    tree(B, bx + a, bz + TREE_OFF, 0.8);
    tree(B, bx + P - TREE_OFF, bz + a, 0.8);
    tree(B, bx + a, bz + P - TREE_OFF, 0.8);
    tree(B, bx + TREE_OFF, bz + a, 0.8);
  }
}

function addMonorail(B: Builder, bx: number): void {
  B.faces.box(bx, RAIL_Y, -1.2, bx + P, RAIL_Y + 1.2, 1.2, M_RAIL, 96, 102, 116, 0, M_RAIL, BOX_S | BOX_N | BOX_TOP | BOX_BOTTOM);
  for (const px of [bx + 16, bx + 48]) {
    B.faces.box(px - 0.6, 0, -0.6, px + 0.6, RAIL_Y, 0.6, M_RAIL, 80, 84, 96, 0, M_RAIL, BOX_SIDES);
    B.colliders.push(px - 0.6, -0.6, px + 0.6, 0.6);
  }
  B.maxH = Math.max(B.maxH, RAIL_Y + 2);
}
