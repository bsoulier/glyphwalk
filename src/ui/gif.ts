import { buildAtlas } from '../render/atlas';
import { Camera } from '../render/camera';
import { FrameBuffer } from '../render/framebuffer';
import { Rain } from '../render/rain';

/** GIF cells are drawn at this pixel size; small enough for a shareable file, big enough to read the glyphs. */
const CW = 6;
const CH = 11;
const MAX_COLS = 136;
const FRAMES = 40;
/** Frame delay in hundredths of a second (12.5 fps). */
const DELAY = 8;
const TRANSPARENT = 255;

interface Frame {
  fg: Uint32Array;
  bg: Uint32Array;
}

/**
 * Records a short loop of the live view into its own small frame buffer (so the file size does not
 * depend on the screen), then turns the cells into pixels with a crisp glyph atlas and encodes a GIF.
 */
export class GifRecorder {
  active = false;
  encoding = false;
  readonly fb = new FrameBuffer();
  readonly cam = new Camera();
  readonly rain = new Rain();
  private frames: Frame[] = [];
  private acc = 0;
  private style = 0;

  /** Grid with the screen's aspect ratio, at most MAX_COLS wide. */
  start(screenW: number, screenH: number, style: number): void {
    const cols = Math.max(24, Math.min(MAX_COLS, Math.floor(screenW / CW)));
    const rows = Math.max(10, Math.round((cols * CW * screenH) / screenW / CH));
    this.fb.resize(cols, rows);
    this.rain.resize(cols, rows);
    this.frames = [];
    this.acc = 1;
    this.style = style;
    this.active = true;
  }

  /** Aims the recording camera like the screen camera; call every frame while recording. */
  follow(src: Camera): void {
    const c = this.cam;
    c.x = src.x; c.y = src.y; c.z = src.z;
    c.yaw = src.yaw; c.pitch = src.pitch;
    c.fovDeg = src.fovDeg; c.far = src.far;
    c.update(this.fb.cols, this.fb.rows, CW, CH);
  }

  /** True when this frame should be captured. */
  due(dt: number): boolean {
    if (!this.active) return false;
    this.acc += dt;
    if (this.acc < DELAY / 100) return false;
    this.acc = 0;
    return true;
  }

  capture(): void {
    this.frames.push({ fg: this.fb.fg.slice(), bg: this.fb.bg.slice() });
    if (this.frames.length >= FRAMES) this.active = false;
  }

  get done(): boolean {
    return !this.active && this.frames.length >= FRAMES && !this.encoding;
  }

  get progress(): number {
    return this.frames.length / FRAMES;
  }

  /** Encodes one frame at a time, yielding in between so the game keeps running. */
  async encode(): Promise<Blob> {
    this.encoding = true;
    try {
      const { cols, rows } = this.fb;
      const W = cols * CW, H = rows * CH;
      const masks = glyphMasks();
      const style = this.style;
      const hist = new Uint32Array(32768);
      const cov = new Uint8Array(masks.length);
      for (let g = 0; g < masks.length; g++) for (let p = 0; p < CW * CH; p++) cov[g] += masks[g][p];
      for (const f of this.frames) {
        for (let i = 0; i < f.fg.length; i++) {
          const g = f.fg[i] >>> 24;
          const [fc, bc] = cellColors(f.fg[i], f.bg[i], style);
          const lit = style === 4 ? 0 : cov[g] ?? 0;
          hist[q15(fc)] += lit;
          hist[q15(bc)] += CW * CH - lit;
        }
      }
      const { palette, lut } = medianCut(hist, 255);
      const gif = new GifWriter(W, H, palette);
      let prev: Uint8Array | null = null;
      for (const f of this.frames) {
        const px = new Uint8Array(W * H);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const g = f.fg[i] >>> 24;
            const [fc, bc] = cellColors(f.fg[i], f.bg[i], style);
            const fi = lut[q15(fc)], bi = lut[q15(bc)];
            const m = style === 4 ? null : masks[g];
            let o = r * CH * W + c * CW;
            for (let y = 0, p = 0; y < CH; y++, o += W) {
              for (let x = 0; x < CW; x++, p++) px[o + x] = m && m[p] ? fi : bi;
            }
          }
        }
        // Pixels unchanged since the last frame become transparent, which compresses to almost nothing.
        let out = px;
        if (prev) {
          out = new Uint8Array(px.length);
          for (let k = 0; k < px.length; k++) out[k] = px[k] === prev[k] ? TRANSPARENT : px[k];
        }
        gif.frame(out, DELAY, prev ? TRANSPARENT : -1);
        prev = px;
        await new Promise((r) => setTimeout(r, 0));
      }
      this.frames = [];
      return gif.finish();
    } finally {
      this.encoding = false;
    }
  }
}

