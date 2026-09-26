import type { GlyphAtlas } from './atlas';
import type { FrameBuffer } from './framebuffer';
import { CHARSET } from '../core/charset';

export const STYLE_NAMES = ['Color', 'Phosphor green', 'Amber', 'Glyphs only', 'Pixels (no glyphs)'] as const;

export interface Presenter {
  readonly name: string;
  setAtlas(atlas: GlyphAtlas): void;
  resize(cols: number, rows: number): void;
  present(fb: FrameBuffer, style: number, scanlines: boolean): void;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFg;
uniform sampler2D uBg;
uniform sampler2D uAtlas;
uniform ivec2 uCell;
uniform int uAtlasCols;
uniform int uHeight;
uniform int uStyle;
uniform float uScan;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uHeight - 1 - int(gl_FragCoord.y));
  ivec2 c = p / uCell;
  ivec2 l = p - c * uCell;
  vec4 fg = texelFetch(uFg, c, 0);
  vec3 bg = texelFetch(uBg, c, 0).rgb;
  int g = int(fg.a * 255.0 + 0.5);
  float cov = texelFetch(uAtlas, ivec2(g % uAtlasCols, g / uAtlasCols) * uCell + l, 0).a;
  vec3 col;
  if (uStyle == 4) col = g == 0 ? bg : max(fg.rgb * 0.85, bg);
  else if (uStyle == 3) col = fg.rgb * cov;
  else col = mix(bg, fg.rgb, cov);
  if (uStyle == 1 || uStyle == 2) {
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = (uStyle == 1 ? vec3(0.35, 1.0, 0.55) : vec3(1.0, 0.68, 0.22)) * lum * 1.35;
  }
  if ((p.y & 1) == 1) col *= 1.0 - uScan;
  outColor = vec4(col, 1.0);
}`;

/**
 * The CPU only fills two cols x rows RGBA textures; the GPU turns every screen pixel into
 * mix(bg, fg, atlasCoverage). Cost is independent of how many glyphs are on screen.
 */
export class WebGLPresenter implements Presenter {
  readonly name = 'WebGL2';
  private readonly gl: WebGL2RenderingContext;
  private readonly texFg: WebGLTexture;
  private readonly texBg: WebGLTexture;
  private readonly texAtlas: WebGLTexture;
  private readonly uCell: WebGLUniformLocation | null;
  private readonly uAtlasCols: WebGLUniformLocation | null;
  private readonly uHeight: WebGLUniformLocation | null;
  private readonly uStyle: WebGLUniformLocation | null;
  private readonly uScan: WebGLUniformLocation | null;
  private cols = 0;
  private rows = 0;
  private cellW = 1;
  private cellH = 1;
  private atlasCols = 16;

  static tryCreate(canvas: HTMLCanvasElement): WebGLPresenter | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) return null;
    return new WebGLPresenter(gl);
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.texAtlas = makeTexture(gl, 0);
    this.texFg = makeTexture(gl, 1);
    this.texBg = makeTexture(gl, 2);
    gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uFg'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uBg'), 2);
    this.uCell = gl.getUniformLocation(prog, 'uCell');
    this.uAtlasCols = gl.getUniformLocation(prog, 'uAtlasCols');
    this.uHeight = gl.getUniformLocation(prog, 'uHeight');
    this.uStyle = gl.getUniformLocation(prog, 'uStyle');
    this.uScan = gl.getUniformLocation(prog, 'uScan');
  }

  setAtlas(atlas: GlyphAtlas): void {
    const gl = this.gl;
    this.cellW = atlas.cellW;
    this.cellH = atlas.cellH;
    this.atlasCols = atlas.cols;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  }

  resize(cols: number, rows: number): void {
    const gl = this.gl;
    this.cols = cols;
    this.rows = rows;
    for (const [unit, tex] of [[1, this.texFg], [2, this.texBg]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.viewport(0, 0, cols * this.cellW, rows * this.cellH);
  }

  present(fb: FrameBuffer, style: number, scanlines: boolean): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, fb.fgBytes);
    gl.activeTexture(gl.TEXTURE2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, fb.bgBytes);
    gl.uniform2i(this.uCell, this.cellW, this.cellH);
    gl.uniform1i(this.uAtlasCols, this.atlasCols);
    gl.uniform1i(this.uHeight, this.rows * this.cellH);
    gl.uniform1i(this.uStyle, style);
    gl.uniform1f(this.uScan, scanlines && this.cellH >= 8 ? 0.22 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
  return s;
}

function makeTexture(gl: WebGL2RenderingContext, unit: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Slow path for browsers without WebGL2: batches background runs and caches fillStyle. */
export class CanvasPresenter implements Presenter {
  readonly name = 'Canvas2D (fallback)';
  private readonly ctx: CanvasRenderingContext2D;
  private cellW = 1;
  private cellH = 1;
  private font = '12px monospace';

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
  }

  setAtlas(atlas: GlyphAtlas): void {
    this.cellW = atlas.cellW;
    this.cellH = atlas.cellH;
    this.font = atlas.font;
  }

  resize(): void {}

  present(fb: FrameBuffer): void {
    const ctx = this.ctx;
    const { cols, rows, fg, bg } = fb;
    const cw = this.cellW, ch = this.cellH;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let style = -1;
    for (let row = 0; row < rows; row++) {
      const o = row * cols;
      let runStart = 0;
      let runColor = bg[o] & 0xffffff;
      for (let col = 1; col <= cols; col++) {
        const c = col < cols ? bg[o + col] & 0xffffff : -1;
        if (c === runColor) continue;
        if (runColor !== style) {
          ctx.fillStyle = css(runColor);
          style = runColor;
        }
        ctx.fillRect(runStart * cw, row * ch, (col - runStart) * cw, ch);
        runStart = col;
        runColor = c;
      }
      for (let col = 0; col < cols; col++) {
        const f = fg[o + col];
        const g = f >>> 24;
        if (g === 0) continue;
        const c = f & 0xffffff;
        if (c !== style) {
          ctx.fillStyle = css(c);
          style = c;
        }
        ctx.fillText(CHARSET[g], col * cw + cw / 2, row * ch + ch / 2);
      }
    }
  }
}

function css(packed: number): string {
  return `rgb(${packed & 255},${(packed >> 8) & 255},${(packed >> 16) & 255})`;
}
