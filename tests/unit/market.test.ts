import { describe, expect, it } from 'vitest';
import { HOOD_BLOCKS, H_DOCKS, hoodAt } from '../../src/world/hoods';
import { P } from '../../src/world/layout';
import { Market } from '../../src/world/market';

const local = (v: number) => ((v % HOOD_BLOCKS) + HOOD_BLOCKS) % HOOD_BLOCKS;

describe('night market', () => {
  const market = new Market();
  const blocks: [number, number][] = [];
  for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) if (market.stallsIn(i, j).length > 0) blocks.push([i, j]);

  it('sets up in many districts', () => {
    expect(blocks.length).toBeGreaterThan(40);
  });

  it('only lines the central street of each district, never in the docks', () => {
    for (const [i, j] of blocks) {
      expect([1, 2]).toContain(local(i));
      expect([1, 2]).toContain(local(j));
      expect(hoodAt(i, j)).not.toBe(H_DOCKS);
    }
  });

  it('puts stalls on the kerb between the lamp posts, facing the sidewalk', () => {
    for (const [i, j] of blocks) {
      for (const s of market.stallsIn(i, j)) {
        expect([20, 28, 36, 44]).toContain(s.x - i * P);
        const dz = s.z - j * P;
        expect(Math.abs(dz - 6.8) < 1e-9 || Math.abs(dz - (P - 6.8)) < 1e-9).toBe(true);
        expect(s.yaw).toBe(dz < P / 2 ? 0 : Math.PI);
      }
    }
  });

  it('always builds the same stalls in the same places', () => {
    const other = new Market();
    for (const [i, j] of blocks.slice(0, 20)) {
      expect(other.stallsIn(i, j).map((s) => [s.x, s.z, s.text])).toEqual(market.stallsIn(i, j).map((s) => [s.x, s.z, s.text]));
    }
  });

  it('is solid only while open, and opens and closes with the street lamps', () => {
    const m = new Market();
    const [i, j] = blocks[0];
    const s = m.stallsIn(i, j)[0];
    expect(m.collides(s.x, s.z, 0.35)).toBe(false);
    m.setLamps(0.9);
    expect(m.open).toBe(true);
    expect(m.collides(s.x, s.z, 0.35)).toBe(true);
    expect(m.collides(s.x, s.z + (s.yaw === 0 ? 3 : -3), 0.35)).toBe(false);
    m.setLamps(0.45);
    expect(m.open).toBe(true);
    m.setLamps(0.2);
    expect(m.open).toBe(false);
  });
});
