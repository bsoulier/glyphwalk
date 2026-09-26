import { F_GENERIC, F_GLASS, FLOOR_H, facadeSeed } from '../../render/facades';
import { M_CONCRETE, M_ROOF, M_WALL } from '../../render/materials';
import {
  type Builder, type Rect, G_PIPE, LIGHT_BLINK, LIGHT_LAMP, TREE_ROUND,
  jitter, park, pick, sideOf, streetSides, streetTrees, wallSign,
} from '../build';
import { BOX_DEFAULT } from '../faces';
import { LOBBY, LOUNGE, OFFICE } from '../furniture';
import { enterable } from '../interior';
import { KIND_PARK, KIND_PLAZA, P, heightScale } from '../layout';
import { NEON, SIGNS_DOWNTOWN, TEXT_LOBBY, type RGB } from '../signs';

const GLASS: readonly RGB[] = [[70, 92, 130], [60, 80, 112], [92, 112, 146], [52, 72, 94], [112, 122, 138], [60, 100, 110]];
const CONCRETE: readonly RGB[] = [[102, 102, 108], [122, 118, 112], [86, 86, 96], [112, 80, 132]];

export function buildDowntown(B: Builder, i: number, j: number, kind: number, lot: Rect): void {
  if (kind === KIND_PARK) return park(B, i, j, lot, TREE_ROUND, true);
  if (kind === KIND_PLAZA) return plaza(B, lot);
  const { rng } = B;
  const scale = heightScale(i, j) * 1.2 + 25;
  const { x0, z0, x1, z1 } = lot;
  const layout = rng();
  const mx = x0 + (x1 - x0) * (0.35 + rng() * 0.3);
  const mz = z0 + (z1 - z0) * (0.35 + rng() * 0.3);
  const gap = 0.8;
  const rects: Rect[] = [];
  if (layout < 0.25) rects.push(lot);
  else if (layout < 0.45) rects.push({ x0, z0, x1: mx - gap, z1 }, { x0: mx + gap, z0, x1, z1 });
  else if (layout < 0.65) rects.push({ x0, z0, x1, z1: mz - gap }, { x0, z0: mz + gap, x1, z1 });
  else {
    rects.push(
      { x0, z0, x1: mx - gap, z1: mz - gap }, { x0: mx + gap, z0, x1, z1: mz - gap },
      { x0, z0: mz + gap, x1: mx - gap, z1 }, { x0: mx + gap, z0: mz + gap, x1, z1 },
    );
  }
  // At most one tower per block has a public lobby; the choice uses the separate stream.
  let lobby = B.alt() < 0.55;
  for (const r of rects) {
    const inset = rng() < 0.3 ? rng() * 2.5 : 0;
    if (tower(B, { x0: r.x0 + inset, z0: r.z0 + inset, x1: r.x1 - inset, z1: r.z1 - inset }, lot, scale, lobby)) lobby = false;
  }
  if (rng() < 0.25) streetTrees(B, i * P, j * P, TREE_ROUND, 0.8, [24, 40]);
}

/** Returns true when the tower was built with a lobby you can walk into. */
function tower(B: Builder, r: Rect, lot: Rect, scale: number, lobby: boolean): boolean {
  const { rng, faces } = B;
  const glass = rng() < 0.7;
  const fac = glass ? F_GLASS : F_GENERIC;
  const fh = FLOOR_H[fac];
  const floors = Math.max(3, Math.round((scale * (0.35 + rng() * 0.9)) / fh));
  const h = floors * fh + 0.6;
  const c = jitter(rng, pick(rng, glass ? GLASS : CONCRETE));
  const seed = facadeSeed(fac, glass ? 0 : Math.floor(rng() * 4), Math.floor(rng() * 8), rng() < (glass ? 0.3 : 0.5) ? 1 : 0, Math.floor(rng() * 4096));
  const sides = streetSides(r, lot);

  let top = r;
  let baseH = h;
  let entered = false;
  if (h > 45 && rng() < 0.55) {
    baseH = Math.round((h * 0.62) / fh) * fh;
    faces.box(r.x0, 0, r.z0, r.x1, baseH, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF);
    const ins = Math.min(4, (r.x1 - r.x0) * 0.18, (r.z1 - r.z0) * 0.18);
    top = { x0: r.x0 + ins, z0: r.z0 + ins, x1: r.x1 - ins, z1: r.z1 - ins };
    faces.box(top.x0, baseH, top.z0, top.x1, h, top.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF, BOX_DEFAULT);
  } else if (lobby && sides.length > 0) {
    enterable(B, {
      rect: r, side: sides[Math.floor(B.alt() * sides.length)], h,
      mat: M_WALL, color: c, seed, capMat: M_ROOF, mask: BOX_DEFAULT,
      doorW: 2.2, label: 'OFFICE TOWER', sign: TEXT_LOBBY, open: false, canopy: true,
      programs: [LOBBY, OFFICE, LOUNGE], text: -1,
    });
    entered = true;
  } else {
    faces.box(r.x0, 0, r.z0, r.x1, h, r.z1, M_WALL, c[0], c[1], c[2], seed, M_ROOF);
  }
  if (!entered) B.colliders.push(r.x0, r.z0, r.x1, r.z1);
  B.maxH = Math.max(B.maxH, h);

  if (h > 50 && rng() < 0.5) {
    const ax = (top.x0 + top.x1) / 2, az = (top.z0 + top.z1) / 2;
    const ah = 6 + rng() * 14;
    B.poles.push(ax, h, h + ah, az, 0.15, 125, 125, 135, G_PIPE, 0);
    B.lights.push(ax, h + ah, az, 255, 40, 40, LIGHT_BLINK);
    B.maxH = Math.max(B.maxH, h + ah);
  }
  if (sides.length === 0) return entered;
  if (rng() < 0.5) wallSign(B, sideOf(r, pick(rng, sides)), SIGNS_DOWNTOWN, NEON, 4 + rng() * 2.5, 1);
  if (baseH > 30 && rng() < 0.4) wallSign(B, sideOf(r, pick(rng, sides)), SIGNS_DOWNTOWN, NEON, baseH * (0.45 + rng() * 0.25), 3);
  return entered;
}

function plaza(B: Builder, lot: Rect): void {
  const { rng, faces } = B;
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
  const top = 10 + rng() * 8;
  faces.box(cx - 3, 0, cz - 3, cx + 3, 1.2, cz + 3, M_CONCRETE, 120, 115, 110, 0);
  faces.box(cx - 0.9, 1.2, cz - 0.9, cx + 0.9, top, cz + 0.9, M_CONCRETE, 145, 140, 132, 0);
  B.lights.push(cx, top + 0.4, cz, 120, 220, 255, LIGHT_LAMP);
  B.colliders.push(cx - 3, cz - 3, cx + 3, cz + 3);
  const kioskSeed = facadeSeed(F_GENERIC, 3, 7, 1, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const kx = cx + sx * 12, kz = cz + sz * 12;
    faces.box(kx - 1.6, 0, kz - 1.6, kx + 1.6, 2.9, kz + 1.6, M_WALL, 140, 120, 150, kioskSeed | (Math.floor(rng() * 4096) << 6), M_ROOF);
    B.colliders.push(kx - 1.6, kz - 1.6, kx + 1.6, kz + 1.6);
    B.props.box(kx - sx * 5 - 1, 0, kz - 0.25, kx - sx * 5 + 1, 0.5, kz + 0.25, M_CONCRETE, 110, 100, 90, 0);
  }
  B.maxH = Math.max(B.maxH, top + 1);
}
