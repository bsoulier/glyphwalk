import {
  M_CLOTH, M_CONCRETE, M_GLOW, M_GOODS, M_LAMP, M_LEAF, M_PAINT, M_SCREEN, M_SIGN, M_WOOD,
} from '../render/materials';
import {
  FLOOR_CARPET, FLOOR_CHECKER, FLOOR_CONCRETE, FLOOR_PARQUET, FLOOR_TATAMI, FLOOR_TILES,
  GOODS_BAKERY, GOODS_BOOKS, GOODS_BOTTLES, GOODS_MIXED,
} from '../render/interiors';
import { hash3, mulberry32 } from '../core/hash';
import { BOX_DEFAULT, BOX_SIDES, type FaceList } from './faces';
import { POSE_CHAIR, POSE_STAFF, POSE_STAND, POSE_STOOL } from './occupants';
import { SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS, signSeed, type RGB } from './signs';

/**
 * A storey seen from its entrance: `a` runs along the front wall (left to right as you walk in) and
 * `d` runs inward from it. Everything is placed in these local metres and mapped to world boxes, so
 * the same layout works whichever way the building faces.
 */
export interface RoomFrame {
  ox: number;
  oz: number;
  ax: number;
  az: number;
  dx: number;
  dz: number;
  W: number;
  D: number;
  /** Floor surface height. */
  y: number;
  /** Clear height to the ceiling. */
  H: number;
}

export class Room {
  private readonly used: number[] = [];
  readonly W: number;
  readonly D: number;
  readonly H: number;
  /** Occupants, PERSON_STRIDE floats each (see occupants.ts). */
  readonly people: number[] = [];
  /** Chance that a seat is taken: shops are lively, homes mostly empty. */
  busy = 0.4;
  // A separate generator, so adding people never shifts where the furniture goes.
  private readonly prng: () => number;

  constructor(
    private readonly f: RoomFrame,
    readonly faces: FaceList,
    readonly lights: number[],
    readonly solids: number[],
    readonly rng: () => number,
    /** Door span along the front wall, on the ground floor only. */
    readonly door: readonly [number, number] | null,
    /** Lift shaft footprint (a0, d0, a1, d1) including its walls. */
    readonly lift: readonly [number, number, number, number] | null,
    /** The shop's own sign text, reused for its menu board; -1 when there is none. */
    readonly text: number,
  ) {
    this.W = f.W;
    this.D = f.D;
    this.H = f.H;
    this.prng = mulberry32(hash3(Math.round(f.ox * 10), Math.round(f.oz * 10), Math.round(f.y * 10) ^ 0x9e0));
    if (door) this.reserve(door[0] - 0.5, 0, door[1] + 0.5, 2.2);
    if (lift) {
      this.reserve(lift[0], lift[1], lift[2], lift[3]);
      this.reserve(lift[0] - 0.3, lift[1] - 1.9, lift[2] + 0.3, lift[1]);
    }
  }

  /** Centre of the entrance (or of the lift on upper floors), where the main aisle runs. */
  get entry(): number {
    if (this.door) return (this.door[0] + this.door[1]) / 2;
    if (this.lift) return (this.lift[0] + this.lift[2]) / 2;
    return this.W / 2;
  }

  reserve(a0: number, d0: number, a1: number, d1: number): void {
    this.used.push(Math.min(a0, a1), Math.min(d0, d1), Math.max(a0, a1), Math.max(d0, d1));
  }

  fits(a0: number, d0: number, a1: number, d1: number): boolean {
    if (a0 < -0.01 || d0 < -0.01 || a1 > this.W + 0.01 || d1 > this.D + 0.01) return false;
    const u = this.used;
    for (let k = 0; k < u.length; k += 4) {
      if (a1 > u[k] && a0 < u[k + 2] && d1 > u[k + 1] && d0 < u[k + 3]) return false;
    }
    return true;
  }

  /** Reserve the footprint if it is free; furniture is only built where this succeeds. */
  take(a0: number, d0: number, a1: number, d1: number): boolean {
    if (!this.fits(a0, d0, a1, d1)) return false;
    this.reserve(a0, d0, a1, d1);
    return true;
  }

  private world(a0: number, d0: number, a1: number, d1: number): [number, number, number, number] {
    const f = this.f;
    const xa = f.ox + f.ax * a0 + f.dx * d0, za = f.oz + f.az * a0 + f.dz * d0;
    const xb = f.ox + f.ax * a1 + f.dx * d1, zb = f.oz + f.az * a1 + f.dz * d1;
    return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
  }

  box(a0: number, d0: number, a1: number, d1: number, y0: number, y1: number, mat: number, c: RGB, seed = 0, mask = BOX_DEFAULT): void {
    const [x0, z0, x1, z1] = this.world(a0, d0, a1, d1);
    this.faces.box(x0, this.f.y + y0, z0, x1, this.f.y + y1, z1, mat, c[0], c[1], c[2], seed, mat, mask);
  }

  /** Flat quad lying on the floor, like a rug. */
  flat(a0: number, d0: number, a1: number, d1: number, mat: number, c: RGB, seed = 0): void {
    const [x0, z0, x1, z1] = this.world(a0, d0, a1, d1);
    const y = this.f.y + 0.012;
    this.faces.poly(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, 0, x1 - x0, 0, x1 - x0, z1 - z0, 0, z1 - z0, mat, c[0], c[1], c[2], seed);
  }

  /** Sign on a wall, facing into the room along -d (back wall) or +a/-a (side walls). */
  wallSign(text: number, a: number, d: number, y0: number, scale: number, facing: 'front' | 'left' | 'right', c: RGB): void {
    const wu = SIGN_TEXTS[text].length * SIGN_CHAR_W + 2 * SIGN_PAD;
    const w = wu * scale, h = SIGN_H * scale;
    const f = this.f;
    // Local direction the sign faces, and its left-to-right direction for a reader facing it.
    const [na, nd] = facing === 'front' ? [0, -1] : facing === 'left' ? [1, 0] : [-1, 0];
    const ta = -nd, td = na;
    const pa = a - (ta * w) / 2, pd = d - (td * w) / 2;
    const qa = pa + ta * w, qd = pd + td * w;
    const px = f.ox + f.ax * pa + f.dx * pd, pz = f.oz + f.az * pa + f.dz * pd;
    const qx = f.ox + f.ax * qa + f.dx * qd, qz = f.oz + f.az * qa + f.dz * qd;
    const y = f.y + y0;
    this.faces.poly(px, y, pz, qx, y, qz, qx, y + h, qz, px, y + h, pz, 0, 0, wu, 0, wu, SIGN_H, 0, SIGN_H, M_SIGN, c[0], c[1], c[2], signSeed(text, 1, scale));
  }

  solid(a0: number, d0: number, a1: number, d1: number, h: number): void {
    const [x0, z0, x1, z1] = this.world(a0, d0, a1, d1);
    this.solids.push(x0, z0, x1, z1, this.f.y - 0.1, this.f.y + h);
  }

