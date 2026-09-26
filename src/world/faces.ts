/**
 * Face record layout (all floats):
 *  0..11  four corners xyz, ordered bottom-left, bottom-right, top-right, top-left as seen from outside
 *         (a triangle repeats its apex as the last two corners)
 * 12..19  per-corner u, v in world metres, so materials can size patterns in metres
 * 20..22  outward normal
 * 23      material id
 * 24..26  base colour
 * 27      material seed (must stay < 2^24 to survive Float32)
 */
export const FACE_STRIDE = 28;

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

  /** Arbitrary planar quad (or triangle when c == d); the normal comes from the corner order. */
  poly(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    ua: number, va: number, ub: number, vb: number, uc: number, vc: number, ud: number, vd: number,
    mat: number, r: number, g: number, b: number, seed: number,
  ): void {
    const ex = dx - ax, ey = dy - ay, ez = dz - az;
    const fx = bx - ax, fy = by - ay, fz = bz - az;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    this.data.push(
      ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
      ua, va, ub, vb, uc, vc, ud, vd,
      nx, ny, nz, mat, r, g, b, seed,
    );
  }

  /** Vertical quad from p0 to p1; the tangent p0->p1 points to the viewer's right, so text reads correctly. */
  wall(
    p0x: number, p0z: number, p1x: number, p1z: number, y0: number, y1: number, vBase: number,
    mat: number, r: number, g: number, b: number, seed: number,
  ): void {
    const len = Math.hypot(p1x - p0x, p1z - p0z);
    if (len < 1e-6 || y1 <= y0) return;
    const v1 = vBase + (y1 - y0);
    this.poly(
      p0x, y0, p0z, p1x, y0, p1z, p1x, y1, p1z, p0x, y1, p0z,
      0, vBase, len, vBase, len, v1, 0, v1,
      mat, r, g, b, seed,
    );
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
      this.poly(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, 0, 0, w, 0, w, d, 0, d, capMat, r, g, b, seed);
    }
    if (mask & BOX_BOTTOM) {
      this.poly(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0, 0, 0, w, 0, w, d, 0, d, capMat, r, g, b, seed);
    }
  }

  toArray(): Float32Array {
    return new Float32Array(this.data);
  }
}
