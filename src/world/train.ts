import type { Camera } from '../render/camera';
import { drawBoxYaw, drawFace, drawPoint, drawVLine, sphereVisible, stats } from '../render/raster';
import {
  M_CEILING, M_CLOTH, M_CONCRETE, M_CORRUGATED, M_FLOOR, M_GLOW, M_LAMP, M_PAINT, M_PLASTER, M_RAIL, M_SIGN, M_TRAIN, M_WOOD,
} from '../render/materials';
import { glyph } from '../core/charset';
import { hash3, mulberry32 } from '../core/hash';
import { BOX_BOTTOM, BOX_SIDES, BOX_TOP, FACE_STRIDE, FaceList } from './faces';
import { worldSeed } from './layout';
import {
  BENCH_A, CARS, CAR_FLOOR, CAR_GAP, CAR_HALF_W, CAR_LEN, CITY_CELLS, COLUMN, EDGE_L, LANDING_A, PLAT_HALF, PLAT_L, PLAT_Y,
  POST_A, type PathPoint, ROOF_Y, STAIR_FOOT, STAIR_L, STAIR_TOP, STEP, type Station, TRAINS, type TrainState, carPoint,
  cellOf, crowdSlot, hasLoop, stationNear, stationsOf, trainAt, trainState,
} from './loop';
import { POSE_CHAIR, POSE_STAND, PERSON_STRIDE, drawOccupants } from './occupants';
import { SIGN_CHAR_W, SIGN_H, SIGN_PAD, SIGN_TEXTS, type RGB, signSeed } from './signs';

const G_STAR = glyph('*');
const G_o = glyph('o');
const G_PIPE = glyph('|');

const ALL = BOX_SIDES | BOX_TOP | BOX_BOTTOM;
const DECK: RGB = [192, 194, 198];
const EDGE: RGB = [240, 200, 40];
const METAL: RGB = [150, 156, 168];
/** Every station wears the line's red, so they stand out from the street and from the air. */
const ROOF: RGB = [200, 62, 50];
const STONE: RGB = [202, 202, 198];
const BENCH: RGB = [150, 104, 60];
const LIGHT: RGB = [255, 238, 200];
const NAME: RGB = [235, 242, 255];
const WARN: RGB = [255, 214, 60];
const SIGN_SCALE = 0.5;
/** Stations further than this are drawn as just their deck and roof. */
const DETAIL_R = 220;
const STEPS = 40;

/** One train: which loop (by cell) and which of its trains. */
export interface TrainRef {
  cx: number;
  cz: number;
  k: number;
}

interface Built {
  st: Station;
  /** Everything, built once the station is near. */
  faces: Float32Array | null;
  /** Just the deck and the roof, for stations far off. */
  far: Float32Array;
  people: Float32Array;
  slot: number;
}

