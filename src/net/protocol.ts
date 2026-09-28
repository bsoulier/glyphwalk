/**
 * Wire format shared by the game and the online server (server/). Everything is little-endian binary:
 * a player's state is 13 bytes up and 16 bytes down, so a busy street costs a few KB/s.
 *
 * The city itself is never sent: it is a pure function of the world seed, so players only exchange
 * where they are. Nothing a player sends is free text, which leaves nothing to moderate.
 */

/** Bumped on any incompatible change; the server turns older pages away with CLOSE_OUTDATED. */
export const PROTOCOL = 1;
/** Side of a zone, in metres. Each zone is one server room; a client joins the few around it. */
export const ZONE = 1024;
/** How far players see each other, in metres. */
export const SEE = 150;
/** Most other players one client is sent, nearest first. */
export const MAX_SEEN = 48;
/** Most connections one zone room takes; later ones go to a parallel copy of the zone (a layer). */
export const MAX_PEERS = 250;
export const MAX_LAYERS = 32;
/** The server batches what changed and sends it this often, only while something is changing. */
export const TICK_MS = 100;
/** A client sends its state this often to the zone it stands in while it moves. */
export const SEND_MS = 200;
/** Zones a client only watches (it stands near their edge) hear where it is this often. */
export const WATCH_SEND_MS = 1000;
/** Shortest gap between two emotes from one player. */
export const EMOTE_GAP_MS = 2000;
/** Camera modes, in the order of MODES in game/player.ts. */
export const MODE_COUNT = 6;
export const MODE_WALK = 0, MODE_FLY = 1, MODE_CCTV = 2, MODE_TAXI = 3, MODE_SKY = 4, MODE_RAIL = 5;

// Client to server.
export const C_STATE = 1;
export const C_EMOTE = 2;
export const STATE_BYTES = 13;
export const EMOTE_BYTES = 2;
// Server to client.
export const S_UPDATE = 1;
export const S_REFUSED = 2;
const ENTRY_BYTES = 16;

/** WebSocket close codes the server uses; the client reacts to each differently. */
export const CLOSE_FULL = 4001;
export const CLOSE_TAKEN = 4002;
export const CLOSE_BAD = 4003;
export const CLOSE_FLOOD = 4008;
export const CLOSE_OUTDATED = 4009;

/** Where a player is: `y` is the height of their feet, `mode` an index in MODES. */
export interface PlayerState {
  x: number;
  z: number;
  y: number;
  yaw: number;
  mode: number;
}

/** Highest feet height sent, in metres (the Glyph Tower's deck is under 500 m). */
const MAX_Y = 6000;
/** Farther than anyone walks or flies; guards against garbage turning into huge numbers. */
const MAX_XZ = 1e7;

/** Zone index along one axis. Uses the float32 value that goes on the wire, so both ends agree. */
export function zoneOf(v: number): number {
  return Math.floor(Math.fround(v) / ZONE);
}

/** Zones overlapping the square of half-side `r` around (x, z), as [zx, zz] pairs. */
export function zonesNear(x: number, z: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let zx = zoneOf(x - r); zx <= zoneOf(x + r); zx++) {
    for (let zz = zoneOf(z - r); zz <= zoneOf(z + r); zz++) out.push([zx, zz]);
  }
  return out;
}

export function yawToByte(yaw: number): number {
  const t = yaw / (Math.PI * 2);
  return Math.round((t - Math.floor(t)) * 256) & 255;
}

export function byteToYaw(b: number): number {
  return (b / 256) * Math.PI * 2;
}

export function encodeState(s: PlayerState): ArrayBuffer {
  const buf = new ArrayBuffer(STATE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, C_STATE);
  v.setFloat32(1, s.x, true);
  v.setFloat32(5, s.z, true);
  v.setUint16(9, Math.max(0, Math.min(MAX_Y, Math.round(s.y * 10))), true);
  v.setUint8(11, yawToByte(s.yaw));
  v.setUint8(12, s.mode);
  return buf;
}

export function encodeEmote(k: number): ArrayBuffer {
  const buf = new ArrayBuffer(EMOTE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, C_EMOTE);
  v.setUint8(1, k);
  return buf;
}

/**
 * Reads a state message into `into`, keeping `y` in decimetres and `yaw` as a byte, as the server
 * forwards them. False if it is malformed or out of range.
 */
export function decodeState(v: DataView, into: PlayerState): boolean {
  if (v.byteLength !== STATE_BYTES || v.getUint8(0) !== C_STATE) return false;
  const x = v.getFloat32(1, true), z = v.getFloat32(5, true);
  const y = v.getUint16(9, true), mode = v.getUint8(12);
  if (!(Math.abs(x) < MAX_XZ && Math.abs(z) < MAX_XZ) || y > MAX_Y || mode >= MODE_COUNT) return false;
  into.x = x;
  into.z = z;
  into.y = y;
  into.yaw = v.getUint8(11);
  into.mode = mode;
  return true;
}

/** Emote index from an emote message, or -1. */
export function decodeEmote(v: DataView): number {
  if (v.byteLength !== EMOTE_BYTES || v.getUint8(0) !== C_EMOTE) return -1;
  const k = v.getUint8(1);
  return k < EMOTES.length ? k : -1;
}

