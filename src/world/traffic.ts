import type { Camera } from '../render/camera';
import { drawBoxYaw, drawPoint, sphereVisible, stats } from '../render/raster';
import { M_CAR, M_GLASS, M_GLOW, M_WHEEL } from '../render/materials';
import { glyph } from '../core/charset';
import { wrapAngle } from '../core/hash';
import { hoodAt } from './hoods';
import { LANE, P, ROAD_HALF } from './layout';
import { AMBER, RED, carLight, signalPhase } from './signals';

const FWD_X = [0, 1, 0, -1];
const FWD_Z = [1, 0, -1, 0];
const RIGHT_X = [1, 0, -1, 0];
const RIGHT_Z = [0, -1, 0, 1];
const DIR_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

const G_STAR = glyph('*');
const G_o = glyph('o');
const G_AT = glyph('@');

const CAR_COLORS: readonly (readonly [number, number, number])[] = [
  [60, 90, 210], [200, 45, 45], [205, 205, 210], [45, 45, 52], [45, 150, 95], [45, 165, 175], [160, 95, 45], [125, 65, 170],
];
const SKY_COLORS: readonly (readonly [number, number, number])[] = [
  [40, 220, 255], [255, 60, 200], [255, 210, 60], [140, 255, 120], [255, 120, 40],
];

export const KIND_CAR = 0;
export const KIND_TAXI = 1;
export const KIND_POLICE = 2;
export const KIND_SKY = 3;

const ACCEL = 3.2;
const BRAKE = 9;
/** Deceleration used to plan stops; lower than BRAKE so cars ease in rather than slam. */
const COMFORT = 4.2;
const CAR_LEN = 4.5;
/** Car centre stops this far before the intersection centre: front bumper just behind the stop line. */
const STOP_BACK = 12.8;
const WALKER_LOOK = 34;
const PED_LOOK = 22;

export class Vehicle {
  x = 0;
  y = 0;
  z = 0;
  targetY = 0;
  layer = 0;
  dir = 0;
  /** Cruise speed; `vel` is the current one. */
  speed = 11;
  vel = 11;
  yaw = 0;
  turn = 0;
  nextDir = 0;
  trigger = 0;
  /** Centre line of the next intersection along the current axis. */
  cross = 0;
  kind = KIND_CAR;
  r = 200;
  g = 200;
  b = 200;
  seed = 0;
  /** Seconds of high-beam flashing left. */
  flash = 0;
  braking = false;
  /** District the route must stay in (a hailed ride), or -1 to roam. */
  home = -1;
}

export interface Walker {
  x: number;
  z: number;
}

export interface TrafficEnv {
  time: number;
  /** The player on foot, whom cars stop for. */
  walker: Walker | null;
  peds: readonly { x: number; z: number; crossing: boolean }[];
}

/**
 * Vehicles follow the road grid: one lane per direction at +-LANE from the centre line. A turn is
 * planned when a segment starts and executed when the car reaches the lane line of the crossing road.
 * Ground cars also keep a speed and stop for red lights, the car ahead, and people in their lane.
 */
export class Traffic {
  readonly list: Vehicle[] = [];

  constructor(count: number, private readonly sky: boolean) {
    for (let k = 0; k < count; k++) {
      const v = new Vehicle();
      v.seed = k;
      if (sky) {
        v.kind = KIND_SKY;
        const c = SKY_COLORS[k % SKY_COLORS.length];
        v.r = c[0]; v.g = c[1]; v.b = c[2];
        v.layer = k % 3;
        v.speed = 18 + v.layer * 6;
      } else {
        const roll = Math.random();
        v.kind = roll < 0.18 ? KIND_TAXI : roll < 0.24 ? KIND_POLICE : KIND_CAR;
        const c = v.kind === KIND_TAXI ? [235, 190, 40] : v.kind === KIND_POLICE ? [30, 32, 44] : CAR_COLORS[k % CAR_COLORS.length];
        v.r = c[0]; v.g = c[1]; v.b = c[2];
        v.speed = 12 + Math.random() * 2.5;
      }
      v.vel = v.speed;
      this.place(v, 0, 0, 10, 220);
      this.list.push(v);
    }
  }

  private altitude(v: Vehicle): number {
    return 26 + v.layer * 14 + (v.dir & 1) * 6;
  }

  private place(v: Vehicle, cx: number, cz: number, rMin: number, rMax: number): void {
    const ang = Math.random() * Math.PI * 2;
    const rad = rMin + Math.random() * (rMax - rMin);
    this.putOnRoad(v, cx + Math.cos(ang) * rad, cz + Math.sin(ang) * rad, Math.floor(Math.random() * 4));
    v.vel = v.speed;
  }