let maskCache: Uint8Array[] | null = null;

/** One byte per pixel per glyph: 1 where the glyph is inked. Thresholded, so every pixel is either fg or bg. */
function glyphMasks(): Uint8Array[] {
  if (maskCache) return maskCache;
  const atlas = buildAtlas(CW, CH);
  const ctx = atlas.canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const img = ctx.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height).data;
  const n = Math.ceil(atlas.canvas.height / CH) * atlas.cols;
  maskCache = [];
  for (let g = 0; g < n; g++) {
    const m = new Uint8Array(CW * CH);
    const x0 = (g % atlas.cols) * CW, y0 = Math.floor(g / atlas.cols) * CH;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) m[y * CW + x] = img[((y0 + y) * atlas.canvas.width + x0 + x) * 4 + 3] > 100 ? 1 : 0;
    }
    maskCache.push(m);
  }
  maskCache[0].fill(0);
  return maskCache;
}

const out2: [number, number] = [0, 0];

/** Foreground and background as 0xRRGGBB, after the same style mapping the WebGL presenter applies. */
function cellColors(fg: number, bg: number, style: number): [number, number] {
  let fr = fg & 255, fgc = (fg >> 8) & 255, fb = (fg >> 16) & 255;
  let br = bg & 255, bgc = (bg >> 8) & 255, bb = (bg >> 16) & 255;
  if (style === 3) { br = 0; bgc = 0; bb = 0; }
  else if (style === 4) {
    if ((fg >>> 24) !== 0) {
      br = Math.max(br, fr * 0.85); bgc = Math.max(bgc, fgc * 0.85); bb = Math.max(bb, fb * 0.85);
    }
  } else if (style === 1 || style === 2) {
    const tint = style === 1 ? [0.35, 1, 0.55] : [1, 0.68, 0.22];
    const lf = (fr * 0.3 + fgc * 0.59 + fb * 0.11) * 1.35, lb = (br * 0.3 + bgc * 0.59 + bb * 0.11) * 1.35;
    fr = lf * tint[0]; fgc = lf * tint[1]; fb = lf * tint[2];
    br = lb * tint[0]; bgc = lb * tint[1]; bb = lb * tint[2];
  }
  out2[0] = rgb(fr, fgc, fb);
  out2[1] = rgb(br, bgc, bb);
  return out2;
}

function rgb(r: number, g: number, b: number): number {
  return (Math.min(255, r | 0) << 16) | (Math.min(255, g | 0) << 8) | Math.min(255, b | 0);
}

/** 5 bits per channel. */
function q15(c: number): number {
  return ((c >> 19) & 31) << 10 | ((c >> 11) & 31) << 5 | ((c >> 3) & 31);
}

/**
 * Median cut over the 15-bit histogram: keep splitting the busiest box along its widest channel at the
 * pixel-weighted median. Every histogram bin maps to the palette entry of the box it ended up in.
 */
