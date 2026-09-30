import {
  C_EMOTE, C_HOOD, C_STATE, CLOSE_BAD, CLOSE_FLOOD, CLOSE_FULL, CLOSE_TAKEN, EMOTE_GAP_MS, HOOD_UNKNOWN, MAX_PEERS, MAX_SEEN,
  SEE, ZONE, type WireEntry, decodeEmote, decodeHood, decodeState, encodeUpdate, zoneOf,
} from '../../src/net/protocol';

/** Where a zone sends a client its updates: the WebSocket, or a stand-in in tests. */
export interface Link {
  send(data: ArrayBuffer): void;
}

/** Messages per second a client may send on average, and in a burst. */
const RATE = 12;
const BURST = 30;
/** Messages dropped for going over the rate before the client is disconnected. */
const STRIKES = 60;
/** Grid cell for finding who is near whom: with cells as wide as the view, a 3x3 block covers it. */
const CELL = SEE;

export class Peer implements WireEntry {
  x = 0;
  z = 0;
  /** Feet height in decimetres, as on the wire. */
  y = 0;
  /** Heading as a byte, as on the wire. */
  yaw = 0;
  mode = 0;
  /** District, for the city-wide head count only. */
  hood = HOOD_UNKNOWN;
  /** Has sent where it is; until then it neither is seen nor is sent anything. */
  placed = false;
  /** Stands in this zone, so others see it here; otherwise it is only watching across the edge. */
  home = false;
  moved = false;
  /** State changed since it was last saved for hibernation. */
  unsaved = false;
  tokens = BURST;
  refilled: number;
  strikes = 0;
  lastEmote = -Infinity;
  /** The players this client was last told about. */
  readonly known = new Set<Peer>();
  /** Scratch for one client's update: its distance, and whether it was picked. */
  d2 = 0;
  mark = 0;

  constructor(readonly id: number, readonly link: Link, now: number) {
    this.refilled = now;
  }
}

function cellKey(i: number, j: number): number {
  return (i + 64) * 256 + (j + 64);
}

/**
 * One zone of the city on the server. Clients send where they are; every tick each one is sent the
 * nearest players within SEE that are new to it or moved, the ids it should forget, and nearby emotes.
 * Nothing is sent while nothing changes, which lets the room sleep.
 */
export class ZoneCore {
  readonly peers = new Map<number, Peer>();
  /** Something happened since the last tick, so one is due. */
  dirty = false;
  /** Who stands here, or in which district, changed since the head count was last taken. */
  countChanged = false;
  private readonly emotes: { id: number; k: number; from: Peer }[] = [];
  private readonly grid = new Map<number, Peer[]>();
  private readonly spare: Peer[][] = [];
  private readonly near: Peer[] = [];
  private readonly out: Peer[] = [];
  private readonly gone: number[] = [];
  private readonly heard: { id: number; k: number }[] = [];
  private mark = 0;
  private readonly x0: number;
  private readonly z0: number;

  constructor(readonly zx: number, readonly zz: number, private readonly maxPeers = MAX_PEERS) {
    this.x0 = zx * ZONE;
    this.z0 = zz * ZONE;
  }

  /** A new client, or the close code to turn it away with. */
  join(id: number, link: Link, now: number): Peer | number {
    if (this.peers.has(id)) return CLOSE_TAKEN;
    if (this.peers.size >= this.maxPeers) return CLOSE_FULL;
    const p = new Peer(id, link, now);
    this.peers.set(id, p);
    return p;
  }

  /** A client that was here before the room slept, with the state it had saved. */
  restore(id: number, link: Link, saved: readonly number[] | null, now: number): Peer | null {
    const p = this.join(id, link, now);
    if (typeof p === 'number') return null;
    if (saved && saved.length >= 5) {
      [p.x, p.z, p.y, p.yaw, p.mode] = saved;
      if (saved.length > 5) p.hood = saved[5];
      this.place(p);
    }
    return p;
  }

  leave(p: Peer): void {
    if (this.peers.get(p.id) !== p) return;
    this.peers.delete(p.id);
    this.dirty = true;
    if (p.placed && p.home) this.countChanged = true;
  }

  /** Players standing in this zone, as [district, players] pairs: each player counts in one zone only. */
  count(): [number, number][] {
    const by = new Map<number, number>();
    for (const p of this.peers.values()) if (p.placed && p.home) by.set(p.hood, (by.get(p.hood) ?? 0) + 1);
    return [...by];
  }

