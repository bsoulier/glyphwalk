import { F_DECO, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_AWNING, M_CLOTH, M_CONCRETE, M_NEON, M_PAINT, M_ROOF, M_TILES, M_WALL } from '../../render/materials';
import {
  type Builder, type Lot, type Rect, G_PIPE, LIGHT_LANTERN,
  awning, bladeSign, hipRoof, jitter, palm, perimeterLots, pick, sideOf, solidBox, wallSign,
} from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP } from '../faces';
import { HOTEL_ROOM, LOBBY, LOUNGE, shopFor } from '../furniture';
import { DOOR_SHOP, doorCentre, enterable } from '../interior';
import { isBeach } from '../hoods';
import { HALF, KIND_CITY, P } from '../layout';
import { DECO_NEON, HOTELS_SEAFRONT, SIGNS_SEAFRONT, SIGN_TEXTS, TEXT_HOTEL, type RGB } from '../signs';

const PASTEL: readonly RGB[] = [
  [250, 190, 200], [180, 230, 210], [250, 236, 170], [200, 190, 240], [170, 215, 240], [250, 215, 180], [242, 238, 228],
];
const TRIM: RGB = [244, 242, 236];
const UMBRELLA_STRIPES = 4;
const LOUNGERS: readonly RGB[] = [[240, 240, 240], [60, 140, 200], [240, 120, 90], [250, 210, 60]];
const HUT: RGB = [196, 164, 100];

export function buildSeafront(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  const bx = i * P, bz = j * P;
  if (isBeach(i, j)) return beachBlock(B, lot);
  if (kind !== KIND_CITY) return palmSquare(B, lot, bx + HALF, bz + HALF);
  let hotel = B.alt() < 0.8;
  for (const L of perimeterLots(B.rng, lot, 14, 12, 19)) {
    if (deco(B, L, hotel)) hotel = false;
  }
  streetPalms(B, bx, bz);
}

/** Palms in the verge of all four streets, between the lamps. */
function streetPalms(B: Builder, bx: number, bz: number): void {
  for (const a of [24, 40]) {
    const h = () => 6 + B.rng() * 3;
    palm(B, bx + a, bz + 7.4, h());
    palm(B, bx + P - 7.4, bz + a, h());
    palm(B, bx + a, bz + P - 7.4, h());
    palm(B, bx + 7.4, bz + a, h());
  }
}

/**
 * Art Deco hotel or apartment block: pastel render, a stepped parapet over the middle of the front,
 * a marquee canopy over the door, neon tubes along the roofline and up the parapet, and often a
 * vertical name sign. Returns true when it became the block's hotel you can walk into.
 */
function deco(B: Builder, L: Lot, hotel: boolean): boolean {
  const { rng, faces } = B;
  const floors = 3 + Math.floor(rng() * 5);
  const fh = FLOOR_H[F_DECO];
  const h = floors * fh;
  const c = jitter(rng, pick(rng, PASTEL), 0.04);
  const seed = facadeSeed(F_DECO, Math.floor(rng() * 4), 3 + Math.floor(rng() * 4), rng() < 0.6 ? 1 : 0, Math.floor(rng() * 4096));
  const neon = pick(rng, DECO_NEON);
  const s = sideOf(L, L.side);
  const uc = doorCentre(seed, s.len);
  const at = (u: number, out: number): [number, number] => [s.p0x + s.tx * u + s.nx * out, s.p0z + s.tz * u + s.nz * out];
  const sbox = (u0: number, u1: number, o0: number, o1: number, y0: number, y1: number, mat: number, col: RGB, mask = BOX_SIDES | BOX_TOP, list = B.props) => {
    const [ax, az] = at(u0, o0), [bx, bz] = at(u1, o1);
    list.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), mat, col[0], col[1], col[2], 0, mat, mask);
  };

  // Stepped parapet: two tiers of plain render over the middle bays, outlined in neon.
  const pw = Math.min(s.len * 0.4, 6);
  sbox(uc - pw / 2, uc + pw / 2, -2, 0, h, h + 2.2, M_CONCRETE, TRIM, BOX_SIDES | BOX_TOP, faces);
  sbox(uc - pw / 4, uc + pw / 4, -1.4, 0, h + 2.2, h + 3.6, M_CONCRETE, TRIM, BOX_SIDES | BOX_TOP, faces);
  sbox(uc - pw / 2 - 0.1, uc - pw / 2 + 0.05, 0, 0.12, h, h + 2.2, M_NEON, neon);
  sbox(uc + pw / 2 - 0.05, uc + pw / 2 + 0.1, 0, 0.12, h, h + 2.2, M_NEON, neon);
  sbox(0.2, s.len - 0.2, 0, 0.14, h - 0.3, h - 0.15, M_NEON, neon);
  if (rng() < 0.5) sbox(0.2, s.len - 0.2, 0, 0.14, fh - 0.1, fh + 0.05, M_NEON, neon);
  B.maxH = Math.max(B.maxH, h + 4);

  // Marquee over the door: a thin white slab with a neon edge.
  sbox(uc - 2.4, uc + 2.4, 0, 1.6, 3.0, 3.18, M_PAINT, TRIM, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  sbox(uc - 2.4, uc + 2.4, 1.6, 1.68, 3.02, 3.12, M_NEON, neon);

  let text = -1;
  if (floors >= 4 && rng() < 0.7) {
    const t = uc + (rng() < 0.5 ? -1 : 1) * Math.min(pw / 2 + 1.2, s.len / 2 - 0.8);
    bladeSign(B, s, t, 4, HOTELS_SEAFRONT, DECO_NEON, h - 3.4);
  } else if (rng() < 0.6) {
    const ti = wallSign(B, s, SIGNS_SEAFRONT, DECO_NEON, h - 2.2, 1);
    if (ti >= 0) text = ti;
  }
  // Café awnings on the shop fronts either side of the entrance.
  if (rng() < 0.5 && uc - 3 > 1.5) awning(B, s, 0.6, uc - 3, 3.0, 1.6, Math.floor(rng() * 4));
  if (rng() < 0.5 && s.len - uc - 3 > 1.5) awning(B, s, uc + 3, s.len - 0.6, 3.0, 1.6, Math.floor(rng() * 4));

  const shop = shopFor(text);
  const base = { rect: L, side: L.side, h, mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_SIDES | BOX_TOP };
  if (hotel && floors >= 3) {
    enterable(B, {
      ...base, doorW: 2, label: 'HOTEL', sign: text >= 0 ? -1 : TEXT_HOTEL, open: false, canopy: false,
      programs: [LOBBY, HOTEL_ROOM, LOUNGE], text: -1,
    });
    return true;
  }
  if (shop && B.alt() < 0.7) {
    enterable(B, { ...base, doorW: 1.6, label: SIGN_TEXTS[text], sign: -1, open: true, canopy: false, programs: [shop, null, null], text, entrance: DOOR_SHOP });
    return false;
  }
  faces.box(L.x0, 0, L.z0, L.x1, h, L.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_SIDES | BOX_TOP);
  B.colliders.push(L.x0, L.z0, L.x1, L.z1);
  return false;
}

