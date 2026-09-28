import { describe, expect, it } from 'vitest';
import { F_VILLA, facadeOf, facadeSeed } from '../../src/render/facades';
import { generateBlock } from '../../src/world/city';
import { HOODS, HOOD_BLOCKS, H_ESTATES, H_MEDINA, H_SEAFRONT, H_SUBURB, hoodOfRegion, isBeach, nearestRegion } from '../../src/world/hoods';
import { LANDMARK_I, LANDMARK_J } from '../../src/world/layout';
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
  it('gives every district a fair share of the regions', () => {
    const count = HOODS.map(() => 0);
    const n = 40 * 40;
    for (let ri = -20; ri < 20; ri++) for (let rj = -20; rj < 20; rj++) count[hoodOfRegion(ri, rj)]++;
    count.forEach((c, k) => {
      expect(c / n, HOODS[k].name).toBeGreaterThan(0.03);
      expect(c / n, HOODS[k].name).toBeLessThan(0.3);
    });
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

describe('Glyph Tower', () => {
  it('rises over downtown with a lift to an observation deck near 480 m', () => {
    const b = generateBlock(LANDMARK_I, LANDMARK_J);
    const tower = b.interiors.find((it) => it.label === 'GLYPH TOWER');
    expect(tower).toBeDefined();
    const deck = tower!.levels[tower!.levels.length - 1];
    expect(deck.room).toBe('SKYDECK');
    expect(deck.y).toBeGreaterThan(450);
    expect(tower!.lift).not.toBeNull();
    expect(b.cy * 2).toBeGreaterThan(550);
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
