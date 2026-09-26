import type { Mode } from './player';

export interface TourHooks {
  setMode(mode: Mode): void;
  nextHood(): void;
}

/** Each stop of the tour and how long it lasts; after the last one it moves on to the next district. */
const STOPS: readonly (readonly [Mode, number])[] = [['cctv', 21], ['taxi', 26], ['rail', 20], ['sky', 22]];

/**
 * Screensaver: after a while without input, the camera cycles through street cameras, a taxi ride,
 * the monorail and a sky taxi, then moves on to the next district. Any input hands control back.
 */
export class Tour {
  active = false;
  private t = 0;
  private k = 0;

  constructor(private readonly hooks: TourHooks) {}

  start(): void {
    this.active = true;
    this.k = 0;
    this.t = 0;
    this.hooks.setMode(STOPS[0][0]);
  }

  stop(): void {
    this.active = false;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.t < STOPS[this.k][1]) return;
    this.t = 0;
    this.k++;
    if (this.k === STOPS.length) {
      this.k = 0;
      this.hooks.nextHood();
    }
    this.hooks.setMode(STOPS[this.k][0]);
  }
}