/** Faces of one station: platform, stairs, canopy, benches, railings and its signs (only deck and roof without `detail`). */
function stationFaces(st: Station, detail: boolean): Float32Array {
  const F = new FaceList();
  const X = (a: number, l: number) => st.x + st.dx * a + st.nx * l;
  const Z = (a: number, l: number) => st.z + st.dz * a + st.nz * l;
  const box = (a0: number, a1: number, l0: number, l1: number, y0: number, y1: number, mat: number, c: RGB, mask = ALL) => {
    const xa = X(a0, l0), xb = X(a1, l1), za = Z(a0, l0), zb = Z(a1, l1);
    F.box(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb), mat, c[0], c[1], c[2], 0, mat, mask);
  };
  /** Quad at one `l`, corners given as (a, y) in the order bottom-left, bottom-right, top-right, top-left seen from outside. */
  const side = (l: number, q: readonly (readonly [number, number])[], mat: number, c: RGB) => {
    const [p, r, s, t] = q;
    F.poly(
      X(p[0], l), p[1], Z(p[0], l), X(r[0], l), r[1], Z(r[0], l), X(s[0], l), s[1], Z(s[0], l), X(t[0], l), t[1], Z(t[0], l),
      0, p[1], Math.abs(r[0] - p[0]), r[1], Math.abs(s[0] - p[0]), s[1], 0, t[1], mat, c[0], c[1], c[2], 0,
    );
  };
  /** Sign text on a board at `l`, facing into the loop (+1) or toward the track (-1). */
  const board = (text: number, aMid: number, l: number, facing: number, y0: number, c: RGB): void => {
    const wu = SIGN_TEXTS[text].length * SIGN_CHAR_W + 2 * SIGN_PAD;
    const W = wu * SIGN_SCALE, H = SIGN_H * SIGN_SCALE;
    // The reader's right is -d when the board faces into the loop, +d when it faces the track.
    const a0 = aMid + (facing > 0 ? W / 2 : -W / 2), a1 = aMid + (facing > 0 ? -W / 2 : W / 2);
    F.poly(
      X(a0, l), y0, Z(a0, l), X(a1, l), y0, Z(a1, l), X(a1, l), y0 + H, Z(a1, l), X(a0, l), y0 + H, Z(a0, l),
      0, 0, wu, 0, wu, SIGN_H, 0, SIGN_H, M_SIGN, c[0], c[1], c[2], signSeed(text, 1, SIGN_SCALE),
    );
  };
  /** A name of several words, read left to right by someone facing the board. */
  const name = (aMid: number, l: number, facing: number, y0: number) => {
    const widths = st.words.map((w) => (SIGN_TEXTS[w].length * SIGN_CHAR_W + 2 * SIGN_PAD) * SIGN_SCALE);
    const total = widths.reduce((s, w) => s + w, 0) + 0.3 * (widths.length - 1);
    let at = -total / 2;
    st.words.forEach((w, k) => {
      const mid = at + widths[k] / 2;
      board(w, aMid - facing * mid, l, facing, y0, NAME);
      at += widths[k] + 0.3;
    });
  };

  // Deck and canopy, which is all a far station needs.
  box(-PLAT_HALF, PLAT_HALF, EDGE_L, PLAT_L, PLAT_Y - 0.4, PLAT_Y, M_CONCRETE, DECK);
  box(-18, 18, -CAR_HALF_W - 0.4, STAIR_L + 0.2, ROOF_Y, ROOF_Y + 0.22, M_CORRUGATED, ROOF);
  if (!detail) return F.toArray();

  // The yellow line along the edge, and the landing at the top of the stairs.
  box(-PLAT_HALF, PLAT_HALF, EDGE_L, EDGE_L + 0.3, PLAT_Y, PLAT_Y + 0.02, M_PAINT, EDGE, BOX_TOP);
  box(LANDING_A, STAIR_TOP, PLAT_L, STAIR_L, PLAT_Y - 0.4, PLAT_Y, M_CONCRETE, DECK);
  // Railings round everything but the platform edge and the way onto the landing.
  const rail = (a0: number, a1: number, l0: number, l1: number) => box(a0, a1, l0, l1, PLAT_Y, PLAT_Y + 1.05, M_RAIL, METAL, BOX_SIDES | BOX_TOP);
  rail(STAIR_TOP, PLAT_HALF, PLAT_L - 0.06, PLAT_L);
  rail(-PLAT_HALF, LANDING_A, PLAT_L - 0.06, PLAT_L);
  rail(PLAT_HALF - 0.06, PLAT_HALF, EDGE_L, PLAT_L);
  rail(-PLAT_HALF, -PLAT_HALF + 0.06, EDGE_L, PLAT_L);
  rail(LANDING_A, STAIR_TOP, STAIR_L - 0.06, STAIR_L);
  rail(LANDING_A, LANDING_A + 0.06, PLAT_L, STAIR_L);
  // Cross beams from the line's pillars, and the column under the landing.
  for (const a of [-16, 16]) box(a - 0.25, a + 0.25, 0, PLAT_L, PLAT_Y - 1, PLAT_Y - 0.4, M_CONCRETE, STONE, BOX_SIDES | BOX_BOTTOM);
  box(COLUMN.a - COLUMN.r, COLUMN.a + COLUMN.r, COLUMN.l - COLUMN.r, COLUMN.l + COLUMN.r, 0, PLAT_Y - 0.4, M_CONCRETE, STONE, BOX_SIDES);

  // A light strip under the canopy, and the posts holding it up.
  box(-16, 16, 2.7, 3.1, ROOF_Y - 0.06, ROOF_Y, M_LAMP, LIGHT, BOX_SIDES | BOX_BOTTOM);
  for (const a of POST_A) box(a - 0.08, a + 0.08, 4.17, 4.33, PLAT_Y, ROOF_Y, M_RAIL, METAL, BOX_SIDES);
  box(LANDING_A - 0.08, LANDING_A + 0.08, 6.22, 6.38, PLAT_Y, ROOF_Y, M_RAIL, METAL, BOX_SIDES);

  // Benches along the back, facing the track.
  for (const c of BENCH_A) {
    box(c - 0.9, c + 0.9, 3.55, 4.05, PLAT_Y + 0.4, PLAT_Y + 0.47, M_WOOD, BENCH);
    box(c - 0.9, c + 0.9, 4.05, 4.14, PLAT_Y + 0.47, PLAT_Y + 0.95, M_WOOD, BENCH);
    for (const s of [-0.75, 0.75]) box(c + s - 0.05, c + s + 0.05, 3.6, 4.1, PLAT_Y, PLAT_Y + 0.4, M_RAIL, METAL, BOX_SIDES);
  }

  // Stairs: treads and risers from the kerb up to the landing, walled in on both sides.
  const run = (STAIR_FOOT - STAIR_TOP) / STEPS, rise = PLAT_Y / STEPS;
  for (let k = 1; k <= STEPS; k++) {
    const aHi = STAIR_FOOT - (k - 1) * run, aLo = STAIR_FOOT - k * run;
    box(aLo, aHi, PLAT_L + 0.06, STAIR_L - 0.06, k * rise - 0.02, k * rise, M_CONCRETE, STONE, BOX_TOP);
    // Riser facing down the stairs: the reader's right is +n.
    F.wall(X(aHi, PLAT_L + 0.06), Z(aHi, PLAT_L + 0.06), X(aHi, STAIR_L - 0.06), Z(aHi, STAIR_L - 0.06), (k - 1) * rise, k * rise, 0, M_CONCRETE, STONE[0] * 0.8, STONE[1] * 0.8, STONE[2] * 0.8, 0);
  }
  const top = PLAT_Y, hand = 1.0;
  // Outer wall (facing into the loop) and inner wall (facing the street under the platform), concrete below the treads.
  side(STAIR_L, [[STAIR_FOOT, 0], [STAIR_TOP, 0], [STAIR_TOP, top], [STAIR_FOOT, 0.01]], M_CONCRETE, STONE);
  side(STAIR_L, [[STAIR_FOOT, 0.01], [STAIR_TOP, top], [STAIR_TOP, top + hand], [STAIR_FOOT, hand]], M_RAIL, METAL);
  side(PLAT_L, [[STAIR_TOP, 0], [STAIR_FOOT, 0], [STAIR_FOOT, 0.01], [STAIR_TOP, top]], M_CONCRETE, STONE);
  side(PLAT_L, [[STAIR_TOP, top], [STAIR_FOOT, 0.01], [STAIR_FOOT, hand], [STAIR_TOP, top + hand]], M_RAIL, METAL);
  // The same balustrades seen from the stairs.
  side(STAIR_L - 0.06, [[STAIR_TOP, top], [STAIR_FOOT, 0.01], [STAIR_FOOT, hand], [STAIR_TOP, top + hand]], M_RAIL, METAL);
  side(PLAT_L + 0.06, [[STAIR_FOOT, 0.01], [STAIR_TOP, top], [STAIR_TOP, top + hand], [STAIR_FOOT, hand]], M_RAIL, METAL);
  // Back of the stair block, under the landing: the reader's right is -n.
  F.wall(X(STAIR_TOP, STAIR_L), Z(STAIR_TOP, STAIR_L), X(STAIR_TOP, PLAT_L), Z(STAIR_TOP, PLAT_L), 0, PLAT_Y - 0.4, 0, M_CONCRETE, STONE[0], STONE[1], STONE[2], 0);

  // The name under the canopy's street-side edge, and on the back railing facing the trains, with MIND THE GAP.
  name(0, STAIR_L + 0.22, 1, ROOF_Y - 0.9);
  name(-3, PLAT_L - 0.03, -1, PLAT_Y + 1.3);
  const gap = SIGN_TEXTS.indexOf('MIND THE GAP');
  for (const a of [7.2, 16]) board(gap, a, PLAT_L - 0.03, -1, PLAT_Y + 1.3, WARN);

  return F.toArray();
}

