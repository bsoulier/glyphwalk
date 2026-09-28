import type { Camera } from '../render/camera';
import { drawBoxYaw, drawPoint } from '../render/raster';
import { M_CAR, M_CLOTH, M_GLOW, M_PAINT, M_PLASTER, M_SCREEN, M_SKIN } from '../render/materials';
import { glyph } from '../core/charset';
import type { RGB } from './signs';
import type { Vehicle } from './traffic';

/** The taxi being ridden, what its meter reads and what the radio is playing. */
export interface Cab {
  v: Vehicle;
  fare: number;
  radio: string;
}

/** The passenger's eyes, in car metres: right of the centre line, above the road, forward of the middle. */
export const SEAT_SIDE = 0.3;
export const SEAT_UP = 1.3;
export const SEAT_FWD = -0.78;
/** Extra field of view while riding, so the cabin around you fits on screen as it would in your eyes. */
export const CAB_FOV = 18;

const TRIM: RGB = [72, 72, 78];
const PANEL: RGB = [116, 108, 98];
const HEADLINER: RGB = [176, 168, 152];
const SEAT: RGB = [128, 100, 72];
const DASH: RGB = [54, 54, 60];
const CHROME: RGB = [190, 194, 204];
const SHIRT: RGB = [60, 110, 150];
const SKIN: RGB = [190, 140, 100];
const JEANS: RGB = [50, 70, 120];

// Mask bits of drawBoxYaw: front (+z) 1, back 2, right 4, left 8, top 16, bottom 32.
const FRONT = 1, BACK = 2, RIGHT = 4, LEFT = 8, TOP = 16, BOTTOM = 32;

let V: Vehicle;
let fX = 0, fZ = 1, rX = 1, rZ = 0;

/** Box in car coordinates: `x` to the right, `y` up from the road, `z` forward from the middle of the car. */
function part(x: number, y: number, z: number, hx: number, hy: number, hz: number, mat: number, c: RGB, mask = 63): void {
  drawBoxYaw(V.x + rX * x + fX * z, V.y + y, V.z + rZ * x + fZ * z, V.yaw, hx, hy, hz, mat, c[0], c[1], c[2], 0, mask);
}

/** One line of text, one cell per letter, facing the passenger from the dashboard. */
function readout(text: string, x: number, y: number, z: number, cam: Camera, c: RGB): void {
  const wx = V.x + rX * x + fX * z, wz = V.z + rZ * x + fZ * z;
  const d = Math.hypot(wx - cam.x, V.y + y - cam.y, wz - cam.z);
  const cw = d / cam.fx;
  for (let k = 0; k < text.length; k++) {
    if (text[k] === ' ') continue;
    const o = (k - (text.length - 1) / 2) * cw;
    drawPoint(wx + rX * o, V.y + y, wz + rZ * o, glyph(text[k]), c[0], c[1], c[2], 0.8, 1);
  }
}

/**
 * Inside of a yellow cab, seen from the right rear seat: dashboard with the meter and radio, the
 * driver with their hands on the wheel, front seats, door trims, pillars, headliner and the rear
 * bench. The body itself is not drawn while riding, so the windows are simply open to the city;
 * the hood and trunk lids are, since they show through the windscreen and rear window.
 */
