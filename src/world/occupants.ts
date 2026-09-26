import type { Camera } from '../render/camera';
import { M_CLOTH, M_SKIN } from '../render/materials';
import { drawBoxYaw, sphereVisible, stats } from '../render/raster';
import { SHIRTS, SKINS } from './pedestrians';

/** x, y (floor), z, yaw, pose, seed */
export const PERSON_STRIDE = 6;
export const POSE_STAND = 0;
/** Standing behind a counter, in an apron. */
export const POSE_STAFF = 1;
export const POSE_CHAIR = 2;
export const POSE_STOOL = 3;

const SEAT_H = [0, 0, 0.47, 0.76];
const APRONS: readonly (readonly [number, number, number])[] = [[235, 235, 230], [40, 40, 46], [150, 40, 40], [60, 90, 70]];
const TROUSERS: readonly (readonly [number, number, number])[] = [[50, 52, 64], [70, 60, 50], [40, 40, 44], [90, 90, 100]];
const DRAW_DIST = 28;

/**
 * People inside shops and homes: the same blocky figure as the pedestrians, standing or seated.
 * They stay where the furniture put them and only fidget, so they cost nothing to simulate.
 */
export function drawOccupants(p: Float32Array, cam: Camera, time: number): void {
  for (let o = 0; o < p.length; o += PERSON_STRIDE) {
    const x = p[o], y = p[o + 1], z = p[o + 2];
    const dx = x - cam.x, dz = z - cam.z;
    if (dx * dx + dz * dz > DRAW_DIST * DRAW_DIST || !sphereVisible(x, y + 0.9, z, 1.1)) continue;
    stats.actors++;
    const pose = p[o + 4], seed = p[o + 5];
    // Heads turn slowly and staff shift their weight; each person on their own rhythm.
    const ph = time * 0.6 + seed * 0.37;
    const yaw = p[o + 3] + Math.sin(ph * 0.5) * (pose === POSE_STAFF ? 0.35 : 0.15);
    const fX = Math.sin(yaw), fZ = Math.cos(yaw), rX = fZ, rZ = -fX;
    const shirt = SHIRTS[seed % SHIRTS.length];
    const skin = SKINS[(seed >> 3) % SKINS.length];
    const legs = TROUSERS[(seed >> 5) % TROUSERS.length];
    const seat = SEAT_H[pose];
    if (seat > 0) {
      // Thighs forward along the seat, shins down to the floor, torso upright over the seat.
      for (const s of [-1, 1]) {
        const lx = x + rX * 0.11 * s, lz = z + rZ * 0.11 * s;
        drawBoxYaw(lx + fX * 0.14, y + seat + 0.08, lz + fZ * 0.14, yaw, 0.08, 0.08, 0.2, M_CLOTH, legs[0], legs[1], legs[2], 0);
        drawBoxYaw(lx + fX * 0.3, y + seat / 2, lz + fZ * 0.3, yaw, 0.07, seat / 2, 0.08, M_CLOTH, legs[0], legs[1], legs[2], 0);
      }
      const lean = 0.03 + Math.sin(ph) * 0.02;
      drawBoxYaw(x + fX * lean, y + seat + 0.46, z + fZ * lean, yaw, 0.22, 0.3, 0.12, M_CLOTH, shirt[0], shirt[1], shirt[2], 0);
      drawBoxYaw(x + fX * (lean + 0.03), y + seat + 0.9, z + fZ * (lean + 0.03), yaw, 0.11, 0.12, 0.11, M_SKIN, skin[0], skin[1], skin[2], 0);
      continue;
    }
    const sway = pose === POSE_STAFF ? Math.sin(ph * 0.8) * 0.12 : 0;
    const bx = x + rX * sway, bz = z + rZ * sway;
    for (const s of [-1, 1]) {
      drawBoxYaw(bx + rX * 0.11 * s, y + 0.44, bz + rZ * 0.11 * s, yaw, 0.08, 0.44, 0.09, M_CLOTH, legs[0], legs[1], legs[2], 0);
    }
    const top = pose === POSE_STAFF ? APRONS[seed % APRONS.length] : shirt;
    drawBoxYaw(bx, y + 1.2, bz, yaw, 0.23, 0.33, 0.13, M_CLOTH, top[0], top[1], top[2], 0);
    drawBoxYaw(bx, y + 1.66, bz, yaw, 0.11, 0.12, 0.11, M_SKIN, skin[0], skin[1], skin[2], 0);
  }
}