  private putOnRoad(v: Vehicle, px: number, pz: number, dir: number): void {
    v.dir = dir;
    if ((dir & 1) === 0) {
      v.x = Math.round(px / P) * P + RIGHT_X[dir] * LANE;
      v.z = pz;
    } else {
      v.z = Math.round(pz / P) * P + RIGHT_Z[dir] * LANE;
      v.x = px;
    }
    v.yaw = DIR_YAW[dir];
    if (this.sky) v.y = v.targetY = this.altitude(v);
    this.plan(v);
  }

  /** Bring the nearest vehicle to the lane beside (x, z), bound to `hood` until released. */
  hail(x: number, z: number, hood: number): number {
    const k = this.nearest(x, z);
    const v = this.list[k];
    v.home = hood;
    const X = Math.round(x / P) * P, Z = Math.round(z / P) * P;
    if (Math.abs(x - X) < Math.abs(z - Z)) this.putOnRoad(v, x, z, x >= X ? 0 : 2);
    else this.putOnRoad(v, x, z, z >= Z ? 3 : 1);
    v.vel = this.sky ? v.speed * 0.5 : 0;
    return k;
  }

  /** Next vehicle after `current` that is already inside `hood`, re-bound to it; falls back to `current`. */
  nextIn(current: number, hood: number): number {
    const n = this.list.length;
    for (let s = 1; s < n; s++) {
      const k = (current + s) % n;
      const v = this.list[k];
      if (hoodAt(Math.floor(v.x / P), Math.floor(v.z / P)) !== hood) continue;
      this.release(current);
      v.home = hood;
      return k;
    }
    return current;
  }

  release(k: number): void {
    const v = this.list[k % this.list.length];
    if (v) v.home = -1;
  }

  private plan(v: Vehicle): void {
    const even = (v.dir & 1) === 0;
    const pos = even ? v.z : v.x;
    const sgn = v.dir < 2 ? 1 : -1;
    const C = sgn > 0 ? (Math.floor((pos + ROAD_HALF) / P) + 1) * P : (Math.ceil((pos - ROAD_HALF) / P) - 1) * P;
    v.cross = C;
    const straight = this.sky ? 0.75 : 0.55;
    const roll = Math.random();
    let turn = roll < straight ? 0 : roll < (1 + straight) / 2 ? 1 : 2;
    if (v.home >= 0) turn = this.stayIn(v, C, turn);
    v.turn = turn;
    v.nextDir = turn === 0 ? v.dir : turn === 1 ? (v.dir + 1) & 3 : (v.dir + 3) & 3;
    v.trigger = turn === 0 ? C : C + (even ? RIGHT_Z[v.nextDir] : RIGHT_X[v.nextDir]) * LANE;
  }

  /**
   * Prefer the planned turn, but only take a segment with a home-district block on its right, where
   * the lane is. A right turn circles the same block, so there is always at least one valid choice.
   */
  private stayIn(v: Vehicle, C: number, preferred: number): number {
    const even = (v.dir & 1) === 0;
    const ix = even ? Math.round(v.x / P) * P : C;
    const iz = even ? C : Math.round(v.z / P) * P;
    for (const t of [preferred, 0, 1, 2]) {
      const nd = t === 0 ? v.dir : t === 1 ? (v.dir + 1) & 3 : (v.dir + 3) & 3;
      const bx = ix + FWD_X[nd] * (P / 2) + RIGHT_X[nd] * 12, bz = iz + FWD_Z[nd] * (P / 2) + RIGHT_Z[nd] * 12;
      if (hoodAt(Math.floor(bx / P), Math.floor(bz / P)) === v.home) return t;
    }
    return preferred;
  }

