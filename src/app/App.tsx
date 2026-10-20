import { useCallback, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import type { BrushSettings } from '../engine/brush/RoundBrush';
import type { Engine } from '../engine/Engine';
import styles from './App.module.css';
import { CanvasViewport } from './CanvasViewport';
import { DevToolbar } from './DevToolbar';
import { UpdatePrompt } from './UpdatePrompt';

export function App({ debug }: { debug: boolean }) {
  const engineRef = useRef<Engine | null>(null);
  const [brush, setBrush] = useState<BrushSettings>({ size: 12, color: '#1c1c1e', eraser: false });
  const [uiHidden, setUiHidden] = useState(false);

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
        <CanvasViewport brush={brush} onEngine={onEngine} onTap={onTap} />
      </main>
      {!uiHidden && (
        <DevToolbar
          brush={brush}
          onBrushChange={setBrush}
          onFit={() => engineRef.current?.fitToScreen()}
          onClear={() => engineRef.current?.clear()}
        />
      )}
      <UpdatePrompt />
      {debug && <DebugHud />}
    </div>
  );
}
