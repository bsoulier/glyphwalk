import type { Camera } from '../render/camera';
import { drawBoxYaw, drawPoint, sphereVisible, stats } from '../render/raster';
import { M_TRAIN } from '../render/materials';
import { glyph } from '../core/charset';
import { hash3 } from '../core/hash';
import { HOOD_BLOCKS } from './hoods';
import { P, RAIL_TOP, worldSeed } from './layout';

const G_STAR = glyph('*');
const G_o = glyph('o');

/**
 * Each row of districts has a monorail on an inner east-west road, one block south of the district's
 * central crossroads so it stays out of the arrival view there.
 */
export const REGION = HOOD_BLOCKS * P;
const RAIL_ROW = 1;

export function isRailRow(j: number): boolean {
  return ((j % HOOD_BLOCKS) + HOOD_BLOCKS) % HOOD_BLOCKS === RAIL_ROW;
}

export function railZ(rj: number): number {
  return (rj * HOOD_BLOCKS + RAIL_ROW) * P;
}

const CARS = 3;
const CAR_LEN = 11;
const GAP = 0.9;
export const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * GAP;
/** Stations sit this far inside each end of the district, so neighbouring shuttles never meet. */
const END = 34;
const RUN = REGION - 2 * END;
const AVG_SPEED = 20;
const TRAVEL = RUN / AVG_SPEED;
const DWELL = 4;
const CYCLE = 2 * (TRAVEL + DWELL);

export interface Shuttle {
  x: number;
  z: number;
  /** +1 heading east, -1 heading west; flips while dwelling at a station. */
  dir: number;
}

function ease(s: number): number {
  return s * s * (3 - 2 * s);
}

/**
 * One shuttle per district, running back and forth along the district's own stretch of line.
 * Position is a pure function of time, so any shuttle can be drawn or ridden without stored state.
 */
export class Rail {
  time = 0;
  private readonly scratch: Shuttle = { x: 0, z: 0, dir: 1 };

  update(dt: number): void {
    this.time += dt;
  }

  shuttle(ri: number, rj: number, out: Shuttle = this.scratch): Shuttle {
    const ph = (this.time + (hash3(ri, rj, worldSeed ^ 0x7a11) % 1000) * 0.001 * CYCLE) % CYCLE;
    const a = ri * REGION + END, b = a + RUN;
    out.z = railZ(rj);
    if (ph < DWELL) { out.x = a; out.dir = 1; }
    else if (ph < DWELL + TRAVEL) { out.x = a + RUN * ease((ph - DWELL) / TRAVEL); out.dir = 1; }
    else if (ph < 2 * DWELL + TRAVEL) { out.x = b; out.dir = -1; }
    else { out.x = b - RUN * ease((ph - 2 * DWELL - TRAVEL) / TRAVEL); out.dir = -1; }
    return out;
  }

  draw(cam: Camera): void {
    const far = cam.far;
    const r0 = Math.ceil(((cam.z - far) / P - RAIL_ROW) / HOOD_BLOCKS);
    const r1 = Math.floor(((cam.z + far) / P - RAIL_ROW) / HOOD_BLOCKS);
    const i0 = Math.floor((cam.x - far) / REGION), i1 = Math.floor((cam.x + far) / REGION);
    const y = RAIL_TOP + 1.45;
    for (let rj = r0; rj <= r1; rj++) {
      for (let ri = i0; ri <= i1; ri++) {
        const s = this.shuttle(ri, rj);
        if (Math.abs(s.x - cam.x) > far + TRAIN_LEN) continue;
        for (let k = 0; k < CARS; k++) {
          const cx = s.x + (k - (CARS - 1) / 2) * (CAR_LEN + GAP);
          if (!sphereVisible(cx, y, s.z, 7)) continue;
          stats.actors++;
          drawBoxYaw(cx, y, s.z, Math.PI / 2, 1.35, 1.35, CAR_LEN / 2, M_TRAIN, 190, 196, 206, 0, 63);
        }
        const front = s.x + s.dir * (TRAIN_LEN / 2 + 0.1), back = s.x - s.dir * (TRAIN_LEN / 2 + 0.1);
        for (const side of [-0.7, 0.7]) {
          drawPoint(front, y - 0.6, s.z + side, G_STAR, 255, 250, 220, 0.6, 1);
          drawPoint(back, y - 0.6, s.z + side, G_o, 255, 40, 40, 0.5, 1);
        }
      }
    }
  }
}
