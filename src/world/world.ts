import type { Camera } from '../render/camera';
import { City } from './city';
import { Pedestrians } from './pedestrians';
import { Traffic, type Vehicle } from './traffic';
import { Train } from './train';

export class World {
  readonly city = new City();
  readonly cars = new Traffic(64, false);
  readonly skyCars = new Traffic(26, true);
  readonly peds = new Pedestrians(150);
  readonly train = new Train();

  update(dt: number, x: number, z: number, far: number, riding: Vehicle | null): void {
    const r = Math.min(far, 280);
    this.cars.update(dt, x, z, r, riding);
    this.skyCars.update(dt, x, z, r + 60, riding);
    this.peds.update(dt, x, z, Math.min(far, 170));
    this.train.update(dt, x);
  }

  /** `hidden` is the vehicle the camera sits in, when its body would just block the view. */
  drawActors(cam: Camera, time: number, rain: boolean, hidden: Vehicle | null): void {
    this.cars.draw(cam, time, Math.min(cam.far, 240), hidden);
    this.skyCars.draw(cam, time, cam.far, hidden);
    this.peds.draw(cam, rain);
    this.train.draw(cam);
  }
}
