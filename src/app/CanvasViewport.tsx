import { useEffect, useRef, useState } from 'react';
import type { BrushSettings } from '../engine/brush/RoundBrush';
import { Engine } from '../engine/Engine';
import { hasWebGL2 } from '../engine/gl/context';
import styles from './App.module.css';

interface Props {
  brush: BrushSettings;
  onEngine: (engine: Engine | null) => void;
  onTap: (fingers: number) => void;
}

/**
 * Hosts the drawing canvas. The Engine is created once per mount and renders on its own;
 * React only forwards settings and never re-renders during a stroke.
 */
export function CanvasViewport({ brush, onEngine, onTap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const callbacks = useRef({ onEngine, onTap });
  const [supported] = useState(hasWebGL2);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    callbacks.current = { onEngine, onTap };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, {
      onTap: (fingers) => callbacks.current.onTap(fingers),
      onContextLost: () => setContextLost(true),
    });
    engineRef.current = engine;
    callbacks.current.onEngine(engine);
    return () => {
      engine.dispose();
      engineRef.current = null;
      callbacks.current.onEngine(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrush(brush);
  }, [brush]);

  if (!supported) {
    return (
      <div className={styles.message}>
        <p>This browser doesn’t support WebGL2, which DrawThing needs to draw.</p>
      </div>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Drawing canvas" />
      {contextLost && (
        <div className={styles.message} role="alert">
          <p>The graphics context was reset. Reload to keep drawing.</p>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
    </>
  );
}
