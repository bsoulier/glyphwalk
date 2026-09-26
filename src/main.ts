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
import { renderScene } from './render/scene';
import { CHARSET } from './core/charset';
import { Input } from './game/input';
import { type TouchButton, TouchControls, touchDevice } from './game/touch';
import { Tour } from './game/tour';
import { MODES, MODE_LABELS, Player, type Mode } from './game/player';
import { HOODS, HOOD_BLOCKS, hoodAt, nearestRegion } from './world/hoods';
import { Sound } from './audio/sound';
import { inCab, levelAt } from './world/interior';
import { signalPhase, walkWindow } from './world/signals';
import { P, setWorldSeed } from './world/layout';
import { World } from './world/world';
import { Hud } from './ui/hud';
import { PhotoMode } from './ui/photo';
import { toast } from './ui/toast';
import { CATS_PER_HOOD } from './world/cats';
import { Quality } from './ui/quality';
import { loadSettings, saveSettings } from './ui/settings';

const params = new URLSearchParams(location.search);
setWorldSeed(Number(params.get('seed')) || 1337);

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
const quality = new Quality(settings.cell, settings.fps);
const fb = new FrameBuffer();
const cam = new Camera();
const rain = new Rain();
const world = new World();
const player = new Player();
const input = new Input(canvas);
const sound = new Sound();
sound.setEnabled(settings.sound);
// Audio may only start from a user gesture, so every tap or key press tries.
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, () => sound.unlock());
if (import.meta.env.DEV) Object.assign(window, { glyphwalk: { world, player, sound, get tour() { return tour; } } });

// Bookmarkable views: ?cam=x,y,z,yaw,pitch&mode=fly&rain=0
const camParam = params.get('cam')?.split(',').map(Number);
if (camParam && camParam.length >= 3 && camParam.every(Number.isFinite)) {
  [player.x, player.y, player.z] = camParam;
  player.yaw = camParam[3] ?? player.yaw;
  player.pitch = camParam[4] ?? player.pitch;
}
const modeParam = params.get('mode');
if (modeParam && (MODES as readonly string[]).includes(modeParam)) player.setMode(modeParam as Mode, world);
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
let mapZoom = 1;
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
});

function persist(): void {
  saveSettings(settings);
  hud.sync(settings, quality.cellSetting);
}

let cellPxW = 1;
let cellPxH = 1;
let dpr = 1;

function layout(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
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

const touch = touchDevice()
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
  const hint = document.getElementById('hint') as HTMLElement;
  hint.textContent = 'left: move (push far to run) \u00b7 right: look';
  document.body.classList.add('touch');
  setTimeout(() => hint.classList.add('gone'), 8000);
}

const photo = new PhotoMode(touch !== null);
photo.onShot = () => sound.shutter();

function togglePhoto(): void {
  photo.toggle();
  if (photo.active) {
    const district = HOODS[currentHood()].name.toLowerCase().replace(/\s+/g, '-');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    photo.name = `glyphwalk-${district}-${sky.label}-${stamp}`;
  }
}

/** Buttons that only apply right now: photo actions, map zoom, flying up and down, or riding a lift. */
function touchContext(): TouchButton[] {
  if (photo.active) return [{ label: 'SAVE', code: 'Enter' }, { label: 'COPY', code: 'KeyC' }, { label: 'EXIT', code: 'KeyP' }];
  if (fullMap) return [{ label: 'ZOOM +', code: 'Equal' }, { label: 'ZOOM -', code: 'Minus' }];
  if (player.mode === 'fly') return [{ label: 'RISE', code: 'KeyE', hold: true }, { label: 'SINK', code: 'KeyQ', hold: true }];
  const it = player.inside(world);
  if (it && !player.liftMoving && inCab(it, player.x, player.z)) return [{ label: 'LIFT UP', code: 'KeyE' }, { label: 'LIFT DN', code: 'KeyQ' }];
  return [];
}

canvas.addEventListener('wheel', (e) => {
  if (!fullMap) return;
  e.preventDefault();
  mapZoom = Math.max(0, Math.min(MAP_ZOOMS.length - 1, mapZoom + (e.deltaY > 0 ? 1 : -1)));
}, { passive: false });

let staticT = 0;
player.onCut = () => {
  staticT = 0.3;
};

