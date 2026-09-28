import { DurableObject } from 'cloudflare:workers';
import { CLOSE_BAD, CLOSE_OUTDATED, MAX_LAYERS, PROTOCOL, TICK_MS, encodeRefusal } from '../../src/net/protocol';
import { type Link, type Peer, ZoneCore } from './zone';

interface Env {
  ZONES: DurableObjectNamespace<Zone>;
  /** Comma-separated page origins allowed to connect, or `*`. */
  ALLOWED_ORIGINS: string;
}

/** What each socket keeps across hibernation: who it is, its zone, and its last state. */
interface Saved {
  id: number;
  zx: number;
  zz: number;
  s?: number[];
}

/** After this long without changes, positions are saved so the room can sleep. */
const IDLE_SAVE_MS = 2000;

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

/**
 * One zone of one city (world seed), in one layer. Uses the hibernation API: sockets stay open while
 * the object sleeps, pings are answered without waking it, and state is rebuilt from the sockets.
 */
export class Zone extends DurableObject<Env> {
  private core: ZoneCore | null = null;
  private readonly peers = new Map<WebSocket, Peer>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTick = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const now = Date.now();
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Saved | null;
      if (!a) continue;
      const p = this.zone(a.zx, a.zz).restore(a.id, linkTo(ws), a.s ?? null, now);
      if (p) this.peers.set(ws, p);
    }
  }

  private zone(zx: number, zz: number): ZoneCore {
    this.core ??= new ZoneCore(zx, zz);
    return this.core;
  }

  async fetch(req: Request): Promise<Response> {
    const q = new URL(req.url).searchParams;
    const id = Number(q.get('id')), zx = Number(q.get('zx')), zz = Number(q.get('zz'));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    // Refusals go through the socket: browsers only show a WebSocket's close code, never an HTTP status.
    const res = Number(q.get('v')) !== PROTOCOL ? CLOSE_OUTDATED : this.zone(zx, zz).join(id, linkTo(server), Date.now());
    if (typeof res === 'number') {
      server.send(encodeRefusal(res));
      server.close(res, 'refused');
    } else {
      server.serializeAttachment({ id, zx, zz } satisfies Saved);
      this.peers.set(server, res);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const p = this.peers.get(ws);
    if (!p || !this.core) return;
    const code = typeof msg === 'string' ? CLOSE_BAD : this.core.receive(p, msg, Date.now());
    if (code) {
      this.drop(ws);
      ws.close(code, 'closed');
      return;
    }
    this.schedule();
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

  /** Saves the positions that changed, once things are quiet, so a woken room knows where everyone is. */
  private save(): void {
    this.saveTimer = null;
    const core = this.core;
    if (!core) return;
    for (const [ws, p] of this.peers) {
      if (!p.unsaved || !p.placed) continue;
      p.unsaved = false;
      try {
        ws.serializeAttachment({ id: p.id, zx: core.zx, zz: core.zz, s: [p.x, p.z, p.y, p.yaw, p.mode] } satisfies Saved);
      } catch {
        // Closed in the meantime.
      }
    }
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('Glyphwalk online server\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname !== '/zone') return new Response('Not found\n', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket\n', { status: 426 });
    // Other sites cannot embed the game's rooms. Tools without an Origin header are let through.
    const origin = req.headers.get('Origin');
    if (origin && !allowed(origin, env.ALLOWED_ORIGINS)) return new Response('Forbidden\n', { status: 403 });
    const q = url.searchParams;
    const seed = int(q.get('seed'), 0, 2 ** 31 - 1);
    const zx = int(q.get('zx'), -10000, 10000), zz = int(q.get('zz'), -10000, 10000);
    const layer = int(q.get('layer'), 0, MAX_LAYERS - 1);
    const id = int(q.get('id'), 1, 2 ** 32 - 1);
    if (seed === null || zx === null || zz === null || layer === null || id === null) return new Response('Bad request\n', { status: 400 });
    const stub = env.ZONES.get(env.ZONES.idFromName(`${seed}/${zx}/${zz}/${layer}`));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
