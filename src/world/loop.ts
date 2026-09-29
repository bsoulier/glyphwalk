import { hash3 } from '../core/hash';
import { HOODS, hoodAt } from './hoods';
import { LANDMARK_I, LANDMARK_J, P, RAIL_TOP, worldSeed } from './layout';
import { SIGN_TEXTS, TEXT_TOWER } from './signs';

/**
 * The monorail. The city is tiled with square cells of LOOP_BLOCKS blocks, and each cell has one loop
 * line running round it over the roads one block inside its edge: neighbouring loops run side by side
 * two blocks apart and never meet, and nowhere is more than a few blocks from a station. Trains follow
 * one timetable, so where every train is follows from the cell and the clock alone.
 */
export const LOOP_BLOCKS = 12;
export const LOOP_IN = 1;
export const CELL = LOOP_BLOCKS * P;
/** Length of one side, corner to corner. */
export const SIDE = (LOOP_BLOCKS - 2 * LOOP_IN) * P;
/** Radius of the curves at the corners, which stay over the crossroads. */
export const CURVE_R = 16;
const STRAIGHT = SIDE - 2 * CURVE_R;
const ARC = (Math.PI / 2) * CURVE_R;
const SIDE_LEN = STRAIGHT + ARC;
export const LOOP_LEN = 4 * SIDE_LEN;

/** Travel direction along each side; the next side's direction is the inside of the loop. */
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const CORNERS: readonly (readonly [number, number])[] = [[0, 0], [SIDE, 0], [SIDE, SIDE], [0, SIDE]];

export const CARS = 3;
export const CAR_LEN = 11;
export const CAR_GAP = 0.9;
export const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;
/** Half the width of a car; its floor is level with the platforms. */
export const CAR_HALF_W = 1.35;
export const CAR_FLOOR = RAIL_TOP + 0.1;

export function loopOrigin(c: number): number {
  return (c * LOOP_BLOCKS + LOOP_IN) * P;
}

export function cellOf(v: number): number {
  return Math.floor(v / CELL);
}

export interface PathPoint {
  x: number;
  z: number;
  yaw: number;
}

/** Where the loop of cell (cx, cz) is `s` metres along, and which way it heads there. */
export function loopPoint(cx: number, cz: number, s: number, out: PathPoint): PathPoint {
  const t = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const k = Math.min(3, Math.floor(t / SIDE_LEN));
  const u = t - k * SIDE_LEN;
  const [dx, dz] = DIRS[k], [nx, nz] = DIRS[(k + 1) & 3];
  const ox = loopOrigin(cx), oz = loopOrigin(cz);
  if (u < STRAIGHT) {
    const [x0, z0] = CORNERS[k];
    out.x = ox + x0 + dx * (CURVE_R + u);
    out.z = oz + z0 + dz * (CURVE_R + u);
    out.yaw = Math.atan2(dx, dz);
    return out;
  }
  const [x1, z1] = CORNERS[(k + 1) & 3];
  const phi = (u - STRAIGHT) / CURVE_R, c = Math.cos(phi), sn = Math.sin(phi);
  out.x = ox + x1 - dx * CURVE_R + nx * CURVE_R - nx * CURVE_R * c + dx * CURVE_R * sn;
  out.z = oz + z1 - dz * CURVE_R + nz * CURVE_R - nz * CURVE_R * c + dz * CURVE_R * sn;
  out.yaw = Math.atan2(dx * c + nx * sn, dz * c + nz * sn);
  return out;
}

// ---- stations ----

/** Stations along each side, in metres from the corner the side starts at: all mid-block. */
const STATION_T = [96, 288, 480];
export const STATIONS = 4 * STATION_T.length;
export const STATION_S: readonly number[] = Array.from({ length: STATIONS }, (_, n) =>
  Math.floor(n / STATION_T.length) * SIDE_LEN + STATION_T[n % STATION_T.length] - CURVE_R);

/** Station layout, in metres along the line (`a`, from the middle of the platform) and across it (`l`, into the loop). */
export const PLAT_Y = CAR_FLOOR;
export const PLAT_HALF = 20;
/** The platform edge: a hand's width from the side of a car. Mind the gap. */
export const EDGE_L = CAR_HALF_W + 0.2;
export const PLAT_L = 4.4;
export const STAIR_L = 6.4;
/** The stairs run beside the platform over the gutter, from the landing down to the kerb. */
export const STAIR_TOP = -10;
export const STAIR_FOOT = 10;
export const LANDING_A = -16;
export const ROOF_Y = PLAT_Y + 3.3;
export const BENCH_A: readonly number[] = [-4, 4, 12];
export const POST_A: readonly number[] = [-18, -6, 6, 18];
/** The column under the landing, standing on the kerb. */
export const COLUMN = { a: -15, l: 5.9, r: 0.25 };

const SUFFIXES = ['GATE', 'SQUARE', 'PARK', 'CROSS', 'MARKET', 'HILL', 'BRIDGE', 'CENTRAL'].map((w) => SIGN_TEXTS.indexOf(w));