/** People waiting: some on the benches, some near the edge. Who they are changes as each train leaves. */
function crowd(b: Built, slot: number): Float32Array {
  const st = b.st;
  const rnd = mulberry32(hash3(st.cx * 16 + st.n, st.cz * 7919 + slot, worldSeed ^ 0x9a55));
  const X = (a: number, l: number) => st.x + st.dx * a + st.nx * l;
  const Z = (a: number, l: number) => st.z + st.dz * a + st.nz * l;
  const facing = Math.atan2(-st.nx, -st.nz);
  const out: number[] = [];
  for (const c of BENCH_A) {
    for (const s of [-0.45, 0.45]) {
      if (rnd() < 0.35) out.push(X(c + s, 3.95), PLAT_Y, Z(c + s, 3.95), facing, POSE_CHAIR, Math.floor(rnd() * 1e6));
    }
  }
  const standing = 1 + Math.floor(rnd() * 5);
  for (let k = 0; k < standing; k++) {
    const a = -17 + rnd() * 34, l = 2.1 + rnd() * 1.1;
    out.push(X(a, l), PLAT_Y, Z(a, l), facing + (rnd() - 0.5) * 1.8, POSE_STAND, Math.floor(rnd() * 1e6));
  }
  return new Float32Array(out);
}

/** Seats on each side of a car, between the doors, in metres along it from its middle. */
const BENCHES: readonly (readonly [number, number])[] = [[-5.2, -3.4], [-1.9, 1.9], [3.4, 5.2]];
const DOORS = [-2.65, 2.65];
/**
 * Where a rider stands: near the front of the leading car (metres ahead of its middle), far enough back
 * that the front window's frame, the ceiling and the seats beside stay in view.
 */
