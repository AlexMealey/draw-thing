import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import { useAnimationView } from '../../state/animationStore';
import { documentStore, type FrameMeta, useDocument } from '../../state/documentStore';
import { toolStore, useTools } from '../../state/toolStore';
import { CloneIcon, OnionIcon, PauseIcon, PlayIcon, PlusIcon, SettingsIcon } from '../ui/icons';
import ui from '../ui/ui.module.css';
import type { PanelId } from './EditorScreen';
import styles from './Timeline.module.css';

/** Height of the strip above the safe area, px (EditorScreen keeps the canvas clear of it). */
export const TIMELINE_H = 76;
/** Height of a frame thumbnail, px. */
const CELL_H = 50;
/** Touch: hold this long on a frame to pick it up and drag it. */
const LONG_PRESS_MS = 350;
/** Mouse/pen: move this far to start dragging a frame. */
const DRAG_PX = 6;

interface Props {
  engine: () => Engine | null;
  open: PanelId | null;
  onToggle: (panel: PanelId) => void;
}

interface Drag {
  id: string;
  /** Pointer x where the drag started. */
  x0: number;
  dx: number;
  /** Width of one cell plus the gap. */
  pitch: number;
}

/**
 * The animation timeline along the bottom: play/pause, the frames in order (tap to show one, tap
 * again for its options, drag to reorder), and buttons to clone the frame or start a blank one.
 */
export function Timeline({ engine, open, onToggle }: Props) {
  const frames = useDocument((s) => s.frames);
  const activeFrameId = useDocument((s) => s.activeFrameId);
  const width = useDocument((s) => s.width);
  const height = useDocument((s) => s.height);
  const thumbs = useAnimationView((s) => s.thumbs);
  const playing = useAnimationView((s) => s.playing);
  const preparing = useAnimationView((s) => s.preparing);
  const onion = useTools((s) => s.onion);
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const cellW = Math.round(Math.min(96, Math.max(32, (CELL_H * width) / Math.max(1, height))));

  // Keep the active frame in view.
  useEffect(() => {
    const cell = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeFrameId, frames.length]);

  // While a frame is being dragged, a touch must not scroll the strip.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current && e.cancelable) e.preventDefault();
    };
    list.addEventListener('touchmove', block, { passive: false });
    return () => list.removeEventListener('touchmove', block);
  }, []);

  const select = (f: FrameMeta) => {
    const e = engine();
    if (!e) return;
    if (f.id === activeFrameId) onToggle('frame');
    else e.selectFrame(f.id);
  };

  const drop = (d: Drag) => {
    const from = frames.findIndex((f) => f.id === d.id);
    const to = Math.min(frames.length - 1, Math.max(0, from + Math.round(d.dx / d.pitch)));
    if (to !== from) documentStore.getState().moveFrame(d.id, to);
  };

  const busy = playing || preparing !== null;

  return (
    <footer className={styles.timeline} aria-label="Timeline">
      <button
        className={ui.iconButton}
        aria-label={playing ? 'Stop' : 'Play'}
        aria-pressed={playing}
        onClick={() => engine()?.setPlaying(!playing)}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <ol className={styles.frames} ref={listRef} style={{ ['--cell-w' as string]: `${cellW}px` }}>
        {frames.map((f, i) => (
          <FrameCell
            key={f.id}
            frame={f}
            index={i}
            active={f.id === activeFrameId}
            thumb={thumbs[f.id]}
            dx={drag?.id === f.id ? drag.dx : 0}
            disabled={busy}
            onSelect={() => select(f)}
            onDragStart={(x0, pitch) => updateDrag({ id: f.id, x0, dx: 0, pitch })}
            onDragMove={(x) => {
              const d = dragRef.current;
              if (d) updateDrag({ ...d, dx: x - d.x0 });
            }}
            onDragEnd={(cancelled) => {
              const d = dragRef.current;
              updateDrag(null);
              if (d && !cancelled) drop(d);
            }}
          />
        ))}
      </ol>
      {preparing !== null && (
        <span className={styles.status} role="status">
          Preparing {Math.round(preparing * 100)}%
        </span>
      )}
      <div className={styles.buttons}>
        <button
          className={ui.iconButton}
          aria-label="Clone frame"
          title="Clone frame"
          disabled={busy}
          onClick={() => engine()?.cloneFrame()}
        >
          <CloneIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="New frame"
          title="New blank frame"
          disabled={busy}
          onClick={() => engine()?.newFrame()}
        >
          <PlusIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Onion skin"
          title="Onion skin"
          aria-pressed={onion.enabled}
          onClick={() =>
            toolStore.getState().setPrefs({ onion: { ...onion, enabled: !onion.enabled } })
          }
        >
          <OnionIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Animation settings"
          aria-expanded={open === 'animation'}
          onClick={() => onToggle('animation')}
        >
          <SettingsIcon />
        </button>
      </div>
    </footer>
  );
}

interface CellProps {
  frame: FrameMeta;
  index: number;
  active: boolean;
  thumb: string | undefined;
  /** Offset while being dragged, px. */
  dx: number;
  disabled: boolean;
  onSelect: () => void;
  onDragStart: (x: number, pitch: number) => void;
  onDragMove: (x: number) => void;
  onDragEnd: (cancelled: boolean) => void;
}

function FrameCell(p: CellProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = useRef<{
    x: number;
    id: number;
    touch: boolean;
    dragging: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

  const start = (x: number) => {
    const el = ref.current;
    const s = press.current;
    if (!el || !s) return;
    s.dragging = true;
    const next = el.parentElement?.nextElementSibling ?? el.parentElement?.previousElementSibling;
    const own = el.parentElement?.getBoundingClientRect();
    const other = next?.getBoundingClientRect();
    const pitch = own && other ? Math.abs(other.left - own.left) : (own?.width ?? 60) + 6;
    p.onDragStart(x, pitch);
  };

  const end = (cancelled: boolean) => {
    const s = press.current;
    press.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.dragging) p.onDragEnd(cancelled);
    else if (!cancelled) p.onSelect();
  };

  const label = `Frame ${p.index + 1}${p.frame.hold > 1 ? `, held ${p.frame.hold}` : ''}`;
  return (
    <li
      className={styles.cell}
      data-dragging={p.dx !== 0}
      style={p.dx ? { transform: `translateX(${p.dx}px)` } : undefined}
    >
      <button
        ref={ref}
        className={styles.frame}
        aria-label={label}
        aria-current={p.active}
        disabled={p.disabled}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const touch = e.pointerType === 'touch';
          press.current = { x: e.clientX, id: e.pointerId, touch, dragging: false };
          if (touch) {
            press.current.timer = setTimeout(() => {
              const s = press.current;
              if (!s) return;
              ref.current?.setPointerCapture(s.id);
              start(s.x);
            }, LONG_PRESS_MS);
          } else {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const s = press.current;
          if (!s || e.pointerId !== s.id) return;
          if (s.dragging) p.onDragMove(e.clientX);
          else if (!s.touch && Math.abs(e.clientX - s.x) > DRAG_PX) start(s.x);
        }}
        onPointerUp={() => end(false)}
        onPointerCancel={() => end(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            p.onSelect();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <span className={ui.checker} />}
        <span className={styles.number}>{p.index + 1}</span>
        {p.frame.hold > 1 && <span className={styles.hold}>×{p.frame.hold}</span>}
      </button>
    </li>
  );
}
