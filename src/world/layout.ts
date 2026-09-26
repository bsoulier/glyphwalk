import { hash3, valueNoise } from '../core/hash';

/** Block period: road centre lines sit at every multiple of P on both axes. */
export const P = 64;
export const HALF = P / 2;
export const ROAD_HALF = 6;
export const SIDEWALK = 4.5;
export const LOT_EDGE = ROAD_HALF + SIDEWALK;
export const LANE = 3;
export const LAMP_OFF = 6.8;
export const LAMP_SPACING = 16;
export const LAMP_H = 5.4;
export const TREE_OFF = 9.4;
export const RAIL_Y = 11;
export const RAIL_TOP = RAIL_Y + 1.2;

export const KIND_CITY = 0;
export const KIND_PARK = 1;
export const KIND_PLAZA = 2;

export let worldSeed = 1337;
export function setWorldSeed(seed: number): void {
  worldSeed = seed | 0;
}

export function blockKind(i: number, j: number): number {
  const h = hash3(i, j, worldSeed ^ 0x51f) % 100;
  return h < 8 ? KIND_PARK : h < 12 ? KIND_PLAZA : KIND_CITY;
}

export function hasPond(i: number, j: number): boolean {
  return blockKind(i, j) === KIND_PARK && (hash3(i, j, worldSeed ^ 0x77) & 1) === 1;
}

export interface District {
  name: string;
  base: readonly (readonly [number, number, number])[];
  warm: number;
}

export const DISTRICTS: readonly District[] = [
  { name: 'OLD TOWN', base: [[150, 125, 70], [172, 142, 82], [122, 100, 60]], warm: 0.85 },
  { name: 'GLASS TOWERS', base: [[72, 92, 132], [92, 112, 152], [60, 76, 112]], warm: 0.25 },
  { name: 'HARBOUR', base: [[60, 112, 102], [82, 130, 112], [52, 92, 92]], warm: 0.4 },
  { name: 'NEON QUARTER', base: [[112, 80, 132], [92, 70, 122], [132, 92, 142]], warm: 0.5 },
  { name: 'CONCRETE', base: [[102, 102, 108], [122, 118, 112], [86, 86, 96]], warm: 0.6 },
];

export function districtAt(i: number, j: number): number {
  const n = valueNoise(i * 0.09 + 100, j * 0.09 - 40, worldSeed ^ 0x3a);
  return Math.min(DISTRICTS.length - 1, Math.floor(n * DISTRICTS.length));
}

export function heightScale(i: number, j: number): number {
  const n = valueNoise(i * 0.16, j * 0.16, worldSeed ^ 0x99);
  const downtown = Math.max(0, 1 - Math.hypot(i, j) / 6);
  return 9 + n * n * n * 150 + downtown * 70;
}
