import { F_GENERIC, F_WOOD, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_CORRUGATED, M_PAINT, M_ROOF, M_TILES, M_WALL } from '../../render/materials';
import {
  type Builder, type Lot, type Rect, G_PIPE, LIGHT_LANTERN, TREE_CHERRY,
  bladeSign, hipRoof, jitter, lanterns, perimeterLots, pick, sideOf, streetTrees, tree, wallSign,
} from '../build';
import { BOX_DEFAULT, BOX_SIDES } from '../faces';
import { TATAMI, shopFor } from '../furniture';
import { enterable } from '../interior';
import { HALF, KIND_PARK, KIND_PLAZA, P, hasPond } from '../layout';
import { NEON, SIGNS_JAPAN, SIGN_TEXTS, TEXT_HOTEL, type RGB } from '../signs';

const WOOD: readonly RGB[] = [[92, 58, 40], [74, 48, 36], [112, 72, 46], [60, 44, 38]];
const PLASTER: readonly RGB[] = [[190, 180, 160], [165, 155, 140], [150, 160, 165]];
const LACQUER: RGB = [178, 44, 34];
const ROOF: readonly RGB[] = [[58, 64, 80], [48, 54, 66], [70, 72, 78]];
/** Sidewalk centre line, measured from the road centre. */
const WALK_MID = 8.25;

export function buildJapantown(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  if (kind === KIND_PLAZA) {
    pagoda(B, bx + HALF, bz + HALF, 11, 5);
    stoneLanterns(B, bx + HALF, bz + HALF, 10);
    torii(B, bx + HALF, bz + 13, false);
    return;
  }
  if (kind === KIND_PARK) return garden(B, i, j, lot);

  const { rng } = B;
  let inn = B.alt() < 0.35;
  for (const L of perimeterLots(rng, lot, 12, 5, 9)) {
    if (shophouse(B, L, inn)) inn = false;
  }
  const courtyard = Math.min(lot.x1 - lot.x0, lot.z1 - lot.z0) - 24;
  if (courtyard >= 10 && rng() < 0.3) pagoda(B, bx + HALF, bz + HALF, Math.min(10, courtyard - 2), 3);
  if (rng() < 0.3) {
    const side = Math.floor(rng() * 4);
    if (side === 0) torii(B, bx + 28, bz + WALK_MID, true);
    else if (side === 1) torii(B, bx + P - WALK_MID, bz + 28, false);
    else if (side === 2) torii(B, bx + 28, bz + P - WALK_MID, true);
    else torii(B, bx + WALK_MID, bz + 28, false);
  }
  if (rng() < 0.35) streetTrees(B, bx, bz, TREE_CHERRY, 0.8, [24, 40]);
}

/** Returns true when this shophouse became the block's inn. */
function shophouse(B: Builder, L: Lot, inn: boolean): boolean {
  const { rng, faces } = B;
  const floors = 2 + Math.floor(rng() * 5);
  const h = floors * FLOOR_H[F_WOOD] + 0.4;
  const wood = rng() < 0.65;
  const c = jitter(rng, pick(rng, wood ? WOOD : PLASTER), 0.1);
  const id = Math.floor(rng() * 4096);
  const lit = 3 + Math.floor(rng() * 5);
  const seed = wood ? facadeSeed(F_WOOD, Math.floor(rng() * 3), lit, 1, id) : facadeSeed(F_GENERIC, 3, lit, 1, id);
  const hip = floors <= 3 && rng() < 0.6;
  B.maxH = Math.max(B.maxH, h + 2);
  if (hip) {
    const half = Math.min(L.x1 - L.x0, L.z1 - L.z0) / 2;
    hipRoof(faces, L, h, 1.6, half - 0.3, 0.7, M_TILES, pick(rng, ROOF), 0, M_TILES, true);
  } else if (rng() < 0.3) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    B.props.box(cx - 1, h, cz - 1, cx + 1, h + 2.2, cz + 1, M_CORRUGATED, 120, 110, 95, 0);
  }
  const s = sideOf(L, L.side);
  let text = -1;
  if (floors >= 2 && rng() < 0.6) text = bladeSign(B, s, 0.8 + rng() * (s.len - 1.6), 3.2, SIGNS_JAPAN, NEON, h - 3.4);
  if (rng() < 0.6) lanterns(B, s, 2.9, 1.6);
  if (floors >= 3 && rng() < 0.2) {
    const t = wallSign(B, s, SIGNS_JAPAN, NEON, 3.4, 1);
    if (text < 0) text = t;
  }

  const shop = shopFor(text);
  const base = { rect: L, side: L.side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: hip ? BOX_SIDES : BOX_DEFAULT };
  if (inn && !shop && floors >= 3) {
    enterable(B, {
      ...base, doorW: 1.6, label: 'RYOKAN', sign: text >= 0 ? -1 : TEXT_HOTEL, open: false, canopy: true,
      programs: [TATAMI, TATAMI, TATAMI], text: -1, stairs: true,
      entrance: { kind: 'slide', glazed: true, wood: true, color: [150, 112, 72] },
    });
    return true;
  }
  if (shop && B.alt() < 0.7) {
    enterable(B, { ...base, doorW: 1.5, label: SIGN_TEXTS[text], sign: -1, open: true, canopy: false, programs: [shop, null, null], text });
    return false;
  }
  faces.box(L.x0, 0, L.z0, L.x1, h, L.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, hip ? BOX_SIDES : BOX_DEFAULT);
  B.colliders.push(L.x0, L.z0, L.x1, L.z1);
  return false;
}

