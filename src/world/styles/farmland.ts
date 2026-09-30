import { hash3 } from '../../core/hash';
import { M_LEAF, M_PAINT, M_TRUNK, M_WOOD } from '../../render/materials';
import { type Builder, G_PIPE } from '../build';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP } from '../faces';
import { CROP_HAY, CROP_PASTURE, fieldAt } from '../fields';
import { HOOD_BLOCKS, inCity, roadEW, roadNS } from '../hoods';
import { P, worldSeed } from '../layout';
import type { RGB } from '../signs';

const POLE: RGB = [104, 80, 58];
const WIRE: RGB = [36, 36, 40];
const RAIL: RGB = [150, 132, 104];
const LEAVES: readonly RGB[] = [[46, 92, 42], [58, 104, 44], [40, 80, 40]];
/** Crowns are seen from beneath when you walk under them. */
const BOX_ALL = BOX_SIDES | BOX_TOP | BOX_BOTTOM;

/**
 * A block of farmland. The crops are the ground painter's; what stands here is what lines the country
 * roads round each section: utility poles, now and then a windbreak of trees, fences round pasture, and
 * a lone tree or two out in the grass. Tree crowns go in the block's faces rather than its props, so
 * they still stand on the horizon across the open fields.
 */
export function buildFarmland(B: Builder, i: number, j: number): void {
  const bx = i * P, bz = j * P;
  const crop = fieldAt(i, j) & 7;
  // Poles run on the east side of north-south roads and the north side of east-west ones.
  if (roadNS(i, j) && !inCity(i - 1, j)) poleLine(B, bx + 7, bz, true);
  if (roadEW(j, i) && !inCity(i, j - 1)) poleLine(B, bx, bz + 7, false);
  // Windbreaks along whole sides of a section, on the far side of the road from the poles.
  if (roadNS(i + 1, j) && !inCity(i + 1, j) && windbreak(i + 1, Math.floor(j / HOOD_BLOCKS), 0x3a1)) {
    treeRow(B, bx + P - 10, bz, true);
  }
  if (roadEW(j + 1, i) && !inCity(i, j + 1) && windbreak(j + 1, Math.floor(i / HOOD_BLOCKS), 0x3a2)) {
    treeRow(B, bx, bz + P - 10, false);
  }
  if (crop === CROP_PASTURE) {
    if (roadNS(i, j)) fence(B, bx + 9, bz, true);
    if (roadNS(i + 1, j)) fence(B, bx + P - 9, bz, true);
    if (roadEW(j, i)) fence(B, bx, bz + 9, false);
    if (roadEW(j + 1, i)) fence(B, bx, bz + P - 9, false);
  }
  if ((crop === CROP_PASTURE || crop === CROP_HAY) && B.rng() < 0.6) {
    oak(B, bx + 18 + B.rng() * 28, bz + 18 + B.rng() * 28, 1.6 + B.rng() * 0.8);
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

/** A windbreak: tall trees close together the length of the block, their crowns almost touching. */
function treeRow(B: Builder, x: number, z: number, alongZ: boolean): void {
  const poplar = B.rng() < 0.5;
  const c = LEAVES[Math.floor(B.rng() * LEAVES.length)];
  for (let t = 3; t < P; t += 6.4) {
    const u = t + (B.rng() - 0.5) * 1.2;
    const px = alongZ ? x : x + u, pz = alongZ ? z + u : z;
    const h = (poplar ? 11 : 8) + B.rng() * 3;
    const w = poplar ? 1.5 : 2.8;
    B.poles.push(px, 0, 3, pz, 0.2, 90, 70, 50, G_PIPE, M_TRUNK);
    B.faces.box(px - w, 2.4, pz - w, px + w, h, pz + w, M_LEAF, c[0], c[1], c[2], Math.floor(B.rng() * 65536), M_LEAF);
    B.maxH = Math.max(B.maxH, h);
  }
}

/** Post-and-rail fence the length of the block. */
function fence(B: Builder, x: number, z: number, alongZ: boolean): void {
  for (let t = 1.5; t < P; t += 3) {
    B.poles.push(alongZ ? x : x + t, 0, 1.2, alongZ ? z + t : z, 0.06, RAIL[0], RAIL[1], RAIL[2], G_PIPE, M_WOOD);
  }
  for (const y of [0.55, 1.0]) {
    if (alongZ) B.props.box(x - 0.04, y, z, x + 0.04, y + 0.1, z + P, M_WOOD, RAIL[0], RAIL[1], RAIL[2], 0);
    else B.props.box(x, y, z - 0.04, x + P, y + 0.1, z + 0.04, M_WOOD, RAIL[0], RAIL[1], RAIL[2], 0);
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
