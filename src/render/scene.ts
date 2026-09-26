import type { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import type { Rain } from './rain';
import type { World } from '../world/world';
import type { Block } from '../world/city';
import type { Vehicle } from '../world/traffic';
import { LIGHT_BLINK, LIGHT_FAR, LIGHT_LANTERN } from '../world/build';
import { LIGHT_STRIDE, POLE_STRIDE } from '../world/city';
import { FACE_STRIDE } from '../world/faces';
import { type Interior, drawInterior } from '../world/interior';
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
  /** How far the doors of the lift the camera rides in are closed, 0 to 1. */
  liftDoors: number;
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
  let indoors: Interior | null = null;
  for (const b of blocks) {
    const it = drawBlock(b, cam, env);
    if (it) indoors = it;
  }
  world.drawActors(cam, env.time, env.rain, env.hidden);
  drawBackground(fb, cam, env);
  // Indoors, only drops beyond the far wall can be outside; nearer ones would fall in the room.
  if (rain.on) rain.draw(fb, indoors ? farCorner(indoors, cam) : 0);
}

function farCorner(r: Interior, cam: Camera): number {
  const dx = Math.max(Math.abs(r.x0 - cam.x), Math.abs(r.x1 - cam.x));
  const dz = Math.max(Math.abs(r.z0 - cam.z), Math.abs(r.z1 - cam.z));
  return Math.hypot(dx, dz);
}

/** Returns the interior the camera stands in, if it belongs to this block. */
function drawBlock(b: Block, cam: Camera, env: FrameEnv): Interior | null {
  const f = b.faces;
  for (let o = 0; o < f.length; o += FACE_STRIDE) drawFace(f, o);
  let indoors: Interior | null = null;
  for (const it of b.interiors) if (drawInterior(it, cam, env.liftDoors)) indoors = it;
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
  return indoors;
}
