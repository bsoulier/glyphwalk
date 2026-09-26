import type { Camera } from '../render/camera';
import type { FrameBuffer } from '../render/framebuffer';
import { glyph } from '../core/charset';
import { type EventMode, fireworksAt } from './events';
import { HOOD_BLOCKS, H_DOCKS, nearestRegion } from './hoods';
import { P } from './layout';

/** Something the soundscape should hear, at a world position. */
export interface Bang {
  kind: 'launch' | 'burst' | 'crackle';
  x: number;
  y: number;
  z: number;
}

type Shell = 'peony' | 'ring' | 'willow' | 'crackle' | 'chrysanthemum';
const SHELLS: readonly Shell[] = ['peony', 'peony', 'ring', 'willow', 'crackle', 'chrysanthemum'];
const COLORS: readonly (readonly [number, number, number])[] = [
  [255, 70, 70], [90, 255, 120], [90, 150, 255], [255, 200, 80], [220, 110, 255], [80, 240, 255], [255, 255, 255], [255, 130, 40],
];
const GOLD = [255, 190, 90] as const;

/** Farther than this the show is below the horizon haze anyway. */
const MAX_DIST = 900;

const STRIDE = 12;
const MAX_SPARKS = 6000;
const G_STAR = glyph('*');
const G_PLUS = glyph('+');
const G_DOT = glyph('.');
const G_AT = glyph('@');
const G_PIPE = glyph('|');

interface Rocket {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  shell: Shell;
  color: readonly [number, number, number];
}

/**
 * Harbour fireworks over the nearest Docklands at night. Sparks are simulated as simple particles and
 * drawn after the sky, writing only the glyph and a little glow into the background, so each one
 * sits on the real sky colour instead of in a dark box.
 */
export class Fireworks {
  private readonly sparks = new Float32Array(MAX_SPARKS * STRIDE);
  private live = 0;
  private readonly rockets: Rocket[] = [];
  private nextLaunch = 0;
  private siteKey = '';
  private site: [number, number] | null = null;
  /** How much a burst lights up the sky, by distance to the show. */
  private glowK = 0;
  /** Colour the bursts add to the sky, fading quickly. */
  readonly glow: [number, number, number] = [0, 0, 0];
  /** A show is on and close enough to see. */
  showing = false;

