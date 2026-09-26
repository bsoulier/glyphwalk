import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import type { Rain } from './rain';
import type { World } from '../world/world';
import type { Block } from '../world/city';
import type { Vehicle } from '../world/traffic';
import { LIGHT_BLINK, LIGHT_FAR, LIGHT_LANTERN } from '../world/build';
import { LIGHT_STRIDE, POLE_STRIDE } from '../world/city';
import { FACE_STRIDE } from '../world/faces';
import { drawBackground } from './background';
import { beginMaterials } from './materials';
import { beginRaster, drawFace, drawPoint, drawVLine, stats } from './raster';
import { glyph } from '../core/charset';

export interface FrameEnv {
  time: number;
  rain: boolean;
  flash: number;
  propDist: number;
  hidden: Vehicle | null;
}

// Must match the sky colour at the horizon in background.ts so fogged geometry melts into the sky.
const HAZE: readonly [number, number, number] = [28, 25, 43];
const G_STAR = glyph('*');
const G_o = glyph('o');

/**
 * Order matters for speed: geometry goes first (front to back) so the ground/sky pass only
 * shades cells nothing else covered, then rain overlays everything with its own depth test.
 */
export function renderScene(fb: FrameBuffer, cam: Camera, world: World, env: FrameEnv, rain: Rain): void {
  beginRaster(fb, cam);
  beginMaterials(fb.fg, fb.bg, cam.fx, cam.fy, cam.far, env.time, HAZE);
  fb.depth.fill(0);
  stats.faces = 0;
  stats.actors = 0;

  const blocks = world.city.collect(cam);
  stats.blocks = blocks.length;
  for (const b of blocks) drawBlock(b, env);
  world.drawActors(cam, env.time, env.rain, env.hidden);
  drawBackground(fb, cam, env);
  if (rain.on) rain.draw(fb);
}

function drawBlock(b: Block, env: FrameEnv): void {
  const f = b.faces;
  for (let o = 0; o < f.length; o += FACE_STRIDE) drawFace(f, o);
  const near = b.dist < env.propDist;
  if (near) {
    const p = b.props;
    for (let o = 0; o < p.length; o += FACE_STRIDE) drawFace(p, o);
    const q = b.poles;
    for (let o = 0; o < q.length; o += POLE_STRIDE) {
      drawVLine(q[o], q[o + 1], q[o + 2], q[o + 3], q[o + 4], q[o + 8], q[o + 5], q[o + 6], q[o + 7], q[o + 9]);
    }
  }
  const L = b.lights;
  const lanterns = b.dist < env.propDist * 1.3;
  for (let o = 0; o < L.length; o += LIGHT_STRIDE) {
    switch (L[o + 6]) {
      case LIGHT_BLINK:
        if ((env.time * 1.3 + L[o] * 0.013) % 1 > 0.5) continue;
        drawPoint(L[o], L[o + 1], L[o + 2], G_STAR, 255, 50, 40, 0.5, 1);
        break;
      case LIGHT_LANTERN:
        if (lanterns) drawPoint(L[o], L[o + 1], L[o + 2], G_o, L[o + 3], L[o + 4], L[o + 5], 0.55, 1);
        break;
      case LIGHT_FAR:
        if (!near) drawPoint(L[o], L[o + 1], L[o + 2], G_STAR, L[o + 3], L[o + 4], L[o + 5], 0.45, 1);
        break;
      default:
        if (!near || b.dist > 30) drawPoint(L[o], L[o + 1], L[o + 2], G_STAR, L[o + 3], L[o + 4], L[o + 5], 0.45, 1);
    }
  }
}
