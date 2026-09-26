import type { Camera } from '../render/camera';
import { M_AWNING, M_CLOTH, M_CONCRETE, M_GLOW, M_PAINT, M_SIGN, M_WOOD } from '../render/materials';
import { drawBoxYaw, drawPanel, drawPoint, sphereVisible, stats } from '../render/raster';
import { glyph } from '../core/charset';
import { hash3, mulberry32 } from '../core/hash';
import { HOOD_BLOCKS, H_DOWNTOWN, H_JAPAN, H_OLDTOWN, H_PARIS, hoodAt } from './hoods';
import { P, worldSeed } from './layout';
import { POSE_STAFF, POSE_STAND, POSE_STOOL, drawOccupants } from './occupants';
import {
  NEON, SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS, STALLS_DOWNTOWN, STALLS_JAPAN, STALLS_OLDTOWN, STALLS_PARIS,
  STEAMY, signSeed, type RGB,
} from './signs';

/** Stall centre line, measured from the road centre: the kerb edge of the sidewalk, in line with the lamps. */
const OFF = 6.8;
/** Positions along the block edge, between the lamp posts at 16, 32 and 48. */
const ALONG = [20, 28, 36, 44];
const HALF_W = 1.6;
const SIGN_SCALE = 0.5;
const FULL_DIST = 70;
const LIGHT_DIST = 140;
const G_o = glyph('o');
const G_STAR = glyph('*');
const G_TILDE = glyph('~');
const G_DOT = glyph('.');

interface Look {
  texts: readonly number[];
  canopyMat: number;
  canopy: readonly RGB[];
  sign: readonly RGB[];
  wood: RGB;
  stools: boolean;
}

const LOOKS: Record<number, Look> = {
  [H_JAPAN]: {
    texts: STALLS_JAPAN, canopyMat: M_CLOTH, canopy: [[150, 34, 30], [40, 52, 110], [196, 186, 164]],
    sign: [[255, 235, 200], [255, 120, 90]], wood: [120, 80, 50], stools: true,
  },
  [H_PARIS]: {
    texts: STALLS_PARIS, canopyMat: M_AWNING, canopy: [[0, 0, 0]],
    sign: [[255, 222, 160], [240, 240, 255]], wood: [96, 110, 90], stools: false,
  },
  [H_OLDTOWN]: {
    texts: STALLS_OLDTOWN, canopyMat: M_CLOTH, canopy: [[196, 176, 140], [150, 70, 50], [110, 120, 90]],
    sign: [[255, 200, 120]], wood: [110, 76, 46], stools: false,
  },
  [H_DOWNTOWN]: {
    texts: STALLS_DOWNTOWN, canopyMat: M_PAINT, canopy: [[40, 40, 52], [200, 50, 90], [30, 120, 150]],
    sign: NEON, wood: [70, 72, 80], stools: false,
  },
};

export interface Stall {
  x: number;
  z: number;
  yaw: number;
  hood: number;
  text: number;
  seed: number;
  sign: RGB;
  canopy: RGB;
  light: RGB;
  steam: boolean;
  stools: boolean;
  /** Colours of the few goods on the counter. */
  goods: RGB[];
}

interface BlockMarket {
  stalls: Stall[];
  people: Float32Array;
}

const EMPTY: BlockMarket = { stalls: [], people: new Float32Array(0) };

/**
 * A night market on the central street of every district except the docks: stalls set up along the kerb
 * at dusk and pack away at dawn. Placement is a pure function of the block, like the cats.
 */
export class Market {
  open = false;
  private readonly cache = new Map<string, BlockMarket>();

  /** Opens once the street lamps are well on and closes when they go off, with a gap so it cannot flicker. */
  setLamps(lamps: number): void {
    if (this.open ? lamps < 0.35 : lamps > 0.55) this.open = !this.open;
  }

  /** The stalls of block (i, j), whether or not the market is open. */
  stallsIn(i: number, j: number): readonly Stall[] {
    return this.block(i, j).stalls;
  }

  private block(i: number, j: number): BlockMarket {
    const k = `${i},${j}`;
    let m = this.cache.get(k);
    if (!m) {
      m = build(i, j);
      this.cache.set(k, m);
      if (this.cache.size > 3000) this.cache.clear();
    }
    return m;
  }

  private *near(x: number, z: number, reach: number): Generator<BlockMarket> {
    const bi = Math.floor(x / P), bj = Math.floor(z / P);
    for (let i = bi - reach; i <= bi + reach; i++) {
      for (let j = bj - reach; j <= bj + reach; j++) {
        const m = this.block(i, j);
        if (m.stalls.length > 0) yield m;
      }
    }
  }

