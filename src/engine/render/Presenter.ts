import { Program } from '../gl/program';
import { PRESENT_FS, QUAD_VS } from '../gl/shaders';
import type { Target } from '../gl/target';
import type { QuadPass } from './QuadPass';

export interface PresentOptions {
  image: Target;
  docToClip: Float32Array;
  /** Document size, px (the image may be smaller, e.g. a cached animation frame). */
  docSize: readonly [number, number];
  surround: readonly [number, number, number, number];
  /** Show hard pixels when zoomed in far. */
  nearest: boolean;
  width: number;
  height: number;
  /**
   * Straight RGB 0–1 drawn under the image, which was composited without its background. Null:
   * the image has its background already (or none), and transparency shows a checkerboard.
   */
  background?: readonly [number, number, number] | null;
  /** Premultiplied, drawn between the background and the image (onion skin). */
  underlay?: Target | null;
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

    const filter = o.nearest ? gl.NEAREST : gl.LINEAR;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, o.underlay?.tex ?? null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, o.image.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    this.program.use({
      u_docToClip: o.docToClip,
      u_docSize: o.docSize,
      u_image: 0,
      u_under: 1,
      u_hasUnder: !!o.underlay,
      u_hasBg: !!o.background,
      u_bg: o.background ?? [1, 1, 1],
    });
    this.quad.draw();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose() {
    this.program.dispose();
  }
}
