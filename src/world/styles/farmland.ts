import { hash3 } from '../../core/hash';
import { F_SIDING, FLOOR_H, facadeSeed } from '../../render/facades';
import {
  M_CAR, M_CONCRETE, M_CORRUGATED, M_GLASS, M_LAMP, M_LEAF, M_PAINT, M_ROOF, M_TILES, M_TRUNK, M_WALL, M_WHEEL, M_WOOD,
} from '../../render/materials';
import {
  type Builder, type PlotFrame, G_PIPE, LIGHT_LAMP, TREE_ROUND, chimney, dome, flat, gableRoof, hipRoof, jitter, pick,
  plotFrame, tree,
} from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP, type FaceList } from '../faces';
import { CROP_HAY, CROP_PASTURE, FARM, FARM_FLIP, FARM_GRAIN, farmAt, fieldAt } from '../fields';
import { BEDROOM, LIVING } from '../furniture';
import { HOOD_BLOCKS, inCity, roadEW, roadNS } from '../hoods';
import { doorCentre, enterable } from '../interior';
import { P, worldSeed } from '../layout';
import type { RGB } from '../signs';

const POLE: RGB = [104, 80, 58];
const WIRE: RGB = [36, 36, 40];
const RAIL: RGB = [150, 132, 104];
const LEAVES: readonly RGB[] = [[46, 92, 42], [58, 104, 44], [40, 80, 40]];
const WHITE: RGB = [236, 234, 226];
const CLAPBOARD: readonly RGB[] = [WHITE, WHITE, WHITE, [232, 222, 180], [204, 210, 214], [222, 214, 196]];
const SHINGLES: readonly RGB[] = [[70, 70, 76], [96, 74, 58], [60, 66, 76], [120, 56, 46]];
const BRICK: RGB = [140, 72, 58];
const PATH: RGB = [176, 168, 150];
const BARN_RED: RGB = [150, 38, 30];
const BARN_GREY: RGB = [128, 118, 104];
const TIN: RGB = [150, 156, 162];
const STEEL: RGB = [178, 182, 188];
const STAVE: RGB = [194, 190, 180];
const HARVESTORE: RGB = [34, 58, 108];
const SHED: readonly RGB[] = [[168, 162, 150], [150, 156, 164], [120, 132, 118]];
const PICKUPS: readonly RGB[] = [[170, 34, 30], [226, 226, 228], [40, 60, 110], [118, 108, 94], [44, 44, 48]];
/** Tractor body and wheel hubs: green and yellow, or red and grey. */
const TRACTORS: readonly (readonly [RGB, RGB])[] = [[[46, 118, 48], [228, 196, 40]], [[182, 36, 28], [70, 70, 74]]];
/** Cattle: body and head. Holsteins also get a black saddle. */
const BREEDS: readonly (readonly [RGB, RGB])[] = [
  [[232, 230, 224], [30, 30, 32]], [[36, 34, 34], [36, 34, 34]], [[138, 66, 40], [232, 226, 214]],
];
const HOLSTEIN = 0;
const BLACK: RGB = [30, 30, 32];
const TYRE: RGB = [24, 24, 26];
/** Crowns are seen from beneath when you walk under them. */
const BOX_ALL = BOX_SIDES | BOX_TOP | BOX_BOTTOM;
/**
 * How far short of a crossing road's centre line a windbreak or a fence stops: past the asphalt (6 m for a
 * city street), the shoulder and the verge. A fence stops at the same distance it keeps from its own road,
 * so the fences round a pasture meet at the corner.
 */
const TREES_IN = 10;
const FENCE_IN = 9;

/**
 * A block of farmland. The crops are the ground painter's; what stands here is what lines the country
 * roads round each section: utility poles, now and then a windbreak of trees, fences round pasture, and
 * a lone tree or two out in the grass, with cattle grazing round it. About every other section has a
 * farmstead in one of its blocks instead. Tree crowns, barns and silos go in the block's faces rather
 * than its props, so they still stand on the horizon across the open fields.
 */