  light(a: number, d: number, y: number, c: RGB): void {
    const f = this.f;
    this.lights.push(f.ox + f.ax * a + f.dx * d, f.y + y, f.oz + f.az * a + f.dz * d, c[0], c[1], c[2]);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)];
  }

  /** Someone at (a, d) looking along `facing` (chair codes). Standing people are solid. */
  person(a: number, d: number, facing: number, pose: number): void {
    const f = this.f;
    const fa = [0, 1, 0, -1][facing], fd = [1, 0, -1, 0][facing];
    const yaw = Math.atan2(f.ax * fa + f.dx * fd, f.az * fa + f.dz * fd);
    this.people.push(f.ox + f.ax * a + f.dx * d, f.y, f.oz + f.az * a + f.dz * d, yaw, pose, Math.floor(this.prng() * 65536));
    if (pose === POSE_STAND || pose === POSE_STAFF) this.solid(a - 0.25, d - 0.25, a + 0.25, d + 0.25, 1.8);
  }

  /** Fills a seat or spot with probability `busy * k`. */
  maybe(a: number, d: number, facing: number, pose: number, k = 1): void {
    if (this.prng() < this.busy * k) this.person(a, d, facing, pose);
  }
}

export interface Program {
  name: string;
  floor: number;
  floorC: RGB;
  wall: RGB;
  /** Colour of the ceiling light panels. */
  light: RGB;
  build(R: Room): void;
}

const WOODS: readonly RGB[] = [[120, 80, 50], [150, 105, 65], [96, 64, 42], [170, 130, 90]];
const FABRIC: readonly RGB[] = [[150, 50, 50], [50, 90, 150], [70, 120, 80], [180, 150, 90], [110, 70, 130], [70, 70, 78]];
const NEON: readonly RGB[] = [[255, 60, 200], [60, 230, 255], [90, 255, 130], [255, 150, 50], [255, 230, 90]];
const DARK: RGB = [44, 42, 40];
const STEEL: RGB = [150, 156, 164];
const STONE_TOP: RGB = [200, 196, 188];
const WHITE: RGB = [225, 225, 220];
const GREEN: RGB = [60, 140, 60];
const WARM: RGB = [255, 210, 140];

function darker(c: RGB, k = 0.6): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---- furniture kit: each piece is a handful of boxes, sized in real metres around a 1.7 m eye ----

/** Dining or café table centred at (a, d); w along a, dd along d. */
function table(R: Room, a: number, d: number, w: number, dd: number, h: number, c: RGB): void {
  R.box(a - w / 2, d - dd / 2, a + w / 2, d + dd / 2, h - 0.05, h, M_WOOD, c);
  if (w <= 1 && dd <= 1) {
    // Small tables stand on one pedestal: a quarter of the faces of four legs, and it reads the same.
    R.box(a - 0.05, d - 0.05, a + 0.05, d + 0.05, 0, h - 0.05, M_PAINT, DARK, 0, BOX_SIDES);
  } else {
    const la = w / 2 - 0.07, ld = dd / 2 - 0.07;
    for (const sa of [-1, 1]) {
      for (const sd of [-1, 1]) {
        R.box(a + sa * la - 0.03, d + sd * ld - 0.03, a + sa * la + 0.03, d + sd * ld + 0.03, 0, h - 0.05, M_WOOD, darker(c), 0, BOX_SIDES);
      }
    }
  }
  R.solid(a - w / 2, d - dd / 2, a + w / 2, d + dd / 2, h);
}

/** Facing: the direction the sitter looks, 0 = +d, 1 = +a, 2 = -d, 3 = -a. */
function chair(R: Room, a: number, d: number, facing: number, c: RGB, sit = 1): void {
  R.box(a - 0.21, d - 0.21, a + 0.21, d + 0.21, 0.42, 0.47, M_WOOD, c);
  R.box(a - 0.03, d - 0.03, a + 0.03, d + 0.03, 0, 0.42, M_PAINT, DARK, 0, BOX_SIDES);
  const fa = [0, 1, 0, -1][facing], fd = [1, 0, -1, 0][facing];
  const ba = a - fa * 0.19, bd = d - fd * 0.19;
  if (fa !== 0) R.box(ba - 0.025, d - 0.21, ba + 0.025, d + 0.21, 0.47, 0.95, M_WOOD, c, 0, BOX_SIDES);
  else R.box(a - 0.21, bd - 0.025, a + 0.21, bd + 0.025, 0.47, 0.95, M_WOOD, c, 0, BOX_SIDES);
  R.maybe(a, d, facing, POSE_CHAIR, sit);
}

/** `facing` is where a sitter would look (toward the counter); -1 leaves the stool empty. */
function stool(R: Room, a: number, d: number, c: RGB, facing = -1): void {
  R.box(a - 0.18, d - 0.18, a + 0.18, d + 0.18, 0.7, 0.76, M_CLOTH, c);
  R.box(a - 0.03, d - 0.03, a + 0.03, d + 0.03, 0, 0.7, M_PAINT, STEEL, 0, BOX_SIDES);
  if (facing >= 0) R.maybe(a, d, facing, POSE_STOOL);
}

function counter(R: Room, a0: number, d0: number, a1: number, d1: number, h: number, body: RGB, top: RGB): void {
  R.box(a0, d0, a1, d1, 0, h - 0.05, M_WOOD, body);
  R.box(a0 - 0.04, d0 - 0.04, a1 + 0.04, d1 + 0.04, h - 0.05, h, M_CONCRETE, top);
  R.solid(a0, d0, a1, d1, h);
}

/** Open shelving against a wall with rows of goods; the long side of the footprint is the front. */
function shelves(R: Room, a0: number, d0: number, a1: number, d1: number, h: number, rows: number, frame: RGB, goods: number): void {
  const alongA = a1 - a0 >= d1 - d0;
  if (alongA) {
    R.box(a0, d0, a0 + 0.04, d1, 0, h, M_WOOD, frame);
    R.box(a1 - 0.04, d0, a1, d1, 0, h, M_WOOD, frame);
  } else {
    R.box(a0, d0, a1, d0 + 0.04, 0, h, M_WOOD, frame);
    R.box(a0, d1 - 0.04, a1, d1, 0, h, M_WOOD, frame);
  }
  const step = (h - 0.12) / rows;
  for (let r = 0; r <= rows; r++) {
    const y = 0.08 + r * step;
    R.box(a0, d0, a1, d1, y, y + 0.03, M_WOOD, frame);
    if (r < rows) R.box(a0 + 0.05, d0 + 0.05, a1 - 0.05, d1 - 0.05, y + 0.03, y + step * 0.78, M_GOODS, WHITE, goods + 4 * r);
  }
  R.solid(a0, d0, a1, d1, h);
}

/** Sofa whose sitters look along `facing` (see chair); the back sits on the opposite long side. */
function sofa(R: Room, a0: number, d0: number, a1: number, d1: number, facing: number, c: RGB): void {
  R.box(a0, d0, a1, d1, 0.1, 0.44, M_CLOTH, c);
  const back = darker(c, 0.8);
  if (facing === 0) R.box(a0, d0, a1, d0 + 0.2, 0.44, 0.85, M_CLOTH, back);
  else if (facing === 2) R.box(a0, d1 - 0.2, a1, d1, 0.44, 0.85, M_CLOTH, back);
  else if (facing === 1) R.box(a0, d0, a0 + 0.2, d1, 0.44, 0.85, M_CLOTH, back);
  else R.box(a1 - 0.2, d0, a1, d1, 0.44, 0.85, M_CLOTH, back);
  R.solid(a0, d0, a1, d1, 0.85);
}

