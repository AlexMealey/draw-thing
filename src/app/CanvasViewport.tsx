import { useEffect, useRef, useState } from 'react';
import type { ToolSettings } from '../engine/brush/tool';
import { Engine, type EngineOptions } from '../engine/Engine';
import { hasWebGL2 } from '../engine/gl/context';
import type { Insets } from '../engine/view/ViewTransform';
import styles from './CanvasViewport.module.css';

interface Props {
  tool: ToolSettings;
  docSize: { w: number; h: number };
  insets: Insets;
  onEngine: (engine: Engine | null) => void;
  onTap: (fingers: number) => void;
  onNotice: (message: string) => void;
  onEyedropper: NonNullable<EngineOptions['onEyedropper']>;
  onColorPicked: (color: string) => void;
  /** With ?debug, exposes the engine as `window.__drawthing` for end-to-end tests. */
  exposeForTests?: boolean;
}

declare global {
  interface Window {
    __drawthing?: Engine;
  }
}

/**
 * Hosts the drawing canvas. The Engine is created once per mount (a new canvas remounts this) and
 * renders on its own; React only forwards settings and never re-renders during a stroke.
 */
export function CanvasViewport(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef(props);
  const [supported] = useState(hasWebGL2);
  const [contextLost, setContextLost] = useState(false);
  const { tool, insets } = props;

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = latest.current;
    const engine = new Engine(canvas, {
      docSize: p.docSize,
      insets: p.insets,
      onTap: (fingers) => latest.current.onTap(fingers),
      onNotice: (message) => latest.current.onNotice(message),
      onEyedropper: (loupe) => latest.current.onEyedropper(loupe),
      onColorPicked: (color) => latest.current.onColorPicked(color),
      onContextLost: () => setContextLost(true),
    });
    engineRef.current = engine;
    engine.setTool(p.tool);
    p.onEngine(engine);
    if (p.exposeForTests) window.__drawthing = engine;
    return () => {
      if (window.__drawthing === engine) delete window.__drawthing;
      engine.dispose();
      engineRef.current = null;
      latest.current.onEngine(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    engineRef.current?.setInsets(insets);
  }, [insets]);

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
