import { describe, expect, it } from 'vitest';
import { Camera } from '../../src/render/camera';
import type { EventMode } from '../../src/world/events';
import { Fireworks, type Bang } from '../../src/world/fireworks';
import { HOOD_BLOCKS, H_DOCKS, nearestRegion } from '../../src/world/hoods';
import { P } from '../../src/world/layout';

/** A camera standing at the centre of the nearest Docklands region, where the shows are launched. */
function camAtDocks(): Camera {
  const r = nearestRegion(H_DOCKS, 0, 0);
  if (!r) throw new Error('no docks region');
  const cam = new Camera();
  cam.x = (r[0] + 0.5) * HOOD_BLOCKS * P;
  cam.z = (r[1] + 0.5) * HOOD_BLOCKS * P + 60;
  return cam;
}

function run(mode: EventMode, from: number, seconds: number, night = true): { bangs: Bang[]; fw: Fireworks } {
  const fw = new Fireworks();
  const cam = camAtDocks();
  const bangs: Bang[] = [];
  for (let t = from; t < from + seconds; t += 0.05) bangs.push(...fw.update(0.05, t, night, cam, mode));
  return { bangs, fw };
}

describe('fireworks', () => {
  it('launches rockets that burst into sparks during a show at night', () => {
    const { bangs, fw } = run('periodic', 0, 6);
    expect(bangs.filter((b) => b.kind === 'launch').length).toBeGreaterThan(2);
    expect(bangs.filter((b) => b.kind === 'burst').length).toBeGreaterThan(0);
    expect(fw.busy).toBe(true);
    expect(fw.showing).toBe(true);
  });

  it('bursts high above the city', () => {
    const { bangs } = run('always', 0, 8);
    for (const b of bangs.filter((x) => x.kind === 'burst')) expect(b.y).toBeGreaterThan(60);
  });

  it('stays quiet by day, between shows, and when switched off', () => {
    expect(run('periodic', 0, 5, false).bangs).toHaveLength(0);
    expect(run('periodic', 100, 5).bangs).toHaveLength(0);
    expect(run('off', 0, 5).bangs).toHaveLength(0);
  });
});