export const RIDE_SEAT = CAR_LEN / 2 - 2.4;
export const RIDE_EYE = CAR_FLOOR + 1.62;
/** The same seat, measured from the middle of the train. */
const RIDE_FWD = RIDE_SEAT + ((CARS - 1) / 2) * (CAR_LEN + CAR_GAP);

/** Passengers of one car on one trip, in car coordinates: along, across, yaw offset, pose, seed. */
function passengers(k: number, m: number, trip: number, out: number[]): void {
  out.length = 0;
  const rnd = mulberry32(hash3(k * 8 + m, trip, worldSeed ^ 0x7ab1));
  for (const [f0, f1] of BENCHES) {
    for (let f = f0 + 0.3; f < f1; f += 0.6) {
      for (const s of [-1, 1]) {
        if (rnd() < 0.3) out.push(f, s * 1.0, s > 0 ? -Math.PI / 2 : Math.PI / 2, POSE_CHAIR, Math.floor(rnd() * 1e6));
      }
    }
  }
  const standing = Math.floor(rnd() * 4);
  for (let n = 0; n < standing; n++) {
    const f = DOORS[n & 1] + (rnd() - 0.5) * 0.8, r = (rnd() - 0.5) * 0.9, yaw = (rnd() - 0.5) * 6, seed = Math.floor(rnd() * 1e6);
    // Nobody stands where a rider does.
    if (m === 0 && Math.abs(f - RIDE_SEAT) < 0.8 && Math.abs(r) < 0.6) continue;
    out.push(f, r, yaw, POSE_STAND, seed);
  }
}

/**
 * The monorail on screen: every loop's trains near the camera, its stations (built once, kept while
 * near), and, for whoever rides one, the inside of the cars with their passengers.
 */
export class Rail {
  /** Wall-clock seconds, so every player sees the trains in the same places. Held while the world is frozen. */
  time = Date.now() / 1000;
  private readonly state: TrainState = { s: 0, at: -1, next: 0, left: 0, trip: 0 };
  private readonly pt: PathPoint = { x: 0, z: 0, yaw: 0 };
  /** Keyed by the station itself, so entries go when `stationsOf` lets go of a loop. */
  private readonly built = new WeakMap<Station, Built>();
  private readonly rideState: TrainState = { s: 0, at: -1, next: 0, left: 0, trip: 0 };
  private readonly ridePt: PathPoint = { x: 0, z: 0, yaw: 0 };
  private readonly seats: number[] = [];
  private riders = new Float32Array(0);

  update(dt: number): void {
    if (dt > 0) this.time = Date.now() / 1000;
  }

  train(ref: TrainRef, out: TrainState = this.state): TrainState {
    return trainState(ref.cx, ref.cz, ref.k, this.time, out);
  }

  /** Centre and heading of car `m` of a train. */
  car(ref: TrainRef, m: number, out: PathPoint = this.pt): PathPoint {
    return carPoint(ref.cx, ref.cz, this.train(ref).s, m, out);
  }