export interface Station {
  cx: number;
  cz: number;
  n: number;
  /** On the beam, level with the middle of the platform. */
  x: number;
  z: number;
  /** Direction trains travel. */
  dx: number;
  dz: number;
  /** Across the line toward the platform. */
  nx: number;
  nz: number;
  name: string;
  /** Sign texts that spell the name. */
  words: readonly number[];
}

const stationCache = new Map<string, Station[]>();

/** The twelve stations of the loop in cell (cx, cz), in the order trains call at them. */
export function stationsOf(cx: number, cz: number): readonly Station[] {
  const key = `${cx},${cz},${worldSeed}`;
  let list = stationCache.get(key);
  if (list) return list;
  if (stationCache.size > 64) stationCache.clear();
  const p: PathPoint = { x: 0, z: 0, yaw: 0 };
  list = STATION_S.map((s, n) => {
    loopPoint(cx, cz, s, p);
    const k = Math.floor(n / STATION_T.length);
    const [dx, dz] = DIRS[k], [nx, nz] = DIRS[(k + 1) & 3];
    // Named after the district of the sidewalk the stairs come down to.
    const bi = Math.floor((p.x + nx * 8) / P), bj = Math.floor((p.z + nz * 8) / P);
    let words: number[];
    if (Math.abs(bi - LANDMARK_I) <= 1 && Math.abs(bj - LANDMARK_J) <= 1) words = [TEXT_TOWER];
    else {
      const hood = SIGN_TEXTS.indexOf(HOODS[hoodAt(bi, bj)].name);
      words = [hood, SUFFIXES[hash3(cx * 16 + n, cz, worldSeed ^ 0x57a7) % SUFFIXES.length]];
    }
    return { cx, cz, n, x: p.x, z: p.z, dx, dz, nx, nz, name: words.map((w) => SIGN_TEXTS[w]).join(' '), words };
  });
  stationCache.set(key, list);
  return list;
}

/** The station whose platform, stairs or the street under them contain (x, z), and where in it. */
export function stationNear(x: number, z: number, out: { a: number; l: number }): Station | null {
  for (const st of stationsOf(cellOf(x), cellOf(z))) {
    const ex = x - st.x, ez = z - st.z;
    const a = ex * st.dx + ez * st.dz, l = ex * st.nx + ez * st.nz;
    if (a >= -PLAT_HALF - 1 && a <= PLAT_HALF + 1 && l >= 0 && l <= STAIR_L + 0.3) {
      out.a = a;
      out.l = l;
      return st;
    }
  }
  return null;
}

/** Highest step up or down a walker takes in one stride. */
export const STEP = 0.7;

function stairHeight(a: number): number {
  return (PLAT_Y * (STAIR_FOOT - a)) / (STAIR_FOOT - STAIR_TOP);
}

function onPlatform(a: number, l: number): boolean {
  return (a >= -PLAT_HALF && a <= PLAT_HALF && l >= EDGE_L && l <= PLAT_L)
    || (a >= LANDING_A && a <= STAIR_TOP && l >= PLAT_L && l <= STAIR_L);
}

/** Benches and canopy posts, in the way of someone walking the platform. */
function furniture(a: number, l: number): boolean {
  for (const b of BENCH_A) if (Math.abs(a - b) < 1 && l > 3.5) return true;
  for (const p of POST_A) if (Math.abs(a - p) < 0.25 && Math.abs(l - 4.25) < 0.25) return true;
  return Math.abs(a - LANDING_A) < 0.3 && Math.abs(l - 6.3) < 0.3;
}

const local = { a: 0, l: 0 };

/**
 * What a walker with feet at `feet` stands on at (x, z) around a station: its height, -1 where they
 * cannot go (the stair's side, off the platform edge, into a bench), or NaN away from any station.
 */
export function stationFloor(x: number, z: number, feet: number): number {
  const st = stationNear(x, z, local);
  if (!st) return Number.NaN;
  const { a, l } = local;
  if (onPlatform(a, l) && Math.abs(feet - PLAT_Y) <= STEP) return furniture(a, l) ? -1 : PLAT_Y;
  if (a >= STAIR_TOP && a <= STAIR_FOOT && l >= PLAT_L && l <= STAIR_L) {
    const h = stairHeight(a);
    return Math.abs(feet - h) <= STEP ? h : -1;
  }
  if (feet > STEP) return -1;
  // On the street under the platform; only the landing's column is in the way.
  return Math.hypot(a - COLUMN.a, l - COLUMN.l) < COLUMN.r + 0.35 ? -1 : Number.NaN;
}

/** A station whose stairs come down within `r` metres of (x, z). */
export function stairsNear(x: number, z: number, r: number): Station | null {
  const a = STAIR_FOOT + 1, l = (PLAT_L + STAIR_L) / 2;
  for (const st of stationsOf(cellOf(x), cellOf(z))) {
    const fx = st.x + st.dx * a + st.nx * l, fz = st.z + st.dz * a + st.nz * l;
    if ((fx - x) ** 2 + (fz - z) ** 2 < r * r) return st;
  }
  return null;
}

