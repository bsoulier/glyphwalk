import './style.css';
import { buildAtlas } from './render/atlas';
import { Camera } from './render/camera';
import { Clock, TIME_MODES, type TimeMode, clockText, daylightAt } from './render/daylight';
import { FOG_FAR, WEATHERS, WEATHER_LABELS, type Weather } from './render/weather';
import { FrameBuffer } from './render/framebuffer';
import { drawMap, mapToWorld, type MapView } from './render/map';
import { CanvasPresenter, STYLE_NAMES, WebGLPresenter, type Presenter } from './render/presenter';
import { Rain } from './render/rain';
import { stats } from './render/raster';
import { type FrameEnv, renderScene } from './render/scene';
import { setGroundDebug } from './render/ground';
import { CHARSET } from './core/charset';
import { Input } from './game/input';
import { type TouchButton, TouchControls, touchDevice } from './game/touch';
import { Tour } from './game/tour';
import { MODES, MODE_LABELS, Player, type Mode } from './game/player';
import { HOODS, HOOD_BLOCKS, hoodAt, nearestRegion } from './world/hoods';
import { Sound } from './audio/sound';
import { RADIO_OFF, STATIONS } from './audio/radio';
import { inCab, levelAt } from './world/interior';
import { CAB_FOV } from './world/cabin';
import { signalPhase, walkWindow } from './world/signals';
import { EYE_H, P, setWorldSeed, worldSeed } from './world/layout';
import { brownoutAt } from './world/events';
import { setNeon } from './render/facades';
import { World } from './world/world';
import { GifRecorder } from './ui/gif';
import { Hud, type Prompt } from './ui/hud';
import { PhotoMode } from './ui/photo';
import { setupPwa } from './ui/pwa';
import { loadResume, saveResume } from './ui/resume';
import { shareUrl, viewUrl } from './ui/share';
import { toast } from './ui/toast';
import { CATS_PER_HOOD } from './world/cats';
import { MAX_DETAIL, Quality, lowEndDevice } from './ui/quality';
import { loadSettings, saveSettings } from './ui/settings';
import { trackEvent, trackVisit } from './ui/analytics';
import { Online } from './net/online';
import { loadOnlineId, newOnlineId, saveOnlineId } from './net/identity';
import { playerName } from './net/names';
import { EMOTES, type PlayerState } from './net/protocol';
import type { OtherPlayer } from './world/others';
import { STATIONS as LOOP_STOPS, type Station, nextTrain, stairsNear, stationsOf } from './world/loop';
import type { TrainRef } from './world/train';

const params = new URLSearchParams(location.search);
setWorldSeed(Number(params.get('seed')) || 1337);
const isTouch = touchDevice();

let canvas = document.getElementById('screen') as HTMLCanvasElement;

