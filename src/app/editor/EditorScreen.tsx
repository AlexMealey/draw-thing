import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import {
  currentAdjustments,
  currentPreset,
  toolSettings,
  toolStore,
  useTools,
} from '../../state/toolStore';
import { CanvasViewport } from '../CanvasViewport';
import type { OpenProject, Session } from '../project';
import { ActionsPanel } from './ActionsPanel';
import { BrushLibrary } from './BrushLibrary';
import { BrushSettings } from './BrushSettings';
import { ColorPanel } from './ColorPanel';
import styles from './EditorScreen.module.css';
import { LayersPanel } from './LayersPanel';
import { SideBar } from './SideBar';
import { TopBar } from './TopBar';

/** Room taken by the top bar and sidebar, so fitting keeps the canvas out from under them. */
const TOPBAR = 60;
const SIDEBAR = 64;

export type PanelId = 'brushes' | 'brushSettings' | 'layers' | 'color' | 'actions';

interface Props {
  project: OpenProject;
  debug: boolean;
  engine: () => Engine | null;
  onSession: (session: Session | null) => void;
  /** Saves now; resolves when it's written. */
  flush: () => Promise<void>;
  onNotice: (message: string) => void;
  /** After each autosave. */
  onSaved: () => void;
  /** Shows how to install the app (absent once it's installed). */
  onInstall?: () => void;
  /** Restarts into a waiting new version (absent unless there is one). */
  onUpdate?: () => void;
  onGallery: () => void;
  onNewCanvas: () => void;
}

interface Loupe {
  x: number;
  y: number;
  color: string | null;
}

export function EditorScreen({
  project,
  debug,
  engine,
  onSession,
  flush,
  onNotice,
  onSaved,
  onInstall,
  onUpdate,
  onGallery,
  onNewCanvas,
}: Props) {
  const [open, setOpen] = useState<PanelId | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [eyedropper, setEyedropper] = useState(false);
  const [loupe, setLoupe] = useState<Loupe | null>(null);
  const [uiHidden, setUiHidden] = useState(false);

  const mode = useTools((s) => s.mode);
  const color = useTools((s) => s.color);
  const presetIds = useTools((s) => s.presetIds);
  const adjustments = useTools((s) => s.adjustments);
  const overrides = useTools((s) => s.overrides);
  const sidebarRight = useTools((s) => s.sidebarRight);
  const fingerDrawing = useTools((s) => s.fingerDrawing);
  const tool = useMemo(
    () => toolSettings({ ...toolStore.getState(), mode, color, presetIds, adjustments, overrides }),
    [mode, color, presetIds, adjustments, overrides],
  );

  const toggle = useCallback((panel: PanelId) => setOpen((o) => (o === panel ? null : panel)), []);

  const onTool = (m: typeof mode) => {
    if (m === mode) toggle('brushes');
    else {
      toolStore.getState().setMode(m);
      if (open === 'brushes' || open === 'brushSettings') setOpen('brushes');
    }
  };

  const onTap = useCallback(
    (fingers: number) => {
      if (fingers === 2) engine()?.undo();
      else if (fingers === 3) engine()?.redo();
      else if (fingers === 4) setUiHidden((h) => !h);
    },
    [engine],
  );

  const onColorPicked = useCallback((c: string) => {
    toolStore.getState().setColor(c, true);
    setEyedropper(false);
  }, []);

  useEffect(() => {
    engine()?.setFingerDrawing(fingerDrawing);
  }, [engine, fingerDrawing]);

  useEffect(() => {
    engine()?.setEyedropper(eyedropper);
  }, [engine, eyedropper]);

  // Keyboard shortcuts (Ctrl/⌘ combinations are handled by the engine).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const tools = toolStore.getState();
      const size = currentAdjustments(tools).size;
      const max = currentPreset(tools).size.max;
      switch (e.key) {
        case 'b':
          tools.setMode('paint');
          break;
        case 'e':
          tools.setMode('erase');
          break;
        case 'l':
          toggle('layers');
          break;
        case 'c':
          toggle('color');
          break;
        case 'i':
          setEyedropper((on) => !on);
          break;
        case '[':
          tools.adjust({ size: Math.max(1, Math.round(size / 1.15)) });
          break;
        case ']':
          tools.adjust({ size: Math.min(max, Math.max(size + 1, Math.round(size * 1.15))) });
          break;
        case 'Escape':
          setOpen(null);
          setEyedropper(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const close = () => setOpen(null);
  const side = sidebarRight ? 'right' : 'left';
  const insets = useMemo(
    () =>
      uiHidden
        ? { top: 0, right: 0, bottom: 0, left: 0 }
        : {
            top: TOPBAR,
            right: sidebarRight ? SIDEBAR : 0,
            bottom: 0,
            left: sidebarRight ? 0 : SIDEBAR,
          },
    [uiHidden, sidebarRight],
  );

  return (
    <div className={styles.editor}>
      <main
        className={styles.canvasHost}
        aria-label="Canvas"
        onPointerDownCapture={() => open && setOpen(null)}
      >
        <CanvasViewport
          tool={tool}
          project={project}
          insets={insets}
          onSession={onSession}
          onTap={onTap}
          onNotice={onNotice}
          onEyedropper={setLoupe}
          onColorPicked={onColorPicked}
          onSaved={onSaved}
          exposeForTests={debug}
        />
      </main>

      {!uiHidden && (
        <>
          <TopBar
            open={open}
            mode={mode}
            color={color}
            onGallery={onGallery}
            onToggle={toggle}
            onTool={onTool}
          />
          <SideBar
            side={side}
            eyedropper={eyedropper}
            onEyedropper={() => setEyedropper((on) => !on)}
            onUndo={() => engine()?.undo()}
            onRedo={() => engine()?.redo()}
          />
          {open === 'brushes' && (
            <BrushLibrary
              engine={engine}
              onClose={close}
              onSettings={(id) => {
                setSettingsFor(id);
                setOpen('brushSettings');
              }}
            />
          )}
          {open === 'brushSettings' && settingsFor && (
            <BrushSettings
              presetId={settingsFor}
              engine={engine}
              onBack={() => setOpen('brushes')}
              onClose={close}
            />
          )}
          {open === 'layers' && <LayersPanel engine={engine} onClose={close} onNotice={onNotice} />}
          {open === 'color' && <ColorPanel onClose={close} />}
          {open === 'actions' && (
            <ActionsPanel
              project={project}
              engine={engine}
              flush={flush}
              onNotice={onNotice}
              onClose={close}
              onInstall={
                onInstall &&
                (() => {
                  close();
                  onInstall();
                })
              }
              onUpdate={onUpdate}
              onNewCanvas={() => {
                close();
                onNewCanvas();
              }}
            />
          )}
        </>
      )}

      {loupe && (
        <div
          className={styles.loupe}
          style={{
            left: loupe.x,
            top: loupe.y,
            ['--loupe' as string]: loupe.color ?? 'transparent',
          }}
          role="status"
          aria-label={loupe.color ? `Picking ${loupe.color}` : 'Picking'}
        />
      )}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !['range', 'checkbox', 'color'].includes(target.type)) ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
