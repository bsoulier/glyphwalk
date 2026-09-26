import type { Camera } from '../render/camera';
import { drawBoxYaw, drawVLine, sphereVisible, stats } from '../render/raster';
import { M_CLOTH, M_SKIN } from '../render/materials';
import { glyph } from '../core/charset';
import { P } from './layout';
import { signalPhase, walkWindow } from './signals';

/** Brisk pace on the crosswalk, fast enough to clear the widest crossing within one walk window. */
const CROSS_SPEED = 2.2;
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];
const G_PIPE = glyph('|');

export const SHIRTS: readonly (readonly [number, number, number])[] = [
  [200, 60, 60], [60, 120, 210], [230, 200, 80], [90, 190, 110], [200, 200, 205], [150, 80, 180], [240, 130, 40], [60, 60, 70],
];
export const SKINS: readonly (readonly [number, number, number])[] = [[230, 185, 150], [190, 140, 100], [140, 95, 65], [95, 65, 45]];
const UMBRELLAS: readonly (readonly [number, number, number])[] = [[40, 40, 50], [200, 40, 60], [40, 110, 200], [230, 230, 235]];

class Ped {
  bi = 0;
  bj = 0;
  s = 0;
  dir = 1;
  off = 8;
  speed = 1.3;
  phase = 0;
  crossing = false;
  /** Standing at the kerb until the signal at intersection (ii, jj) allows the crossing. */
  waiting = false;
  ii = 0;
  jj = 0;
  ax = 0;
  az = 0;
  bx = 0;
  bz = 0;
  t = 0;
  nbi = 0;
  nbj = 0;
  ns = 0;
  x = 0;
  z = 0;
  yaw = 0;
  shirt: readonly [number, number, number] = SHIRTS[0];
  skin: readonly [number, number, number] = SKINS[0];
  umbrella: readonly [number, number, number] | null = null;
}

function cornerX(k: number, off: number): number {
  return k === 1 || k === 2 ? P - off : off;
}
function cornerZ(k: number, off: number): number {
  return k >= 2 ? P - off : off;
}

/**
 * Each pedestrian walks a rectangular loop around one block's sidewalk (`s` = distance along it).
 * At corners some cross the road on the zebra crossing and continue on the neighbouring block.
 */
export class Pedestrians {
  readonly list: Ped[] = [];

  constructor(count: number) {
    for (let k = 0; k < count; k++) {
      const p = new Ped();
      p.shirt = SHIRTS[k % SHIRTS.length];
      p.skin = SKINS[(k * 7) % SKINS.length];
      p.umbrella = Math.random() < 0.45 ? UMBRELLAS[k % UMBRELLAS.length] : null;
      this.spawn(p, 0, 0, 3);
      this.list.push(p);
    }
  }

  private spawn(p: Ped, cx: number, cz: number, reach: number): void {
    p.bi = Math.floor(cx / P) + Math.floor(Math.random() * (reach * 2 + 1)) - reach;
    p.bj = Math.floor(cz / P) + Math.floor(Math.random() * (reach * 2 + 1)) - reach;
    p.off = 7.4 + Math.random() * 1.8;
    p.s = Math.random() * 4 * (P - 2 * p.off);
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.speed = 1 + Math.random() * 0.7;
    p.crossing = false;
    p.waiting = false;
    this.locate(p);
  }

  private locate(p: Ped): void {
    if (p.crossing || p.waiting) {
      p.x = p.ax + (p.bx - p.ax) * p.t;
      p.z = p.az + (p.bz - p.az) * p.t;
      return;
    }
    const L = P - 2 * p.off;
    const k = Math.floor(p.s / L) & 3;
    const a = p.s - Math.floor(p.s / L) * L;
    p.x = p.bi * P + cornerX(k, p.off) + DX[k] * a;
    p.z = p.bj * P + cornerZ(k, p.off) + DZ[k] * a;
    p.yaw = Math.atan2(DX[k] * p.dir, DZ[k] * p.dir);
  }