function medianCut(hist: Uint32Array, maxColors: number): { palette: Uint8Array; lut: Uint8Array } {
  const used: number[] = [];
  for (let k = 0; k < hist.length; k++) if (hist[k] > 0) used.push(k);
  const ch = (k: number, c: number) => (k >> (10 - c * 5)) & 31;
  type Box = { items: number[]; count: number; range: number; axis: number };
  const makeBox = (items: number[]): Box => {
    const lo = [31, 31, 31], hi = [0, 0, 0];
    let count = 0;
    for (const k of items) {
      count += hist[k];
      for (let c = 0; c < 3; c++) {
        const v = ch(k, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = ranges.indexOf(Math.max(...ranges));
    return { items, count, range: ranges[axis], axis };
  };
  const boxes: Box[] = [makeBox(used)];
  while (boxes.length < maxColors) {
    let best = -1, score = 0;
    boxes.forEach((b, n) => {
      const s = b.range > 0 && b.items.length > 1 ? b.count * b.range : 0;
      if (s > score) { score = s; best = n; }
    });
    if (best < 0) break;
    const b = boxes[best];
    b.items.sort((p, q) => ch(p, b.axis) - ch(q, b.axis));
    let acc = 0, cut = 1;
    for (let n = 0; n < b.items.length - 1; n++) {
      acc += hist[b.items[n]];
      if (acc >= b.count / 2) { cut = n + 1; break; }
      cut = n + 1;
    }
    boxes.splice(best, 1, makeBox(b.items.slice(0, cut)), makeBox(b.items.slice(cut)));
  }
  const palette = new Uint8Array(256 * 3);
  const lut = new Uint8Array(32768);
  boxes.forEach((b, n) => {
    let r = 0, g = 0, bl = 0, w = 0;
    for (const k of b.items) {
      const h = hist[k];
      r += (ch(k, 0) * 8 + 4) * h; g += (ch(k, 1) * 8 + 4) * h; bl += (ch(k, 2) * 8 + 4) * h;
      w += h;
      lut[k] = n;
    }
    palette[n * 3] = r / w; palette[n * 3 + 1] = g / w; palette[n * 3 + 2] = bl / w;
  });
  return { palette, lut };
}

class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;

  byte(v: number): void {
    if (this.len === this.buf.length) {
      const b = new Uint8Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    this.buf[this.len++] = v;
  }

  word(v: number): void {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }

  text(s: string): void {
    for (let k = 0; k < s.length; k++) this.byte(s.charCodeAt(k));
  }
}

/** GIF89a with a 256-colour global table, looping forever. */
class GifWriter {
  private readonly b = new Bytes();

  constructor(private readonly w: number, private readonly h: number, palette: Uint8Array) {
    const b = this.b;
    b.text('GIF89a');
    b.word(w);
    b.word(h);
    b.byte(0xf7);
    b.byte(0);
    b.byte(0);
    for (let k = 0; k < 768; k++) b.byte(palette[k]);
    b.byte(0x21); b.byte(0xff); b.byte(11);
    b.text('NETSCAPE2.0');
    b.byte(3); b.byte(1); b.word(0); b.byte(0);
  }

  frame(px: Uint8Array, delay: number, transparent: number): void {
    const b = this.b;
    b.byte(0x21); b.byte(0xf9); b.byte(4);
    b.byte((1 << 2) | (transparent >= 0 ? 1 : 0));
    b.word(delay);
    b.byte(transparent >= 0 ? transparent : 0);
    b.byte(0);
    b.byte(0x2c);
    b.word(0); b.word(0); b.word(this.w); b.word(this.h);
    b.byte(0);
    lzw(px, 8, b);
  }

  finish(): Blob {
    this.b.byte(0x3b);
    return new Blob([this.b.buf.slice(0, this.b.len)], { type: 'image/gif' });
  }
}

const HSIZE = 5003;
const BITS = 12;
const htab = new Int32Array(HSIZE);
const codetab = new Int32Array(HSIZE);

/** Variable-length-code LZW in 255-byte sub-blocks, with the classic open-addressing string table. */
function lzw(px: Uint8Array, minCodeSize: number, out: Bytes): void {
  out.byte(minCodeSize);
  const initBits = minCodeSize + 1;
  const clearCode = 1 << minCodeSize, eofCode = clearCode + 1;
  let nBits = initBits, maxcode = (1 << nBits) - 1;
  let freeEnt = clearCode + 2;
  let clearFlag = false;
  let accum = 0, accBits = 0;
  const packet = new Uint8Array(255);
  let plen = 0;

  const flushPacket = () => {
    if (plen === 0) return;
    out.byte(plen);
    for (let k = 0; k < plen; k++) out.byte(packet[k]);
    plen = 0;
  };
  const charOut = (c: number) => {
    packet[plen++] = c;
    if (plen >= 255) flushPacket();
  };
  const output = (code: number) => {
    accum = accBits > 0 ? accum | (code << accBits) : code;
    accBits += nBits;
    while (accBits >= 8) {
      charOut(accum & 255);
      accum >>= 8;
      accBits -= 8;
    }
    if (freeEnt > maxcode || clearFlag) {
      if (clearFlag) {
        nBits = initBits;
        maxcode = (1 << nBits) - 1;
        clearFlag = false;
      } else {
        nBits++;
        maxcode = nBits === BITS ? 1 << BITS : (1 << nBits) - 1;
      }
    }
    if (code === eofCode) {
      while (accBits > 0) {
        charOut(accum & 255);
        accum >>= 8;
        accBits -= 8;
      }
      flushPacket();
    }
  };

  htab.fill(-1);
  output(clearCode);
  let ent = px[0];
  outer: for (let n = 1; n < px.length; n++) {
    const c = px[n];
    const fcode = (c << BITS) + ent;
    let i = (c << 4) ^ ent;
    if (htab[i] === fcode) {
      ent = codetab[i];
      continue;
    }
    if (htab[i] >= 0) {
      const disp = i === 0 ? 1 : HSIZE - i;
      do {
        i -= disp;
        if (i < 0) i += HSIZE;
        if (htab[i] === fcode) {
          ent = codetab[i];
          continue outer;
        }
      } while (htab[i] >= 0);
    }
    output(ent);
    ent = c;
    if (freeEnt < 1 << BITS) {
      codetab[i] = freeEnt++;
      htab[i] = fcode;
    } else {
      htab.fill(-1);
      freeEnt = clearCode + 2;
      clearFlag = true;
      output(clearCode);
    }
  }
  output(ent);
  output(eofCode);
  out.byte(0);
}
