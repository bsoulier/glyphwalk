import { F_GENERIC, F_SIDING, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CLOTH, M_CONCRETE, M_LEAF, M_PAINT, M_PICKET, M_RAIL, M_ROOF, M_TILES, M_WALL, M_WOOD } from '../../render/materials';
import {
  type Builder, type PlotFrame, type Rect, G_PIPE, LIGHT_LAMP, TREE_ROUND,
  chimney, fenceRun, flat, gableRoof, jitter, park, parkedCar, pick, plotFrame, sideOf, solidBox, tree, wallSign,
} from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP } from '../faces';
import { BEDROOM, LIVING, shopFor } from '../furniture';
import { DOOR_HOME, doorCentre, enterable } from '../interior';
import { HALF, KIND_PARK, KIND_PLAZA, P } from '../layout';
import { SIGNS_SUBURB, SIGN_TEXTS, WARM_SIGNS, type RGB } from '../signs';

const SIDING: readonly RGB[] = [
  [206, 200, 184], [170, 196, 214], [196, 214, 190], [232, 222, 176], [214, 180, 170], [226, 226, 222], [150, 170, 190], [190, 170, 200],
];
const BRICK: readonly RGB[] = [[160, 80, 60], [170, 100, 76], [140, 76, 62]];
const STUCCO: readonly RGB[] = [[222, 206, 176], [210, 196, 180], [230, 214, 190]];
const SHINGLES: readonly RGB[] = [[74, 74, 80], [96, 74, 58], [70, 84, 104], [64, 86, 70], [128, 64, 52]];
const DOORS: readonly RGB[] = [[150, 36, 40], [30, 60, 110], [40, 90, 60], [30, 30, 34], [220, 180, 60], [240, 238, 230]];
const CARS: readonly RGB[] = [[60, 90, 210], [200, 45, 45], [205, 205, 210], [45, 45, 52], [45, 150, 95], [150, 120, 90], [120, 140, 160]];
const FLOWERS: readonly RGB[] = [[220, 80, 120], [240, 200, 70], [190, 110, 220], [240, 240, 240], [250, 130, 60]];
const WHITE: RGB = [238, 236, 228];
const FENCE_WOOD: RGB = [150, 112, 76];
const DRIVE: RGB = [168, 164, 156];
const PATH: RGB = [186, 176, 158];
const CHIMNEY: RGB = [130, 70, 56];
/** From the lot edge out to just short of the kerb, so drives cross the sidewalk and verge. */
const TO_KERB = -4.6;
const PLOTS = 3;

export function buildSuburb(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  if (kind === KIND_PARK) {
    park(B, i, j, lot, TREE_ROUND, false);
    swings(B, bx + HALF + 9, bz + HALF + 8, true);
    return;
  }
  if (kind === KIND_PLAZA) return stripMall(B, lot);
  const { rng } = B;
  // Houses face either the streets along x or those along z; the other two streets see side yards.
  const faceNS = rng() < 0.5;
  const sides = faceNS ? [0, 2] : [1, 3];
  let open = B.alt() < 0.75 ? 2 : 1;
  for (const side of sides) {
    const f = plotFrame(lot, side);
    const w = f.W / PLOTS;
    for (let k = 0; k < PLOTS; k++) {
      const plot = f.rect(k * w, 0, (k + 1) * w, f.D / 2);
      const enter = open > 0 && B.alt() < 0.4;
      house(B, plotFrame(plot, side), side, enter, k === 0, side === sides[0]);
      if (enter) open--;
    }
  }
  // Street trees on the two side streets, in the verge.
  for (const side of faceNS ? [1, 3] : [0, 2]) {
    for (const a of [24, 40]) {
      if (side === 0) tree(B, bx + a, bz + 7.1, 0.9, TREE_ROUND);
      else if (side === 2) tree(B, bx + a, bz + P - 7.1, 0.9, TREE_ROUND);
      else if (side === 1) tree(B, bx + P - 7.1, bz + a, 0.9, TREE_ROUND);
      else tree(B, bx + 7.1, bz + a, 0.9, TREE_ROUND);
    }
  }
}

/**
 * Detached house on its plot: front lawn, drive and garage on one side, porch and path to the door,
 * back garden behind a wooden fence. `first` plots also draw the fence on their left, and `back` rows
 * draw the fence along the middle of the block, so shared fences are built once.
 */
