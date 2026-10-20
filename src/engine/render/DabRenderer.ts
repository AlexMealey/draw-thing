import { Program } from '../gl/program';
import { DAB_FS, DAB_VS } from '../gl/shaders';
import type { DabBatch } from './DabBatch';

export interface DabDrawOptions {
  docToClip: Float32Array;
  /** Premultiplied RGBA. */
  color: readonly [number, number, number, number];
  /** Antialias width in document px. */
  aa: number;
  ring?: boolean;
}

/** Draws a whole batch of dabs as instanced quads in one call. Caller sets target and blending. */
export class DabRenderer {
  private program: Program;
  private vao: WebGLVertexArrayObject;
  private corners: WebGLBuffer;
  private instances: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = new Program(gl, DAB_VS, DAB_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  draw(batch: DabBatch, opts: DabDrawOptions) {
    if (batch.count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.count * 4), gl.STREAM_DRAW);
    this.program.use({
      u_docToClip: opts.docToClip,
      u_color: opts.color,
      u_aa: opts.aa,
      u_ring: opts.ring ?? false,
    });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    this.program.dispose();
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.instances);
    gl.deleteVertexArray(this.vao);
  }
}
