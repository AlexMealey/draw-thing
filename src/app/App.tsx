import { useCallback, useMemo, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { type BrushPreset, DEFAULT_PRESET_ID, PRESETS, presetById } from '../engine/brush/presets';
import type { ToolSettings } from '../engine/brush/tool';
import type { Engine } from '../engine/Engine';
import styles from './App.module.css';
import { CanvasViewport } from './CanvasViewport';
import { type BrushAdjustments, DevToolbar } from './DevToolbar';
import { LayersPanel } from './LayersPanel';
import { Toast } from './Toast';
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
  const [layersOpen, setLayersOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const getEngine = useCallback(() => engineRef.current, []);

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
        <CanvasViewport tool={tool} onEngine={onEngine} onTap={onTap} onNotice={setNotice} />
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
          layersOpen={layersOpen}
          onLayers={() => setLayersOpen((open) => !open)}
          onFit={() => engineRef.current?.fitToScreen()}
        />
      )}
      {!uiHidden && layersOpen && <LayersPanel engine={getEngine} onNotice={setNotice} />}
      {notice && <Toast message={notice} onDone={clearNotice} />}
      <UpdatePrompt />
      {debug && <DebugHud />}
    </div>
  );
}