function createPresenter(): Presenter {
  if (params.get('renderer') !== 'canvas') {
    try {
      const p = WebGLPresenter.tryCreate(canvas);
      if (p) return p;
    } catch (err) {
      console.warn('WebGL2 presenter failed, using Canvas2D', err);
      const fresh = canvas.cloneNode() as HTMLCanvasElement;
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return new CanvasPresenter(canvas);
}

const settings = loadSettings();
const presenter = createPresenter();
const quality = new Quality(settings.cell, settings.fps, lowEndDevice(isTouch));
const fb = new FrameBuffer();
const cam = new Camera();
const rain = new Rain();
const world = new World();
const player = new Player();
const input = new Input(canvas);
const sound = new Sound();
sound.setEnabled(settings.sound);
sound.setVolume(settings.volume);
for (const k of settings.soundOff) sound.setKind(k, false);
// Audio may only start from a user gesture, so every tap or key press tries.
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, () => sound.unlock());
document.addEventListener('visibilitychange', () => {
  sound.pause(document.hidden);
  quality.hold(2);
});
const clock = new Clock();
const gif = new GifRecorder();
trackVisit();

/**
 * The online server, from VITE_ONLINE_URL at build time; `?online=ws://...` points elsewhere in development.
 * Automated browsers (crawlers, the e2e tests) stay out of the rooms.
 */
const ONLINE_URL = ((import.meta.env.DEV && params.get('online'))
  || (!navigator.webdriver && (import.meta.env.VITE_ONLINE_URL as string | undefined)) || '').trim().replace(/\/+$/, '');
const online = ONLINE_URL ? new Online(ONLINE_URL, worldSeed, loadOnlineId()) : null;
if (import.meta.env.DEV) Object.assign(window, { glyphwalk: { world, player, sound, clock, quality, gif, online, get tour() { return tour; } } });
// ?ground=flat or ?ground=zones (dev only): ground cells as solid colour, to check where lines really fall.
if (import.meta.env.DEV) setGroundDebug(params.get('ground') === 'flat' ? 'flat' : params.get('ground') === 'zones' ? 'zones' : null);

// Bookmarkable views (Share / L builds these): ?cam=x,y,z,yaw,pitch&mode=walk&floor=4&time=cycle&hour=18.4&weather=rain
const camParam = params.get('cam')?.split(',').map(Number);
if (camParam && camParam.length >= 3 && camParam.every(Number.isFinite)) {
  [player.x, player.y, player.z] = camParam;
  player.yaw = camParam[3] ?? player.yaw;
  player.pitch = camParam[4] ?? player.pitch;
}
const modeParam = params.get('mode');
if (modeParam && (MODES as readonly string[]).includes(modeParam)) player.setMode(modeParam as Mode, world);
const floorParam = Number(params.get('floor'));
if (player.mode === 'walk' && floorParam > 0) {
  player.floorY = floorParam;
  player.y = floorParam + EYE_H;
}
const hourParam = Number(params.get('hour'));
if (params.has('hour') && hourParam >= 0 && hourParam < 24) clock.hour = hourParam;
if (params.has('rain')) settings.weather = params.get('rain') !== '0' ? 'rain' : 'clear';
const weatherParam = params.get('weather');
if (weatherParam && (WEATHERS as readonly string[]).includes(weatherParam)) settings.weather = weatherParam as Weather;
const timeParam = params.get('time');
if (timeParam && (TIME_MODES as readonly string[]).includes(timeParam)) settings.time = timeParam as TimeMode;
const cellParam = params.get('cell');
if (cellParam) quality.set(cellParam);

function applyWeather(): void {
  rain.on = settings.weather === 'rain' || settings.weather === 'snow';
  rain.snow = settings.weather === 'snow';
}
applyWeather();

function currentHood(): number {
  return hoodAt(Math.floor(player.x / P), Math.floor(player.z / P));
}

/** Stand on the sidewalk corner of the region's central crossroads, looking diagonally across it. */
function goToHood(hood: number): void {
  const r = nearestRegion(hood, Math.floor(player.x / P), Math.floor(player.z / P));
  if (!r) return;
  const ci = r[0] * HOOD_BLOCKS + HOOD_BLOCKS / 2, cj = r[1] * HOOD_BLOCKS + HOOD_BLOCKS / 2;
  player.teleport(ci * P + 8.6, cj * P + 8.6, -2.36, world);
  world.city.prime();
}

const hoodParam = params.get('hood');
if (hoodParam) {
  const k = HOODS.findIndex((h, n) => String(n) === hoodParam || h.name.replace(/\s+/g, '').toLowerCase() === hoodParam.toLowerCase());
  if (k >= 0) goToHood(k);
}

// Without a link saying where to go, carry on from wherever the last session ended.
const resumed = params.has('cam') || params.has('mode') || hoodParam ? null : loadResume(worldSeed);
if (resumed) {
  player.x = resumed.x;
  player.y = resumed.y;
  player.z = resumed.z;
  player.yaw = resumed.yaw;
  player.pitch = resumed.pitch;
  if (resumed.mode !== 'walk') player.setMode(resumed.mode, world);
  else if (resumed.floor > 0) {
    player.floorY = resumed.floor;
    player.y = resumed.floor + EYE_H;
  }
  if (!params.has('hour')) clock.hour = resumed.hour;
}

/** Map clicks land on the nearest sidewalk, facing along that street, so you never arrive inside a building. */
function jumpTo(X: number, Z: number): void {
  const ix = Math.round(X / P) * P, iz = Math.round(Z / P) * P;
  const sx = X - ix, sz = Z - iz;
  if (Math.abs(sx) < Math.abs(sz)) player.teleport(ix + (sx >= 0 ? 8.6 : -8.6), Z, sz >= 0 ? 0 : Math.PI, world);
  else player.teleport(X, iz + (sz >= 0 ? 8.6 : -8.6), sx >= 0 ? Math.PI / 2 : -Math.PI / 2, world);
  world.city.prime();
}

const MAP_ZOOMS = [2, 4, 8, 16];
let fullMap = params.get('map') === 'full';
let mapZoom = Math.max(0, Math.min(MAP_ZOOMS.length - 1, settings.mapZoom));

function zoomMap(delta: number): void {
  mapZoom = Math.max(0, Math.min(MAP_ZOOMS.length - 1, mapZoom + delta));
  settings.mapZoom = mapZoom;
  persist();
}
if (params.get('map') === '0') settings.minimap = false;
input.canLock = () => !fullMap;

/** M cycles minimap, full map, no map. */
function cycleMap(): void {
  if (fullMap) {
    fullMap = false;
    settings.minimap = false;
  } else if (settings.minimap) {
    fullMap = true;
    if (document.pointerLockElement) document.exitPointerLock();
  } else settings.minimap = true;
  persist();
}

const hud = new Hud({
  onHood: (hood) => goToHood(hood),
  onCell: (id) => {
    quality.set(id);
    settings.cell = quality.cellSetting;
    layout();
    persist();
  },
  onFps: (fps) => {
    settings.fps = fps;
    quality.targetFps = fps;
    persist();
  },
  onDist: (dist) => {
    settings.dist = dist;
    persist();
  },
  onFov: (fov) => {
    settings.fov = fov;
    persist();
  },
  onStyle: (style) => {
    settings.style = style;
    persist();
  },
  onTime: (mode) => {
    settings.time = mode;
    persist();
  },
  onWeather: (w) => {
    settings.weather = w;
    applyWeather();
    persist();
  },
  onRadio: (station) => tune(station),
  onShare: () => shareView(),
  onSound: (on) => setSound(on),
  onVolume: (v) => {
    settings.volume = v;
    sound.setVolume(v);
    persist();
  },
  onSoundKind: (kind, on) => {
    settings.soundOff = settings.soundOff.filter((k) => k !== kind);
    if (!on) settings.soundOff.push(kind);
    sound.setKind(kind, on);
    persist();
  },
  onNerds: (on) => setNerds(on),
  onEvents: (mode) => {
    settings.events = mode;
    persist();
  },
  onSection: (id, open) => {
    if (settings.open.includes(id) === open) return;
    settings.open = open ? [...settings.open, id] : settings.open.filter((s) => s !== id);
    persist();
  },
  onOnline: (on) => {
    settings.online = on;
    persist();
  },
  onRename: () => {
    if (!online) return;
    const id = newOnlineId();
    saveOnlineId(id);
    online.setId(id);
    hud.setOnline(true, playerName(id));
    toast(`You are now ${playerName(id)}`, 2000);
  },
});

function setSound(on: boolean): void {
  settings.sound = on;
  sound.setEnabled(on);
  persist();
}

function setNerds(on: boolean): void {
  settings.nerds = on;
  persist();
  updateHud();
}

function persist(): void {
  saveSettings(settings);
  hud.sync(settings, quality.cellSetting);
}

let cellPxW = 1;
let cellPxH = 1;
let dpr = 1;

function layout(): void {
  dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
  const preset = quality.preset;
  cellPxW = Math.max(2, Math.round(preset.w * dpr));
  cellPxH = Math.max(3, Math.round(preset.h * dpr));
  const cols = Math.max(16, Math.floor((window.innerWidth * dpr) / cellPxW));
  const rows = Math.max(8, Math.floor((window.innerHeight * dpr) / cellPxH));
  canvas.width = cols * cellPxW;
  canvas.height = rows * cellPxH;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  fb.resize(cols, rows);
  presenter.setAtlas(buildAtlas(cellPxW, cellPxH));
  presenter.resize(cols, rows);
  rain.resize(cols, rows);
}

window.addEventListener('resize', layout);
layout();
hud.sync(settings, quality.cellSetting);
hud.openSections(settings.open);
hud.setOnline(online !== null, online ? playerName(online.myId) : '');

const hudEl = document.getElementById('hud') as HTMLElement;

/** Full map fills the screen left of the HUD panel. */
function fullMapView(): MapView {
  const hudCols = settings.hud ? Math.ceil(((hudEl.offsetWidth + 24) * dpr) / cellPxW) : 0;
  return {
    col: 2, row: 1, w: Math.max(24, fb.cols - hudCols - 4), h: Math.max(10, fb.rows - 3),
    cx: cam.x, cz: cam.z, mpc: MAP_ZOOMS[mapZoom], aspect: cellPxH / cellPxW, full: true,
  };
}

/** Minimap in the bottom-left corner, square on screen. */
function miniMapView(): MapView {
  const w = Math.max(26, Math.min(64, Math.round(fb.cols * 0.2)));
  const h = Math.max(12, Math.min(Math.round(fb.rows * 0.42), Math.round((w * cellPxW) / cellPxH)));
  return { col: 1, row: fb.rows - h - 1, w, h, cx: cam.x, cz: cam.z, mpc: 5, aspect: cellPxH / cellPxW, full: false };
}

/** A click or tap on the full map jumps to that spot. */
function mapPick(clientX: number, clientY: number): void {
  if (!fullMap) return;
  const r = canvas.getBoundingClientRect();
  const col = Math.floor(((clientX - r.left) / r.width) * fb.cols);
  const row = Math.floor(((clientY - r.top) / r.height) * fb.rows);
  const at = mapToWorld(fullMapView(), col, row);
  if (!at) return;
  jumpTo(at[0], at[1]);
  fullMap = false;
}

canvas.addEventListener('mousedown', (e) => mapPick(e.clientX, e.clientY));

const touch = isTouch
  ? new TouchControls(input, [
    { label: 'MODE', code: 'KeyV' },
    { label: 'NEXT', code: 'KeyN' },
    { label: 'PHOTO', code: 'KeyP' },
    { label: 'MAP', code: 'KeyM' },
    { label: 'AREA', code: 'KeyB' },
    { label: 'TILT', code: 'tilt' },
    { label: 'SOUND', code: 'KeyU' },
    { label: 'MENU', code: 'KeyH' },
  ])
  : null;
if (touch) {
  touch.onTap = mapPick;
  // The settings panel covers half a phone screen; it starts hidden and MENU brings it back.
  settings.hud = false;
  hud.sync(settings, quality.cellSetting);
  document.body.classList.add('touch');
}
/** Until then, phones show how the two halves of the screen work. */
const touchIntroUntil = performance.now() + 8000;
/** Walking keys are shown until the player has used them. */
let hasMoved = false;

/** The emote list is open (Z): number keys pick an emote instead of a camera mode. */
let emoteMenu = false;
let emoteMenuUntil = 0;
/** The "other players are here" hint shows once per visit. */
let metSomeone = false;
const me: PlayerState = { x: 0, z: 0, y: 0, yaw: 0, mode: 0 };
const NOBODY: readonly OtherPlayer[] = [];
let others: readonly OtherPlayer[] = NOBODY;
/** A hidden tab lets go of the server after this long, an idle player after IDLE_ONLINE_MS. */
const HIDDEN_ONLINE_MS = 20000;
const IDLE_ONLINE_MS = 10 * 60 * 1000;
const MAX_OTHERS = 64;

if (online) {
  online.onNewId = (id) => {
    saveOnlineId(id);
    hud.setOnline(true, playerName(id));
  };
  online.onEmote = (r, k) => {
    if (EMOTES[k].label !== 'meow') return;
    const dx = r.x - cam.x, dz = r.z - cam.z, d = Math.hypot(dx, dz);
    if (d < 40) sound.meow(Math.sin(Math.atan2(dx, dz) - cam.yaw) * 0.9, 0.25 * (1 - d / 45));
  };
  // Animation frames stop in a hidden tab, so a timer lets go of the server instead.
  let hiddenTimer = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = window.setTimeout(() => online.update(performance.now(), me, settings.online, false), HIDDEN_ONLINE_MS);
  });
}

