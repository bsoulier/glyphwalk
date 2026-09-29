import type { Camera } from '../render/camera';
import { drawBoxYaw, drawLabel, drawPoint, drawVLine, sphereVisible, stats } from '../render/raster';
import { M_CLOTH, M_SKIN } from '../render/materials';
import { glyph } from '../core/charset';
import { ACT_CHEER, ACT_SPIN, ACT_WAVE, EMOTES, MODE_FLY, MODE_RAIL, MODE_SKY, MODE_TAXI, MODE_WALK } from '../net/protocol';
import { RAIL_TOP } from './layout';
import type { RGB } from './signs';
import { SKINS } from './pedestrians';
import { KIND_SKY, KIND_TAXI, Vehicle, drawCar, drawSkyCar } from './traffic';

/** Another player, where to draw them this frame (net/online.ts `Remote` is one). */
export interface OtherPlayer {
  readonly id: number;
  readonly name: string;
  readonly color: RGB;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly mode: number;
  readonly phase: number;
  readonly speed: number;
  /** Index in EMOTES, or -1; `emoteAge` is seconds since it was sent. */
  readonly emote: number;
  readonly emoteAge: number;
}

const FAR = 130;
const TAG_R = 45;
const EMOTE_R = 90;
/** Seconds an emote shows over the player's head. */
export const EMOTE_S = 3.5;
const G_PIPE = glyph('|');
const G_STAR = glyph('*');

const texts = new Map<string, Uint8Array>();

function glyphsOf(s: string): Uint8Array {
  let g = texts.get(s);
  if (!g) {
    g = Uint8Array.from(s, (c) => glyph(c));
    texts.set(s, g);
  }
  return g;
}

/** Stand-in cars for players riding a taxi or a sky taxi: every page runs its own traffic. */
const cars = new WeakMap<OtherPlayer, Vehicle>();

function carFor(p: OtherPlayer, sky: boolean): Vehicle {
  let v = cars.get(p);
  if (!v || (v.kind === KIND_SKY) !== sky) {
    v = new Vehicle();
    v.kind = sky ? KIND_SKY : KIND_TAXI;
    [v.r, v.g, v.b] = sky ? p.color : [235, 190, 40];
    v.seed = p.id & 1023;
    cars.set(p, v);
  }
  v.x = p.x;
  v.y = sky ? p.y : 0;
  v.z = p.z;
  v.yaw = p.yaw;
  return v;
}

function shown(p: OtherPlayer): boolean {
  return p.mode === MODE_WALK || p.mode === MODE_FLY || p.mode === MODE_TAXI || p.mode === MODE_SKY;
}

/** Players on foot or flying are figures in bright shirts; riders are their cab. */
export function drawOthers(cam: Camera, list: readonly OtherPlayer[], time: number): void {
  for (const p of list) {
    if (!shown(p)) continue;
    const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    if (d > FAR || !sphereVisible(p.x, p.y + 1, p.z, 3)) continue;
    stats.actors++;
    if (p.mode === MODE_TAXI) drawCar(carFor(p, false), d, time);
    else if (p.mode === MODE_SKY) drawSkyCar(carFor(p, true), time);
    else figure(p, d);
  }
}

/**
 * Name tags and emotes. Drawn after the ground and sky, which would otherwise paint over them: the
 * ground's depth is set by then, so tags still hide behind nearer ground and walls.
 */
export function drawOtherTags(cam: Camera, list: readonly OtherPlayer[]): void {
  for (const p of list) {
    // Monorail riders sit inside a train that every player sees in the same place: their tag rides on its roof.
    const rail = p.mode === MODE_RAIL;
    if (!shown(p) && !rail) continue;
    const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    if (d > EMOTE_R) continue;
    const tagY = rail ? RAIL_TOP + 3.3 : p.mode === MODE_TAXI ? 2.4 : p.mode === MODE_SKY ? p.y + 1.5 : p.y + 2.15;
    const [r, g, b] = p.color;
    if (d < TAG_R) drawLabel(p.x, tagY, p.z, glyphsOf(p.name), 0, r, g, b);
    if (p.emote >= 0 && p.emoteAge < EMOTE_S) {
      // New emotes flash for a moment so they catch the eye.
      const hot = p.emoteAge < 0.6 && Math.floor(p.emoteAge * 8) % 2 === 0;
      drawLabel(p.x, tagY, p.z, glyphsOf(EMOTES[p.emote].text), d < TAG_R ? 1 : 0, 255, hot ? 255 : 235, hot ? 255 : 150);
    }
  }
}

function figure(p: OtherPlayer, d: number): void {
  const [sr, sg, sb] = p.color;
  const act = p.emote >= 0 && p.emoteAge < EMOTE_S ? EMOTES[p.emote].act : 0;
  let y = p.y, yaw = p.yaw;
  if (act === ACT_SPIN) {
    yaw += p.emoteAge * 7;
    y += Math.abs(Math.sin(p.emoteAge * 9)) * 0.18;
  }
  if (p.mode === MODE_FLY) {
    // A faint thruster glow under whoever is flying.
    drawPoint(p.x, y - 0.15, p.z, G_STAR, 120, 220, 255, 0.4, 1);
  }
  if (d > 40) {
    drawVLine(p.x, y + 0.1, y + 1.75, p.z, 0, G_PIPE, sr, sg, sb, 0);
    return;
  }
  const fX = Math.sin(yaw), fZ = Math.cos(yaw), rX = fZ, rZ = -fX;
  const sw = p.speed > 0.3 && p.mode === MODE_WALK ? Math.sin(p.phase) * 0.16 : 0;
  for (const s of [-1, 1]) {
    drawBoxYaw(p.x + rX * 0.11 * s + fX * sw * s, y + 0.44, p.z + rZ * 0.11 * s + fZ * sw * s, yaw, 0.08, 0.44, 0.09, M_CLOTH, 50, 52, 64, 0);
  }
  drawBoxYaw(p.x, y + 1.2, p.z, yaw, 0.23, 0.33, 0.13, M_CLOTH, sr, sg, sb, 0);
  const skin = SKINS[p.id % SKINS.length];
  drawBoxYaw(p.x, y + 1.66, p.z, yaw, 0.11, 0.12, 0.11, M_SKIN, skin[0], skin[1], skin[2], 0);
  // Arms only show while they do something with them.
  const up = act === ACT_CHEER ? [-1, 1] : act === ACT_WAVE ? [1] : [];
  for (const s of up) {
    const wave = act === ACT_WAVE ? Math.sin(p.emoteAge * 12) * 0.12 : 0;
    const ax = p.x + rX * (0.3 + wave) * s, az = p.z + rZ * (0.3 + wave) * s;
    drawBoxYaw(ax, y + 1.72, az, yaw, 0.06, 0.26, 0.06, M_CLOTH, sr, sg, sb, 0);
  }
}
