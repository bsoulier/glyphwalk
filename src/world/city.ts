import type { Camera } from '../render/camera';
import { sphereVisible } from '../render/raster';
import { M_RAIL } from '../render/materials';
import { hash3, mulberry32 } from '../core/hash';
import { type Builder, type Rect, streetLamps } from './build';
import { BOX_E, BOX_N, BOX_S, BOX_SIDES, BOX_BOTTOM, BOX_TOP, BOX_W, FaceList } from './faces';
import {
  HOODS, H_DOCKS, H_DOWNTOWN, H_ESTATES, H_JAPAN, H_MEDINA, H_OLDTOWN, H_PARIS, H_SEAFRONT, H_SUBURB, hoodAt,
} from './hoods';
import { LANDMARK_I, LANDMARK_J, LOT_EDGE, P, RAIL_Y, blockKind, worldSeed } from './layout';
import { buildDocks } from './styles/docks';
import { buildDowntown } from './styles/downtown';
import { buildJapantown } from './styles/japantown';
import { buildOldTown } from './styles/oldtown';
import { buildParis } from './styles/paris';
import { buildSuburb } from './styles/suburb';
import { buildEstates } from './styles/estates';
import { buildSeafront } from './styles/seafront';
import { buildMedina } from './styles/medina';
import type { Interior } from './interior';
import { CURVE_R, LOOP_BLOCKS, LOOP_IN } from './loop';

/** x, y0, y1, z, halfWidth, r, g, b, glyph, material */
export const POLE_STRIDE = 10;
/** x, y, z, r, g, b, kind (see LIGHT_* in build.ts) */
export const LIGHT_STRIDE = 7;

export interface Block {
  i: number;
  j: number;
  kind: number;
  hood: number;
  faces: Float32Array;
  props: Float32Array;
  poles: Float32Array;
  lights: Float32Array;
  colliders: Float32Array;
  levelColliders: Float32Array;
  interiors: Interior[];
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  dist: number;
  lastUsed: number;
}

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

  /** Generate everything in range on the next frame (used after a teleport so the area pops in at once). */
  prime(): void {
    this.warm = false;
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

  /** The Glyph Tower's block, kept in the cache even when it is far outside the draw distance. */
  landmark(): Block {
    const b = this.get(LANDMARK_I, LANDMARK_J);
    b.lastUsed = this.frame;
    return b;
  }

  /** Cached block, without generating it (for overlays that must not stall on unseen areas). */
  peek(i: number, j: number): Block | undefined {
    return this.cache.get(key(i, j));
  }

  /** `feet` is the height the walker stands at, so furniture only blocks the storey it sits on. */
  collides(x: number, z: number, r: number, feet = 0): boolean {
    const i0 = Math.floor((x - r) / P), i1 = Math.floor((x + r) / P);
    const j0 = Math.floor((z - r) / P), j1 = Math.floor((z + r) / P);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = this.get(i, j);
        const c = b.colliders;
        for (let o = 0; o < c.length; o += 4) {
          if (x + r > c[o] && x - r < c[o + 2] && z + r > c[o + 1] && z - r < c[o + 3]) return true;
        }
        const l = b.levelColliders;
        for (let o = 0; o < l.length; o += 6) {
          if (feet >= l[o + 4] && feet < l[o + 5] && x + r > l[o] && x - r < l[o + 2] && z + r > l[o + 1] && z - r < l[o + 3]) return true;
        }
      }
    }
    return false;
  }

  interiorAt(x: number, z: number): Interior | null {
    for (const it of this.get(Math.floor(x / P), Math.floor(z / P)).interiors) {
      if (x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1) return it;
    }
    return null;
  }

  /** The building whose street door is within `r` metres of (x, z). */
  doorNear(x: number, z: number, r: number): Interior | null {
    for (const it of this.get(Math.floor(x / P), Math.floor(z / P)).interiors) {
      const dx = x - it.door.x, dz = z - it.door.z;
      if (dx * dx + dz * dz < r * r) return it;
    }
    return null;
  }
}

export function generateBlock(i: number, j: number): Block {
  const bx = i * P, bz = j * P;
  const kind = blockKind(i, j);
  const hood = hoodAt(i, j);
  const B: Builder = {
    rng: mulberry32(hash3(i, j, worldSeed)),
    alt: mulberry32(hash3(i, j, worldSeed ^ 0xd00d)),
    hood,
    faces: new FaceList(),
    props: new FaceList(),
    poles: [],
    lights: [],
    colliders: [],
    levelColliders: [],
    interiors: [],
    maxH: 7,
  };
  const lot: Rect = {
    x0: bx + LOT_EDGE + 0.5, z0: bz + LOT_EDGE + 0.5,
    x1: bx + P - LOT_EDGE - 0.5, z1: bz + P - LOT_EDGE - 0.5,
  };

  switch (hood) {
    case H_JAPAN: buildJapantown(B, i, j, kind, lot); break;
    case H_OLDTOWN: buildOldTown(B, i, j, kind, lot); break;
    case H_PARIS: buildParis(B, i, j, kind, lot); break;
    case H_DOCKS: buildDocks(B, i, j, kind, lot); break;
    case H_SUBURB: buildSuburb(B, i, j, kind, lot); break;
    case H_ESTATES: buildEstates(B, i, j, kind, lot); break;
    case H_SEAFRONT: buildSeafront(B, i, j, kind, lot); break;
    case H_MEDINA: buildMedina(B, i, j, kind, lot); break;
    case H_DOWNTOWN:
    default: buildDowntown(B, i, j, kind, lot);
  }
  streetLamps(B, bx, bz, HOODS[hood]);
  addMonorail(B, i, j, bx, bz);

  const half = P / 2;
  return {
    i, j, kind, hood,
    faces: B.faces.toArray(),
    props: B.props.toArray(),
    poles: new Float32Array(B.poles),
    lights: new Float32Array(B.lights),
    colliders: new Float32Array(B.colliders),
    levelColliders: new Float32Array(B.levelColliders),
    interiors: B.interiors,
    cx: bx + half,
    cy: B.maxH / 2,
    cz: bz + half,
    radius: Math.sqrt(half * half * 2 + (B.maxH / 2) ** 2) + 2,
    dist: 0,
    lastUsed: 0,
  };
}

