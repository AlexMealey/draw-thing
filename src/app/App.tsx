import { useCallback, useMemo, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { type BrushPreset, DEFAULT_PRESET_ID, PRESETS, presetById } from '../engine/brush/presets';
import type { ToolSettings } from '../engine/brush/tool';
import type { Engine } from '../engine/Engine';
import styles from './App.module.css';
import { CanvasViewport } from './CanvasViewport';
import { type BrushAdjustments, DevToolbar } from './DevToolbar';
import { UpdatePrompt } from './UpdatePrompt';

const defaultsFor = (p: BrushPreset): BrushAdjustments => ({
  size: p.size.default,
  opacity: p.opacity,
  smoothing: p.stabilization,
});

/** Size, opacity and smoothing are remembered per brush, like Procreate. */
const initialAdjustments = (): Record<string, BrushAdjustments> =>
  Object.fromEntries(PRESETS.map((p) => [p.id, defaultsFor(p)]));

export function App({ debug }: { debug: boolean }) {
  const engineRef = useRef<Engine | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [color, setColor] = useState('#1c1c1e');
  const [eraser, setEraser] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);

  const preset = presetById(presetId);
  const adjust = adjustments[preset.id] ?? defaultsFor(preset);
  const tool = useMemo<ToolSettings>(
    () => ({ preset, ...adjust, color, eraser }),
    [preset, adjust, color, eraser],
  );

  const onEngine = useCallback((engine: Engine | null) => {
    engineRef.current = engine;
  }, []);

  const onTap = useCallback((fingers: number) => {
    if (fingers === 4) setUiHidden((hidden) => !hidden);
    else if (fingers === 2) console.info('2-finger tap: undo arrives in Phase 4');
    else if (fingers === 3) console.info('3-finger tap: redo arrives in Phase 4');
  }, []);

  return (
    <div className={styles.app}>
      <main className={styles.canvasHost} aria-label="Canvas">
        <CanvasViewport tool={tool} onEngine={onEngine} onTap={onTap} />
      </main>
      {!uiHidden && (
        <DevToolbar
          presets={PRESETS}
          preset={preset}
          adjust={adjust}
          color={color}
          eraser={eraser}
          onPreset={setPresetId}
          onAdjust={(next) => setAdjustments((all) => ({ ...all, [preset.id]: next }))}
          onColor={(c) => {
            setColor(c);
            setEraser(false);
          }}
          onEraser={setEraser}
          onFit={() => engineRef.current?.fitToScreen()}
          onClear={() => engineRef.current?.clear()}
        />
      )}
      <UpdatePrompt />
      {debug && <DebugHud />}
    </div>
  );
}
