const CAPTURED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  private readonly keys = new Set<string>();
  private pressed: string[] = [];
  private mx = 0;
  private my = 0;
  private dragging = false;
  locked = false;
  /** When false, clicks on the canvas are left to the page (e.g. picking a spot on the map). */
  canLock: () => boolean = () => true;
  /** performance.now() of the last key, mouse or touch activity, for the idle tour. */
  lastActive = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    const active = () => (this.lastActive = performance.now());
    for (const ev of ['keydown', 'mousemove', 'mousedown', 'wheel', 'pointerdown', 'pointermove']) window.addEventListener(ev, active, { passive: true });
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
      if (!this.canLock()) return;
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

  // ---- virtual input, used by the touch controls so the game only ever sees keys, a stick and turns ----

  /** Analogue stick: x to the right, y forward. Up to 1 walks; pushing past 1.2 runs. */
  stickX = 0;
  stickY = 0;
  private turnYaw = 0;
  private turnPitch = 0;

  /** A tap on a virtual key, as if it had been pressed and released. */
  press(code: string): void {
    this.pressed.push(code);
  }

  hold(code: string, on: boolean): void {
    if (on) this.keys.add(code);
    else this.keys.delete(code);
  }

  /** Look drag in screen pixels, treated like mouse movement. */
  look(dx: number, dy: number): void {
    this.mx += dx;
    this.my += dy;
  }

  /** Direct rotation in radians (gyroscope), positive yaw to the right and pitch up. */
  turn(yaw: number, pitch: number): void {
    this.turnYaw += yaw;
    this.turnPitch += pitch;
  }

  takeTurn(): [number, number] {
    const t: [number, number] = [this.turnYaw, this.turnPitch];
    this.turnYaw = 0;
    this.turnPitch = 0;
    return t;
  }

  get stickRun(): boolean {
    return Math.hypot(this.stickX, this.stickY) > 1.2;
  }
}
