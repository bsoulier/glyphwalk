import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import { put, shade } from './materials';
import { FACE_STRIDE } from '../world/faces';

export const stats = { faces: 0, blocks: 0, actors: 0 };

let depth: Float32Array = new Float32Array(0);
let cols = 0;
let rows = 0;
let camX = 0, camY = 0, camZ = 0;
let cY = 1, sY = 0, cP = 1, sP = 0;
let fx = 1, fy = 1, cxs = 0, cys = 0;
let kx = 1, ky = 1, kxN = 1, kyN = 1;
let near = 0.1, far = 100;

const LX = -0.447, LY = 0.744, LZ = -0.496;

export function beginRaster(fb: FrameBuffer, cam: Camera): void {
  depth = fb.depth;
  cols = fb.cols;
  rows = fb.rows;
  camX = cam.x; camY = cam.y; camZ = cam.z;
  cY = cam.cY; sY = cam.sY; cP = cam.cP; sP = cam.sP;
  fx = cam.fx; fy = cam.fy; cxs = cam.cx; cys = cam.cy;
  kx = cam.kx; ky = cam.ky;
  kxN = 1 / Math.sqrt(1 + kx * kx);
  kyN = 1 / Math.sqrt(1 + ky * ky);
  near = cam.near;
  far = cam.far;
}

export function sphereVisible(x: number, y: number, z: number, rad: number): boolean {
  const wx = x - camX, wy = y - camY, wz = z - camZ;
  const x1 = wx * cY - wz * sY;
  const z1 = wx * sY + wz * cY;
  const vz = z1 * cP + wy * sP;
  const vy = wy * cP - z1 * sP;
  if (vz < -rad || vz - rad > far) return false;
  if ((x1 - kx * vz) * kxN > rad || (-x1 - kx * vz) * kxN > rad) return false;
  if ((vy - ky * vz) * kyN > rad || (-vy - ky * vz) * kyN > rad) return false;
  return true;
}

const qx = new Float64Array(4), qy = new Float64Array(4), qz = new Float64Array(4);
const qu = new Float64Array(4), qv = new Float64Array(4);
const px = new Float64Array(8), py = new Float64Array(8), pz = new Float64Array(8);
const pu = new Float64Array(8), pv = new Float64Array(8);
const sx = new Float64Array(8), sy = new Float64Array(8);
const siz = new Float64Array(8), suz = new Float64Array(8), svz = new Float64Array(8);

export function drawFace(d: ArrayLike<number>, o: number): void {
  const nx = d[o + 16], ny = d[o + 17], nz = d[o + 18];
  if ((camX - d[o]) * nx + (camY - d[o + 1]) * ny + (camZ - d[o + 2]) * nz <= 0) return;

  let outAll = 0x3f;
  let behind = 0;
  for (let k = 0; k < 4; k++) {
    const b = o + k * 3;
    const wx = d[b] - camX, wy = d[b + 1] - camY, wz = d[b + 2] - camZ;
    const x1 = wx * cY - wz * sY;
    const z1 = wx * sY + wz * cY;
    const z = z1 * cP + wy * sP;
    const y = wy * cP - z1 * sP;
    qx[k] = x1; qy[k] = y; qz[k] = z;
    let c = 0;
    if (z < near) { c |= 1; behind++; }
    if (z > far) c |= 2;
    if (x1 > kx * z) c |= 4;
    if (x1 < -kx * z) c |= 8;
    if (y > ky * z) c |= 16;
    if (y < -ky * z) c |= 32;
    outAll &= c;
  }
  if (outAll !== 0) return;

  const u0 = d[o + 12], v0 = d[o + 13], u1 = d[o + 14], v1 = d[o + 15];
  qu[0] = u0; qv[0] = v0;
  qu[1] = u1; qv[1] = v0;
  qu[2] = u1; qv[2] = v1;
  qu[3] = u0; qv[3] = v1;

  let n = 0;
  if (behind === 0) {
    for (let k = 0; k < 4; k++) {
      px[k] = qx[k]; py[k] = qy[k]; pz[k] = qz[k]; pu[k] = qu[k]; pv[k] = qv[k];
    }
    n = 4;
  } else {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) & 3;
      const za = qz[k], zb = qz[k2];
      const ina = za >= near, inb = zb >= near;
      if (ina) {
        px[n] = qx[k]; py[n] = qy[k]; pz[n] = za; pu[n] = qu[k]; pv[n] = qv[k];
        n++;
      }
      if (ina !== inb) {
        const t = (near - za) / (zb - za);
        px[n] = qx[k] + (qx[k2] - qx[k]) * t;
        py[n] = qy[k] + (qy[k2] - qy[k]) * t;
        pz[n] = near;
        pu[n] = qu[k] + (qu[k2] - qu[k]) * t;
        pv[n] = qv[k] + (qv[k2] - qv[k]) * t;
        n++;
      }
    }
    if (n < 3) return;
  }

  for (let k = 0; k < n; k++) {
    const iz = 1 / pz[k];
    sx[k] = cxs + px[k] * iz * fx;
    sy[k] = cys - py[k] * iz * fy;
    siz[k] = iz;
    suz[k] = pu[k] * iz;
    svz[k] = pv[k] * iz;
  }

  const dot = nx * LX + ny * LY + nz * LZ;
  const sh = 0.58 + 0.42 * (dot > 0 ? dot : 0);
  const mat = d[o + 19] | 0, seed = d[o + 23] | 0;
  const r = d[o + 20], g = d[o + 21], b = d[o + 22];
  stats.faces++;
  for (let k = 1; k < n - 1; k++) rasterTri(0, k, k + 1, mat, r, g, b, sh, seed);
}