export function buildFarmland(B: Builder, i: number, j: number): void {
  const bx = i * P, bz = j * P;
  const crop = fieldAt(i, j) & 7;
  const farm = farmAt(i, j), front = farm < 0 ? -1 : farm & 3;
  // Roads along the block's south, north, west and east sides.
  const s = roadEW(j, i), n = roadEW(j + 1, i), w = roadNS(i, j), e = roadNS(i + 1, j);
  // Poles run on the east side of north-south roads and the north side of east-west ones.
  if (w && !inCity(i - 1, j)) poleLine(B, bx + 7, bz, true);
  if (s && !inCity(i, j - 1)) poleLine(B, bx, bz + 7, false);
  // Windbreaks along whole sides of a section, on the far side of the road from the poles, open in front of a farm.
  if (e && front !== 1 && !inCity(i + 1, j) && windbreak(i + 1, Math.floor(j / HOOD_BLOCKS), 0x3a1)) {
    treeRow(B, bx + P - 10, bz, true, s ? TREES_IN : 0, n ? P - TREES_IN : P);
  }
  if (n && front !== 2 && !inCity(i, j + 1) && windbreak(j + 1, Math.floor(i / HOOD_BLOCKS), 0x3a2)) {
    treeRow(B, bx, bz + P - 10, false, w ? TREES_IN : 0, e ? P - TREES_IN : P);
  }
  if (farm >= 0) {
    farmstead(B, i, j, farm);
    return;
  }
  if (crop === CROP_PASTURE) {
    const z0 = s ? FENCE_IN : 0, z1 = n ? P - FENCE_IN : P, x0 = w ? FENCE_IN : 0, x1 = e ? P - FENCE_IN : P;
    if (w) fence(B, bx + FENCE_IN, bz, true, z0, z1);
    if (e) fence(B, bx + P - FENCE_IN, bz, true, z0, z1);
    if (s) fence(B, bx, bz + FENCE_IN, false, x0, x1);
    if (n) fence(B, bx, bz + P - FENCE_IN, false, x0, x1);
  }
  let ox = -1e9, oz = -1e9;
  if ((crop === CROP_PASTURE || crop === CROP_HAY) && B.rng() < 0.6) {
    ox = bx + 18 + B.rng() * 28;
    oz = bz + 18 + B.rng() * 28;
    oak(B, ox, oz, 1.6 + B.rng() * 0.8);
  }
  if (crop === CROP_PASTURE) {
    const breed = Math.floor(B.rng() * BREEDS.length);
    for (let k = Math.floor(B.rng() * 5); k > 0; k--) {
      const x = bx + 14 + B.rng() * 36, z = bz + 14 + B.rng() * 36;
      const alongX = B.rng() < 0.5, dir = B.rng() < 0.5 ? -1 : 1, grazing = B.rng() < 0.6;
      if (Math.hypot(x - ox, z - oz) > 5) cow(B, x, z, alongX, dir, breed, grazing);
    }
  }
}

function windbreak(line: number, section: number, salt: number): boolean {
  return hash3(line, section, worldSeed ^ salt) % 3 === 0;
}

/** Wooden utility poles every 32 m along a road, with a crossarm, and two wires strung the length of the block. */
function poleLine(B: Builder, x: number, z: number, alongZ: boolean): void {
  for (const t of [16, 48]) {
    const px = alongZ ? x : x + t, pz = alongZ ? z + t : z;
    B.poles.push(px, 0, 7.6, pz, 0.14, POLE[0], POLE[1], POLE[2], G_PIPE, M_TRUNK);
    if (alongZ) B.props.box(px - 0.85, 7.0, pz - 0.06, px + 0.85, 7.14, pz + 0.06, M_WOOD, POLE[0], POLE[1], POLE[2], 0);
    else B.props.box(px - 0.06, 7.0, pz - 0.85, px + 0.06, 7.14, pz + 0.85, M_WOOD, POLE[0], POLE[1], POLE[2], 0);
  }
  for (const s of [-0.7, 0.7]) {
    if (alongZ) B.props.box(x + s - 0.02, 7.14, z, x + s + 0.02, 7.18, z + P, M_PAINT, WIRE[0], WIRE[1], WIRE[2], 0);
    else B.props.box(x, 7.14, z + s - 0.02, x + P, 7.18, z + s + 0.02, M_PAINT, WIRE[0], WIRE[1], WIRE[2], 0);
  }
  B.maxH = Math.max(B.maxH, 8);
}

