import type { RGB } from '../world/signs';
import { newOnlineId } from './identity';
import { playerColor, playerName } from './names';
import {
  CLOSE_BAD, CLOSE_FLOOD, CLOSE_FULL, CLOSE_OUTDATED, CLOSE_TAKEN, EMOTE_GAP_MS, MAX_LAYERS, PROTOCOL, type PlayerState,
  SEE, SEND_MS, WATCH_SEND_MS, type UpdateHandler, decodeRefusal, decodeUpdate, encodeEmote, encodeState, yawToByte, zoneOf,
  zonesNear,
} from './protocol';

export type OnlineStatus = 'off' | 'connecting' | 'online' | 'paused' | 'offline' | 'outdated';

/** Others are drawn this far in the past, so there are always two samples to move between. */
const DELAY_MS = 350;
/** A player who went out of sight or left lingers this long, in case another zone picks them up. */
const GONE_MS = 1500;
/** Connect to zones this close, and let go of them only once this far, so edges do not flap. */
const JOIN_R = SEE + 20;
const KEEP_R = SEE + 80;
const PING_MS = 20000;
const PONG_MS = 10000;
/** Jumps longer than this between samples are teleports, drawn as a cut rather than a slide. */
const TELEPORT = 40;
const SAMPLES = 4;
/** Connections and sends are looked after this often, not every frame. */
const RUN_MS = 100;

/** Another player as last heard, with a few timed samples to move smoothly between. */
export class Remote {
  readonly name: string;
  readonly color: RGB;
  private readonly st = new Float64Array(SAMPLES);
  private readonly sx = new Float64Array(SAMPLES);
  private readonly sz = new Float64Array(SAMPLES);
  private readonly sy = new Float64Array(SAMPLES);
  private readonly syaw = new Float64Array(SAMPLES);
  private readonly smode = new Uint8Array(SAMPLES);
  private n = 0;
  /** Where to draw them now (after `sample`). */
  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  mode = 0;
  /** Walk cycle, advanced by how fast they move. */
  phase = 0;
  speed = 0;
  emote = -1;
  emoteAt = 0;
  /** Seconds since the emote, as of the last `visible` call. */
  emoteAge = Infinity;
  /** When they went out of sight (on the clock given to `update`), or 0. */
  goneAt = 0;
  from: object | null = null;

  constructor(readonly id: number) {
    this.name = playerName(id);
    this.color = playerColor(id);
  }

  push(t: number, s: PlayerState): void {
    if (this.n > 0) {
      // After standing still, the move starts from where they stood, not as a slide from long ago.
      const i = (this.n - 1) % SAMPLES;
      if (t - this.st[i] > 1000) this.add(t - SEND_MS, this.sx[i], this.sz[i], this.sy[i], this.syaw[i], this.smode[i]);
    }
    this.add(t, s.x, s.z, s.y, s.yaw, s.mode);
  }

  private add(t: number, x: number, z: number, y: number, yaw: number, mode: number): void {
    const i = this.n % SAMPLES;
    this.st[i] = t; this.sx[i] = x; this.sz[i] = z; this.sy[i] = y; this.syaw[i] = yaw; this.smode[i] = mode;
    this.n++;
  }

  /** Moves the drawn position to time `t` (ms), between the two samples around it. */
  sample(t: number, dt: number): void {
    if (this.n === 0) return;
    // a: the newest sample at or before t; b: the one after it, if any.
    let a = -1, b = -1;
    for (let k = 0; k < Math.min(this.n, SAMPLES); k++) {
      const i = (this.n - 1 - k) % SAMPLES;
      if (this.st[i] <= t) {
        a = i;
        break;
      }
      b = i;
    }
    const px = this.x, pz = this.z;
    if (a < 0) this.set(b, b, 1);
    else if (b < 0) this.set(a, a, 1);
    else {
      const jump = Math.hypot(this.sx[b] - this.sx[a], this.sz[b] - this.sz[a]) > TELEPORT;
      this.set(a, b, jump ? 1 : (t - this.st[a]) / (this.st[b] - this.st[a]));
    }
    const moved = Math.hypot(this.x - px, this.z - pz);
    this.speed = dt > 0 && moved < TELEPORT ? moved / dt : 0;
    this.phase += this.speed * dt * 5;
  }

