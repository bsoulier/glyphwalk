import { F_ADOBE, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_GLOW, M_ROOF, M_TILES, M_WALL, M_WOOD } from '../../render/materials';
import {
  type Builder, type Lot, type Rect, G_PIPE, LIGHT_LAMP, TREE_ROUND,
  awning, dome, fountain, jitter, lanterns, palm, perimeterLots, pick, sideOf, tree, wallSign,
} from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP } from '../faces';
import { BEDROOM, LIVING, shopFor } from '../furniture';
import { doorCentre, enterable } from '../interior';
import { HALF, KIND_PARK, KIND_PLAZA, P } from '../layout';
import { BRASS_SIGNS, SIGNS_MEDINA, SIGN_TEXTS, type RGB } from '../signs';

const PLASTER: readonly RGB[] = [
  [206, 158, 104], [218, 188, 142], [196, 116, 90], [230, 226, 214], [204, 170, 120], [184, 128, 96], [120, 156, 204],
];
const DOME_TILES: readonly RGB[] = [[46, 130, 100], [230, 228, 220], [60, 90, 160]];
const DOOR: RGB = [104, 64, 38];
const GOLD: RGB = [255, 206, 90];

export function buildMedina(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  const cx = bx + HALF, cz = bz + HALF;
  if (kind === KIND_PLAZA) {
    fountain(B, cx, cz, 3.2, [200, 180, 150]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) palm(B, cx + sx * 9, cz + sz * 9, 7 + B.rng() * 2);
    minaret(B, lot.x0 + 4, lot.z1 - 4, 30 + B.rng() * 6);
    return;
  }
  if (kind === KIND_PARK) return riadGarden(B, cx, cz);
  const { rng } = B;
  let riad = B.alt() < 0.5;
  for (const L of perimeterLots(rng, lot, 11, 6, 10)) {
    if (house(B, L, riad)) riad = false;
  }
  // The courtyard in the middle of the block: often a minaret, otherwise palms and an orange tree.
  if (rng() < 0.35) minaret(B, cx, cz, 26 + rng() * 8);
  else {
    palm(B, cx - 3, cz + 2, 7 + rng() * 2);
    tree(B, cx + 3, cz - 2, 0.8, TREE_ROUND);
  }
}

/**
 * Flat-roofed house of rough plaster behind a parapet, sometimes with a small tiled dome, souk awnings
 * and brass lanterns over its shop front. Returns true when it became the block's riad you can visit.
 */
function house(B: Builder, L: Lot, riad: boolean): boolean {
  const { rng, faces } = B;
  const floors = 2 + Math.floor(rng() * 3);
  const h = floors * FLOOR_H[F_ADOBE];
  const c = jitter(rng, pick(rng, PLASTER), 0.07);
  const seed = facadeSeed(F_ADOBE, 0, 2 + Math.floor(rng() * 5), 1, Math.floor(rng() * 4096));
  parapet(B, L, h, c);
  if (rng() < 0.22) {
    const r = Math.min(L.x1 - L.x0, L.z1 - L.z0) * 0.3;
    const dcx = (L.x0 + L.x1) / 2, dcz = (L.z0 + L.z1) / 2;
    faces.box(dcx - r, h, dcz - r, dcx + r, h + 0.6, dcz + r, M_WALL, c[0], c[1], c[2], 0, M_ROOF, BOX_SIDES);
    dome(faces, dcx, h + 0.6, dcz, r, 8, 3, M_TILES, pick(rng, DOME_TILES));
    B.maxH = Math.max(B.maxH, h + 0.6 + r);
  }
  B.maxH = Math.max(B.maxH, h + 1);

  const s = sideOf(L, L.side);
  let text = -1;
  if (rng() < 0.45) text = wallSign(B, s, SIGNS_MEDINA, BRASS_SIGNS, 3.1, 0.5);
  if (rng() < 0.4) {
    awning(B, s, 0.4, s.len - 0.4, 3.0, 1.9, Math.floor(rng() * 4));
    lanterns(B, s, 2.5, 2.2);
  }
  const shop = shopFor(text);
  const base = { rect: L, side: L.side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES | BOX_TOP };
  if (riad && !shop && floors >= 2 && Math.min(L.x1 - L.x0, L.z1 - L.z0) >= 6) {
    enterable(B, { ...base, doorW: 1.4, label: 'RIAD', sign: -1, open: false, canopy: false, programs: [LIVING, null, BEDROOM], text: -1 });
    return true;
  }
  if (shop && B.alt() < 0.75) {
    enterable(B, { ...base, doorW: 1.5, label: SIGN_TEXTS[text], sign: -1, open: true, canopy: false, programs: [shop, null, null], text });
    return false;
  }
  faces.box(L.x0, 0, L.z0, L.x1, h, L.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES | BOX_TOP);
  B.colliders.push(L.x0, L.z0, L.x1, L.z1);
  // Studded wooden door, just proud of the wall.
  const t = doorCentre(seed, s.len);
  const ax = s.p0x + s.tx * (t - 0.6) + s.nx * 0.03, az = s.p0z + s.tz * (t - 0.6) + s.nz * 0.03;
  B.props.poly(ax, 0, az, ax + s.tx * 1.2, 0, az + s.tz * 1.2, ax + s.tx * 1.2, 2.3, az + s.tz * 1.2, ax, 2.3, az, 0, 0, 1.2, 0, 1.2, 2.3, 0, 2.3, M_WOOD, DOOR[0], DOOR[1], DOOR[2], 0);
  return false;
}

