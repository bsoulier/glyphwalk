const CAPTURED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  private readonly keys = new Set<string>();
  private pressed: string[] = [];
  private mx = 0;
  private my = 0;
  private dragging = false;
  locked = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.metaKey || e.ctrlKey) return;
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
      if (CAPTURED.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', () => {
      this.dragging = true;
      if (!this.locked) Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      this.mx += e.movementX;
      this.my += e.movementY;
    });
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  axis(neg: readonly string[], pos: readonly string[]): number {
    let v = 0;
    for (const k of neg) if (this.keys.has(k)) { v -= 1; break; }
    for (const k of pos) if (this.keys.has(k)) { v += 1; break; }
    return v;
  }

  takeMouse(): [number, number] {
    const m: [number, number] = [this.mx, this.my];
    this.mx = 0;
    this.my = 0;
    return m;
  }

  takePressed(): string[] {
    const q = this.pressed;
    this.pressed = [];
    return q;
  }
}
