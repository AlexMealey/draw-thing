import { useEffect, useRef, useState } from 'react';
import type { ToolSettings } from '../engine/brush/tool';
import { Engine } from '../engine/Engine';
import { hasWebGL2 } from '../engine/gl/context';
import styles from './App.module.css';

interface Props {
  tool: ToolSettings;
  onEngine: (engine: Engine | null) => void;
  onTap: (fingers: number) => void;
  onNotice: (message: string) => void;
  /** With ?debug, exposes the engine as `window.__drawthing` for end-to-end tests. */
  exposeForTests?: boolean;
}

declare global {
  interface Window {
    __drawthing?: Engine;
  }
}

/**
 * Hosts the drawing canvas. The Engine is created once per mount and renders on its own;
 * React only forwards settings and never re-renders during a stroke.
 */
export function CanvasViewport({ tool, onEngine, onTap, onNotice, exposeForTests }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const callbacks = useRef({ onEngine, onTap, onNotice, exposeForTests });
  const [supported] = useState(hasWebGL2);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    callbacks.current = { onEngine, onTap, onNotice, exposeForTests };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, {
      onTap: (fingers) => callbacks.current.onTap(fingers),
      onNotice: (message) => callbacks.current.onNotice(message),
      onContextLost: () => setContextLost(true),
    });
    engineRef.current = engine;
    callbacks.current.onEngine(engine);
    if (callbacks.current.exposeForTests) window.__drawthing = engine;
    return () => {
      if (window.__drawthing === engine) delete window.__drawthing;
      engine.dispose();
      engineRef.current = null;
      callbacks.current.onEngine(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

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