/** A windbreak: tall trees close together along the block from `a` to `b`, their crowns almost touching. */
function treeRow(B: Builder, x: number, z: number, alongZ: boolean, a: number, b: number): void {
  const poplar = B.rng() < 0.5;
  const c = LEAVES[Math.floor(B.rng() * LEAVES.length)];
  const w = poplar ? 1.5 : 2.8;
  for (let t = 3; t < P; t += 6.4) {
    // Every tree draws its numbers, left out or not, so what comes after it in the block stays where it was.
    const u = t + (B.rng() - 0.5) * 1.2;
    const h = (poplar ? 11 : 8) + B.rng() * 3;
    const seed = Math.floor(B.rng() * 65536);
    if (u < a || u > b) continue;
    const px = alongZ ? x : x + u, pz = alongZ ? z + u : z;
    B.poles.push(px, 0, 3, pz, 0.2, 90, 70, 50, G_PIPE, M_TRUNK);
    B.faces.box(px - w, 2.4, pz - w, px + w, h, pz + w, M_LEAF, c[0], c[1], c[2], seed, M_LEAF);
    B.maxH = Math.max(B.maxH, h);
  }
}

/** Post-and-rail fence along the block from `a` to `b`, with a post at an end that stops short of the block's side. */
function fence(B: Builder, x: number, z: number, alongZ: boolean, a: number, b: number): void {
  const post = (t: number): void => {
    B.poles.push(alongZ ? x : x + t, 0, 1.2, alongZ ? z + t : z, 0.06, RAIL[0], RAIL[1], RAIL[2], G_PIPE, M_WOOD);
  };
  for (let t = 1.5; t < P; t += 3) if (t > a && t < b) post(t);
  if (a > 0) post(a);
  if (b < P) post(b);
  for (const y of [0.55, 1.0]) {
    if (alongZ) B.props.box(x - 0.04, y, z + a, x + 0.04, y + 0.1, z + b, M_WOOD, RAIL[0], RAIL[1], RAIL[2], 0);
    else B.props.box(x + a, y, z - 0.04, x + b, y + 0.1, z + 0.04, M_WOOD, RAIL[0], RAIL[1], RAIL[2], 0);
  }
}

/** A broad lone tree in a meadow, its crown stepped in and out so it reads round rather than square. */
function oak(B: Builder, x: number, z: number, s: number): void {
  const c = LEAVES[Math.floor(B.rng() * LEAVES.length)];
  const seed = Math.floor(B.rng() * 65536);
  B.poles.push(x, 0, 3.0 * s, z, 0.26 * s, 90, 68, 46, G_PIPE, M_TRUNK);
  for (const [hw, y0, y1, k] of [[1.7, 2.3, 3.1, 0], [2.3, 3.0, 4.3, 1], [1.5, 4.2, 5.1, 2]]) {
    B.faces.box(x - hw * s, y0 * s, z - hw * s, x + hw * s, y1 * s, z + hw * s, M_LEAF, c[0], c[1], c[2], seed + k, M_LEAF, BOX_ALL);
  }
  B.maxH = Math.max(B.maxH, 5.1 * s);
  B.colliders.push(x - 0.35 * s, z - 0.35 * s, x + 0.35 * s, z + 0.35 * s);
}

/** A cow, pointing along x or z (`dir` +-1), head down in the grass or up looking round. */
function cow(B: Builder, x: number, z: number, alongX: boolean, dir: number, breed: number, grazing: boolean): void {
  const [body, head] = BREEDS[breed];
  const box = (a0: number, a1: number, w: number, y0: number, y1: number, c: RGB): void => {
    const p = x + (alongX ? a0 * dir : -w), q = z + (alongX ? -w : a0 * dir);
    const r = x + (alongX ? a1 * dir : w), t = z + (alongX ? w : a1 * dir);
    B.props.box(Math.min(p, r), y0, Math.min(q, t), Math.max(p, r), y1, Math.max(q, t), M_PAINT, c[0], c[1], c[2], 0);
  };
  box(-1, 1, 0.42, 0.72, 1.42, body);
  if (breed === HOLSTEIN) box(-0.45, 0.2, 0.44, 0.9, 1.44, BLACK);
  if (grazing) box(0.95, 1.45, 0.2, 0.25, 0.8, head);
  else box(1.0, 1.5, 0.2, 1.1, 1.6, head);
  for (const a of [-0.8, 0.8]) {
    for (const w of [-0.3, 0.3]) {
      B.poles.push(x + (alongX ? a * dir : w), 0, 0.74, z + (alongX ? w : a * dir), 0.07, body[0] * 0.8, body[1] * 0.8, body[2] * 0.8, G_PIPE, M_PAINT);
    }
  }
  B.colliders.push(x - (alongX ? 1 : 0.42), z - (alongX ? 0.42 : 1), x + (alongX ? 1 : 0.42), z + (alongX ? 0.42 : 1));
}

type V3 = readonly [number, number, number];

/**
 * Planar quad in a plot frame, corners [u, y, d] in the order bottom-left, bottom-right, top-right, top-left
 * as seen from outside (a triangle repeats its apex). Textures run in metres along the bottom edge and up.
 */
