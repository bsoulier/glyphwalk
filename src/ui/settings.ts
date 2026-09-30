import { SOUND_KINDS, type SoundKind } from '../audio/sound';
import type { TimeMode } from '../render/daylight';
import { WEATHERS, type Weather } from '../render/weather';
import { EVENT_MODES, type EventMode } from '../world/events';

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
  /** Master volume, 0 to 1. */
  volume: number;
  /** Kinds of sound switched off. */
  soundOff: SoundKind[];
  /** Taxi radio station (RADIO_OFF for off). */
  station: number;
  /** The "stats for nerds" overlay. */
  nerds: boolean;
  /** Zoom step of the full map. */
  mapZoom: number;
  /** How often fireworks and neon glitches happen. */
  events: EventMode;
  /** Ids of the settings panel's folding sections that are open. */
  open: string[];
  /** Play online (see other players and be seen), when the build has a server. */
  online: boolean;
}

/**
 * The "ludicrous" draw distance: far past what the game is tuned for, offered anyway with a warning. The
 * automatic detail level leaves it alone, since it would only take it back, so frames run as slow as they must.
 */
export const LUDICROUS_DIST = 1500;

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
  volume: 1,
  soundOff: [],
  station: 0,
  nerds: false,
  mapZoom: 1,
  events: 'periodic',
  open: [],
  online: true,
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
      if (!EVENT_MODES.includes(s.events)) s.events = DEFAULTS.events;
      if (!Array.isArray(s.soundOff)) s.soundOff = [];
      s.soundOff = s.soundOff.filter((k) => SOUND_KINDS.includes(k));
      s.open = Array.isArray(s.open) ? s.open.filter((id) => typeof id === 'string') : [];
      return s;
    }
  } catch {
    // Corrupt or blocked storage just means defaults.
  }
  return { ...DEFAULTS, soundOff: [], open: [] };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode can refuse writes; settings then last for the session only.
  }
}
