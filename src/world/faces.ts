/**
 * Face record layout (all floats):
 *  0..11  four corners xyz (a=bottom-left, b=bottom-right, c=top-right, d=top-left as seen from outside)
 * 12..15  u0 v0 u1 v1 in world metres, so materials can size patterns in metres
 * 16..18  outward normal
 * 19      material id
 * 20..22  base colour
 * 23      material seed (must stay < 2^24 to survive Float32)
 */
export const FACE_STRIDE = 24;

export const BOX_S = 1;
export const BOX_E = 2;
export const BOX_N = 4;
export const BOX_W = 8;
export const BOX_TOP = 16;
export const BOX_BOTTOM = 32;
export const BOX_SIDES = BOX_S | BOX_E | BOX_N | BOX_W;
export const BOX_DEFAULT = BOX_SIDES | BOX_TOP;

export class FaceList {
  private data: number[] = [];

  get count(): number {
    return this.data.length / FACE_STRIDE;
  }

  push(values: readonly number[]): void {
    for (let k = 0; k < values.length; k++) this.data.push(values[k]);
  }

  /** Vertical quad from p0 to p1; the tangent p0->p1 points to the viewer's right, so text reads correctly. */
  wall(
    p0x: number, p0z: number, p1x: number, p1z: number, y0: number, y1: number, vBase: number,
    mat: number, r: number, g: number, b: number, seed: number,
  ): void {
    const tx = p1x - p0x, tz = p1z - p0z;
    const len = Math.hypot(tx, tz);
    if (len < 1e-6 || y1 <= y0) return;
    const nx = tz / len, nz = -tx / len;
    this.push([
      p0x, y0, p0z, p1x, y0, p1z, p1x, y1, p1z, p0x, y1, p0z,
      0, vBase, len, vBase + (y1 - y0),
      nx, 0, nz, mat, r, g, b, seed,
    ]);
  }

  box(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: number, r: number, g: number, b: number, seed: number,
    capMat = mat, mask = BOX_DEFAULT,
  ): void {
    if (mask & BOX_S) this.wall(x0, z0, x1, z0, y0, y1, y0, mat, r, g, b, seed);
    if (mask & BOX_E) this.wall(x1, z0, x1, z1, y0, y1, y0, mat, r, g, b, seed);
    if (mask & BOX_N) this.wall(x1, z1, x0, z1, y0, y1, y0, mat, r, g, b, seed);
    if (mask & BOX_W) this.wall(x0, z1, x0, z0, y0, y1, y0, mat, r, g, b, seed);
    const w = x1 - x0, d = z1 - z0;
    if (mask & BOX_TOP) {
      this.push([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, 0, 0, w, d, 0, 1, 0, capMat, r, g, b, seed]);
    }
    if (mask & BOX_BOTTOM) {
      this.push([x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0, 0, 0, w, d, 0, -1, 0, capMat, r, g, b, seed]);
    }
  }

  toArray(): Float32Array {
    return new Float32Array(this.data);
  }
}
