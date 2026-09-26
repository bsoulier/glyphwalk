import { describe, expect, it } from 'vitest';
import { CELL_PRESETS, MAX_DETAIL, Quality } from '../../src/ui/quality';

/** Feeds `seconds` of identical frames and returns how many layout changes were requested. */
function feed(q: Quality, frameMs: number, workMs: number, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += frameMs / 1000) if (q.sample(frameMs, workMs, frameMs / 1000)) changes++;
  return changes;
}

describe('automatic quality', () => {
  it('starts on medium cells at full detail, or one step down on a low-end phone', () => {
    const q = new Quality('auto', 60);
    expect([q.preset.id, q.detail]).toEqual(['m', 0]);
    const low = new Quality('auto', 60, true);
    expect([low.preset.id, low.detail]).toEqual(['m', 1]);
  });

  it('trades cell size and draw distance when frames run long, down to the last step', () => {
    const q = new Quality('auto', 60);
    expect(feed(q, 50, 45, 60)).toBeGreaterThan(3);
    expect(q.preset.id).toBe(CELL_PRESETS[CELL_PRESETS.length - 1].id);
    expect(q.detail).toBe(MAX_DETAIL);
    expect(q.distScale).toBeLessThan(0.5);
    expect(q.maxDpr).toBe(1);
  });

  it('climbs back to small cells and full detail with plenty of headroom, but never below S', () => {
    const q = new Quality('auto', 60);
    feed(q, 50, 45, 60);
    feed(q, 8, 1, 120);
    expect([q.preset.id, q.detail, q.distScale, q.maxDpr]).toEqual(['s', 0, 1, 2]);
  });

  it('only moves the detail level when the cell size is chosen by hand', () => {
    const q = new Quality('l', 60);
    feed(q, 50, 45, 30);
    expect(q.preset.id).toBe('l');
    expect(q.detail).toBeGreaterThan(0);
  });

  it('ignores a single long stall such as a tab coming back from the background', () => {
    const q = new Quality('auto', 60);
    feed(q, 16, 3, 3);
    const before = [q.preset.id, q.detail, q.frameMs];
    expect(q.sample(4000, 3, 0.05)).toBe(false);
    expect([q.preset.id, q.detail, q.frameMs]).toEqual(before);
  });
});
