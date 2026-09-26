import type { Camera } from '../render/camera';
import { drawBoxYaw, drawPoint, sphereVisible, stats } from '../render/raster';
import { M_CAR, M_GLASS, M_GLOW, M_WHEEL } from '../render/materials';
import { glyph } from '../core/charset';
import { wrapAngle } from '../core/hash';
import { LANE, P, ROAD_HALF } from './layout';

const FWD_X = [0, 1, 0, -1];
const FWD_Z = [1, 0, -1, 0];
const RIGHT_X = [1, 0, -1, 0];
const RIGHT_Z = [0, -1, 0, 1];
const DIR_YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

const G_STAR = glyph('*');
const G_o = glyph('o');

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

export class Vehicle {
  x = 0;
  y = 0;
  z = 0;
  targetY = 0;
  layer = 0;
  dir = 0;
  speed = 11;
  yaw = 0;
  turn = 0;
  nextDir = 0;
  trigger = 0;
  kind = KIND_CAR;
  r = 200;
  g = 200;
  b = 200;
  seed = 0;
}

/**
 * Vehicles follow the road grid: one lane per direction at +-LANE from the centre line. A turn is
 * planned when a segment starts and executed when the car reaches the lane line of the crossing road.
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
        v.speed = 11;
      }
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
    const px = cx + Math.cos(ang) * rad, pz = cz + Math.sin(ang) * rad;
    v.dir = Math.floor(Math.random() * 4);
    if ((v.dir & 1) === 0) {
      v.x = Math.round(px / P) * P + RIGHT_X[v.dir] * LANE;
      v.z = pz;
    } else {
      v.z = Math.round(pz / P) * P + RIGHT_Z[v.dir] * LANE;
      v.x = px;
    }
    v.yaw = DIR_YAW[v.dir];
    if (this.sky) v.y = v.targetY = this.altitude(v);
    this.plan(v);
  }

  private plan(v: Vehicle): void {
    const even = (v.dir & 1) === 0;
    const pos = even ? v.z : v.x;
    const sgn = v.dir < 2 ? 1 : -1;
    const C = sgn > 0 ? (Math.floor((pos + ROAD_HALF) / P) + 1) * P : (Math.ceil((pos - ROAD_HALF) / P) - 1) * P;
    const straight = this.sky ? 0.75 : 0.55;
    const roll = Math.random();
    v.turn = roll < straight ? 0 : roll < (1 + straight) / 2 ? 1 : 2;
    v.nextDir = v.turn === 0 ? v.dir : v.turn === 1 ? (v.dir + 1) & 3 : (v.dir + 3) & 3;
    v.trigger = v.turn === 0 ? C : C + (even ? RIGHT_Z[v.nextDir] : RIGHT_X[v.nextDir]) * LANE;
  }

  update(dt: number, cx: number, cz: number, radius: number, keep: Vehicle | null): void {
    const r2 = radius * radius;
    for (const v of this.list) {
      const even = (v.dir & 1) === 0;
      const sgn = v.dir < 2 ? 1 : -1;
      const np = (even ? v.z : v.x) + sgn * v.speed * dt;
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
      if (v !== keep && (v.x - cx) ** 2 + (v.z - cz) ** 2 > r2) this.place(v, cx, cz, radius * 0.4, radius * 0.95);
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
  for (const s of [-1, 1]) {
    drawPoint(v.x + fX * 2.25 + rX * 0.62 * s, v.y + 0.8, v.z + fZ * 2.25 + rZ * 0.62 * s, G_STAR, 255, 245, 210, 0.5, 1);
    drawPoint(v.x - fX * 2.25 + rX * 0.62 * s, v.y + 0.8, v.z - fZ * 2.25 + rZ * 0.62 * s, G_o, 255, 40, 40, 0.5, 1);
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