function quad(L: FaceList, f: PlotFrame, a: V3, b: V3, c: V3, d: V3, mat: number, col: RGB, seed: number): void {
  const [ax, az] = f.pt(a[0], a[2]), [bx, bz] = f.pt(b[0], b[2]), [cx, cz] = f.pt(c[0], c[2]), [dx, dz] = f.pt(d[0], d[2]);
  let ex = bx - ax, ey = b[1] - a[1], ez = bz - az;
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;
  let gx = dx - ax, gy = d[1] - a[1], gz = dz - az;
  const k = gx * ex + gy * ey + gz * ez;
  gx -= k * ex; gy -= k * ey; gz -= k * ez;
  const gl = Math.hypot(gx, gy, gz) || 1;
  gx /= gl; gy /= gl; gz /= gl;
  const s = (x: number, y: number, z: number): number => (x - ax) * ex + (y - a[1]) * ey + (z - az) * ez;
  const t = (x: number, y: number, z: number): number => (x - ax) * gx + (y - a[1]) * gy + (z - az) * gz + a[1];
  L.poly(
    ax, a[1], az, bx, b[1], bz, cx, c[1], cz, dx, d[1], dz,
    0, a[1], s(bx, b[1], bz), t(bx, b[1], bz), s(cx, c[1], cz), t(cx, c[1], cz), s(dx, d[1], dz), t(dx, d[1], dz),
    mat, col[0], col[1], col[2], seed,
  );
}

/** Upright cylinder of `n` sides, in the faces so it stands on the horizon, with a square collider inside it. */
function cylinder(B: Builder, x: number, z: number, r: number, y0: number, y1: number, n: number, mat: number, c: RGB): void {
  for (let s = 0; s < n; s++) {
    const t0 = (s / n) * Math.PI * 2, t1 = ((s + 1) / n) * Math.PI * 2;
    B.faces.wall(x + r * Math.cos(t0), z + r * Math.sin(t0), x + r * Math.cos(t1), z + r * Math.sin(t1), y0, y1, y0, mat, c[0], c[1], c[2], 0);
  }
  B.colliders.push(x - r * 0.8, z - r * 0.8, x + r * 0.8, z + r * 0.8);
  B.maxH = Math.max(B.maxH, y1);
}

/** Conical roof of a grain bin, from radius `r` at `y` up to a point `rise` above it. */
function cone(B: Builder, x: number, z: number, r: number, y: number, rise: number, n: number, mat: number, c: RGB): void {
  const slant = Math.hypot(r, rise), w = (2 * Math.PI * r) / n;
  for (let s = 0; s < n; s++) {
    const t0 = (s / n) * Math.PI * 2, t1 = ((s + 1) / n) * Math.PI * 2;
    B.faces.poly(
      x + r * Math.cos(t0), y, z + r * Math.sin(t0), x + r * Math.cos(t1), y, z + r * Math.sin(t1), x, y + rise, z, x, y + rise, z,
      0, 0, w, 0, w / 2, slant, w / 2, slant, mat, c[0], c[1], c[2], 0,
    );
  }
  B.maxH = Math.max(B.maxH, y + rise);
}

/** Post-and-rail fence in a plot frame, straight from (u0, d0) to (u1, d1), that stock and walkers do not pass. */
function rails(B: Builder, f: PlotFrame, u0: number, d0: number, u1: number, d1: number): void {
  const [ax, az] = f.pt(u0, d0), [bx, bz] = f.pt(u1, d1);
  const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 3));
  for (let k = 0; k <= n; k++) {
    B.poles.push(ax + ((bx - ax) * k) / n, 0, 1.2, az + ((bz - az) * k) / n, 0.06, RAIL[0], RAIL[1], RAIL[2], G_PIPE, M_WOOD);
  }
  const x0 = Math.min(ax, bx) - 0.04, x1 = Math.max(ax, bx) + 0.04, z0 = Math.min(az, bz) - 0.04, z1 = Math.max(az, bz) + 0.04;
  for (const y of [0.55, 1.0]) B.props.box(x0, y, z0, x1, y + 0.1, z1, M_WOOD, RAIL[0], RAIL[1], RAIL[2], 0);
  B.colliders.push(x0, z0, x1, z1);
}

/**
 * Box of a vehicle standing at (u, d) in a plot frame: `a` along it (forward is towards the road), `c` across.
 * Vehicles on a farm all point at the road, ready to drive out.
 */