  /** The counters (and stools) are solid while the market is up. */
  collides(x: number, z: number, r: number): boolean {
    if (!this.open) return false;
    for (const m of this.near(x, z, 0)) {
      for (const s of m.stalls) {
        if (Math.abs(x - s.x) > 3 || Math.abs(z - s.z) > 3) continue;
        const f = s.yaw === 0 ? 1 : -1;
        const z0 = s.z + (f > 0 ? -0.5 : -0.66), z1 = s.z + (f > 0 ? 0.66 : 0.5);
        if (x + r > s.x - HALF_W && x - r < s.x + HALF_W && z + r > z0 && z - r < z1) return true;
        if (s.stools) {
          for (const lx of [-0.65, 0.65]) {
            const sx = s.x + lx * f, sz = s.z + 0.95 * f;
            if (Math.abs(x - sx) < r + 0.17 && Math.abs(z - sz) < r + 0.17) return true;
          }
        }
      }
    }
    return false;
  }

  /** Distance to the nearest open stall (Infinity when closed or none nearby), for the sound of the crowd. */
  nearest(x: number, z: number): number {
    if (!this.open) return Infinity;
    let best = Infinity;
    for (const m of this.near(x, z, 1)) for (const s of m.stalls) best = Math.min(best, Math.hypot(s.x - x, s.z - z));
    return best;
  }

  draw(cam: Camera, time: number): void {
    if (!this.open) return;
    for (const m of this.near(cam.x, cam.z, 2)) {
      let any = false;
      for (const s of m.stalls) {
        const d = Math.hypot(s.x - cam.x, s.z - cam.z);
        if (d > LIGHT_DIST || d > cam.far) continue;
        if (d > FULL_DIST) {
          lights(s, time, false);
          continue;
        }
        if (!sphereVisible(s.x, 1.6, s.z, 2.8)) continue;
        any = true;
        stats.actors++;
        drawStall(s, time);
      }
      if (any) drawOccupants(m.people, cam, time);
    }
  }
}

function build(i: number, j: number): BlockMarket {
  const hood = hoodAt(i, j);
  const look = LOOKS[hood];
  if (!look) return EMPTY;
  const li = i - Math.floor(i / HOOD_BLOCKS) * HOOD_BLOCKS;
  const lj = j - Math.floor(j / HOOD_BLOCKS) * HOOD_BLOCKS;
  // The region's central street runs along x between the two middle rows of blocks.
  if ((li !== 1 && li !== 2) || (lj !== 1 && lj !== 2)) return EMPTY;
  const south = lj === 2;
  const rnd = mulberry32(hash3(i, j, worldSeed ^ 0x3a7));
  const stalls: Stall[] = [];
  const people: number[] = [];
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  for (const a of ALONG) {
    if (rnd() < 0.18) continue;
    const x = i * P + a, z = south ? j * P + OFF : (j + 1) * P - OFF;
    const yaw = south ? 0 : Math.PI;
    const text = pick(look.texts);
    const s: Stall = {
      x, z, yaw, hood, text,
      seed: Math.floor(rnd() * 4),
      sign: pick(look.sign),
      canopy: pick(look.canopy),
      light: hood === H_DOWNTOWN ? pick(NEON) : hood === H_JAPAN ? [255, 80, 50] : [255, 200, 120],
      steam: STEAMY.includes(text),
      stools: look.stools,
      goods: [0, 1, 2].map(() => pick([[220, 60, 50], [240, 200, 90], [90, 170, 80], [230, 230, 220], [160, 90, 50]] as RGB[])),
    };
    stalls.push(s);
    const f = south ? 1 : -1;
    const person = (lx: number, lz: number, faceYaw: number, pose: number) => {
      people.push(x + lx * f, 0, z + lz * f, faceYaw, pose, Math.floor(rnd() * 4096));
    };
    person(0, -0.95, yaw, POSE_STAFF);
    for (const lx of [-0.65, 0.65]) {
      if (rnd() < 0.45) person(lx, 0.95, yaw + Math.PI, s.stools ? POSE_STOOL : POSE_STAND);
    }
  }
  return { stalls, people: new Float32Array(people) };
}

/** Local stall coordinates (x along the counter, z toward the customers) to world. */
function at(s: Stall, lx: number, lz: number): [number, number] {
  const f = s.yaw === 0 ? 1 : -1;
  return [s.x + lx * f, s.z + lz * f];
}

function box(s: Stall, lx: number, y: number, lz: number, hx: number, hy: number, hz: number, mat: number, c: RGB, seed = 0, mask = 31): void {
  const [x, z] = at(s, lx, lz);
  drawBoxYaw(x, y, z, s.yaw, hx, hy, hz, mat, c[0], c[1], c[2], seed, mask);
}

