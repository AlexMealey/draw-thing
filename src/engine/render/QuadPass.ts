/**
 * A unit quad (0..1) for full-document passes, drawn with QUAD_VS: uv = corner, and position =
 * corner × document size through `u_docToClip`.
 */
export class QuadPass {
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext) {
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Draws with whatever program and uniforms are current. */
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
  }
}

/** Document px → clip space of a target (texture row y = document row y, so no flip). */
export function targetClip(t: { w: number; h: number }): Float32Array {
  return new Float32Array([2 / t.w, 0, 0, 0, 2 / t.h, 0, -1, -1, 1]);
}