  /**
   * Who is in the room, for the server's log: each placed player, whether it stands here or only watches
   * across the edge, how many players it was last sent, and how far the nearest one standing here is
   * (whole metres, -1 for nobody). Distances only, so the log never holds where anyone is.
   */
  snapshot(): { id: number; home: boolean; seen: number; nearest: number }[] {
    const out: { id: number; home: boolean; seen: number; nearest: number }[] = [];
    for (const w of this.peers.values()) {
      if (!w.placed) continue;
      let d2 = Infinity;
      for (const p of this.peers.values()) {
        if (p !== w && p.placed && p.home) d2 = Math.min(d2, (p.x - w.x) ** 2 + (p.z - w.z) ** 2);
      }
      out.push({ id: w.id, home: w.home, seen: w.known.size, nearest: d2 === Infinity ? -1 : Math.round(Math.sqrt(d2)) });
    }
    return out;
  }

  /** Handles one message. Returns 0, or a close code the caller should disconnect the client with. */
  receive(p: Peer, data: ArrayBuffer, now: number): number {
    p.tokens = Math.min(BURST, p.tokens + ((now - p.refilled) * RATE) / 1000);
    p.refilled = now;
    if (p.tokens < 1) return ++p.strikes > STRIKES ? CLOSE_FLOOD : 0;
    p.tokens -= 1;
    const v = new DataView(data);
    if (v.byteLength === 0) return CLOSE_BAD;
    switch (v.getUint8(0)) {
      case C_STATE:
        if (!decodeState(v, p)) return CLOSE_BAD;
        this.place(p);
        return 0;
      case C_EMOTE: {
        const k = decodeEmote(v);
        if (k < 0) return CLOSE_BAD;
        // Only the zone a player stands in passes its emotes on, or neighbours would repeat them.
        if (!p.home || now - p.lastEmote < EMOTE_GAP_MS) return 0;
        p.lastEmote = now;
        this.emotes.push({ id: p.id, k, from: p });
        this.dirty = true;
        return 0;
      }
      case C_HOOD: {
        const k = decodeHood(v);
        if (k < 0) return CLOSE_BAD;
        if (k !== p.hood && p.placed && p.home) this.countChanged = true;
        p.hood = k;
        p.unsaved = true;
        return 0;
      }
      default:
        return CLOSE_BAD;
    }
  }

  private place(p: Peer): void {
    const counted = p.placed && p.home;
    p.placed = true;
    p.moved = true;
    p.unsaved = true;
    p.home = zoneOf(p.x) === this.zx && zoneOf(p.z) === this.zz;
    if (p.home !== counted) this.countChanged = true;
    this.dirty = true;
  }

  tick(): void {
    this.dirty = false;
    for (const list of this.grid.values()) {
      list.length = 0;
      this.spare.push(list);
    }
    this.grid.clear();
    for (const p of this.peers.values()) {
      if (!p.placed || !p.home) continue;
      const key = cellKey(Math.floor((p.x - this.x0) / CELL), Math.floor((p.z - this.z0) / CELL));
      let list = this.grid.get(key);
      if (!list) {
        list = this.spare.pop() ?? [];
        this.grid.set(key, list);
      }
      list.push(p);
    }
    for (const w of this.peers.values()) if (w.placed) this.update(w);
    for (const p of this.peers.values()) p.moved = false;
    this.emotes.length = 0;
  }

  private update(w: Peer): void {
    const near = this.near;
    near.length = 0;
    const ci = Math.floor((w.x - this.x0) / CELL), cj = Math.floor((w.z - this.z0) / CELL);
    const r2 = SEE * SEE;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.grid.get(cellKey(i, j));
        if (!list) continue;
        for (const p of list) {
          if (p === w) continue;
          const dx = p.x - w.x, dz = p.z - w.z, d2 = dx * dx + dz * dz;
          if (d2 >= r2) continue;
          p.d2 = d2;
          near.push(p);
        }
      }
    }
    if (near.length > MAX_SEEN) {
      near.sort((a, b) => a.d2 - b.d2);
      near.length = MAX_SEEN;
    }
    const mark = ++this.mark;
    let ns = 0, added = 0;
    for (const p of near) {
      p.mark = mark;
      const fresh = !w.known.has(p);
      if (fresh) added++;
      if (fresh || p.moved) this.out[ns++] = p;
    }
    let ng = 0;
    for (const p of w.known) if (p.mark !== mark) this.gone[ng++] = p.id;
    let ne = 0;
    for (const e of this.emotes) if (e.from.mark === mark) this.heard[ne++] = e;
    if (added > 0 || ng > 0) {
      w.known.clear();
      for (const p of near) w.known.add(p);
    }
    if (ns + ng + ne > 0) w.link.send(encodeUpdate(this.out, ns, this.gone, ng, this.heard, ne));
  }
}
