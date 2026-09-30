import { describe, expect, it } from 'vitest';
import { City, POLE_STRIDE } from '../../src/world/city';
import { Cats } from '../../src/world/cats';
import { FACE_STRIDE } from '../../src/world/faces';
import { FARM_GRAIN, farmAt } from '../../src/world/fields';
import {
  CITY_HALF, HOOD_BLOCKS, H_FARMLAND, hoodAt, hoodOfRegion, inCity, roadEW, roadNS, signalled,
} from '../../src/world/hoods';
import { LANE, P, ROAD_HALF, setWorldSeed } from '../../src/world/layout';
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

/** Is (x, z) on the asphalt of a road that exists (a country road, or the city street along the edge), widened by `m`? */
function onRoad(x: number, z: number, m: number): boolean {
  const bi = Math.floor(x / P), bj = Math.floor(z / P), n = Math.round(x / P), e = Math.round(z / P);
  const ns = inCity(n - 1, bj) || inCity(n, bj) ? ROAD_HALF : 4.4;
  const ew = inCity(bi, e - 1) || inCity(bi, e) ? ROAD_HALF : 4.4;
  return (roadNS(n, bj) && Math.abs(x - n * P) < ns + m) || (roadEW(e, bi) && Math.abs(z - e * P) < ew + m);
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

  it('has a farmstead in about every other section, by a country road', () => {
    let sections = 0, farms = 0;
    for (let si = -30; si < 30; si++) {
      for (let sj = -30; sj < 30; sj++) {
        const i0 = si * HOOD_BLOCKS, j0 = sj * HOOD_BLOCKS;
        const here: [number, number, number][] = [];
        for (let i = i0; i < i0 + HOOD_BLOCKS; i++) for (let j = j0; j < j0 + HOOD_BLOCKS; j++) {
          const f = farmAt(i, j);
          if (f >= 0) here.push([i, j, f & 3]);
        }
        if (inCity(i0, j0)) {
          expect(here).toHaveLength(0);
          continue;
        }
        sections++;
        expect(here.length).toBeLessThanOrEqual(1);
        if (here.length === 0) continue;
        farms++;
        // Its drive leaves by a road that is a country road, not a city street and not a crossroads.
        const [i, j, side] = here[0];
        const road = side === 0 ? roadEW(j, i) : side === 1 ? roadNS(i + 1, j) : side === 2 ? roadEW(j + 1, i) : roadNS(i, j);
        expect(road).toBe(true);
        const [ai, aj] = side === 0 ? [i, j - 1] : side === 1 ? [i + 1, j] : side === 2 ? [i, j + 1] : [i - 1, j];
        expect(inCity(ai, aj)).toBe(false);
        const along = side === 0 || side === 2 ? i - i0 : j - j0;
        expect(along === 1 || along === 2).toBe(true);
      }
    }
    expect(farms / sections).toBeGreaterThan(0.45);
    expect(farms / sections).toBeLessThan(0.65);
  });

  it('builds each farmstead with a farmhouse to walk into, a barn, and silos or grain bins', () => {
    const city = new City();
    let dairy = 0, grain = 0;
    for (let i = CITY_HALF; i < CITY_HALF + 40; i++) {
      for (let j = -20; j < 20; j++) {
        const f = farmAt(i, j);
        if (f < 0) continue;
        const b = city.get(i, j);
        expect(b.interiors.map((it) => it.label)).toContain('FARMHOUSE');
        // Silos and the grain leg stand well above the barn's ridge, on the horizon with the barn.
        let top = 0;
        for (let k = 0; k < b.faces.length; k += FACE_STRIDE) top = Math.max(top, b.faces[k + 1], b.faces[k + 4], b.faces[k + 7], b.faces[k + 10]);
        expect(top).toBeGreaterThan(17);
        if (f & FARM_GRAIN) grain++;
        else dairy++;
      }
    }
    expect(dairy).toBeGreaterThan(5);
    expect(grain).toBeGreaterThan(5);
  });

  it('keeps trees, fences and poles off the roads, crossroads included', () => {
    const city = new City();
    let poles = 0, low = 0;
    for (let i = CITY_HALF; i < CITY_HALF + 24; i++) {
      for (let j = -12; j < 12; j++) {
        const b = city.get(i, j);
        for (let k = 0; k < b.poles.length; k += POLE_STRIDE, poles++) {
          const x = b.poles[k], z = b.poles[k + 3];
          // Clear of the gravel shoulder too.
          expect(onRoad(x, z, 1.2), `pole at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
        }
        // Tree crowns and fence rails, not the wires strung high over the crossings.
        for (const f of [b.faces, b.props]) {
          for (let k = 0; k < f.length; k += FACE_STRIDE) {
            if (Math.min(f[k + 1], f[k + 4], f[k + 7], f[k + 10]) > 6.5) continue;
            low++;
            const x0 = Math.min(f[k], f[k + 3], f[k + 6], f[k + 9]), x1 = Math.max(f[k], f[k + 3], f[k + 6], f[k + 9]);
            const z0 = Math.min(f[k + 2], f[k + 5], f[k + 8], f[k + 11]), z1 = Math.max(f[k + 2], f[k + 5], f[k + 8], f[k + 11]);
            for (let u = 0; u <= 1; u += 0.25) {
              for (let v = 0; v <= 1; v += 0.25) {
                const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * v;
                expect(onRoad(x, z, 0), `face over the road at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
              }
            }
          }
        }
      }
    }
    expect(poles).toBeGreaterThan(1000);
    expect(low).toBeGreaterThan(1000);
  });

  it('puts farm cats by the roadside or in the farmhouse, not out in the crops', () => {
    const cats = new Cats(new City());
    let seen = 0;
    for (let i = CITY_HALF + 1; i < CITY_HALF + 17; i++) {
      for (let j = -8; j < 8; j++) {
        const c = cats.catIn(i, j);
        if (!c) continue;
        seen++;
        if (c.where === 'shop' && farmAt(i, j) >= 0) continue;
        expect(c.where).toBe('street');
        const toNS = Math.min(...[Math.floor(c.x / P), Math.floor(c.x / P) + 1].filter((n) => roadNS(n, j)).map((n) => Math.abs(c.x - n * P)), 99);
        const toEW = Math.min(...[Math.floor(c.z / P), Math.floor(c.z / P) + 1].filter((n) => roadEW(n, i)).map((n) => Math.abs(c.z - n * P)), 99);
        expect(Math.min(toNS, toEW)).toBeLessThan(12);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});