  /** The train of the loop around (x, z) that is closest to it; from the farmland, of the nearest city loop. */
  nearest(x: number, z: number): TrainRef {
    const cx = Math.max(-CITY_CELLS, Math.min(CITY_CELLS - 1, cellOf(x)));
    const cz = Math.max(-CITY_CELLS, Math.min(CITY_CELLS - 1, cellOf(z)));
    let best = 0, bd = Infinity;
    for (let k = 0; k < TRAINS; k++) {
      const p = this.car({ cx, cz, k }, 1);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return { cx, cz, k: best };
  }

  /** The platform someone with feet at `feet` stands on at (x, z), or null. */
  platformAt(x: number, z: number, feet: number): Station | null {
    if (Math.abs(feet - PLAT_Y) > STEP) return null;
    const at = { a: 0, l: 0 };
    const st = stationNear(x, z, at);
    return st && at.l >= EDGE_L && at.l <= STAIR_L ? st : null;
  }

  /** The train standing at a station with its doors open, if any. */
  standing(st: Station): TrainRef | null {
    const k = trainAt(st.cx, st.cz, st.n, this.time);
    return k < 0 ? null : { cx: st.cx, cz: st.cz, k };
  }

  /** Where a rider steps out, if the train stands at a station: on the platform by the front car, facing the stairs. */
  alightAt(ref: TrainRef): { x: number; z: number; yaw: number; st: Station } | null {
    const t = this.train(ref);
    if (t.at < 0) return null;
    const st = stationsOf(ref.cx, ref.cz)[t.at];
    const a = RIDE_FWD - 1.5, l = EDGE_L + 1.1;
    return { x: st.x + st.dx * a + st.nx * l, z: st.z + st.dz * a + st.nz * l, yaw: Math.atan2(-st.dx, -st.dz), st };
  }

  draw(cam: Camera, time: number, riding: TrainRef | null): void {
    const far = cam.far;
    const cx0 = cellOf(cam.x - far), cx1 = cellOf(cam.x + far);
    const cz0 = cellOf(cam.z - far), cz1 = cellOf(cam.z + far);
    const y = CAR_FLOOR + 1.35;
    const p = this.pt, t = this.state;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        if (!hasLoop(cx, cz)) continue;
        for (let k = 0; k < TRAINS; k++) {
          trainState(cx, cz, k, this.time, t);
          const own = riding !== null && riding.cx === cx && riding.cz === cz && riding.k === k;
          for (let m = 0; m < CARS; m++) {
            carPoint(cx, cz, t.s, m, p);
            if ((p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > (far + 10) ** 2 || !sphereVisible(p.x, y, p.z, 7)) continue;
            stats.actors++;
            // Passengers show in the windows; which ones changes at every station.
            drawBoxYaw(p.x, y, p.z, p.yaw, CAR_HALF_W, 1.35, CAR_LEN / 2, M_TRAIN, 190, 196, 206, 1 + (hash3(k, m, t.trip) & 0xffff), 63);
            const fX = Math.sin(p.yaw), fZ = Math.cos(p.yaw), rX = fZ, rZ = -fX;
            if (m === 0 && !own) {
              for (const s of [-0.7, 0.7]) drawPoint(p.x + fX * (CAR_LEN / 2 + 0.1) + rX * s, y - 0.6, p.z + fZ * (CAR_LEN / 2 + 0.1) + rZ * s, G_STAR, 255, 250, 220, 0.6, 1);
            }
            if (m === CARS - 1) {
              for (const s of [-0.7, 0.7]) drawPoint(p.x - fX * (CAR_LEN / 2 + 0.1) + rX * s, y - 0.6, p.z - fZ * (CAR_LEN / 2 + 0.1) + rZ * s, G_o, 255, 40, 40, 0.5, 1);
            }
          }
        }
        for (const st of stationsOf(cx, cz)) this.drawStation(st, cam, time);
      }
    }
  }

  private drawStation(st: Station, cam: Camera, time: number): void {
    const d2 = (st.x - cam.x) ** 2 + (st.z - cam.z) ** 2;
    if (d2 > (cam.far + 25) ** 2 || !sphereVisible(st.x, PLAT_Y, st.z, 26)) return;
    let b = this.built.get(st);
    if (!b) {
      b = { st, faces: null, far: stationFaces(st, false), people: new Float32Array(0), slot: Number.NaN };
      this.built.set(st, b);
    }
    const near = d2 < DETAIL_R * DETAIL_R;
    if (near) b.faces ??= stationFaces(st, true);
    else if (d2 > (DETAIL_R + 120) ** 2) b.faces = null;
    const f = near && b.faces ? b.faces : b.far;
    for (let o = 0; o < f.length; o += FACE_STRIDE) drawFace(f, o);
    if (d2 > 40 * 40) return;
    const slot = crowdSlot(st.cx, st.cz, st.n, this.time);
    if (slot !== b.slot) {
      b.slot = slot;
      b.people = crowd(b, slot);
    }
    drawOccupants(b.people, cam, time);
  }

