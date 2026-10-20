import { generatePaperGrain, GRAIN_SIZE } from '../brush/grain';
import type { BrushPreset } from '../brush/presets';
import { Program } from '../gl/program';
import { DAB_FS, DAB_VS } from '../gl/shaders';
import { DAB_STRIDE, type DabBatch } from './DabBatch';

export interface DabDrawOptions {
  docToClip: Float32Array;
  /** Premultiplied RGBA. */
  color: readonly [number, number, number, number];
  /** Antialias width in document px. */
  aa: number;
  /** Tip shape and grain; omitted for plain round dabs (and the cursor ring). */
  preset?: BrushPreset;
  ring?: boolean;
}

const GRAIN_MODE = { moving: 1, texturized: 2 } as const;

/** Draws a whole batch of dabs as instanced quads in one call. Caller sets target and blending. */
export class DabRenderer {
  private program: Program;
  private vao: WebGLVertexArrayObject;
  private corners: WebGLBuffer;
  private instances: WebGLBuffer;
  private grain: WebGLTexture;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = new Program(gl, DAB_VS, DAB_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const stride = DAB_STRIDE * 4;
    this.instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.grain = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.grain);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      GRAIN_SIZE,
      GRAIN_SIZE,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      generatePaperGrain(),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  draw(batch: DabBatch, opts: DabDrawOptions) {
    if (batch.count === 0) return;
    const gl = this.gl;
    const { preset } = opts;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      batch.data.subarray(0, batch.count * DAB_STRIDE),
      gl.STREAM_DRAW,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.grain);
    this.program.use({
      u_docToClip: opts.docToClip,
      u_color: opts.color,
      u_aa: opts.aa,
      u_ring: opts.ring ?? false,
      u_hardness: preset?.tip.hardness ?? 1,
      u_roundness: preset?.tip.roundness ?? 1,
      u_grain: 0,
      u_grainMode: preset?.grain ? GRAIN_MODE[preset.grain.mode] : 0,
      u_grainPeriod: GRAIN_SIZE * (preset?.grain?.scale ?? 1),
      u_grainDepth: preset?.grain?.depth ?? 0,
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
    gl.deleteTexture(this.grain);
  }
}
