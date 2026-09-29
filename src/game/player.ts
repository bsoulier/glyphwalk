import type { Camera } from '../render/camera';
import type { Input } from './input';
import type { World } from '../world/world';
import { KIND_TAXI, type Vehicle } from '../world/traffic';
import { SEAT_FWD, SEAT_SIDE, SEAT_UP } from '../world/cabin';
import { hoodAt } from '../world/hoods';
import { type Interior, inCab } from '../world/interior';
import { EYE_H, P } from '../world/layout';
import { PLAT_Y, STEP } from '../world/loop';
import { RIDE_EYE, RIDE_SEAT, type TrainRef } from '../world/train';

export const MODES = ['walk', 'fly', 'cctv', 'taxi', 'sky', 'rail'] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABELS: Record<Mode, string> = {
  walk: 'WALK / first person',
  fly: 'FLY / free camera',
  cctv: 'CCTV / street cams',
  taxi: 'TAXI / ride along',
  sky: 'SKY TAXI / ride along',
  rail: 'MONORAIL / loop line',
};

const EYE = EYE_H;
const RADIUS = 0.35;
/** Seconds for the lift doors to close before the cab moves, and to open once it stops. */
const LIFT_DOORS_T = 0.7;
const SENS = 0.0023;
const FWD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA'];
const RIGHT_KEYS = ['KeyD'];

export class Player {
  mode: Mode = 'walk';
  x = 8.2;
  y = EYE;
  z = 22;
  yaw = 0.35;
  pitch = 0.04;
  /** Height of the floor the walker stands on: 0 outdoors, a storey height inside buildings. */
  floorY = 0;
  private ride: { from: number; to: number; t: number; dur: number } | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private target = 0;
  private bob = 0;
  /** District the current camera mode is tied to: cameras and rides stay inside it. */
  private home = 0;
  /** The monorail train ridden in rail mode. */
  train: TrainRef = { cx: 0, cz: 0, k: 0 };
  /** Asked to get off: at the next station the rider steps out onto the platform. */
  alightNext = false;
  private boarding: TrainRef | null = null;
  readonly cctv = { x: 0, y: 8, z: 0, yaw: 0, pitch: -0.25, t: 0, id: 1 };
  /** Taxi meter, in dollars: the flag drop plus distance and waiting time. */
  fare = 0;
  onCut: (() => void) | null = null;

  riding(world: World): Vehicle | null {
    if (this.mode === 'taxi') return world.cars.list[this.target % world.cars.list.length];
    if (this.mode === 'sky') return world.skyCars.list[this.target % world.skyCars.list.length];
    return null;
  }

  private hoodHere(): number {
    return hoodAt(Math.floor(this.x / P), Math.floor(this.z / P));
  }

  private leaveRide(world: World): void {
    if (this.mode === 'taxi') world.cars.release(this.target);
    else if (this.mode === 'sky') world.skyCars.release(this.target);
  }

  setMode(mode: Mode, world: World): void {
    if (mode === this.mode) return;
    // Getting out of a cab puts you on the sidewalk beside the passenger door, facing the way it drove.
    const cab = this.mode === 'taxi' ? this.riding(world) : null;
    if (cab && mode === 'walk') {
      const rX = Math.cos(cab.yaw), rZ = -Math.sin(cab.yaw);
      this.x = cab.x + rX * 5.2;
      this.z = cab.z + rZ * 5.2;
      this.yaw = cab.yaw;
      this.pitch = 0.02;
    }
    // Leaving a train at a station puts you on its platform; between stations, down on the street.
    const platform = this.mode === 'rail' && mode === 'walk' ? world.rail.alightAt(this.train) : null;
    this.leaveRide(world);
    this.mode = mode;
    this.home = this.hoodHere();
    this.lookYaw = 0;
    this.lookPitch = 0;
    if (mode === 'cctv') this.pickCctv();
    if (mode === 'taxi') {
      this.target = world.cars.hail(this.x, this.z, this.home, KIND_TAXI);
      this.fare = 3;
    }
    if (mode === 'sky') this.target = world.skyCars.hail(this.x, this.z, this.home);
    if (mode === 'rail') {
      this.train = this.boarding ?? world.rail.nearest(this.x, this.z);
      this.boarding = null;
      this.alightNext = false;
    }
    if (mode === 'walk') {
      this.floorY = 0;
      this.ride = null;
      this.y = EYE;
      if (platform) {
        this.x = platform.x;
        this.z = platform.z;
        this.yaw = platform.yaw;
        this.pitch = 0.02;
        this.floorY = PLAT_Y;
        this.y = PLAT_Y + EYE;
      } else if (world.blocked(this.x, this.z, RADIUS)) {
        const rx = Math.round(this.x / P) * P, rz = Math.round(this.z / P) * P;
        if (Math.abs(this.x - rx) < Math.abs(this.z - rz)) this.x = rx + 3;
        else this.z = rz + 3;
      }
    }
    this.onCut?.();
  }

  /** Steps aboard a monorail train standing at the platform. */
  board(ref: TrainRef, world: World): void {
    this.boarding = ref;
    this.setMode('rail', world);
  }

