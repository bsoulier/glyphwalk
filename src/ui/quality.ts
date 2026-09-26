export interface CellPreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

/** Cell sizes in CSS pixels. The grid always fills the window, so smaller cells = more cells to render. */
export const CELL_PRESETS: readonly CellPreset[] = [
  { id: 'xs', label: 'XS 4x7 (densest)', w: 4, h: 7 },
  { id: 's', label: 'S 5x9', w: 5, h: 9 },
  { id: 'm', label: 'M 6x11', w: 6, h: 11 },
  { id: 'l', label: 'L 8x14', w: 8, h: 14 },
  { id: 'xl', label: 'XL 10x18', w: 10, h: 18 },
  { id: 'xxl', label: 'XXL 13x24 (fastest)', w: 13, h: 24 },
];

/**
 * Detail levels below full: each shortens the draw distance (the biggest cost after the cell count),
 * and the last also drops the canvas to one pixel per CSS pixel for weak GPUs.
 */
const DETAIL_DIST = [1, 0.8, 0.62, 0.48];
export const MAX_DETAIL = DETAIL_DIST.length - 1;

/**
 * In auto mode quality moves along this ladder of (cell preset, detail level) steps, trading a little
 * of each in turn so that neither the glyphs nor the view distance collapse first. Below 5x9 px glyphs
 * stop reading as characters, so auto never goes denser than S; XS is manual-only.
 */
const LADDER: readonly (readonly [number, number])[] = [
  [1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [4, 2], [4, 3], [5, 3],
];

/**
 * Steps down the ladder when frames run long and back up when the CPU-side work leaves plenty of headroom.
 * The gap between the two thresholds prevents flip-flopping. With a manual cell size only the detail moves.
 */
export class Quality {
  auto: boolean;
  index: number;
  detail = 0;
  targetFps: number;
  frameMs = 16;
  workMs = 4;
  private rung = 1;
  private cooldown = 2;

  constructor(cell: string, targetFps: number, lowEnd = false) {
    this.auto = cell === 'auto';
    const k = CELL_PRESETS.findIndex((p) => p.id === cell);
    this.index = k >= 0 ? k : 2;
    this.targetFps = targetFps;
    if (lowEnd) {
      this.detail = 1;
      if (this.auto) this.rung = 2;
    }
    if (this.auto) [this.index, this.detail] = LADDER[this.rung];
  }

  get preset(): CellPreset {
    return CELL_PRESETS[this.index];
  }

  get cellSetting(): string {
    return this.auto ? 'auto' : this.preset.id;
  }

  /** Multiplier for the chosen draw distance. */
  get distScale(): number {
    return DETAIL_DIST[this.detail];
  }

  /** Device pixel ratio cap: full sharpness except at the lowest detail. */
  get maxDpr(): number {
    return this.detail >= MAX_DETAIL ? 1 : 2;
  }

  set(cell: string): void {
    this.auto = cell === 'auto';
    const k = CELL_PRESETS.findIndex((p) => p.id === cell);
    if (k >= 0) this.index = k;
    if (this.auto) {
      // Join the ladder at the first rung with this cell size (or the current detail, whichever is lower).
      const r = LADDER.findIndex(([c, d]) => c >= this.index && d >= this.detail);
      this.rung = r >= 0 ? r : LADDER.length - 1;
      [this.index, this.detail] = LADDER[this.rung];
    }
    this.cooldown = 1.5;
  }

  step(delta: number): void {
    this.auto = false;
    this.index = Math.max(0, Math.min(CELL_PRESETS.length - 1, this.index + delta));
  }

  /** A long pause (tab in the background, a GC hiccup) says nothing about steady-state speed. */
  hold(seconds: number): void {
    this.cooldown = Math.max(this.cooldown, seconds);
  }

  /** Returns true when the layout must be rebuilt. */
  sample(frameMs: number, workMs: number, dt: number): boolean {
    if (frameMs > 250) {
      this.hold(1);
      return false;
    }
    this.frameMs += (frameMs - this.frameMs) * 0.08;
    this.workMs += (workMs - this.workMs) * 0.08;
    this.cooldown -= dt;
    if (this.cooldown > 0) return false;
    const budget = 1000 / this.targetFps;
    const slow = this.frameMs > budget * 1.2;
    const fast = this.workMs < budget * 0.3 && this.frameMs < budget * 1.08;
    if (!slow && !fast) return false;
    const before = `${this.index}:${this.detail}`;
    if (this.auto) {
      this.rung = Math.max(0, Math.min(LADDER.length - 1, this.rung + (slow ? 1 : -1)));
      [this.index, this.detail] = LADDER[this.rung];
    } else {
      this.detail = Math.max(0, Math.min(MAX_DETAIL, this.detail + (slow ? 1 : -1)));
    }
    if (`${this.index}:${this.detail}` === before) return false;
    this.cooldown = slow ? 1.5 : 3;
    if (slow) {
      this.frameMs = budget;
      this.workMs = budget * 0.5;
    }
    return true;
  }
}

/** Phones and tablets with few cores or little memory start a step down, so the first seconds are smooth. */
export function lowEndDevice(touch: boolean): boolean {
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return touch && (cores <= 4 || mem <= 3);
}
