import { F_VILLA, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CLOTH, M_CONCRETE, M_LEAF, M_PAINT, M_POOL, M_RAIL, M_ROOF, M_TILES, M_WALL } from '../../render/materials';
import {
  type Builder, type PlotFrame, type Rect, G_PIPE, LIGHT_LAMP, LIGHT_LANTERN, TREE_ROUND,
  cypress, fenceRun, flat, fountain, gableRoof, hipRoof, jitter, park, parkedCar, pick, plotFrame, sideOf, solidBox, tree, wallSign,
} from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP } from '../faces';
import { BEDROOM, LIVING, LOUNGE } from '../furniture';
import { enterable } from '../interior';
import { KIND_PARK } from '../layout';
import { SIGNS_ESTATES, WARM_SIGNS, type RGB } from '../signs';

const RENDER: readonly RGB[] = [[236, 230, 214], [226, 214, 190], [240, 238, 232], [214, 204, 186], [206, 196, 204]];
const ROOFS: readonly RGB[] = [[150, 74, 52], [78, 86, 104], [120, 64, 48], [70, 72, 78]];
const SPORTS: readonly RGB[] = [[200, 20, 30], [240, 200, 30], [20, 20, 24], [236, 236, 240], [30, 60, 140], [30, 110, 70]];
const STONE: RGB = [226, 220, 204];
const GRAVEL: RGB = [196, 186, 164];
const DECK: RGB = [224, 218, 204];
const HEDGE: RGB = [34, 92, 46];

export function buildEstates(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  if (kind === KIND_PARK) {
    park(B, i, j, lot, TREE_ROUND, false);
    return;
  }
  const side = Math.floor(B.rng() * 4);
  mansion(B, plotFrame(lot, side), side, B.alt() < 0.6);
}

/**
 * One house per block behind a tall hedge: a gated gravel drive lined with cypresses leads to a
 * fountain forecourt, the house (classical or modern) sits mid-plot and the pool is behind it.
 */
