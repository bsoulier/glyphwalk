import type { CityStats } from '../../src/net/protocol';

/** A room that has not reported for this long is taken as gone (it closed without saying so). */
export const STALE_MS = 150_000;
/** An unchanged room's entry is written to storage again only once it is this old, which halves the writes. */
export const SAVE_MS = 60_000;

/** One room's players by district, and when it said so. */
export interface RoomCount {
  hoods: [number, number][];
  at: number;
}

function sameHoods(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean {
  return a.length === b.length && a.every(([h, n], k) => h === b[k][0] && n === b[k][1]);
}

/**
 * Head counts of every occupied room of one city, summed into the city's. The object holding it is
 * evicted from memory seconds after its last call, so it also lists what to write to storage.
 */
export class StatsCore {
  private readonly byRoom = new Map<string, RoomCount>();
  /** When each room's entry was last written. */
  private readonly savedAt = new Map<string, number>();
  /** Entries to write (null: to delete) since `writes` was last called. */
  private readonly pending = new Map<string, RoomCount | null>();

  /** Puts back a room read from storage. */
  restore(room: string, r: RoomCount): void {
    this.byRoom.set(room, r);
    this.savedAt.set(room, r.at);
  }

  /** Records one room's count and returns the city's. An empty count removes the room. */
  report(room: string, hoods: readonly (readonly [number, number])[], now: number): CityStats {
    const old = this.byRoom.get(room);
    if (hoods.length === 0) {
      if (old) this.remove(room);
    } else {
      const r: RoomCount = { hoods: hoods.map(([h, n]): [number, number] => [h, n]), at: now };
      this.byRoom.set(room, r);
      if (!old || !sameHoods(old.hoods, r.hoods) || now - (this.savedAt.get(room) ?? -Infinity) >= SAVE_MS) {
        this.pending.set(room, r);
        this.savedAt.set(room, now);
      }
    }
    return this.totals(now);
  }

  /** The whole city: districts with the most players first. */
  totals(now: number): CityStats {
    const by = new Map<number, number>();
    let total = 0;
    for (const [room, r] of this.byRoom) {
      if (now - r.at > STALE_MS) {
        this.remove(room);
        continue;
      }
      for (const [h, n] of r.hoods) {
        by.set(h, (by.get(h) ?? 0) + n);
        total += n;
      }
    }
    return { total, hoods: [...by].sort((a, b) => b[1] - a[1]) };
  }

  /** Every occupied room ("zx/zz/layer"), busiest first, with its players by district and how long ago it reported. */
  rooms(now: number): { room: string; players: number; hoods: [number, number][]; age: number }[] {
    this.totals(now);
    return [...this.byRoom].map(([room, r]) => ({ room, players: r.hoods.reduce((s, [, n]) => s + n, 0), hoods: r.hoods, age: now - r.at }))
      .sort((a, b) => b.players - a.players);
  }

  /** What changed since the last call, to write to storage: each room's entry, or null to delete it. */
  writes(): [string, RoomCount | null][] {
    const out = [...this.pending];
    this.pending.clear();
    return out;
  }

  private remove(room: string): void {
    this.byRoom.delete(room);
    this.savedAt.delete(room);
    this.pending.set(room, null);
  }
}
