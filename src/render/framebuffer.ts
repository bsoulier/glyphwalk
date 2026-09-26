/**
 * One entry per character cell. `fg` packs glyph index in the top byte and RGB below it, so on
 * little-endian machines the bytes are [r, g, b, glyph] and upload straight into an RGBA8 texture.
 * `depth` stores 1/z (0 = nothing drawn yet), so larger means closer.
 */
export class FrameBuffer {
  cols = 0;
  rows = 0;
  fg = new Uint32Array(0);
  bg = new Uint32Array(0);
  depth = new Float32Array(0);
  fgBytes = new Uint8Array(0);
  bgBytes = new Uint8Array(0);

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.fg = new Uint32Array(n);
    this.bg = new Uint32Array(n);
    this.depth = new Float32Array(n);
    this.fgBytes = new Uint8Array(this.fg.buffer);
    this.bgBytes = new Uint8Array(this.bg.buffer);
  }
}