/** One entry of an update, as the server holds it: `y` in decimetres, `yaw` as a byte. */
export interface WireEntry {
  id: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  mode: number;
}

/**
 * An update: players that are new to this client or moved, ids it should forget (gone or out of sight),
 * and emotes from players it can see.
 */
export function encodeUpdate(
  states: readonly WireEntry[], ns: number, gone: readonly number[], ng: number,
  emotes: readonly { id: number; k: number }[], ne: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(7 + ns * ENTRY_BYTES + ng * 4 + ne * 5);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, S_UPDATE); o += 1;
  v.setUint16(o, ns, true); o += 2;
  for (let k = 0; k < ns; k++) {
    const s = states[k];
    v.setUint32(o, s.id, true);
    v.setFloat32(o + 4, s.x, true);
    v.setFloat32(o + 8, s.z, true);
    v.setUint16(o + 12, s.y, true);
    v.setUint8(o + 14, s.yaw);
    v.setUint8(o + 15, s.mode);
    o += ENTRY_BYTES;
  }
  v.setUint16(o, ng, true); o += 2;
  for (let k = 0; k < ng; k++, o += 4) v.setUint32(o, gone[k], true);
  v.setUint16(o, ne, true); o += 2;
  for (let k = 0; k < ne; k++, o += 5) {
    v.setUint32(o, emotes[k].id, true);
    v.setUint8(o + 4, emotes[k].k);
  }
  return buf;
}

/**
 * Sent just before the server closes a socket it will not take (full, taken id, old page), because a
 * close only reaches the page once the closing handshake is over, which can take seconds.
 */
export function encodeRefusal(code: number): ArrayBuffer {
  const buf = new ArrayBuffer(3);
  const v = new DataView(buf);
  v.setUint8(0, S_REFUSED);
  v.setUint16(1, code, true);
  return buf;
}

/** The close code from a refusal, or 0 if this is not one. */
export function decodeRefusal(buf: ArrayBuffer): number {
  const v = new DataView(buf);
  return v.byteLength === 3 && v.getUint8(0) === S_REFUSED ? v.getUint16(1, true) : 0;
}

export interface UpdateHandler {
  state(id: number, s: PlayerState): void;
  gone(id: number): void;
  emote(id: number, k: number): void;
}

const scratch: PlayerState = { x: 0, z: 0, y: 0, yaw: 0, mode: 0 };

/** Reads an update, turning `y` back into metres and `yaw` into radians. False if it is malformed. */
export function decodeUpdate(buf: ArrayBuffer, h: UpdateHandler): boolean {
  const v = new DataView(buf);
  const len = v.byteLength;
  if (len < 7 || v.getUint8(0) !== S_UPDATE) return false;
  let o = 1;
  const ns = v.getUint16(o, true); o += 2;
  if (o + ns * ENTRY_BYTES + 2 > len) return false;
  const statesAt = o;
  o += ns * ENTRY_BYTES;
  const ng = v.getUint16(o, true); o += 2;
  if (o + ng * 4 + 2 > len) return false;
  const goneAt = o;
  o += ng * 4;
  const ne = v.getUint16(o, true); o += 2;
  if (o + ne * 5 !== len) return false;
  for (let k = 0, p = statesAt; k < ns; k++, p += ENTRY_BYTES) {
    scratch.x = v.getFloat32(p + 4, true);
    scratch.z = v.getFloat32(p + 8, true);
    scratch.y = v.getUint16(p + 12, true) / 10;
    scratch.yaw = byteToYaw(v.getUint8(p + 14));
    scratch.mode = v.getUint8(p + 15);
    if (scratch.mode < MODE_COUNT) h.state(v.getUint32(p, true), scratch);
  }
  for (let k = 0, p = goneAt; k < ng; k++, p += 4) h.gone(v.getUint32(p, true));
  for (let k = 0; k < ne; k++, o += 5) {
    const e = v.getUint8(o + 4);
    if (e < EMOTES.length) h.emote(v.getUint32(o, true), e);
  }
  return true;
}

export const ACT_NONE = 0, ACT_WAVE = 1, ACT_CHEER = 2, ACT_SPIN = 3;

/**
 * The only things players can say. Append only: pages skip indices they do not know and the server
 * drops them, so old and new versions mix safely. Texts must use characters in core/charset.ts.
 */
export const EMOTES: readonly { label: string; text: string; act: number }[] = [
  { label: 'hello', text: 'HELLO!', act: ACT_WAVE },
  { label: 'follow me', text: 'FOLLOW ME!', act: ACT_WAVE },
  { label: 'wow', text: 'WOW!', act: ACT_CHEER },
  { label: 'cat here', text: 'CAT HERE!', act: ACT_NONE },
  { label: 'nice view', text: 'NICE VIEW!', act: ACT_CHEER },
  { label: 'dance', text: '~ DANCE ~', act: ACT_SPIN },
  { label: 'meow', text: 'MEOW!', act: ACT_NONE },
  { label: 'bye', text: 'BYE!', act: ACT_WAVE },
];
