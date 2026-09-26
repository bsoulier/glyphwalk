import type { Weather } from './weather';

export type RGB3 = [number, number, number];

export const TIME_MODES = ['cycle', 'dusk', 'night', 'dawn', 'day'] as const;
export type TimeMode = (typeof TIME_MODES)[number];
export const TIME_LABELS: Record<TimeMode, string> = {
  cycle: 'Cycle (dusk to dawn)',
  dusk: 'Dusk',
  night: 'Night',
  dawn: 'Dawn',
  day: 'Overcast day',
};
/** Dusk and dawn sit with the sun on the horizon, where the colours peak. */
const FIXED_HOUR: Record<Exclude<TimeMode, 'cycle'>, number> = { dusk: 18.15, night: 23.5, dawn: 5.9, day: 13 };

/** Everything the renderer needs to know about the time of day, derived from the hour alone. */
export interface Daylight {
  hour: number;
  /** 0 at night, 1 with the sun well up. */
  day: number;
  /** Strength of sunset/sunrise colouring, peaking with the sun at the horizon. */
  twilight: number;
  zenith: RGB3;
  horizon: RGB3;
  /** Unit vector toward the sun (below the horizon at night). */
  sun: RGB3;
  sunUp: number;
  stars: number;
  /** Multiplier for surfaces that do not glow. Night is 1: the city was designed at night. */
  light: RGB3;
  /** Share of office and home windows lit, relative to night. */
  windows: number;
  lamps: number;
  label: string;
}

const NIGHT_Z: RGB3 = [3, 5, 10];
const NIGHT_H: RGB3 = [28, 25, 43];
const DAY_Z: RGB3 = [112, 126, 150];
const DAY_H: RGB3 = [170, 177, 190];
const DUSK_Z: RGB3 = [40, 30, 80];
const DUSK_H: RGB3 = [220, 108, 68];
const DAWN_Z: RGB3 = [52, 60, 112];
const DAWN_H: RGB3 = [214, 138, 142];
const DUSK_LIGHT: RGB3 = [1.22, 0.96, 0.84];
const DAWN_LIGHT: RGB3 = [1.1, 0.98, 1.02];

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: RGB3, b: RGB3, t: number): RGB3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The sun rises in the east (+x) at 6:00 and sets in the west at 18:00, tilted toward +z so the
 * low sun rakes along the streets instead of hiding behind the block in front of you.
 */
export function daylightAt(hour: number, weather: Weather): Daylight {
  const rain = weather === 'rain';
  const overcast = weather !== 'clear';
  const th = ((hour - 6) / 12) * Math.PI;
  const sx = Math.cos(th), sy = Math.sin(th) * 0.9, sz = 0.42;
  const len = Math.hypot(sx, sy, sz);
  const sun: RGB3 = [sx / len, sy / len, sz / len];
  const e = sun[1];
  const day = smooth(-0.04, 0.32, e);
  const twilight = Math.max(0, 1 - Math.abs(e + 0.04) / 0.24);
  const evening = hour >= 12;

  let zenith = mix(NIGHT_Z, DAY_Z, day);
  let horizon = mix(NIGHT_H, DAY_H, day);
  zenith = mix(zenith, evening ? DUSK_Z : DAWN_Z, twilight * 0.8);
  horizon = mix(horizon, evening ? DUSK_H : DAWN_H, twilight * 0.9);
  if (overcast) {
    // Rain darkens the sky; snow and fog keep it pale.
    const k = rain ? 0.72 : 0.95;
    const grey = (c: RGB3): RGB3 => {
      const l = (c[0] + c[1] + c[2]) / 3;
      return mix(c, [l, l, l], 0.65).map((v) => v * k) as RGB3;
    };
    zenith = grey(zenith);
    horizon = grey(horizon);
  }
  if (weather === 'snow') {
    // Snow clouds hang low and glow with the city's light reflected off the snow below.
    horizon = mix(horizon, [74, 70, 80], 1 - day);
    zenith = mix(zenith, [42, 40, 48], 1 - day);
  }
  if (weather === 'fog') {
    // Fog glows faintly by night (city light scattered back down) and is bright grey by day.
    horizon = mix([62, 64, 74], [182, 186, 192], day);
    zenith = horizon;
  }

  const bright = 1 + 0.55 * day * (rain ? 0.75 : 1);
  const tint = mix([1, 1, 1], evening ? DUSK_LIGHT : DAWN_LIGHT, twilight);
  const label = e > 0.25 ? 'day' : e > -0.22 ? (evening ? 'dusk' : 'dawn') : 'night';
  return {
    hour, day, twilight, zenith, horizon, sun,
    sunUp: smooth(-0.05, 0.02, e) * (weather === 'clear' ? 1 : weather === 'fog' ? 0 : 0.3),
    stars: (1 - smooth(-0.34, -0.1, e)) * (weather === 'clear' ? 1 : weather === 'rain' ? 0.2 : 0),
    light: [bright * tint[0], bright * tint[1], bright * tint[2]],
    windows: 1 - 0.88 * day,
    lamps: 1 - smooth(-0.06, 0.14, e),
    label,
  };
}

/**
 * Game clock in hours. It lingers over dusk and dawn, keeps a steady pace at night and hurries through
 * the day, so a full turn takes about ten minutes and most of it is spent after dark.
 */
export class Clock {
  hour = 18.2;

  advance(dt: number, mode: TimeMode): number {
    if (mode !== 'cycle') {
      this.hour = FIXED_HOUR[mode];
      return this.hour;
    }
    const h = this.hour;
    const twilightHour = (h > 16.5 && h < 19.5) || (h > 4.5 && h < 7.5);
    const dayHour = h >= 7.5 && h <= 16.5;
    const secondsPerHour = twilightHour ? 45 : dayHour ? 10 : 30;
    this.hour = (h + dt / secondsPerHour) % 24;
    return this.hour;
  }
}

export function clockText(hour: number): string {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
