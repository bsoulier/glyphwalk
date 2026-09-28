import type { CityStats } from '../../src/net/protocol';

/** A room that has not reported for this long is taken as gone (it closed without saying so). */
export const STALE_MS = 150_000;

/** Head counts of every occupied room of one city, summed into the city's. */
export class StatsCore {
  private readonly rooms = new Map<string, { hoods: [number, number][]; at: number }>();

  /** Records one room's count and returns the city's. An empty count removes the room. */
  report(room: string, hoods: readonly (readonly [number, number])[], now: number): CityStats {
    if (hoods.length === 0) this.rooms.delete(room);
    else this.rooms.set(room, { hoods: hoods.map(([h, n]): [number, number] => [h, n]), at: now });
    return this.totals(now);
  }

  /** The whole city: districts with the most players first. */
  totals(now: number): CityStats {
    const by = new Map<number, number>();
    let total = 0;
    for (const [room, r] of this.rooms) {
      if (now - r.at > STALE_MS) {
        this.rooms.delete(room);
        continue;
      }
      for (const [h, n] of r.hoods) {
        by.set(h, (by.get(h) ?? 0) + n);
        total += n;
      }
    }
    return { total, hoods: [...by].sort((a, b) => b[1] - a[1]) };
  }
}
