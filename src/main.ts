import './style.css';
import { buildAtlas } from './render/atlas';
import { Camera } from './render/camera';
import { FrameBuffer } from './render/framebuffer';
import { drawMap, mapToWorld, type MapView } from './render/map';
import { CanvasPresenter, STYLE_NAMES, WebGLPresenter, type Presenter } from './render/presenter';
import { Rain } from './render/rain';
import { stats } from './render/raster';
import { renderScene } from './render/scene';
import { CHARSET } from './core/charset';
import { Input } from './game/input';
import { MODES, MODE_LABELS, Player, type Mode } from './game/player';
import { HOODS, HOOD_BLOCKS, hoodAt, nearestRegion } from './world/hoods';
import { P, setWorldSeed } from './world/layout';
import { World } from './world/world';
import { Hud } from './ui/hud';
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
if (import.meta.env.DEV) Object.assign(window, { glyphwalk: { world, player } });

// Bookmarkable views: ?cam=x,y,z,yaw,pitch&mode=fly&rain=0
const camParam = params.get('cam')?.split(',').map(Number);
if (camParam && camParam.length >= 3 && camParam.every(Number.isFinite)) {
  [player.x, player.y, player.z] = camParam;
  player.yaw = camParam[3] ?? player.yaw;
  player.pitch = camParam[4] ?? player.pitch;
}
const modeParam = params.get('mode');
if (modeParam && (MODES as readonly string[]).includes(modeParam)) player.setMode(modeParam as Mode, world);
if (params.has('rain')) settings.rain = params.get('rain') !== '0';
const cellParam = params.get('cell');
if (cellParam) quality.set(cellParam);
rain.on = settings.rain;

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

canvas.addEventListener('mousedown', (e) => {
  if (!fullMap) return;
  const r = canvas.getBoundingClientRect();
  const col = Math.floor(((e.clientX - r.left) / r.width) * fb.cols);
  const row = Math.floor(((e.clientY - r.top) / r.height) * fb.rows);
  const at = mapToWorld(fullMapView(), col, row);
  if (!at) return;
  jumpTo(at[0], at[1]);
  fullMap = false;
});

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
      case 'Escape': fullMap = false; break;
      case 'Equal':
      case 'NumpadAdd':
        mapZoom = Math.max(0, mapZoom - 1);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        mapZoom = Math.min(MAP_ZOOMS.length - 1, mapZoom + 1);
        break;
      case 'KeyR':
        settings.rain = !settings.rain;
        rain.on = settings.rain;
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
  hud.setHood(hood);
  hud.setStats([
    `MODE     ${MODE_LABELS[player.mode]}`,
    `FPS      ${(1000 / quality.frameMs).toFixed(0).padStart(3)}   cpu ${quality.workMs.toFixed(1)} ms`,
    `GRID     ${fb.cols}x${fb.rows} = ${((fb.cols * fb.rows) / 1000).toFixed(1)}k cells`,
    `CELL     ${quality.preset.label}${quality.auto ? ' [auto]' : ''}`,
    `DRAWN    ${stats.faces} faces / ${stats.blocks} blocks / ${stats.actors} actors`,
    `POS      ${cam.x.toFixed(1)} / ${cam.z.toFixed(1)}  alt ${cam.y.toFixed(1)}`,
    `BEARING  ${bearing.toFixed(0).padStart(3, '0')} ${compass}`,
    `SECTOR   ${district}`,
    `WEATHER  ${settings.rain ? 'RAIN' : 'CLEAR'}`,
    `RENDER   ${presenter.name}`,
  ].join('\n'));

  if (player.mode === 'cctv') {
    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const rec = Math.floor(time * 1.5) % 2 === 0 ? '\u25CF REC' : '  REC';
    hud.setOsd(`CAM-${String(player.cctv.id).padStart(2, '0')}  ${rec}\n${stamp} UTC\n${district}`);
  } else if (player.mode === 'taxi' || player.mode === 'sky') {
    hud.setOsd(`${MODE_LABELS[player.mode]}\n${district} loop\nN: next vehicle in ${district}`);
  } else if (player.mode === 'rail') {
    hud.setOsd(`${MODE_LABELS[player.mode]}\n${district} shuttle`);
  } else hud.setOsd(null);
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
  time += dt;

  handleKeys();
  world.update(dt, player.x, player.z, settings.dist, player.riding(world), player.walker());
  player.update(dt, input, world, cam);
  cam.far = settings.dist;
  cam.fovDeg = settings.fov;
  cam.update(fb.cols, fb.rows, cellPxW, cellPxH);
  rain.update(dt, cam, fb.cols, fb.rows);

  if (settings.rain) {
    lightning -= dt;
    if (lightning < 0) {
      flash = 1;
      lightning = 7 + Math.random() * 16;
    }
  }
  flash = Math.max(0, flash - dt * 2.5);
  const flicker = flash > 0.55 && flash < 0.75 ? 0.2 : flash;

  const t0 = performance.now();
  renderScene(fb, cam, world, {
    time,
    rain: settings.rain,
    flash: flicker,
    propDist: Math.min(170, settings.dist * 0.65),
    hidden: player.mode === 'sky' ? player.riding(world) : null,
  }, rain);
  if (staticT > 0) {
    addStatic(staticT);
    staticT -= dt;
  }
  if (fullMap) drawMap(fb, world, fullMapView(), cam.yaw, time);
  else if (settings.minimap) drawMap(fb, world, miniMapView(), cam.yaw, time);
  presenter.present(fb, settings.style, settings.scan);
  const work = performance.now() - t0;

  if (quality.sample(frameMs, work, dt)) layout();
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    updateHud();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