function part(
  B: Builder, f: PlotFrame, u: number, d: number, a0: number, a1: number, c0: number, c1: number,
  y0: number, y1: number, mat: number, col: RGB, mask = BOX_SIDES | BOX_TOP,
): void {
  const r = f.rect(u + c0, d - a0, u + c1, d - a1);
  B.props.box(r.x0, y0, r.z0, r.x1, y1, r.z1, mat, col[0], col[1], col[2], 0, mat, mask);
}

function pickup(B: Builder, f: PlotFrame, u: number, d: number, c: RGB): void {
  part(B, f, u, d, -2.6, 2.6, -0.95, 0.95, 0.35, 1.05, M_CAR, c);
  part(B, f, u, d, -0.4, 1.3, -0.9, 0.9, 1.05, 1.8, M_GLASS, c);
  for (const s of [-1, 1]) part(B, f, u, d, -2.6, -0.4, s * 0.85, s * 0.95, 1.05, 1.35, M_CAR, c);
  part(B, f, u, d, -2.6, -2.5, -0.95, 0.95, 1.05, 1.35, M_CAR, c);
  for (const a of [-1.7, 1.7]) for (const s of [-1, 1]) part(B, f, u, d, a - 0.36, a + 0.36, s * 0.9, s * 0.99, 0, 0.7, M_WHEEL, TYRE, BOX_SIDES);
  const r = f.rect(u - 0.95, d - 2.6, u + 0.95, d + 2.6);
  B.colliders.push(r.x0, r.z0, r.x1, r.z1);
}

