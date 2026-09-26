import { CHARSET } from '../core/charset';

export interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  cols: number;
  cellW: number;
  cellH: number;
  font: string;
}

const FONT_STACK = 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", "Courier New", monospace';

/** White glyphs on transparent, one per cell, rendered at the exact device-pixel cell size. */
export function buildAtlas(cellW: number, cellH: number): GlyphAtlas {
  const cols = 16;
  const rows = Math.ceil(CHARSET.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const fontPx = Math.max(5, Math.round(cellH * 0.92));
  const font = `${fontPx}px ${FONT_STACK}`;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  const advance = ctx.measureText('M').width;
  const squeeze = advance > cellW ? cellW / advance : 1;

  for (let k = 0; k < CHARSET.length; k++) {
    const x0 = (k % cols) * cellW, y0 = Math.floor(k / cols) * cellH;
    const ch = CHARSET[k];
    if (drawBlockGlyph(ctx, ch, x0, y0, cellW, cellH)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cellW, cellH);
    ctx.clip();
    ctx.translate(x0 + cellW / 2, y0 + cellH / 2 + cellH * 0.05);
    ctx.scale(squeeze, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  return { canvas, cols, cellW, cellH, font };
}

// Shade/block characters are drawn as pixel patterns so they tile seamlessly at any cell size.
function drawBlockGlyph(ctx: CanvasRenderingContext2D, ch: string, x0: number, y0: number, w: number, h: number): boolean {
  let density: number;
  switch (ch) {
    case '█': ctx.fillRect(x0, y0, w, h); return true;
    case '▀': ctx.fillRect(x0, y0, w, Math.ceil(h / 2)); return true;
    case '▄': ctx.fillRect(x0, y0 + Math.floor(h / 2), w, Math.ceil(h / 2)); return true;
    case '░': density = 1; break;
    case '▒': density = 2; break;
    case '▓': density = 3; break;
    default: return false;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on =
        density === 2 ? ((x + y) & 1) === 0
        : density === 1 ? (x & 1) === 0 && (y & 1) === 0
        : !((x & 1) === 1 && (y & 1) === 1);
      if (on) ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  return true;
}
