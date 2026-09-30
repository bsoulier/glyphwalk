import { DurableObject } from 'cloudflare:workers';
import { playerName } from '../../src/net/names';
import {
  CLOSE_BAD, CLOSE_FLOOD, CLOSE_FULL, CLOSE_OUTDATED, CLOSE_TAKEN, type CityStats, MAX_LAYERS, PROTOCOL, TICK_MS, ZONE,
  encodeRefusal, encodeStats,
} from '../../src/net/protocol';
import { HOODS } from '../../src/world/hoods';
import { type RoomCount, StatsCore } from './stats';
import { type Link, type Peer, ZoneCore } from './zone';

interface Env {
  ZONES: DurableObjectNamespace<Zone>;
  STATS: DurableObjectNamespace<Stats>;
  /** Comma-separated page origins allowed to connect, or `*`. */
  ALLOWED_ORIGINS: string;
}

/** What each socket keeps across hibernation: who it is, its room, and its last state. */
interface Saved {
  id: number;
  seed: number;
  zx: number;
  zz: number;
  layer: number;
  s?: number[];
}

/** After this long without changes, positions are saved so the room can sleep. */
const IDLE_SAVE_MS = 2000;
/** An occupied room reports its head count this often, and this soon after someone arrives, leaves or moves on. */
const REPORT_MS = 45_000;
const REPORT_SOON_MS = 5000;
/** How long the public /stats answer is cached at the edge. */
const STATS_CACHE_S = 30;
const DEBUG_CACHE_S = 5;
/** Players listed in one room's log line; the counts cover everyone. */
const LOG_PLAYERS = 20;

const CLOSE_NAMES: Record<number, string> = {
  [CLOSE_FULL]: 'full', [CLOSE_TAKEN]: 'id taken', [CLOSE_BAD]: 'bad message', [CLOSE_FLOOD]: 'flood', [CLOSE_OUTDATED]: 'outdated page',
  1000: 'closed', 1001: 'page left', 1005: 'no code', 1006: 'dropped',
};

/**
 * One line of the server's log, seen live with `npx wrangler tail` and kept a few days by Workers Logs.
 * Only random names, rooms, counts and distances: never an address or a position.
 */
function log(ev: string, fields: Record<string, unknown>): void {
  console.log({ ev, ...fields });
}

/** Why a page closes a connection itself, as it says in the close frame (see `Online` in src/net/online.ts). */
const CLIENT_REASONS = new Set(['away', 'online off', 'out of range', 'new name', 'no pong']);

function closeName(code: number): string {
  return CLOSE_NAMES[code] ?? String(code);
}

function linkTo(ws: WebSocket): Link {
  return {
    send(data) {
      try {
        ws.send(data);
      } catch {
        // Closing sockets throw; their close handler removes them.
      }
    },
  };
}

function statsFor(env: Env, seed: number): DurableObjectStub<Stats> {
  return env.STATS.get(env.STATS.idFromName(`stats/${seed}`));
}

/**
 * One zone of one city (world seed), in one layer. Uses the hibernation API: sockets stay open while
 * the object sleeps, pings are answered without waking it, and state is rebuilt from the sockets.
 */