/** A farm tractor: big rear wheels, small front ones, a long bonnet and a glass cab. */
function tractor(B: Builder, f: PlotFrame, u: number, d: number, body: RGB, hub: RGB): void {
  for (const s of [-1, 1]) {
    part(B, f, u, d, -1.6, 0, s * 0.75, s * 1.25, 0, 1.6, M_WHEEL, TYRE, BOX_SIDES | BOX_TOP);
    part(B, f, u, d, -1.05, -0.55, s * 1.25, s * 1.3, 0.55, 1.05, M_PAINT, hub);
    part(B, f, u, d, 1.5, 2.2, s * 0.55, s * 0.85, 0, 0.8, M_WHEEL, TYRE, BOX_SIDES | BOX_TOP);
  }
  part(B, f, u, d, -0.3, 2.5, -0.45, 0.45, 0.7, 1.55, M_PAINT, body);
  part(B, f, u, d, -1.4, 0.2, -0.7, 0.7, 1.2, 2.9, M_GLASS, body);
  part(B, f, u, d, -1.5, 0.3, -0.8, 0.8, 2.9, 3.05, M_PAINT, body, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  const [x, z] = f.pt(u + 0.3, d - 1.8);
  B.poles.push(x, 1.55, 2.6, z, 0.05, 40, 40, 42, G_PIPE, M_PAINT);
  const r = f.rect(u - 1.3, d - 2.5, u + 1.3, d + 1.6);
  B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  B.maxH = Math.max(B.maxH, 3.1);
}

/**
 * A gambrel barn centred on `uc`, its ridge running away from the road and its big doors in the gable end
 * facing the yard: steep lower roof slopes, shallow upper ones, white trim and a cupola on the ridge.
 */
function barn(B: Builder, f: PlotFrame, uc: number, d0: number, d1: number, c: RGB, roofMat: number, rc: RGB): void {
  const hw = 7, wh = 5.2, knee = wh + 3.8, ridge = wh + 5.8, k = 4.2, a = d0 - 0.35, b = d1 + 0.35;
  const L = B.faces;
  const r = f.rect(uc - hw, d0, uc + hw, d1);
  L.box(r.x0, 0, r.z0, r.x1, wh, r.z1, M_WOOD, c[0], c[1], c[2], 0, M_ROOF, BOX_SIDES);
  B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  quad(L, f, [uc - hw, wh, b], [uc - hw, wh, a], [uc - k, knee, a], [uc - k, knee, b], roofMat, rc, 0);
  quad(L, f, [uc - k, knee, b], [uc - k, knee, a], [uc, ridge, a], [uc, ridge, b], roofMat, rc, 0);
  quad(L, f, [uc + hw, wh, a], [uc + hw, wh, b], [uc + k, knee, b], [uc + k, knee, a], roofMat, rc, 0);
  quad(L, f, [uc + k, knee, a], [uc + k, knee, b], [uc, ridge, b], [uc, ridge, a], roofMat, rc, 0);
  quad(L, f, [uc - hw, wh, d0], [uc + hw, wh, d0], [uc + k, knee, d0], [uc - k, knee, d0], M_WOOD, c, 0);
  quad(L, f, [uc - k, knee, d0], [uc + k, knee, d0], [uc, ridge, d0], [uc, ridge, d0], M_WOOD, c, 0);
  quad(L, f, [uc + hw, wh, d1], [uc - hw, wh, d1], [uc - k, knee, d1], [uc + k, knee, d1], M_WOOD, c, 0);
  quad(L, f, [uc + k, knee, d1], [uc - k, knee, d1], [uc, ridge, d1], [uc, ridge, d1], M_WOOD, c, 0);

  // Big doors, each leaf with a white X, and the hay loft door above them.
  const T = B.props, dw = 2.8, dh = 4.2, dd = d0 - 0.05, de = d0 - 0.09, tw = 0.16;
  const dark: RGB = [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
  quad(T, f, [uc - dw, 0, dd], [uc + dw, 0, dd], [uc + dw, dh, dd], [uc - dw, dh, dd], M_WOOD, dark, 0);
  for (const [l0, l1] of [[uc - dw, uc], [uc, uc + dw]]) {
    quad(T, f, [l0, 0, de], [l0 + tw, 0, de], [l1, dh, de], [l1 - tw, dh, de], M_PAINT, WHITE, 0);
    quad(T, f, [l1 - tw, 0, de], [l1, 0, de], [l0 + tw, dh, de], [l0, dh, de], M_PAINT, WHITE, 0);
  }
  quad(T, f, [uc - 1.1, 6.0, dd], [uc + 1.1, 6.0, dd], [uc + 1.1, 7.9, dd], [uc - 1.1, 7.9, dd], M_WOOD, [60, 32, 28], 0);
  const trim = (u0: number, u1: number, y0: number, y1: number): void => {
    const t = f.rect(u0, d0 - 0.12, u1, d0);
    T.box(t.x0, y0, t.z0, t.x1, y1, t.z1, M_PAINT, WHITE[0], WHITE[1], WHITE[2], 0);
  };
  trim(uc - dw - 0.2, uc + dw + 0.2, dh, dh + 0.2);
  trim(uc - dw - 0.2, uc - dw, 0, dh);
  trim(uc + dw, uc + dw + 0.2, 0, dh);
  trim(uc - 0.07, uc + 0.07, 0, dh);
  trim(uc - 1.25, uc + 1.25, 7.9, 8.06);
  trim(uc - 1.25, uc - 1.1, 6.0, 7.9);
  trim(uc + 1.1, uc + 1.25, 6.0, 7.9);
  for (const [u, d] of [[uc - hw, d0], [uc + hw, d0], [uc - hw, d1], [uc + hw, d1]]) {
    const t = f.rect(u - 0.12, d - 0.12, u + 0.12, d + 0.12);
    T.box(t.x0, 0, t.z0, t.x1, wh, t.z1, M_PAINT, WHITE[0], WHITE[1], WHITE[2], 0);
  }

  // Cupola, with a weathervane.
  const dm = (d0 + d1) / 2, cu = f.rect(uc - 0.8, dm - 0.8, uc + 0.8, dm + 0.8);
  L.box(cu.x0, ridge - 0.5, cu.z0, cu.x1, ridge + 1.1, cu.z1, M_WOOD, WHITE[0], WHITE[1], WHITE[2], 0);
  hipRoof(L, cu, ridge + 1.1, 0.9, 1, 0.15, roofMat, rc, 0);
  const [vx, vz] = f.pt(uc, dm);
  B.poles.push(vx, ridge + 2, ridge + 2.9, vz, 0.03, 40, 40, 42, G_PIPE, M_PAINT);
  B.maxH = Math.max(B.maxH, ridge + 3);
}

/**
 * A farmstead filling its block: the farmhouse by the road with a porch and shade trees, a gravel drive to
 * the yard, a red barn behind, a yard light, and either a dairy's silos, paddock and cows or a grain farm's
 * bins and machine shed. The layout is FARM's, mirrored with FARM_FLIP; the ground painter draws the lawn,
 * drive and yard from the same numbers.
 */
function farmstead(B: Builder, i: number, j: number, farm: number): void {
  const { rng } = B;
  const side = farm & 3, flip = (farm & FARM_FLIP) !== 0;
  const f = plotFrame({ x0: i * P, z0: j * P, x1: (i + 1) * P, z1: (j + 1) * P }, side);
  const U = (u: number): number => (flip ? P - u : u);
  const at = (u: number, d: number): [number, number] => f.pt(U(u), d);

  // The farmhouse: two storeys of clapboard under a steep roof, a porch across the front facing the road.
  const [hu0, hd0, hu1, hd1] = FARM.house;
  const hr = f.rect(U(hu0), hd0, U(hu1), hd1);
  const h = 2 * FLOOR_H[F_SIDING];
  const c = jitter(rng, pick(rng, CLAPBOARD), 0.04);
  const seed = facadeSeed(F_SIDING, Math.floor(rng() * 2), 3 + Math.floor(rng() * 3), 1, Math.floor(rng() * 4096));
  const roofC = pick(rng, SHINGLES);
  enterable(B, {
    rect: hr, side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES,
    doorW: 1.1, label: 'FARMHOUSE', sign: -1, open: false, canopy: false, programs: [LIVING, null, BEDROOM], text: -1,
  });
  gableRoof(B.faces, hr, h, 3.4, f.alongX, 0.45, M_TILES, roofC, 0, M_WALL, c, seed);
  {
    const [x, z] = at(hu0 + 1.5, (hd0 + hd1) / 2);
    chimney(B, x, z, h + 1.2, h + 4.4, 0.45, 0.45, BRICK);
  }
  const uL = Math.min(U(hu0), U(hu1)), hw = hu1 - hu0, uc = uL + doorCentre(seed, hw);
  const deck = f.rect(uL - 0.3, hd0 - 2.6, uL + hw + 0.3, hd0);
  B.props.box(deck.x0, 0, deck.z0, deck.x1, 0.3, deck.z1, M_WOOD, 150, 138, 120, 0);
  B.props.box(deck.x0, 2.62, deck.z0, deck.x1, 2.8, deck.z1, M_PAINT, WHITE[0], WHITE[1], WHITE[2], 0, M_PAINT, BOX_ALL);
  for (const t of [-0.15, hw / 3, (2 * hw) / 3, hw + 0.15]) {
    if (Math.abs(uL + t - uc) < 1.1) continue;
    const [x, z] = f.pt(uL + t, hd0 - 2.45);
    B.poles.push(x, 0.3, 2.62, z, 0.08, WHITE[0], WHITE[1], WHITE[2], G_PIPE, M_PAINT);
    B.colliders.push(x - 0.1, z - 0.1, x + 0.1, z + 0.1);
  }
  {
    const st = f.rect(uc - 0.8, hd0 - 3.2, uc + 0.8, hd0 - 2.6);
    B.props.box(st.x0, 0, st.z0, st.x1, 0.15, st.z1, M_CONCRETE, 170, 166, 158, 0);
    const [x, z] = f.pt(uc + 0.9, hd0 - 0.2);
    B.lights.push(x, 2.2, z, 255, 214, 150, LIGHT_LAMP);
  }
  // A path from the steps to the drive, and the mailbox out by the road.
  flat(B, f.rect(uc - 0.6, 9.6, uc + 0.6, hd0 - 3.2), 0.02, M_CONCRETE, PATH);
  flat(B, f.rect(uc, 9.6, U(FARM.driveU - FARM.driveHalf), 10.8), 0.02, M_CONCRETE, PATH);
  {
    const [x, z] = at(FARM.driveU - FARM.driveHalf - 1.4, 6.6);
    B.poles.push(x, 0, 1.0, z, 0.05, 90, 80, 70, G_PIPE, 0);
    B.props.box(x - 0.22, 1.0, z - 0.22, x + 0.22, 1.3, z + 0.22, M_PAINT, 40, 44, 52, 0);
  }
  for (const [u, d] of [[3, 28], [22, 21], [9, 41], [14, 54], [2, 11]]) {
    if (rng() < 0.65) {
      const [x, z] = at(u, d);
      tree(B, x, z, 1.2 + rng() * 0.5, TREE_ROUND);
    }
  }
  pickup(B, f, U(FARM.driveU), 26, pick(rng, PICKUPS));

  // The barn, red as a rule.
  const roll = rng();
  const barnC = jitter(rng, roll < 0.78 ? BARN_RED : roll < 0.9 ? BARN_GREY : WHITE, 0.05);
  const tin = rng() < 0.6;
  const [bu0, bd0, bu1, bd1] = FARM.barn;
  barn(B, f, U((bu0 + bu1) / 2), bd0, bd1, barnC, tin ? M_CORRUGATED : M_ROOF, tin ? TIN : pick(rng, SHINGLES));

  // The yard light, on all night.
  {
    const [x, z] = at(FARM.light[0], FARM.light[1]);
    B.poles.push(x, 0, 8.8, z, 0.12, POLE[0], POLE[1], POLE[2], G_PIPE, M_TRUNK);
    B.props.box(x - 0.3, 8.7, z - 0.3, x + 0.3, 9.0, z + 0.3, M_LAMP, 255, 196, 130, 0, M_LAMP, BOX_ALL);
    B.lights.push(x, 8.65, z, 255, 196, 130, LIGHT_LAMP);
    B.colliders.push(x - 0.15, z - 0.15, x + 0.15, z + 0.15);
  }

  const [tb, th] = pick(rng, TRACTORS);
  if (farm & FARM_GRAIN) {
    // Grain bins in a row behind the yard, with the leg that fills them.
    for (const [u, r] of [[42, 4], [51, 4], [59.3, 3.3]]) {
      const [x, z] = at(u, 53.5);
      const wh = r > 3.5 ? 7 : 6;
      cylinder(B, x, z, r, 0, wh, 16, M_CORRUGATED, STEEL);
      cone(B, x, z, r + 0.15, wh, r * 0.55, 16, M_CORRUGATED, [196, 200, 204]);
    }
    {
      const [x, z] = at(46.5, 59.2);
      B.poles.push(x, 0, 16.4, z, 0.3, STEEL[0], STEEL[1], STEEL[2], G_PIPE, M_CORRUGATED);
      B.faces.box(x - 0.7, 16.4, z - 0.7, x + 0.7, 17.6, z + 0.7, M_CORRUGATED, STEEL[0], STEEL[1], STEEL[2], 0);
      B.maxH = Math.max(B.maxH, 17.6);
    }
    // The machine shed, its doors in the end facing the drive.
    const sc = pick(rng, SHED);
    const sr = f.rect(U(40), 33, U(62), 44);
    B.faces.box(sr.x0, 0, sr.z0, sr.x1, 5.2, sr.z1, M_CORRUGATED, sc[0], sc[1], sc[2], 0, M_ROOF, BOX_SIDES);
    B.colliders.push(sr.x0, sr.z0, sr.x1, sr.z1);
    gableRoof(B.faces, sr, 5.2, 1.4, f.alongX, 0.3, M_CORRUGATED, TIN, 0, M_CORRUGATED, sc, 0);
    const du = U(40) + (flip ? 0.05 : -0.05), dc: RGB = [sc[0] * 0.55, sc[1] * 0.55, sc[2] * 0.55];
    if (flip) quad(B.props, f, [du, 0, 34.5], [du, 0, 42.5], [du, 4.4, 42.5], [du, 4.4, 34.5], M_CORRUGATED, dc, 0);
    else quad(B.props, f, [du, 0, 42.5], [du, 0, 34.5], [du, 4.4, 34.5], [du, 4.4, 42.5], M_CORRUGATED, dc, 0);
    tractor(B, f, U(37.4), 45.5, tb, th);
  } else {
    // Silos beside the barn: concrete staves (ribbed, so they do not read as a tower block's windows), or a
    // blue glass-lined one.
    const blue = rng() < 0.35;
    const sh = 18 + rng() * 5;
    for (const [d, y] of rng() < 0.6 ? [[48.6, sh], [55.2, sh - 3]] : [[48.6, sh]]) {
      const [x, z] = at(37.4, d);
      cylinder(B, x, z, 2.6, 0, y, 14, blue ? M_PAINT : M_CORRUGATED, blue ? HARVESTORE : STAVE);
      dome(B.faces, x, y, z, 2.6, 14, 3, M_PAINT, blue ? HARVESTORE : TIN);
      B.maxH = Math.max(B.maxH, y + 2.6);
    }
    // A paddock behind the yard, the gate towards it, and a few of the herd.
    rails(B, f, U(41), 45, U(48), 45);
    rails(B, f, U(52), 45, U(62), 45);
    rails(B, f, U(62), 45, U(62), 63);
    rails(B, f, U(41), 63, U(62), 63);
    rails(B, f, U(41), 45, U(41), 63);
    const breed = Math.floor(rng() * BREEDS.length);
    for (let k = 2 + Math.floor(rng() * 3); k > 0; k--) {
      const [x, z] = at(44 + rng() * 15, 48.5 + rng() * 11);
      cow(B, x, z, rng() < 0.5, rng() < 0.5 ? -1 : 1, breed, rng() < 0.6);
    }
    tractor(B, f, U(48), 38, tb, th);
  }
}