  /** How far the car may still travel this frame before it has to be stopped. */
  private clearance(v: Vehicle, env: TrafficEnv): number {
    const even = (v.dir & 1) === 0;
    const sgn = v.dir < 2 ? 1 : -1;
    const pos = even ? v.z : v.x;
    const lane = even ? v.x : v.z;
    let limit = Infinity;

    const toStop = (v.cross - sgn * STOP_BACK - pos) * sgn;
    if (toStop > -0.3) {
      const i = even ? Math.round(v.x / P) : Math.round(v.cross / P);
      const j = even ? Math.round(v.cross / P) : Math.round(v.z / P);
      const light = carLight(signalPhase(i, j, env.time), even);
      // On amber, only stop if it can be done comfortably; otherwise clear the junction.
      if (light === RED || (light === AMBER && toStop > (v.vel * v.vel) / (2 * COMFORT))) limit = Math.max(0, toStop);
    }

    for (const o of this.list) {
      if (o === v || o.dir !== v.dir) continue;
      if (Math.abs((even ? o.x : o.z) - lane) > 1.5) continue;
      const gap = ((even ? o.z : o.x) - pos) * sgn - CAR_LEN - 1.8;
      if (gap > -CAR_LEN && gap < limit) limit = Math.max(0, gap);
    }

    const fx = FWD_X[v.dir], fz = FWD_Z[v.dir], rx = RIGHT_X[v.dir], rz = RIGHT_Z[v.dir];
    const w = env.walker;
    if (w) {
      const dx = w.x - v.x, dz = w.z - v.z;
      const along = dx * fx + dz * fz;
      if (along > 0 && along < WALKER_LOOK && Math.abs(dx * rx + dz * rz) < 2.1) {
        limit = Math.min(limit, Math.max(0, along - 4.8));
        v.flash = 0.8;
      }
    }
    for (const p of env.peds) {
      if (!p.crossing) continue;
      const dx = p.x - v.x, dz = p.z - v.z;
      const along = dx * fx + dz * fz;
      if (along > 0 && along < PED_LOOK && Math.abs(dx * rx + dz * rz) < 2.2) limit = Math.min(limit, Math.max(0, along - 4.5));
    }
    return limit;
  }

  update(dt: number, cx: number, cz: number, radius: number, keep: Vehicle | null, env: TrafficEnv): void {
    const r2 = radius * radius;
    for (const v of this.list) {
      let step: number;
      if (this.sky) {
        v.vel += (v.speed - v.vel) * Math.min(1, dt);
        step = v.vel * dt;
      } else {
        const limit = this.clearance(v, env);
        const want = Math.min(v.speed, Math.sqrt(2 * COMFORT * Math.max(0, limit - 0.2)));
        v.braking = want < v.vel - 0.05 || v.vel < 0.5;
        v.vel = v.vel < want ? Math.min(want, v.vel + ACCEL * dt) : Math.max(want, v.vel - BRAKE * dt);
        step = Math.min(v.vel * dt, limit);
        v.flash = Math.max(0, v.flash - dt);
      }

      const even = (v.dir & 1) === 0;
      const sgn = v.dir < 2 ? 1 : -1;
      const np = (even ? v.z : v.x) + sgn * step;
      if ((sgn > 0 && np >= v.trigger) || (sgn < 0 && np <= v.trigger)) {
        const over = Math.abs(np - v.trigger);
        if (even) v.z = v.trigger;
        else v.x = v.trigger;
        if (v.turn !== 0) v.dir = v.nextDir;
        if (this.sky) v.targetY = this.altitude(v);
        this.plan(v);
        v.x += FWD_X[v.dir] * over;
        v.z += FWD_Z[v.dir] * over;
      } else if (even) v.z = np;
      else v.x = np;

      v.yaw += wrapAngle(DIR_YAW[v.dir] - v.yaw) * Math.min(1, dt * 6);
      if (this.sky) v.y += (v.targetY - v.y) * Math.min(1, dt * 1.2);
      if (v !== keep && (v.x - cx) ** 2 + (v.z - cz) ** 2 > r2) {
        v.home = -1;
        this.place(v, cx, cz, radius * 0.4, radius * 0.95);
      }
    }
  }

