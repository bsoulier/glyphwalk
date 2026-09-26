export class Camera {
  x = 0;
  y = 1.7;
  z = 0;
  yaw = 0;
  pitch = 0;
  fovDeg = 62;
  near = 0.12;
  far = 260;

  cY = 1;
  sY = 0;
  cP = 1;
  sP = 0;
  /** Focal length in cells. Cells are taller than wide, so fx > fy. */
  fx = 1;
  fy = 1;
  cx = 0;
  cy = 0;
  /** Half-extent of the view frustum per unit of depth. */
  kx = 1;
  ky = 1;

  update(cols: number, rows: number, cellPxW: number, cellPxH: number): void {
    this.cY = Math.cos(this.yaw);
    this.sY = Math.sin(this.yaw);
    this.cP = Math.cos(this.pitch);
    this.sP = Math.sin(this.pitch);
    const focalPx = (rows * cellPxH * 0.5) / Math.tan((this.fovDeg * Math.PI) / 360);
    this.fx = focalPx / cellPxW;
    this.fy = focalPx / cellPxH;
    this.cx = cols * 0.5;
    this.cy = rows * 0.5;
    this.kx = this.cx / this.fx;
    this.ky = this.cy / this.fy;
  }
}
