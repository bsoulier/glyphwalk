import { describe, expect, it } from 'vitest';
import { P, setWorldSeed } from '../../src/world/layout';
import {
  CYCLE, DWELL, EDGE_L, HEADWAY, LOOP_LEN, PLAT_HALF, PLAT_L, PLAT_Y, STAIR_FOOT, STAIR_L, STAIR_TOP, STATIONS, STATION_S,
  STEP, TRAINS, TRAIN_LEN, type PathPoint, type TrainState, loopPoint, nextTrain, stationFloor, stationsOf, trainAt, trainState,
} from '../../src/world/loop';
import { SIGN_TEXTS } from '../../src/world/signs';

setWorldSeed(1337);
const pt = (): PathPoint => ({ x: 0, z: 0, yaw: 0 });
const ts = (): TrainState => ({ s: 0, at: -1, next: 0, left: 0, trip: 0 });

describe('monorail loops', () => {
  it('run round a closed path with no jumps', () => {
    const a = pt(), b = pt();
    for (let s = 0; s < LOOP_LEN; s += 0.5) {
      loopPoint(3, -2, s, a);
      loopPoint(3, -2, s + 0.5, b);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(0.5, 2);
    }
    loopPoint(3, -2, 0, a);
    loopPoint(3, -2, LOOP_LEN, b);
    expect([b.x, b.z]).toEqual([a.x, a.z]);
  });

  it('keep their straight stretches over the middle of the roads', () => {
    const p = pt();
    for (const s of STATION_S) {
      loopPoint(0, 0, s, p);
      const onRoad = (v: number) => Math.abs(v - Math.round(v / P) * P) < 1e-6;
      expect(onRoad(p.x) || onRoad(p.z)).toBe(true);
    }
  });

  it('have twelve stations mid-block, clear of the crossroads, with names from the sign list', () => {
    const list = stationsOf(0, 0);
    expect(list).toHaveLength(STATIONS);
    for (const st of list) {
      const along = st.x * st.dx + st.z * st.dz;
      expect(((along % P) + P) % P).toBeCloseTo(P / 2, 6);
      expect(PLAT_HALF + 6).toBeLessThanOrEqual(P / 2);
      expect(st.words.every((w) => w >= 0 && SIGN_TEXTS[w] !== undefined)).toBe(true);
    }
    // The one next to the Glyph Tower is named after it.
    expect(list.some((st) => st.name === 'GLYPH TOWER')).toBe(true);
    expect(stationsOf(0, 0).map((s) => s.name)).toEqual(list.map((s) => s.name));
  });
});

describe('monorail timetable', () => {
  it('holds each train at each station with the doors open, then moves on', () => {
    const t = ts();
    let stops = 0, was = -1;
    for (let time = 0; time < CYCLE; time += 0.25) {
      trainState(1, 1, 0, time, t);
      if (t.at >= 0 && t.at !== was) stops++;
      was = t.at;
      expect(t.left).toBeGreaterThanOrEqual(0);
    }
    expect(stops).toBeGreaterThanOrEqual(STATIONS);
  });

  it('keeps every train well behind the one ahead', () => {
    const t = ts();
    for (let time = 5000; time < 5000 + CYCLE; time += 1.5) {
      const s = Array.from({ length: TRAINS }, (_, k) => trainState(0, 0, k, time, t).s).sort((a, b) => a - b);
      for (let k = 0; k < TRAINS; k++) {
        const gap = (k + 1 < TRAINS ? s[k + 1] : s[0] + LOOP_LEN) - s[k];
        expect(gap).toBeGreaterThan(TRAIN_LEN + 20);
      }
    }
  });

  it('tells a platform which train stands there and when the next one comes', () => {
    const t = ts();
    for (let time = 100; time < 100 + CYCLE; time += 3) {
      for (let n = 0; n < STATIONS; n += 5) {
        const k = trainAt(2, 3, n, time);
        if (k >= 0) {
          expect(trainState(2, 3, k, time, t).at).toBe(n);
          expect(nextTrain(2, 3, n, time)).toBe(0);
        } else expect(nextTrain(2, 3, n, time)).toBeLessThanOrEqual(HEADWAY + DWELL);
      }
    }
  });
});

describe('walking up to a platform', () => {
  const st = stationsOf(0, 0)[1];
  const at = (a: number, l: number) => [st.x + st.dx * a + st.nx * l, st.z + st.dz * a + st.nz * l] as const;
  const floor = (a: number, l: number, feet: number) => stationFloor(...at(a, l), feet);

  it('climbs the stairs from the kerb to the platform one step at a time', () => {
    let feet = 0;
    const l = (PLAT_L + STAIR_L) / 2;
    for (let a = STAIR_FOOT + 1; a >= STAIR_TOP - 3; a -= 0.1) {
      const f = floor(a, l, feet);
      const h = Number.isNaN(f) ? 0 : f;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(Math.abs(h - feet)).toBeLessThanOrEqual(STEP);
      feet = h;
    }
    expect(feet).toBeCloseTo(PLAT_Y, 5);
    // From the landing onto the platform.
    expect(floor(STAIR_TOP - 3, 3, feet)).toBe(PLAT_Y);
  });

  it('keeps people on the platform and off the side of the stairs', () => {
    expect(floor(0, EDGE_L - 0.3, PLAT_Y)).toBe(-1);
    expect(floor(PLAT_HALF + 0.5, 3, PLAT_Y)).toBe(-1);
    expect(floor(0, (PLAT_L + STAIR_L) / 2, 0)).toBe(-1);
    expect(floor(0, (PLAT_L + STAIR_L) / 2, PLAT_Y)).toBe(-1);
    expect(floor(4, 3.8, PLAT_Y)).toBe(-1);
  });

  it('leaves the street under the platform to the road', () => {
    expect(floor(0, 3, 0)).toBeNaN();
    expect(stationFloor(st.x + 500, st.z + 500, 0)).toBeNaN();
  });
});
