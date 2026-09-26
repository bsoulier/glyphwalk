import type { TimeMode } from '../render/daylight';
import { WEATHERS, type Weather } from '../render/weather';

export interface Settings {
  time: TimeMode;
  weather: Weather;
  cell: string;
  fps: number;
  dist: number;
  fov: number;
  style: number;
  scan: boolean;
  hud: boolean;
  minimap: boolean;
  sound: boolean;
}

const KEY = 'glyphwalk.settings.v1';

const DEFAULTS: Settings = {
  time: 'cycle',
  weather: 'rain',
  cell: 'auto',
  fps: 60,
  dist: 260,
  fov: 62,
  style: 0,
  scan: true,
  hud: true,
  minimap: true,
  sound: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { rain?: boolean };
      // Older saves only knew rain on or off.
      if (saved.weather === undefined && saved.rain !== undefined) saved.weather = saved.rain ? 'rain' : 'clear';
      delete saved.rain;
      const s = { ...DEFAULTS, ...saved };
      if (!WEATHERS.includes(s.weather)) s.weather = DEFAULTS.weather;
      return s;
    }
  } catch {
    // Corrupt or blocked storage just means defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode can refuse writes; settings then last for the session only.
  }
}