  /** On foot at street level, the player is someone cars stop for. */
  walker(): { x: number; z: number } | null {
    return this.mode === 'walk' && this.floorY < 0.5 ? this : null;
  }

  get liftMoving(): boolean {
    return this.ride !== null;
  }

  /** 0 no ride, 1 doors closing, 2 moving, 3 doors opening. */
  get liftPhase(): number {
    const r = this.ride;
    if (!r) return 0;
    return r.t < LIFT_DOORS_T ? 1 : r.t < LIFT_DOORS_T + r.dur ? 2 : 3;
  }

  /** How far the doors of the lift being ridden are closed: 0 open, 1 shut. */
  get liftDoors(): number {
    const r = this.ride;
    if (!r) return 0;
    if (r.t < LIFT_DOORS_T) return r.t / LIFT_DOORS_T;
    const opening = r.t - LIFT_DOORS_T - r.dur;
    return opening > 0 ? Math.max(0, 1 - opening / LIFT_DOORS_T) : 1;
  }

  /**
   * Standing in a lift cab, go one served floor up (dir 1) or down (-1). The doors close first, the
   * cab moves only while they are shut (eased, longer for longer trips), then they open on the new floor.
   */
  useLift(dir: number, world: World): boolean {
    if (this.mode !== 'walk' || this.ride) return false;
    const it = world.city.interiorAt(this.x, this.z);
    if (!it || !inCab(it, this.x, this.z)) return false;
    const k = it.levels.findIndex((l) => Math.abs(l.y - this.floorY) < 0.5);
    const n = k + dir;
    if (k < 0 || n < 0 || n >= it.levels.length) return false;
    const to = it.levels[n].y;
    const rise = Math.abs(to - this.floorY);
    // Express lifts in the tallest towers take longer, so the climb is felt, but never tediously.
    this.ride = { from: this.floorY, to, t: 0, dur: clamp(rise / 12, 1.6, rise > 100 ? 10 : 5) };
    return true;
  }

  /** The building the walker is in, if any. */
  inside(world: World): Interior | null {
    return this.mode === 'walk' ? world.city.interiorAt(this.x, this.z) : null;
  }

