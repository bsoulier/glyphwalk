/**
 * The rectangle the player can actually see. In-app browsers (X, Instagram, Facebook) often keep
 * `window.innerWidth` at a layout size that is not the visible page: twice as wide, or the full
 * sheet behind their own chrome. `visualViewport` is the visible box.
 */
export function viewBox(): { w: number; h: number; left: number; top: number } {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { w: vv.width, h: vv.height, left: vv.offsetLeft, top: vv.offsetTop };
  }
  return { w: window.innerWidth, h: window.innerHeight, left: 0, top: 0 };
}

/** How many cells fill a CSS-pixel box at this device pixel ratio. */
export function fitGrid(cssW: number, cssH: number, dpr: number, cellW: number, cellH: number): { cols: number; rows: number } {
  return {
    cols: Math.max(16, Math.floor((cssW * dpr) / cellW)),
    rows: Math.max(8, Math.floor((cssH * dpr) / cellH)),
  };
}

/**
 * Some WebViews back a canvas at a different size than `canvas.width` (an extra device-pixel
 * ratio, or a GPU cap). Size the grid to the buffer we really got, or the presenter only paints
 * part of the screen and the rest stays black.
 */
export function fitBuffer(bufW: number, bufH: number, cellW: number, cellH: number): { cols: number; rows: number } {
  return {
    cols: Math.max(16, Math.floor(bufW / cellW)),
    rows: Math.max(8, Math.floor(bufH / cellH)),
  };
}
