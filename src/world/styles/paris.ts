import { F_GENERIC, F_STONE, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_MANSARD, M_ROOF, M_WALL } from '../../render/materials';
import {
  type Builder, type Lot, type Rect, TREE_PLANE,
  awning, chimney, fountain, hipRoof, jitter, perimeterLots, pick, sideOf, streetTrees, tree, wallSign,
} from '../build';
import { BOX_SIDES } from '../faces';
import { HALF, KIND_CITY, P } from '../layout';
import { SIGNS_PARIS, WARM_SIGNS, type RGB } from '../signs';

const STONE: readonly RGB[] = [[210, 196, 164], [200, 186, 154], [218, 206, 176], [196, 184, 160]];
const SLATE: readonly RGB[] = [[78, 86, 104], [70, 78, 96], [84, 90, 106]];
const POTS: readonly RGB[] = [[150, 92, 72], [176, 160, 132]];
const MANSARD_RISE = 3.6;
const MANSARD_INSET = 1.5;
const TREE_ROW = [12, 24, 40, 52];
const TREE_SETBACK = 8.9;

export function buildParis(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  if (kind !== KIND_CITY) {
    square(B, lot, bx + HALF, bz + HALF);
    streetTrees(B, bx, bz, TREE_PLANE, 1, TREE_ROW, TREE_SETBACK);
    return;
  }
  const { rng } = B;
  // One cornice height per block, like a Haussmann street wall.
  const floors = 5 + (rng() < 0.5 ? 1 : 0);
  const h = floors * FLOOR_H[F_STONE] + 0.5;
  for (const L of perimeterLots(rng, lot, 13, 10, 17)) immeuble(B, L, h);
  if (rng() < 0.85) streetTrees(B, bx, bz, TREE_PLANE, 1, TREE_ROW, TREE_SETBACK);
}

function immeuble(B: Builder, L: Lot, h: number): void {
  const { rng, faces } = B;
  const c = jitter(rng, pick(rng, STONE), 0.05);
  const id = Math.floor(rng() * 4096);
  const seed = facadeSeed(F_STONE, 0, 2 + Math.floor(rng() * 5), 1, id);
  faces.box(L.x0, 0, L.z0, L.x1, h, L.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
  hipRoof(faces, L, h, MANSARD_RISE, MANSARD_INSET, 0.2, M_MANSARD, pick(rng, SLATE), facadeSeed(F_GENERIC, 0, 2 + Math.floor(rng() * 4), 1, id), M_ROOF, true);

  const top = h + MANSARD_RISE;
  const pot = pick(rng, POTS);
  const n = 2 + Math.floor(rng() * 3);
  const alongX = L.x1 - L.x0 > L.z1 - L.z0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    if (alongX) chimney(B, L.x0 + MANSARD_INSET + t * (L.x1 - L.x0 - 2 * MANSARD_INSET), L.z0 + MANSARD_INSET + 0.4, top, top + 1.4, 0.9, 0.3, pot);
    else chimney(B, L.x0 + MANSARD_INSET + 0.4, L.z0 + MANSARD_INSET + t * (L.z1 - L.z0 - 2 * MANSARD_INSET), top, top + 1.4, 0.3, 0.9, pot);
  }
  B.colliders.push(L.x0, L.z0, L.x1, L.z1);
  B.maxH = Math.max(B.maxH, top + 1.5);

  const s = sideOf(L, L.side);
  if (rng() < 0.45) awning(B, s, 0.8, s.len - 0.8, 3.1, 1.8, Math.floor(rng() * 4));
  else if (rng() < 0.5) wallSign(B, s, SIGNS_PARIS, WARM_SIGNS, 3.4, 1);
}

/** Place with a tiered fountain, gravel walks and an inner ring of plane trees. */
function square(B: Builder, lot: Rect, cx: number, cz: number): void {
  fountain(B, cx, cz, 4, STONE[0]);
  const inset = 5;
  for (let a = lot.x0 + inset; a <= lot.x1 - inset + 0.01; a += 8) {
    tree(B, a, lot.z0 + inset, 1, TREE_PLANE);
    tree(B, a, lot.z1 - inset, 1, TREE_PLANE);
  }
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = cx + sx * 9, z = cz + sz * 9;
    const along = sx !== 0;
    B.props.box(x - (along ? 0.3 : 1.1), 0, z - (along ? 1.1 : 0.3), x + (along ? 0.3 : 1.1), 0.5, z + (along ? 1.1 : 0.3), M_CONCRETE, 90, 70, 50, 0);
  }
}
