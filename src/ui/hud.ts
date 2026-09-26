import { RADIO_OFF, STATIONS } from '../audio/radio';
import { SOUND_KINDS, SOUND_KIND_LABELS, type SoundKind } from '../audio/sound';
import { TIME_LABELS, TIME_MODES, type TimeMode } from '../render/daylight';
import { STYLE_NAMES } from '../render/presenter';
import { WEATHERS, WEATHER_LABELS, type Weather } from '../render/weather';
import { EVENT_LABELS, EVENT_MODES, type EventMode } from '../world/events';
import { HOODS } from '../world/hoods';
import { CELL_PRESETS } from './quality';
import type { Settings } from './settings';

export interface HudHandlers {
  onHood(hood: number): void;
  onCell(id: string): void;
  onFps(fps: number): void;
  onDist(dist: number): void;
  onFov(fov: number): void;
  onStyle(style: number): void;
  onTime(mode: TimeMode): void;
  onWeather(weather: Weather): void;
  onRadio(station: number): void;
  onShare(): void;
  onSound(on: boolean): void;
  onVolume(volume: number): void;
  onSoundKind(kind: SoundKind, on: boolean): void;
  onNerds(on: boolean): void;
  onEvents(mode: EventMode): void;
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
  private readonly nerds = $('nerds');
  private readonly nerdsBody = $('nerds-body');
  private readonly hood = $('sel-hood') as HTMLSelectElement;
  private readonly cell = $('sel-cell') as HTMLSelectElement;
  private readonly fps = $('sel-fps') as HTMLSelectElement;
  private readonly dist = $('sel-dist') as HTMLSelectElement;
  private readonly fov = $('sel-fov') as HTMLSelectElement;
  private readonly style = $('sel-style') as HTMLSelectElement;
  private readonly time = $('sel-time') as HTMLSelectElement;
  private readonly weather = $('sel-weather') as HTMLSelectElement;
  private readonly radio = $('sel-radio') as HTMLSelectElement;
  private readonly events = $('sel-events') as HTMLSelectElement;
  private readonly sound = $('chk-sound') as HTMLInputElement;
  private readonly volume = $('rng-volume') as HTMLInputElement;
  private readonly kindsBox = $('sound-kinds');
  private readonly kinds = new Map<SoundKind, HTMLInputElement>();
  private readonly nerdsCheck = $('chk-nerds') as HTMLInputElement;

  constructor(handlers: HudHandlers) {
    fill(this.time, TIME_MODES.map((m): [string, string] => [m, TIME_LABELS[m]]));
    fill(this.weather, WEATHERS.map((w): [string, string] => [w, WEATHER_LABELS[w]]));
    fill(this.events, EVENT_MODES.map((m): [string, string] => [m, EVENT_LABELS[m]]));
    fill(this.radio, [...STATIONS.map((s, k): [string, string] => [String(k), `${s.name} (${s.genre})`]), [String(RADIO_OFF), 'Off']]);
    fill(this.hood, HOODS.map((h, k): [string, string] => [String(k), h.name]));
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
    bind(this.hood, (v) => handlers.onHood(Number(v)));
    bind(this.cell, (v) => handlers.onCell(v));
    bind(this.fps, (v) => handlers.onFps(Number(v)));
    bind(this.dist, (v) => handlers.onDist(Number(v)));
    bind(this.fov, (v) => handlers.onFov(Number(v)));
    bind(this.style, (v) => handlers.onStyle(Number(v)));
    bind(this.time, (v) => handlers.onTime(v as TimeMode));
    bind(this.weather, (v) => handlers.onWeather(v as Weather));
    bind(this.radio, (v) => handlers.onRadio(Number(v)));
    bind(this.events, (v) => handlers.onEvents(v as EventMode));
    const share = $('btn-share');
    share.addEventListener('click', () => {
      share.blur();
      handlers.onShare();
    });

    // Checkboxes and the slider give focus back to the game, so keys keep working after a click.
    const check = (el: HTMLInputElement, fn: (on: boolean) => void) => {
      el.addEventListener('change', () => {
        fn(el.checked);
        el.blur();
      });
    };
    check(this.sound, (on) => handlers.onSound(on));
    this.volume.addEventListener('input', () => handlers.onVolume(Number(this.volume.value) / 100));
    this.volume.addEventListener('change', () => this.volume.blur());
    for (const k of SOUND_KINDS) {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      label.append(box, ` ${SOUND_KIND_LABELS[k]}`);
      this.kindsBox.append(label);
      this.kinds.set(k, box);
      check(box, (on) => handlers.onSoundKind(k, on));
    }
    check(this.nerdsCheck, (on) => handlers.onNerds(on));
    $('nerds-close').addEventListener('click', () => handlers.onNerds(false));
  }

  sync(s: Settings, cellSetting: string): void {
    this.time.value = s.time;
    this.weather.value = s.weather;
    this.cell.value = cellSetting;
    this.fps.value = String(s.fps);
    this.dist.value = String(s.dist);
    this.fov.value = String(s.fov);
    this.style.value = String(s.style);
    this.radio.value = String(s.station);
    this.events.value = s.events;
    this.sound.checked = s.sound;
    if (document.activeElement !== this.volume) this.volume.value = String(Math.round(s.volume * 100));
    for (const [k, box] of this.kinds) box.checked = !s.soundOff.includes(k);
    this.kindsBox.classList.toggle('muted', !s.sound);
    this.nerdsCheck.checked = s.nerds;
    this.nerds.hidden = !s.nerds;
    this.root.classList.toggle('hidden', !s.hud);
  }

  /** Reflects the district under the camera, unless the user is currently choosing one. */
  setHood(hood: number): void {
    if (document.activeElement !== this.hood) this.hood.value = String(hood);
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  get nerdsOpen(): boolean {
    return !this.nerds.hidden;
  }

  setNerds(text: string): void {
    this.nerdsBody.textContent = text;
  }

  setOsd(text: string | null): void {
    this.osd.classList.toggle('on', text !== null);
    if (text !== null) this.osd.textContent = text;
  }
}
