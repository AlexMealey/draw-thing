const ATTRIBUTES: WebGLContextAttributes & { desynchronized?: boolean } = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance', // matters on dual-GPU Surface Books
  // Chromium on Windows/ChromeOS may bypass the compositor queue for lower latency.
  // Safari ignores it.
  desynchronized: true,
};

export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', ATTRIBUTES);
  if (!gl) throw new Error('WebGL2 is not available');
  return gl;
}

export function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

export function isDesynchronized(gl: WebGL2RenderingContext): boolean {
  const attrs = gl.getContextAttributes() as
    (WebGLContextAttributes & { desynchronized?: boolean }) | null;
  return attrs?.desynchronized === true;
}
