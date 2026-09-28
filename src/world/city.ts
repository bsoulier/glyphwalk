import type { Camera } from '../render/camera';
import { sphereVisible } from '../render/raster';
import { M_RAIL } from '../render/materials';
import { hash3, mulberry32 } from '../core/hash';
import { type Builder, type Rect, streetLamps } from './build';
import { BOX_N, BOX_S, BOX_SIDES, BOX_BOTTOM, BOX_TOP, FaceList } from './faces';
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
import { isRailRow } from './train';

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
  if (isRailRow(j)) addMonorail(B, bx, bz);

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

/** Beam over the centre line of the road along the block's south edge, on two pillars. */
function addMonorail(B: Builder, bx: number, bz: number): void {
  B.faces.box(bx, RAIL_Y, bz - 1.2, bx + P, RAIL_Y + 1.2, bz + 1.2, M_RAIL, 96, 102, 116, 0, M_RAIL, BOX_S | BOX_N | BOX_TOP | BOX_BOTTOM);
  for (const px of [bx + 16, bx + 48]) {
    B.faces.box(px - 0.6, 0, bz - 0.6, px + 0.6, RAIL_Y, bz + 0.6, M_RAIL, 80, 84, 96, 0, M_RAIL, BOX_SIDES);
    B.colliders.push(px - 0.6, bz - 0.6, px + 0.6, bz + 0.6);
  }
  B.maxH = Math.max(B.maxH, RAIL_Y + 2);
}