  private set(a: number, b: number, f: number): void {
    this.x = this.sx[a] + (this.sx[b] - this.sx[a]) * f;
    this.z = this.sz[a] + (this.sz[b] - this.sz[a]) * f;
    this.y = this.sy[a] + (this.sy[b] - this.sy[a]) * f;
    let d = this.syaw[b] - this.syaw[a];
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    this.yaw = this.syaw[a] + d * f;
    this.mode = this.smode[f < 0.5 ? a : b];
  }
}

/** One connection, to one zone around the player. */
class ZoneLink {
  ws: WebSocket | null = null;
  open = false;
  layer = 0;
  retryAt = 0;
  backoff = 1000;
  openedAt = 0;
  lastSend = 0;
  wasHome = false;
  sent: PlayerState | null = null;
  pingAt = 0;
  pongDue = 0;

  constructor(readonly zx: number, readonly zz: number) {}

  get key(): string {
    return `${this.zx},${this.zz}`;
  }
}

function sameState(a: PlayerState, b: PlayerState): boolean {
  return Math.abs(a.x - b.x) < 0.03 && Math.abs(a.z - b.z) < 0.03 && Math.abs(a.y - b.y) < 0.05
    && yawToByte(a.yaw) === yawToByte(b.yaw) && a.mode === b.mode;
}

/**
 * The client side of playing online: one WebSocket per zone near the player (usually one or two),
 * sending where the player is while they move, and keeping the others who are in sight.
 */
export class Online {
  status: OnlineStatus = 'connecting';
  readonly others = new Map<number, Remote>();
  /** Someone in sight sent an emote. */
  onEmote: ((r: Remote, k: number) => void) | null = null;
  /** The server gave our id to someone else (two tabs), so a new one was drawn. */
  onNewId: ((id: number) => void) | null = null;
  private readonly links = new Map<string, ZoneLink>();
  private lastEmote = -Infinity;
  private lastRun = -Infinity;
  /** The time given to the last `update`; socket events are stamped with it. */
  private clock = 0;
  private homeKey = '';
  private readonly list: Remote[] = [];

  constructor(private readonly url: string, private readonly seed: number, private id: number) {}

  get myId(): number {
    return this.id;
  }

  /** Takes a new id, and so a new name, reconnecting under it. */
  setId(id: number): void {
    this.id = id;
    for (const link of this.links.values()) link.ws?.close(1000);
  }

  /** Players in sight (not counting ones that just went). */
  get count(): number {
    let n = 0;
    for (const r of this.others.values()) if (r.goneAt === 0) n++;
    return n;
  }

  /**
   * Call every frame with performance.now(). `on` is false when playing online is switched off, `active`
   * when the page is hidden or the player idle: either way the connections close, so an idle tab costs
   * the server nothing.
   */
  update(now: number, self: PlayerState, on: boolean, active: boolean): void {
    this.clock = now;
    if (this.status === 'outdated') return;
    if (!on || !active) {
      this.closeAll();
      this.status = on ? 'paused' : 'off';
      return;
    }
    if (now - this.lastRun < RUN_MS) return;
    this.lastRun = now;
    const keep = new Set(zonesNear(self.x, self.z, KEEP_R).map(([a, b]) => `${a},${b}`));
    for (const [key, link] of this.links) {
      if (!keep.has(key)) this.dropLink(link);
    }
    for (const [zx, zz] of zonesNear(self.x, self.z, JOIN_R)) {
      const key = `${zx},${zz}`;
      if (!this.links.has(key)) this.links.set(key, new ZoneLink(zx, zz));
    }
    this.homeKey = `${zoneOf(self.x)},${zoneOf(self.z)}`;
    let open = 0;
    for (const link of this.links.values()) {
      if (!link.ws && now >= link.retryAt) this.connect(link, now);
      if (!link.open || !link.ws) continue;
      open++;
      if (link.pongDue > 0 && now > link.pongDue) {
        link.ws.close();
        continue;
      }
      if (now - link.pingAt > PING_MS) {
        link.ws.send('ping');
        link.pingAt = now;
        link.pongDue = now + PONG_MS;
      }
      const home = link.key === this.homeKey;
      // The zone just left must hear it at once, or it would keep showing us at its edge.
      const leaving = link.wasHome && !home;
      const due = now - link.lastSend >= (home ? SEND_MS : WATCH_SEND_MS);
      if (leaving || (due && (!link.sent || !sameState(link.sent, self)))) {
        link.ws.send(encodeState(self));
        link.sent = { ...self };
        link.lastSend = now;
        link.wasHome = home;
      }
    }
    for (const [id, r] of this.others) if (r.goneAt > 0 && now - r.goneAt > GONE_MS) this.others.delete(id);
    let trying = false;
    for (const link of this.links.values()) if (link.ws) trying = true;
    this.status = open > 0 ? 'online' : trying ? 'connecting' : 'offline';
  }