function drawStall(s: Stall, time: number): void {
  const w = LOOKS[s.hood].wood;
  const dark: RGB = [w[0] * 0.6, w[1] * 0.6, w[2] * 0.6];
  const light: RGB = [w[0] * 1.4, w[1] * 1.35, w[2] * 1.3];
  box(s, 0, 0.48, 0, 1.5, 0.48, 0.5, M_WOOD, w);
  box(s, 0, 1.0, 0.08, HALF_W, 0.035, 0.58, M_WOOD, light);
  for (const sx of [-1, 1]) box(s, sx * 1.52, 1.72, -0.46, 0.04, 0.72, 0.04, M_WOOD, dark);
  // The canopy is above eye level, so its underside is the face people actually see.
  box(s, 0, 2.46, 0.3, 1.72, 0.05, 0.98, LOOKS[s.hood].canopyMat, s.canopy, s.seed, 63);

  // Signboard on top of the canopy, lettered on both faces so it reads from the road and the sidewalk.
  const len = SIGN_TEXTS[s.text].length;
  const wu = len * SIGN_CHAR_W + 2 * SIGN_PAD;
  const hw = (wu * SIGN_SCALE) / 2, hh = (SIGN_H * SIGN_SCALE) / 2;
  const seed = signSeed(s.text, 1, SIGN_SCALE);
  const [sx, sz] = at(s, 0, -0.3);
  drawPanel(sx, 2.51 + hh, sz, s.yaw, hw, hh, wu, SIGN_H, M_SIGN, s.sign[0], s.sign[1], s.sign[2], seed);
  drawPanel(sx, 2.51 + hh, sz, s.yaw + Math.PI, hw, hh, wu, SIGN_H, M_SIGN, s.sign[0], s.sign[1], s.sign[2], seed);

  s.goods.forEach((c, k) => box(s, -1.1 + k * 0.4, 1.1, 0.25, 0.12, 0.07, 0.1, M_PAINT, c));
  if (s.steam) {
    box(s, 0.85, 1.14, -0.1, 0.22, 0.12, 0.22, M_CONCRETE, [70, 72, 78]);
    for (let k = 0; k < 5; k++) {
      const t = (time * 0.45 + k / 5) % 1;
      const [px, pz] = at(s, 0.85 + Math.sin(time * 1.3 + k * 2.1) * 0.12 * t, -0.1);
      const q = 170 * (1 - t);
      drawPoint(px, 1.3 + t * 1.0, pz, t < 0.5 ? G_TILDE : G_DOT, q, q, q * 1.05, 0.15, 1);
    }
  }
  if (s.stools) {
    for (const lx of [-0.65, 0.65]) {
      box(s, lx, 0.74, 0.95, 0.17, 0.03, 0.17, M_WOOD, light);
      box(s, lx, 0.36, 0.95, 0.04, 0.36, 0.04, M_WOOD, dark);
    }
  }
  lights(s, time, true);
}

/** Lamps and lanterns: drawn as geometry up close, and as single points far away so the market twinkles. */
function lights(s: Stall, time: number, near: boolean): void {
  const [bx, bz] = at(s, 0, 0.1);
  drawPoint(bx, 2.3, bz, G_STAR, 255, 226, 170, 0.5, 1);
  const c = s.light;
  switch (s.hood) {
    case H_JAPAN:
      for (const sx of [-1.5, 1.5]) {
        const [x, z] = at(s, sx, 1.18);
        const sway = Math.sin(time * 1.1 + s.x) * 0.02;
        if (near) drawBoxYaw(x + sway, 2.14, z, s.yaw, 0.11, 0.17, 0.11, M_GLOW, c[0], c[1], c[2], 0);
        else drawPoint(x, 2.12, z, G_o, c[0], c[1], c[2], 0.5, 1);
      }
      break;
    case H_PARIS:
      // A string of bulbs along the front edge of the awning, sagging between its ends.
      for (let k = 0; k <= 8; k++) {
        const lx = -1.6 + k * 0.4;
        const [x, z] = at(s, lx, 1.3);
        const sag = 0.12 * (1 - (lx / 1.6) ** 2);
        if (near || k % 4 === 0) drawPoint(x, 2.38 - sag, z, G_o, 255, 214, 140, 0.4, 1);
      }
      break;
    case H_OLDTOWN: {
      const [x, z] = at(s, 0, 1.0);
      const flick = 0.85 + Math.sin(time * 9 + s.x) * 0.1;
      if (near) drawBoxYaw(x, 2.12, z, s.yaw, 0.08, 0.12, 0.08, M_GLOW, 255 * flick, 170 * flick, 70 * flick, 0);
      else drawPoint(x, 2.12, z, G_o, 255, 170, 70, 0.5, 1);
      break;
    }
    case H_DOWNTOWN: {
      const [x, z] = at(s, 0, 1.3);
      if (near) drawBoxYaw(x, 2.43, z, s.yaw, 1.72, 0.03, 0.02, M_GLOW, c[0], c[1], c[2], 0);
      else drawPoint(x, 2.43, z, G_STAR, c[0], c[1], c[2], 0.5, 1);
      break;
    }
  }
}