/** Where others should see the player: their feet, or the cab they ride in. */
function whereAmI(): PlayerState {
  const v = player.riding(world);
  me.mode = MODES.indexOf(player.mode);
  if (v) {
    me.x = v.x; me.z = v.z; me.y = v.y; me.yaw = v.yaw;
  } else if (player.mode === 'walk') {
    me.x = player.x; me.z = player.z; me.y = player.floorY; me.yaw = player.yaw;
  } else {
    me.x = cam.x; me.z = cam.z; me.y = Math.max(0, cam.y - EYE_H); me.yaw = cam.yaw;
  }
  return me;
}

/** Keeps the connections going and returns the other players to draw; in photo mode they hold still. */
function onlineFrame(dt: number, frozen: boolean): readonly OtherPlayer[] {
  if (!online) return NOBODY;
  const now = performance.now();
  online.update(now, whereAmI(), settings.online, now - input.lastActive < IDLE_ONLINE_MS);
  if (online.status === 'online') trackEvent('online');
  if (emoteMenu && (now > emoteMenuUntil || online.status !== 'online')) emoteMenu = false;
  if (frozen) return others;
  others = online.visible(now, dt, cam.x, cam.z, MAX_OTHERS);
  if (!metSomeone && online.count > 0) {
    metSomeone = true;
    toast(`Other players are here! ${touch ? 'EMOTE' : 'Z'} to say hello.`, 3500);
  }
  return others;
}

