import { useCallback } from 'react';
import type { BrushPreset } from '../../engine/brush/presets';
import type { Engine } from '../../engine/Engine';

const cache = new Map<string, string>();

/** Brush stroke previews rendered by the engine, cached by the brush's full definition. */
export function usePreview(engine: () => Engine | null) {
  return useCallback(
    (preset: BrushPreset): string | undefined => {
      const key = JSON.stringify(preset);
      let url = cache.get(key);
      if (!url) {
        url = engine()?.brushPreview(preset);
        if (url) cache.set(key, url);
      }
      return url;
    },
    [engine],
  );
}
