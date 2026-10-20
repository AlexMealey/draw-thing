import { Program } from '../gl/program';
import { COPY_FS, PRESENT_FS, QUAD_VS } from '../gl/shaders';
import { bindTarget, type Rect, type Target } from '../gl/target';

export interface PresentOptions {
  layer: Target;
  stroke: Target;
  strokeOpacity: number;
  erase: boolean;
  docToClip: Float32Array;
  paper: readonly [number, number, number];
  surround: readonly [number, number, number, number];
  /** Show hard pixels when zoomed in far. */
  nearest: boolean;
  width: number;
  height: number;
}

/** Full-document quad passes: presenting to the screen and merging one target into another. */
export class Presenter {
  private present: Program;
  private copy: Program;
  private vao: WebGLVertexArrayObject;
  private quad: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext) {
    this.present = new Program(gl, QUAD_VS, PRESENT_FS);
    this.copy = new Program(gl, QUAD_VS, COPY_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw(o: PresentOptions) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, o.width, o.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(o.surround[0], o.surround[1], o.surround[2], o.surround[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const filter = o.nearest ? gl.NEAREST : gl.LINEAR;
    for (const [unit, t] of [o.layer, o.stroke].entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    }
    this.present.use({
      u_docToClip: o.docToClip,
      u_docSize: [o.layer.w, o.layer.h],
      u_layer: 0,
      u_stroke: 1,
      u_strokeOpacity: o.strokeOpacity,
      u_erase: o.erase,
      u_paper: o.paper,
    });
    this.drawQuad();
  }

  /** Composites `src` onto `dst` within `rect`: source-over, or destination-out when erasing. */
  merge(src: Target, dst: Target, rect: Rect, erase: boolean, opacity = 1) {
    const gl = this.gl;
    bindTarget(gl, dst, rect);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (erase) gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    this.copy.use({
      u_docToClip: targetClip(dst),
      u_docSize: [dst.w, dst.h],
      u_src: 0,
      u_opacity: opacity,
    });
    this.drawQuad();
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
  }

  clear(t: Target, rect: Rect | null) {
    const gl = this.gl;
    bindTarget(gl, t, rect);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.present.dispose();
    this.copy.dispose();
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteVertexArray(this.vao);
  }
}

/** Document px → clip space of a target (texture row y = document row y, so no flip). */
export function targetClip(t: { w: number; h: number }): Float32Array {
  return new Float32Array([2 / t.w, 0, 0, 0, 2 / t.h, 0, -1, -1, 1]);
}