  /** Returns what happened this frame, for sound. `mode` sets how often shows happen (see events.ts). */
  update(dt: number, time: number, night: boolean, cam: Camera, mode: EventMode): Bang[] {
    const bangs: Bang[] = [];
    const fade = Math.exp(-3 * dt);
    this.glow[0] *= fade; this.glow[1] *= fade; this.glow[2] *= fade;
    this.simulate(dt, bangs);
    if (dt === 0) return bangs;
    const show = fireworksAt(mode, time);
    const site = night && show.on ? this.siteNear(cam) : null;
    this.showing = site !== null;
    if (!site) return bangs;
    this.nextLaunch -= dt;
    if (this.nextLaunch > 0) return bangs;
    const finale = show.finale;
    this.nextLaunch = finale ? 0.08 + Math.random() * 0.18 : 0.5 + Math.random() * 1.1;
    const x = site[0] + (Math.random() - 0.5) * 60, z = site[1] + (Math.random() - 0.5) * 60;
    this.rockets.push({
      x, y: 2, z,
      vx: (Math.random() - 0.5) * 6, vy: 56 + Math.random() * 12, vz: (Math.random() - 0.5) * 6,
      fuse: 2 + Math.random() * 0.7,
      shell: SHELLS[Math.floor(Math.random() * SHELLS.length)],
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
    bangs.push({ kind: 'launch', x, y: 2, z });
    return bangs;
  }

  /** Centre of the nearest Docklands region, looked up again only when the camera changes region. */
  private siteNear(cam: Camera): [number, number] | null {
    const bi = Math.floor(cam.x / P), bj = Math.floor(cam.z / P);
    const key = `${Math.floor(bi / HOOD_BLOCKS)},${Math.floor(bj / HOOD_BLOCKS)}`;
    if (key !== this.siteKey) {
      this.siteKey = key;
      const r = nearestRegion(H_DOCKS, bi, bj);
      this.site = r ? [(r[0] + 0.5) * HOOD_BLOCKS * P, (r[1] + 0.5) * HOOD_BLOCKS * P] : null;
    }
    const s = this.site;
    const d = s ? Math.hypot(s[0] - cam.x, s[1] - cam.z) : Infinity;
    this.glowK = 1 / (1 + (d / 250) ** 2);
    return d > MAX_DIST ? null : s;
  }

  private simulate(dt: number, bangs: Bang[]): void {
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.vy -= 9.8 * dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      r.fuse -= dt;
      if (r.fuse <= 0) {
        this.burst(r);
        bangs.push({ kind: 'burst', x: r.x, y: r.y, z: r.z });
        if (r.shell === 'crackle') bangs.push({ kind: 'crackle', x: r.x, y: r.y, z: r.z });
        this.rockets.splice(k, 1);
      }
    }
    const s = this.sparks;
    for (let n = 0; n < this.live; n++) {
      const o = n * STRIDE;
      s[o + 6] += dt;
      if (s[o + 6] >= s[o + 7]) {
        // Swap the dead spark with the last live one.
        this.live--;
        s.copyWithin(o, this.live * STRIDE, this.live * STRIDE + STRIDE);
        n--;
        continue;
      }
      const willow = s[o + 11] === 1;
      const drag = Math.exp(-(willow ? 2 : 1.3) * dt);
      s[o + 3] *= drag; s[o + 4] = s[o + 4] * drag - (willow ? 6 : 4) * dt; s[o + 5] *= drag;
      s[o] += s[o + 3] * dt; s[o + 1] += s[o + 4] * dt; s[o + 2] += s[o + 5] * dt;
    }
  }

  private burst(r: Rocket): void {
    const shell = r.shell;
    const n = shell === 'ring' ? 130 : shell === 'chrysanthemum' ? 280 : 220;
    const speed = shell === 'willow' ? 30 : 40;
    const life = shell === 'willow' ? 3.6 : shell === 'crackle' ? 1.8 : 2.3;
    const color = shell === 'willow' ? GOLD : shell === 'crackle' ? COLORS[6] : r.color;
    const second = COLORS[Math.floor(Math.random() * COLORS.length)];
    // A ring lies in a random tilted plane: two perpendicular unit vectors span it.
    const ta = Math.random() * Math.PI, tb = Math.random() * 0.9;
    const ux = Math.cos(ta), uz = Math.sin(ta);
    const vx = -Math.sin(ta) * Math.sin(tb), vy = Math.cos(tb), vz = Math.cos(ta) * Math.sin(tb);
    for (let k = 0; k < n && this.live < MAX_SPARKS; k++) {
      let dx: number, dy: number, dz: number;
      if (shell === 'ring') {
        const a = (k / n) * Math.PI * 2;
        dx = ux * Math.cos(a) + vx * Math.sin(a); dy = vy * Math.sin(a); dz = uz * Math.cos(a) + vz * Math.sin(a);
      } else {
        dy = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - dy * dy);
        dx = rr * Math.cos(a); dz = rr * Math.sin(a);
      }
      const sp = speed * (0.85 + Math.random() * 0.3);
      const c = shell === 'chrysanthemum' && k % 2 === 1 ? second : color;
      const o = this.live * STRIDE;
      const s = this.sparks;
      s[o] = r.x; s[o + 1] = r.y; s[o + 2] = r.z;
      s[o + 3] = dx * sp + r.vx; s[o + 4] = dy * sp + r.vy * 0.3; s[o + 5] = dz * sp + r.vz;
      s[o + 6] = 0; s[o + 7] = life * (0.8 + Math.random() * 0.4);
      s[o + 8] = c[0]; s[o + 9] = c[1]; s[o + 10] = c[2];
      s[o + 11] = shell === 'willow' ? 1 : shell === 'crackle' ? 2 : 0;
      this.live++;
    }
    for (let c = 0; c < 3; c++) this.glow[c] = Math.min(55, this.glow[c] + color[c] * 0.07 * this.glowK);
  }