function mansion(B: Builder, f: PlotFrame, side: number, enter: boolean): void {
  const { rng, faces } = B;
  const { W, D } = f;
  const mid = W / 2;
  const gate = 2.8;

  // Hedge ring with the gateway in the middle of the street side.
  fenceRun(B, f, 0.2, W - 0.2, 0.6, 2.4, 0.45, M_LEAF, HEDGE, [[mid - gate, mid + gate]], false, false);
  fenceRun(B, f, 0.2, W - 0.2, D - 0.6, 2.4, 0.45, M_LEAF, HEDGE, [], false, false);
  fenceRun(B, f, 1.05, D - 1.05, 0.6, 2.4, 0.45, M_LEAF, HEDGE, [], true, false);
  fenceRun(B, f, 1.05, D - 1.05, W - 0.6, 2.4, 0.45, M_LEAF, HEDGE, [], true, false);
  for (const u of [mid - gate - 0.45, mid + gate + 0.45]) {
    const r = f.rect(u - 0.45, 0.1, u + 0.45, 1.1);
    solidBox(B, r, 0, 2.9, M_CONCRETE, STONE, 0, false);
    B.props.box(r.x0 - 0.08, 2.9, r.z0 - 0.08, r.x1 + 0.08, 3.1, r.z1 + 0.08, M_CONCRETE, 200, 194, 180, 0);
    const [x, z] = f.pt(u, 0.6);
    B.lights.push(x, 3.35, z, 255, 214, 150, LIGHT_LANTERN);
  }
  {
    const r = f.rect(0.2, 0.15, mid - gate - 1, 1.05);
    wallSign(B, sideOf(r, side), SIGNS_ESTATES, WARM_SIGNS, 1.1, 0.5);
  }

  // Drive and forecourt.
  const court0 = 8, court1 = 16;
  flat(B, f.rect(mid - 2.2, -4.6, mid + 2.2, court0), 0.02, M_CONCRETE, GRAVEL);
  flat(B, f.rect(mid - 9, court0, mid + 9, court1), 0.02, M_CONCRETE, GRAVEL);
  const [fx, fz] = f.pt(mid, (court0 + court1) / 2);
  fountain(B, fx, fz, 1.8, STONE);
  for (let d = 2.5; d < court0; d += 2.7) {
    for (const s of [-1, 1]) {
      const [x, z] = f.pt(mid + s * 3.4, d);
      cypress(B, x, z, 5 + rng() * 1.5);
    }
  }
  for (const s of [-1, 1]) {
    const [x, z] = f.pt(mid + s * 7.5, court0 + 0.8);
    B.poles.push(x, 0, 1.3, z, 0.06, 40, 40, 44, G_PIPE, 0);
    B.lights.push(x, 1.4, z, 255, 220, 160, LIGHT_LAMP);
  }
  {
    const [x, z] = f.pt(mid + (rng() < 0.5 ? -5.5 : 5.5), court0 + 3.8);
    parkedCar(B, x, z, f.alongX, pick(rng, SPORTS), true);
  }

  // The house.
  const classical = rng() < 0.6;
  const floors = classical ? 2 + (rng() < 0.4 ? 1 : 0) : 2;
  const fh = FLOOR_H[F_VILLA];
  const h = floors * fh;
  const c = jitter(rng, pick(rng, RENDER), 0.04);
  const seed = facadeSeed(F_VILLA, classical ? Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2), 4 + Math.floor(rng() * 3), 1, Math.floor(rng() * 4096));
  const hw = classical ? 22 : 24;
  const d0 = court1 + 1.2, d1 = d0 + 12.8;
  const main = f.rect(mid - hw / 2, d0, mid + hw / 2, d1);
  const programs = [LIVING, LOUNGE, BEDROOM] as const;
  const body = (r: Rect, hh: number, cap: number) => {
    faces.box(r.x0, 0, r.z0, r.x1, hh, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, cap);
    B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  };
  if (classical) {
    if (enter) {
      enterable(B, {
        rect: main, side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES,
        doorW: 2, label: 'MANSION', sign: -1, open: false, canopy: false, programs, text: -1,
      });
    } else body(main, h, BOX_SIDES);
    const roof = pick(rng, ROOFS);
    hipRoof(faces, main, h, 3.6, 6, 0.6, M_TILES, roof, 0, M_TILES, true);
    // Lower wings either side.
    for (const s of [-1, 1]) {
      const u0 = s < 0 ? mid - hw / 2 - 7 : mid + hw / 2, u1 = u0 + 7;
      const wing = f.rect(u0, d0 + 1.6, u1, d1 - 1.6);
      body(wing, h - fh, BOX_SIDES);
      hipRoof(faces, wing, h - fh, 2.4, 3, 0.5, M_TILES, roof, 0, M_TILES, true);
    }
    // Portico: columns under a pediment, in front of the door.
    const pd0 = d0 - 3, cols = [-3.3, -1.1, 1.1, 3.3];
    for (const u of cols) {
      const [x, z] = f.pt(mid + u, pd0 + 0.4);
      B.poles.push(x, 0, h - 0.6, z, 0.26, STONE[0], STONE[1], STONE[2], G_PIPE, M_CONCRETE);
      B.colliders.push(x - 0.26, z - 0.26, x + 0.26, z + 0.26);
    }
    const por = f.rect(mid - 4.2, pd0, mid + 4.2, d0);
    B.faces.box(por.x0, h - 0.6, por.z0, por.x1, h, por.z1, M_CONCRETE, STONE[0], STONE[1], STONE[2], 0, M_CONCRETE, BOX_SIDES | BOX_BOTTOM);
    gableRoof(faces, por, h, 1.8, f.alongX, 0.2, M_TILES, roof, 0, M_CONCRETE, STONE, 0);
    B.maxH = Math.max(B.maxH, h + 4);
  } else {
    // Modern: a long glass ground floor with a white upper box sliding past it, flat roofs with rails.
    const shift = rng() < 0.5 ? -4 : 4;
    const lower = main;
    const upper = f.rect(mid - hw / 2 + 5 + shift, d0 - 1.5, mid + hw / 2 - 5 + shift, d1 - 1);
    if (enter) {
      enterable(B, {
        rect: lower, side, h: fh, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES | BOX_TOP,
        doorW: 2, label: 'VILLA', sign: -1, open: false, canopy: false, programs: [LOUNGE, null, null], text: -1,
      });
    } else body(lower, fh, BOX_SIDES | BOX_TOP);
    faces.box(upper.x0, fh, upper.z0, upper.x1, h, upper.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
    const { x0, z0, x1, z1 } = upper, t = 0.05;
    for (const [a, b, e, g] of [[x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1], [x0, z0, x0 + t, z1], [x1 - t, z0, x1, z1]]) {
      B.props.box(a, h, b, e, h + 1, g, M_RAIL, 200, 210, 220, 0, M_RAIL, BOX_SIDES);
    }
    B.maxH = Math.max(B.maxH, h + 1);
  }

  // Pool and deck behind the house, with loungers and a parasol.
  const p0 = d1 + 2.2;
  if (D - 2 - p0 > 7) {
    const deck = f.rect(mid - 9, p0, mid + 9, p0 + 8);
    flat(B, deck, 0.02, M_CONCRETE, DECK);
    flat(B, f.rect(mid - 6.5, p0 + 1.5, mid + 6.5, p0 + 5.5), 0.04, M_POOL, [0, 0, 0]);
    for (const u of [mid - 5.5, mid + 5.5]) {
      const [x, z] = f.pt(u, p0 + 3.5);
      B.lights.push(x, 0.3, z, 80, 220, 255, LIGHT_LANTERN);
    }
    for (let k = 0; k < 4; k++) {
      const u = mid - 5 + k * 2.4;
      const r = f.rect(u - 0.35, p0 + 6.1, u + 0.35, p0 + 7.8);
      B.props.box(r.x0, 0.2, r.z0, r.x1, 0.42, r.z1, M_CLOTH, 236, 236, 240, 0);
    }
    const [ux, uz] = f.pt(mid + 7.6, p0 + 6.6);
    B.poles.push(ux, 0, 2.3, uz, 0.04, 220, 220, 220, G_PIPE, 0);
    hipRoof(B.props, { x0: ux - 1.3, z0: uz - 1.3, x1: ux + 1.3, z1: uz + 1.3 }, 2.1, 0.5, 1.3, 0, M_PAINT, [236, 236, 236], 0, 0, true);
  }
  // Garden trees in the back corners.
  for (const u of [3.5, W - 3.5]) {
    const [x, z] = f.pt(u, D - 4 - rng() * 3);
    tree(B, x, z, 1.2 + rng() * 0.4, TREE_ROUND);
  }
  for (const u of [3.5, W - 3.5]) {
    const [x, z] = f.pt(u, court1 + 3 + rng() * 4);
    cypress(B, x, z, 6 + rng() * 2);
  }
}