/** Low wall around a flat roof, so the roofline reads as a terrace; a prop, so it drops out with distance. */
function parapet(B: Builder, r: Rect, h: number, c: RGB): void {
  const t = 0.25, top = h + 0.9;
  const { x0, z0, x1, z1 } = r;
  for (const [a, b, e, g] of [[x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1], [x0, z0 + t, x0 + t, z1 - t], [x1 - t, z0 + t, x1, z1 - t]]) {
    B.props.box(a, h, b, e, top, g, M_CONCRETE, c[0] * 0.95, c[1] * 0.95, c[2] * 0.95, 0, M_CONCRETE, BOX_SIDES | BOX_TOP);
  }
}

/** Square minaret: plaster shaft, a band of green tiles, a balcony, a lantern storey, a dome and a golden finial. */
function minaret(B: Builder, cx: number, cz: number, h: number): void {
  const { faces } = B;
  const w = 1.8, c: RGB = [214, 186, 140];
  const seed = facadeSeed(F_ADOBE, 0, 1, 1, Math.floor(B.rng() * 4096));
  faces.box(cx - w, 0, cz - w, cx + w, h, cz + w, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
  B.colliders.push(cx - w, cz - w, cx + w, cz + w);
  faces.box(cx - w - 0.05, h - 5, cz - w - 0.05, cx + w + 0.05, h - 3.6, cz + w + 0.05, M_TILES, 46, 130, 100, 0, M_TILES, BOX_SIDES);
  faces.box(cx - w - 0.6, h, cz - w - 0.6, cx + w + 0.6, h + 0.3, cz + w + 0.6, M_CONCRETE, 200, 180, 140, 0);
  const lw = 1.1;
  faces.box(cx - lw, h + 0.3, cz - lw, cx + lw, h + 4, cz + lw, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
  faces.box(cx - lw - 0.2, h + 4, cz - lw - 0.2, cx + lw + 0.2, h + 4.3, cz + lw + 0.2, M_CONCRETE, 200, 180, 140, 0);
  dome(faces, cx, h + 4.3, cz, lw, 8, 3, M_TILES, [46, 130, 100]);
  B.poles.push(cx, h + 4.3 + lw, h + 7.4, cz, 0.05, GOLD[0], GOLD[1], GOLD[2], G_PIPE, 0);
  for (const y of [h + 5.9, h + 6.5]) B.props.box(cx - 0.14, y, cz - 0.14, cx + 0.14, y + 0.28, cz + 0.14, M_GLOW, GOLD[0], GOLD[1], GOLD[2], 0);
  B.lights.push(cx, h + 2, cz - w - 0.7, 120, 255, 160, LIGHT_LAMP);
  B.maxH = Math.max(B.maxH, h + 7.5);
}

/** Walled garden in quarters: orange trees, palms at the corners and a domed pavilion at the crossing. */
function riadGarden(B: Builder, cx: number, cz: number): void {
  const { rng } = B;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    palm(B, cx + sx * 16, cz + sz * 16, 8 + rng() * 2);
    for (let k = 0; k < 3; k++) tree(B, cx + sx * (6 + rng() * 8), cz + sz * (6 + rng() * 8), 0.7 + rng() * 0.2, TREE_ROUND);
  }
  const r = 3.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    B.faces.box(cx + sx * r - 0.3, 0, cz + sz * r - 0.3, cx + sx * r + 0.3, 3.4, cz + sz * r + 0.3, M_CONCRETE, 226, 220, 206, 0);
    B.colliders.push(cx + sx * r - 0.3, cz + sz * r - 0.3, cx + sx * r + 0.3, cz + sz * r + 0.3);
  }
  B.faces.box(cx - r - 0.4, 3.4, cz - r - 0.4, cx + r + 0.4, 4.2, cz + r + 0.4, M_CONCRETE, 226, 220, 206, 0, M_CONCRETE, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  dome(B.faces, cx, 4.2, cz, r, 8, 3, M_TILES, pick(rng, DOME_TILES));
  fountain(B, cx, cz, 1.2, [60, 110, 170]);
  B.maxH = Math.max(B.maxH, 8);
}
