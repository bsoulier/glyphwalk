import { beforeEach, describe, expect, it, vi } from 'vitest';
import { viewUrl, type View } from '../../src/ui/share';

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://bsoulier.github.io', pathname: '/glyphwalk/' });
});

const base: View = { x: 133.62, y: 1.7, z: 413.686, yaw: 1.2, pitch: 0.15, mode: 'walk', floor: 0, hour: 18.15, time: 'cycle', weather: 'rain', seed: 1337 };

function params(v: View): URLSearchParams {
  const url = new URL(viewUrl(v));
  expect(url.origin + url.pathname).toBe('https://bsoulier.github.io/glyphwalk/');
  return url.searchParams;
}

describe('share links', () => {
  it('carry the exact view, rounded to keep them short', () => {
    const p = params(base);
    expect(p.get('cam')).toBe('133.6,1.7,413.7,1.20,0.15');
    expect(p.get('mode')).toBe('walk');
    expect(p.get('weather')).toBe('rain');
    expect(p.get('time')).toBe('cycle');
    expect(p.get('hour')).toBe('18.15');
  });

  it('leave out what the defaults already say', () => {
    const p = params(base);
    expect(p.has('floor')).toBe(false);
    expect(p.has('seed')).toBe(false);
    expect(params({ ...base, time: 'dusk' }).has('hour')).toBe(false);
  });

  it('keep the storey and a non-default city', () => {
    const p = params({ ...base, floor: 8.4, seed: 7 });
    expect(p.get('floor')).toBe('8.4');
    expect(p.get('seed')).toBe('7');
  });

  it('wrap the heading into a single turn and keep commas readable', () => {
    expect(params({ ...base, yaw: 1.2 + Math.PI * 4 }).get('cam')?.split(',')[3]).toBe('1.20');
    expect(viewUrl(base)).toContain('cam=133.6,1.7');
  });
});
