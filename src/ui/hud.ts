import { STYLE_NAMES } from '../render/presenter';
import { CELL_PRESETS } from './quality';
import type { Settings } from './settings';

export interface HudHandlers {
  onCell(id: string): void;
  onFps(fps: number): void;
  onDist(dist: number): void;
  onFov(fov: number): void;
  onStyle(style: number): void;
}

const DISTANCES = [120, 180, 260, 400, 600];
const FOVS = [50, 62, 75, 90];
const FPS = [30, 60];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function fill(sel: HTMLSelectElement, options: readonly [string, string][]): void {
  sel.innerHTML = '';
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.append(o);
  }
}

export class Hud {
  private readonly root = $('hud');
  private readonly stats = $('stats');
  private readonly osd = $('osd');
  private readonly cell = $('sel-cell') as HTMLSelectElement;
  private readonly fps = $('sel-fps') as HTMLSelectElement;
  private readonly dist = $('sel-dist') as HTMLSelectElement;
  private readonly fov = $('sel-fov') as HTMLSelectElement;
  private readonly style = $('sel-style') as HTMLSelectElement;

  constructor(handlers: HudHandlers) {
    fill(this.cell, [['auto', 'Auto (fit target FPS)'], ...CELL_PRESETS.map((p): [string, string] => [p.id, p.label])]);
    fill(this.fps, FPS.map((f): [string, string] => [String(f), `${f} fps`]));
    fill(this.dist, DISTANCES.map((d): [string, string] => [String(d), `${d} m`]));
    fill(this.fov, FOVS.map((f): [string, string] => [String(f), `${f} deg`]));
    fill(this.style, STYLE_NAMES.map((n, k): [string, string] => [String(k), n]));
    const bind = (sel: HTMLSelectElement, fn: (v: string) => void) => {
      sel.addEventListener('change', () => {
        fn(sel.value);
        sel.blur();
      });
    };
    bind(this.cell, (v) => handlers.onCell(v));
    bind(this.fps, (v) => handlers.onFps(Number(v)));
    bind(this.dist, (v) => handlers.onDist(Number(v)));
    bind(this.fov, (v) => handlers.onFov(Number(v)));
    bind(this.style, (v) => handlers.onStyle(Number(v)));
  }

  sync(s: Settings, cellSetting: string): void {
    this.cell.value = cellSetting;
    this.fps.value = String(s.fps);
    this.dist.value = String(s.dist);
    this.fov.value = String(s.fov);
    this.style.value = String(s.style);
    this.root.classList.toggle('hidden', !s.hud);
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  setOsd(text: string | null): void {
    this.osd.classList.toggle('on', text !== null);
    if (text !== null) this.osd.textContent = text;
  }
}
