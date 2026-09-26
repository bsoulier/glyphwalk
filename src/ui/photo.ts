import { CHARSET } from '../core/charset';
import type { FrameBuffer } from '../render/framebuffer';
import { toast } from './toast';

/**
 * Photo mode: the world freezes, the interface hides, and the frame can be saved as a PNG or copied
 * as plain text, which is the same picture made of real characters that can be pasted anywhere.
 */
export class PhotoMode {
  active = false;
  private capture = false;
  private readonly bar = document.createElement('div');
  private readonly flashEl = document.createElement('div');
  /** Base name for saved files, e.g. `glyphwalk-le-marais-dusk`. */
  name = 'glyphwalk';
  onShot: (() => void) | null = null;

  constructor(touch: boolean) {
    this.bar.id = 'photobar';
    this.bar.textContent = touch
      ? 'PHOTO MODE \u00b7 world frozen \u00b7 SAVE png \u00b7 COPY text \u00b7 EXIT'
      : 'PHOTO MODE \u00b7 world frozen \u00b7 ENTER save png \u00b7 C copy as text \u00b7 P exit';
    this.flashEl.id = 'flash';
    document.body.append(this.bar, this.flashEl);
  }

  toggle(): void {
    this.active = !this.active;
    document.body.classList.toggle('photo', this.active);
  }

  /** The PNG is taken right after the next frame is drawn: WebGL clears its buffer once it is shown. */
  requestPng(): void {
    this.capture = true;
  }

  afterPresent(canvas: HTMLCanvasElement): void {
    if (!this.capture) return;
    this.capture = false;
    this.flash();
    canvas.toBlob((blob) => {
      if (!blob) return toast('Could not save the image');
      download(blob, `${this.name}.png`);
      toast(`Saved ${this.name}.png`);
    }, 'image/png');
  }

  copyText(fb: FrameBuffer): void {
    const lines: string[] = [];
    for (let r = 0; r < fb.rows; r++) {
      let s = '';
      for (let c = 0; c < fb.cols; c++) s += CHARSET[fb.fg[r * fb.cols + c] >>> 24] ?? ' ';
      lines.push(s.replace(/\s+$/, ''));
    }
    const text = lines.join('\n');
    this.flash();
    const done = () => toast(`Copied ${fb.cols}x${fb.rows} characters - paste it anywhere (monospace font)`);
    const fallback = () => {
      download(new Blob([text], { type: 'text/plain' }), `${this.name}.txt`);
      toast(`Saved ${this.name}.txt`);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  private flash(): void {
    this.onShot?.();
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
