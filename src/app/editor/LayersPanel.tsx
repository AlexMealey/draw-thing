import { useRef, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import {
  activeIndex,
  BLEND_MODES,
  type BlendMode,
  documentStore,
  type LayerGroup,
  type LayerMeta,
  layerRows,
  useDocument,
} from '../../state/documentStore';
import { useThumbnail } from '../../state/thumbnailStore';
import { ChevronIcon, HandleIcon, PlusIcon } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { percent } from '../ui/format';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';
import styles from './LayersPanel.module.css';

interface Props {
  engine: () => Engine | null;
  onClose: () => void;
  onNotice: (message: string) => void;
  /** Opens the adjustments (hue, blur…) for the active layer. */
  onAdjust: () => void;
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

/** A row of the panel as shown: group headers, their children (unless collapsed), layers. */
type Item =
  | { kind: 'group'; id: string; group: LayerGroup; children: LayerMeta[] }
  | { kind: 'layer'; id: string; layer: LayerMeta };

interface Drag {
  id: string;
  startY: number;
  dy: number;
  rowH: number;
}

export function LayersPanel({ engine, onClose, onNotice, onAdjust }: Props) {
  const layers = useDocument((s) => s.layers);
  const groups = useDocument((s) => s.groups);
  const activeId = useDocument((s) => s.activeLayerId);
  const maxLayers = useDocument((s) => s.maxLayers);
  const background = useDocument((s) => s.background);
  const doc = documentStore.getState();
  const index = activeIndex({ layers, activeLayerId: activeId });
  const active = layers[index];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const selectedGroup = groups.find((g) => g.id === groupId);

  const items: Item[] = [];
  for (const row of layerRows({ layers, groups })) {
    if (row.kind === 'layer') {
      items.push({ kind: 'layer', id: row.layer.id, layer: row.layer });
      continue;
    }
    items.push({ kind: 'group', id: row.group.id, group: row.group, children: row.children });
    if (!row.group.collapsed) {
      for (const layer of row.children) items.push({ kind: 'layer', id: layer.id, layer });
    }
  }

  const add = () => {
    if (doc.addLayer() === null) onNotice(`Layer limit reached (${maxLayers} at this canvas size)`);
    setGroupId(null);
  };

  /** Drops the dragged row where it was let go: it lands below the row now above it. */
  const drop = (d: Drag) => {
    const dragged = items.find((it) => it.id === d.id);
    if (!dragged) return;
    const moving = (it: Item) =>
      it.id === d.id ||
      (dragged.kind === 'group' && it.kind === 'layer' && it.layer.groupId === d.id);
    const from = items.indexOf(dragged);
    const others = items.filter((it) => !moving(it));
    const slot = Math.min(others.length, Math.max(0, from + Math.round(d.dy / d.rowH)));
    const above = others[slot - 1];
    const below = others[slot];
    const rest = layers.filter((l) =>
      dragged.kind === 'group' ? l.groupId !== d.id : l.id !== d.id,
    );
    const at = (id: string) => rest.findIndex((l) => l.id === id);
    const bottomOf = (g: string) => rest.findIndex((l) => l.groupId === g);
    const topOf = (g: string) => rest.findLastIndex((l) => l.groupId === g);

    if (dragged.kind === 'group') {
      if (!above) return doc.moveGroup(d.id, rest.length);
      const g = above.kind === 'group' ? above.id : above.layer.groupId;
      return doc.moveGroup(d.id, g ? bottomOf(g) : at(above.id));
    }
    const own = dragged.layer.groupId;
    if (!above) return doc.moveLayer(d.id, rest.length, null);
    if (above.kind === 'group') {
      const top = topOf(above.id);
      return doc.moveLayer(d.id, top < 0 ? layers.indexOf(dragged.layer) : top + 1, above.id);
    }
    const g = above.layer.groupId;
    // Just below a group's bottom layer: a layer from that group stays in it, others land outside.
    const leaving =
      g !== null && g !== own && !(below?.kind === 'layer' && below.layer.groupId === g);
    doc.moveLayer(d.id, at(above.id), leaving ? null : g);
  };

  const dragProps = (id: string) => ({
    dragDy: drag && (drag.id === id || isChildOf(id, drag.id)) ? drag.dy : 0,
    onDragStart: (startY: number, rowH: number) => setDrag({ id, startY, dy: 0, rowH }),
    onDragMove: (y: number) => setDrag((d) => d && { ...d, dy: y - d.startY }),
    onDragEnd: () => {
      if (drag) drop(drag);
      setDrag(null);
    },
  });
  const isChildOf = (layerId: string, group: string) =>
    layers.some((l) => l.id === layerId && l.groupId === group);

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
        {items.map((it) =>
          it.kind === 'group' ? (
            <GroupRow
              key={it.id}
              group={it.group}
              selected={it.id === groupId}
              renaming={renaming === it.id}
              onSelect={() => (it.id === groupId ? setRenaming(it.id) : setGroupId(it.id))}
              onRename={(name) => {
                if (name.trim() && name !== it.group.name) {
                  doc.updateGroup(it.id, { name: name.trim() });
                }
                setRenaming(null);
              }}
              onCollapse={() => doc.updateGroup(it.id, { collapsed: !it.group.collapsed })}
              onVisible={(visible) => doc.updateGroup(it.id, { visible })}
              {...dragProps(it.id)}
            />
          ) : (
            <LayerRow
              key={it.id}
              id={it.id}
              name={it.layer.name}
              visible={it.layer.visible}
              blend={it.layer.blendMode}
              grouped={it.layer.groupId !== null}
              active={it.id === activeId && groupId === null}
              renaming={renaming === it.id}
              onSelect={() => {
                if (it.id === activeId && groupId === null) setRenaming(it.id);
                else doc.selectLayer(it.id);
                setGroupId(null);
              }}
              onRename={(name) => {
                if (name.trim() && name !== it.layer.name) {
                  doc.updateLayer(it.id, { name: name.trim() });
                }
                setRenaming(null);
              }}
              onVisible={(visible) => doc.updateLayer(it.id, { visible })}
              onBlendChip={() => {
                doc.selectLayer(it.id);
                setGroupId(null);
              }}
              {...dragProps(it.id)}
            />
          ),
        )}
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

      {selectedGroup ? (
        <div className={styles.props}>
          <SliderRow
            label="Group opacity"
            value={selectedGroup.opacity}
            min={0}
            max={1}
            format={percent}
            onChange={(opacity) => doc.updateGroup(selectedGroup.id, { opacity })}
          />
          <label className={ui.switch}>
            Alpha lock all layers
            <input
              type="checkbox"
              checked={selectedGroup.alphaLocked}
              onChange={(e) => doc.updateGroup(selectedGroup.id, { alphaLocked: e.target.checked })}
            />
          </label>
          <label className={ui.switch}>
            Lock all layers
            <input
              type="checkbox"
              checked={selectedGroup.locked}
              onChange={(e) => doc.updateGroup(selectedGroup.id, { locked: e.target.checked })}
            />
          </label>
          <div className={styles.actions}>
            <button className={ui.textButton} onClick={() => setRenaming(selectedGroup.id)}>
              Rename
            </button>
            <button
              className={ui.textButton}
              onClick={() => {
                doc.ungroup(selectedGroup.id);
                setGroupId(null);
              }}
            >
              Ungroup
            </button>
            <button
              className={`${ui.textButton} ${ui.danger}`}
              onClick={() => {
                if (doc.removeGroup(selectedGroup.id)) setGroupId(null);
                else onNotice('A drawing needs at least one layer');
              }}
            >
              Delete group
            </button>
          </div>
        </div>
      ) : (
        active && (
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
              {active.groupId === null ? (
                <button
                  className={ui.textButton}
                  onClick={() => setGroupId(doc.groupLayer(active.id))}
                >
                  Group
                </button>
              ) : (
                <button className={ui.textButton} onClick={() => doc.removeFromGroup(active.id)}>
                  Ungroup layer
                </button>
              )}
              <button className={ui.textButton} onClick={onAdjust}>
                Adjust…
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
        )
      )}
    </Panel>
  );
}

interface DragProps {
  dragDy: number;
  onDragStart: (y: number, rowH: number) => void;
  onDragMove: (y: number) => void;
  onDragEnd: () => void;
}

/** The reorder grip; drags report the pointer's y. */
function Handle({ label, p, row }: { label: string; p: DragProps; row: () => HTMLElement | null }) {
  const dragging = useRef(false);
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    p.onDragEnd();
  };
  return (
    <span
      className={styles.handle}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        p.onDragStart(e.clientY, row()?.getBoundingClientRect().height ?? 56);
      }}
      onPointerMove={(e) => dragging.current && p.onDragMove(e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <HandleIcon />
    </span>
  );
}

