import type { TimeMode } from '../render/daylight';
import type { Weather } from '../render/weather';

/** Everything needed to reopen the game on exactly this frame. */
export interface View {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: 'walk' | 'fly';
  /** Storey the walker stands on inside a building, 0 at street level. */
  floor: number;
  hour: number;
  time: TimeMode;
  weather: Weather;
  seed: number;
}

/** The same parameters main.ts reads at startup, rounded so the link stays short. */
export function viewUrl(v: View): string {
  const yaw = Math.atan2(Math.sin(v.yaw), Math.cos(v.yaw));
  const q = new URLSearchParams();
  q.set('cam', [v.x.toFixed(1), v.y.toFixed(1), v.z.toFixed(1), yaw.toFixed(2), v.pitch.toFixed(2)].join(','));
  q.set('mode', v.mode);
  if (v.floor > 0.5) q.set('floor', v.floor.toFixed(1));
  q.set('time', v.time);
  if (v.time === 'cycle') q.set('hour', v.hour.toFixed(2));
  q.set('weather', v.weather);
  if (v.seed !== 1337) q.set('seed', String(v.seed));
  return `${location.origin}${location.pathname}?${q.toString().replace(/%2C/g, ',')}`;
}

/**
 * Phones get the native share sheet; everything else copies to the clipboard. Returns what happened
 * so the caller can say so ('cancelled' when the user closed the share sheet).
 */
export async function shareUrl(url: string, text: string, preferSheet: boolean): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (preferSheet && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Glyphwalk', text, url });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