function rasterTri(a: number, b: number, c: number, mat: number, r: number, g: number, bl: number, sh: number, seed: number): void {
  let ib = b, ic = c;
  const x0 = sx[a], y0 = sy[a];
  let x1 = sx[ib], y1 = sy[ib], x2 = sx[ic], y2 = sy[ic];
  let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area < 0) {
    ib = c; ic = b;
    x1 = sx[ib]; y1 = sy[ib]; x2 = sx[ic]; y2 = sy[ic];
    area = -area;
  }
  if (area < 1e-9) return;

  let minX = Math.ceil(Math.min(x0, x1, x2) - 0.5);
  let maxX = Math.floor(Math.max(x0, x1, x2) - 0.5);
  let minY = Math.ceil(Math.min(y0, y1, y2) - 0.5);
  let maxY = Math.floor(Math.max(y0, y1, y2) - 0.5);
  if (minX < 0) minX = 0;
  if (minY < 0) minY = 0;
  if (maxX > cols - 1) maxX = cols - 1;
  if (maxY > rows - 1) maxY = rows - 1;
  if (minX > maxX || minY > maxY) return;

  const inv = 1 / area;
  const iz0 = siz[a], iz1 = siz[ib], iz2 = siz[ic];
  const uz0 = suz[a], uz1 = suz[ib], uz2 = suz[ic];
  const vz0 = svz[a], vz1 = svz[ib], vz2 = svz[ic];
  const a0 = y1 - y2, b0 = x2 - x1;
  const a1 = y2 - y0, b1 = x0 - x2;
  const a2 = y0 - y1, b2 = x1 - x0;

  for (let yy = minY; yy <= maxY; yy++) {
    const pcy = yy + 0.5, pcx = minX + 0.5;
    let e0 = b0 * (pcy - y1) + a0 * (pcx - x1);
    let e1 = b1 * (pcy - y2) + a1 * (pcx - x2);
    let e2 = b2 * (pcy - y0) + a2 * (pcx - x0);
    let idx = yy * cols + minX;
    for (let xx = minX; xx <= maxX; xx++, idx++, e0 += a0, e1 += a1, e2 += a2) {
      if (e0 < 0 || e1 < 0 || e2 < 0) continue;
      const w0 = e0 * inv, w1 = e1 * inv, w2 = e2 * inv;
      const iz = w0 * iz0 + w1 * iz1 + w2 * iz2;
      if (iz <= depth[idx]) continue;
      depth[idx] = iz;
      const z = 1 / iz;
      shade(idx, mat, (w0 * uz0 + w1 * uz1 + w2 * uz2) * z, (w0 * vz0 + w1 * vz1 + w2 * vz2) * z, z, r, g, bl, sh, seed);
    }
  }
}

const F = new Float64Array(FACE_STRIDE);

/** Box rotated around Y. Local +z is the object's forward (yaw 0 faces world +z). */
export function drawBoxYaw(
  cx: number, cy: number, cz: number, yaw: number, hx: number, hy: number, hz: number,
  mat: number, r: number, g: number, b: number, seed: number, mask = 31,
): void {
  const fX = Math.sin(yaw), fZ = Math.cos(yaw);
  const rX = fZ, rZ = -fX;
  F[19] = mat; F[20] = r; F[21] = g; F[22] = b; F[23] = seed;
  if (mask & 1) wallFace(cx + fX * hz, cy, cz + fZ * hz, fX, fZ, hx, hy);
  if (mask & 2) wallFace(cx - fX * hz, cy, cz - fZ * hz, -fX, -fZ, hx, hy);
  if (mask & 4) wallFace(cx + rX * hx, cy, cz + rZ * hx, rX, rZ, hz, hy);
  if (mask & 8) wallFace(cx - rX * hx, cy, cz - rZ * hx, -rX, -rZ, hz, hy);
  if (mask & 16) capFace(cx, cy + hy, cz, rX, rZ, fX, fZ, hx, hz, 1);
  if (mask & 32) capFace(cx, cy - hy, cz, rX, rZ, fX, fZ, hx, hz, -1);
}