  /** The inside of the train being ridden: floor, seats, windows, poles and the other passengers. */
  drawRide(cam: Camera, ref: TrainRef, time: number): void {
    const t = this.train(ref, this.rideState);
    const yF = CAR_FLOOR;
    let n = 0;
    for (let m = 0; m < CARS; m++) {
      const p = carPoint(ref.cx, ref.cz, t.s, m, this.ridePt);
      const yaw = p.yaw, fX = Math.sin(yaw), fZ = Math.cos(yaw), rX = fZ, rZ = -fX;
      const slab = (f: number, r: number, yc: number, hx: number, hy: number, hz: number, mat: number, c: RGB, mask = 31) =>
        drawBoxYaw(p.x + fX * f + rX * r, yF + yc, p.z + fZ * f + rZ * r, yaw, hx, hy, hz, mat, c[0], c[1], c[2], 0, mask);
      const half = CAR_LEN / 2 - 0.05;
      slab(0, 0, 0.02, 1.3, 0.02, half, M_FLOOR, [80, 84, 94]);
      // The ceiling and its light are seen from below, so they need their undersides.
      slab(0, 0, 2.52, 1.3, 0.02, half, M_CEILING, [215, 218, 224], 32);
      slab(0, 0, 2.49, 0.12, 0.01, half - 0.5, M_GLOW, [255, 244, 222], 47);
      for (const s of [-1, 1]) {
        slab(0, s * 1.31, 0.5, 0.03, 0.5, half, M_PLASTER, [196, 202, 210]);
        slab(0, s * 1.31, 2.3, 0.03, 0.22, half, M_PLASTER, [196, 202, 210]);
        for (let f = -4.8; f <= 4.81; f += 1.6) slab(f, s * 1.31, 1.54, 0.04, 0.54, 0.07, M_PLASTER, [170, 176, 186]);
        for (const [f0, f1] of BENCHES) {
          slab((f0 + f1) / 2, s * 1.03, 0.43, 0.24, 0.04, (f1 - f0) / 2, M_CLOTH, [60, 92, 150]);
          slab((f0 + f1) / 2, s * 1.25, 0.72, 0.03, 0.28, (f1 - f0) / 2, M_CLOTH, [60, 92, 150]);
        }
      }
      for (const e of [-1, 1]) {
        const f = e * half;
        slab(f, 0, 0.5, 1.3, 0.5, 0.03, M_PLASTER, [196, 202, 210]);
        slab(f, 0, 2.3, 1.3, 0.22, 0.03, M_PLASTER, [196, 202, 210]);
        // Between cars a gangway; the front of the first car and the back of the last are windows.
        const outer = (m === 0 && e > 0) || (m === CARS - 1 && e < 0);
        if (!outer) for (const s of [-1, 1]) slab(f, s * 0.9, 1.54, 0.4, 0.54, 0.03, M_PLASTER, [196, 202, 210]);
      }
      for (const f of DOORS) drawVLine(p.x + fX * f, yF, yF + 2.5, p.z + fZ * f, 0.03, G_PIPE, 205, 210, 218, 0);
      passengers(ref.k, m, t.trip, this.seats);
      if (this.riders.length < (n + this.seats.length / 5) * PERSON_STRIDE) {
        const grown = new Float32Array((n + this.seats.length / 5) * PERSON_STRIDE * 2);
        grown.set(this.riders);
        this.riders = grown;
      }
      for (let q = 0; q < this.seats.length; q += 5) {
        const f = this.seats[q], r = this.seats[q + 1], o = n * PERSON_STRIDE;
        this.riders[o] = p.x + fX * f + rX * r;
        this.riders[o + 1] = yF;
        this.riders[o + 2] = p.z + fZ * f + rZ * r;
        this.riders[o + 3] = yaw + this.seats[q + 2];
        this.riders[o + 4] = this.seats[q + 3];
        this.riders[o + 5] = this.seats[q + 4];
        n++;
      }
    }
    drawOccupants(this.riders.subarray(0, n * PERSON_STRIDE), cam, time);
  }
}

/** Every station of the loops around (x, z), for the map. */
export function stationsAround(x: number, z: number, r: number): Station[] {
  const out: Station[] = [];
  for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++) {
    for (let cz = cellOf(z - r); cz <= cellOf(z + r); cz++) out.push(...stationsOf(cx, cz));
  }
  return out;
}
