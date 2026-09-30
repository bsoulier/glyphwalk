import type { Camera } from '../render/camera';
import { M_CLOTH, M_PAINT } from '../render/materials';
import { drawBoxYaw, drawPoint, sphereVisible } from '../render/raster';
import { glyph } from '../core/charset';
import { hash3, mulberry32 } from '../core/hash';
import type { City } from './city';
import { FACE_STRIDE } from './faces';
import { HOODS, H_FARMLAND, roadEW, roadNS } from './hoods';
import { inCab, onStairs } from './interior';
import { LOT_EDGE, P, worldSeed } from './layout';

export interface Cat {
  id: string;
  hood: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  coat: number;
  where: 'shop' | 'street' | 'roof';
  /** Seconds since it was found, for the sparkle; Infinity once it has faded. */
  since: number;
}

/** Cats to find in each district. */
export const CATS_PER_HOOD = 9;
const COATS: readonly (readonly [number, number, number])[] = [
  [34, 34, 38], [205, 120, 52], [132, 132, 140], [226, 224, 216], [122, 90, 60], [70, 64, 60],
];
const EYES: readonly (readonly [number, number, number])[] = [[170, 255, 90], [255, 210, 70], [120, 220, 255]];
const G_STAR = glyph('*');
const G_DOT = glyph('.');
const KEY = 'glyphwalk.cats.v1';
const FIND_DIST = 2.6;
const DRAW_DIST = 70;

/**
 * One block in three hides a cat: in a shop, on the sidewalk against a wall, or on a roof ledge.
 * Placement is a pure function of the block, so cats are always in the same spots, and progress
 * only needs to remember which ones were found.
 */
export class Cats {
  private readonly cache = new Map<string, Cat | null>();
  private readonly found = new Set<string>();
  private readonly perHood: number[] = HOODS.map(() => 0);

  constructor(private readonly city: City) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
      for (const id of saved) this.mark(id);
    } catch {
      // No saved progress yet.
    }
  }

  private mark(id: string): void {
    if (this.found.has(id)) return;
    this.found.add(id);
    const hood = Number(id.split(':')[0]);
    if (hood >= 0 && hood < this.perHood.length) this.perHood[hood]++;
  }

  count(hood: number): number {
    return Math.min(CATS_PER_HOOD, this.perHood[hood]);
  }

  get total(): number {
    return this.perHood.reduce((s, n) => s + Math.min(CATS_PER_HOOD, n), 0);
  }

  isFound(c: Cat): boolean {
    return this.found.has(c.id);
  }

  catIn(i: number, j: number): Cat | null {
    const k = `${i},${j}`;
    let c = this.cache.get(k);
    if (c === undefined) {
      c = this.place(i, j);
      this.cache.set(k, c);
      if (this.cache.size > 4000) this.cache.clear();
    }
    return c;
  }

  private place(i: number, j: number): Cat | null {
    const h = hash3(i, j, worldSeed ^ 0xca7);
    if (h % 3 !== 0) return null;
    const rnd = mulberry32(h);
    const b = this.city.get(i, j);
    const make = (x: number, y: number, z: number, yaw: number, where: Cat['where']): Cat => ({
      id: `${b.hood}:${i}:${j}`, hood: b.hood, x, y, z, yaw, where, coat: Math.floor(rnd() * COATS.length), since: Infinity,
    });
    const roll = rnd();
    // Inside a shop or flat, on any storey, clear of furniture and off the lift or stairs.
    if (roll < 0.4 && b.interiors.length > 0) {
      const it = b.interiors[Math.floor(rnd() * b.interiors.length)];
      const lv = it.levels[Math.floor(rnd() * it.levels.length)];
      for (let k = 0; k < 16; k++) {
        const x = it.x0 + 0.8 + rnd() * (it.x1 - it.x0 - 1.6);
        const z = it.z0 + 0.8 + rnd() * (it.z1 - it.z0 - 1.6);
        if (inCab(it, x, z) || onStairs(it, x, z) || this.city.collides(x, z, 0.35, lv.y + 0.01)) continue;
        return make(x, lv.y, z, rnd() * Math.PI * 2, 'shop');
      }
    }
    // Out in the farmland, only by a road: never up a tree or out in the middle of a field.
    const rural = b.hood === H_FARMLAND;
    // On a roof or ledge: any upward face big enough to sit on.
    if (roll < 0.65 && !rural) {
      const f = b.faces;
      const tops: number[][] = [];
      for (let o = 0; o < f.length; o += FACE_STRIDE) {
        if (f[o + 21] < 0.99 || f[o + 1] < 2.5 || f[o + 1] > 90) continue;
        const xs = [f[o], f[o + 3], f[o + 6], f[o + 9]], zs = [f[o + 2], f[o + 5], f[o + 8], f[o + 11]];
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
        if (x1 - x0 > 2 && z1 - z0 > 2) tops.push([x0, x1, z0, z1, f[o + 1]]);
      }
      if (tops.length > 0) {
        const [x0, x1, z0, z1, y] = tops[Math.floor(rnd() * tops.length)];
        // Sit by an edge, looking out over it.
        const side = Math.floor(rnd() * 4);
        const u = 0.25 + rnd() * 0.5;
        const x = side === 0 ? x0 + 0.4 : side === 1 ? x1 - 0.4 : x0 + (x1 - x0) * u;
        const z = side === 2 ? z0 + 0.4 : side === 3 ? z1 - 0.4 : z0 + (z1 - z0) * u;
        const yaw = side === 0 ? -Math.PI / 2 : side === 1 ? Math.PI / 2 : side === 2 ? Math.PI : 0;
        return make(x, y, z, yaw, 'roof');
      }
    }
    // On the sidewalk, against the frontage, watching the street.
    for (let k = 0; k < 8; k++) {
      const side = Math.floor(rnd() * 4);
      const a = LOT_EDGE + 2 + rnd() * (P - 2 * LOT_EDGE - 4);
      const off = LOT_EDGE - 0.6;
      const x = i * P + (side === 0 ? off : side === 1 ? P - off : a);
      const z = j * P + (side === 2 ? off : side === 3 ? P - off : a);
      if (rural && !(side === 0 ? roadNS(i, j) : side === 1 ? roadNS(i + 1, j) : side === 2 ? roadEW(j, i) : roadEW(j + 1, i))) continue;
      if (this.city.collides(x, z, 0.3, 0)) continue;
      const yaw = side === 0 ? -Math.PI / 2 : side === 1 ? Math.PI / 2 : side === 2 ? Math.PI : 0;
      return make(x, 0, z, yaw, 'street');
    }
    return null;
  }

  /** Cats in the 3x3 blocks around a point. */
  private *around(x: number, z: number, reach = 1): Generator<Cat> {
    const bi = Math.floor(x / P), bj = Math.floor(z / P);
    for (let i = bi - reach; i <= bi + reach; i++) {
      for (let j = bj - reach; j <= bj + reach; j++) {
        const c = this.catIn(i, j);
        if (c) yield c;
      }
    }
  }

  /** Marks a cat found when the camera is close and roughly facing it; returns it once. */
  update(dt: number, cam: Camera): Cat | null {
    let hit: Cat | null = null;
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    for (const c of this.around(cam.x, cam.z)) {
      if (c.since < 3) c.since += dt;
      else if (c.since !== Infinity) c.since = Infinity;
      if (hit || this.found.has(c.id)) continue;
      const dx = c.x - cam.x, dy = c.y + 0.3 - cam.y, dz = c.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > FIND_DIST) continue;
      const hd = Math.hypot(dx, dz);
      if (hd > 0.3 && (dx * fx + dz * fz) / hd < 0.3) continue;
      this.mark(c.id);
      c.since = 0;
      hit = c;
      try {
        localStorage.setItem(KEY, JSON.stringify([...this.found]));
      } catch {
        // Progress then lasts for the session only.
      }
    }
    return hit;
  }

  /** Nearest cat not yet found, for the occasional meow that gives its position away. */
  nearestHidden(x: number, y: number, z: number, within: number): Cat | null {
    let best: Cat | null = null, bd = within;
    for (const c of this.around(x, z, 1)) {
      if (this.found.has(c.id)) continue;
      const d = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  draw(cam: Camera, time: number): void {
    for (const c of this.around(cam.x, cam.z, 1)) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d > DRAW_DIST || !sphereVisible(c.x, c.y + 0.25, c.z, 0.6)) continue;
      const found = this.found.has(c.id);
      // Found cats recognise you and turn to watch.
      const yaw = found ? Math.atan2(cam.x - c.x, cam.z - c.z) : c.yaw;
      drawCat(c, yaw, time, found, d);
    }
  }
}