function wallFace(px_: number, py_: number, pz_: number, nx: number, nz: number, hw: number, hh: number): void {
  const tx = -nz, tz = nx;
  F[0] = px_ - tx * hw; F[1] = py_ - hh; F[2] = pz_ - tz * hw;
  F[3] = px_ + tx * hw; F[4] = py_ - hh; F[5] = pz_ + tz * hw;
  F[6] = px_ + tx * hw; F[7] = py_ + hh; F[8] = pz_ + tz * hw;
  F[9] = px_ - tx * hw; F[10] = py_ + hh; F[11] = pz_ - tz * hw;
  F[12] = 0; F[13] = 0; F[14] = hw * 2; F[15] = hh * 2;
  F[16] = nx; F[17] = 0; F[18] = nz;
  drawFace(F, 0);
}

function capFace(
  px_: number, py_: number, pz_: number, rX: number, rZ: number, fX: number, fZ: number,
  hx: number, hz: number, ny: number,
): void {
  F[0] = px_ - rX * hx - fX * hz; F[1] = py_; F[2] = pz_ - rZ * hx - fZ * hz;
  F[3] = px_ + rX * hx - fX * hz; F[4] = py_; F[5] = pz_ + rZ * hx - fZ * hz;
  F[6] = px_ + rX * hx + fX * hz; F[7] = py_; F[8] = pz_ + rZ * hx + fZ * hz;
  F[9] = px_ - rX * hx + fX * hz; F[10] = py_; F[11] = pz_ - rZ * hx + fZ * hz;
  F[12] = 0; F[13] = 0; F[14] = hx * 2; F[15] = hz * 2;
  F[16] = 0; F[17] = ny; F[18] = 0;
  drawFace(F, 0);
}

/**
 * Thin vertical object (pole, trunk, antenna, distant pedestrian). Real geometry thinner than a cell
 * would flicker in and out, so it is forced to exactly one cell wide until it is wide enough to be a box.
 */
export function drawVLine(
  x: number, y0: number, y1: number, z: number, hw: number, gl: number,
  r: number, g: number, b: number, mat: number,
): void {
  const wx = x - camX, wz = z - camZ;
  const x1 = wx * cY - wz * sY, z1 = wx * sY + wz * cY;
  const wy0 = y0 - camY, wy1 = y1 - camY;
  const za = z1 * cP + wy0 * sP, ya = wy0 * cP - z1 * sP;
  const zb = z1 * cP + wy1 * sP, yb = wy1 * cP - z1 * sP;
  if (za < near || zb < near || (za > far && zb > far)) return;
  const zm = (za + zb) * 0.5;
  if (mat !== 0 && (hw * 2 * fx) / zm > 1.6) {
    drawBoxYaw(x, (y0 + y1) * 0.5, z, 0, hw, (y1 - y0) * 0.5, hw, mat, r, g, b, 0, 15);
    return;
  }
  const col = Math.floor(cxs + (x1 * fx) / zm);
  if (col < 0 || col >= cols) return;
  const sya = cys - (ya / za) * fy, syb = cys - (yb / zb) * fy;
  let top = Math.ceil(Math.min(sya, syb) - 0.5);
  let bot = Math.floor(Math.max(sya, syb) - 0.5);
  if (top > bot) top = bot = Math.floor((sya + syb) * 0.5);
  if (top < 0) top = 0;
  if (bot > rows - 1) bot = rows - 1;
  if (top > bot) return;
  const iza = 1 / za, izb = 1 / zb, span = sya - syb;
  for (let row = top; row <= bot; row++) {
    let t = span !== 0 ? (sya - (row + 0.5)) / span : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const iz = iza + (izb - iza) * t;
    const idx = row * cols + col;
    if (iz <= depth[idx]) continue;
    depth[idx] = iz;
    put(idx, gl, r, g, b, 0.25, 1 / iz, 0);
  }
}

/** Single-cell light. A small depth bias lets lights mounted on surfaces win the depth test. */
export function drawPoint(
  x: number, y: number, z: number, gl: number, r: number, g: number, b: number, bgk: number, emissive: number,
): void {
  const wx = x - camX, wy = y - camY, wz = z - camZ;
  const x1 = wx * cY - wz * sY, z1 = wx * sY + wz * cY;
  const vz = z1 * cP + wy * sP;
  if (vz < near || vz > far) return;
  const vy = wy * cP - z1 * sP;
  const col = Math.floor(cxs + (x1 / vz) * fx), row = Math.floor(cys - (vy / vz) * fy);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  const idx = row * cols + col;
  const iz = 1 / vz;
  if (iz * 1.04 < depth[idx]) return;
  if (iz > depth[idx]) depth[idx] = iz;
  put(idx, gl, r, g, b, bgk, vz, emissive);
}
