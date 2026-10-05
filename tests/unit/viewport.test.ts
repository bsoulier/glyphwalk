import { describe, expect, it } from 'vitest';
import { fitBuffer, fitGrid } from '../../src/ui/viewport';

describe('viewport', () => {
  it('fills a phone-sized view with cells at 2x pixels', () => {
    expect(fitGrid(390, 700, 2, 12, 22)).toEqual({ cols: 65, rows: 63 });
  });

  it('sizes the grid to the GPU buffer when a WebView backs the canvas at twice the asked size', () => {
    const asked = fitGrid(390, 700, 2, 12, 22);
    const buffer = { width: asked.cols * 12 * 2, height: asked.rows * 22 * 2 };
    const fitted = fitBuffer(buffer.width, buffer.height, 12, 22);
    expect(fitted.cols).toBe(asked.cols * 2);
    expect(fitted.rows).toBe(asked.rows * 2);
  });
});
