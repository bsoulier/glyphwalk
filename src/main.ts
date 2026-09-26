import './style.css';
import { buildAtlas } from './render/atlas';
import { Camera } from './render/camera';
import { FrameBuffer } from './render/framebuffer';
import { CanvasPresenter, STYLE_NAMES, WebGLPresenter, type Presenter } from './render/presenter';
import { Rain } from './render/rain';
import { stats } from './render/raster';
import { renderScene } from './render/scene';
import { CHARSET } from './core/charset';
import { Input } from './game/input';
import { MODES, MODE_LABELS, Player, type Mode } from './game/player';
import { DISTRICTS, P, districtAt, setWorldSeed } from './world/layout';
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

const hud = new Hud({
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

function layout(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  const district = DISTRICTS[districtAt(Math.floor(cam.x / P), Math.floor(cam.z / P))].name;
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
  } else if (player.mode === 'taxi' || player.mode === 'sky' || player.mode === 'rail') {
    hud.setOsd(`${MODE_LABELS[player.mode]}\n${district}\nN: next vehicle`);
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
  world.update(dt, player.x, player.z, settings.dist, player.riding(world));
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