/** Sand to the water's edge: palms along the promenade, parasols and loungers, a lifeguard tower, a tiki bar. */
function beachBlock(B: Builder, lot: Rect): void {
  const { rng } = B;
  const cz = (lot.z0 + lot.z1) / 2;
  for (let x = lot.x0 + 2; x < lot.x1 - 1; x += 6.2) palm(B, x + (rng() - 0.5), lot.z0 + 1.2 + rng(), 6.5 + rng() * 3);
  // Parasols in two loose rows on the dry sand.
  for (let x = lot.x0 + 4; x < lot.x1 - 3; x += 5 + rng() * 2) {
    if (rng() < 0.2) continue;
    const z = lot.z0 + 7 + rng() * 6;
    B.poles.push(x, 0, 2.3, z, 0.04, 220, 220, 220, G_PIPE, 0);
    hipRoof(B.props, { x0: x - 1.2, z0: z - 1.2, x1: x + 1.2, z1: z + 1.2 }, 2.05, 0.45, 1.2, 0, M_AWNING, [0, 0, 0], Math.floor(rng() * UMBRELLA_STRIPES), 0, true);
    const lc = pick(rng, LOUNGERS);
    for (const s of [-0.5, 0.5]) B.props.box(x + s - 0.3, 0.1, z + 0.3, x + s + 0.3, 0.32, z + 2.1, M_CLOTH, lc[0], lc[1], lc[2], 0);
  }
  B.maxH = Math.max(B.maxH, 10);

  // Lifeguard tower on stilts near the waterline, painted in bright blocks.
  const lx = lot.x0 + 8 + rng() * (lot.x1 - lot.x0 - 16), lz = cz - 3.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    B.poles.push(lx + sx * 1, 0, 2.2, lz + sz * 1, 0.08, 230, 230, 230, G_PIPE, M_PAINT);
    B.colliders.push(lx + sx - 0.1, lz + sz - 0.1, lx + sx + 0.1, lz + sz + 0.1);
  }
  const tc = pick(rng, [[80, 200, 220], [250, 120, 170], [250, 210, 80]] as RGB[]);
  B.props.box(lx - 1.2, 2.2, lz - 1.2, lx + 1.2, 2.35, lz + 1.2, M_PAINT, 230, 230, 230, 0, M_PAINT, BOX_SIDES | BOX_TOP | BOX_BOTTOM);
  B.props.box(lx - 1.05, 2.35, lz - 1.05, lx + 1.05, 4.1, lz + 1.05, M_PAINT, tc[0], tc[1], tc[2], 0);
  hipRoof(B.props, { x0: lx - 1.05, z0: lz - 1.05, x1: lx + 1.05, z1: lz + 1.05 }, 4.1, 0.6, 1.05, 0.3, M_PAINT, [240, 240, 240], 0, 0, true);
  B.poles.push(lx + 1.3, 4.1, 6.4, lz, 0.03, 200, 200, 200, G_PIPE, 0);
  B.props.box(lx + 1.33, 5.8, lz - 0.02, lx + 2.1, 6.3, lz + 0.02, M_PAINT, 220, 40, 40, 0, M_PAINT, BOX_SIDES);

  // Tiki bar at one end of the beach.
  const tx = rng() < 0.5 ? lot.x0 + 4 : lot.x1 - 4, tz = lot.z0 + 4;
  const hut = { x0: tx - 2.2, z0: tz - 1.6, x1: tx + 2.2, z1: tz + 1.6 };
  solidBox(B, hut, 0, 1.1, M_PAINT, [120, 84, 52], 0, true, BOX_SIDES | BOX_TOP);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.poles.push(tx + sx * 2.1, 1.1, 2.6, tz + sz * 1.5, 0.07, 120, 90, 60, G_PIPE, M_PAINT);
  hipRoof(B.props, hut, 2.6, 1.4, 2, 0.7, M_TILES, HUT, 0, 0, true);
  wallSign(B, sideOf(hut, 0), SIGNS_SEAFRONT.filter((k) => SIGN_TEXTS[k].length <= 4), DECO_NEON, 1.2, 0.5);
  for (let k = 0; k < 6; k++) B.lights.push(tx - 2.6 + k * 1.04, 2.5, tz - 2.3, 255, [120, 200, 80, 220, 255, 150][k], [180, 90, 255, 60, 120, 80][k], LIGHT_LANTERN);

  // A sailboat at anchor and a few buoys out on the water.
  if (rng() < 0.7) {
    const sx = lot.x0 + 8 + rng() * (lot.x1 - lot.x0 - 16), sz = cz + 12 + rng() * 5;
    B.props.box(sx - 2.6, 0, sz - 0.8, sx + 2.6, 0.9, sz + 0.8, M_PAINT, 240, 240, 236, 0, M_PAINT, BOX_SIDES | BOX_TOP);
    B.poles.push(sx, 0.9, 8.5, sz, 0.05, 200, 190, 170, G_PIPE, 0);
    for (const flip of [false, true]) {
      const a: [number, number, number] = [sx + 0.1, 1.4, sz], b: [number, number, number] = [sx + 2.4, 1.4, sz], t: [number, number, number] = [sx + 0.1, 8.2, sz];
      if (flip) B.props.poly(b[0], b[1], b[2], a[0], a[1], a[2], t[0], t[1], t[2], t[0], t[1], t[2], 0, 0, 2.3, 0, 2.3, 6.8, 2.3, 6.8, M_CLOTH, 245, 245, 240, 0);
      else B.props.poly(a[0], a[1], a[2], b[0], b[1], b[2], t[0], t[1], t[2], t[0], t[1], t[2], 0, 0, 2.3, 0, 0, 6.8, 0, 6.8, M_CLOTH, 245, 245, 240, 0);
    }
  }
  for (let k = 0; k < 3; k++) {
    const x = lot.x0 + 6 + k * 15 + rng() * 4, z = cz + 8 + rng() * 10;
    B.props.box(x - 0.25, 0, z - 0.25, x + 0.25, 0.6, z + 0.25, M_PAINT, k & 1 ? 240 : 230, k & 1 ? 240 : 60, k & 1 ? 240 : 40, 0);
  }
}

