/** Largest document side; also the size cap for new canvases. */
export const MAX_DOC_SIZE = 4096;

/** The default "screen size" canvas, like Procreate's. */
export function screenDocSize(): { w: number; h: number } {
  const dpr = devicePixelRatio || 1;
  return {
    w: Math.min(MAX_DOC_SIZE, Math.round(innerWidth * dpr)),
    h: Math.min(MAX_DOC_SIZE, Math.round(innerHeight * dpr)),
  };
}
