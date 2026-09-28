import { beforeEach, describe, expect, it } from 'vitest';
import { loadResume, saveResume, type ResumeView } from '../../src/ui/resume';
import { loadSettings, saveSettings } from '../../src/ui/settings';
import { stubLocalStorage } from './storage';

let store: Map<string, string>;
beforeEach(() => {
  store = stubLocalStorage();
});

describe('settings', () => {
  it('starts from the defaults', () => {
    const s = loadSettings();
    expect(s.weather).toBe('rain');
    expect(s.time).toBe('cycle');
    expect(s.events).toBe('periodic');
    expect(s.sound).toBe(true);
    expect(s.soundOff).toEqual([]);
    expect(s.nerds).toBe(false);
  });

  it('round-trips every choice the user makes', () => {
    const s = loadSettings();
    Object.assign(s, { weather: 'snow', time: 'night', events: 'off', style: 2, dist: 180, station: 3, volume: 0.4, soundOff: ['radio'], nerds: true, mapZoom: 3, open: ['display'] });
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it('repairs old or damaged saves instead of failing', () => {
    store.set('glyphwalk.settings.v1', JSON.stringify({ rain: false }));
    expect(loadSettings().weather).toBe('clear');
    store.set('glyphwalk.settings.v1', JSON.stringify({ weather: 'hail', events: 'sometimes', soundOff: ['radio', 'bogus'], open: 'keys' }));
    const s = loadSettings();
    expect([s.weather, s.events, s.soundOff, s.open]).toEqual(['rain', 'periodic', ['radio'], []]);
    store.set('glyphwalk.settings.v1', '{not json');
    expect(loadSettings().weather).toBe('rain');
  });
});

describe('resume where the last session ended', () => {
  const view: ResumeView = { x: 390.2, y: 1.7, z: 134.2, yaw: -2.36, pitch: 0.1, mode: 'walk', floor: 4.2, hour: 23.5, seed: 1337 };

  it('restores the saved view in the same city', () => {
    saveResume(view);
    expect(loadResume(1337)).toEqual(view);
  });

  it('ignores a view from another city, an unknown mode, or broken numbers', () => {
    saveResume(view);
    expect(loadResume(42)).toBeNull();
    saveResume({ ...view, mode: 'boat' as ResumeView['mode'] });
    expect(loadResume(1337)).toBeNull();
    saveResume({ ...view, x: Number.NaN });
    expect(loadResume(1337)).toBeNull();
    store.set('glyphwalk.view.v1', '{oops');
    expect(loadResume(1337)).toBeNull();
  });
});