/** Square of palms around a bandstand. */
function palmSquare(B: Builder, lot: Rect, cx: number, cz: number): void {
  const { rng } = B;
  for (let x = lot.x0 + 4; x < lot.x1 - 2; x += 8) {
    for (let z = lot.z0 + 4; z < lot.z1 - 2; z += 8) {
      if (Math.abs(x - cx) < 6 && Math.abs(z - cz) < 6) continue;
      if (Math.abs(x - cx) < 2 || Math.abs(z - cz) < 2) continue;
      palm(B, x + (rng() - 0.5) * 2, z + (rng() - 0.5) * 2, 6 + rng() * 3);
    }
  }
  const r = { x0: cx - 3.5, z0: cz - 3.5, x1: cx + 3.5, z1: cz + 3.5 };
  B.faces.box(r.x0, 0, r.z0, r.x1, 0.6, r.z1, M_CONCRETE, TRIM[0], TRIM[1], TRIM[2], 0);
  B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.poles.push(cx + sx * 3.2, 0.6, 3.6, cz + sz * 3.2, 0.12, TRIM[0], TRIM[1], TRIM[2], G_PIPE, M_CONCRETE);
  hipRoof(B.faces, r, 3.6, 1.6, 3.5, 0.4, M_TILES, [240, 170, 190], 0, 0, true);
  B.props.box(r.x0 - 0.4, 3.5, r.z0 - 0.4, r.x1 + 0.4, 3.62, r.z1 + 0.4, M_NEON, 80, 240, 255, 0, M_NEON, BOX_SIDES);
  B.maxH = Math.max(B.maxH, 10);
}