  get busy(): boolean {
    return this.live > 0 || this.rockets.length > 0;
  }

  /** Call after the background pass: only cells showing sky (or geometry farther than the spark) take it. */
  draw(fb: FrameBuffer, cam: Camera, fogDensity: number): void {
    if (!this.busy) return;
    const s = this.sparks;
    for (let n = 0; n < this.live; n++) {
      const o = n * STRIDE;
      const age = s[o + 6] / s[o + 7];
      // Bright for most of the life, then a quick fade.
      let k = 1 - age * age * age;
      let gl = age < 0.35 ? G_STAR : age < 0.75 ? G_PLUS : G_DOT;
      let r = s[o + 8], g = s[o + 9], b = s[o + 10];
      if (s[o + 11] === 2 && age > 0.45) {
        // Crackle: the sparks turn into white pops that blink on and off.
        if (Math.random() < 0.55) continue;
        gl = G_STAR; r = g = b = 255; k = 1;
      } else if (age < 0.08) {
        r += (255 - r) * 0.6; g += (255 - g) * 0.6; b += (255 - b) * 0.6;
        gl = G_AT;
      }
      // A short streak behind each spark, back along its velocity.
      const t = 0.07;
      this.plot(fb, cam, s[o] - s[o + 3] * t, s[o + 1] - s[o + 4] * t, s[o + 2] - s[o + 5] * t, G_DOT, r * k * 0.45, g * k * 0.45, b * k * 0.45, fogDensity);
      this.plot(fb, cam, s[o], s[o + 1], s[o + 2], gl, r * k, g * k, b * k, fogDensity);
    }
    for (const rk of this.rockets) {
      this.plot(fb, cam, rk.x, rk.y, rk.z, G_DOT, 255, 230, 180, fogDensity);
      this.plot(fb, cam, rk.x, rk.y - 1.5, rk.z, G_PIPE, 150, 100, 60, fogDensity);
    }
  }

  private plot(fb: FrameBuffer, cam: Camera, x: number, y: number, z: number, gl: number, r: number, g: number, b: number, fog: number): void {
    const wx = x - cam.x, wy = y - cam.y, wz = z - cam.z;
    const x1 = wx * cam.cY - wz * cam.sY, z1 = wx * cam.sY + wz * cam.cY;
    const vz = z1 * cam.cP + wy * cam.sP;
    if (vz < 1) return;
    const vy = wy * cam.cP - z1 * cam.sP;
    const col = Math.floor(cam.cx + (x1 / vz) * cam.fx), row = Math.floor(cam.cy - (vy / vz) * cam.fy);
    if (col < 0 || col >= fb.cols || row < 0 || row >= fb.rows) return;
    const idx = row * fb.cols + col;
    if (fb.depth[idx] > 1 / vz) return;
    if (fog > 0) {
      const f = Math.exp(-vz * fog);
      r *= f; g *= f; b *= f;
    }
    if (r + g + b < 24) return;
    // Light adds to whatever sky is behind, so a fading spark melts into it instead of going dark.
    const bg = fb.bg[idx];
    const br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
    fb.fg[idx] = (gl << 24) | (c8(bb + b) << 16) | (c8(bgc + g) << 8) | c8(br + r);
    fb.bg[idx] = (c8(bb + b * 0.3) << 16) | (c8(bgc + g * 0.3) << 8) | c8(br + r * 0.3);
  }
}

function c8(v: number): number {
  return v > 255 ? 255 : v < 0 ? 0 : v | 0;
}