function drawCat(c: Cat, yaw: number, time: number, found: boolean, dist: number): void {
  const col = COATS[c.coat];
  const [r, g, b] = col;
  const fX = Math.sin(yaw), fZ = Math.cos(yaw), rX = fZ, rZ = -fX;
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [c.x + rX * lx + fX * lz, c.y + ly, c.z + rZ * lx + fZ * lz];
  const seed = c.coat * 97;
  let p = at(0, 0.1, -0.06);
  drawBoxYaw(p[0], p[1], p[2], yaw, 0.12, 0.1, 0.14, M_CLOTH, r, g, b, seed);
  p = at(0, 0.21, 0.07);
  drawBoxYaw(p[0], p[1], p[2], yaw, 0.09, 0.12, 0.07, M_CLOTH, r * 1.08, g * 1.08, b * 1.08, seed);
  const nod = Math.sin(time * 0.7 + c.x) * 0.012;
  p = at(0, 0.37 + nod, 0.12);
  drawBoxYaw(p[0], p[1], p[2], yaw, 0.08, 0.065, 0.07, M_CLOTH, r, g, b, seed);
  if (dist < 25) {
    for (const s of [-1, 1]) {
      p = at(s * 0.05, 0.46 + nod, 0.11);
      drawBoxYaw(p[0], p[1], p[2], yaw, 0.022, 0.03, 0.012, M_PAINT, r * 0.8, g * 0.8, b * 0.8, seed);
    }
    const swish = Math.sin(time * 2.1 + c.z) * 0.5;
    p = at(Math.sin(swish) * 0.12, 0.04, -0.3);
    drawBoxYaw(p[0], p[1], p[2], yaw + swish, 0.022, 0.022, 0.13, M_CLOTH, r * 0.9, g * 0.9, b * 0.9, seed);
  }
  // Eyes catch the light: bright and far-reaching until found, then just a glint.
  const e = EYES[c.coat % EYES.length];
  const k = found ? 0.45 : 1;
  for (const s of [-1, 1]) {
    p = at(s * 0.035, 0.38 + nod, 0.195);
    drawPoint(p[0], p[1], p[2], G_DOT, e[0] * k, e[1] * k, e[2] * k, 0.2, 1);
  }
  if (c.since < 3) {
    const t = c.since;
    for (let n = 0; n < 3; n++) {
      const a = t * 2 + n * 2.1;
      drawPoint(c.x + Math.cos(a) * 0.35, c.y + 0.6 + t * 0.25, c.z + Math.sin(a) * 0.35, G_STAR, 255, 220 - n * 40, 120 + n * 50, 0.3, 1);
    }
  }
}
