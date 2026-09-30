import { describe, expect, it } from 'vitest';
import { F_VILLA, facadeOf, facadeSeed } from '../../src/render/facades';
import { City, generateBlock } from '../../src/world/city';
import { FACE_STRIDE } from '../../src/world/faces';
import {
  CITY_HALF, HOODS, HOOD_BLOCKS, H_ESTATES, H_FARMLAND, H_MEDINA, H_SEAFRONT, H_SUBURB, hoodOfRegion, isBeach, nearestRegion,
} from '../../src/world/hoods';
import type { Interior } from '../../src/world/interior';
import { KIND_PARK, LANDMARK_I, LANDMARK_J } from '../../src/world/layout';
import { KIND_TAXI, Traffic } from '../../src/world/traffic';

/** Labels of every building you can enter in the district region nearest the origin. */
function enterable(hood: number): string[] {
  const r = nearestRegion(hood, 0, 0)!;
  const labels: string[] = [];
  for (let di = 0; di < HOOD_BLOCKS; di++) {
    for (let dj = 0; dj < HOOD_BLOCKS; dj++) {
      for (const it of generateBlock(r[0] * HOOD_BLOCKS + di, r[1] * HOOD_BLOCKS + dj).interiors) labels.push(it.label);
    }
  }
  return labels;
}

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

describe('Silver Hills', () => {
  it('lets you into every house, furnished, from the door to the lift and round every floor', () => {
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
        for (const lv of it.levels) {
          expect(lv.faces.length / FACE_STRIDE).toBeGreaterThan(250);
          const start = lv.k === 0
            ? [it.door.x - it.door.nx * 0.8, it.door.z - it.door.nz * 0.8]
            : [it.liftDoor!.x + it.liftDoor!.nx * 1.0, it.liftDoor!.z + it.liftDoor!.nz * 1.0];
          const walk = reach(city, it, lv.y, start[0], start[1]);
          expect(walk.reached / walk.total).toBeGreaterThan(0.55);
          if (it.lift) expect(walk.seen((it.lift.x0 + it.lift.x1) / 2, (it.lift.z0 + it.lift.z1) / 2)).toBe(true);
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