function toggleEmotes(): void {
  if (!online || !settings.online) return;
  if (online.status !== 'online') {
    toast('Not connected yet', 1200);
    return;
  }
  emoteMenu = !emoteMenu;
  emoteMenuUntil = performance.now() + 6000;
}

function sendEmote(k: number): void {
  emoteMenu = false;
  if (!online) return;
  if (!online.emote(k, performance.now())) {
    toast('One moment before the next one', 1200);
    return;
  }
  toast(`You: ${EMOTES[k].text}`, 1500);
  if (EMOTES[k].label === 'meow') sound.meow(0, 0.2);
  trackEvent('emote');
}

function onlineText(): string {
  if (!online) return '';
  switch (online.status) {
    case 'online': {
      const n = online.count;
      // The city's count includes the player and lags by up to a minute, so it never reads below who is in sight.
      const city = Math.max(online.city?.total ?? 0, n + 1);
      return city > 1 ? `${n === 0 ? 'nobody near you' : `${n} near you`}, ${city} in the city` : 'nobody near you yet';
    }
    case 'connecting': return 'connecting...';
    case 'paused': return 'paused while away';
    case 'off': return 'off';
    case 'offline': return 'offline, retrying';
    case 'outdated': return 'reload the page to play';
  }
}

const photo = new PhotoMode(touch !== null);
photo.onShot = () => {
  sound.shutter();
  trackEvent('photo');
};
setupPwa(document.getElementById('btn-install') as HTMLButtonElement, document.getElementById('ios-hint') as HTMLElement);

function togglePhoto(): void {
  photo.toggle();
  if (photo.active) {
    const district = HOODS[currentHood()].name.toLowerCase().replace(/\s+/g, '-');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    photo.name = `glyphwalk-${district}-${sky.label}-${stamp}`;
  }
}

/** Records a few seconds of the live world (it unfreezes for the take) into a looping GIF. */
function startGif(): void {
  if (gif.active || gif.encoding) return;
  gif.start(canvas.width / dpr, canvas.height / dpr, settings.style);
  sound.shutter();
}

async function finishGif(): Promise<void> {
  photo.setBar('ENCODING GIF...');
  try {
    const blob = await gif.encode();
    photo.save(blob, 'gif');
    trackEvent('gif');
  } catch (err) {
    console.error(err);
    toast('Could not make the GIF');
  }
  photo.setBar(null);
}

/** Copies (or on phones, shares) a link that reopens the game on exactly this view, hour and weather. */
function shareView(): void {
  const riding = player.mode !== 'walk' && player.mode !== 'fly';
  const url = viewUrl({
    x: cam.x, y: cam.y, z: cam.z, yaw: cam.yaw, pitch: cam.pitch,
    // Rides and street cameras cannot be reproduced exactly, so the link keeps their view as a free camera.
    mode: riding ? 'fly' : player.mode === 'fly' ? 'fly' : 'walk',
    floor: player.mode === 'walk' ? player.floorY : 0,
    hour: sky.hour, time: settings.time, weather: settings.weather, seed: worldSeed,
  });
  const where = `${HOODS[currentHood()].name} at ${clockText(sky.hour)} (${sky.label}, ${WEATHER_LABELS[settings.weather].toLowerCase()})`;
  trackEvent('share');
  const meet = online && settings.online ? ' - whoever opens it can find you there' : '';
  void shareUrl(url, `Glyphwalk: ${where}`, touch !== null).then((how) => {
    if (how === 'copied') toast(`Link copied: opens ${where}${meet}`);
    else if (how === 'failed') prompt('Copy this link:', url);
  });
}

function riding(): boolean {
  return player.mode === 'taxi' || player.mode === 'sky';
}

function tune(station: number): void {
  settings.station = ((station % (RADIO_OFF + 1)) + RADIO_OFF + 1) % (RADIO_OFF + 1);
  persist();
  const s = STATIONS[settings.station];
  toast(s ? `\u266a ${s.name}  ${s.genre}` : '\u266a Radio off', 1800);
}

/** Buttons that only apply right now: photo actions, map zoom, flying up and down, riding a lift or a cab. */
function touchContext(): TouchButton[] {
  if (photo.active) {
    if (gif.active || gif.encoding) return [];
    return [
      { label: 'SAVE', code: 'Enter' }, { label: 'GIF', code: 'KeyG' }, { label: 'COPY', code: 'KeyC' },
      { label: 'LINK', code: 'KeyL' }, { label: 'EXIT', code: 'KeyP' },
    ];
  }
  if (fullMap) return [{ label: 'ZOOM +', code: 'Equal' }, { label: 'ZOOM -', code: 'Minus' }];
  if (emoteMenu) return [...EMOTES.map((e, k) => ({ label: e.label.toUpperCase(), code: `Digit${k + 1}` })), { label: 'BACK', code: 'KeyZ' }];
  const emote: TouchButton[] = online && settings.online && online.count > 0 ? [{ label: 'EMOTE', code: 'KeyZ' }] : [];
  if (player.mode === 'fly') return [{ label: 'RISE', code: 'KeyE', hold: true }, { label: 'SINK', code: 'KeyQ', hold: true }, ...emote];
  if (player.mode === 'taxi') return [{ label: 'RADIO', code: 'KeyE' }, { label: 'GET OUT', code: 'Enter' }, ...emote];
  if (player.mode === 'rail') return [{ label: 'GET OFF', code: 'Enter' }, ...emote];
  if (riding()) return [{ label: 'RADIO', code: 'KeyE' }, ...emote];
  const it = player.inside(world);
  if (it && !player.liftMoving && inCab(it, player.x, player.z)) return [{ label: 'LIFT UP', code: 'KeyE' }, { label: 'LIFT DN', code: 'KeyQ' }, ...emote];
  const st = platform();
  if (st) return world.rail.standing(st) ? [{ label: 'BOARD', code: 'Enter' }, ...emote] : emote;
  if (player.mode === 'walk' && !it && player.floorY < 0.5) return [{ label: 'TAXI', code: 'Enter' }, ...emote];
  return emote;
}

