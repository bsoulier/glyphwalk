import type { Input } from './input';

export interface TouchButton {
  label: string;
  /** Key code sent to Input; `tilt` toggles gyroscope look instead. */
  code: string;
  /** Held while the finger is down (fly up/down) rather than a single press. */
  hold?: boolean;
}

/** Touch-first device, or `?touch=1` to try the controls with a mouse. */
export function touchDevice(): boolean {
  return new URLSearchParams(location.search).get('touch') === '1'
    || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
}

const STICK_R = 56;
const LOOK_GAIN = 2.2;
const DEG = Math.PI / 180;

/**
 * On-screen controls that only ever talk to Input: the left half is a floating joystick, the right
 * half drags the view, and buttons send the same key codes as the keyboard.
 */
export class TouchControls {
  readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly knob = document.createElement('div');
  private readonly ctx = document.createElement('div');
  private readonly tiltBtn: HTMLButtonElement | null = null;
  private moveId = -1;
  private mx0 = 0;
  private my0 = 0;
  private lookId = -1;
  private lx = 0;
  private ly = 0;
  private lookDist = 0;
  private lookT0 = 0;
  private ctxKey = '';
  private tilt = false;
  private lastMotion = 0;
  /** Short tap on the look area, in client pixels (used to pick a spot on the full map). */
  onTap: ((x: number, y: number) => void) | null = null;

  constructor(private readonly input: Input, buttons: readonly TouchButton[]) {
    this.root.id = 'touch';
    const move = document.createElement('div');
    move.className = 't-zone t-move';
    const look = document.createElement('div');
    look.className = 't-zone t-look';
    this.stick.className = 't-stick';
    this.knob.className = 't-knob';
    this.stick.append(this.knob);
    const bar = document.createElement('div');
    bar.className = 't-bar';
    for (const b of buttons) {
      const el = this.button(b);
      if (b.code === 'tilt') this.tiltBtn = el;
      bar.append(el);
    }
    this.ctx.className = 't-ctx';
    this.root.append(move, look, this.stick, bar, this.ctx);
    document.body.append(this.root);

    move.addEventListener('pointerdown', (e) => {
      if (this.moveId !== -1) return;
      this.moveId = e.pointerId;
      move.setPointerCapture(e.pointerId);
      this.mx0 = e.clientX;
      this.my0 = e.clientY;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
      this.moveStick(e.clientX, e.clientY);
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.moveId) this.moveStick(e.clientX, e.clientY);
    });
    const endMove = (e: PointerEvent) => {
      if (e.pointerId !== this.moveId) return;
      this.moveId = -1;
      this.input.stickX = 0;
      this.input.stickY = 0;
      this.stick.classList.remove('on');
    };
    move.addEventListener('pointerup', endMove);
    move.addEventListener('pointercancel', endMove);

    look.addEventListener('pointerdown', (e) => {
      if (this.lookId !== -1) return;
      this.lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.lookDist = 0;
      this.lookT0 = performance.now();
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.lookDist += Math.abs(dx) + Math.abs(dy);
      this.input.look(dx * LOOK_GAIN, dy * LOOK_GAIN);
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = -1;
      if (e.type === 'pointerup' && this.lookDist < 10 && performance.now() - this.lookT0 < 350) this.onTap?.(e.clientX, e.clientY);
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    window.addEventListener('devicemotion', (e) => this.motion(e));
  }

  /** Buttons that only make sense right now (lift, fly up/down, map zoom); rebuilt only when they change. */
  setContext(buttons: readonly TouchButton[]): void {
    const key = buttons.map((b) => b.label).join('|');
    if (key === this.ctxKey) return;
    this.ctxKey = key;
    // A held button can vanish under the finger (leaving fly mode), which would leave its key stuck down.
    for (const b of this.ctxButtons) if (b.hold) this.input.hold(b.code, false);
    this.ctxButtons = buttons;
    this.ctx.replaceChildren(...buttons.map((b) => this.button(b)));
  }

  private ctxButtons: readonly TouchButton[] = [];

  private button(b: TouchButton): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = 't-btn';
    el.textContent = b.label;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      if (b.code === 'tilt') void this.toggleTilt();
      else if (b.hold) this.input.hold(b.code, true);
      else this.input.press(b.code);
    });
    const up = () => {
      el.classList.remove('down');
      if (b.hold) this.input.hold(b.code, false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  private moveStick(x: number, y: number): void {
    let dx = x - this.mx0, dy = y - this.my0;
    const len = Math.hypot(dx, dy), max = STICK_R * 1.5;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.stick.classList.toggle('run', len > STICK_R * 1.2);
    this.input.stickX = dx / STICK_R;
    this.input.stickY = -dy / STICK_R;
  }

  private async toggleTilt(): Promise<void> {
    if (!this.tilt) {
      // iOS only delivers motion events after an explicit permission prompt from a tap.
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DME.requestPermission === 'function') {
        const answer = await DME.requestPermission().catch(() => 'denied');
        if (answer !== 'granted') return;
      }
    }
    this.tilt = !this.tilt;
    this.lastMotion = 0;
    this.tiltBtn?.classList.toggle('lit', this.tilt);
  }

  /**
   * Gyroscope look: integrate the rotation rate around the screen's vertical axis (yaw) and its
   * horizontal axis (pitch). Device axes are fixed to portrait, so they are swapped for landscape.
   */
  private motion(e: DeviceMotionEvent): void {
    if (!this.tilt || !e.rotationRate) return;
    const now = e.timeStamp;
    const dt = this.lastMotion > 0 ? Math.min(0.1, (now - this.lastMotion) / 1000) : 0;
    this.lastMotion = now;
    const beta = (e.rotationRate.beta ?? 0) * DEG * dt, gamma = (e.rotationRate.gamma ?? 0) * DEG * dt;
    const angle = screen.orientation?.angle ?? 0;
    let yaw: number, pitch: number;
    switch (angle) {
      case 90: yaw = -beta; pitch = gamma; break;
      case 180: yaw = gamma; pitch = beta; break;
      case 270: yaw = beta; pitch = -gamma; break;
      default: yaw = -gamma; pitch = -beta;
    }
    this.input.turn(yaw, pitch);
  }
}