const BEAM_W = 1.2;

function pillar(B: Builder, x: number, z: number): void {
  B.faces.box(x - 0.6, 0, z - 0.6, x + 0.6, RAIL_Y, z + 0.6, M_RAIL, 80, 84, 96, 0, M_RAIL, BOX_SIDES);
  B.colliders.push(x - 0.6, z - 0.6, x + 0.6, z + 0.6);
}

/** Quarter circle of beam round (cx, cz), from angle t0 to t1, in short straight pieces. */
function arcBeam(B: Builder, cx: number, cz: number, t0: number, t1: number): void {
  const n = 8, ri = CURVE_R - BEAM_W, ro = CURVE_R + BEAM_W, y0 = RAIL_Y, y1 = RAIL_Y + BEAM_W;
  for (let k = 0; k < n; k++) {
    const a = t0 + ((t1 - t0) * k) / n, b = t0 + ((t1 - t0) * (k + 1)) / n;
    const oax = cx + ro * Math.cos(a), oaz = cz + ro * Math.sin(a), obx = cx + ro * Math.cos(b), obz = cz + ro * Math.sin(b);
    const iax = cx + ri * Math.cos(a), iaz = cz + ri * Math.sin(a), ibx = cx + ri * Math.cos(b), ibz = cz + ri * Math.sin(b);
    B.faces.wall(oax, oaz, obx, obz, y0, y1, y0, M_RAIL, 96, 102, 116, 0);
    B.faces.wall(ibx, ibz, iax, iaz, y0, y1, y0, M_RAIL, 96, 102, 116, 0);
    B.faces.poly(iax, y1, iaz, oax, y1, oaz, obx, y1, obz, ibx, y1, ibz, 0, 0, 2, 0, 2, 2, 0, 2, M_RAIL, 96, 102, 116, 0);
    B.faces.poly(ibx, y0, ibz, obx, y0, obz, oax, y0, oaz, iax, y0, iaz, 0, 0, 2, 0, 2, 2, 0, 2, M_RAIL, 96, 102, 116, 0);
  }
}

/**
 * The monorail loops (world/loop.ts) run over the roads one block inside each cell's edge. A block carries
 * the stretch along its south and west edges, and the curve if it sits inside a corner of its loop.
 */
function addMonorail(B: Builder, i: number, j: number, bx: number, bz: number): void {
  const li = ((i % LOOP_BLOCKS) + LOOP_BLOCKS) % LOOP_BLOCKS, lj = ((j % LOOP_BLOCKS) + LOOP_BLOCKS) % LOOP_BLOCKS;
  const lo = LOOP_IN, hi = LOOP_BLOCKS - LOOP_IN;
  let any = false;
  if ((lj === lo || lj === hi) && li >= lo && li < hi) {
    const x0 = li === lo ? bx + CURVE_R : bx, x1 = li === hi - 1 ? bx + P - CURVE_R : bx + P;
    B.faces.box(x0, RAIL_Y, bz - BEAM_W, x1, RAIL_Y + BEAM_W, bz + BEAM_W, M_RAIL, 96, 102, 116, 0, M_RAIL, BOX_S | BOX_N | BOX_TOP | BOX_BOTTOM);
    for (const px of [bx + 16, bx + 48]) if (px >= x0 && px <= x1) pillar(B, px, bz);
    any = true;
  }
  if ((li === lo || li === hi) && lj >= lo && lj < hi) {
    const z0 = lj === lo ? bz + CURVE_R : bz, z1 = lj === hi - 1 ? bz + P - CURVE_R : bz + P;
    B.faces.box(bx - BEAM_W, RAIL_Y, z0, bx + BEAM_W, RAIL_Y + BEAM_W, z1, M_RAIL, 96, 102, 116, 0, M_RAIL, BOX_E | BOX_W | BOX_TOP | BOX_BOTTOM);
    for (const pz of [bz + 16, bz + 48]) if (pz >= z0 && pz <= z1) pillar(B, bx, pz);
    any = true;
  }
  const east = li === hi - 1, west = li === lo, south = lj === lo, north = lj === hi - 1;
  const R = CURVE_R, Q = Math.PI / 2;
  if (west && south) arcBeam(B, bx + R, bz + R, 2 * Q, 3 * Q);
  if (east && south) arcBeam(B, bx + P - R, bz + R, 3 * Q, 4 * Q);
  if (east && north) arcBeam(B, bx + P - R, bz + P - R, 0, Q);
  if (west && north) arcBeam(B, bx + R, bz + P - R, Q, 2 * Q);
  if (any || ((west || east) && (south || north))) B.maxH = Math.max(B.maxH, RAIL_Y + 2);
}