// ---- the monorail ----

/** The station platform the player stands on, if any. */
function platform(): Station | null {
  return player.mode === 'walk' ? world.rail.platformAt(player.x, player.z, player.floorY) : null;
}

function stopName(ref: TrainRef, n: number): string {
  return stationsOf(ref.cx, ref.cz)[n].name;
}

function boardTrain(st: Station): void {
  const ref = world.rail.standing(st);
  if (!ref) {
    toast(`The next train is due in ${Math.ceil(nextTrain(st.cx, st.cz, st.n, world.rail.time))} s`, 2000);
    return;
  }
  player.board(ref, world);
  toast(`All aboard! Next stop: ${stopName(ref, (st.n + 1) % LOOP_STOPS)}`, 2500);
  trackEvent('monorail');
}

/** Steps off at the station the train stands at. */
function alight(): void {
  const t = world.rail.train(player.train);
  if (t.at < 0) return;
  const name = stopName(player.train, t.at);
  player.setMode('walk', world);
  toast(`${name}. Mind the gap!`, 2500);
}

/** Enter while riding: off now if the doors are open, else at the next station (again to stay on). */
function leaveTrain(): void {
  const t = world.rail.train(player.train);
  if (t.at >= 0) {
    alight();
    return;
  }
  player.alightNext = !player.alightNext;
  toast(player.alightNext ? `Getting off at ${stopName(player.train, t.next)}` : 'Staying on board', 1800);
}

let doorsOpen = false;

