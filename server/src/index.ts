import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_BAD, CLOSE_OUTDATED, type CityStats, MAX_LAYERS, PROTOCOL, TICK_MS, encodeRefusal, encodeStats,
} from '../../src/net/protocol';
import { HOODS } from '../../src/world/hoods';
import { StatsCore } from './stats';
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
    // Woken with people in it, it has most likely reported them; if not, clearing an absent entry is harmless.
    this.reported = this.peers.size > 0;
  }

  private room(a: { seed: number; zx: number; zz: number; layer: number }): ZoneCore {
    if (!this.core) {
      this.core = new ZoneCore(a.zx, a.zz);
      this.seed = a.seed;
      this.layer = a.layer;
    }
    return this.core;
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
    if (typeof res === 'number') {
      server.send(encodeRefusal(res));
      server.close(res, 'refused');
    } else {
      server.serializeAttachment({ id, ...at } satisfies Saved);
      this.peers.set(server, res);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const p = this.peers.get(ws);
    if (!p || !this.core) return;
    const placed = p.placed;
    const code = typeof msg === 'string' ? CLOSE_BAD : this.core.receive(p, msg, Date.now());
    if (code) {
      this.drop(ws);
      ws.close(code, 'closed');
      return;
    }
    // Newcomers hear the city's head count at once rather than at the next report.
    if (!placed && p.placed && this.city) linkTo(ws).send(this.city);
    this.schedule();
    this.countSoon();
  }

  webSocketClose(ws: WebSocket, code: number): void {
    this.drop(ws);
    try {
      ws.close(code >= 3000 && code < 5000 ? code : 1000, 'bye');
    } catch {
      // Already closed.
    }
  }

  webSocketError(ws: WebSocket): void {
    this.drop(ws);
  }

  private drop(ws: WebSocket): void {
    const p = this.peers.get(ws);
    if (!p) return;
    this.peers.delete(ws);
    this.core?.leave(p);
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

  /** An alarm (not a timer) carries the head count, so a sleeping room still reports and then sleeps again. */
  private countSoon(): void {
    if (this.reportDue || !this.core?.countChanged) return;
    this.reportDue = true;
    void this.ctx.storage.setAlarm(Date.now() + REPORT_SOON_MS);
  }

  async alarm(): Promise<void> {
    this.reportDue = false;
    if (!this.core || this.peers.size === 0) return;
    await this.report();
    if (this.peers.size > 0) {
      this.reportDue = true;
      await this.ctx.storage.setAlarm(Date.now() + REPORT_MS);
    }
  }

  private async report(): Promise<void> {
    const core = this.core;
    if (!core) return;
    core.countChanged = false;
    let city: CityStats;
    try {
      const r = await statsFor(this.env, this.seed).report(`${core.zx}/${core.zz}/${this.layer}`, core.count());
      city = { total: r.total, hoods: r.hoods.map(([h, n]): [number, number] => [h, n]) };
    } catch {
      return;
    }
    this.reported = this.peers.size > 0;
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

/** Adds up the head counts of every occupied room of one city. Kept in memory: rooms re-report often. */
export class Stats extends DurableObject<Env> {
  private readonly core = new StatsCore();

  report(room: string, hoods: [number, number][]): CityStats {
    return this.core.report(room, hoods, Date.now());
  }

  totals(): CityStats {
    return this.core.totals(Date.now());
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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const q = url.searchParams;
    if (url.pathname === '/') return new Response('Glyphwalk online server\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/stats') {
      const seed = q.has('seed') ? int(q.get('seed'), 0, 2 ** 31 - 1) : 1337;
      if (seed === null) return new Response('Bad request\n', { status: 400 });
      return publicStats(env, seed, ctx);
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