  teleport(x: number, z: number, yaw: number, world: World): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.floorY = 0;
    this.ride = null;
    if (this.mode !== 'fly') this.pitch = 0.02;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.home = this.hoodHere();
    if (this.mode === 'walk') this.y = EYE;
    else if (this.mode === 'cctv') this.pickCctv();
    else if (this.mode !== 'fly') {
      this.setMode('walk', world);
      return;
    }
    this.onCut?.();
  }

  cycle(step: number, world: World): void {
    const k = MODES.indexOf(this.mode);
    this.setMode(MODES[(k + step + MODES.length) % MODES.length], world);
  }

  next(world: World): void {
    if (this.mode === 'cctv') this.pickCctv();
    else if (this.mode === 'taxi') this.target = world.cars.nextIn(this.target, this.home);
    else if (this.mode === 'sky') this.target = world.skyCars.nextIn(this.target, this.home);
    else return;
    this.lookYaw = 0;
    this.onCut?.();
  }

  /** A camera on a corner of a nearby block of the home district, looking over that corner's crossroads. */
  private pickCctv(): void {
    const c = this.cctv;
    const bi0 = Math.floor(this.x / P), bj0 = Math.floor(this.z / P);
    let bi = bi0, bj = bj0;
    for (let n = 0; n < 40; n++) {
      const ti = bi0 + Math.floor(Math.random() * 7) - 3, tj = bj0 + Math.floor(Math.random() * 7) - 3;
      if (hoodAt(ti, tj) === this.home) {
        bi = ti;
        bj = tj;
        break;
      }
    }
    const east = Math.random() < 0.5 ? 1 : 0, north = Math.random() < 0.5 ? 1 : 0;
    const ix = (bi + east) * P, iz = (bj + north) * P;
    c.x = ix + (east ? -8.5 : 8.5);
    c.z = iz + (north ? -8.5 : 8.5);
    c.y = 5 + Math.random() * 9;
    c.yaw = Math.atan2(ix - c.x, iz - c.z) + (Math.random() - 0.5) * 0.9;
    c.pitch = -0.18 - Math.random() * 0.2;
    c.t = 0;
    c.id = 1 + Math.floor(Math.random() * 98);
  }

  update(dt: number, input: Input, world: World, cam: Camera): void {
    const [mdx, mdy] = input.takeMouse();
    const [tYaw, tPitch] = input.takeTurn();
    const turn = input.axis(['ArrowLeft'], ['ArrowRight']) * dt * 1.8 + tYaw;
    const tilt = mdy * SENS - tPitch;

    if (this.mode === 'walk' || this.mode === 'fly') {
      this.yaw += mdx * SENS + turn;
      this.pitch = clamp(this.pitch - tilt, -1.45, 1.45);
      const fwd = clamp(input.axis(BACK_KEYS, FWD_KEYS) + input.stickY, -1, 1);
      const str = clamp(input.axis(LEFT_KEYS, RIGHT_KEYS) + input.stickX, -1, 1);
      const run = input.down('ShiftLeft') || input.down('ShiftRight') || input.stickRun;
      const fX = Math.sin(this.yaw), fZ = Math.cos(this.yaw), rX = fZ, rZ = -fX;
      if (this.mode === 'walk') {
        const r = this.ride;
        let len = 0;
        if (r) {
          r.t += dt;
          const s = Math.min(1, Math.max(0, (r.t - LIFT_DOORS_T) / r.dur));
          this.floorY = r.from + (r.to - r.from) * s * s * (3 - 2 * s);
          if (r.t >= r.dur + 2 * LIFT_DOORS_T) this.ride = null;
        } else {
          const sp = (run ? 9 : 4.2) * dt;
          let mx = fX * fwd + rX * str, mz = fZ * fwd + rZ * str;
          len = Math.hypot(mx, mz);
          if (len > 1) { mx /= len; mz /= len; }
          // Nothing to stand on here any more (a station moved, an old saved view): back down to the street.
          if (world.surface(this.x, this.z, this.floorY) < 0 && this.floorY > STEP) this.floorY = 0;
          // A stall can go up around someone standing on its spot at dusk; let them walk out of it.
          const inStall = world.market.collides(this.x, this.z, RADIUS);
          const hit = (x: number, z: number, feet: number) => inStall ? world.city.collides(x, z, RADIUS, feet) : world.blocked(x, z, RADIUS, feet);
          // Stairs and platforms carry the feet up and down with them.
          const step = (x: number, z: number) => {
            const feet = world.surface(x, z, this.floorY);
            if (feet < 0 || hit(x, z, feet)) return;
            this.x = x;
            this.z = z;
            this.floorY = feet;
          };
          step(this.x + mx * sp, this.z);
          step(this.x, this.z + mz * sp);
          if (len > 0) this.bob += sp * 1.9;
        }
        this.y = this.floorY + EYE + Math.sin(this.bob) * (len > 0 ? 0.035 : 0);
      } else {
        const sp = (run ? 70 : 22) * dt;
        const cp = Math.cos(this.pitch), sp_ = Math.sin(this.pitch);
        const up = input.axis(['KeyQ'], ['KeyE', 'Space']);
        this.x += (fX * cp * fwd + rX * str) * sp;
        this.z += (fZ * cp * fwd + rZ * str) * sp;
        this.y = Math.max(0.6, this.y + (sp_ * fwd + up) * sp);
      }
      cam.x = this.x; cam.y = this.y; cam.z = this.z;
      cam.yaw = this.yaw; cam.pitch = this.pitch;
      return;
    }

    this.lookYaw += mdx * SENS + turn;
    this.lookPitch = clamp(this.lookPitch - tilt, -1.2, 1.2);
    // A passenger can only turn their head: over the shoulder, but not all the way round.
    if (this.mode === 'taxi') {
      this.lookYaw = clamp(this.lookYaw, -2.4, 2.4);
      this.lookPitch = clamp(this.lookPitch, -1.0, 0.7);
    }

    if (this.mode === 'cctv') {
      const c = this.cctv;
      c.t += dt;
      if (c.t > 10) {
        this.pickCctv();
        this.onCut?.();
      }
      cam.x = c.x; cam.y = c.y; cam.z = c.z;
      cam.yaw = c.yaw + Math.sin(c.t * 0.32) * 0.3 + this.lookYaw;
      cam.pitch = c.pitch + this.lookPitch;
    } else if (this.mode === 'rail') {
      // At the very front of the leading car, looking out of the front window; the head turns freely.
      const p = world.rail.car(this.train, 0);
      cam.x = p.x + Math.sin(p.yaw) * RIDE_SEAT;
      cam.y = RIDE_EYE;
      cam.z = p.z + Math.cos(p.yaw) * RIDE_SEAT;
      cam.yaw = p.yaw + this.lookYaw;
      cam.pitch = this.lookPitch - 0.05;
    } else {
      const v = this.riding(world);
      if (!v) return;
      const fX = Math.sin(v.yaw), fZ = Math.cos(v.yaw), rX = fZ, rZ = -fX;
      const taxi = this.mode === 'taxi';
      const seatFwd = taxi ? SEAT_FWD : 1.7, seatSide = taxi ? SEAT_SIDE : 0, seatUp = taxi ? SEAT_UP : 0.75;
      cam.x = v.x + fX * seatFwd + rX * seatSide;
      cam.y = v.y + seatUp;
      cam.z = v.z + fZ * seatFwd + rZ * seatSide;
      if (taxi) this.fare += v.vel * dt * 0.0028 + (v.vel < 1 ? dt * 0.006 : 0);
      cam.yaw = v.yaw + this.lookYaw;
      cam.pitch = this.lookPitch - (this.mode === 'sky' ? 0.12 : 0);
    }
    this.x = cam.x;
    this.y = cam.y;
    this.z = cam.z;
    this.yaw = cam.yaw;
    this.pitch = clamp(cam.pitch, -1.45, 1.45);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