/** Gets off when asked to at the station the train pulls into, and chimes the doors of the train at hand. */
function railFrame(): void {
  let open = false;
  if (player.mode === 'rail') {
    open = world.rail.train(player.train).at >= 0;
    if (open && player.alightNext) alight();
  } else {
    const st = platform();
    open = st !== null && world.rail.standing(st) !== null;
  }
  if (open !== doorsOpen) {
    doorsOpen = open;
    sound.trainDoors(open, player.mode === 'rail');
  }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * The keys that do something right here, for the line under the view. Phones have buttons for those,
 * so they only get the advice that has no button.
 */
function prompts(): Prompt[] {
  if (photo.active || tour.active) return [];
  if (emoteMenu) return touch ? [] : [...EMOTES.map((e, k): Prompt => [String(k + 1), e.label]), ['Z', 'close']];
  const p: Prompt[] = [];
  const it = player.inside(world);
  if (touch) {
    if (performance.now() < touchIntroUntil) p.push(['', 'left: move (push far to run) \u00b7 right: look']);
  } else if (fullMap) {
    return [['CLICK', 'jump there'], ['+ -', 'zoom'], ['M', 'close']];
  } else if (!input.locked && player.mode !== 'cctv') p.push(['CLICK', 'look around']);
  const keys = !touch;
  switch (player.mode) {
    case 'walk': {
      if (it) {
        if (player.liftMoving) break;
        if (!inCab(it, player.x, player.z)) {
          if (it.lift) p.push(['', 'lift at the back']);
        } else if (keys) {
          const k = it.levels.findIndex((l) => Math.abs(l.y - player.floorY) < 0.5);
          if (k < it.levels.length - 1) p.push(['E', 'lift up']);
          if (k > 0) p.push(['Q', 'lift down']);
        }
        break;
      }
      const st = platform();
      if (st) {
        if (world.rail.standing(st)) {
          if (keys) p.push(['ENTER', 'board the train']);
        } else p.push(['', `${st.name}: next train in ${Math.ceil(nextTrain(st.cx, st.cz, st.n, world.rail.time))} s`]);
        break;
      }
      if (player.floorY > 0.5) break;
      if (keys && !hasMoved) p.push(['WASD', 'move']);
      const door = world.city.doorNear(player.x, player.z, 4);
      if (door) p.push(['', `walk in: ${door.label}`]);
      if (stairsNear(player.x, player.z, 7)) p.push(['', 'stairs up to the monorail']);
      if (keys) p.push(['ENTER', 'taxi']);
      if (keys && !hasMoved) p.push(['V', 'camera modes']);
      break;
    }
    case 'fly':
      if (keys) p.push(['E', 'up'], ['Q', 'down'], ['1', 'walk']);
      break;
    case 'taxi':
      if (keys) p.push(['ENTER', 'get out'], ['Q E', 'radio'], ['N', 'next taxi']);
      break;
    case 'sky':
      if (keys) p.push(['Q E', 'radio'], ['N', 'next'], ['1', 'walk']);
      break;
    case 'cctv':
      if (keys) p.push(['N', 'next camera'], ['1', 'walk']);
      break;
    case 'rail': {
      const t = world.rail.train(player.train);
      if (player.alightNext) p.push(['', `getting off at ${stopName(player.train, t.next)}`]);
      else if (keys) p.push(['ENTER', t.at >= 0 ? 'get off' : `get off at ${stopName(player.train, t.next)}`]);
      break;
    }
  }
  if (keys && online && settings.online && online.count > 0 && player.mode !== 'cctv') p.push(['Z', 'emote']);
  if (keys && !settings.hud) p.push(['H', 'menu']);
  return p;
}

canvas.addEventListener('wheel', (e) => {
  if (!fullMap) return;
  e.preventDefault();
  zoomMap(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

let staticT = 0;
player.onCut = () => {
  staticT = 0.3;
};

function handleKeys(): void {
  for (const code of input.takePressed()) {
    if (MOVE_KEYS.has(code)) hasMoved = true;
    if (emoteMenu && code.startsWith('Digit')) {
      const k = Number(code.slice(5)) - 1;
      if (k >= 0 && k < EMOTES.length) sendEmote(k);
      else emoteMenu = false;
      continue;
    }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= MODES.length) player.setMode(MODES[n - 1], world);
      continue;
    }
    switch (code) {
      case 'KeyV': player.cycle(1, world); break;
      case 'KeyN': player.next(world); break;
      case 'KeyB': goToHood((currentHood() + 1) % HOODS.length); break;
      case 'KeyM': cycleMap(); break;
      case 'KeyE':
        if (riding()) tune(settings.station + 1);
        else player.useLift(1, world);
        break;
      case 'KeyQ':
        if (riding()) tune(settings.station - 1);
        else player.useLift(-1, world);
        break;
      case 'KeyP': togglePhoto(); break;
      case 'KeyO':
        startTour();
        trackEvent('tour');
        break;
      case 'KeyZ': toggleEmotes(); break;
      case 'KeyL': shareView(); break;
      case 'Enter':
        if (photo.active) photo.requestPng();
        else if (player.mode === 'taxi') {
          toast(`Paid $${player.fare.toFixed(2)}. Thanks, have a good one!`, 2500);
          player.setMode('walk', world);
        } else if (player.mode === 'rail') leaveTrain();
        else if (player.mode === 'walk' && !player.inside(world)) {
          const st = platform();
          if (st) boardTrain(st);
          else if (player.floorY < 0.5) {
            player.setMode('taxi', world);
            toast("Taxi! You're in the back seat.", 2500);
            trackEvent('taxi');
          }
        }
        break;
      case 'KeyC': if (photo.active) photo.copyText(fb); break;
      case 'Escape':
        fullMap = false;
        emoteMenu = false;
        if (photo.active) togglePhoto();
        break;
      case 'Equal':
      case 'NumpadAdd':
        zoomMap(-1);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        zoomMap(1);
        break;
      case 'KeyR':
        settings.weather = WEATHERS[(WEATHERS.indexOf(settings.weather) + 1) % WEATHERS.length];
        applyWeather();
        persist();
        break;
      case 'KeyH':
        settings.hud = !settings.hud;
        persist();
        break;
      case 'KeyG':
        if (photo.active) {
          startGif();
          break;
        }
        settings.style = (settings.style + 1) % STYLE_NAMES.length;
        persist();
        break;
      case 'KeyT':
        settings.scan = !settings.scan;
        persist();
        break;
      case 'KeyU':
        setSound(!settings.sound);
        toast(settings.sound ? 'Sound on' : 'Sound off', 1200);
        break;
      case 'KeyI': setNerds(!settings.nerds); break;
      case 'KeyY':
        settings.time = TIME_MODES[(TIME_MODES.indexOf(settings.time) + 1) % TIME_MODES.length];
        persist();
        break;
      case 'BracketLeft':
      case 'BracketRight':
        quality.step(code === 'BracketLeft' ? -1 : 1);
        settings.cell = quality.cellSetting;
        layout();
        persist();
        break;
      case 'KeyF':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
        break;
    }
  }
}

const NOISE = Array.from('.:-=+*#%@', (c) => CHARSET.indexOf(c));

function addStatic(amount: number): void {
  const n = fb.cols * fb.rows;
  const count = Math.floor(n * Math.min(1, amount * 3) * 0.7);
  for (let k = 0; k < count; k++) {
    const i = (Math.random() * n) | 0;
    const v = 60 + Math.random() * 170;
    fb.fg[i] = (NOISE[k % NOISE.length] << 24) | (v << 16) | (v << 8) | v;
    fb.bg[i] = 0x121212;
  }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const BARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
/** Recent frame durations in ms, oldest first, for the stats overlay. */
const frameTimes: number[] = [];

function sparkline(values: readonly number[], full: number): string {
  return values.map((v) => BARS[Math.min(BARS.length - 1, Math.floor((v / full) * BARS.length))]).join('');
}

function updateHud(): void {
  const bearing = (((cam.yaw * 180) / Math.PI) % 360 + 360) % 360;
  const compass = COMPASS[Math.round(bearing / 45) % 8];
  const hood = hoodAt(Math.floor(cam.x / P), Math.floor(cam.z / P));
  const district = HOODS[hood].name;
  const indoors = player.inside(world);
  hud.setHood(hood);
  online?.setHood(hood);
  hud.setHoodCounts(online?.status === 'online' ? online.city?.hoods ?? null : null);
  trackEvent(`district-${district.toLowerCase().replace(/\s+/g, '-')}`);
  trackEvent(`mode-${player.mode}`);
  hud.setStats([
    `MODE     ${MODE_LABELS[player.mode]}`,
    `SECTOR   ${district}${indoors ? ` / ${indoors.label}` : ''}`,
    `CATS     ${world.cats.count(hood)}/${CATS_PER_HOOD} here   ${world.cats.total}/${CATS_PER_HOOD * HOODS.length} city`,
    `TIME     ${clockText(sky.hour)} ${sky.label}${settings.time === 'cycle' ? '' : ' (fixed)'}`,
    `WEATHER  ${WEATHER_LABELS[settings.weather].toUpperCase()}`,
    ...(online ? [`ONLINE   ${onlineText()}`] : []),
  ].join('\n'));
  if (hud.nerdsOpen) {
    const budget = 1000 / quality.targetFps;
    hud.setNerds([
      `Renderer       ${presenter.name}`,
      `Frame rate     ${(1000 / quality.frameMs).toFixed(0)} fps (target ${quality.targetFps})   frame ${quality.frameMs.toFixed(1)} ms   cpu ${quality.workMs.toFixed(1)} ms`,
      `Frame times    ${sparkline(frameTimes, budget * 2)}  (full bar = ${(budget * 2).toFixed(0)} ms)`,
      `Grid           ${fb.cols}x${fb.rows} = ${((fb.cols * fb.rows) / 1000).toFixed(1)}k cells`,
      `Cell           ${quality.preset.label}${quality.auto ? ' [auto]' : ''}   pixel ratio ${dpr}`,
      `Detail         ${MAX_DETAIL - quality.detail + 1}/${MAX_DETAIL + 1}   draw distance ${drawDist()} m`,
      `Drawn          ${stats.faces} faces / ${stats.blocks} blocks / ${stats.actors} actors`,
      `Blocks cached  ${world.city.cachedBlocks}`,
      `Position       ${cam.x.toFixed(1)} / ${cam.z.toFixed(1)}   alt ${cam.y.toFixed(1)}`,
      `Bearing        ${bearing.toFixed(0).padStart(3, '0')} ${compass}   pitch ${((cam.pitch * 180) / Math.PI).toFixed(0)} deg`,
      `Viewport       ${window.innerWidth}x${window.innerHeight} css px   canvas ${canvas.width}x${canvas.height}`,
      `World seed     ${worldSeed}`,
      `Audio          ${sound.status}`,
    ].join('\n'));
  }

  let osd: string | null = null;
  if (player.mode === 'cctv') {
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const rec = Math.floor(time * 1.5) % 2 === 0 ? '\u25CF REC' : '  REC';
    osd = `CAM-${String(player.cctv.id).padStart(2, '0')}  ${rec}\n${stamp} UTC\n${district}`;
  } else if (riding()) {
    const st = STATIONS[settings.station];
    const radio = st ? `\u266a ${st.name}  ${st.genre}` : '\u266a radio off';
    const fare = player.mode === 'taxi' ? `\nFARE $${player.fare.toFixed(2)}` : '';
    osd = `${MODE_LABELS[player.mode]}\n${district} loop\n${radio}${fare}`;
  } else if (player.mode === 'rail') {
    const t = world.rail.train(player.train);
    osd = t.at >= 0
      ? `${MODE_LABELS.rail}\n${stopName(player.train, t.at)}\ndoors open`
      : `${MODE_LABELS.rail}\nNEXT  ${stopName(player.train, t.next)}  ${Math.ceil(t.left)} s`;
  } else if (indoors) {
    const lv = levelAt(indoors, player.floorY);
    const lift = player.liftMoving ? `\nLIFT moving...  ${Math.round(player.floorY)} m` : '';
    osd = `${indoors.label}\n${lv ? lv.name : ''}${lift}`;
  }
  if (tour.active) osd = `AUTO TOUR - ${touch ? 'touch' : 'press any key'} to take over\n${osd ?? ''}`;
  hud.setOsd(osd);
  hud.setGoal(world.cats.total === 0);
  hud.setPrompt(prompts());
}

function soundFrame(dt: number): void {
  const indoors = player.inside(world);
  const lv = indoors ? levelAt(indoors, player.floorY) : null;
  const ci = Math.round(cam.x / P), cj = Math.round(cam.z / P);
  const atCrossing = player.mode === 'walk' && !indoors && Math.hypot(cam.x - ci * P, cam.z - cj * P) < 16;
  sound.update({
    dt, cam, mode: player.mode,
    hood: hoodAt(Math.floor(cam.x / P), Math.floor(cam.z / P)),
    indoors: indoors !== null,
    room: lv?.room ?? '',
    weather: settings.weather,
    lift: player.liftPhase,
    cars: world.cars.list,
    crossing: atCrossing && walkWindow(signalPhase(ci, cj, world.time)) > 0,
    night: 1 - sky.day,
    cab: riding(),
    station: settings.station,
    market: world.market.nearest(cam.x, cam.z),
    events: settings.events,
    brownout: brownoutAt(settings.events, world.time),
    stopped: player.mode === 'rail' && world.rail.train(player.train).at >= 0,
  });
}

/**
 * Draw distance after the automatic detail level, and capped in fog where nothing further shows. High
 * up (the Glyph Tower's deck, flying) it reaches further, or the city below would fall outside it.
 */
function drawDist(): number {
  const reach = Math.min(900, Math.max(0, cam.y - 30) * 1.6);
  const d = Math.round((settings.dist + reach) * quality.distScale);
  return settings.weather === 'fog' ? Math.min(d, FOG_FAR) : d;
}

let fireworksShowing = false;

/** Launches and bursts over the docks, heard with the right bearing and delay; a note when a show starts. */
function fireworksFrame(dt: number): void {
  const fw = world.fireworks;
  for (const b of fw.update(dt, world.time, sky.lamps > 0.6, cam, settings.events)) {
    const dx = b.x - cam.x, dz = b.z - cam.z;
    sound.firework(b.kind, Math.sin(Math.atan2(dx, dz) - cam.yaw) * 0.8, Math.hypot(dx, b.y - cam.y, dz));
  }
  if (fw.showing && !fireworksShowing && settings.events === 'periodic' && !photo.active) toast('Fireworks over the docks!', 3000);
  fireworksShowing = fw.showing;
}

let sky = daylightAt(clock.hour, settings.weather);

/** Seconds without input before the tour starts on its own. */
const IDLE_TOUR_S = 45;
const tour = new Tour({
  setMode: (m) => player.setMode(m, world),
  nextHood: () => goToHood((currentHood() + 1) % HOODS.length),
});
let tourFrom: { x: number; y: number; z: number; yaw: number; pitch: number; floorY: number; mode: Mode } | null = null;
let tourSince = 0;

function startTour(): void {
  if (tour.active) return;
  tourFrom = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, floorY: player.floorY, mode: player.mode };
  fullMap = false;
  tourSince = performance.now();
  tour.start();
}

/** Hands control back exactly where the player was before the tour. */
function stopTour(): void {
  tour.stop();
  const s = tourFrom;
  if (!s) return;
  player.setMode('walk', world);
  player.teleport(s.x, s.z, s.yaw, world);
  player.floorY = s.floorY;
  player.y = s.y;
  player.pitch = s.pitch;
  if (s.mode !== 'walk') {
    player.setMode(s.mode, world);
    if (s.mode === 'fly') { player.x = s.x; player.y = s.y; player.z = s.z; }
  }
  world.city.prime();
}

function tourFrame(dt: number): void {
  if (tour.active) {
    if (input.lastActive > tourSince + 250) stopTour();
    else tour.update(dt);
  } else if (!photo.active && !fullMap && performance.now() - input.lastActive > IDLE_TOUR_S * 1000) startTour();
}

let nextMeow = 6;

/** Finding cats, and the odd meow from the nearest hidden one so it can be tracked by ear. */
function catFrame(dt: number): void {
  const cats = world.cats;
  const c = cats.update(dt, cam);
  if (c) {
    const name = HOODS[c.hood].name;
    const n = cats.count(c.hood);
    trackEvent('cat');
    sound.meow(0, 0.3);
    sound.chime();
    toast(n >= CATS_PER_HOOD
      ? `All ${CATS_PER_HOOD} ${name} cats found!${cats.total >= CATS_PER_HOOD * HOODS.length ? ' Every cat in the city. Legend.' : ''}`
      : `Found a cat ${c.where === 'roof' ? 'on a roof' : c.where === 'shop' ? 'indoors' : 'on the street'}!  ${name} ${n}/${CATS_PER_HOOD}`, 3500);
  }
  nextMeow -= dt;
  if (nextMeow <= 0) {
    nextMeow = 8 + Math.random() * 5;
    const h = cats.nearestHidden(cam.x, cam.y, cam.z, 26);
    if (h) {
      const d = Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z);
      sound.meow(Math.sin(Math.atan2(h.x - cam.x, h.z - cam.z) - cam.yaw) * 0.9, 0.22 * (1 - d / 30));
    }
  }
}

/** While recording, the GIF's own small view follows the camera and grabs a frame at the GIF frame rate. */
function gifFrame(dt: number, env: FrameEnv): void {
  if (!gif.active) return;
  gif.follow(cam);
  gif.rain.on = rain.on;
  gif.rain.snow = rain.snow;
  gif.rain.update(dt, gif.cam, gif.fb.cols, gif.fb.rows);
  if (gif.due(dt)) {
    renderScene(gif.fb, gif.cam, world, env, gif.rain);
    gif.capture();
    photo.setBar(`\u25cf REC GIF  ${Math.round(gif.progress * 100)}%`);
  }
  if (!gif.active) void finishGif();
}

let last = performance.now();
let time = 0;
let hudTimer = 0;
let flash = 0;
let lightning = 8;

function frame(now: number): void {
  // The first rAF timestamp can precede the performance.now() taken at startup.
  const frameMs = Math.max(0, now - last);
  last = now;
  const dt = Math.min(0.05, frameMs / 1000);
  // In photo mode the world stands still and only the camera moves, except while a GIF is recording.
  const simDt = photo.active && !gif.active ? 0 : dt;
  time += simDt;

  tourFrame(dt);
  handleKeys();
  touch?.setContext(touchContext());
  sky = daylightAt(clock.advance(simDt, settings.time), settings.weather);
  const dist = drawDist();
  world.update(simDt, player.x, player.z, dist, player.riding(world), player.walker());
  world.market.setLamps(sky.lamps);
  player.update(dt, input, world, cam);
  cam.far = dist;
  cam.fovDeg = settings.fov + (player.mode === 'taxi' ? CAB_FOV : 0);
  cam.update(fb.cols, fb.rows, cellPxW, cellPxH);
  rain.update(simDt, cam, fb.cols, fb.rows);
  fireworksFrame(simDt);

  if (settings.weather === 'rain' && !photo.active) {
    lightning -= dt;
    if (lightning < 0) {
      flash = 1;
      lightning = 7 + Math.random() * 16;
      sound.thunder();
    }
  }
  soundFrame(dt);
  if (!photo.active) catFrame(dt);
  railFrame();
  flash = Math.max(0, flash - dt * 2.5);
  const flicker = flash > 0.55 && flash < 0.75 ? 0.2 : flash;

  const t0 = performance.now();
  setNeon(settings.events, brownoutAt(settings.events, world.time));
  const ride = player.riding(world);
  const station = STATIONS[settings.station];
  const env = {
    time,
    weather: settings.weather,
    flash: flicker,
    propDist: Math.min(170, dist * 0.65),
    hidden: ride,
    cab: ride && player.mode === 'taxi' ? { v: ride, fare: player.fare, radio: station ? station.name : '' } : null,
    liftDoors: player.liftDoors,
    sky,
    others: onlineFrame(dt, photo.active && !gif.active),
    train: player.mode === 'rail' ? player.train : null,
  };
  renderScene(fb, cam, world, env, rain);
  if (staticT > 0) {
    if (!photo.active) addStatic(staticT);
    staticT -= dt;
  }
  if (!photo.active) {
    if (fullMap) drawMap(fb, world, fullMapView(), cam.yaw, time);
    else if (settings.minimap) drawMap(fb, world, miniMapView(), cam.yaw, time);
  }
  presenter.present(fb, settings.style, settings.scan);
  photo.afterPresent(canvas);
  const work = performance.now() - t0;
  gifFrame(dt, env);

  if (quality.sample(frameMs, work, dt)) layout();
  frameTimes.push(frameMs);
  if (frameTimes.length > 48) frameTimes.shift();
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    updateHud();
  }
  requestAnimationFrame(frame);
}

/** During the tour, the spot to resume is where the player was before it started. */
function saveView(): void {
  const s = tour.active && tourFrom ? tourFrom : player;
  saveResume({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, mode: s.mode, floor: s.floorY, hour: clock.hour, seed: worldSeed });
}
setInterval(saveView, 2000);
window.addEventListener('pagehide', saveView);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveView();
});

if (params.get('tour') === '1') startTour();
requestAnimationFrame(frame);