/** Stacked tiers, each with wide overhanging eaves; every roof's top ring is exactly the next tier's footprint. */
export function pagoda(B: Builder, cx: number, cz: number, base: number, tiers: number): void {
  const { rng, faces } = B;
  const seed = facadeSeed(F_WOOD, 3, 5, 1, Math.floor(rng() * 4096));
  const rc = pick(rng, ROOF);
  let half = base / 2;
  let y = 0;
  for (let t = 0; t < tiers; t++) {
    const th = t === 0 ? 4.2 : 2.6;
    const r = { x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half };
    faces.box(r.x0, y, r.z0, r.x1, y + th, r.z1, M_WALL, LACQUER[0], LACQUER[1], LACQUER[2], seed, M_ROOF, BOX_SIDES);
    y += th;
    const last = t === tiers - 1;
    const next = half * 0.76;
    const rise = last ? 2.4 : 1.2;
    hipRoof(faces, r, y, rise, last ? half - 0.12 : half - next, 1.3 + 0.08 * (tiers - t), M_TILES, rc, 0, last ? M_TILES : 0, true);
    y += rise;
    half = next;
  }
  B.poles.push(cx, y, y + 3.2, cz, 0.08, 200, 170, 90, G_PIPE, 0);
  B.colliders.push(cx - base / 2, cz - base / 2, cx + base / 2, cz + base / 2);
  B.maxH = Math.max(B.maxH, y + 3.2);
}

/** Gate you walk through along the sidewalk; `alongX` means the sidewalk runs along x. */
function torii(B: Builder, cx: number, cz: number, alongX: boolean): void {
  const [r, g, b] = LACQUER;
  const span = 1.6, h = 4.4;
  const box = (a0: number, y0: number, c0: number, a1: number, y1: number, c1: number, rr: number, gg: number, bb: number) => {
    if (alongX) B.props.box(cx + a0, y0, cz + c0, cx + a1, y1, cz + c1, M_PAINT, rr, gg, bb, 0);
    else B.props.box(cx + c0, y0, cz + a0, cx + c1, y1, cz + a1, M_PAINT, rr, gg, bb, 0);
  };
  box(-0.2, 0, -span - 0.2, 0.2, h, -span + 0.2, r, g, b);
  box(-0.2, 0, span - 0.2, 0.2, h, span + 0.2, r, g, b);
  box(-0.3, h, -span - 1.0, 0.3, h + 0.45, span + 1.0, 40, 30, 30);
  box(-0.16, h - 1.1, -span - 0.45, 0.16, h - 0.8, span + 0.45, r, g, b);
  B.maxH = Math.max(B.maxH, h + 1);
}

function stoneLanterns(B: Builder, cx: number, cz: number, rad: number): void {
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + sx * rad, z = cz + sz * rad;
    B.props.box(x - 0.22, 0, z - 0.22, x + 0.22, 1.0, z + 0.22, M_CONCRETE, 150, 148, 140, 0);
    B.props.box(x - 0.42, 1.0, z - 0.42, x + 0.42, 1.2, z + 0.42, M_CONCRETE, 140, 138, 130, 0);
    B.lights.push(x, 1.35, z, 255, 190, 110, LIGHT_LANTERN);
  }
}

/** Zen garden: raked gravel (drawn by the ground pass), cherry trees, stone lanterns, maybe a pond. */
function garden(B: Builder, i: number, j: number, lot: Rect): void {
  const pond = hasPond(i, j);
  const cx = i * P + HALF, cz = j * P + HALF;
  for (let k = 0; k < 9; k++) {
    const tx = lot.x0 + 3 + B.rng() * (lot.x1 - lot.x0 - 6);
    const tz = lot.z0 + 3 + B.rng() * (lot.z1 - lot.z0 - 6);
    if (pond && Math.hypot(tx - cx, tz - cz) < 11) continue;
    if (Math.abs(tx - cx) < 2.5 || Math.abs(tz - cz) < 2.5) continue;
    tree(B, tx, tz, 0.9 + B.rng() * 0.4, TREE_CHERRY);
  }
  stoneLanterns(B, cx, cz, pond ? 12 : 6);
}