function house(B: Builder, f: PlotFrame, side: number, enter: boolean, first: boolean, back: boolean): void {
  const { rng, faces } = B;
  const { W, D } = f;
  const driveLeft = rng() < 0.5;
  const garage = rng() < 0.55;
  const floors = rng() < 0.3 ? 1 : 2;
  const h = floors * FLOOR_H[F_SIDING];
  const setback = 5 + rng() * 2;
  const hw = Math.min(garage ? W - 4.6 : W - 5, 7.6 + rng() * 2);
  const hd = 7.6 + rng() * 1.6;
  const du0 = driveLeft ? 0.6 : W - 3.6, du1 = du0 + 3;
  const hu0 = driveLeft ? (garage ? 3.9 : 4.3) : (garage ? W - 3.9 : W - 4.3) - hw;
  const r = f.rect(hu0, setback, hu0 + hw, setback + hd);

  const style = rng() < 0.6 ? Math.floor(rng() * 2) : rng() < 0.5 ? 2 : 3;
  const c = jitter(rng, pick(rng, style < 2 ? SIDING : style === 2 ? BRICK : STUCCO), 0.06);
  const seed = facadeSeed(F_SIDING, style, 3 + Math.floor(rng() * 4), 1, Math.floor(rng() * 4096));
  const roofC = pick(rng, SHINGLES);
  const parallel = rng() < 0.65;
  const ridgeAlongX = f.alongX === parallel;
  const rise = parallel ? hd * (0.3 + rng() * 0.1) : hw * (0.36 + rng() * 0.1);
  gableRoof(faces, r, h, rise, ridgeAlongX, 0.4, M_TILES, roofC, 0, M_WALL, c, seed);
  if (rng() < 0.5) {
    const [x, z] = f.pt(hu0 + (driveLeft ? hw - 1.2 : 1.2), setback + hd * 0.5);
    chimney(B, x, z, h + rise * 0.3, h + rise + 0.8, 0.4, 0.4, style === 2 ? CHIMNEY : [150, 146, 140]);
  }
  B.maxH = Math.max(B.maxH, h + rise + 1);

  const uc = hu0 + doorCentre(seed, hw);
  if (enter) {
    enterable(B, {
      rect: r, side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES,
      doorW: 1.1, label: 'HOUSE', sign: -1, open: false, canopy: false,
      programs: floors > 1 ? [LIVING, null, BEDROOM] : [LIVING, null, null], text: -1, stairs: true, entrance: DOOR_HOME,
    });
  } else {
    faces.box(r.x0, 0, r.z0, r.x1, h, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES);
    B.colliders.push(r.x0, r.z0, r.x1, r.z1);
    // Front door, just proud of the wall.
    const s = sideOf(r, side);
    const t = uc - hu0;
    const ax = s.p0x + s.tx * (t - 0.5) + s.nx * 0.03, az = s.p0z + s.tz * (t - 0.5) + s.nz * 0.03;
    const dc = pick(rng, DOORS);
    B.props.poly(ax, 0, az, ax + s.tx, 0, az + s.tz, ax + s.tx, 2.15, az + s.tz, ax, 2.15, az, 0, 0, 1, 0, 1, 2.15, 0, 2.15, M_PAINT, dc[0], dc[1], dc[2], 0);
  }
  {
    const [lx, lz] = f.pt(uc + 0.9, setback - 0.25);
    B.lights.push(lx, 2.1, lz, 255, 214, 150, LIGHT_LAMP);
  }

  // Porch: a white roof on two posts over the steps.
  if (rng() < 0.6) {
    const pr = f.rect(uc - 1.7, setback - 1.8, uc + 1.7, setback);
    B.props.box(pr.x0, 2.62, pr.z0, pr.x1, 2.78, pr.z1, M_PAINT, WHITE[0], WHITE[1], WHITE[2], 0, M_PAINT, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
    for (const u of [uc - 1.55, uc + 1.55]) {
      const [x, z] = f.pt(u, setback - 1.65);
      B.poles.push(x, 0, 2.62, z, 0.09, WHITE[0], WHITE[1], WHITE[2], G_PIPE, M_PAINT);
      B.colliders.push(x - 0.1, z - 0.1, x + 0.1, z + 0.1);
    }
  }
  {
    const st = f.rect(uc - 0.9, setback - 0.55, uc + 0.9, setback);
    B.props.box(st.x0, 0, st.z0, st.x1, 0.18, st.z1, M_CONCRETE, 170, 166, 158, 0);
  }

  // Flower bed along the front wall, either side of the door.
  if (rng() < 0.6) {
    const fl = pick(rng, FLOWERS);
    for (const [a, b] of [[hu0 + 0.2, uc - 1.0], [uc + 1.0, hu0 + hw - 0.2]]) {
      if (b - a < 0.6) continue;
      const fr = f.rect(a, setback - 0.6, b, setback - 0.05);
      B.props.box(fr.x0, 0, fr.z0, fr.x1, 0.38, fr.z1, M_LEAF, fl[0], fl[1], fl[2], Math.floor(rng() * 65536));
    }
  }

  // Garage beside the house, its door facing the street, and the drive running out to the kerb.
  let driveEnd = setback + 1;
  if (garage) {
    const gu0 = du0 - 0.2, gu1 = du1 + 0.2;
    const gd0 = setback + 0.8;
    const g = f.rect(gu0, gd0, gu1, gd0 + 6.2);
    // Plain boards, no windows: the garage must not borrow the house's window rows.
    faces.box(g.x0, 0, g.z0, g.x1, 2.9, g.z1, M_WOOD, c[0], c[1], c[2], 0, M_ROOF, BOX_SIDES);
    B.colliders.push(g.x0, g.z0, g.x1, g.z1);
    gableRoof(faces, g, 2.9, 1.2, !f.alongX, 0.25, M_TILES, roofC, 0, M_WOOD, c, 0);
    const s = sideOf(g, side);
    const ax = s.p0x + s.tx * 0.35 + s.nx * 0.03, az = s.p0z + s.tz * 0.35 + s.nz * 0.03;
    const L = s.len - 0.7;
    B.props.poly(ax, 0, az, ax + s.tx * L, 0, az + s.tz * L, ax + s.tx * L, 2.3, az + s.tz * L, ax, 2.3, az, 0, 0, L, 0, L, 2.3, 0, 2.3, M_RAIL, WHITE[0], WHITE[1], WHITE[2], 0);
    driveEnd = gd0;
  }
  flat(B, f.rect(du0, TO_KERB, du1, driveEnd), 0.02, M_CONCRETE, DRIVE);
  if (rng() < 0.65) {
    const [x, z] = f.pt((du0 + du1) / 2, driveEnd - 3);
    parkedCar(B, x, z, !f.alongX, pick(rng, CARS));
  }
  // Path from the sidewalk to the steps, unless the door is right by the drive.
  const pathClear = uc - 0.6 > du1 + 0.3 || uc + 0.6 < du0 - 0.3;
  if (pathClear) flat(B, f.rect(uc - 0.6, -0.1, uc + 0.6, setback - 0.55), 0.02, M_CONCRETE, PATH);

  // Front boundary: picket fence, low hedge or open lawn, with gaps for the drive and path.
  const gaps: [number, number][] = [[du0 - 0.1, du1 + 0.1]];
  if (pathClear) gaps.push([uc - 0.7, uc + 0.7]);
  const edge = rng();
  if (edge < 0.45) fenceRun(B, f, 0.1, W - 0.1, 0.3, 0.95, 0.04, M_PICKET, WHITE, gaps);
  else if (edge < 0.7) fenceRun(B, f, 0.1, W - 0.1, 0.4, 0.8, 0.3, M_LEAF, [44, 104, 50], gaps);
  // Mailbox by the drive.
  {
    const [x, z] = f.pt(driveLeft ? du1 + 0.5 : du0 - 0.5, -0.3);
    B.poles.push(x, 0, 1.0, z, 0.05, 90, 80, 70, G_PIPE, 0);
    B.props.box(x - 0.2, 1.0, z - 0.2, x + 0.2, 1.28, z + 0.2, M_PAINT, 40, 44, 52, 0);
  }

  // Back garden: wooden fences, a tree or two, maybe a shed or swings.
  const yard0 = setback + hd + 0.6;
  if (first) fenceRun(B, f, yard0, D - 0.1, 0.08, 1.7, 0.04, M_PICKET, FENCE_WOOD, [], true);
  fenceRun(B, f, yard0, D - 0.1, W - 0.08, 1.7, 0.04, M_PICKET, FENCE_WOOD, [], true);
  if (back) fenceRun(B, f, 0.1, W - 0.1, D - 0.08, 1.7, 0.04, M_PICKET, FENCE_WOOD);
  const trees = rng() < 0.7 ? 1 + (rng() < 0.4 ? 1 : 0) : 0;
  for (let k = 0; k < trees; k++) {
    const [x, z] = f.pt(2.5 + rng() * (W - 5), yard0 + 2.5 + rng() * Math.max(0.1, D - yard0 - 4.5));
    tree(B, x, z, 1 + rng() * 0.4, TREE_ROUND);
  }
  const extra = rng();
  if (extra < 0.25 && D - yard0 > 4.5) {
    const su = driveLeft ? W - 3.2 : 0.6;
    const shed = f.rect(su, D - 3.2, su + 2.6, D - 0.6);
    solidBox(B, shed, 0, 2.2, M_WOOD, [120, 92, 64], 0, true, BOX_SIDES);
    B.props.box(shed.x0 - 0.15, 2.2, shed.z0 - 0.15, shed.x1 + 0.15, 2.32, shed.z1 + 0.15, M_ROOF, 70, 70, 76, 0);
  } else if (extra < 0.45 && D - yard0 > 4) {
    const [x, z] = f.pt(W / 2, D - 2.4);
    swings(B, x, z, f.alongX);
  }
}

/** Swing set: two posts, a top bar and two seats on chains. */
function swings(B: Builder, x: number, z: number, alongX: boolean): void {
  const ax = alongX ? 1 : 0, az = alongX ? 0 : 1;
  for (const s of [-1.3, 1.3]) {
    B.poles.push(x + ax * s, 0, 2.3, z + az * s, 0.07, 200, 60, 50, G_PIPE, M_PAINT);
    B.colliders.push(x + ax * s - 0.1, z + az * s - 0.1, x + ax * s + 0.1, z + az * s + 0.1);
  }
  B.props.box(x - ax * 1.4 - az * 0.05, 2.25, z - az * 1.4 - ax * 0.05, x + ax * 1.4 + az * 0.05, 2.35, z + az * 1.4 + ax * 0.05, M_PAINT, 200, 60, 50, 0);
  for (const s of [-0.55, 0.55]) {
    const sx = x + ax * s, sz = z + az * s;
    B.poles.push(sx, 0.5, 2.25, sz, 0.02, 150, 150, 150, G_PIPE, 0);
    B.props.box(sx - 0.22, 0.46, sz - 0.12, sx + 0.22, 0.52, sz + 0.12, M_CLOTH, 40, 40, 44, 0);
  }
  B.maxH = Math.max(B.maxH, 2.5);
}

/** Corner shops in a one-storey row with a car park in front of them. */
function stripMall(B: Builder, lot: Rect): void {
  const { rng } = B;
  const side = Math.floor(rng() * 4);
  const f = plotFrame(lot, side);
  const depth = 12;
  const back = f.D - depth;
  const units = 4;
  const w = f.W / units;
  const h = 4.8;
  const c = jitter(rng, [200, 190, 170], 0.05);
  for (let k = 0; k < units; k++) {
    const r = f.rect(k * w + 0.05, back, (k + 1) * w - 0.05, f.D);
    const seed = facadeSeed(F_GENERIC, 1, 5, 1, Math.floor(rng() * 4096));
    const s = sideOf(r, side);
    const text = wallSign(B, s, SIGNS_SUBURB, WARM_SIGNS, 3.35, 0.5);
    const shop = shopFor(text);
    if (shop) {
      enterable(B, {
        rect: r, side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES | BOX_TOP,
        doorW: 1.6, label: SIGN_TEXTS[text], sign: -1, open: true, canopy: false, programs: [shop, null, null], text,
      });
    } else {
      B.faces.box(r.x0, 0, r.z0, r.x1, h, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF);
      B.colliders.push(r.x0, r.z0, r.x1, r.z1);
    }
  }
  const canopy = f.rect(0, back - 2.2, f.W, back);
  B.props.box(canopy.x0, 3.1, canopy.z0, canopy.x1, 3.3, canopy.z1, M_PAINT, 150, 40, 40, 0, M_PAINT, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  B.maxH = Math.max(B.maxH, h + 1);
  // Car park: asphalt with painted bays and a few cars.
  flat(B, f.rect(0, 0, f.W, back - 2.2), 0.02, M_CONCRETE, [112, 112, 116]);
  for (let u = 2.6; u < f.W - 1; u += 2.8) {
    flat(B, f.rect(u - 0.06, back - 7.4, u + 0.06, back - 2.4), 0.03, M_PAINT, [220, 220, 210]);
    if (u + 1.4 < f.W - 1 && rng() < 0.45) {
      const [x, z] = f.pt(u + 1.4, back - 4.9);
      parkedCar(B, x, z, !f.alongX, pick(rng, CARS));
    }
  }
  for (const u of [f.W * 0.25, f.W * 0.75]) {
    const [x, z] = f.pt(u, (back - 2.2) / 2 - 3);
    B.poles.push(x, 0, 6, z, 0.1, 90, 94, 100, G_PIPE, M_CONCRETE);
    B.lights.push(x, 6, z, 255, 230, 180, LIGHT_LAMP);
  }
}