  update(dt: number, cx: number, cz: number, radius: number, time: number): void {
    const r2 = radius * radius;
    for (const p of this.list) {
      const L = P - 2 * p.off, per = 4 * L;
      if (p.waiting) {
        // Only step off the kerb if the whole crossing fits before cars get green.
        if (walkWindow(signalPhase(p.ii, p.jj, time)) >= (2 * p.off) / CROSS_SPEED) {
          p.waiting = false;
          p.crossing = true;
        }
      } else p.phase += p.speed * dt * 5;
      if (p.crossing) {
        p.phase += (CROSS_SPEED - p.speed) * dt * 5;
        p.t += (CROSS_SPEED * dt) / (2 * p.off);
        if (p.t >= 1) {
          p.crossing = false;
          p.bi = p.nbi;
          p.bj = p.nbj;
          p.s = p.ns;
        }
      } else if (!p.waiting) {
        const prevSide = Math.floor(p.s / L);
        p.s += p.dir * p.speed * dt;
        if (Math.floor(p.s / L) !== prevSide) {
          const side = ((prevSide % 4) + 4) % 4;
          if (Math.random() < 0.35) {
            const corner = p.dir > 0 ? (side + 1) & 3 : side;
            const ddx = DX[side] * p.dir, ddz = DZ[side] * p.dir;
            p.ax = p.bi * P + cornerX(corner, p.off);
            p.az = p.bj * P + cornerZ(corner, p.off);
            p.bx = p.ax + ddx * 2 * p.off;
            p.bz = p.az + ddz * 2 * p.off;
            p.nbi = p.bi + ddx;
            p.nbj = p.bj + ddz;
            p.ns = p.dir > 0 ? side * L + 0.001 : (side + 1) * L - 0.001;
            p.ii = p.bi + (corner === 1 || corner === 2 ? 1 : 0);
            p.jj = p.bj + (corner >= 2 ? 1 : 0);
            p.waiting = true;
            p.t = 0;
            p.yaw = Math.atan2(ddx, ddz);
          }
          p.s = ((p.s % per) + per) % per;
        }
      }
      this.locate(p);
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > r2) this.spawn(p, cx, cz, Math.max(1, Math.floor(radius / P)));
    }
  }

  draw(cam: Camera, rain: boolean): void {
    for (const p of this.list) {
      const dx = p.x - cam.x, dz = p.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 130 * 130 || !sphereVisible(p.x, 1, p.z, 1.3)) continue;
      stats.actors++;
      const [sr, sg, sb] = p.shirt;
      if (d2 > 40 * 40) {
        drawVLine(p.x, 0.1, 1.75, p.z, 0, G_PIPE, sr, sg, sb, 0);
        continue;
      }
      const fX = Math.sin(p.yaw), fZ = Math.cos(p.yaw), rX = fZ, rZ = -fX;
      const sw = Math.sin(p.phase) * 0.16;
      for (const s of [-1, 1]) {
        drawBoxYaw(p.x + rX * 0.11 * s + fX * sw * s, 0.44, p.z + rZ * 0.11 * s + fZ * sw * s, p.yaw, 0.08, 0.44, 0.09, M_CLOTH, 50, 52, 64, 0);
      }
      drawBoxYaw(p.x, 1.2, p.z, p.yaw, 0.23, 0.33, 0.13, M_CLOTH, sr, sg, sb, 0);
      drawBoxYaw(p.x, 1.66, p.z, p.yaw, 0.11, 0.12, 0.11, M_SKIN, p.skin[0], p.skin[1], p.skin[2], 0);
      if (rain && p.umbrella) {
        const [ur, ug, ub] = p.umbrella;
        drawBoxYaw(p.x, 2.08, p.z, p.yaw, 0.55, 0.05, 0.55, M_CLOTH, ur, ug, ub, 0, 63);
      }
    }
  }
}