/** Bed with its head against the wall on side `head` (0 = low d, 1 = low a, 2 = high d, 3 = high a). */
function bed(R: Room, a0: number, d0: number, a1: number, d1: number, head: number, blanket: RGB): void {
  R.box(a0, d0, a1, d1, 0, 0.3, M_WOOD, WOODS[2]);
  R.box(a0 + 0.03, d0 + 0.03, a1 - 0.03, d1 - 0.03, 0.3, 0.52, M_CLOTH, blanket);
  const pa0 = head === 1 ? a0 + 0.08 : head === 3 ? a1 - 0.5 : a0 + 0.15;
  const pa1 = head === 1 ? a0 + 0.5 : head === 3 ? a1 - 0.08 : a1 - 0.15;
  const pd0 = head === 0 ? d0 + 0.08 : head === 2 ? d1 - 0.5 : d0 + 0.15;
  const pd1 = head === 0 ? d0 + 0.5 : head === 2 ? d1 - 0.08 : d1 - 0.15;
  R.box(pa0, pd0, pa1, pd1, 0.52, 0.64, M_CLOTH, WHITE);
  if (head === 1) R.box(a0, d0, a0 + 0.06, d1, 0, 1.0, M_WOOD, WOODS[2]);
  else if (head === 3) R.box(a1 - 0.06, d0, a1, d1, 0, 1.0, M_WOOD, WOODS[2]);
  else if (head === 0) R.box(a0, d0, a1, d0 + 0.06, 0, 1.0, M_WOOD, WOODS[2]);
  else R.box(a0, d1 - 0.06, a1, d1, 0, 1.0, M_WOOD, WOODS[2]);
  R.solid(a0, d0, a1, d1, 0.64);
}

function plant(R: Room, a: number, d: number, s = 1): void {
  R.box(a - 0.2 * s, d - 0.2 * s, a + 0.2 * s, d + 0.2 * s, 0, 0.45 * s, M_CONCRETE, [150, 88, 62]);
  R.box(a - 0.36 * s, d - 0.36 * s, a + 0.36 * s, d + 0.36 * s, 0.45 * s, 1.35 * s, M_LEAF, GREEN, Math.floor(R.rng() * 65536));
  R.solid(a - 0.2 * s, d - 0.2 * s, a + 0.2 * s, d + 0.2 * s, 1.35 * s);
}

function pendant(R: Room, a: number, d: number, c: RGB): void {
  R.box(a - 0.16, d - 0.16, a + 0.16, d + 0.16, R.H - 0.75, R.H - 0.6, M_LAMP, c);
  R.light(a, d, R.H - 0.8, c);
}

/**
 * Box that is thin (half-thickness `t`) along the facing axis and `half` wide across it, centred at
 * (a, d). Used for panels and screens that stand across a desk or cabinet.
 */
function across(R: Room, a: number, d: number, fa: number, half: number, t: number, y0: number, y1: number, mat: number, c: RGB): void {
  if (fa !== 0) R.box(a - t, d - half, a + t, d + half, y0, y1, mat, c);
  else R.box(a - half, d - t, a + half, d + t, y0, y1, mat, c);
}

/** Desk against a wall, its user looking toward the wall along `toward` (chair facing codes). */
function desk(R: Room, a: number, d: number, toward: number, c: RGB): boolean {
  const fa = [0, 1, 0, -1][toward], fd = [1, 0, -1, 0][toward];
  const ea = fa !== 0 ? 0.35 : 0.7, ed = fa !== 0 ? 0.7 : 0.35;
  const ca = a - fa * 0.8, cd = d - fd * 0.8;
  if (!R.take(Math.min(a - ea, ca - 0.3), Math.min(d - ed, cd - 0.3), Math.max(a + ea, ca + 0.3), Math.max(d + ed, cd + 0.3))) return false;
  R.box(a - ea, d - ed, a + ea, d + ed, 0.7, 0.75, M_WOOD, c);
  across(R, a + fa * (ea - 0.03), d + fd * (ed - 0.03), fa, 0.7, 0.03, 0, 0.7, M_WOOD, darker(c));
  across(R, a + fa * 0.15, d + fd * 0.15, fa, 0.28, 0.03, 0.8, 1.15, M_SCREEN, [120, 200, 255]);
  R.solid(a - ea, d - ed, a + ea, d + ed, 0.75);
  chair(R, ca, cd, toward, DARK);
  return true;
}

function crate(R: Room, a: number, d: number, s: number, y0: number, c: RGB): void {
  R.box(a - s / 2, d - s / 2, a + s / 2, d + s / 2, y0, y0 + s, M_WOOD, c);
}

/** Arcade or pachinko machine with its screen toward `facing`. */
function cabinet(R: Room, a: number, d: number, facing: number, c: RGB): void {
  const fa = [0, 1, 0, -1][facing], fd = [1, 0, -1, 0][facing];
  const hw = 0.4, hd = 0.38;
  const ea = fa !== 0 ? hd : hw, ed = fa !== 0 ? hw : hd;
  R.box(a - ea, d - ed, a + ea, d + ed, 0, 1.85, M_PAINT, DARK);
  const sa = a + fa * (ea + 0.01), sd = d + fd * (ed + 0.01);
  const pa = fa !== 0 ? 0.02 : hw - 0.08, pd = fa !== 0 ? hw - 0.08 : 0.02;
  R.box(sa - pa, sd - pd, sa + pa, sd + pd, 1.0, 1.5, M_SCREEN, c);
  R.box(sa - pa, sd - pd, sa + pa, sd + pd, 1.6, 1.8, M_GLOW, c);
  const ka = a + fa * (ea + 0.15), kd = d + fd * (ed + 0.15);
  R.box(ka - (fa !== 0 ? 0.15 : hw), kd - (fa !== 0 ? hw : 0.15), ka + (fa !== 0 ? 0.15 : hw), kd + (fa !== 0 ? hw : 0.15), 0.82, 0.92, M_PAINT, darker(c, 0.5));
  R.solid(a - ea, d - ed, a + ea, d + ed, 1.85);
  R.maybe(a + fa * (ea + 0.5), d + fd * (ed + 0.5), (facing + 2) % 4, POSE_STAND, 0.8);
}

/** Menu or shop sign on the back wall, repeating the sign outside. */
function menuBoard(R: Room, a: number, y: number, c: RGB): void {
  if (R.text < 0) return;
  const len = SIGN_TEXTS[R.text].length * SIGN_CHAR_W + 2 * SIGN_PAD;
  const scale = Math.min(0.5, (R.W - 0.6) / len);
  if (scale < 0.2) return;
  R.wallSign(R.text, a, R.D - 0.02, y, scale >= 0.5 ? 0.5 : 0.25, 'front', c);
}

// ---- storeys ----

function plantsAlong(R: Room, spacing: number, max: number): void {
  let n = 0;
  for (let d = 2.5; d < R.D - 1 && n < max; d += spacing) {
    if (R.take(0.05, d - 0.4, 0.85, d + 0.4)) { plant(R, 0.45, d); n++; }
    if (R.take(R.W - 0.85, d - 0.4, R.W - 0.05, d + 0.4)) { plant(R, R.W - 0.45, d); n++; }
  }
}