function handleKeys(): void {
  for (const code of input.takePressed()) {
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
      case 'KeyE': player.useLift(1, world); break;
      case 'KeyQ': player.useLift(-1, world); break;
      case 'KeyP': togglePhoto(); break;
      case 'KeyO': startTour(); break;
      case 'Enter': if (photo.active) photo.requestPng(); break;
      case 'KeyC': if (photo.active) photo.copyText(fb); break;
      case 'Escape':
        fullMap = false;
        if (photo.active) togglePhoto();
        break;
      case 'Equal':
      case 'NumpadAdd':
        mapZoom = Math.max(0, mapZoom - 1);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        mapZoom = Math.min(MAP_ZOOMS.length - 1, mapZoom + 1);
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
        settings.style = (settings.style + 1) % STYLE_NAMES.length;
        persist();
        break;
      case 'KeyT':
        settings.scan = !settings.scan;
        persist();
        break;
      case 'KeyU':
        settings.sound = !settings.sound;
        sound.setEnabled(settings.sound);
        persist();
        break;
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

function updateHud(): void {
  const bearing = (((cam.yaw * 180) / Math.PI) % 360 + 360) % 360;
  const compass = COMPASS[Math.round(bearing / 45) % 8];
  const hood = hoodAt(Math.floor(cam.x / P), Math.floor(cam.z / P));
  const district = HOODS[hood].name;
  const indoors = player.inside(world);
  hud.setHood(hood);
  hud.setStats([
    `MODE     ${MODE_LABELS[player.mode]}`,
    `FPS      ${(1000 / quality.frameMs).toFixed(0).padStart(3)}   cpu ${quality.workMs.toFixed(1)} ms`,
    `GRID     ${fb.cols}x${fb.rows} = ${((fb.cols * fb.rows) / 1000).toFixed(1)}k cells`,
    `CELL     ${quality.preset.label}${quality.auto ? ' [auto]' : ''}`,
    `DRAWN    ${stats.faces} faces / ${stats.blocks} blocks / ${stats.actors} actors`,
    `POS      ${cam.x.toFixed(1)} / ${cam.z.toFixed(1)}  alt ${cam.y.toFixed(1)}`,
    `BEARING  ${bearing.toFixed(0).padStart(3, '0')} ${compass}`,
    `SECTOR   ${district}${indoors ? ` / ${indoors.label}` : ''}`,
    `CATS     ${district} ${world.cats.count(hood)}/${CATS_PER_HOOD}   city ${world.cats.total}/${CATS_PER_HOOD * HOODS.length}`,
    `TIME     ${clockText(sky.hour)} ${sky.label}${settings.time === 'cycle' ? '' : ' (fixed)'}`,
    `WEATHER  ${WEATHER_LABELS[settings.weather].toUpperCase()}`,
    `RENDER   ${presenter.name}`,
  ].join('\n'));

  let osd: string | null = null;
  if (player.mode === 'cctv') {
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const rec = Math.floor(time * 1.5) % 2 === 0 ? '\u25CF REC' : '  REC';
    osd = `CAM-${String(player.cctv.id).padStart(2, '0')}  ${rec}\n${stamp} UTC\n${district}`;
  } else if (player.mode === 'taxi' || player.mode === 'sky') {
    osd = `${MODE_LABELS[player.mode]}\n${district} loop\nN: next vehicle in ${district}`;
  } else if (player.mode === 'rail') {
    osd = `${MODE_LABELS[player.mode]}\n${district} shuttle`;
  } else if (indoors) {
    const lv = levelAt(indoors, player.floorY);
    const hint = player.liftMoving ? 'LIFT moving...' : inCab(indoors, player.x, player.z) ? 'LIFT  E up / Q down' : indoors.lift ? 'Lift at the back' : '';
    osd = `${indoors.label}\n${lv ? lv.name : ''}\n${hint}`;
  }
  if (tour.active) osd = `AUTO TOUR - ${touch ? 'touch' : 'press any key'} to take over\n${osd ?? ''}`;
  hud.setOsd(osd);
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
    floor: lv?.floor ?? -1,
    weather: settings.weather,
    steps: player.steps,
    running: player.running,
    lift: player.liftPhase,
    cars: world.cars.list,
    crossing: atCrossing && walkWindow(signalPhase(ci, cj, world.time)) > 0,
    night: 1 - sky.day,
  });
}

const clock = new Clock();
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
  // In photo mode the world stands still; only the camera moves.
  const simDt = photo.active ? 0 : dt;
  time += simDt;

  tourFrame(dt);
  handleKeys();
  touch?.setContext(touchContext());
  sky = daylightAt(clock.advance(simDt, settings.time), settings.weather);
  world.update(simDt, player.x, player.z, settings.dist, player.riding(world), player.walker());
  player.update(dt, input, world, cam);
  cam.far = settings.weather === 'fog' ? Math.min(settings.dist, FOG_FAR) : settings.dist;
  cam.fovDeg = settings.fov;
  cam.update(fb.cols, fb.rows, cellPxW, cellPxH);
  rain.update(simDt, cam, fb.cols, fb.rows);

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
  flash = Math.max(0, flash - dt * 2.5);
  const flicker = flash > 0.55 && flash < 0.75 ? 0.2 : flash;

  const t0 = performance.now();
  renderScene(fb, cam, world, {
    time,
    weather: settings.weather,
    flash: flicker,
    propDist: Math.min(170, settings.dist * 0.65),
    hidden: player.mode === 'sky' ? player.riding(world) : null,
    liftDoors: player.liftDoors,
    sky,
  }, rain);
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

  if (quality.sample(frameMs, work, dt)) layout();
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    updateHud();
  }
  requestAnimationFrame(frame);
}

if (params.get('tour') === '1') startTour();
requestAnimationFrame(frame);
