import { describe, expect, it } from 'vitest';
import { CHARSET } from '../../src/core/charset';
import { hash2, hash3, mulberry32, valueNoise } from '../../src/core/hash';
import { Clock, daylightAt } from '../../src/render/daylight';
import { fontBits } from '../../src/world/font';
import { HOODS, hoodAt, nearestRegion } from '../../src/world/hoods';
import { SIGN_SCALES, SIGN_TEXTS, signSeed } from '../../src/world/signs';

describe('deterministic randomness', () => {
  it('hashes the same inputs to the same outputs', () => {
    expect(hash2(3, -7)).toBe(hash2(3, -7));
    expect(hash3(1, 2, 3)).not.toBe(hash3(3, 2, 1));
    const a = mulberry32(99), b = mulberry32(99);
    for (let k = 0; k < 20; k++) expect(a()).toBe(b());
  });

  it('keeps noise in [0, 1]', () => {
    for (let k = 0; k < 500; k++) {
      const v = valueNoise(k * 0.37, k * -0.21, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('districts', () => {
  it('puts downtown at the origin and every district somewhere nearby', () => {
    expect(HOODS[hoodAt(0, 0)].name).toBe('DOWNTOWN');
    HOODS.forEach((_, k) => expect(nearestRegion(k, 0, 0)).not.toBeNull());
  });
});

describe('signs', () => {
  it('can draw every letter of every sign, near and far', () => {
    for (const text of SIGN_TEXTS) {
      for (const ch of text) {
        expect(CHARSET.includes(ch), `${ch} in "${text}"`).toBe(true);
        if (ch !== ' ') expect(fontBits(ch), `3x5 glyph for ${ch} in "${text}"`).not.toBe(0);
      }
    }
  });

  it('packs text, flicker, scale and id into one seed', () => {
    const seed = signSeed(12, 5, 0.5, 200);
    expect(seed & 255).toBe(12);
    expect((seed >> 8) & 7).toBe(5);
    expect(SIGN_SCALES[(seed >> 11) & 7]).toBe(0.5);
    expect((seed >> 14) & 255).toBe(200);
    // Seeds live in Float32Array face data, which is exact only up to 2^24.
    expect(seed).toBeLessThan(2 ** 24);
  });
});

describe('time of day', () => {
  it('has the sun up at noon and stars and street lamps at midnight', () => {
    const noon = daylightAt(12, 'clear'), night = daylightAt(0, 'clear');
    expect(noon.label).toBe('day');
    expect(noon.sunUp).toBeGreaterThan(0.9);
    expect(noon.lamps).toBeLessThan(0.05);
    expect(night.label).toBe('night');
    expect(night.stars).toBeGreaterThan(0.9);
    expect(night.lamps).toBeGreaterThan(0.95);
  });

  it('holds a fixed hour, and lingers over dusk in the cycle', () => {
    const c = new Clock();
    expect(c.advance(10, 'dusk')).toBeCloseTo(18.15);
    c.hour = 18;
    c.advance(45, 'cycle');
    expect(c.hour).toBeCloseTo(19);
    c.hour = 12;
    c.advance(10, 'cycle');
    expect(c.hour).toBeCloseTo(13);
  });
});
