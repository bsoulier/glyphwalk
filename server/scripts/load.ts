/**
 * Load test: N simulated players walking around one spot (the worst case, everyone at the spawn point),
 * against a running server. Reports connections per layer, traffic, and how long a move takes to reach
 * someone watching.
 *
 *   npx wrangler dev                                        # in server/, or use a deployed URL
 *   node --experimental-strip-types scripts/load.ts         # N=600 SPREAD=60 SECONDS=30 URL=ws://...
 */
import { CLOSE_FULL, PROTOCOL, SEND_MS, ZONE, decodeRefusal, decodeUpdate, encodeState } from '../../src/net/protocol.ts';

const URL = process.env.URL ?? 'ws://127.0.0.1:8787';
const N = Number(process.env.N ?? 600);
const SPREAD = Number(process.env.SPREAD ?? 60);
const SECONDS = Number(process.env.SECONDS ?? 30);
const SEED = 424242;
const X0 = ZONE / 2, Z0 = ZONE / 2;

interface Bot {
  id: number;
  x: number;
  z: number;
  yaw: number;
  layer: number;
  ws: WebSocket | null;
  open: boolean;
}

const bots: Bot[] = [];
const closes = new Map<number, number>();
let messages = 0, entries = 0, bytes = 0, maxEntries = 0;
const latencies: number[] = [];
let probeFlipAt = 0, probeAway = false;

function connect(b: Bot, watcher = false): void {
  const zx = Math.floor(b.x / ZONE), zz = Math.floor(b.z / ZONE);
  const ws = new WebSocket(`${URL}/zone?v=${PROTOCOL}&seed=${SEED}&zx=${zx}&zz=${zz}&layer=${b.layer}&id=${b.id}`);
  ws.binaryType = 'arraybuffer';
  b.ws = ws;
  ws.onopen = () => {
    b.open = true;
    ws.send(encodeState({ x: b.x, z: b.z, y: 0, yaw: b.yaw, mode: 0 }));
  };
  ws.onmessage = (e) => {
    if (!(e.data instanceof ArrayBuffer)) return;
    const refused = decodeRefusal(e.data);
    if (refused) {
      ws.onclose = null;
      ws.close();
      b.open = false;
      closes.set(refused, (closes.get(refused) ?? 0) + 1);
      if (refused === CLOSE_FULL) {
        b.layer++;
        connect(b, watcher);
      }
      return;
    }
    messages++;
    bytes += e.data.byteLength;
    let n = 0;
    decodeUpdate(e.data, {
      state: (id, s) => {
        n++;
        // The watcher times how long the probe's jumps take to arrive.
        if (watcher && id === bots[0].id && probeFlipAt > 0 && (s.x > X0 + 0.5) === probeAway) {
          latencies.push(performance.now() - probeFlipAt);
          probeFlipAt = 0;
        }
      },
      gone: () => undefined,
      emote: () => undefined,
    });
    entries += n;
    maxEntries = Math.max(maxEntries, n);
  };
  ws.onclose = (e) => {
    b.open = false;
    b.ws = null;
    closes.set(e.code, (closes.get(e.code) ?? 0) + 1);
    if (e.code === CLOSE_FULL) {
      b.layer++;
      connect(b, watcher);
    }
  };
}

function bot(k: number, x: number, z: number): Bot {
  const b: Bot = { id: 1000 + k, x, z, yaw: Math.random() * Math.PI * 2, layer: 0, ws: null, open: false };
  bots.push(b);
  return b;
}

// The probe and its watcher join first, so they share layer 0.
connect(bot(0, X0, Z0));
connect(bot(1, X0 + 5, Z0), true);
await new Promise((r) => setTimeout(r, 500));
for (let k = 2; k < N; k++) {
  connect(bot(k, X0 + (Math.random() - 0.5) * SPREAD, Z0 + (Math.random() - 0.5) * SPREAD));
  if (k % 50 === 0) await new Promise((r) => setTimeout(r, 50));
}

const walk = setInterval(() => {
  for (const b of bots.slice(2)) {
    if (!b.open || !b.ws) continue;
    if (Math.random() < 0.05) b.yaw += (Math.random() - 0.5) * 2;
    b.x += Math.sin(b.yaw) * 1.4 * (SEND_MS / 1000);
    b.z += Math.cos(b.yaw) * 1.4 * (SEND_MS / 1000);
    // Stay near the spot, so the crowd stays a crowd.
    if (Math.hypot(b.x - X0, b.z - Z0) > SPREAD) b.yaw = Math.atan2(X0 - b.x, Z0 - b.z);
    b.ws.send(encodeState({ x: b.x, z: b.z, y: 0, yaw: b.yaw, mode: 0 }));
  }
}, SEND_MS);

const probe = setInterval(() => {
  const p = bots[0];
  if (!p.open || !p.ws) return;
  probeAway = !probeAway;
  probeFlipAt = performance.now();
  p.ws.send(encodeState({ x: X0 + (probeAway ? 1 : 0), z: Z0, y: 0, yaw: 0, mode: 0 }));
}, 1000);

let lastMessages = 0, lastBytes = 0;
const report = setInterval(() => {
  const layers = new Map<number, number>();
  let open = 0;
  for (const b of bots) {
    if (!b.open) continue;
    open++;
    layers.set(b.layer, (layers.get(b.layer) ?? 0) + 1);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? NaN, p95 = sorted[Math.floor(sorted.length * 0.95)] ?? NaN;
  console.log(
    `open ${open}/${N}  layers ${[...layers].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join(' ')}  `
    + `recv ${((messages - lastMessages) / 5).toFixed(0)} msg/s ${((bytes - lastBytes) / 5 / 1024).toFixed(0)} KB/s  `
    + `entries avg ${(entries / Math.max(1, messages)).toFixed(1)} max ${maxEntries}  `
    + `move->seen p50 ${p50.toFixed(0)} ms p95 ${p95.toFixed(0)} ms  closes ${JSON.stringify(Object.fromEntries(closes))}`,
  );
  lastMessages = messages;
  lastBytes = bytes;
}, 5000);

setTimeout(() => {
  clearInterval(walk);
  clearInterval(probe);
  clearInterval(report);
  for (const b of bots) b.ws?.close(1000);
  setTimeout(() => process.exit(0), 500);
}, SECONDS * 1000);
