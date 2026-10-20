import { Program } from '../gl/program';
import { PRESENT_FS, QUAD_VS } from '../gl/shaders';
import type { Target } from '../gl/target';
import type { QuadPass } from './QuadPass';

export interface PresentOptions {
  image: Target;
  docToClip: Float32Array;
  surround: readonly [number, number, number, number];
  /** Show hard pixels when zoomed in far. */
  nearest: boolean;
  width: number;
  height: number;
}

/** Draws the composited document to the screen through the view transform. */
export class Presenter {
  private program: Program;

  constructor(
    private gl: WebGL2RenderingContext,
    private quad: QuadPass,
  ) {
    this.program = new Program(gl, QUAD_VS, PRESENT_FS);
  }

  draw(o: PresentOptions) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, o.width, o.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(o.surround[0], o.surround[1], o.surround[2], o.surround[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.image.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.nearest ? gl.NEAREST : gl.LINEAR);
    this.program.use({
      u_docToClip: o.docToClip,
      u_docSize: [o.image.w, o.image.h],
      u_image: 0,
    });
    this.quad.draw();
  }

  dispose() {
    this.program.dispose();
  }
}
