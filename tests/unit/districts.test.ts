import { describe, expect, it } from 'vitest';
import { F_VILLA, facadeOf, facadeSeed } from '../../src/render/facades';
import { City, generateBlock } from '../../src/world/city';
import { FACE_STRIDE } from '../../src/world/faces';
import {
  CITY_HALF, HOODS, HOOD_BLOCKS, H_DOWNTOWN, H_ESTATES, H_FARMLAND, H_JAPAN, H_MEDINA, H_OLDTOWN, H_SEAFRONT, H_SUBURB, hoodOfRegion,
  isBeach, nearestRegion,
} from '../../src/world/hoods';
import { type Interior, stairFloor } from '../../src/world/interior';
import { KIND_PARK, LANDMARK_I, LANDMARK_J } from '../../src/world/layout';
import { KIND_TAXI, Traffic } from '../../src/world/traffic';

/** Every building you can enter in the district region nearest the origin. */
function interiors(hood: number): Interior[] {
  const r = nearestRegion(hood, 0, 0)!;
  const all: Interior[] = [];
  for (let di = 0; di < HOOD_BLOCKS; di++) {
    for (let dj = 0; dj < HOOD_BLOCKS; dj++) all.push(...generateBlock(r[0] * HOOD_BLOCKS + di, r[1] * HOOD_BLOCKS + dj).interiors);
  }
  return all;
}

const enterable = (hood: number): string[] => interiors(hood).map((it) => it.label);

describe('districts', () => {
  it('gives every district a fair share of the city, and farmland all round it', () => {
    const count = HOODS.map(() => 0);
    const edge = CITY_HALF / HOOD_BLOCKS, n = (2 * edge) ** 2;
    for (let ri = -edge; ri < edge; ri++) for (let rj = -edge; rj < edge; rj++) count[hoodOfRegion(ri, rj)]++;
    count.forEach((c, k) => {
      if (k === H_FARMLAND) return expect(c).toBe(0);
      expect(c / n, HOODS[k].name).toBeGreaterThan(0.02);
      expect(c / n, HOODS[k].name).toBeLessThan(0.3);
    });
    for (const [ri, rj] of [[edge, 0], [-edge - 1, 0], [0, edge], [3, -edge - 1], [40, 40]]) expect(hoodOfRegion(ri, rj)).toBe(H_FARMLAND);
  });

  it('keeps the beach to the northern row of the Seafront', () => {
    const [ri, rj] = nearestRegion(H_SEAFRONT, 0, 0)!;
    for (let di = 0; di < HOOD_BLOCKS; di++) {
      const i = ri * HOOD_BLOCKS + di;
      expect(isBeach(i, rj * HOOD_BLOCKS + HOOD_BLOCKS - 1)).toBe(true);
      expect(isBeach(i, rj * HOOD_BLOCKS + HOOD_BLOCKS - 2)).toBe(false);
    }
  });

  it('has homes, mansions, hotels and riads you can walk into', () => {
    expect(enterable(H_SUBURB)).toContain('HOUSE');
    expect(enterable(H_ESTATES).some((l) => l === 'MANSION' || l === 'VILLA')).toBe(true);
    expect(enterable(H_SEAFRONT)).toContain('HOTEL');
    expect(enterable(H_MEDINA)).toContain('RIAD');
  });

  it('hangs doors that suit the building, keeping sliding glass for towers, big hotels and modern shops', () => {
    const doors = (hood: number, label?: string) => new Set(interiors(hood).filter((it) => !label || it.label === label)
      .map(({ door: d }) => `${d.kind}${d.glazed ? ' glazed' : ''} x${d.leaves}`));
    expect(doors(H_SUBURB, 'HOUSE')).toEqual(new Set(['hinged x1']));
    expect(doors(H_FARMLAND, 'FARMHOUSE')).toEqual(new Set(['hinged x1']));
    expect(doors(H_ESTATES, 'MANSION')).toEqual(new Set(['hinged x2']));
    expect(doors(H_MEDINA, 'RIAD')).toEqual(new Set(['hinged x2']));
    expect(doors(H_JAPAN, 'RYOKAN')).toEqual(new Set(['slide glazed x2']));
    expect(doors(H_DOWNTOWN)).toEqual(new Set(['auto glazed x2']));
    expect(doors(H_SEAFRONT, 'HOTEL')).toEqual(new Set(['auto glazed x2']));
    expect([...doors(H_OLDTOWN)].every((k) => k.startsWith('hinged'))).toBe(true);
  });

  it('packs the new facades into a seed that survives Float32', () => {
    const seed = facadeSeed(F_VILLA, 3, 7, 1, 4095);
    expect(facadeOf(seed)).toBe(F_VILLA);
    expect(seed).toBeLessThan(2 ** 24);
  });
});

