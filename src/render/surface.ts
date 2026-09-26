let fgBuf: Uint32Array = new Uint32Array(0);
let bgBuf: Uint32Array = new Uint32Array(0);
let fogStart = 80;
let fogInv = 0.01;
let hazeR = 14;
let hazeG = 18;
let hazeB = 28;

/** Cells per metre at depth 1 (divide by z for the current depth). Cells are taller than wide, so fxC > fyC. */
export let fxC = 1;
export let fyC = 1;
export let time = 0;

/**
 * Change in u per screen column at the cell being shaded. Only filled in for sign faces, whose letters
 * must land on exactly one cell each even when the sign is seen at a steep angle.
 */
export const span = { du: 0 };

export function beginSurface(
  fg: Uint32Array, bg: Uint32Array, fx: number, fy: number, far: number, t: number,
  haze: readonly [number, number, number],
): void {
  fgBuf = fg;
  bgBuf = bg;
  fxC = fx;
  fyC = fy;
  time = t;
  fogStart = far * 0.4;
  fogInv = 1 / (far - fogStart);
  hazeR = haze[0];
  hazeG = haze[1];
  hazeB = haze[2];
}

function c8(v: number): number {
  return v > 255 ? 255 : v < 0 ? 0 : v | 0;
}

export function putRaw(i: number, gl: number, r: number, g: number, b: number, br: number, bgc: number, bb: number): void {
  fgBuf[i] = (gl << 24) | (c8(b) << 16) | (c8(g) << 8) | c8(r);
  bgBuf[i] = (c8(bb) << 16) | (c8(bgc) << 8) | c8(br);
}

/**
 * Write one cell with distance fog. `bgk` scales the colour into the cell background, which is what
 * makes surfaces read as solid instead of floating glyphs. Emissive cells resist fog so lights carry far.
 */
export function put(i: number, gl: number, r: number, g: number, b: number, bgk: number, z: number, emissive: number): void {
  let f = 1;
  if (z > fogStart) {
    const x = (z - fogStart) * fogInv;
    f = x >= 1 ? 0 : 1 - x * x;
    if (emissive > 0) f += (Math.sqrt(f) - f) * emissive;
  }
  const k = 1 - f;
  const hr = hazeR * k, hg = hazeG * k, hb = hazeB * k;
  const fr = r * f, fgn = g * f, fbl = b * f;
  fgBuf[i] = (gl << 24) | (c8(fbl + hb) << 16) | (c8(fgn + hg) << 8) | c8(fr + hr);
  bgBuf[i] = (c8(fbl * bgk + hb) << 16) | (c8(fgn * bgk + hg) << 8) | c8(fr * bgk + hr);
}
