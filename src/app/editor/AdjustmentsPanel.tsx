import { useEffect, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import {
  type AdjustmentKind,
  type AdjustmentParams,
  MAX_BLUR_RADIUS,
  MAX_MOTION_DISTANCE,
  NEUTRAL_ADJUSTMENT,
} from '../../engine/filters/Filters';
import { useAdjustment } from '../../state/adjustmentStore';
import { BackIcon } from '../ui/icons';
import { Panel } from '../ui/Panel';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';

interface Props {
  engine: () => Engine | null;
  onClose: () => void;
}

const KINDS: [AdjustmentKind, string, string][] = [
  ['hsb', 'Hue, Saturation, Brightness', 'Shift colors, make them richer or duller'],
  ['brightnessContrast', 'Brightness & Contrast', 'Lighten, darken, add or reduce punch'],
  ['gaussian', 'Gaussian Blur', 'Soften the whole layer evenly'],
  ['motion', 'Motion Blur', 'Smear the layer along a direction'],
];

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const px = (v: number) => `${Math.round(v)} px`;
const deg = (v: number) => `${Math.round(v)}°`;

/**
 * Procreate-style Adjustments: pick one, drag its sliders while the active layer previews the
 * result, then Apply (one undo step) or Cancel. Closing the panel cancels.
 */
export function AdjustmentsPanel({ engine, onClose }: Props) {
  const kind = useAdjustment((s) => s.kind);
  const [params, setParams] = useState<AdjustmentParams>(NEUTRAL_ADJUSTMENT);

  useEffect(() => () => engine()?.cancelAdjustment(), [engine]);

  const start = (k: AdjustmentKind) => {
    setParams(NEUTRAL_ADJUSTMENT);
    engine()?.beginAdjustment(k);
  };
  const set = (patch: Partial<AdjustmentParams>) => {
    setParams((p) => ({ ...p, ...patch }));
    engine()?.setAdjustment(patch);
  };
  const slider = (
    key: keyof AdjustmentParams,
    label: string,
    min: number,
    max: number,
    format: (v: number) => string,
    step = 0.01,
  ) => (
    <SliderRow
      label={label}
      value={params[key]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={(v) => set({ [key]: v })}
    />
  );

  const title = KINDS.find(([k]) => k === kind)?.[1] ?? 'Adjustments';

  return (
    <Panel
      title={title}
      onClose={onClose}
      leading={
        kind && (
          <button
            className={ui.iconButton}
            aria-label="Back to adjustments"
            onClick={() => engine()?.cancelAdjustment()}
          >
            <BackIcon />
          </button>
        )
      }
    >
      {!kind ? (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Changes the selected layer. Pinch and pan to look closer while you adjust.
          </p>
          {KINDS.map(([k, name, what]) => (
            <button
              key={k}
              className={ui.textButton}
              style={{ display: 'block', width: '100%', textAlign: 'left', margin: '6px 0' }}
              onClick={() => start(k)}
            >
              {name}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>
                {what}
              </span>
            </button>
          ))}
        </>
      ) : (
        <>
          {kind === 'hsb' && (
            <>
              {slider('hue', 'Hue', -180, 180, deg, 1)}
              {slider('saturation', 'Saturation', -1, 1, signed)}
              {slider('brightness', 'Brightness', -1, 1, signed)}
            </>
          )}
          {kind === 'brightnessContrast' && (
            <>
              {slider('brightness', 'Brightness', -1, 1, signed)}
              {slider('contrast', 'Contrast', -1, 1, signed)}
            </>
          )}
          {kind === 'gaussian' && slider('radius', 'Radius', 0, MAX_BLUR_RADIUS, px, 0.5)}
          {kind === 'motion' && (
            <>
              {slider('distance', 'Distance', 0, MAX_MOTION_DISTANCE, px, 1)}
              {slider('angle', 'Angle', 0, 180, deg, 1)}
            </>
          )}
          <p style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className={ui.textButton} onClick={() => engine()?.cancelAdjustment()}>
              Cancel
            </button>
            <button
              className={`${ui.textButton} ${ui.primary}`}
              onClick={() => engine()?.applyAdjustment()}
            >
              Apply
            </button>
          </p>
        </>
      )}
    </Panel>
  );
}