export class Zone extends DurableObject<Env> {
  private core: ZoneCore | null = null;
  private seed = 0;
  private layer = 0;
  private readonly peers = new Map<WebSocket, Peer>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTick = 0;
  private reportDue = false;
  /** When the pending report alarm goes off. */
  private alarmAt = 0;
  /** The city holds a count from this room, which it must take back once nobody stands here. */
  private reported = false;
  /** The city's head count as last heard, ready to send to newcomers. */
  private city: ArrayBuffer | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const now = Date.now();
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Saved | null;
      if (!a) continue;
      const p = this.room(a).restore(a.id, linkTo(ws), a.s ?? null, now);
      if (p) this.peers.set(ws, p);
    }
    // Woken with people standing in it, it has most likely reported them; if not, clearing an absent entry is harmless.
    this.reported = (this.core?.count().length ?? 0) > 0;
  }

  private room(a: { seed: number; zx: number; zz: number; layer: number }): ZoneCore {
    if (!this.core) {
      this.core = new ZoneCore(a.zx, a.zz);
      this.seed = a.seed;
      this.layer = a.layer;
    }
    return this.core;
  }

  /** "seed/zx/zz/layer", as the room is named. */
  private get key(): string {
    return this.core ? `${this.seed}/${this.core.zx}/${this.core.zz}/${this.layer}` : '?';
  }

  async fetch(req: Request): Promise<Response> {
    const q = new URL(req.url).searchParams;
    const at = { seed: Number(q.get('seed')), zx: Number(q.get('zx')), zz: Number(q.get('zz')), layer: Number(q.get('layer')) };
    const id = Number(q.get('id'));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    // Refusals go through the socket: browsers only show a WebSocket's close code, never an HTTP status.
    const res = Number(q.get('v')) !== PROTOCOL ? CLOSE_OUTDATED : this.room(at).join(id, linkTo(server), Date.now());
    const room = `${at.seed}/${at.zx}/${at.zz}/${at.layer}`;
    if (typeof res === 'number') {
      server.send(encodeRefusal(res));
      server.close(res, 'refused');
      log('refused', { room, name: playerName(id), why: closeName(res), v: q.get('v') });
    } else {
      server.serializeAttachment({ id, ...at } satisfies Saved);
      this.peers.set(server, res);
      log('join', { room, name: playerName(id), peers: this.peers.size });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const p = this.peers.get(ws);
    if (!p || !this.core) return;
    const placed = p.placed;
    const code = typeof msg === 'string' ? CLOSE_BAD : this.core.receive(p, msg, Date.now());
    if (code) {
      this.drop(ws, closeName(code));
      ws.close(code, 'closed');
      return;
    }
    if (!placed && p.placed) {
      log('placed', { room: this.key, name: playerName(p.id), here: p.home });
      // Newcomers hear the city's head count at once rather than at the next report.
      if (this.city) linkTo(ws).send(this.city);
    }
    this.schedule();
    this.countSoon();
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Pages say why they let go; only those words are logged, since anyone can send any text.
    this.drop(ws, CLIENT_REASONS.has(reason) ? `${closeName(code)}: ${reason}` : closeName(code));
    try {
      ws.close(code >= 3000 && code < 5000 ? code : 1000, 'bye');
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws: WebSocket): void {
    this.drop(ws, 'error');
  }

  private drop(ws: WebSocket, why: string): void {
    const p = this.peers.get(ws);
    if (!p) return;
    this.peers.delete(ws);
    this.core?.leave(p);
    log('leave', { room: this.key, name: playerName(p.id), why, peers: this.peers.size });
    this.schedule();
    // The last one out tells the city straight away: an empty room may be gone before any alarm.
    if (this.peers.size === 0 && this.reported) void this.report();
    else this.countSoon();
  }

  /** Ticks right away when the last tick is long enough ago, else when it will be: at most one per TICK_MS. */
  private schedule(): void {
    if (this.tickTimer !== null || !this.core?.dirty) return;
    const wait = this.lastTick + TICK_MS - Date.now();
    if (wait <= 0) this.tick();
    else {
      this.tickTimer = setTimeout(() => {
        this.tickTimer = null;
        this.tick();
      }, wait);
    }
  }

  private tick(): void {
    this.lastTick = Date.now();
    this.core?.tick();
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), IDLE_SAVE_MS);
  }

  /**
   * An alarm (not a timer) carries the head count, so a sleeping room still reports and then sleeps again.
   * A change brings a far-off regular report forward: a room that emptied and filled again would otherwise
   * keep showing its newcomers the old count for up to REPORT_MS.
   */
  private countSoon(): void {
    if (!this.core?.countChanged) return;
    const at = Date.now() + REPORT_SOON_MS;
    if (this.reportDue && this.alarmAt <= at) return;
    this.reportDue = true;
    this.alarmAt = at;
    void this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    this.reportDue = false;
    if (!this.core || this.peers.size === 0) return;
    await this.report();
    // Only rooms someone stands in keep reporting; one with watchers alone has nothing to count.
    if (this.core.count().length > 0) {
      this.reportDue = true;
      this.alarmAt = Date.now() + REPORT_MS;
      await this.ctx.storage.setAlarm(this.alarmAt);
    }
  }

  private async report(): Promise<void> {
    const core = this.core;
    if (!core) return;
    core.countChanged = false;
    const hoods = core.count();
    if (hoods.length === 0 && !this.reported) return;
    let city: CityStats;
    try {
      const r = await statsFor(this.env, this.seed).report(`${core.zx}/${core.zz}/${this.layer}`, hoods);
      city = { total: r.total, hoods: r.hoods.map(([h, n]): [number, number] => [h, n]) };
    } catch {
      return;
    }
    this.reported = hoods.length > 0;
    const all = core.snapshot();
    log('room', {
      room: this.key, city: city.total, here: all.filter((p) => p.home).length, watching: all.filter((p) => !p.home).length,
      players: all.slice(0, LOG_PLAYERS).map((p) => ({ name: playerName(p.id), here: p.home, sees: p.seen, nearest: p.nearest })),
    });
    const msg = encodeStats(city);
    if (this.city && sameBytes(this.city, msg)) return;
    this.city = msg;
    for (const [ws, p] of this.peers) if (p.placed) linkTo(ws).send(msg);
  }

  /** Saves the positions that changed, once things are quiet, so a woken room knows where everyone is. */
  private save(): void {
    this.saveTimer = null;
    const core = this.core;
    if (!core) return;
    for (const [ws, p] of this.peers) {
      if (!p.unsaved || !p.placed) continue;
      p.unsaved = false;
      try {
        ws.serializeAttachment({
          id: p.id, seed: this.seed, zx: core.zx, zz: core.zz, layer: this.layer, s: [p.x, p.z, p.y, p.yaw, p.mode, p.hood],
        } satisfies Saved);
      } catch {
        // Closed in the meantime.
      }
    }
  }
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  return true;
}

