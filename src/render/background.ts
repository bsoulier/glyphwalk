import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import { beginGround, groundCell } from './ground';
import { putRaw } from './surface';
import { glyph } from '../core/charset';
import { hash2, valueNoise } from '../core/hash';

export interface SkyEnv {
  time: number;
  rain: boolean;
  flash: number;
}

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PLUS = glyph('+');
const G_STAR = glyph('*');
const G_AT = glyph('@');

const MOON_X = 0.55, MOON_Y = 0.42, MOON_Z = 0.72;
const MOON_LEN = Math.hypot(MOON_X, MOON_Y, MOON_Z);

let time = 0;
let tick = 0;
let rain = false;
let flash = 0;
// Star lattice is one unit per cell so each star lands in a single cell.
let starScaleX = 1;
let starScaleY = 1;

/** Fills every cell no geometry covered: ground where the view ray points down, sky elsewhere. */
export function drawBackground(fb: FrameBuffer, cam: Camera, env: SkyEnv): void {
  const { cols, rows, depth } = fb;
  time = env.time;
  tick = Math.floor(env.time * 10);
  rain = env.rain;
  flash = env.flash;
  starScaleX = cam.fx;
  starScaleY = cam.fy;
  beginGround(env.time, env.rain, Math.abs(cam.cY) > Math.SQRT1_2);

  const { fx, fy, cY, sY, cP, sP, far } = cam;
  const cxs = cam.cx, cys = cam.cy;
  const rX = cY, rZ = -sY;
  const uX = -sY * sP, uY = cP, uZ = -cY * sP;
  const fX = sY * cP, fY = sP, fZ = cY * cP;
  const camX = cam.x, camY = cam.y, camZ = cam.z;
  const invFx = 1 / fx;

  for (let row = 0; row < rows; row++) {
    const vy = -(row + 0.5 - cys) / fy;
    const dY = uY * vy + fY;
    const baseX = uX * vy + fX, baseZ = uZ * vy + fZ;
    let o = row * cols;
    // With no camera roll, every cell in a row hits the ground at the same depth.
    const t = dY < -1e-6 ? -camY / dY : Infinity;
    if (t < far) {
      const vyN = -(row + 1.5 - cys) / fy;
      const dYN = uY * vyN + fY;
      const tN = dYN < -1e-6 ? -camY / dYN : far;
      const fp = Math.max(t * invFx, Math.abs(tN - t));
      const iz = 1 / t;
      for (let col = 0; col < cols; col++, o++) {
        if (depth[o] !== 0) continue;
        const vx = (col + 0.5 - cxs) * invFx;
        groundCell(o, camX + t * (baseX + rX * vx), camZ + t * (baseZ + rZ * vx), t, fp);
        depth[o] = iz;
      }
    } else {
      for (let col = 0; col < cols; col++, o++) {
        if (depth[o] !== 0) continue;
        const vx = (col + 0.5 - cxs) * invFx;
        sky(o, baseX + rX * vx, dY, baseZ + rZ * vx);
      }
    }
  }
}

function sky(o: number, dx: number, dy: number, dz: number): void {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const el = dy / len;
  const e = el > 0 ? el : 0;
  const glow = Math.exp(-e * 9);
  let r = 3 + 25 * glow;
  let g = 5 + 20 * glow;
  let b = 10 + 33 * glow;
  if (flash > 0) {
    r += 38 * flash; g += 42 * flash; b += 58 * flash;
  }
  let gl = G_SPACE, fr = 0, fgc = 0, fbl = 0;

  if (el > 0.015) {
    const az = Math.atan2(dx, dz);
    const md = (dx * MOON_X + dy * MOON_Y + dz * MOON_Z) / (len * MOON_LEN);
    if (md > 0.9994) {
      gl = G_AT; fr = 235; fgc = 232; fbl = 205;
      r += 40; g += 40; b += 36;
    } else {
      if (md > 0.996) {
        const h = (md - 0.996) * 250;
        r += 22 * h; g += 22 * h; b += 26 * h;
      }
      const h = hash2(Math.floor(az * starScaleX), Math.floor(el * starScaleY));
      if ((h & 1023) < 5) {
        const tw = ((h >>> 12) + tick) & 15;
        const q = 120 + ((h >>> 20) & 127) - (tw < 2 ? 70 : 0);
        gl = (h >>> 28) === 0 ? G_STAR : (h >>> 27) & 1 ? G_PLUS : G_DOT;
        fr = q; fgc = q; fbl = q + 20;
      }
    }
    if (rain) {
      const n = valueNoise(az * 2.5 + time * 0.03, el * 9, 91);
      if (n > 0.55) {
        const c = (n - 0.55) * 2.2;
        r += 26 * c; g += 26 * c; b += 32 * c;
        if (gl !== G_AT) {
          gl = c > 0.5 ? G_COLON : G_DOT;
          fr = r * 1.6; fgc = g * 1.6; fbl = b * 1.6;
        }
      }
    }
  }
  putRaw(o, gl, fr, fgc, fbl, r, g, b);
}
