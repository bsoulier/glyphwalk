import type { Camera } from '../render/camera';
import { City } from './city';
import { Pedestrians } from './pedestrians';
import { drawSignals } from './signals';
import { Traffic, type Vehicle, type Walker } from './traffic';
import { Rail } from './train';

export class World {
  readonly city = new City();
  readonly cars = new Traffic(64, false);
  readonly skyCars = new Traffic(26, true);
  readonly peds = new Pedestrians(150);
  readonly rail = new Rail();
  /** Simulation clock; traffic signals and shuttles are functions of it. */
  time = 0;

  update(dt: number, x: number, z: number, far: number, riding: Vehicle | null, walker: Walker | null): void {
    this.time += dt;
    const r = Math.min(far, 280);
    const env = { time: this.time, walker, peds: this.peds.list };
    this.cars.update(dt, x, z, r, riding, env);
    this.skyCars.update(dt, x, z, r + 60, riding, env);
    this.peds.update(dt, x, z, Math.min(far, 170), this.time);
    this.rail.update(dt);
  }

  /** `hidden` is the vehicle the camera sits in, when its body would just block the view. */
  drawActors(cam: Camera, time: number, rain: boolean, hidden: Vehicle | null): void {
    this.cars.draw(cam, time, Math.min(cam.far, 240), hidden);
    this.skyCars.draw(cam, time, cam.far, hidden);
    this.peds.draw(cam, rain);
    this.rail.draw(cam);
    drawSignals(cam, this.time);
  }
}