export const LOBBY: Program = {
  name: 'LOBBY', floor: FLOOR_TILES, floorC: [196, 190, 176], wall: [205, 200, 188], light: [255, 245, 225],
  build(R) {
    const c = R.entry;
    const dR = Math.max(2.6, Math.min(R.D * 0.35, R.D - 5));
    // Reception desk beside the main aisle, parallel to the front, with a clerk's chair and screen.
    for (const side of [1, -1]) {
      const len = Math.min(3.6, side > 0 ? R.W - c - 2.2 : c - 2.2);
      if (len < 1.6) continue;
      const a0 = side > 0 ? c + 1.2 : c - 1.2 - len, a1 = a0 + len;
      if (!R.take(a0, dR, a1, dR + 1.7)) continue;
      counter(R, a0, dR, a1, dR + 0.7, 1.1, WOODS[2], STONE_TOP);
      R.box(a0 + len / 2 - 0.25, dR + 0.35, a0 + len / 2 + 0.25, dR + 0.4, 1.1, 1.45, M_SCREEN, [120, 200, 255]);
      chair(R, a0 + len / 2, dR + 1.2, 2, DARK, 3);
      break;
    }
    // Waiting area on the other side of the aisle: two sofas facing each other over a low table.
    for (const side of [-1, 1]) {
      const ta = c + side * 3.4, td = dR + 1.2;
      if (!R.take(ta - 1.6, td - 1.6, ta + 1.6, td + 1.6)) continue;
      const fab = R.pick(FABRIC);
      sofa(R, ta - 1.1, td - 1.4, ta + 1.1, td - 0.6, 0, fab);
      sofa(R, ta - 1.1, td + 0.6, ta + 1.1, td + 1.4, 2, fab);
      table(R, ta, td, 1.2, 0.5, 0.42, WOODS[0]);
      R.flat(ta - 1.4, td - 1.5, ta + 1.4, td + 1.5, M_CLOTH, [120, 40, 40]);
      break;
    }
    if (R.lift) {
      const [la0, , la1] = R.lift;
      for (const a of [la0 - 0.6, la1 + 0.6]) if (R.take(a - 0.4, R.D - 0.9, a + 0.4, R.D - 0.05)) plant(R, a, R.D - 0.45, 1.1);
    }
    for (const a of [0.5, R.W - 0.5]) if (R.take(a - 0.4, 0.1, a + 0.4, 0.9)) plant(R, a, 0.5);
    plantsAlong(R, 5, 8);
  },
};

export const OFFICE: Program = {
  name: 'OFFICES', floor: FLOOR_CARPET, floorC: [70, 80, 96], wall: [196, 198, 200], light: [235, 245, 255],
  build(R) {
    R.busy = 0.2;
    // Desks line the windows so everyone faces the view; the middle stays open.
    let n = 0;
    const max = 44;
    for (let a = 1.0; a < R.W - 1.0 && n < max; a += 1.8) if (desk(R, a, 0.45, 2, R.pick(WOODS))) n++;
    for (let d = 2.4; d < R.D - 1.0 && n < max; d += 1.8) {
      if (desk(R, 0.45, d, 3, R.pick(WOODS))) n++;
      if (desk(R, R.W - 0.45, d, 1, R.pick(WOODS))) n++;
    }
    const ma = R.W / 2, md = R.D / 2;
    if (R.W > 12 && R.D > 12 && R.take(ma - 2.2, md - 1.4, ma + 2.2, md + 1.4)) {
      table(R, ma, md, 3.0, 1.1, 0.75, WOODS[3]);
      for (const a of [-1, 0, 1]) {
        chair(R, ma + a * 0.9, md - 0.85, 0, DARK);
        chair(R, ma + a * 0.9, md + 0.85, 2, DARK);
      }
    }
    for (const a of [0.5, R.W - 0.5]) if (R.take(a - 0.4, R.D - 0.9, a + 0.4, R.D - 0.1)) plant(R, a, R.D - 0.5);
  },
};

export const LOUNGE: Program = {
  name: 'SKY LOUNGE', floor: FLOOR_PARQUET, floorC: [110, 72, 46], wall: [60, 56, 64], light: [255, 190, 120],
  build(R) {
    // Bar along the right wall with a lit back bar.
    const d0 = 2.2, d1 = Math.min(R.D - 4.4, d0 + 7);
    if (d1 - d0 > 2.5 && R.take(R.W - 2.9, d0, R.W, d1)) {
      counter(R, R.W - 2.3, d0, R.W - 1.7, d1, 1.1, [40, 30, 30], [30, 30, 34]);
      shelves(R, R.W - 0.45, d0, R.W - 0.05, d1, 2.1, 3, DARK, GOODS_BOTTLES);
      for (let d = d0 + 0.5; d < d1 - 0.3; d += 0.9) stool(R, R.W - 2.7, d, [150, 40, 40], 1);
      for (let d = d0 + 1; d < d1; d += 2.2) pendant(R, R.W - 2.0, d, WARM);
      R.person(R.W - 1.1, (d0 + d1) / 2, 3, POSE_STAFF);
    }
    // Sofas turned toward the front windows, each with a low table between it and the glass.
    const fab = R.pick(FABRIC);
    for (let a = 1.5; a < R.W - 3.5; a += 3.4) {
      if (!R.take(a - 1.2, 0.1, a + 1.2, 2.2)) continue;
      sofa(R, a - 1.1, 1.3, a + 1.1, 2.1, 2, fab);
      table(R, a, 0.7, 1.2, 0.55, 0.4, WOODS[0]);
    }
    for (let d = 3; d < R.D - 3; d += 3) {
      if (!R.take(0.1, d - 1.1, 2.2, d + 1.1)) continue;
      sofa(R, 1.2, d - 1.0, 2.0, d + 1.0, 3, fab);
      table(R, 0.55, d, 0.5, 1.0, 0.4, WOODS[0]);
    }
    plantsAlong(R, 6, 6);
  },
};

export const HOTEL_ROOM: Program = {
  name: 'HOTEL SUITE', floor: FLOOR_CARPET, floorC: [120, 60, 60], wall: [214, 200, 176], light: [255, 225, 175],
  build(R) {
    R.busy = 0.12;
    const dB = Math.max(2.3, R.D * 0.4);
    if (R.take(0, dB - 0.5, 2.6, dB + 2.1)) {
      bed(R, 0.05, dB, 2.1, dB + 1.6, 1, R.pick(FABRIC));
      for (const d of [dB - 0.3, dB + 1.9]) {
        R.box(0.1, d - 0.2, 0.5, d + 0.2, 0, 0.5, M_WOOD, WOODS[2]);
        R.box(0.22, d - 0.08, 0.38, d + 0.08, 0.5, 0.8, M_LAMP, WARM);
      }
      R.flat(2.2, dB - 0.2, 3.4, dB + 1.8, M_CLOTH, [170, 150, 110]);
    }
    if (R.take(R.W - 0.65, R.D * 0.35, R.W, R.D * 0.35 + 2.2)) {
      R.box(R.W - 0.6, R.D * 0.35, R.W - 0.05, R.D * 0.35 + 2.2, 0, 2.1, M_WOOD, WOODS[1]);
      R.solid(R.W - 0.6, R.D * 0.35, R.W - 0.05, R.D * 0.35 + 2.2, 2.1);
    }
    for (let a = 1; a < R.W - 1.5; a += 2.4) if (desk(R, a, 0.45, 2, WOODS[1])) break;
    const fab = R.pick(FABRIC);
    for (let a = R.W - 2.4; a > 1; a -= 2.4) {
      if (!R.take(a - 1.2, 1.1, a + 1.2, 3.1)) continue;
      sofa(R, a - 1.1, 2.3, a + 1.1, 3.1, 2, fab);
      table(R, a, 1.6, 1.0, 0.5, 0.42, WOODS[3]);
      break;
    }
    plantsAlong(R, 7, 2);
  },
};

