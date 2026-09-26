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

// Below 5x9 px glyphs stop reading as characters, so auto never goes denser; XS is manual-only.
const AUTO_FINEST = 1;

/**
 * In auto mode, steps to bigger cells when frames run long and back to smaller ones when
 * the CPU-side work leaves plenty of headroom. The gap between the two thresholds prevents flip-flopping.
 */
export class Quality {
  auto: boolean;
  index: number;
  targetFps: number;
  frameMs = 16;
  workMs = 4;
  private cooldown = 2;

  constructor(cell: string, targetFps: number) {
    this.auto = cell === 'auto';
    const k = CELL_PRESETS.findIndex((p) => p.id === cell);
    this.index = k >= 0 ? k : 2;
    this.targetFps = targetFps;
  }

  get preset(): CellPreset {
    return CELL_PRESETS[this.index];
  }

  get cellSetting(): string {
    return this.auto ? 'auto' : this.preset.id;
  }

  set(cell: string): void {
    this.auto = cell === 'auto';
    const k = CELL_PRESETS.findIndex((p) => p.id === cell);
    if (k >= 0) this.index = k;
    this.cooldown = 1.5;
  }

  step(delta: number): void {
    this.auto = false;
    this.index = Math.max(0, Math.min(CELL_PRESETS.length - 1, this.index + delta));
  }

  sample(frameMs: number, workMs: number, dt: number): boolean {
    this.frameMs += (Math.min(frameMs, 250) - this.frameMs) * 0.08;
    this.workMs += (workMs - this.workMs) * 0.08;
    if (!this.auto) return false;
    this.cooldown -= dt;
    if (this.cooldown > 0) return false;
    const budget = 1000 / this.targetFps;
    if (this.frameMs > budget * 1.2 && this.index < CELL_PRESETS.length - 1) {
      this.index++;
      this.cooldown = 1.5;
      this.frameMs = budget;
      this.workMs = budget * 0.5;
      return true;
    }
    if (this.workMs < budget * 0.3 && this.frameMs < budget * 1.08 && this.index > AUTO_FINEST) {
      this.index--;
      this.cooldown = 3;
      return true;
    }
    return false;
  }
}
