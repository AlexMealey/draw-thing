/**
 * Live GL object counts per context (ROADMAP §7.1: "no leaked textures"). The create and delete
 * calls are wrapped once per context; they're rare, so the bookkeeping costs nothing measurable.
 */

type Kind = 'texture' | 'framebuffer' | 'buffer' | 'vertexArray' | 'program' | 'shader' | 'sync';

const PAIRS: [Kind, string, string][] = [
  ['texture', 'createTexture', 'deleteTexture'],
  ['framebuffer', 'createFramebuffer', 'deleteFramebuffer'],
  ['buffer', 'createBuffer', 'deleteBuffer'],
  ['vertexArray', 'createVertexArray', 'deleteVertexArray'],
  ['program', 'createProgram', 'deleteProgram'],
  ['shader', 'createShader', 'deleteShader'],
  ['sync', 'fenceSync', 'deleteSync'],
];

export type GlObjectCounts = Record<Kind, number>;

const live = new WeakMap<WebGL2RenderingContext, Map<Kind, Set<object>>>();

export function trackGlObjects(gl: WebGL2RenderingContext) {
  if (live.has(gl)) return; // the same context, reused by a new Engine (StrictMode)
  const sets = new Map<Kind, Set<object>>();
  live.set(gl, sets);
  const methods = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [kind, create, remove] of PAIRS) {
    const set = new Set<object>();
    sets.set(kind, set);
    const createFn = methods[create]?.bind(gl);
    const removeFn = methods[remove]?.bind(gl);
    if (!createFn || !removeFn) continue;
    methods[create] = (...args) => {
      const obj = createFn(...args);
      if (obj) set.add(obj);
      return obj;
    };
    methods[remove] = (obj) => {
      if (obj) set.delete(obj);
      return removeFn(obj);
    };
  }
}

/** A lost context took every object with it. */
export function forgetGlObjects(gl: WebGL2RenderingContext) {
  for (const set of live.get(gl)?.values() ?? []) set.clear();
}

export function glObjectCounts(gl: WebGL2RenderingContext): GlObjectCounts {
  const sets = live.get(gl);
  const count = (k: Kind) => sets?.get(k)?.size ?? 0;
  return {
    texture: count('texture'),
    framebuffer: count('framebuffer'),
    buffer: count('buffer'),
    vertexArray: count('vertexArray'),
    program: count('program'),
    shader: count('shader'),
    sync: count('sync'),
  };
}

export function totalGlObjects(gl: WebGL2RenderingContext): number {
  return Object.values(glObjectCounts(gl)).reduce((a, b) => a + b, 0);
}
