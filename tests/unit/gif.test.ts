import { describe, expect, it } from 'vitest';
import { GifWriter, medianCut } from '../../src/ui/gif';

interface Decoded {
  width: number;
  height: number;
  loops: boolean;
  frames: { px: Uint8Array; delay: number; transparent: number }[];
}

/** A small, independent GIF decoder, so the encoder is checked against the format rather than itself. */
function decode(b: Uint8Array): Decoded {
  let o = 0;
  const u8 = () => b[o++];
  const u16 = () => { const v = b[o] | (b[o + 1] << 8); o += 2; return v; };
  const text = (n: number) => { const s = String.fromCharCode(...b.slice(o, o + n)); o += n; return s; };
  const subBlocks = () => {
    const out: number[] = [];
    for (let n = u8(); n > 0; n = u8()) { for (let k = 0; k < n; k++) out.push(u8()); }
    return out;
  };
  expect(text(6)).toBe('GIF89a');
  const width = u16(), height = u16(), packed = u8();
  o += 2;
  if (packed & 0x80) o += 3 * (1 << ((packed & 7) + 1));
  const res: Decoded = { width, height, loops: false, frames: [] };
  let delay = 0, transparent = -1;
  for (;;) {
    const tag = u8();
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = u8();
      const data = subBlocks();
      if (label === 0xf9) {
        delay = data[1] | (data[2] << 8);
        transparent = data[0] & 1 ? data[3] : -1;
      }
      if (label === 0xff && String.fromCharCode(...data.slice(0, 11)) === 'NETSCAPE2.0') res.loops = true;
      continue;
    }
    expect(tag).toBe(0x2c);
    o += 4;
    const w = u16(), h = u16();
    u8();
    const min = u8();
    res.frames.push({ px: lzwDecode(subBlocks(), min, w * h), delay, transparent });
  }
  return res;
}

function lzwDecode(data: number[], min: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, next = eoi + 1, prev: number[] | null = null, n = 0;
  let dict: number[][] = [];
  let bit = 0;
  const read = () => {
    let v = 0;
    for (let k = 0; k < size; k++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << k;
    return v;
  };
  const reset = () => {
    dict = Array.from({ length: clear }, (_, k) => [k]);
    size = min + 1;
    next = eoi + 1;
    prev = null;
  };
  reset();
  while (bit < data.length * 8) {
    const code = read();
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (dict[code]) {
      entry = dict[code];
      if (prev) dict[next++] = [...prev, entry[0]];
    } else {
      if (!prev) throw new Error('bad first code');
      entry = [...prev, prev[0]];
      dict[next++] = entry;
    }
    for (const v of entry) out[n++] = v;
    prev = entry;
    if (next === 1 << size && size < 12) size++;
  }
  expect(n).toBe(count);
  return out;
}

async function roundTrip(frames: Uint8Array[], w: number, h: number, transparent = -1): Promise<Decoded> {
  const gif = new GifWriter(w, h, new Uint8Array(768));
  frames.forEach((px, k) => gif.frame(px, 8, k > 0 ? transparent : -1));
  return decode(new Uint8Array(await gif.finish().arrayBuffer()));
}

describe('GIF encoder', () => {
  it('writes a looping GIF89a whose frames decode back to the same pixels', async () => {
    const w = 37, h = 23;
    const a = Uint8Array.from({ length: w * h }, (_, k) => (k * 7) % 11);
    const b = Uint8Array.from({ length: w * h }, (_, k) => (k % w < 10 ? 3 : 200));
    const d = await roundTrip([a, b], w, h, 255);
    expect([d.width, d.height, d.loops]).toEqual([w, h, true]);
    expect(d.frames).toHaveLength(2);
    expect(d.frames[0].px).toEqual(a);
    expect(d.frames[1].px).toEqual(b);
    expect(d.frames[0].transparent).toBe(-1);
    expect(d.frames[1].transparent).toBe(255);
    expect(d.frames[1].delay).toBe(8);
  });

  it('survives the code table filling up and being reset mid-frame', async () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    const w = 200, h = 150;
    const noise = Uint8Array.from({ length: w * h }, () => rnd() % 255);
    const d = await roundTrip([noise], w, h);
    expect(d.frames[0].px).toEqual(noise);
  });
});

describe('median cut palette', () => {
  const q15 = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

  it('keeps every colour when there are few', () => {
    const hist = new Uint32Array(32768);
    const colors = [[250, 10, 10], [10, 250, 10], [10, 10, 250]];
    for (const [r, g, b] of colors) hist[q15(r, g, b)] = 100;
    const { palette, lut } = medianCut(hist, 255);
    const seen = new Set(colors.map(([r, g, b]) => lut[q15(r, g, b)]));
    expect(seen.size).toBe(3);
    for (const [r, g, b] of colors) {
      const k = lut[q15(r, g, b)];
      expect(Math.abs(palette[k * 3] - r)).toBeLessThanOrEqual(6);
      expect(Math.abs(palette[k * 3 + 1] - g)).toBeLessThanOrEqual(6);
      expect(Math.abs(palette[k * 3 + 2] - b)).toBeLessThanOrEqual(6);
    }
  });

  it('never uses more than the allowed number of entries', () => {
    const hist = new Uint32Array(32768);
    for (let k = 0; k < hist.length; k += 7) hist[k] = 1 + (k % 13);
    const { lut } = medianCut(hist, 255);
    let max = 0;
    for (let k = 0; k < hist.length; k++) if (hist[k]) max = Math.max(max, lut[k]);
    expect(max).toBeLessThan(255);
  });
});
