import { F_BRICK, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_ROOF, M_TILES, M_WALL } from '../../render/materials';
import {
  type Builder, type Lot, type Rect, TREE_ROUND,
  awning, chimney, fountain, gableRoof, jitter, perimeterLots, pick, sideOf, streetTrees, tree, wallSign,
} from '../build';
import { BOX_SIDES } from '../faces';
import { BAR, BEDROOM, LIVING, shopFor } from '../furniture';
import { enterable } from '../interior';
import { HALF, KIND_PARK, KIND_PLAZA, P } from '../layout';
import { SIGNS_OLDTOWN, SIGN_TEXTS, WARM_SIGNS, type RGB } from '../signs';

const PLASTER: readonly RGB[] = [[205, 175, 115], [195, 135, 120], [150, 180, 150], [205, 195, 165], [145, 170, 195], [210, 160, 110]];
const BRICK: readonly RGB[] = [[150, 70, 50], [130, 62, 46], [165, 88, 62]];
const CLAY: readonly RGB[] = [[170, 85, 55], [150, 72, 48], [120, 60, 45]];
const SLATE: RGB = [78, 84, 98];
const CHIMNEY: RGB = [120, 64, 50];
const STONE: RGB = [150, 142, 128];

export function buildOldTown(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  if (kind === KIND_PLAZA) return market(B, bx + HALF, bz + HALF);
  if (kind === KIND_PARK) return green(B, lot, bx + HALF, bz + HALF);
  let inn = B.alt() < 0.4;
  for (const L of perimeterLots(B.rng, lot, 10, 4.4, 7)) {
    if (house(B, L, inn)) inn = false;
  }
  if (B.rng() < 0.15) streetTrees(B, bx, bz, TREE_ROUND, 0.8, [24, 40]);
}

const TEXT_INN = SIGN_TEXTS.indexOf('INN');

/** Narrow row house with its gable facing the street, the classic old-European skyline. Returns true when it became the inn. */
function house(B: Builder, L: Lot, inn: boolean): boolean {
  const { rng, faces } = B;
  const floors = 2 + Math.floor(rng() * 3);
  const h = floors * FLOOR_H[F_BRICK];
  const brick = rng() < 0.4;
  const style = brick ? Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
  const c = jitter(rng, pick(rng, brick ? BRICK : PLASTER), 0.08);
  const seed = facadeSeed(F_BRICK, style, 2 + Math.floor(rng() * 5), 1, Math.floor(rng() * 4096));

  const alongX = L.side === 1 || L.side === 3;
  const frontage = alongX ? L.z1 - L.z0 : L.x1 - L.x0;
  const rise = frontage * (0.5 + rng() * 0.3);
  const roof = rng() < 0.8 ? pick(rng, CLAY) : SLATE;
  gableRoof(faces, L, h, rise, alongX, 0.25, M_TILES, roof, 0, M_WALL, c, seed);

  const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
  const back = 0.25 + rng() * 0.5;
  if (alongX) chimney(B, L.x0 + (L.x1 - L.x0) * back, cz, h + rise * 0.5, h + rise + 0.9, 0.35, 0.35, CHIMNEY);
  else chimney(B, cx, L.z0 + (L.z1 - L.z0) * back, h + rise * 0.5, h + rise + 0.9, 0.35, 0.35, CHIMNEY);

  B.maxH = Math.max(B.maxH, h + rise + 1);
  const text = rng() < 0.25 ? wallSign(B, sideOf(L, L.side), SIGNS_OLDTOWN, WARM_SIGNS, 3.05, 1) : -1;

  const shop = shopFor(text);
  const base = { rect: L, side: L.side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES };
  if (inn && text < 0 && floors >= 3 && Math.min(L.x1 - L.x0, L.z1 - L.z0) >= 5) {
    enterable(B, {
      ...base, doorW: 1.4, label: 'INN', sign: TEXT_INN, open: false, canopy: true,
      programs: [BAR, LIVING, BEDROOM], text: TEXT_INN,
    });
    return true;
  }
  if (shop && B.alt() < 0.8) {
    enterable(B, { ...base, doorW: 1.4, label: SIGN_TEXTS[text], sign: -1, open: true, canopy: false, programs: [shop, null, null], text });
    return false;
  }
  faces.box(L.x0, 0, L.z0, L.x1, h, L.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
  B.colliders.push(L.x0, L.z0, L.x1, L.z1);
  return false;
}

/** Market square: fountain ringed by striped stalls. */
function market(B: Builder, cx: number, cz: number): void {
  const { rng } = B;
  fountain(B, cx, cz, 3.5, STONE);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = cx + Math.cos(a) * 12, z = cz + Math.sin(a) * 12;
    const r = { x0: x - 1.3, z0: z - 1, x1: x + 1.3, z1: z + 1 };
    B.props.box(r.x0, 0, r.z0, r.x1, 2.1, r.z1, M_CONCRETE, 150, 108, 70, 0, M_ROOF);
    const face = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 1 : 3) : Math.sin(a) > 0 ? 2 : 0;
    const s = sideOf(r, face);
    awning(B, s, 0, s.len, 2.7, 1.1, Math.floor(rng() * 4));
    B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  }
}

function green(B: Builder, lot: Rect, cx: number, cz: number): void {
  for (let k = 0; k < 6; k++) {
    const tx = lot.x0 + 4 + B.rng() * (lot.x1 - lot.x0 - 8);
    const tz = lot.z0 + 4 + B.rng() * (lot.z1 - lot.z0 - 8);
    if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3) continue;
    tree(B, tx, tz, 1.1 + B.rng() * 0.4, TREE_ROUND);
  }
  B.faces.box(cx - 1.2, 0, cz - 1.2, cx + 1.2, 0.9, cz + 1.2, M_CONCRETE, STONE[0], STONE[1], STONE[2], 0);
  B.colliders.push(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2);
}