export const LIVING: Program = {
  name: 'LIVING ROOM', floor: FLOOR_PARQUET, floorC: [150, 105, 65], wall: [220, 206, 178], light: [255, 220, 160],
  build(R) {
    R.busy = 0.12;
    // Dining table by the front window.
    const ta = R.entry < R.W / 2 ? R.W * 0.68 : R.W * 0.32;
    if (R.take(ta - 1.3, 0.5, ta + 1.3, 2.6)) {
      table(R, ta, 1.55, 1.2, 0.8, 0.76, R.pick(WOODS));
      for (const s of [-1, 1]) {
        chair(R, ta - 0.3, 1.55 + s * 0.62, s > 0 ? 2 : 0, WOODS[2]);
        chair(R, ta + 0.3, 1.55 + s * 0.62, s > 0 ? 2 : 0, WOODS[2]);
      }
      pendant(R, ta, 1.55, WARM);
    }
    // Sofa against the left wall facing a TV on the right wall, with the walkway between them.
    const d = Math.min(R.D - 3.5, Math.max(3.2, R.D * 0.45));
    if (R.W >= 3.8 && R.fits(0, d - 1.1, 2.0, d + 1.1) && R.fits(R.W - 0.5, d - 0.8, R.W, d + 0.8)) {
      R.take(0, d - 1.1, 2.0, d + 1.1);
      R.take(R.W - 0.5, d - 0.8, R.W, d + 0.8);
      const fab = R.pick(FABRIC);
      sofa(R, 0.05, d - 1.0, 0.95, d + 1.0, 1, fab);
      table(R, 1.55, d, 0.55, 1.0, 0.42, WOODS[0]);
      R.flat(1.05, d - 1.1, R.W - 0.7, d + 1.1, M_CLOTH, darker(fab, 0.7));
      R.box(R.W - 0.45, d - 0.7, R.W - 0.05, d + 0.7, 0, 0.5, M_WOOD, WOODS[2]);
      R.box(R.W - 0.14, d - 0.6, R.W - 0.1, d + 0.6, 0.75, 1.45, M_SCREEN, [110, 170, 255]);
      R.solid(R.W - 0.45, d - 0.7, R.W - 0.05, d + 0.7, 0.5);
    }
    for (let dd = d + 1.4; dd < R.D - 0.6; dd += 2.2) {
      if (R.take(0.05, dd, 0.45, dd + 1.6)) shelves(R, 0.05, dd, 0.45, dd + 1.6, 2.0, 4, WOODS[2], GOODS_BOOKS);
    }
    for (const a of [0.45, R.W - 0.45]) if (R.take(a - 0.4, 0.1, a + 0.4, 0.9)) plant(R, a, 0.5, 0.9);
  },
};

export const BEDROOM: Program = {
  name: 'BEDROOM', floor: FLOOR_PARQUET, floorC: [130, 90, 58], wall: [200, 210, 220], light: [255, 225, 185],
  build(R) {
    R.busy = 0.12;
    const dB = Math.max(2.2, R.D * 0.35);
    if (R.take(0, dB - 0.5, 2.6, dB + 2.1)) {
      bed(R, 0.05, dB, 2.1, dB + 1.6, 1, R.pick(FABRIC));
      R.box(0.1, dB + 1.7, 0.5, dB + 2.05, 0, 0.5, M_WOOD, WOODS[2]);
      R.box(0.22, dB + 1.8, 0.38, dB + 1.95, 0.5, 0.78, M_LAMP, WARM);
      R.flat(2.2, dB, 3.3, dB + 1.6, M_CLOTH, R.pick(FABRIC));
    }
    const wd = Math.max(2.3, R.D * 0.3);
    if (R.take(R.W - 0.65, wd, R.W, wd + 1.8)) {
      R.box(R.W - 0.6, wd, R.W - 0.05, wd + 1.8, 0, 2.0, M_WOOD, WOODS[1]);
      R.solid(R.W - 0.6, wd, R.W - 0.05, wd + 1.8, 2.0);
    }
    for (let a = 1; a < R.W - 1; a += 2) if (desk(R, a, 0.45, 2, WOODS[3])) break;
    plantsAlong(R, 8, 1);
  },
};

export const TATAMI: Program = {
  name: 'TATAMI ROOM', floor: FLOOR_TATAMI, floorC: [190, 176, 120], wall: [226, 214, 190], light: [255, 215, 160],
  build(R) {
    R.busy = 0.12;
    // Low table with a floor cushion on each side, under a paper lantern.
    const ta = R.W / 2 + (R.entry < R.W / 2 ? 0.8 : -0.8), td = Math.max(2.8, R.D * 0.42);
    if (R.take(ta - 1.4, td - 1.2, ta + 1.4, td + 1.2)) {
      table(R, ta, td, 1.2, 0.8, 0.35, [70, 40, 30]);
      for (const [a, d] of [[ta - 0.95, td], [ta + 0.95, td], [ta, td - 0.75], [ta, td + 0.75]]) {
        R.box(a - 0.28, d - 0.28, a + 0.28, d + 0.28, 0, 0.08, M_CLOTH, [150, 50, 50]);
      }
      pendant(R, ta, td, [255, 190, 120]);
    }
    // Futon along one wall, tokonoma alcove with a plant in a back corner.
    if (R.take(R.W - 1.2, 1.0, R.W, 3.2)) {
      R.box(R.W - 1.1, 1.0, R.W - 0.1, 3.1, 0, 0.12, M_CLOTH, WHITE);
      R.box(R.W - 1.0, 2.6, R.W - 0.2, 3.0, 0.12, 0.22, M_CLOTH, [200, 200, 230]);
    }
    for (const a0 of [0.05, R.W - 1.35]) {
      if (!R.take(a0, R.D - 1.0, a0 + 1.3, R.D - 0.05)) continue;
      R.box(a0, R.D - 0.95, a0 + 1.3, R.D - 0.05, 0, 0.15, M_WOOD, [70, 40, 30]);
      plant(R, a0 + 0.65, R.D - 0.5, 0.7);
      break;
    }
    for (let d = 2; d < R.D - 1; d += 3) R.light(0.3, d, R.H - 0.4, [255, 180, 110]);
  },
};

