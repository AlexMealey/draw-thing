import { useState } from 'react';
import { resolvePreset } from '../../engine/brush/overrides';
import type { Engine } from '../../engine/Engine';
import {
  brushById,
  currentAdjustments,
  isBuiltIn,
  toolStore,
  useTools,
} from '../../state/toolStore';
import { BackIcon } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { percent } from '../ui/format';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';
import styles from './Brushes.module.css';
import { PressureCurveEditor } from './PressureCurveEditor';
import { usePreview } from './usePreview';

interface Props {
  presetId: string;
  engine: () => Engine | null;
  onBack: () => void;
  onClose: () => void;
  /** Shows another brush's settings (after Save as new brush). */
  onOpen: (presetId: string) => void;
}

/**
 * Edits a brush. A built-in brush's edits are saved per device as an override (Reset restores
 * the original); a custom brush is edited in place.
 */
export function BrushSettings({ presetId, engine, onBack, onClose, onOpen }: Props) {
  const builtIn = isBuiltIn(presetId);
  const base = useTools((s) => brushById(s, presetId));
  const override = useTools((s) => s.overrides[presetId]);
  const smoothing = useTools((s) => currentAdjustments(s).smoothing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = builtIn ? resolvePreset(base, override) : base;
  const preview = usePreview(engine);
  const {
    setOverride,
    resetOverride,
    updateCustomBrush,
    renameCustomBrush,
    saveAsNewBrush,
    deleteCustomBrush,
    adjust,
  } = toolStore.getState();
  const set = (patch: Parameters<typeof setOverride>[1]) =>
    builtIn ? setOverride(presetId, patch) : updateCustomBrush(presetId, patch);
  const x = (v: number) => `${v.toFixed(1)}×`;

  return (
    <Panel
      title={p.name}
      onClose={onClose}
      leading={
        <button className={ui.iconButton} aria-label="Back to brushes" onClick={onBack}>
          <BackIcon />
        </button>
      }
    >
      {!builtIn && (
        <input
          className={styles.nameInput}
          aria-label="Brush name"
          value={p.name}
          maxLength={40}
          onChange={(e) => renameCustomBrush(presetId, e.target.value)}
          onBlur={(e) => !e.target.value.trim() && renameCustomBrush(presetId, 'Brush')}
        />
      )}
      <img className={styles.preview} src={preview(p)} alt={`${p.name} preview`} />

      <h3 className={ui.section}>Stroke</h3>
      <SliderRow
        label="StreamLine"
        value={smoothing}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => adjust({ smoothing: v })}
      />
      <SliderRow
        label="Spacing"
        value={p.spacing}
        min={0.02}
        max={1}
        format={percent}
        onChange={(v) => set({ spacing: v })}
      />
      <SliderRow
        label="Flow"
        value={p.flow}
        min={0.01}
        max={1}
        format={percent}
        onChange={(v) => set({ flow: v })}
      />

      <h3 className={ui.section}>Shape</h3>
      <SliderRow
        label="Hardness"
        value={p.tip.hardness}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => set({ hardness: v })}
      />
      {p.grain && (
        <SliderRow
          label="Grain"
          value={p.grain.depth}
          min={0}
          max={1}
          format={percent}
          onChange={(v) => set({ grainDepth: v })}
        />
      )}

      <h3 className={ui.section}>Pressure → size</h3>
      <PressureCurveEditor
        label="Size pressure curve"
        curve={p.pressure.size}
        onChange={(c) => set({ sizeCurve: c })}
      />
      <SliderRow
        label="Minimum size"
        value={p.size.minRatio}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => set({ minSize: v })}
      />

      <h3 className={ui.section}>Pressure → flow</h3>
      <PressureCurveEditor
        label="Flow pressure curve"
        curve={p.pressure.flow}
        onChange={(c) => set({ flowCurve: c })}
      />
      <SliderRow
        label="Minimum flow"
        value={p.pressure.flowMin}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => set({ flowMin: v })}
      />

      <h3 className={ui.section}>Tilt</h3>
      <SliderRow
        label="Tilt size"
        value={p.tilt?.sizeBoost ?? 0}
        min={0}
        max={4}
        step={0.1}
        format={x}
        onChange={(v) => set({ tiltBoost: v })}
      />

      <h3 className={ui.section}>Jitter</h3>
      <SliderRow
        label="Size"
        value={p.jitter?.size ?? 0}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => set({ jitterSize: v })}
      />
      <SliderRow
        label="Rotation"
        value={p.jitter?.angle ?? 0}
        min={0}
        max={1}
        format={percent}
        onChange={(v) => set({ jitterAngle: v })}
      />
      <SliderRow
        label="Scatter"
        value={p.jitter?.scatter ?? 0}
        min={0}
        max={0.5}
        format={percent}
        onChange={(v) => set({ scatter: v })}
      />

      <div className={styles.footer}>
        {builtIn ? (
          <button
            className={ui.textButton}
            disabled={!override}
            onClick={() => {
              resetOverride(presetId);
              adjust({ smoothing: base.stabilization });
            }}
          >
            Reset brush
          </button>
        ) : confirmDelete ? (
          <>
            <button className={ui.textButton} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button
              className={`${ui.textButton} ${ui.danger}`}
              onClick={() => {
                deleteCustomBrush(presetId);
                onBack();
              }}
            >
              Delete {p.name}
            </button>
          </>
        ) : (
          <button
            className={`${ui.textButton} ${ui.danger}`}
            onClick={() => setConfirmDelete(true)}
          >
            Delete brush
          </button>
        )}
        {!confirmDelete && (
          <button
            className={`${ui.textButton} ${ui.primary}`}
            onClick={() => onOpen(saveAsNewBrush(presetId))}
          >
            Save as new brush
          </button>
        )}
      </div>
    </Panel>
  );
}