  /** Sends an emote to the zone the player stands in; false if it is too soon after the last one. */
  emote(k: number, now: number): boolean {
    if (now - this.lastEmote < EMOTE_GAP_MS) return false;
    const link = this.links.get(this.homeKey);
    if (!link?.open || !link.ws) return false;
    link.ws.send(encodeEmote(k));
    this.lastEmote = now;
    return true;
  }

  /** The others moved to where they are drawn now, nearest first and at most `max` of them. */
  visible(now: number, dt: number, x: number, z: number, max: number): readonly Remote[] {
    const list = this.list;
    list.length = 0;
    for (const r of this.others.values()) {
      r.sample(now - DELAY_MS, dt);
      r.emoteAge = r.emote >= 0 ? (now - r.emoteAt) / 1000 : Infinity;
      list.push(r);
    }
    if (list.length > max) {
      list.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
      list.length = max;
    }
    return list;
  }

  private connect(link: ZoneLink, now: number): void {
    const q = `v=${PROTOCOL}&seed=${this.seed}&zx=${link.zx}&zz=${link.zz}&layer=${link.layer}&id=${this.id}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.url}/zone?${q}`);
    } catch {
      link.retryAt = now + 30000;
      return;
    }
    ws.binaryType = 'arraybuffer';
    link.ws = ws;
    link.open = false;
    const handler: UpdateHandler = {
      state: (id, s) => {
        if (id === this.id) return;
        let r = this.others.get(id);
        if (!r) {
          r = new Remote(id);
          this.others.set(id, r);
        }
        r.push(this.clock, s);
        r.from = link;
        r.goneAt = 0;
      },
      gone: (id) => {
        const r = this.others.get(id);
        if (r && r.from === link) r.goneAt = this.clock;
      },
      emote: (id, k) => {
        const r = this.others.get(id);
        if (!r) return;
        r.emote = k;
        r.emoteAt = this.clock;
        this.onEmote?.(r, k);
      },
    };
    ws.onopen = () => {
      const t = this.clock;
      link.open = true;
      link.openedAt = t;
      link.pingAt = t;
      link.pongDue = 0;
      link.sent = null;
      link.lastSend = 0;
      link.wasHome = false;
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        if (e.data === 'pong') link.pongDue = 0;
        return;
      }
      if (!(e.data instanceof ArrayBuffer)) return;
      const refused = decodeRefusal(e.data);
      if (refused === 0) {
        decodeUpdate(e.data, handler);
        return;
      }
      ws.onclose = null;
      ws.close();
      this.closed(link, refused);
    };
    ws.onclose = (e: CloseEvent) => this.closed(link, e.code);
  }

  private closed(link: ZoneLink, code: number): void {
    const now = this.clock;
    const lasted = link.open ? now - link.openedAt : 0;
    link.ws = null;
    link.open = false;
    for (const r of this.others.values()) if (r.from === link && r.goneAt === 0) r.goneAt = now;
    // Links dropped on purpose stay dropped.
    if (this.links.get(link.key) !== link) return;
    switch (code) {
      case CLOSE_FULL:
        // Full: try the next copy of this zone straight away, and after the last one wait a while.
        link.layer++;
        if (link.layer >= MAX_LAYERS) {
          link.layer = 0;
          link.retryAt = now + 60000;
        } else link.retryAt = now;
        return;
      case CLOSE_TAKEN:
        this.id = newOnlineId();
        this.onNewId?.(this.id);
        link.retryAt = now;
        for (const other of this.links.values()) other.ws?.close(1000);
        return;
      case CLOSE_OUTDATED:
        this.status = 'outdated';
        this.closeAll();
        return;
      case CLOSE_BAD:
      case CLOSE_FLOOD:
        link.retryAt = now + 60000;
        return;
    }
    if (lasted > 10000) link.backoff = 1000;
    link.retryAt = now + link.backoff * (0.5 + Math.random());
    link.backoff = Math.min(30000, link.backoff * 2);
  }

  private dropLink(link: ZoneLink): void {
    this.links.delete(link.key);
    link.ws?.close(1000);
  }

  private closeAll(): void {
    for (const link of [...this.links.values()]) this.dropLink(link);
    this.others.clear();
  }
}
