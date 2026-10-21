import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolSettings } from '../engine/brush/tool';
import { Engine, type EngineOptions } from '../engine/Engine';
import { hasWebGL2 } from '../engine/gl/context';
import type { Insets } from '../engine/view/ViewTransform';
import { Autosaver } from '../persistence/Autosaver';
import { loadTiles } from '../persistence/projects';
import styles from './CanvasViewport.module.css';
import type { OpenProject, Session } from './project';

interface Props {
  tool: ToolSettings;
  project: OpenProject;
  insets: Insets;
  onSession: (session: Session | null) => void;
  onTap: (fingers: number) => void;
  onNotice: (message: string) => void;
  onEyedropper: NonNullable<EngineOptions['onEyedropper']>;
  onColorPicked: (color: string) => void;
  /** After each autosave. */
  onSaved?: () => void;
  /** With ?debug, exposes the engine as `window.__drawthing` for end-to-end tests. */
  exposeForTests?: boolean;
}

declare global {
  interface Window {
    __drawthing?: Engine;
    __drawthingSaver?: Autosaver;
  }
}

/** The GPU context: fine, lost and being restored, or beyond saving (reload). */
type Graphics = 'ok' | 'restoring' | 'failed';

/** How long to wait for the browser to give the context back before offering a reload. */
const RESTORE_PATIENCE_MS = 5000;

/**
 * Hosts the drawing canvas. The Engine and its Autosaver are created once per mount (opening
 * another artwork remounts this) and run on their own; React only forwards settings and never
 * re-renders during a stroke.
 */
export function CanvasViewport(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const latest = useRef(props);
  const [supported] = useState(hasWebGL2);
  const [graphics, setGraphics] = useState<Graphics>('ok');
  const [opening, setOpening] = useState(() => props.project.tiles !== null);
  const { tool, insets } = props;

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = latest.current;
    const { project } = p;
    let saver: Autosaver | null = null;
    const engine = new Engine(canvas, {
      docSize: project.size,
      document: project.doc ?? undefined,
      insets: p.insets,
      onChange: () => saver?.changed(),
      onTap: (fingers) => latest.current.onTap(fingers),
      onNotice: (message) => latest.current.onNotice(message),
      onEyedropper: (loupe) => latest.current.onEyedropper(loupe),
      onColorPicked: (color) => latest.current.onColorPicked(color),
      onContextLost: () => {
        setGraphics('restoring');
        void saver?.flush(); // what's unsaved is all in CPU memory; keep it safe
      },
      // The layers come back from storage, once everything up to now is written.
      restoreTiles: async () => {
        await saver?.flush();
        return loadTiles(project.id);
      },
      onContextRestored: (ok) => setGraphics(ok ? 'ok' : 'failed'),
    });
    saver = new Autosaver(engine, project.id, {
      storedLayers: project.doc?.layers.map((l) => l.id) ?? [],
      name: project.name,
      onError: () => latest.current.onNotice('Couldn’t save: the device may be out of storage'),
      onSaved: () => latest.current.onSaved?.(),
    });
    const session = { engine, saver };
    engineRef.current = engine;
    engine.setTool(p.tool);
    p.onSession(session);
    if (project.tiles) {
      void engine.loadTiles(project.tiles).then(() => {
        setOpening(false);
        if (project.needsThumbnail) void session.saver.saveThumbnail();
      });
    }
    if (p.exposeForTests) {
      window.__drawthing = engine;
      window.__drawthingSaver = saver;
    }
    return () => {
      if (window.__drawthing === engine) delete window.__drawthing;
      if (window.__drawthingSaver === session.saver) delete window.__drawthingSaver;
      void session.saver.close(); // takes what it needs from the engine synchronously
      engine.dispose();
      engineRef.current = null;
      latest.current.onSession(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    engineRef.current?.setInsets(insets);
  }, [insets]);

  useEffect(() => {
    if (graphics !== 'restoring') return;
    const id = setTimeout(() => setGraphics('failed'), RESTORE_PATIENCE_MS);
    return () => clearTimeout(id);
  }, [graphics]);

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
      {opening && (
        <div className={styles.opening} role="status">
          Opening…
        </div>
      )}
      {/* Over the whole editor (the canvas host contains its children): until the layers are
          back, nothing may change the document. */}
      {graphics === 'restoring' &&
        createPortal(
          <div className={styles.message} role="status">
            <p>Restoring the canvas…</p>
          </div>,
          document.body,
        )}
      {graphics === 'failed' &&
        createPortal(
          <div className={styles.message} role="alert">
            <p>
              The graphics system was reset. Reload to keep drawing: the artwork reopens as saved.
            </p>
            <button onClick={() => location.reload()}>Reload</button>
          </div>,
          document.body,
        )}
    </>
  );
}
