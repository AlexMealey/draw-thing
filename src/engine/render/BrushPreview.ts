import { DabGenerator } from '../brush/DabGenerator';
import type { BrushPreset } from '../brush/presets';
import { StrokePath } from '../brush/StrokePath';
import { createTarget, deleteTarget } from '../gl/target';
import { DabBatch } from './DabBatch';
import type { DabRenderer } from './DabRenderer';
import { targetClip } from './QuadPass';
import { imageToDataURL, readImage } from './readback';

const UPRIGHT = Math.PI / 2;

/**
 * Renders a sample S-stroke with a pressure swell (0 → 1 → 0) through the real dab pipeline, for
 * the brush library. Light ink on transparent, to sit on the dark panel.
 */
export function renderBrushPreview(
  gl: WebGL2RenderingContext,
  dabs: DabRenderer,
  preset: BrushPreset,
  w = 280,
  h = 72,
): string {
  const target = createTarget(gl, w, h);
  const size = Math.min(Math.max(preset.size.default, 6), h * 0.45);
  const gen = new DabGenerator(preset, size, 7);
  const path = new StrokePath(gen.spacingAt);
  const batch = new DabBatch();
  const emit = (pt: { x: number; y: number; p: number }) => gen.emit(pt, batch);
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    gen.setTilt(UPRIGHT, 0);
    path.push(
      {
        x: w * (0.08 + 0.84 * t),
        y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.2,
        p: Math.sin(t * Math.PI),
      },
      emit,
    );
  }
  path.finish(emit);

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  if (preset.accumulate === 'max') {
    gl.blendEquation(gl.MAX);
  } else {
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  dabs.draw(batch, { docToClip: targetClip(target), color: [0.95, 0.95, 0.97, 1], aa: 1, preset });
  gl.blendEquation(gl.FUNC_ADD);
  gl.disable(gl.BLEND);
  const url = imageToDataURL(readImage(gl, target));
  deleteTarget(gl, target);
  return url;
}
