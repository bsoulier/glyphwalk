import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Online, Remote } from '../../src/net/online';
import { CLOSE_FULL, SEND_MS, ZONE, decodeState, encodeRefusal, encodeStats, encodeUpdate } from '../../src/net/protocol';

/** Just enough of a browser WebSocket to drive the client by hand. */
class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = '';
  readonly sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string | ArrayBuffer): void {
    this.sent.push(d);
  }
  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code });
  }
  param(k: string): string | null {
    return new URL(this.url).searchParams.get(k);
  }
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe('other players on screen', () => {
  it('slides between samples, and cuts on a teleport', () => {
    const r = new Remote(5);
    r.push(1000, { x: 0, z: 0, y: 0, yaw: 0, mode: 0 });
    r.push(1200, { x: 2, z: 0, y: 0, yaw: 0, mode: 0 });
    r.sample(1100, 0.016);
    expect(r.x).toBeCloseTo(1);
    r.sample(5000, 0.016);
    expect(r.x).toBe(2);
    r.push(1400, { x: 300, z: 0, y: 0, yaw: 0, mode: 0 });
    r.sample(1300, 0.016);
    expect(r.x).toBe(300);
  });

  it('turns the short way round', () => {
    const r = new Remote(5);
    r.push(0, { x: 0, z: 0, y: 0, yaw: Math.PI * 2 - 0.1, mode: 0 });
    r.push(200, { x: 0, z: 0, y: 0, yaw: 0.1, mode: 0 });
    r.sample(100, 0.016);
    expect(Math.cos(r.yaw)).toBeCloseTo(1, 3);
  });

  it('starts a move from where someone stood still', () => {
    const r = new Remote(5);
    r.push(0, { x: 0, z: 0, y: 0, yaw: 0, mode: 0 });
    r.push(10000, { x: 1, z: 0, y: 0, yaw: 0, mode: 0 });
    r.sample(10000 - SEND_MS / 2, 0.016);
    expect(r.x).toBeCloseTo(0.5);
  });
});

describe('online connections', () => {
  const me = { x: ZONE / 2, z: ZONE / 2, y: 0, yaw: 0, mode: 0 };

  it('joins the zone the player is in, and both zones near an edge', () => {
    const net = new Online('wss://example.test', 1337, 42);
    net.update(0, me, true, true);
    expect(FakeSocket.all.map((s) => [s.param('zx'), s.param('zz'), s.param('seed'), s.param('id')])).toEqual([['0', '0', '1337', '42']]);
    net.update(200, { ...me, x: ZONE - 10 }, true, true);
    expect(FakeSocket.all.map((s) => s.param('zx'))).toEqual(['0', '1']);
  });

  it('sends where the player is once connected, and not again while they stand still', () => {
    const net = new Online('wss://example.test', 1, 42);
    net.update(0, me, true, true);
    const ws = FakeSocket.all[0];
    ws.onopen?.();
    net.update(200, me, true, true);
    net.update(400, me, true, true);
    net.update(600, me, true, true);
    const states = ws.sent.filter((d) => d instanceof ArrayBuffer);
    expect(states).toHaveLength(1);
    const s = { x: 0, z: 0, y: 0, yaw: 0, mode: 0 };
    expect(decodeState(new DataView(states[0] as ArrayBuffer), s)).toBe(true);
    expect(s.x).toBe(ZONE / 2);
    expect(net.status).toBe('online');
  });

  it('moves to the next copy of a full zone, and keeps the others it hears about', () => {
    const net = new Online('wss://example.test', 1, 42);
    net.update(0, me, true, true);
    FakeSocket.all[0].close(CLOSE_FULL);
    net.update(200, me, true, true);
    const ws = FakeSocket.all[1];
    expect(ws.param('layer')).toBe('1');
    ws.onopen?.();
    ws.onmessage?.({ data: encodeUpdate([{ id: 9, x: 520, z: 512, y: 0, yaw: 0, mode: 0 }], 1, [], 0, [], 0) });
    expect(net.count).toBe(1);
    expect(net.others.get(9)?.name).toMatch(/^[A-Z]+ [A-Z]+$/);
  });

  it('moves on as soon as the server says a zone is full, without waiting for the close', () => {
    const net = new Online('wss://example.test', 1, 42);
    net.update(0, me, true, true);
    const ws = FakeSocket.all[0];
    ws.onopen?.();
    ws.onmessage?.({ data: encodeRefusal(CLOSE_FULL) });
    net.update(200, me, true, true);
    expect(FakeSocket.all.map((s) => s.param('layer'))).toEqual(['0', '1']);
  });

  it('tells its rooms the district when it changes, and keeps the city head count', () => {
    const net = new Online('wss://example.test', 1, 42);
    net.setHood(2);
    net.update(0, me, true, true);
    const ws = FakeSocket.all[0];
    ws.onopen?.();
    net.setHood(2);
    net.setHood(4);
    const hoods = ws.sent.filter((d): d is ArrayBuffer => d instanceof ArrayBuffer && d.byteLength === 2).map((d) => new Uint8Array(d)[1]);
    expect(hoods).toEqual([2, 4]);
    ws.onmessage?.({ data: encodeStats({ total: 12, hoods: [[4, 9], [0, 3]] }) });
    expect(net.city).toEqual({ total: 12, hoods: [[4, 9], [0, 3]] });
  });

  it('lets go of the server while paused or switched off', () => {
    const net = new Online('wss://example.test', 1, 42);
    net.update(0, me, true, true);
    net.update(200, me, true, false);
    expect(FakeSocket.all[0].closed).toBe(true);
    expect(net.status).toBe('paused');
    net.update(400, me, false, true);
    expect(net.status).toBe('off');
    expect(FakeSocket.all).toHaveLength(1);
  });
});
