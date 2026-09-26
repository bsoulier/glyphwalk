/**
 * How often the city's showpieces happen: the fireworks over the docks and the neon power glitches.
 * By default they come round every few minutes rather than running all the time.
 */
export const EVENT_MODES = ['periodic', 'always', 'off'] as const;
export type EventMode = (typeof EVENT_MODES)[number];
export const EVENT_LABELS: Record<EventMode, string> = {
  periodic: 'Every 5 minutes',
  always: 'Non-stop',
  off: 'Off',
};

export const EVENT_PERIOD_S = 300;
/** Length of one fireworks show, which ends in a quick-fire finale. */
export const SHOW_S = 60;
export const FINALE_S = 9;
/** The neon brownout comes halfway between two shows, so the two never overlap. */
export const BROWNOUT_AT_S = 150;
export const BROWNOUT_S = 2.5;

/** Whether a fireworks show is on at simulation time `t`, and whether it is in its finale. */
export function fireworksAt(mode: EventMode, t: number): { on: boolean; finale: boolean } {
  if (mode === 'off') return { on: false, finale: false };
  const period = mode === 'always' ? SHOW_S : EVENT_PERIOD_S;
  const k = ((t % period) + period) % period;
  return { on: k < SHOW_S, finale: k > SHOW_S - FINALE_S && k < SHOW_S };
}

/** Whether the periodic city-wide neon brownout is happening at time `t`. */
export function brownoutAt(mode: EventMode, t: number): boolean {
  if (mode !== 'periodic') return false;
  const k = ((t % EVENT_PERIOD_S) + EVENT_PERIOD_S) % EVENT_PERIOD_S;
  return k >= BROWNOUT_AT_S && k < BROWNOUT_AT_S + BROWNOUT_S;
}