  nearest(x: number, z: number): number {
    let best = 0, bd = Infinity;
    this.list.forEach((v, k) => {
      const d = (v.x - x) ** 2 + (v.z - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  draw(cam: Camera, time: number, drawR: number, skip: Vehicle | null): void {
    const r2 = drawR * drawR;
    for (const v of this.list) {
      if (v === skip) continue;
      const dx = v.x - cam.x, dy = v.y - cam.y, dz = v.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 || !sphereVisible(v.x, v.y + 1, v.z, 3)) continue;
      stats.actors++;
      if (this.sky) drawSkyCar(v, time);
      else drawCar(v, Math.sqrt(d2), time);
    }
  }
}

/**
 * Models are deliberately a handful of boxes: at glyph resolution a 6-box car reads better than a
 * detailed mesh, and each LOD step drops parts that would be smaller than a cell anyway.
 */
function drawCar(v: Vehicle, d: number, time: number): void {
  const fX = Math.sin(v.yaw), fZ = Math.cos(v.yaw), rX = fZ, rZ = -fX;
  drawBoxYaw(v.x, v.y + 0.72, v.z, v.yaw, 0.95, 0.36, 2.2, M_CAR, v.r, v.g, v.b, v.seed);
  if (d < 110) {
    drawBoxYaw(v.x - fX * 0.25, v.y + 1.4, v.z - fZ * 0.25, v.yaw, 0.82, 0.32, 1.15, M_GLASS, v.r, v.g, v.b, v.seed);
  }
  if (d < 45) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        drawBoxYaw(
          v.x + rX * 0.86 * sx + fX * 1.35 * sz, v.y + 0.34, v.z + rZ * 0.86 * sx + fZ * 1.35 * sz,
          v.yaw, 0.14, 0.34, 0.34, M_WHEEL, 0, 0, 0, 0, 15,
        );
      }
    }
  }
  if (v.kind === KIND_TAXI && d < 80) {
    drawBoxYaw(v.x - fX * 0.2, v.y + 1.84, v.z - fZ * 0.2, v.yaw, 0.35, 0.12, 0.16, M_GLOW, 255, 230, 120, 0);
  }
  if (v.kind === KIND_POLICE) {
    const blink = Math.floor(time * 6) & 1;
    drawPoint(v.x + rX * 0.4 - fX * 0.2, v.y + 1.85, v.z + rZ * 0.4 - fZ * 0.2, G_STAR, blink ? 255 : 40, 40, blink ? 40 : 255, 0.6, 1);
    drawPoint(v.x - rX * 0.4 - fX * 0.2, v.y + 1.85, v.z - rZ * 0.4 - fZ * 0.2, G_STAR, blink ? 40 : 255, 40, blink ? 255 : 40, 0.6, 1);
  }
  // Flashing high beams alternate with the normal lamps. Up close the lamps are real boxes so the
  // flash covers several cells instead of one; far away a single bright point is all that fits.
  const high = v.flash > 0 && (Math.floor(time * 7) & 1) === 0;
  const tail = v.braking ? 255 : 150;
  for (const s of [-1, 1]) {
    const hx = v.x + fX * 2.22 + rX * 0.62 * s, hz = v.z + fZ * 2.22 + rZ * 0.62 * s;
    if (d < 40) {
      const k = high ? 1 : 0.72;
      drawBoxYaw(hx, v.y + 0.82, hz, v.yaw, high ? 0.3 : 0.2, high ? 0.17 : 0.1, 0.04, M_GLOW, 255 * k, 248 * k, 215 * k, 0, 31);
    }
    if (high) {
      drawPoint(hx + fX * 0.3, v.y + 0.85, hz + fZ * 0.3, G_AT, 255, 255, 235, 0.9, 1);
      drawPoint(hx + fX * 1.4, v.y + 0.8, hz + fZ * 1.4, G_STAR, 255, 250, 220, 0.6, 1);
    } else drawPoint(hx + fX * 0.05, v.y + 0.8, hz + fZ * 0.05, G_STAR, 255, 245, 210, 0.5, 1);
    drawPoint(v.x - fX * 2.25 + rX * 0.62 * s, v.y + 0.8, v.z - fZ * 2.25 + rZ * 0.62 * s, G_o, tail, 40 * tail / 255, 40 * tail / 255, v.braking ? 0.8 : 0.5, 1);
  }
}

function drawSkyCar(v: Vehicle, time: number): void {
  const fX = Math.sin(v.yaw), fZ = Math.cos(v.yaw), rX = fZ, rZ = -fX;
  drawBoxYaw(v.x, v.y, v.z, v.yaw, 1.0, 0.45, 2.3, M_CAR, v.r * 0.8, v.g * 0.8, v.b * 0.8, v.seed, 63);
  drawBoxYaw(v.x - fX * 0.2, v.y + 0.75, v.z - fZ * 0.2, v.yaw, 0.8, 0.3, 1.2, M_GLASS, 0, 0, 0, v.seed);
  drawBoxYaw(v.x, v.y - 0.5, v.z, v.yaw, 0.7, 0.05, 1.8, M_GLOW, v.r, v.g, v.b, 0, 32);
  const blink = (time * 2 + v.seed * 0.37) % 1 < 0.5;
  drawPoint(v.x + fX * 2.35, v.y, v.z + fZ * 2.35, G_STAR, 255, 250, 230, 0.5, 1);
  if (blink) {
    drawPoint(v.x + rX * 1.1, v.y, v.z + rZ * 1.1, G_o, 60, 255, 90, 0.5, 1);
    drawPoint(v.x - rX * 1.1, v.y, v.z - rZ * 1.1, G_o, 255, 50, 50, 0.5, 1);
  }
}
