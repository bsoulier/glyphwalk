import { Camera } from './camera';
import type { FrameBuffer } from './framebuffer';
import type { Rain } from './rain';
import type { World } from '../world/world';
import type { Block } from '../world/city';
import type { Vehicle } from '../world/traffic';
import { LIGHT_BLINK, LIGHT_FAR, LIGHT_LANTERN } from '../world/build';
import { LIGHT_STRIDE, POLE_STRIDE } from '../world/city';
import { FACE_STRIDE } from '../world/faces';
import { type Interior, drawInterior, levelAt } from '../world/interior';
import { type Cab, drawCabin } from '../world/cabin';
import { type OtherPlayer, drawOtherTags, drawOthers } from '../world/others';
import type { TrainRef } from '../world/train';
import { EYE_H, isLandmark } from '../world/layout';
import { drawBackground } from './background';
import type { Daylight } from './daylight';
import { beginMaterials } from './materials';
import { beginRaster, drawFace, drawPoint, drawVLine, setSnowCover, setSunLight, sphereVisible, stats } from './raster';
import { setFogDensity, setLighting } from './surface';
import { FOG_DENSITY, type Weather } from './weather';
import { glyph } from '../core/charset';

export interface FrameEnv {
  time: number;
  weather: Weather;
  flash: number;
  propDist: number;
  hidden: Vehicle | null;
  /** The taxi the camera rides in the back of; its cabin is drawn instead of its body. */
  cab: Cab | null;
  /** How far the doors of the lift the camera rides in are closed, 0 to 1. */
  liftDoors: number;
  sky: Daylight;
  /** Other players in sight, when playing online. */
  others: readonly OtherPlayer[];
  /** The monorail train the camera rides in; its cars are drawn from the inside. */
  train: TrainRef | null;
}

const G_STAR = glyph('*');
const G_o = glyph('o');
let snowCover = 0;

/**
 * Order matters for speed: geometry goes first (front to back) so the ground/sky pass only
 * shades cells nothing else covered, then rain overlays everything with its own depth test.
 */
export function renderScene(fb: FrameBuffer, cam: Camera, world: World, env: FrameEnv, rain: Rain): void {
  beginRaster(fb, cam);
  // Fog fades toward the sky's horizon colour, so distant geometry melts into the sky at any hour.
  beginMaterials(fb.fg, fb.bg, cam.fx, cam.fy, cam.far, env.time, env.sky.horizon);
  setLighting(env.sky.light, env.sky.windows, env.sky.lamps);
  setSunLight(env.sky.sun, env.sky.day);
  setFogDensity(env.weather === 'fog' ? FOG_DENSITY : 0);
  snowCover = env.weather === 'snow' ? 0.8 : 0;
  setSnowCover(snowCover);
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
  if (env.weather !== 'fog') drawLandmark(fb, cam, world, env, blocks);
  world.drawActors(cam, env.time, env.weather === 'rain', env.hidden, env.train);
  if (env.others.length > 0) drawOthers(cam, env.others, env.time);
  if (env.cab || env.train) {
    setSnowCover(0);
    if (env.cab) drawCabin(env.cab, cam, env.time);
    if (env.train) world.rail.drawRide(cam, env.train, env.time);
    setSnowCover(snowCover);
  }
  drawBackground(fb, cam, { ...env, glow: world.fireworks.glow });
  world.fireworks.draw(fb, cam, env.weather === 'fog' ? FOG_DENSITY : 0);
  if (env.others.length > 0) drawOtherTags(cam, env.others);
  // Indoors, only drops beyond the far wall can be outside; nearer ones would fall in the room (or the cab).
  const open = indoors !== null && levelAt(indoors, cam.y - EYE_H)?.open === true;
  if (rain.on) rain.draw(fb, indoors && !open ? farCorner(indoors, cam) : env.cab ? CAB_REACH : env.train ? CAR_REACH : 0);
}

/** From the back seat, anything nearer than this is inside the car. */
const CAB_REACH = 1.6;
/** From where a monorail rider stands, the same for rain: the front window is this far ahead. */
const CAR_REACH = 2.6;

/** How far away the Glyph Tower still shows over the city, as a hazy silhouette with its beacons. */
const LANDMARK_RANGE = 2600;
const farCam = new Camera();

/**
 * Past the draw distance the Glyph Tower is drawn on its own, with a far plane and fog set from its
 * own distance, so it stays on the skyline to steer by. Nearer blocks already drawn hide its foot.
 */
function drawLandmark(fb: FrameBuffer, cam: Camera, world: World, env: FrameEnv, blocks: readonly Block[]): void {
  const b = world.city.landmark();
  if (blocks.includes(b)) return;
  const d = Math.hypot(b.cx - cam.x, b.cz - cam.z);
  if (d > LANDMARK_RANGE) return;
  Object.assign(farCam, cam);
  farCam.far = d * 1.3 + 80;
  beginRaster(fb, farCam);
  beginMaterials(fb.fg, fb.bg, cam.fx, cam.fy, farCam.far, env.time, env.sky.horizon);
  if (sphereVisible(b.cx, b.cy, b.cz, b.radius)) {
    b.dist = d;
    drawBlock(b, farCam, env);
  }
  beginRaster(fb, cam);
  beginMaterials(fb.fg, fb.bg, cam.fx, cam.fy, cam.far, env.time, env.sky.horizon);
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
  if (b.interiors.length > 0) {
    // It never snows on the furniture.
    setSnowCover(0);
    for (const it of b.interiors) if (drawInterior(it, cam, env.liftDoors, env.time)) indoors = it;
    setSnowCover(snowCover);
  }
  // The Glyph Tower's spire and ring lights must show from anywhere it can be seen.
  const landmark = isLandmark(b.i, b.j);
  const near = landmark || b.dist < env.propDist;
  if (near) {
    const p = b.props;
    for (let o = 0; o < p.length; o += FACE_STRIDE) drawFace(p, o);
    const q = b.poles;
    for (let o = 0; o < q.length; o += POLE_STRIDE) {
      drawVLine(q[o], q[o + 1], q[o + 2], q[o + 3], q[o + 4], q[o + 8], q[o + 5], q[o + 6], q[o + 7], q[o + 9]);
    }
  }
  const L = b.lights;
  const lanterns = near || b.dist < env.propDist * 1.3;
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
      default: {
        const on = env.sky.lamps;
        if (on > 0.05 && (!near || b.dist > 30)) drawPoint(L[o], L[o + 1], L[o + 2], G_STAR, L[o + 3] * on, L[o + 4] * on, L[o + 5] * on, 0.45, 1);
      }
    }
  }
  return indoors;
}
