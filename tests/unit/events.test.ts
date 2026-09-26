import { describe, expect, it } from 'vitest';
import { BROWNOUT_AT_S, BROWNOUT_S, EVENT_PERIOD_S, SHOW_S, brownoutAt, fireworksAt } from '../../src/world/events';

describe('fireworks schedule', () => {
  it('runs one show at the start of every five-minute period by default', () => {
    expect(fireworksAt('periodic', 0).on).toBe(true);
    expect(fireworksAt('periodic', SHOW_S - 0.1).on).toBe(true);
    expect(fireworksAt('periodic', SHOW_S).on).toBe(false);
    expect(fireworksAt('periodic', EVENT_PERIOD_S - 1).on).toBe(false);
    expect(fireworksAt('periodic', EVENT_PERIOD_S).on).toBe(true);
    expect(fireworksAt('periodic', 3 * EVENT_PERIOD_S + 10).on).toBe(true);
  });

  it('ends each show with a finale', () => {
    expect(fireworksAt('periodic', 10).finale).toBe(false);
    expect(fireworksAt('periodic', SHOW_S - 2).finale).toBe(true);
    expect(fireworksAt('periodic', SHOW_S + 5).finale).toBe(false);
  });

  it('never stops in non-stop mode and never starts when off', () => {
    for (let t = 0; t < 2 * EVENT_PERIOD_S; t += 7) {
      expect(fireworksAt('always', t).on).toBe(true);
      expect(fireworksAt('off', t).on).toBe(false);
    }
  });
});

describe('neon brownout', () => {
  it('happens once per period, between two shows', () => {
    expect(brownoutAt('periodic', BROWNOUT_AT_S - 0.1)).toBe(false);
    expect(brownoutAt('periodic', BROWNOUT_AT_S)).toBe(true);
    expect(brownoutAt('periodic', BROWNOUT_AT_S + BROWNOUT_S - 0.1)).toBe(true);
    expect(brownoutAt('periodic', BROWNOUT_AT_S + BROWNOUT_S)).toBe(false);
    expect(brownoutAt('periodic', EVENT_PERIOD_S + BROWNOUT_AT_S + 1)).toBe(true);
    expect(fireworksAt('periodic', BROWNOUT_AT_S).on).toBe(false);
  });

  it('is only a periodic thing', () => {
    expect(brownoutAt('always', BROWNOUT_AT_S + 1)).toBe(false);
    expect(brownoutAt('off', BROWNOUT_AT_S + 1)).toBe(false);
  });
});