export const HALL: Program = {
  name: 'WAREHOUSE', floor: FLOOR_CONCRETE, floorC: [120, 120, 118], wall: [130, 136, 140], light: [255, 220, 170],
  build(R) {
    const colors: readonly RGB[] = [[40, 90, 170], [170, 52, 42], [220, 120, 40], [62, 130, 72], [150, 110, 70]];
    // Pallet racking along both side walls: uprights, three beam levels, crates on pallets.
    for (const [a0, a1] of [[0.1, 1.3], [R.W - 1.3, R.W - 0.1]]) {
      for (let d = 2.5; d + 2.7 < R.D - 3.5; d += 2.9) {
        if (!R.take(a0, d, a1, d + 2.7)) continue;
        for (const dd of [d, d + 2.65]) {
          R.box(a0, dd, a0 + 0.08, dd + 0.05, 0, 3.6, M_PAINT, [40, 80, 160]);
          R.box(a1 - 0.08, dd, a1, dd + 0.05, 0, 3.6, M_PAINT, [40, 80, 160]);
        }
        for (const y of [0.15, 1.35, 2.55]) {
          R.box(a0, d, a1, d + 2.7, y, y + 0.1, M_PAINT, [230, 130, 40]);
          if (R.rng() < 0.85) crate(R, (a0 + a1) / 2, d + 0.7, 0.95, y + 0.1, R.pick(colors));
          if (R.rng() < 0.85) crate(R, (a0 + a1) / 2, d + 2.0, 0.95, y + 0.1, R.pick(colors));
        }
        R.solid(a0, d, a1, d + 2.7, 3.6);
      }
    }
    // Stacks of crates in the middle, and a forklift parked near the door.
    for (let d = 4; d < R.D - 4.5; d += 3.2) {
      for (const a of [R.W / 2 - 3.2, R.W / 2 + 3.2]) {
        if (!R.take(a - 0.8, d - 0.8, a + 0.8, d + 0.8)) continue;
        const n = 1 + Math.floor(R.rng() * 3);
        for (let s = 0; s < n; s++) crate(R, a, d, 1.3, s * 1.3, R.pick(colors));
        R.solid(a - 0.65, d - 0.65, a + 0.65, d + 0.65, n * 1.3);
      }
    }
    const fa = R.entry + 3.2;
    if (R.take(fa - 0.8, 2.4, fa + 0.8, 5.4)) {
      R.box(fa - 0.6, 3.2, fa + 0.6, 5.2, 0.2, 1.3, M_PAINT, [240, 190, 40]);
      R.box(fa - 0.5, 4.2, fa + 0.5, 5.1, 1.3, 2.2, M_PAINT, [40, 40, 44], 0, BOX_SIDES);
      R.box(fa - 0.5, 2.95, fa + 0.5, 3.1, 0, 2.6, M_PAINT, [60, 60, 66]);
      R.box(fa - 0.4, 2.2, fa - 0.25, 3.1, 0.05, 0.12, M_PAINT, STEEL);
      R.box(fa + 0.25, 2.2, fa + 0.4, 3.1, 0.05, 0.12, M_PAINT, STEEL);
      R.solid(fa - 0.6, 2.9, fa + 0.6, 5.2, 2.2);
    }
  },
};

export const CONTROL: Program = {
  name: 'SHIPPING OFFICE', floor: FLOOR_TILES, floorC: [150, 152, 150], wall: [176, 184, 180], light: [230, 245, 255],
  build(R) {
    let n = 0;
    for (let a = 1.0; a < R.W - 1.0 && n < 14; a += 2.0) if (desk(R, a, 0.45, 2, [150, 150, 150])) n++;
    for (let d = 2.6; d < R.D - 1.2; d += 1.2) {
      if (R.take(0.05, d, 0.65, d + 1.0)) {
        R.box(0.05, d, 0.65, d + 1.0, 0, 1.4, M_PAINT, [110, 116, 124]);
        R.solid(0.05, d, 0.65, d + 1.0, 1.4);
      }
    }
    const md = R.D / 2, ma = R.W / 2 + (R.entry < R.W / 2 ? 3 : -3);
    if (R.take(ma - 1.8, md - 1.3, ma + 1.8, md + 1.3)) {
      table(R, ma, md, 2.4, 1.0, 0.75, [140, 140, 140]);
      for (const s of [-0.6, 0.6]) {
        chair(R, ma + s, md - 0.8, 0, DARK);
        chair(R, ma + s, md + 0.8, 2, DARK);
      }
    }
    if (R.fits(R.W - 0.12, R.D * 0.3, R.W - 0.02, R.D * 0.3 + 3)) {
      R.box(R.W - 0.12, R.D * 0.3, R.W - 0.06, R.D * 0.3 + 3, 1.0, 2.4, M_SCREEN, [80, 220, 140]);
    }
  },
};

// ---- shops: each layout keeps a clear aisle from the door to where you are served ----

export const NOODLE_BAR: Program = {
  name: 'NOODLE BAR', floor: FLOOR_PARQUET, floorC: [120, 84, 54], wall: [210, 190, 160], light: [255, 215, 160],
  build(R) {
    const c0 = R.D - 2.6, c1 = c0 + 0.6;
    if (R.take(0.4, c0 - 0.9, R.W - 0.4, R.D)) {
      counter(R, 0.5, c0, R.W - 0.5, c1, 1.0, [96, 54, 36], [180, 140, 96]);
      for (let a = 0.9; a < R.W - 0.7; a += 0.8) stool(R, a, c0 - 0.45, [170, 40, 40], 0);
      // Kitchen behind the counter: steel stove with glowing burners and pots, bowls on a shelf.
      const s1 = Math.max(1.4, R.W * 0.6);
      R.box(0.3, R.D - 0.75, s1, R.D - 0.05, 0, 0.9, M_PAINT, STEEL);
      R.solid(0.3, R.D - 0.75, s1, R.D - 0.05, 0.9);
      for (let a = 0.6; a < s1 - 0.3; a += 0.7) {
        R.box(a - 0.13, R.D - 0.53, a + 0.13, R.D - 0.27, 0.9, 0.93, M_GLOW, [255, 110, 40]);
        R.box(a - 0.17, R.D - 0.57, a + 0.17, R.D - 0.23, 0.93, 1.25, M_PAINT, [90, 90, 96]);
      }
      if (R.W - s1 > 1) shelves(R, s1 + 0.2, R.D - 0.45, R.W - 0.3, R.D - 0.05, 1.9, 3, WOODS[2], GOODS_MIXED);
      // Cooks work the gap between the counter and the stove.
      R.person(Math.min(s1 - 0.5, R.W * 0.35), c1 + 0.6, 2, POSE_STAFF);
      if (R.W > 4.5) R.maybe(R.W * 0.72, c1 + 0.6, 2, POSE_STAFF, 1.5);
      for (let a = 1; a < R.W - 0.5; a += 1.4) {
        R.box(a - 0.18, c0 + 0.12, a + 0.18, c0 + 0.48, R.H - 0.95, R.H - 0.5, M_LAMP, [255, 70, 40]);
        R.light(a, c0 + 0.3, R.H - 1.0, [255, 90, 50]);
      }
      menuBoard(R, R.W / 2, 2.1, [255, 220, 150]);
    }
    // Two-seat tables along the walls near the windows.
    for (let d = 2.6; d < c0 - 1.6; d += 1.6) {
      for (const a of [0.75, R.W - 0.75]) {
        if (!R.take(a - 0.55, d - 0.75, a + 0.55, d + 0.75)) continue;
        table(R, a, d, 0.65, 0.65, 0.74, WOODS[0]);
        chair(R, a, d - 0.55, 0, WOODS[2]);
        chair(R, a, d + 0.55, 2, WOODS[2]);
      }
    }
  },
};

export const CAFE: Program = {
  name: 'CAFE', floor: FLOOR_CHECKER, floorC: [226, 220, 204], wall: [196, 170, 130], light: [255, 220, 170],
  build(R) {
    const b0 = R.D - 1.7;
    const a0 = Math.min(R.W * 0.4, R.W - 2.4);
    if (R.take(a0 - 0.1, b0 - 0.8, R.W, R.D)) {
      counter(R, a0, b0, R.W - 0.3, b0 + 0.6, 1.05, [70, 44, 30], STONE_TOP);
      R.box(R.W - 1.0, b0 + 0.1, R.W - 0.5, b0 + 0.5, 1.05, 1.5, M_PAINT, STEEL);
      R.box(R.W - 0.95, b0 + 0.05, R.W - 0.55, b0 + 0.1, 1.2, 1.3, M_GLOW, [255, 120, 60]);
      R.box(a0 + 0.1, b0 + 0.05, Math.min(a0 + 1.4, R.W - 1.2), b0 + 0.55, 1.05, 1.35, M_GOODS, WHITE, GOODS_BAKERY);
      shelves(R, a0, R.D - 0.45, R.W - 0.3, R.D - 0.05, 2.0, 3, WOODS[2], GOODS_BOTTLES);
      menuBoard(R, (a0 + R.W) / 2, 2.15, [255, 230, 180]);
      R.person((a0 + R.W) / 2 - 0.3, b0 + 0.92, 2, POSE_STAFF);
    }
    let n = 0;
    for (let d = 1.3; d < b0 - 1.1 && n < 12; d += 2.1) {
      for (let a = 0.85; a < R.W - 0.8 && n < 12; a += 2.1) {
        if (!R.take(a - 0.8, d - 0.45, a + 0.8, d + 0.45)) continue;
        n++;
        table(R, a, d, 0.7, 0.7, 0.74, [40, 38, 36]);
        chair(R, a - 0.55, d, 1, [150, 40, 40]);
        chair(R, a + 0.55, d, 3, [150, 40, 40]);
        pendant(R, a, d, WARM);
      }
    }
  },
};

