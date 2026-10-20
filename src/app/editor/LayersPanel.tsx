import { useRef, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import {
  activeIndex,
  BLEND_MODES,
  type BlendMode,
  documentStore,
  useDocument,
} from '../../state/documentStore';
import { useThumbnail } from '../../state/thumbnailStore';
import { HandleIcon, PlusIcon } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { percent } from '../ui/format';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';
import styles from './LayersPanel.module.css';

interface Props {
  engine: () => Engine | null;
  onClose: () => void;
  onNotice: (message: string) => void;
}

const BLEND_LETTER: Record<BlendMode, string> = {
  normal: 'N',
  multiply: 'M',
  screen: 'S',
  overlay: 'O',
  darken: 'D',
  lighten: 'L',
  'color-dodge': 'CD',
  'color-burn': 'CB',
  add: 'A',
};

const BLEND_NAME: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  add: 'Add',
};

interface Drag {
  id: string;
  startY: number;
  dy: number;
  rowH: number;
}

export function LayersPanel({ engine, onClose, onNotice }: Props) {
  const layers = useDocument((s) => s.layers);
  const activeId = useDocument((s) => s.activeLayerId);
  const maxLayers = useDocument((s) => s.maxLayers);
  const background = useDocument((s) => s.background);
  const doc = documentStore.getState();
  const index = activeIndex({ layers, activeLayerId: activeId });
  const active = layers[index];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const display = [...layers].reverse(); // top of the stack first

  const add = () => {
    if (doc.addLayer() === null) onNotice(`Layer limit reached (${maxLayers} at this canvas size)`);
  };

  const dropIndex = (d: Drag) => {
    const from = display.findIndex((l) => l.id === d.id);
    const to = Math.min(display.length - 1, Math.max(0, from + Math.round(d.dy / d.rowH)));
    return layers.length - 1 - to; // back to stack order
  };

  return (
    <Panel
      title={`Layers ${layers.length}/${maxLayers}`}
      onClose={onClose}
      actions={
        <button className={ui.iconButton} aria-label="Add layer" onClick={add}>
          <PlusIcon />
        </button>
      }
    >
      <ul className={styles.list}>
        {display.map((l) => (
          <LayerRow
            key={l.id}
            id={l.id}
            name={l.name}
            visible={l.visible}
            blend={l.blendMode}
            active={l.id === activeId}
            renaming={renaming === l.id}
            dragDy={drag?.id === l.id ? drag.dy : 0}
            onSelect={() => (l.id === activeId ? setRenaming(l.id) : doc.selectLayer(l.id))}
            onRename={(name) => {
              if (name.trim() && name !== l.name) doc.updateLayer(l.id, { name: name.trim() });
              setRenaming(null);
            }}
            onVisible={(visible) => doc.updateLayer(l.id, { visible })}
            onBlendChip={() => doc.selectLayer(l.id)}
            onDragStart={(startY, rowH) => setDrag({ id: l.id, startY, dy: 0, rowH })}
            onDragMove={(y) => setDrag((d) => d && { ...d, dy: y - d.startY })}
            onDragEnd={() => {
              if (drag) doc.moveLayer(drag.id, dropIndex(drag));
              setDrag(null);
            }}
          />
        ))}
        <li
          className={`${styles.row} ${styles.background} ${background.visible ? '' : styles.hiddenLayer}`}
        >
          <span />
          <input
            type="color"
            aria-label="Background color"
            value={background.color}
            onChange={(e) => doc.setBackground({ color: e.target.value })}
          />
          <span className={styles.name}>Background</span>
          <input
            className={styles.eye}
            type="checkbox"
            aria-label={background.visible ? 'Hide background' : 'Show background'}
            checked={background.visible}
            onChange={(e) => doc.setBackground({ visible: e.target.checked })}
          />
        </li>
      </ul>

      {active && (
        <div className={styles.props}>
          <SliderRow
            label="Opacity"
            value={active.opacity}
            min={0}
            max={1}
            format={percent}
            onChange={(opacity) => doc.updateLayer(active.id, { opacity })}
          />
          <label className={ui.row}>
            <span>Blend</span>
            <select
              aria-label="Blend"
              value={active.blendMode}
              onChange={(e) =>
                doc.updateLayer(active.id, { blendMode: e.target.value as BlendMode })
              }
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {BLEND_NAME[m]}
                </option>
              ))}
            </select>
            <span />
          </label>
          <label className={ui.switch}>
            Alpha lock
            <input
              type="checkbox"
              checked={active.alphaLocked}
              onChange={(e) => doc.updateLayer(active.id, { alphaLocked: e.target.checked })}
            />
          </label>
          <label className={ui.switch}>
            Lock layer
            <input
              type="checkbox"
              checked={active.locked}
              onChange={(e) => doc.updateLayer(active.id, { locked: e.target.checked })}
            />
          </label>
          <div className={styles.actions}>
            <button className={ui.textButton} onClick={() => setRenaming(active.id)}>
              Rename
            </button>
            <button className={ui.textButton} onClick={() => engine()?.duplicateLayer()}>
              Duplicate
            </button>
            <button
              className={ui.textButton}
              onClick={() => engine()?.mergeDown()}
              disabled={index <= 0}
            >
              Merge down
            </button>
            <button className={ui.textButton} onClick={() => engine()?.clearLayer()}>
              Clear
            </button>
            <button
              className={ui.textButton}
              onClick={() => engine()?.flatten()}
              disabled={layers.length < 2}
            >
              Flatten
            </button>
            <button
              className={`${ui.textButton} ${ui.danger}`}
              onClick={() => doc.removeLayer(active.id)}
              disabled={layers.length <= 1}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

interface RowProps {
  id: string;
  name: string;
  visible: boolean;
  blend: BlendMode;
  active: boolean;
  renaming: boolean;
  dragDy: number;
  onSelect: () => void;
  onRename: (name: string) => void;
  onVisible: (visible: boolean) => void;
  onBlendChip: () => void;
  onDragStart: (y: number, rowH: number) => void;
  onDragMove: (y: number) => void;
  onDragEnd: () => void;
}

function LayerRow(p: RowProps) {
  const thumb = useThumbnail(p.id);
  const row = useRef<HTMLLIElement>(null);
  const dragging = useRef(false);

  return (
    <li
      ref={row}
      className={`${styles.row} ${p.visible ? '' : styles.hiddenLayer}`}
      aria-current={p.active}
      data-dragging={p.dragDy !== 0}
      style={p.dragDy ? { transform: `translateY(${p.dragDy}px)` } : undefined}
    >
      <span
        className={styles.handle}
        aria-label={`Reorder ${p.name}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          p.onDragStart(e.clientY, row.current?.getBoundingClientRect().height ?? 56);
        }}
        onPointerMove={(e) => dragging.current && p.onDragMove(e.clientY)}
        onPointerUp={() => {
          dragging.current = false;
          p.onDragEnd();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          p.onDragEnd();
        }}
      >
        <HandleIcon />
      </span>
      <button
        className={`${styles.thumb} ${ui.checker}`}
        aria-label={`Select ${p.name}`}
        onClick={p.onSelect}
      >
        {thumb && <img src={thumb} alt="" />}
      </button>
      {p.renaming ? (
        <input
          className={styles.rename}
          aria-label="Layer name"
          defaultValue={p.name}
          autoFocus
          onBlur={(e) => p.onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') p.onRename(e.currentTarget.value);
            if (e.key === 'Escape') p.onRename(p.name);
          }}
        />
      ) : (
        <button className={styles.name} onClick={p.onSelect}>
          {p.name}
        </button>
      )}
      <button
        className={styles.chip}
        aria-label={`${p.name} blend mode ${BLEND_NAME[p.blend]}`}
        onClick={p.onBlendChip}
      >
        {BLEND_LETTER[p.blend]}
      </button>
      <input
        className={styles.eye}
        type="checkbox"
        aria-label={p.visible ? `Hide ${p.name}` : `Show ${p.name}`}
        checked={p.visible}
        onChange={(e) => p.onVisible(e.target.checked)}
      />
    </li>
  );
}