/**
 * Adds up the head counts of every occupied room of one city. The object leaves memory about 10 s after
 * its last call, well within a room's 45 s between reports, so the counts live in its storage too.
 */
export class Stats extends DurableObject<Env> {
  private readonly core = new StatsCore();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      for (const [room, r] of await ctx.storage.list<RoomCount>()) this.core.restore(room, r);
    });
  }

  report(room: string, hoods: [number, number][]): CityStats {
    return this.saved(this.core.report(room, hoods, Date.now()));
  }

  totals(): CityStats {
    return this.saved(this.core.totals(Date.now()));
  }

  rooms(): { room: string; players: number; hoods: [number, number][]; age: number }[] {
    return this.saved(this.core.rooms(Date.now()));
  }

  /** Writes what changed; the reply waits for the writes, so a count is never lost to an eviction. */
  private saved<T>(result: T): T {
    for (const [room, r] of this.core.writes()) void (r ? this.ctx.storage.put(room, r) : this.ctx.storage.delete(room));
    return result;
  }
}

function int(s: string | null, lo: number, hi: number): number | null {
  if (s === null || s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

function allowed(origin: string, list: string): boolean {
  return list.split(',').some((o) => {
    const t = o.trim();
    return t === '*' || t === origin;
  });
}

/** Players online now, in all and per district, as JSON; cached briefly so it costs next to nothing. */
async function publicStats(env: Env, seed: number, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const key = new Request(`https://stats.cache/${seed}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const city = await statsFor(env, seed).totals();
  const body = {
    seed,
    online: city.total,
    districts: Object.fromEntries(city.hoods.map(([h, n]) => [HOODS[h]?.name ?? 'UNKNOWN', n])),
  };
  const res = new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${STATS_CACHE_S}`,
      'access-control-allow-origin': '*',
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/**
 * Which rooms have players standing in them, to see why two players do not meet: a different zone
 * (1 km squares), layer or seed means they cannot see each other. Counts only, cached briefly.
 */
async function debugRooms(env: Env, seed: number, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const key = new Request(`https://debug.cache/${seed}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const rooms = await statsFor(env, seed).rooms();
  const body = {
    seed,
    protocol: PROTOCOL,
    online: rooms.reduce((s, r) => s + r.players, 0),
    rooms: rooms.map((r) => {
      const [zx, zz, layer] = r.room.split('/').map(Number);
      return {
        zone: [zx, zz],
        covers: { x: [zx * ZONE, (zx + 1) * ZONE], z: [zz * ZONE, (zz + 1) * ZONE] },
        layer,
        players: r.players,
        districts: Object.fromEntries(r.hoods.map(([h, n]) => [HOODS[h]?.name ?? 'UNKNOWN', n])),
        reported_s_ago: Math.round(r.age / 1000),
      };
    }),
  };
  const res = new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${DEBUG_CACHE_S}`,
      'access-control-allow-origin': '*',
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const q = url.searchParams;
    if (url.pathname === '/') return new Response('Glyphwalk online server\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/stats' || url.pathname === '/debug') {
      const seed = q.has('seed') ? int(q.get('seed'), 0, 2 ** 31 - 1) : 1337;
      if (seed === null) return new Response('Bad request\n', { status: 400 });
      return url.pathname === '/stats' ? publicStats(env, seed, ctx) : debugRooms(env, seed, ctx);
    }
    if (url.pathname !== '/zone') return new Response('Not found\n', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 });
    // Other sites cannot embed the game's rooms. Tools without an Origin header are let through.
    const origin = req.headers.get('Origin');
    if (origin && !allowed(origin, env.ALLOWED_ORIGINS)) return new Response('Forbidden\n', { status: 403 });
    const seed = int(q.get('seed'), 0, 2 ** 31 - 1);
    const zx = int(q.get('zx'), -10000, 10000), zz = int(q.get('zz'), -10000, 10000);
    const layer = int(q.get('layer'), 0, MAX_LAYERS - 1);
    const id = int(q.get('id'), 1, 2 ** 32 - 1);
    if (seed === null || zx === null || zz === null || layer === null || id === null) return new Response('Bad request\n', { status: 400 });
    const stub = env.ZONES.get(env.ZONES.idFromName(`${seed}/${zx}/${zz}/${layer}`));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
