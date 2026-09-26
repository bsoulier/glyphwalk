import type { Camera } from '../render/camera';
import { drawBoxYaw, drawPoint, sphereVisible, stats } from '../render/raster';
import { M_TRAIN } from '../render/materials';
import { glyph } from '../core/charset';
import { RAIL_TOP } from './layout';

const G_STAR = glyph('*');
const SPAN = 1100;

/** Three-car train on the elevated beam above the road at z = 0, looping around the player. */
export class Train {
  x = -120;
  readonly speed = 24;
  readonly cars = 3;
  readonly carLen = 11;
  readonly gap = 0.9;

  update(dt: number, camX: number): void {
    this.x += this.speed * dt;
    if (this.x - camX > SPAN) this.x -= 2 * SPAN;
    else if (camX - this.x > SPAN) this.x += 2 * SPAN;
  }

  draw(cam: Camera): void {
    if (Math.abs(cam.z) > cam.far) return;
    const y = RAIL_TOP + 1.45;
    for (let k = 0; k < this.cars; k++) {
      const cx = this.x - k * (this.carLen + this.gap) - this.carLen / 2;
      if (Math.abs(cx - cam.x) > cam.far + 20 || !sphereVisible(cx, y, 0, 7)) continue;
      stats.actors++;
      drawBoxYaw(cx, y, 0, Math.PI / 2, 1.35, 1.35, this.carLen / 2, M_TRAIN, 190, 196, 206, 0, 63);
    }
    drawPoint(this.x + 0.1, y - 0.6, 0.7, G_STAR, 255, 250, 220, 0.6, 1);
    drawPoint(this.x + 0.1, y - 0.6, -0.7, G_STAR, 255, 250, 220, 0.6, 1);
  }
}