export const BAR: Program = {
  name: 'BAR', floor: FLOOR_PARQUET, floorC: [80, 52, 36], wall: [110, 70, 50], light: [255, 170, 100],
  build(R) {
    // The bar runs along the right wall, stopping short of a lift tucked into that corner.
    const end = R.lift ? R.lift[1] - 2.0 : R.D;
    const d0 = 2.3, d1 = end - 0.8;
    if (d1 - d0 > 1.5 && R.W >= 4 && R.take(R.W - 2.6, d0, R.W, end)) {
      counter(R, R.W - 2.0, d0, R.W - 1.4, d1, 1.1, [60, 36, 24], [90, 60, 40]);
      shelves(R, R.W - 0.45, d0, R.W - 0.05, end - 0.1, 2.1, 3, [40, 28, 20], GOODS_BOTTLES);
      for (let d = d0 + 0.4; d < d1 - 0.2; d += 0.8) stool(R, R.W - 2.45, d, [120, 30, 30], 1);
      for (let d = d0 + 0.8; d < d1; d += 1.8) pendant(R, R.W - 1.7, d, [255, 170, 90]);
      R.person(R.W - 0.92, (d0 + d1) / 2, 3, POSE_STAFF);
    }
    const barrels = R.text >= 0 && ['TAVERN', 'INN', 'SAKE'].includes(SIGN_TEXTS[R.text]);
    for (let d = 2.6; d < R.D - 0.8; d += 1.8) {
      if (!R.take(0.2, d - 0.8, 1.4, d + 0.8)) continue;
      if (barrels) {
        R.box(0.5, d - 0.32, 1.14, d + 0.32, 0, 1.0, M_WOOD, [110, 70, 40]);
        R.solid(0.5, d - 0.32, 1.14, d + 0.32, 1.0);
        stool(R, 0.82, d - 0.62, [90, 60, 40], 0);
        stool(R, 0.82, d + 0.62, [90, 60, 40], 2);
      } else {
        table(R, 0.8, d, 0.7, 0.7, 0.74, [60, 40, 30]);
        chair(R, 0.8, d - 0.55, 0, [80, 50, 35]);
        chair(R, 0.8, d + 0.55, 2, [80, 50, 35]);
      }
    }
    menuBoard(R, R.W / 2 - 0.6, 2.0, [255, 190, 110]);
  },
};

export const BAKERY: Program = {
  name: 'BAKERY', floor: FLOOR_TILES, floorC: [214, 200, 170], wall: [236, 222, 196], light: [255, 230, 190],
  build(R) {
    // Glass-fronted display across the shop with a gap for staff at the far end.
    const d = Math.max(2.4, Math.min(R.D * 0.5, R.D - 2.4));
    const a1 = R.W - 1.3;
    if (a1 > 1.5 && R.take(0, d - 0.3, R.W, d + 0.9)) {
      counter(R, 0.3, d, a1, d + 0.75, 0.9, WOODS[3], STONE_TOP);
      R.box(0.35, d + 0.05, a1 - 0.05, d + 0.7, 0.9, 1.25, M_GOODS, WHITE, GOODS_BAKERY);
      R.box(a1 - 0.5, d + 0.2, a1 - 0.15, d + 0.55, 0.9, 1.15, M_PAINT, DARK);
      R.box(a1 - 0.45, d + 0.18, a1 - 0.2, d + 0.2, 1.0, 1.1, M_GLOW, [120, 255, 150]);
      R.person(a1 * 0.5, d + 1.3, 2, POSE_STAFF);
      R.maybe(a1 * 0.5 + 0.5, d - 0.65, 0, POSE_STAND, 1.5);
    }
    if (R.take(0.3, R.D - 0.5, R.W - 0.3, R.D)) shelves(R, 0.3, R.D - 0.45, R.W - 0.3, R.D - 0.05, 2.1, 4, WOODS[1], GOODS_BAKERY);
    if (R.take(0, 2.3, 0.5, d - 0.4)) shelves(R, 0.05, 2.3, 0.5, d - 0.4, 1.8, 3, WOODS[1], GOODS_BAKERY);
    menuBoard(R, R.W / 2, 2.25, [140, 90, 50]);
    const ta = R.W - 1.0;
    if (R.take(ta - 0.9, 0.4, ta + 0.9, 1.8)) {
      table(R, ta, 1.1, 0.6, 0.6, 0.74, [40, 38, 36]);
      chair(R, ta - 0.5, 1.1, 1, WOODS[2]);
      chair(R, ta + 0.5, 1.1, 3, WOODS[2]);
    }
  },
};

export const STORE: Program = {
  name: 'SHOP', floor: FLOOR_PARQUET, floorC: [140, 110, 80], wall: [222, 216, 200], light: [245, 240, 225],
  build(R) {
    const text = R.text >= 0 ? SIGN_TEXTS[R.text] : '';
    const goods = ['BOOKS', 'LIBRAIRIE', 'MANGA', 'ANTIQUES', 'VIDEO'].includes(text) ? GOODS_BOOKS
      : ['CANDLES', 'CLOCKS', 'TABAC'].includes(text) ? GOODS_BAKERY
        : ['APOTHECARY', 'PHARMACY', 'PHARMACIE'].includes(text) ? GOODS_BOTTLES : GOODS_MIXED;
    // Tall shelves on both side walls and the back wall.
    for (const [a0, a1] of [[0.05, 0.5], [R.W - 0.5, R.W - 0.05]]) {
      if (R.take(a0, 2.3, a1, R.D - 0.55)) shelves(R, a0, 2.3, a1, R.D - 0.55, 2.1, 5, WOODS[2], goods);
    }
    if (R.take(0.55, R.D - 0.5, R.W - 0.55, R.D)) shelves(R, 0.55, R.D - 0.5, R.W - 0.55, R.D - 0.05, 2.1, 5, WOODS[2], goods);
    // Island shelving down the middle when there is room for an aisle on each side.
    if (R.W >= 5.2) {
      const m = R.W / 2;
      if (R.take(m - 0.5, 3.0, m + 0.5, R.D - 1.8)) shelves(R, m - 0.45, 3.0, m + 0.45, R.D - 1.8, 1.4, 3, WOODS[1], goods);
    }
    // Till beside the door.
    for (const [a0, a1] of [[0.5, 1.9], [R.W - 1.9, R.W - 0.5]]) {
      if (!R.take(a0, 0.6, a1, 1.9)) continue;
      counter(R, a0, 0.8, a1, 1.35, 1.0, WOODS[0], STONE_TOP);
      R.box(a0 + 0.3, 0.95, a0 + 0.65, 1.25, 1.0, 1.25, M_PAINT, DARK);
      R.box(a0 + 0.34, 0.93, a0 + 0.61, 0.95, 1.1, 1.2, M_GLOW, [120, 255, 150]);
      R.person((a0 + a1) / 2, 1.75, 2, POSE_STAFF);
      break;
    }
    menuBoard(R, R.W / 2, 2.2, [60, 60, 70]);
    // Browsers in the side aisles, facing the shelves.
    const span = R.D - 4.5;
    if (span > 0) {
      R.maybe(1.05, 3 + R.rng() * span, 3, POSE_STAND, 1.2);
      R.maybe(R.W - 1.05, 3 + R.rng() * span, 1, POSE_STAND, 1.2);
    }
  },
};

