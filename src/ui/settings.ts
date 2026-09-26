export interface Settings {
  cell: string;
  fps: number;
  dist: number;
  fov: number;
  style: number;
  scan: boolean;
  rain: boolean;
  hud: boolean;
  minimap: boolean;
}

const KEY = 'glyphwalk.settings.v1';

const DEFAULTS: Settings = {
  cell: 'auto',
  fps: 60,
  dist: 260,
  fov: 62,
  style: 0,
  scan: true,
  rain: true,
  hud: true,
  minimap: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
