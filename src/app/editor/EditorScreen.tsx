import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import { documentStore, useDocument } from '../../state/documentStore';
import {
  currentAdjustments,
  maxBrushSize,
  toolSettings,
  toolStore,
  useTools,
} from '../../state/toolStore';
import { CanvasViewport } from '../CanvasViewport';
import type { OpenProject, Session } from '../project';
import { ActionsPanel } from './ActionsPanel';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { AnimationPanel, FramePanel } from './AnimationPanels';
import { ArrowRotation } from './arrowRotation';
import { SharePanel } from './SharePanel';
import { BrushLibrary } from './BrushLibrary';
import { BrushSettings } from './BrushSettings';
import { ColorPanel } from './ColorPanel';
import styles from './EditorScreen.module.css';
import { LayersPanel } from './LayersPanel';
import { PaletteManager } from './PaletteManager';
import { RotationPill } from './RotationPill';
import { SideBar } from './SideBar';
import { Timeline, TIMELINE_H } from './Timeline';
import { TopBar } from './TopBar';

/** Room taken by the top bar and sidebar, so fitting keeps the canvas out from under them. */
const TOPBAR = 60;
const SIDEBAR = 64;

export type PanelId =
  | 'brushes'
  | 'brushSettings'
  | 'layers'
  | 'color'
  | 'actions'
  | 'share'
  | 'adjustments'
  | 'frame'
  | 'animation';

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
  const [palettesOpen, setPalettesOpen] = useState(false);

  const mode = useTools((s) => s.mode);
  const color = useTools((s) => s.color);
  const presetIds = useTools((s) => s.presetIds);
  const adjustments = useTools((s) => s.adjustments);
  const overrides = useTools((s) => s.overrides);
  const sidebarRight = useTools((s) => s.sidebarRight);
  const fingerDrawing = useTools((s) => s.fingerDrawing);
  const snapRotation = useTools((s) => s.snapRotation);
  const keyZoom = useTools((s) => s.keyZoomStep);
  const wheel = useTools((s) => s.wheel);
  const cursorOutline = useTools((s) => s.cursorOutline);
  const cursorOutlineSize = useTools((s) => s.cursorOutlineSize);
  const cursorOutlineFixed = useTools((s) => s.cursorOutlineFixed);
  const onion = useTools((s) => s.onion);
  const animation = useDocument((s) => s.animation.enabled);
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
    engine()?.setViewPrefs({ snapRotation, keyZoom, wheel });
  }, [engine, snapRotation, keyZoom, wheel]);

  useEffect(() => {
    engine()?.setCursorPrefs({
      outline: cursorOutline,
      size: cursorOutlineSize === 'brush' ? 'brush' : cursorOutlineFixed,
    });
  }, [engine, cursorOutline, cursorOutlineSize, cursorOutlineFixed]);

  useEffect(() => {
    engine()?.setEyedropper(eyedropper);
  }, [engine, eyedropper]);

  useEffect(() => {
    engine()?.setOnion(onion);
  }, [engine, onion]);

  // Keyboard shortcuts (Ctrl/⌘ combinations are handled by the engine).
  useEffect(() => {
    const rotation = new ArrowRotation(
      (degrees) => engine()?.rotateView(degrees),
      () => toolStore.getState().arrowRotateStep,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const tools = toolStore.getState();
      const size = currentAdjustments(tools).size;
      const { width, height } = documentStore.getState();
      const max = maxBrushSize(width, height);
      const step = 1 + tools.sizeStep;
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
          tools.adjust({ size: Math.max(1, Math.round(size / step)) });
          break;
        case ']':
          tools.adjust({ size: Math.min(max, Math.max(size + 1, Math.round(size * step))) });
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          // Arrow keys also move sliders and radio buttons: leave them to focused controls.
          if (!tools.arrowRotate || isControl(e.target)) return;
          // Holding turns continuously (ArrowRotation), so key-repeat is ignored.
          if (!e.repeat) rotation.press(e.key === 'ArrowLeft' ? -1 : 1);
          break;
        case ',':
        case '.':
          if (!documentStore.getState().animation.enabled) return;
          engine()?.stepFrame(e.key === ',' ? -1 : 1);
          break;
        case '/': {
          const e2 = engine();
          if (!documentStore.getState().animation.enabled || !e2) return;
          e2.setPlaying(!e2.playing);
          break;
        }
        case 'Escape':
          setOpen(null);
          setEyedropper(false);
          setPalettesOpen(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') rotation.release(-1);
      else if (e.key === 'ArrowRight') rotation.release(1);
    };
    const stop = () => rotation.release();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stop);
    return () => {
      rotation.release();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stop);
    };
  }, [toggle, engine]);

  const close = () => setOpen(null);
  const side = sidebarRight ? 'right' : 'left';
  const timeline = animation && !uiHidden;

  // Room the timeline takes at the bottom, for everything fixed there (sheets, sidebar, prompts).
  useEffect(() => {
    if (!timeline) return;
    const root = document.documentElement.style;
    root.setProperty('--timeline-h', `${TIMELINE_H}px`);
    root.setProperty('--timeline-space', `calc(var(--safe-bottom) + ${TIMELINE_H}px)`);
    root.setProperty('--sheet-safe', '0px');
    return () => {
      root.removeProperty('--timeline-h');
      root.removeProperty('--timeline-space');
      root.removeProperty('--sheet-safe');
    };
  }, [timeline]);
  const insets = useMemo(
    () =>
      uiHidden
        ? { top: 0, right: 0, bottom: 0, left: 0 }
        : {
            top: TOPBAR,
            right: sidebarRight ? SIDEBAR : 0,
            bottom: animation ? TIMELINE_H + 4 : 0,
            left: sidebarRight ? 0 : SIDEBAR,
          },
    [uiHidden, sidebarRight, animation],
  );

  return (
    <div className={styles.editor}>
      <main
        className={styles.canvasHost}
        aria-label="Canvas"
        // Adjustments stay open so the canvas can be pinched and panned to inspect the preview.
        onPointerDownCapture={() => open && open !== 'adjustments' && setOpen(null)}
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
          <RotationPill side={side} onReset={() => engine()?.resetRotation()} />
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
              key={settingsFor}
              presetId={settingsFor}
              engine={engine}
              onBack={() => setOpen('brushes')}
              onClose={close}
              onOpen={setSettingsFor}
            />
          )}
          {open === 'layers' && (
            <LayersPanel
              engine={engine}
              onClose={close}
              onNotice={onNotice}
              onAdjust={() => setOpen('adjustments')}
            />
          )}
          {open === 'color' && (
            <ColorPanel onClose={close} onPalettes={() => setPalettesOpen(true)} />
          )}
          {palettesOpen && (
            <PaletteManager onClose={() => setPalettesOpen(false)} onNotice={onNotice} />
          )}
          {open === 'adjustments' && <AdjustmentsPanel engine={engine} onClose={close} />}
          {open === 'actions' && (
            <ActionsPanel
              project={project}
              engine={engine}
              flush={flush}
              debug={debug}
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
          {timeline && <Timeline engine={engine} open={open} onToggle={toggle} />}
          {animation && open === 'frame' && <FramePanel engine={engine} onClose={close} />}
          {animation && open === 'animation' && <AnimationPanel onClose={close} />}
          {open === 'share' && (
            <SharePanel
              project={project}
              engine={engine}
              flush={flush}
              onNotice={onNotice}
              onClose={close}
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

function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && (target.isContentEditable || target.role === 'radio'))
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