export const ARCADE: Program = {
  name: 'ARCADE', floor: FLOOR_CARPET, floorC: [60, 30, 80], wall: [36, 30, 50], light: [180, 120, 255],
  build(R) {
    // Machines along both side walls facing the aisle, plus a back-to-back island in wide halls.
    for (let d = 2.5; d < R.D - 0.6; d += 1.0) {
      if (R.take(0.1, d - 0.45, 1.3, d + 0.45)) cabinet(R, 0.5, d, 1, R.pick(NEON));
      if (R.take(R.W - 1.3, d - 0.45, R.W - 0.1, d + 0.45)) cabinet(R, R.W - 0.5, d, 3, R.pick(NEON));
    }
    if (R.W >= 7) {
      const m = R.W / 2;
      for (let d = 3.2; d < R.D - 2.2; d += 1.0) {
        if (!R.take(m - 1.3, d - 0.45, m + 1.3, d + 0.45)) continue;
        cabinet(R, m - 0.4, d, 3, R.pick(NEON));
        cabinet(R, m + 0.4, d, 1, R.pick(NEON));
      }
    }
    for (let d = 2; d < R.D; d += 2.5) R.light(R.W / 2, d, R.H - 0.3, R.pick(NEON));
    menuBoard(R, R.W / 2, 2.2, [255, 60, 200]);
  },
};

/** Coin telescope on a post, looking along `facing` (chair codes), with someone at it now and then. */
function telescope(R: Room, a: number, d: number, facing: number): void {
  const fa = [0, 1, 0, -1][facing], fd = [1, 0, -1, 0][facing];
  R.box(a - 0.06, d - 0.06, a + 0.06, d + 0.06, 0, 1.12, M_PAINT, STEEL, 0, BOX_SIDES);
  R.box(a - 0.2, d - 0.2, a + 0.2, d + 0.2, 1.1, 1.36, M_PAINT, [220, 180, 40]);
  R.box(a + fa * 0.22 - 0.07, d + fd * 0.22 - 0.07, a + fa * 0.22 + 0.07, d + fd * 0.22 + 0.07, 1.18, 1.3, M_PAINT, DARK);
  R.solid(a - 0.2, d - 0.2, a + 0.2, d + 0.2, 1.36);
  R.maybe(a - fa * 0.55, d - fd * 0.55, facing, POSE_STAND, 0.8);
}

/** Observation deck at the top of the Glyph Tower: telescopes along all four walls of glass, benches facing out. */
export const SKYDECK: Program = {
  name: 'SKYDECK', floor: FLOOR_TILES, floorC: [52, 56, 66], wall: [70, 76, 90], light: [190, 215, 255],
  build(R) {
    R.busy = 0.45;
    for (let a = 1.6; a < R.W - 1.2; a += 3.4) {
      if (R.take(a - 0.5, 0.1, a + 0.5, 1.4)) telescope(R, a, 0.55, 2);
      if (R.take(a - 0.5, R.D - 1.4, a + 0.5, R.D - 0.1)) telescope(R, a, R.D - 0.55, 0);
    }
    for (let d = 3.2; d < R.D - 3; d += 3.4) {
      if (R.take(0.1, d - 0.5, 1.4, d + 0.5)) telescope(R, 0.55, d, 3);
      if (R.take(R.W - 1.4, d - 0.5, R.W - 0.1, d + 0.5)) telescope(R, R.W - 0.55, d, 1);
    }
    // Benches in a ring a few metres in from the glass, their sitters looking out.
    const ring = 4.2;
    for (let a = ring + 1; a < R.W - ring - 1; a += 3.2) {
      for (const [d, facing] of [[ring, 2], [R.D - ring, 0]] as const) {
        if (!R.take(a - 0.9, d - 0.35, a + 0.9, d + 0.35)) continue;
        R.box(a - 0.85, d - 0.25, a + 0.85, d + 0.25, 0.4, 0.47, M_WOOD, WOODS[3]);
        R.box(a - 0.8, d - 0.2, a + 0.8, d + 0.2, 0, 0.4, M_PAINT, DARK, 0, BOX_SIDES);
        R.solid(a - 0.85, d - 0.25, a + 0.85, d + 0.25, 0.47);
        R.maybe(a - 0.4, d, facing, POSE_CHAIR, 0.8);
        R.maybe(a + 0.4, d, facing, POSE_CHAIR, 0.6);
      }
    }
    for (let d = 3; d < R.D; d += 5) for (let a = 3; a < R.W; a += 5) R.light(a, d, R.H - 0.3, [150, 200, 255]);
    menuBoard(R, R.W / 2, 2.4, [120, 220, 255]);
    plantsAlong(R, 7, 4);
  },
};

const SHOPS: Record<string, Program> = {};
for (const w of ['RAMEN', 'NOODLES', 'UDON', 'SOBA', 'SUSHI', 'YAKITORI', 'TOFU', 'IZAKAYA', 'TAGINE', 'KEBAB']) SHOPS[w] = NOODLE_BAR;
for (const w of ['CAFE', 'BISTRO', 'BRASSERIE', 'TEA', 'DINER', 'PIZZA', 'GELATO', 'ICE CREAM', 'MINT']) SHOPS[w] = CAFE;
for (const w of ['BAR', 'TAVERN', 'SAKE', 'CLUB', 'LIVE', 'DANCE', 'KARAOKE', 'INN', 'TIKI', 'RUM']) SHOPS[w] = BAR;
for (const w of ['BAKERY', 'BOULANGERIE', 'PATISSERIE', 'FROMAGERIE', 'BUTCHER', 'DONUTS', 'DATES']) SHOPS[w] = BAKERY;
for (const w of [
  'BOOKS', 'LIBRAIRIE', 'MANGA', 'PHARMACY', 'PHARMACIE', 'APOTHECARY', 'CANDLES', 'ANTIQUES', 'CLOCKS', 'TABAC', 'VIDEO', 'REPAIR', 'PAWN', '24H',
  'GROCERY', 'HARDWARE', 'LAUNDRY', 'SURF', 'SPICES', 'SAFFRON', 'CARPETS', 'LAMPS', 'BRASS', 'OLIVES', 'SOUK',
]) SHOPS[w] = STORE;
for (const w of ['ARCADE', 'PACHINKO', 'CYBER', 'GAMES', 'CASINO']) SHOPS[w] = ARCADE;

/** The interior that matches a shop sign, or null when the sign is not a shop (hotels, docks...). */
export function shopFor(text: number): Program | null {
  return text >= 0 ? SHOPS[SIGN_TEXTS[text]] ?? null : null;
}
