import { describe, expect, it } from 'vitest';
import { CHARSET } from '../../src/core/charset';
import { MODES } from '../../src/game/player';
import { allNameWords, playerName } from '../../src/net/names';
import {
  EMOTES, HOOD_UNKNOWN, MODE_COUNT, MODE_FLY, MODE_RAIL, MODE_SKY, MODE_TAXI, MODE_WALK, type PlayerState, SEE, ZONE,
  byteToYaw, decodeEmote, decodeHood, decodeState, decodeStats, decodeUpdate, encodeEmote, encodeHood, encodeState,
  encodeStats, encodeUpdate, yawToByte, zoneOf, zonesNear,
} from '../../src/net/protocol';

function roundTrip(s: PlayerState): PlayerState {
  const into = { x: 0, z: 0, y: 0, yaw: 0, mode: 0 };
  expect(decodeState(new DataView(encodeState(s)), into)).toBe(true);
  return into;
}

describe('online protocol', () => {
  it('keeps the camera modes in the same order as the game', () => {
    expect(MODES.length).toBe(MODE_COUNT);
    expect([MODES[MODE_WALK], MODES[MODE_FLY], MODES[MODE_TAXI], MODES[MODE_SKY], MODES[MODE_RAIL]]).toEqual(['walk', 'fly', 'taxi', 'sky', 'rail']);
  });

  it('sends a state in 13 bytes and reads it back', () => {
    expect(encodeState({ x: 1, z: 2, y: 3, yaw: 0, mode: 0 }).byteLength).toBe(13);
    const s = roundTrip({ x: 1234.567, z: -89.01, y: 472.35, yaw: 1.2, mode: MODE_TAXI });
    expect(s.x).toBeCloseTo(1234.567, 2);
    expect(s.z).toBeCloseTo(-89.01, 3);
    expect(s.y).toBe(4724);
    expect(byteToYaw(s.yaw)).toBeCloseTo(1.2, 1);
    expect(s.mode).toBe(MODE_TAXI);
  });

  it('turns away malformed states', () => {
    const into = { x: 0, z: 0, y: 0, yaw: 0, mode: 0 };
    expect(decodeState(new DataView(new ArrayBuffer(12)), into)).toBe(false);
    expect(decodeState(new DataView(encodeState({ x: Number.NaN, z: 0, y: 0, yaw: 0, mode: 0 })), into)).toBe(false);
    expect(decodeState(new DataView(encodeState({ x: 3e7, z: 0, y: 0, yaw: 0, mode: 0 })), into)).toBe(false);
    expect(decodeState(new DataView(encodeState({ x: 0, z: 0, y: 0, yaw: 0, mode: 9 })), into)).toBe(false);
    expect(decodeEmote(new DataView(encodeEmote(EMOTES.length)))).toBe(-1);
    expect(decodeEmote(new DataView(encodeEmote(2)))).toBe(2);
  });

  it('wraps headings into a byte', () => {
    expect(yawToByte(0)).toBe(0);
    expect(yawToByte(-Math.PI / 2)).toBe(192);
    expect(yawToByte(Math.PI * 2)).toBe(0);
  });

  it('reads back an update with states, departures and emotes, and rejects a cut one', () => {
    const buf = encodeUpdate(
      [{ id: 7, x: 10.5, z: -3, y: 42, yaw: 64, mode: MODE_FLY }, { id: 4000000000, x: 0, z: 1, y: 0, yaw: 0, mode: 0 }], 2,
      [99], 1, [{ id: 7, k: 5 }], 1,
    );
    const seen: unknown[] = [];
    const ok = decodeUpdate(buf, {
      state: (id, s) => seen.push(['state', id, s.x, s.z, s.y, Math.round(s.yaw * 100) / 100, s.mode]),
      gone: (id) => seen.push(['gone', id]),
      emote: (id, k) => seen.push(['emote', id, k]),
    });
    expect(ok).toBe(true);
    expect(seen).toEqual([
      ['state', 7, 10.5, -3, 4.2, 1.57, MODE_FLY], ['state', 4000000000, 0, 1, 0, 0, 0], ['gone', 99], ['emote', 7, 5],
    ]);
    const nothing = { state: () => undefined, gone: () => undefined, emote: () => undefined };
    expect(decodeUpdate(buf.slice(0, buf.byteLength - 1), nothing)).toBe(false);
  });

  it('carries districts and the city head count', () => {
    expect(decodeHood(new DataView(encodeHood(7)))).toBe(7);
    expect(decodeHood(new DataView(encodeHood(HOOD_UNKNOWN)))).toBe(-1);
    const city = { total: 1234, hoods: [[0, 1000], [8, 234]] as [number, number][] };
    expect(decodeStats(encodeStats(city))).toEqual(city);
    expect(decodeStats(encodeStats(city).slice(0, 6))).toBeNull();
    const nothing = { state: () => undefined, gone: () => undefined, emote: () => undefined };
    expect(decodeUpdate(encodeStats(city), nothing)).toBe(false);
  });

  it('finds the zones a view overlaps', () => {
    expect(zoneOf(ZONE - 0.001)).toBe(0);
    expect(zoneOf(-0.5)).toBe(-1);
    expect(zonesNear(ZONE / 2, ZONE / 2, SEE)).toEqual([[0, 0]]);
    expect(zonesNear(ZONE, ZONE, SEE)).toHaveLength(4);
    expect(zonesNear(ZONE / 2, ZONE - 10, SEE)).toEqual([[0, 0], [0, 1]]);
  });

  it('only says things the font can draw, from a fixed list', () => {
    const drawable = (s: string) => [...s].every((c) => CHARSET.includes(c));
    expect(EMOTES.every((e) => drawable(e.text))).toBe(true);
    expect(allNameWords().every((w) => /^[A-Z]+$/.test(w))).toBe(true);
    expect(playerName(12345)).toBe(playerName(12345));
    expect(new Set(Array.from({ length: 1024 }, (_, k) => playerName(k))).size).toBe(1024);
  });
});