/** Local coordinates of (x, z) in station `st`. */
export function stationLocal(st: Station, x: number, z: number, out: { a: number; l: number }): void {
  const ex = x - st.x, ez = z - st.z;
  out.a = ex * st.dx + ez * st.dz;
  out.l = ex * st.nx + ez * st.nz;
}

// ---- timetable ----

const V = 16;
const A = 1.6;
/** Seconds the doors stay open at each station. */
export const DWELL = 12;
export const TRAINS = 8;

function runTime(d: number): number {
  return d >= (V * V) / A ? d / V + V / A : 2 * Math.sqrt(d / A);
}

/** Distance covered `t` seconds after leaving a station `d` metres before the next: ease out, cruise, ease in. */
function runDist(t: number, d: number): number {
  const T = runTime(d);
  const ta = d >= (V * V) / A ? V / A : T / 2;
  if (t <= ta) return 0.5 * A * t * t;
  if (t >= T - ta) return d - 0.5 * A * (T - t) * (T - t);
  return 0.5 * A * ta * ta + (t - ta) * A * ta;
}

const GAP_D = STATION_S.map((s, n) => (n + 1 < STATIONS ? STATION_S[n + 1] : STATION_S[0] + LOOP_LEN) - s);
/** Time since the start of the cycle at which a train pulls in at each station (and at the first again). */
const ARRIVE: readonly number[] = GAP_D.reduce((acc, d) => [...acc, acc[acc.length - 1] + DWELL + runTime(d)], [0]);
export const CYCLE = ARRIVE[STATIONS];
export const HEADWAY = CYCLE / TRAINS;

function loopPhase(cx: number, cz: number): number {
  return ((hash3(cx, cz, worldSeed ^ 0x100b) % 10000) / 10000) * CYCLE;
}

export interface TrainState {
  /** Middle of the train along the loop. */
  s: number;
  /** Station it stands at with the doors open, or -1 while moving. */
  at: number;
  /** Station it calls at next (the one it stands at, while there). */
  next: number;
  /** Seconds until the doors close, or until it arrives. */
  left: number;
  /** Counts every departure, so who is aboard changes from one station to the next. */
  trip: number;
}

export function trainState(cx: number, cz: number, k: number, time: number, out: TrainState): TrainState {
  const u = time + k * HEADWAY + loopPhase(cx, cz);
  const lap = Math.floor(u / CYCLE);
  const tau = u - lap * CYCLE;
  let i = STATIONS - 1;
  for (let n = 0; n < STATIONS; n++) {
    if (tau < ARRIVE[n + 1]) {
      i = n;
      break;
    }
  }
  const into = tau - ARRIVE[i];
  out.trip = lap * STATIONS + i;
  if (into < DWELL) {
    out.s = STATION_S[i];
    out.at = i;
    out.next = i;
    out.left = DWELL - into;
  } else {
    out.s = (STATION_S[i] + runDist(into - DWELL, GAP_D[i])) % LOOP_LEN;
    out.at = -1;
    out.next = (i + 1) % STATIONS;
    out.left = ARRIVE[i + 1] - tau;
  }
  return out;
}

/** Centre and heading of car `m` (0 leads) of a train whose middle is at `s`. */
export function carPoint(cx: number, cz: number, s: number, m: number, out: PathPoint): PathPoint {
  return loopPoint(cx, cz, s + ((CARS - 1) / 2 - m) * (CAR_LEN + CAR_GAP), out);
}

function sinceArrival(cx: number, cz: number, n: number, k: number, time: number): number {
  const u = time + k * HEADWAY + loopPhase(cx, cz) - ARRIVE[n];
  return u - Math.floor(u / CYCLE) * CYCLE;
}

/** The train standing at station n with its doors open, or -1. */
export function trainAt(cx: number, cz: number, n: number, time: number): number {
  for (let k = 0; k < TRAINS; k++) if (sinceArrival(cx, cz, n, k, time) < DWELL) return k;
  return -1;
}

/** Seconds until the next train pulls in at station n (0 while one stands there). */
export function nextTrain(cx: number, cz: number, n: number, time: number): number {
  let best = CYCLE;
  for (let k = 0; k < TRAINS; k++) {
    const since = sinceArrival(cx, cz, n, k, time);
    best = Math.min(best, since < DWELL ? 0 : CYCLE - since);
  }
  return best;
}

/** Changes each time a train leaves station n, as the people waiting there get on. */
export function crowdSlot(cx: number, cz: number, n: number, time: number): number {
  return Math.floor((time + loopPhase(cx, cz) - ARRIVE[n] - DWELL) / HEADWAY);
}

/** Where on the map loop lines run (straight sides only; the corners are drawn square). */
export function onLoopLine(x: number, z: number, tol: number): boolean {
  const lx = x - loopOrigin(cellOf(x)), lz = z - loopOrigin(cellOf(z));
  const alongX = lx >= -tol && lx <= SIDE + tol, alongZ = lz >= -tol && lz <= SIDE + tol;
  return (alongX && (Math.abs(lz) < tol || Math.abs(lz - SIDE) < tol)) || (alongZ && (Math.abs(lx) < tol || Math.abs(lx - SIDE) < tol));
}
