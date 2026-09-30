import { F_GLASS, F_METAL, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_CORRUGATED, M_ROOF, M_TILES, M_WALL } from '../../render/materials';
import {
  type Builder, type Rect, G_PIPE, LIGHT_BLINK,
  gableRoof, jitter, pick, sideOf, streetSides, wallSign,
} from '../build';
import { BOX_DEFAULT, BOX_SIDES, BOX_TOP } from '../faces';
import { CONTROL, HALL } from '../furniture';
import { enterable } from '../interior';
import { KIND_CITY } from '../layout';
import { DOCK_SIGNS, SIGNS_DOCKS, TEXT_OFFICE, type RGB } from '../signs';

const METAL: readonly RGB[] = [[92, 102, 112], [122, 74, 58], [72, 98, 88], [140, 132, 112], [64, 74, 94]];
const CONTAINERS: readonly RGB[] = [[40, 90, 170], [170, 52, 42], [220, 120, 40], [62, 130, 72], [122, 122, 128], [200, 170, 50]];
const STACK_BRICK: RGB = [120, 56, 42];
const GLAZING: RGB = [70, 90, 110];

export function buildDocks(B: Builder, _i: number, _j: number, kind: number, lot: Rect): void {
  if (kind !== KIND_CITY) return containerYard(B, lot);
  const { rng } = B;
  const { x0, z0, x1, z1 } = lot;
  if (rng() < 0.45) warehouse(B, lot, lot);
  else if (rng() < 0.5) {
    const mx = (x0 + x1) / 2;
    warehouse(B, { x0, z0, x1: mx - 1.5, z1 }, lot);
    warehouse(B, { x0: mx + 1.5, z0, x1, z1 }, lot);
  } else {
    const mz = (z0 + z1) / 2;
    warehouse(B, { x0, z0, x1, z1: mz - 1.5 }, lot);
    containerYard(B, { x0, z0: mz + 1.5, x1, z1 });
  }
  if (rng() < 0.35) {
    const sx = x1 - 3, sz = z1 - 3, sh = 26 + rng() * 20;
    B.faces.box(sx - 1.1, 0, sz - 1.1, sx + 1.1, sh, sz + 1.1, M_CONCRETE, STACK_BRICK[0], STACK_BRICK[1], STACK_BRICK[2], 0);
    B.lights.push(sx, sh + 0.3, sz, 255, 40, 40, LIGHT_BLINK);
    B.colliders.push(sx - 1.1, sz - 1.1, sx + 1.1, sz + 1.1);
    B.maxH = Math.max(B.maxH, sh + 1);
  }
}

function warehouse(B: Builder, r: Rect, lot: Rect): void {
  const { rng, faces } = B;
  const h = (rng() < 0.5 ? 2 : 3) * FLOOR_H[F_METAL];
  const c = jitter(rng, pick(rng, METAL), 0.1);
  const id = Math.floor(rng() * 4096);
  const seed = facadeSeed(F_METAL, 0, Math.floor(rng() * 8), 1, id);
  const street = streetSides(r, lot);
  if (street.length > 0 && B.alt() < 0.5) {
    enterable(B, {
      rect: r, side: street[Math.floor(B.alt() * street.length)], h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES,
      doorW: 1.6, label: 'WAREHOUSE', sign: TEXT_OFFICE, open: false, canopy: true, programs: [HALL, CONTROL, CONTROL], text: -1, entrance: { kind: 'hinged', color: [96, 104, 110] },
    });
  } else {
    faces.box(r.x0, 0, r.z0, r.x1, h, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
    B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  }
  const roll = rng();
  if (roll < 0.45) sawtooth(B, r, h, c, seed, facadeSeed(F_GLASS, 0, 3, 1, id));
  else if (roll < 0.8) {
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    gableRoof(faces, r, h, 2.4, alongX, 0.3, M_TILES, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 0, M_WALL, c, seed);
  } else faces.box(r.x0, h - 0.01, r.z0, r.x1, h, r.z1, M_ROOF, c[0], c[1], c[2], 0, M_ROOF, BOX_TOP);
  B.maxH = Math.max(B.maxH, h + 3);

  if (rng() < 0.25) waterTower(B, r.x0 + 4, r.z0 + 4, h + 2.4);
  const sides = streetSides(r, lot);
  if (sides.length > 0 && rng() < 0.35) wallSign(B, sideOf(r, pick(rng, sides)), SIGNS_DOCKS, DOCK_SIGNS, h - 4, 2);
}

/** Sawtooth roof: sloped metal teeth along x, each with a vertical glazed face looking +x. */
function sawtooth(B: Builder, r: Rect, h: number, c: RGB, wallSeed: number, glassSeed: number): void {
  const L = B.faces;
  const n = Math.max(2, Math.round((r.x1 - r.x0) / 6));
  const tw = (r.x1 - r.x0) / n, th = 2.4, D = r.z1 - r.z0;
  const S = Math.hypot(tw, th);
  const [cr, cg, cb] = [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7];
  for (let k = 0; k < n; k++) {
    const xa = r.x0 + k * tw, xb = xa + tw, yt = h + th;
    L.poly(xa, h, r.z1, xa, h, r.z0, xb, yt, r.z0, xb, yt, r.z1, 0, 0, D, 0, D, S, 0, S, M_TILES, cr, cg, cb, 0);
    L.wall(xb, r.z0, xb, r.z1, h, yt, h, M_WALL, GLAZING[0], GLAZING[1], GLAZING[2], glassSeed);
    L.poly(xa, h, r.z0, xb, h, r.z0, xb, yt, r.z0, xb, yt, r.z0, 0, h, tw, h, tw, yt, tw, yt, M_WALL, c[0], c[1], c[2], wallSeed);
    L.poly(xb, h, r.z1, xa, h, r.z1, xb, yt, r.z1, xb, yt, r.z1, 0, h, tw, h, 0, yt, 0, yt, M_WALL, c[0], c[1], c[2], wallSeed);
  }
}

function waterTower(B: Builder, x: number, z: number, y: number): void {
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    B.poles.push(x + sx * 1.2, y - 2.4, y, z + sz * 1.2, 0.08, 90, 80, 70, G_PIPE, 0);
  }
  B.props.box(x - 1.6, y, z - 1.6, x + 1.6, y + 2.8, z + 1.6, M_CORRUGATED, 120, 96, 72, 0, M_ROOF, BOX_DEFAULT);
  B.maxH = Math.max(B.maxH, y + 3);
}

/** Rows of shipping containers stacked one or two high, with aisles for the (imaginary) straddle carriers. */
function containerYard(B: Builder, r: Rect): void {
  const { rng, faces } = B;
  const len = 12.2, wid = 2.45, hgt = 2.6;
  for (let z = r.z0 + 1.5, row = 0; z + wid < r.z1 - 1.5; z += wid + 0.3, row++) {
    if (row % 3 === 2) { z += 3; continue; }
    for (let x = r.x0 + 1; x + len < r.x1 - 1; x += len + 0.4) {
      if (rng() < 0.15) continue;
      const stack = rng() < 0.45 ? 2 : 1;
      for (let s = 0; s < stack; s++) {
        const c = pick(rng, CONTAINERS);
        faces.box(x, s * hgt, z, x + len, (s + 1) * hgt, z + wid, M_CORRUGATED, c[0], c[1], c[2], 0, M_CORRUGATED);
      }
      B.colliders.push(x, z, x + len, z + wid);
      B.maxH = Math.max(B.maxH, stack * hgt);
    }
  }
}
