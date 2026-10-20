type UniformValue = number | boolean | Float32Array | readonly number[];

/** A linked program with cached uniform locations. Textures are passed as unit indices. */
export class Program {
  readonly program: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private types = new Map<string, number>();

  constructor(
    private gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }
    this.program = program;
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) this.types.set(info.name, info.type);
    }
  }

  use(uniforms: Record<string, UniformValue>) {
    const gl = this.gl;
    gl.useProgram(this.program);
    for (const [name, value] of Object.entries(uniforms)) {
      let loc = this.locations.get(name);
      if (loc === undefined) {
        loc = gl.getUniformLocation(this.program, name);
        this.locations.set(name, loc);
      }
      if (loc === null) continue; // optimized out
      const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      switch (this.types.get(name)) {
        case gl.FLOAT:
          gl.uniform1f(loc, v as number);
          break;
        case gl.INT:
        case gl.BOOL:
        case gl.SAMPLER_2D:
          gl.uniform1i(loc, v as number);
          break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(loc, v as Float32Array | number[]);
          break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(loc, v as Float32Array | number[]);
          break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(loc, v as Float32Array | number[]);
          break;
        case gl.FLOAT_MAT3:
          gl.uniformMatrix3fv(loc, false, v as Float32Array | number[]);
          break;
        default:
          throw new Error(`Unsupported uniform type for ${name}`);
      }
    }
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`${kind} shader compile failed: ${log}`);
  }
  return shader;
}