const dragStyle = (dy: number) => (dy ? { transform: `translateY(${dy}px)` } : undefined);

interface GroupRowProps extends DragProps {
  group: LayerGroup;
  selected: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onCollapse: () => void;
  onVisible: (visible: boolean) => void;
}

function GroupRow(p: GroupRowProps) {
  const row = useRef<HTMLLIElement>(null);
  const g = p.group;
  return (
    <li
      ref={row}
      className={`${styles.row} ${styles.group} ${g.visible ? '' : styles.hiddenLayer}`}
      aria-current={p.selected}
      data-dragging={p.dragDy !== 0}
      style={dragStyle(p.dragDy)}
    >
      <Handle label={`Reorder ${g.name}`} p={p} row={() => row.current} />
      <button
        className={styles.collapse}
        aria-label={g.collapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
        aria-expanded={!g.collapsed}
        onClick={p.onCollapse}
      >
        <ChevronIcon />
      </button>
      {p.renaming ? (
        <RenameInput name={g.name} label="Group name" onRename={p.onRename} />
      ) : (
        <button className={styles.name} onClick={p.onSelect}>
          {g.name}
          {(g.locked || g.alphaLocked || g.opacity < 1) && (
            <span className={styles.badges}>
              {g.opacity < 1 && ` ${percent(g.opacity)}`}
              {g.alphaLocked && ' · α'}
              {g.locked && ' · locked'}
            </span>
          )}
        </button>
      )}
      <span />
      <input
        className={styles.eye}
        type="checkbox"
        aria-label={g.visible ? `Hide ${g.name}` : `Show ${g.name}`}
        checked={g.visible}
        onChange={(e) => p.onVisible(e.target.checked)}
      />
    </li>
  );
}

function RenameInput(p: { name: string; label: string; onRename: (name: string) => void }) {
  return (
    <input
      className={styles.rename}
      aria-label={p.label}
      defaultValue={p.name}
      autoFocus
      onBlur={(e) => p.onRename(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onRename(e.currentTarget.value);
        if (e.key === 'Escape') p.onRename(p.name);
      }}
    />
  );
}

interface RowProps extends DragProps {
  id: string;
  name: string;
  visible: boolean;
  blend: BlendMode;
  grouped: boolean;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onVisible: (visible: boolean) => void;
  onBlendChip: () => void;
}

function LayerRow(p: RowProps) {
  const thumb = useThumbnail(p.id);
  const row = useRef<HTMLLIElement>(null);

  return (
    <li
      ref={row}
      className={`${styles.row} ${p.grouped ? styles.child : ''} ${p.visible ? '' : styles.hiddenLayer}`}
      aria-current={p.active}
      data-dragging={p.dragDy !== 0}
      style={dragStyle(p.dragDy)}
    >
      <Handle label={`Reorder ${p.name}`} p={p} row={() => row.current} />
      <button
        className={`${styles.thumb} ${ui.checker}`}
        aria-label={`Select ${p.name}`}
        onClick={p.onSelect}
      >
        {thumb && <img src={thumb} alt="" />}
      </button>
      {p.renaming ? (
        <RenameInput name={p.name} label="Layer name" onRename={p.onRename} />
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
