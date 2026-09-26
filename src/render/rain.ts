import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import { glyph } from '../core/charset';
import { wrapAngle } from '../core/hash';

const G_SLASH = glyph('/');
const G_PIPE = glyph('|');
const STRIDE = 4;

/**
 * Screen-space drops with a per-drop depth. Camera rotation shifts them so they feel anchored in
 * the world, and the depth test lets buildings and cars occlude far drops.
 */
export class Rain {
  on = true;
  private drops = new Float32Array(0);
  private lastYaw = 0;
  private lastPitch = 0;

  resize(cols: number, rows: number): void {
    const n = Math.min(5000, Math.floor(cols * rows * 0.006));
    this.drops = new Float32Array(n * STRIDE);
    for (let k = 0; k < n; k++) {
      const o = k * STRIDE;
      this.drops[o] = Math.random();
      this.drops[o + 1] = Math.random();
      this.drops[o + 2] = 1.5 + Math.random() * Math.random() * 40;
      this.drops[o + 3] = 9 + Math.random() * 4;
    }
  }

  update(dt: number, cam: Camera, cols: number, rows: number): void {
    const dYaw = wrapAngle(cam.yaw - this.lastYaw);
    const dPitch = cam.pitch - this.lastPitch;
    this.lastYaw = cam.yaw;
    this.lastPitch = cam.pitch;
    if (!this.on || cols === 0) return;
    const shiftX = (-dYaw * cam.fx) / cols;
    const shiftY = (dPitch * cam.fy) / rows;
    const d = this.drops;
    for (let o = 0; o < d.length; o += STRIDE) {
      const z = d[o + 2];
      let x = d[o] + shiftX - ((dt * 2.2) / z) * (cam.fx / cols);
      let y = d[o + 1] + shiftY + ((d[o + 3] * dt) / z) * (cam.fy / rows);
      if (y > 1) { y -= 1; x = Math.random(); }
      else if (y < 0) y += 1;
      x -= Math.floor(x);
      d[o] = x;
      d[o + 1] = y;
    }
  }

  /** Drops nearer than `minDepth` are skipped (used indoors). */
  draw(fb: FrameBuffer, minDepth = 0): void {
    const { cols, rows, fg, depth } = fb;
    const d = this.drops;
    for (let o = 0; o < d.length; o += STRIDE) {
      const z = d[o + 2];
      if (z < minDepth) continue;
      const col = Math.floor(d[o] * cols);
      let row = Math.floor(d[o + 1] * rows);
      const iz = 1 / z;
      const len = z < 4 ? 3 : z < 10 ? 2 : 1;
      const q = 70 + 110 * (1 - Math.min(1, z / 30));
      const color = ((q * 1.15) << 16) | ((q * 0.98) << 8) | (q * 0.82);
      const gl = z < 4 ? G_PIPE : G_SLASH;
      for (let k = 0; k < len && row < rows; k++, row++) {
        const idx = row * cols + col;
        if (depth[idx] > iz) break;
        fg[idx] = (gl << 24) | color;
      }
    }
  }
}