export function drawCabin(cab: Cab, cam: Camera, time: number): void {
  V = cab.v;
  fX = Math.sin(V.yaw); fZ = Math.cos(V.yaw); rX = fZ; rZ = -fX;
  const paint: RGB = [V.r, V.g, V.b];

  // Shell: floor, headliner, door trims with armrests and handles, sills and pillars.
  part(0, 0.42, -0.25, 0.86, 0.03, 1.15, M_CLOTH, [64, 60, 58], TOP);
  part(0, 1.7, -0.25, 0.84, 0.02, 1.15, M_PLASTER, HEADLINER, BOTTOM);
  for (const s of [-1, 1]) {
    const inward = s > 0 ? LEFT : RIGHT;
    part(s * 0.88, 0.76, -0.25, 0.04, 0.32, 1.15, M_PLASTER, PANEL, inward | TOP);
    part(s * 0.8, 0.9, -0.62, 0.06, 0.035, 0.34, M_CLOTH, TRIM, inward | TOP | FRONT);
    part(s * 0.8, 0.9, 0.42, 0.06, 0.035, 0.3, M_CLOTH, TRIM, inward | TOP | BACK);
    part(s * 0.835, 1.0, -0.22, 0.012, 0.02, 0.07, M_PAINT, CHROME, inward);
    part(s * 0.86, 1.095, -0.25, 0.05, 0.015, 1.15, M_PAINT, TRIM, TOP | inward);
    part(s * 0.78, 1.38, 0.82, 0.05, 0.3, 0.08, M_PAINT, TRIM, inward | BACK);
    part(s * 0.8, 1.38, -0.2, 0.05, 0.3, 0.09, M_PAINT, TRIM, inward | FRONT | BACK);
    part(s * 0.74, 1.38, -1.3, 0.1, 0.3, 0.14, M_PAINT, TRIM, inward | FRONT);
    part(s * 0.72, 1.6, -0.62, 0.02, 0.02, 0.1, M_PAINT, TRIM, inward | BOTTOM);
  }
  part(0, 1.02, -1.52, 0.8, 0.03, 0.14, M_CLOTH, TRIM, TOP | FRONT);

  // Rear bench, and the passenger's own knees.
  part(0, 0.6, -0.86, 0.8, 0.12, 0.33, M_CLOTH, SEAT, TOP | FRONT);
  part(0, 1.0, -1.26, 0.8, 0.32, 0.09, M_CLOTH, SEAT, FRONT | TOP);
  for (const lx of [SEAT_SIDE - 0.12, SEAT_SIDE + 0.12]) {
    part(lx, 0.8, -0.66, 0.08, 0.08, 0.26, M_CLOTH, JEANS, TOP | FRONT | LEFT | RIGHT);
    part(lx, 0.6, -0.37, 0.07, 0.2, 0.07, M_CLOTH, JEANS, FRONT | TOP | LEFT | RIGHT);
  }

  // Front seat backs (low enough to see over), a screen on the passenger side one, and the driver.
  for (const s of [-1, 1]) part(s * 0.44, 0.93, 0.14, 0.24, 0.25, 0.09, M_CLOTH, SEAT, BACK | TOP | LEFT | RIGHT);
  part(0.44, 1.27, 0.12, 0.1, 0.07, 0.06, M_CLOTH, SEAT, BACK | TOP | LEFT | RIGHT);
  part(0.44, 0.92, 0.04, 0.14, 0.09, 0.012, M_SCREEN, [90, 170, 255], BACK);
  part(-0.44, 1.34, 0.3, 0.23, 0.12, 0.13, M_CLOTH, SHIRT, TOP | BACK | LEFT | RIGHT);
  part(-0.44, 1.58, 0.3, 0.1, 0.12, 0.11, M_SKIN, SKIN, BACK | TOP | LEFT | RIGHT);
  part(-0.44, 1.71, 0.32, 0.11, 0.025, 0.13, M_CLOTH, [40, 40, 44], TOP | BACK | LEFT | RIGHT);
  for (const s of [-1, 1]) {
    part(-0.42 + s * 0.2, 1.24, 0.55, 0.045, 0.045, 0.2, M_CLOTH, SHIRT, TOP | LEFT | RIGHT);
    part(-0.42 + s * 0.17, 1.12, 0.72, 0.04, 0.05, 0.04, M_SKIN, SKIN, BACK | TOP | LEFT | RIGHT);
  }

  // Dashboard: steering wheel, lit instruments, radio, and the fare meter.
  part(0, 0.98, 1.06, 0.9, 0.14, 0.2, M_PAINT, DASH, BACK | TOP);
  part(-0.42, 1.08, 0.72, 0.17, 0.018, 0.018, M_PAINT, DASH, BACK | TOP);
  part(-0.42, 1.24, 0.74, 0.17, 0.018, 0.018, M_PAINT, DASH, BACK | TOP | BOTTOM);
  part(-0.42, 0.94, 0.7, 0.17, 0.018, 0.018, M_PAINT, DASH, BACK | TOP);
  for (const s of [-1, 1]) part(-0.42 + s * 0.17, 1.09, 0.72, 0.018, 0.15, 0.018, M_PAINT, DASH, BACK | LEFT | RIGHT);
  part(-0.42, 1.06, 0.86, 0.16, 0.04, 0.01, M_GLOW, [40, 130, 170], BACK);
  // The meter sits on top of the dash and the radio in its face, both in the gap between the front seats.
  part(-0.02, 1.02, 0.855, 0.13, 0.04, 0.01, M_GLOW, [20, 70, 45], BACK);
  part(0, 0.62, 0.45, 0.1, 0.17, 0.32, M_PAINT, DASH, TOP | BACK | LEFT | RIGHT);
  const meterX = -0.02, meterY = 1.19, meterZ = 0.95;
  part(meterX, meterY, meterZ, 0.14, 0.06, 0.05, M_PAINT, [18, 18, 20], BACK | TOP | LEFT | RIGHT);
  readout(`$${cab.fare.toFixed(2)}`, meterX, meterY, meterZ - 0.052, cam, [255, 60, 40]);
  if (cab.radio) readout(cab.radio, -0.02, 1.02, 0.843, cam, [120, 255, 170]);

  // Mirror with an air freshener that swings with the ride.
  part(0, 1.6, 0.84, 0.12, 0.035, 0.015, M_PAINT, TRIM, BACK | BOTTOM);
  const sway = Math.sin(time * 2.3) * 0.02 + Math.sin(time * 0.7) * 0.012;
  part(sway, 1.47, 0.84, 0.03, 0.05, 0.004, M_PAINT, [40, 170, 70], BACK | FRONT);

  // The hood and trunk, seen through the glass.
  part(0, 1.07, 1.55, 0.95, 0.01, 0.65, M_CAR, paint, TOP);
  part(0, 1.07, -1.8, 0.95, 0.01, 0.4, M_CAR, paint, TOP);
}
