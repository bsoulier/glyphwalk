import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import { beginGround, groundCell } from './ground';
import { putRaw } from './surface';
import { glyph } from '../core/charset';
import { hash2, valueNoise } from '../core/hash';
import type { Daylight } from './daylight';
import type { Weather } from './weather';

export interface SkyEnv {
  time: number;
  weather: Weather;
  flash: number;
  sky: Daylight;
  /** Coloured light thrown on the sky by fireworks, strongest low down. */
  glow?: readonly [number, number, number];
}

const G_SPACE = 0;
const G_DOT = glyph('.');
const G_COLON = glyph(':');
const G_PLUS = glyph('+');
const G_STAR = glyph('*');
const G_AT = glyph('@');
const G_O = glyph('O');

const MOON_X = 0.55, MOON_Y = 0.42, MOON_Z = 0.72;
const MOON_LEN = Math.hypot(MOON_X, MOON_Y, MOON_Z);

let time = 0;
let tick = 0;
/** Low cloud texture (rain, snow); fog hides the sky entirely and clear nights show the stars. */
let clouds = false;
let clearSky = true;
let flash = 0;
let glowR = 0, glowG = 0, glowB = 0;
let D: Daylight;
// Star lattice is one unit per cell so each star lands in a single cell.
let starScaleX = 1;
let starScaleY = 1;

/** Fills every cell no geometry covered: ground where the view ray points down, sky elsewhere. */
export function drawBackground(fb: FrameBuffer, cam: Camera, env: SkyEnv): void {
  const { cols, rows, depth } = fb;
  time = env.time;
  tick = Math.floor(env.time * 10);
  clouds = env.weather === 'rain' || env.weather === 'snow';
  clearSky = env.weather === 'clear';
  flash = env.flash;
  [glowR, glowG, glowB] = env.glow ?? [0, 0, 0];
  D = env.sky;
  starScaleX = cam.fx;
  starScaleY = cam.fy;
  beginGround(env.time, env.weather === 'rain', Math.abs(cam.cY) > Math.SQRT1_2, env.weather === 'snow');

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

/** Zenith-to-horizon gradient from the time of day, with sun, moon, stars and clouds on top. */
function sky(o: number, dx: number, dy: number, dz: number): void {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const el = dy / len;
  const e = el > 0 ? el : 0;
  // At night this is exactly the original sky; by day the horizon band is wider and softer.
  const glow = Math.exp(-e * (9 - 3 * D.day));
  const Z = D.zenith, H = D.horizon;
  let r = Z[0] + (H[0] - Z[0]) * glow;
  let g = Z[1] + (H[1] - Z[1]) * glow;
  let b = Z[2] + (H[2] - Z[2]) * glow;
  if (flash > 0) {
    r += 38 * flash; g += 42 * flash; b += 58 * flash;
  }
  if (glowR + glowG + glowB > 1) {
    const k = 0.3 + 0.7 * glow;
    r += glowR * k; g += glowG * k; b += glowB * k;
  }
  const sd = (dx * D.sun[0] + dy * D.sun[1] + dz * D.sun[2]) / len;
  const halo = D.twilight * 0.9 + D.day * 0.2;
  if (halo > 0 && sd > 0) {
    const k = sd ** 8 * halo * (1 - e * 0.6);
    const warm = D.twilight;
    r += (70 + 40 * warm) * k; g += (60 - 10 * warm) * k; b += (50 - 35 * warm) * k;
  }
  let gl = G_SPACE, fr = 0, fgc = 0, fbl = 0;

  if (D.sunUp > 0 && sd > 0.9992) {
    gl = G_O;
    fr = 255; fgc = 220 + 30 * D.day; fbl = 140 + 90 * D.day;
    r += 60 * D.sunUp; g += 45 * D.sunUp; b += 20 * D.sunUp;
  } else if (el > 0.015) {
    const az = Math.atan2(dx, dz);
    const md = (dx * MOON_X + dy * MOON_Y + dz * MOON_Z) / (len * MOON_LEN);
    const st = D.stars;
    if (md > 0.9994 && st > 0.15) {
      gl = G_AT; fr = 235 * st; fgc = 232 * st; fbl = 205 * st;
      r += 40 * st; g += 40 * st; b += 36 * st;
    } else if (st > 0.02) {
      if (md > 0.996) {
        const h = (md - 0.996) * 250 * st;
        r += 22 * h; g += 22 * h; b += 26 * h;
      }
      const h = hash2(Math.floor(az * starScaleX), Math.floor(el * starScaleY));
      if ((h & 1023) < 5) {
        const tw = ((h >>> 12) + tick) & 15;
        const q = (120 + ((h >>> 20) & 127) - (tw < 2 ? 70 : 0)) * st;
        gl = (h >>> 28) === 0 ? G_STAR : (h >>> 27) & 1 ? G_PLUS : G_DOT;
        fr = q; fgc = q; fbl = q + 20 * st;
      }
    }
    if (clearSky && D.day > 0.2) {
      // Soft overcast: brighter drifting patches, drawn as faint dots so they stay subtle.
      const n = valueNoise(az * 2 + time * 0.01, el * 7, 37);
      if (n > 0.5) {
        const c = (n - 0.5) * 2 * D.day;
        r += 26 * c; g += 26 * c; b += 24 * c;
        if (gl === G_SPACE && c > 0.35) { gl = G_DOT; fr = r * 1.15; fgc = g * 1.15; fbl = b * 1.15; }
      }
    }
    if (clouds) {
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
