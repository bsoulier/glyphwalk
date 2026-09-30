import { describe, expect, it } from 'vitest';
import { City } from '../../src/world/city';
import { Cats } from '../../src/world/cats';
import {
  CITY_HALF, HOOD_BLOCKS, H_FARMLAND, hoodAt, hoodOfRegion, inCity, roadEW, roadNS, signalled,
} from '../../src/world/hoods';
import { LANE, P, setWorldSeed } from '../../src/world/layout';
import { LOOP_BLOCKS, STATIONS, hasLoop, stationsOf } from '../../src/world/loop';
import { Pedestrians } from '../../src/world/pedestrians';
import { KIND_TAXI, Traffic } from '../../src/world/traffic';

setWorldSeed(1337);
const EDGE = CITY_HALF * P;

describe('the city and the farmland round it', () => {
  it('keeps every district of the city where it was', () => {
    // Recorded before the farmland existed, when the city went on for ever: old links still land in the same place.
    let hoods = '';
    for (let rj = -6; rj < 6; rj++) for (let ri = -6; ri < 6; ri++) hoods += hoodOfRegion(ri, rj).toString(36);
    expect(hoods).toBe(
      '461162041605163111585056034270372011535600523030041376370732282000238740501300038253456238115111750106752027122066211517112835633142571036156125',
    );
  });

  it('ends on whole monorail cells and district regions', () => {
    expect(CITY_HALF % LOOP_BLOCKS).toBe(0);
    expect(CITY_HALF % HOOD_BLOCKS).toBe(0);
    expect(inCity(-CITY_HALF, CITY_HALF - 1)).toBe(true);
    expect(inCity(CITY_HALF, 0)).toBe(false);
    expect(hoodAt(CITY_HALF, 0)).toBe(H_FARMLAND);
    expect(hoodAt(0, -CITY_HALF - 1)).toBe(H_FARMLAND);
  });

  it('has a street on every line in the city and a country road on every region line outside it', () => {
    for (let n = -CITY_HALF; n <= CITY_HALF; n++) {
      expect(roadNS(n, 0)).toBe(true);
      expect(roadEW(n, -3)).toBe(true);
    }
    const m = CITY_HALF + 5;
    for (let n = CITY_HALF + 1; n < CITY_HALF + 20; n++) {
      expect(roadNS(n, m)).toBe(n % HOOD_BLOCKS === 0);
      expect(roadEW(-n, m)).toBe(n % HOOD_BLOCKS === 0);
    }
    // The edge street runs the whole way round, and the city's streets end at it.
    expect(roadNS(CITY_HALF, 7)).toBe(true);
    expect(roadEW(CITY_HALF + 1, 7)).toBe(false);
    expect(signalled(CITY_HALF, 7)).toBe(true);
    expect(signalled(CITY_HALF + HOOD_BLOCKS, CITY_HALF + HOOD_BLOCKS)).toBe(false);
  });

  it('runs the monorail only in the city', () => {
    const cells = CITY_HALF / LOOP_BLOCKS;
    expect(hasLoop(cells - 1, -cells)).toBe(true);
    expect(stationsOf(cells - 1, 0)).toHaveLength(STATIONS);
    expect(hasLoop(cells, 0)).toBe(false);
    expect(stationsOf(cells, 0)).toHaveLength(0);
    expect(stationsOf(0, -cells - 1)).toHaveLength(0);
  });
});

/** Is (x, z) in a lane of a road that exists? */
function inLane(x: number, z: number): boolean {
  for (const s of [-1, 1]) {
    const lx = x + s * LANE, lz = z + s * LANE;
    if (Math.abs(lx - Math.round(lx / P) * P) < 1e-6 && (roadNS(Math.round(lx / P), Math.floor(z / P)) || roadNS(Math.round(lx / P), Math.floor((z + 1) / P)))) return true;
    if (Math.abs(lz - Math.round(lz / P) * P) < 1e-6 && (roadEW(Math.round(lz / P), Math.floor(x / P)) || roadEW(Math.round(lz / P), Math.floor((x + 1) / P)))) return true;
  }
  return false;
}

describe('out in the farmland', () => {
  const env = { time: 0, walker: null, peds: [] };
  // Two sections out from the east edge of the city, by a country road.
  const cx = EDGE + 2 * HOOD_BLOCKS * P + 20, cz = 100;

  it('keeps cars on the country roads, and only a few of them', () => {
    const t = new Traffic(64, false);
    const cab = t.list[t.hail(cx + 30, cz + 40, H_FARMLAND, KIND_TAXI)];
    let driven = 0;
    for (let s = 0; s < 1200; s++) {
      const x = cab.x, z = cab.z;
      t.update(0.05, cx, cz, 220, cab, env);
      env.time += 0.05;
      driven += Math.hypot(cab.x - x, cab.z - z);
      const about = t.list.filter((v) => v.x < 1e6);
      expect(about.length).toBeLessThanOrEqual(6);
      for (const v of about) expect(inLane(v.x, v.z), `car at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`).toBe(true);
    }
    // The hailed cab kept driving the whole minute, round the sections, without stopping at empty crossroads.
    expect(driven).toBeGreaterThan(500);
  });

  it('never sends pedestrians walking the fields', () => {
    const peds = new Pedestrians(150);
    let walking = 0;
    for (let s = 0; s < 400; s++) {
      peds.update(0.05, EDGE + 90, 0, 170, s * 0.05);
      for (const p of peds.list) {
        if (p.x > 1e6) continue;
        walking++;
        expect(inCity(Math.floor(p.x / P), Math.floor(p.z / P))).toBe(true);
      }
    }
    expect(walking).toBeGreaterThan(1000);
  });

  it('puts farm cats by the roadside, not out in the crops', () => {
    const cats = new Cats(new City());
    let seen = 0;
    for (let i = CITY_HALF + 1; i < CITY_HALF + 17; i++) {
      for (let j = -8; j < 8; j++) {
        const c = cats.catIn(i, j);
        if (!c) continue;
        seen++;
        expect(c.where).toBe('street');
        const toNS = Math.min(...[Math.floor(c.x / P), Math.floor(c.x / P) + 1].filter((n) => roadNS(n, j)).map((n) => Math.abs(c.x - n * P)), 99);
        const toEW = Math.min(...[Math.floor(c.z / P), Math.floor(c.z / P) + 1].filter((n) => roadEW(n, i)).map((n) => Math.abs(c.z - n * P)), 99);
        expect(Math.min(toNS, toEW)).toBeLessThan(12);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});
