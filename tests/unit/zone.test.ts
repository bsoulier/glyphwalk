import { describe, expect, it } from 'vitest';
import { type Link, type Peer, ZoneCore } from '../../server/src/zone';
import {
  CLOSE_BAD, CLOSE_FLOOD, CLOSE_FULL, CLOSE_TAKEN, EMOTE_GAP_MS, MAX_SEEN, SEE, ZONE, decodeUpdate, encodeEmote, encodeState,
} from '../../src/net/protocol';

/** A client's side of the socket: everything the zone sent it, decoded. */
class Client implements Link {
  readonly seen = new Map<number, { x: number; z: number }>();
  readonly gone: number[] = [];
  readonly emotes: [number, number][] = [];
  sends = 0;
  lastStates = 0;
  send(data: ArrayBuffer): void {
    this.sends++;
    this.lastStates = 0;
    decodeUpdate(data, {
      state: (id, s) => {
        this.lastStates++;
        this.seen.set(id, { x: s.x, z: s.z });
      },
      gone: (id) => {
        this.gone.push(id);
        this.seen.delete(id);
      },
      emote: (id, k) => this.emotes.push([id, k]),
    });
  }
}

let clock = 0;

function join(zone: ZoneCore, id: number, x: number, z: number): { peer: Peer; client: Client } {
  const client = new Client();
  const peer = zone.join(id, client, clock) as Peer;
  expect(typeof peer).toBe('object');
  move(zone, peer, x, z);
  return { peer, client };
}

function move(zone: ZoneCore, peer: Peer, x: number, z: number): void {
  clock += 1000;
  expect(zone.receive(peer, encodeState({ x, z, y: 0, yaw: 0, mode: 0 }), clock)).toBe(0);
}

describe('zone server', () => {
  it('tells players about each other, and says nothing while nothing changes', () => {
    const zone = new ZoneCore(0, 0);
    const a = join(zone, 1, 100, 100), b = join(zone, 2, 110, 100);
    zone.tick();
    expect([...a.client.seen.keys()]).toEqual([2]);
    expect([...b.client.seen.keys()]).toEqual([1]);
    expect(zone.dirty).toBe(false);
    const sends = a.client.sends;
    zone.tick();
    expect(a.client.sends).toBe(sends);
    move(zone, b.peer, 112, 100);
    zone.tick();
    expect(a.client.seen.get(2)?.x).toBe(112);
    expect(b.client.sends).toBe(1);
  });

  it('only sends players within sight, and forgets those who leave it or the zone', () => {
    const zone = new ZoneCore(0, 0);
    const a = join(zone, 1, 100, 100);
    const far = join(zone, 2, 100 + SEE + 5, 100);
    zone.tick();
    expect(a.client.seen.size).toBe(0);
    move(zone, far.peer, 100 + SEE - 5, 100);
    zone.tick();
    expect(a.client.seen.has(2)).toBe(true);
    zone.leave(far.peer);
    expect(zone.dirty).toBe(true);
    zone.tick();
    expect(a.client.gone).toEqual([2]);
  });

  it('shows who stands in the zone to watchers across its edge, but not the watchers', () => {
    const zone = new ZoneCore(0, 0);
    const inside = join(zone, 1, ZONE - 20, 500);
    const across = join(zone, 2, ZONE + 20, 500);
    zone.tick();
    expect(across.client.seen.has(1)).toBe(true);
    expect(inside.client.seen.has(2)).toBe(false);
  });

  it('sends each client only the nearest players in a crowd', () => {
    const zone = new ZoneCore(0, 0);
    const me = join(zone, 1, 500, 500);
    for (let k = 0; k < 80; k++) join(zone, 100 + k, 500 + 1 + k, 500);
    zone.tick();
    expect(me.client.seen.size).toBe(MAX_SEEN);
    expect(Math.max(...[...me.client.seen.values()].map((s) => s.x))).toBe(500 + MAX_SEEN);
  });

  it('passes emotes to those in sight, at most one per gap', () => {
    const zone = new ZoneCore(0, 0);
    const a = join(zone, 1, 100, 100), b = join(zone, 2, 105, 100);
    zone.tick();
    expect(zone.receive(a.peer, encodeEmote(0), clock)).toBe(0);
    expect(zone.receive(a.peer, encodeEmote(1), clock + 10)).toBe(0);
    zone.tick();
    expect(b.client.emotes).toEqual([[1, 0]]);
    expect(a.client.emotes).toEqual([]);
    expect(zone.receive(a.peer, encodeEmote(2), clock + EMOTE_GAP_MS + 1)).toBe(0);
    zone.tick();
    expect(b.client.emotes).toEqual([[1, 0], [1, 2]]);
  });

  it('turns away a full room, a taken id, bad messages and floods', () => {
    const zone = new ZoneCore(0, 0, 2);
    const a = join(zone, 1, 10, 10);
    expect(zone.join(1, new Client(), clock)).toBe(CLOSE_TAKEN);
    join(zone, 2, 20, 20);
    expect(zone.join(3, new Client(), clock)).toBe(CLOSE_FULL);
    expect(zone.receive(a.peer, new Uint8Array([9, 9]).buffer, clock + 5000)).toBe(CLOSE_BAD);
    let code = 0;
    for (let k = 0; k < 200 && code === 0; k++) code = zone.receive(a.peer, encodeState({ x: 10, z: 10, y: 0, yaw: 0, mode: 0 }), clock + 5000);
    expect(code).toBe(CLOSE_FLOOD);
  });

  it('rebuilds after sleeping from what each socket saved, and resends everything', () => {
    const zone = new ZoneCore(0, 0);
    const a = new Client(), b = new Client();
    zone.restore(1, a, [100, 100, 0, 0, 0], clock);
    zone.restore(2, b, [104, 100, 0, 0, 0], clock);
    zone.tick();
    expect(a.seen.has(2) && b.seen.has(1)).toBe(true);
  });

  it('keeps a full room of moving players cheap', () => {
    const zone = new ZoneCore(0, 0);
    const peers: Peer[] = [];
    for (let k = 0; k < 250; k++) peers.push(join(zone, k + 1, 400 + (k % 16) * 4, 400 + Math.floor(k / 16) * 4).peer);
    zone.tick();
    const t0 = performance.now();
    for (let round = 0; round < 10; round++) {
      for (const p of peers) move(zone, p, p.x + 0.5, p.z);
      zone.tick();
    }
    const perTick = (performance.now() - t0) / 10;
    expect(perTick).toBeLessThan(50);
  });
});