/** Cells of a 0.25 m grid over the interior a walker can reach on this storey from (sx, sz), and how many there are in all. */
function reach(city: City, it: Interior, y: number, sx: number, sz: number): { seen: (x: number, z: number) => boolean; reached: number; total: number } {
  const step = 0.25, nx = Math.ceil((it.x1 - it.x0) / step), nz = Math.ceil((it.z1 - it.z0) / step);
  const cell = (x: number, z: number) => Math.floor((z - it.z0) / step) * nx + Math.floor((x - it.x0) / step);
  const seen = new Uint8Array(nx * nz);
  const queue = [cell(sx, sz)];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head], cx = c % nx, cz = Math.floor(c / nx);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + ox, z = cz + oz;
      if (x < 0 || z < 0 || x >= nx || z >= nz || seen[z * nx + x]) continue;
      seen[z * nx + x] = 1;
      if (!city.collides(it.x0 + (x + 0.5) * step, it.z0 + (z + 0.5) * step, 0.35, y)) queue.push(z * nx + x);
    }
  }
  return { seen: (x, z) => queue.includes(cell(x, z)), reached: queue.length, total: nx * nz };
}

/** Indices of the storeys a walker reaches from the street door, on a 0.25 m grid, climbing the stairs as the player does. */
function climb(city: City, it: Interior): Set<number> {
  const step = 0.25, nx = Math.ceil((it.x1 - it.x0) / step), nz = Math.ceil((it.z1 - it.z0) / step);
  const at = (c: number, o: number) => o + (c + 0.5) * step;
  const sx = Math.floor((it.door.x - it.door.nx * 0.8 - it.x0) / step), sz = Math.floor((it.door.z - it.door.nz * 0.8 - it.z0) / step);
  const queue: [number, number, number][] = [[sx, sz, 0]];
  const seen = new Set([`${sx},${sz},0`]);
  const levels = new Set<number>();
  for (let head = 0; head < queue.length; head++) {
    const [cx, cz, feet] = queue[head];
    it.levels.forEach((l, k) => l.y === feet && levels.add(k));
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + ox, z = cz + oz;
      if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
      const px = at(x, it.x0), pz = at(z, it.z0);
      const h = stairFloor(it, px, pz, feet);
      if (h < 0 || city.collides(px, pz, 0.35, h)) continue;
      const key = `${x},${z},${h.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([x, z, h]);
    }
  }
  return levels;
}

describe('houses', () => {
  it('climb by stairs, not a lift, from the front door to every storey', () => {
    const city = new City();
    const count: Record<string, number> = {};
    let sideways = 0;
    const check = (it: Interior) => {
      if (it.levels.length < 2 || (it.label !== 'RIAD' && (count[it.label] ?? 0) >= 4)) return;
      expect(it.lift).toBeNull();
      expect(it.stair).not.toBeNull();
      expect(climb(city, it).size, it.label).toBe(it.levels.length);
      count[it.label] = (count[it.label] ?? 0) + 1;
      // Narrow rooms take the flight along a side wall, running in from the front.
      if (Math.abs(it.stair!.ux * it.door.nx + it.stair!.uz * it.door.nz) > 0.5) sideways++;
    };
    const homes = ['HOUSE', 'MANSION', 'RIAD', 'INN', 'RYOKAN'];
    for (const hood of [H_SUBURB, H_ESTATES, H_MEDINA, H_OLDTOWN, H_JAPAN]) {
      const r = nearestRegion(hood, 0, 0)!;
      for (let di = 0; di < HOOD_BLOCKS; di++) {
        for (let dj = 0; dj < HOOD_BLOCKS; dj++) {
          for (const it of city.get(r[0] * HOOD_BLOCKS + di, r[1] * HOOD_BLOCKS + dj).interiors) if (homes.includes(it.label)) check(it);
        }
      }
    }
    for (let i = CITY_HALF; i < CITY_HALF + 16; i++) {
      for (let j = -8; j < 8; j++) for (const it of city.get(i, j).interiors) if (it.label === 'FARMHOUSE') check(it);
    }
    for (const label of ['HOUSE', 'MANSION', 'FARMHOUSE', 'INN', 'RYOKAN']) expect(count[label], label).toBe(4);
    expect(count.RIAD).toBeGreaterThan(0);
    expect(sideways).toBeGreaterThan(0);
  });
});

describe('Silver Hills', () => {
  it('lets you into every house, furnished, from the door to the stairs and round every floor', () => {
    const r = nearestRegion(H_ESTATES, 0, 0)!;
    const city = new City();
    let houses = 0;
    for (let di = 0; di < HOOD_BLOCKS; di++) {
      for (let dj = 0; dj < HOOD_BLOCKS; dj++) {
        const b = city.get(r[0] * HOOD_BLOCKS + di, r[1] * HOOD_BLOCKS + dj);
        if (b.kind === KIND_PARK) continue;
        const homes = b.interiors.filter((it) => it.label === 'MANSION' || it.label === 'VILLA');
        expect(homes).toHaveLength(1);
        const it = homes[0];
        houses++;
        expect(it.levels[0].room).toBe(it.label === 'MANSION' ? 'SALON' : 'OPEN PLAN');
        if (it.label === 'MANSION') expect(it.levels[it.levels.length - 1].room).toBe('MASTER SUITE');
        const s = it.stair;
        // Just off the flights at their foot (u < 0) or their top (u > run), halfway across.
        const off = (u: number) => [s!.x + s!.ux * u + s!.vx * 0.5, s!.z + s!.uz * u + s!.vz * 0.5];
        for (const lv of it.levels) {
          expect(lv.faces.length / FACE_STRIDE).toBeGreaterThan(250);
          const start = lv.k === 0 ? [it.door.x - it.door.nx * 0.8, it.door.z - it.door.nz * 0.8] : off(s!.run + 0.5);
          const walk = reach(city, it, lv.y, start[0], start[1]);
          expect(walk.reached / walk.total).toBeGreaterThan(0.55);
          if (s && lv !== it.levels[it.levels.length - 1]) expect(walk.seen(...(off(-0.5) as [number, number]))).toBe(true);
        }
      }
    }
    expect(houses).toBeGreaterThan(8);
  });
});

describe('Glyph Tower', () => {
  it('rises over downtown with a lift to an observation deck near 480 m', () => {
    const b = generateBlock(LANDMARK_I, LANDMARK_J);
    const tower = b.interiors.find((it) => it.label === 'GLYPH TOWER');
    expect(tower).toBeDefined();
    const deck = tower!.levels.find((l) => l.room === 'SKYDECK')!;
    expect(deck.y).toBeGreaterThan(450);
    expect(deck.open).toBe(false);
    expect(tower!.lift).not.toBeNull();
    expect(b.cy * 2).toBeGreaterThan(550);
  });

  it('has an open roof above the deck, one more stop up the lift, with a way round the crown', () => {
    const city = new City();
    const tower = city.get(LANDMARK_I, LANDMARK_J).interiors.find((it) => it.label === 'GLYPH TOWER')!;
    const deck = tower.levels.find((l) => l.room === 'SKYDECK')!;
    const roof = tower.levels[tower.levels.length - 1];
    expect(roof.open).toBe(true);
    expect(roof.room).toBe('OPEN SKY');
    expect(roof.y).toBeGreaterThan(deck.y);
    expect(tower.levels.indexOf(roof)).toBe(tower.levels.indexOf(deck) + 1);
    const cx = (tower.x0 + tower.x1) / 2, cz = (tower.z0 + tower.z1) / 2;
    expect(city.collides(cx, cz, 0.35, roof.y)).toBe(true);
    const L = tower.liftDoor!;
    const walk = reach(city, tower, roof.y, L.x + L.nx * 1.0, L.z + L.nz * 1.0);
    expect(walk.seen((tower.lift!.x0 + tower.lift!.x1) / 2, (tower.lift!.z0 + tower.lift!.z1) / 2)).toBe(true);
    // Everything but the crown in the middle: the walkway goes all the way round it.
    expect(walk.reached / walk.total).toBeGreaterThan(0.5);
    for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) expect(walk.seen(cx + sx * 10, cz + sz * 10)).toBe(true);
  });
});

describe('taxis', () => {
  it('always sends a taxi when one is hailed', () => {
    for (let n = 0; n < 5; n++) {
      const t = new Traffic(30, false);
      expect(t.list[t.hail(10 + n * 40, 20, 0, KIND_TAXI)].kind).toBe(KIND_TAXI);
    }
  });
});
