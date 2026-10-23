import { type PointerEvent, useRef, useState } from 'react';
import { toolStore, useTools } from '../../state/toolStore';
import {
  contrastColor,
  type Hsv,
  hexToHsv,
  hsToWheel,
  hsvToHex,
  normalizeHex,
  wheelToHs,
} from '../color';
import { percent } from '../ui/format';
import { Panel } from '../ui/Panel';
import ui from '../ui/ui.module.css';
import styles from './ColorPanel.module.css';

const PALETTE = [
  '#1c1c1e',
  '#48484a',
  '#8e8e93',
  '#d1d1d6',
  '#f2f2f7',
  '#ffffff',
  '#ac8e68',
  '#6b4f2e',
  '#ff375f',
  '#ff453a',
  '#ff9f0a',
  '#ffd60a',
  '#30d158',
  '#64d2ff',
  '#0a84ff',
  '#bf5af2',
];

/**
 * Procreate "Classic" picker (saturation/brightness square and hue strip) or "Disc" (hue and
 * saturation wheel and a brightness strip), optional H/S/B/contrast sliders, hex, recents, palette.
 */
export function ColorPanel({ onClose }: { onClose: () => void }) {
  const color = useTools((s) => s.color);
  const recent = useTools((s) => s.recentColors);
  const picker = useTools((s) => s.colorPicker);
  const sliders = useTools((s) => s.colorSliders);
  const { setColor } = toolStore.getState();
  // HSV is kept locally so hue survives at zero saturation/brightness; it follows outside changes.
  const [local, setLocal] = useState({ hex: color, hsv: hexToHsv(color) });
  if (local.hex !== color) setLocal({ hex: color, hsv: hexToHsv(color) });
  const { h, s, v } = local.hsv;
  const [draft, setDraft] = useState<string | null>(null);
  // Contrast is relative: it pushes the color the drag started from, then springs back to 0.
  const [contrast, setContrast] = useState(0);
  const contrastBase = useRef<string | null>(null);

  const apply = (hsv: Hsv, commit: boolean) => {
    const hex = hsvToHex(hsv);
    setLocal({ hex, hsv });
    setColor(hex, commit);
  };

  const drag = (read: (e: PointerEvent<HTMLDivElement>, r: DOMRect) => Hsv) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      apply(read(e, e.currentTarget.getBoundingClientRect()), false);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.buttons) apply(read(e, e.currentTarget.getBoundingClientRect()), false);
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) =>
      apply(read(e, e.currentTarget.getBoundingClientRect()), true),
  });
  const clamp = (x: number) => Math.min(1, Math.max(0, x));

  const commitDraft = () => {
    const hex = draft !== null ? normalizeHex(draft) : null;
    if (hex) setColor(hex, true);
    setDraft(null);
  };

  return (
    <Panel title="Color" onClose={onClose}>
      {picker === 'wheel' ? (
        <>
          <div
            className={styles.wheel}
            role="slider"
            aria-label="Hue and saturation"
            aria-valuetext={`hue ${Math.round(h)}°, saturation ${Math.round(s * 100)}%`}
            aria-valuenow={Math.round(h)}
            {...drag((e, r) => {
              const radius = r.width / 2;
              const hs = wheelToHs(e.clientX - r.left - radius, e.clientY - r.top - radius, radius);
              return { ...hs, v };
            })}
          >
            <span className={styles.shade} style={{ opacity: 1 - v }} />
            <span
              className={styles.knob}
              style={{
                left: `${50 + hsToWheel(h, s).x * 50}%`,
                top: `${50 + hsToWheel(h, s).y * 50}%`,
                background: color,
              }}
            />
          </div>
          <div
            className={styles.hue}
            style={{
              background: `linear-gradient(to right, #000, ${hsvToHex({ h, s, v: 1 })})`,
            }}
            role="slider"
            aria-label="Brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(v * 100)}
            {...drag((e, r) => ({ h, s, v: clamp((e.clientX - r.left) / r.width) }))}
          >
            <span className={styles.knob} style={{ left: `${v * 100}%`, background: color }} />
          </div>
        </>
      ) : (
        <>
          <div
            className={styles.sv}
            style={{ backgroundColor: hsvToHex({ h, s: 1, v: 1 }) }}
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
            aria-valuenow={Math.round(s * 100)}
            {...drag((e, r) => ({
              h,
              s: clamp((e.clientX - r.left) / r.width),
              v: clamp(1 - (e.clientY - r.top) / r.height),
            }))}
          >
            <span
              className={styles.knob}
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: color }}
            />
          </div>
          <div
            className={styles.hue}
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(h)}
            {...drag((e, r) => ({ h: clamp((e.clientX - r.left) / r.width) * 359.9, s, v }))}
          >
            <span
              className={styles.knob}
              style={{ left: `${(h / 360) * 100}%`, background: hsvToHex({ h, s: 1, v: 1 }) }}
            />
          </div>
        </>
      )}

      {sliders && (
        <div className={styles.sliders}>
          <ColorSlider
            label="Hue"
            value={h}
            min={0}
            max={359}
            step={1}
            format={(x) => `${Math.round(x)}°`}
            onChange={(x, commit) => apply({ h: x, s, v }, commit)}
          />
          <ColorSlider
            label="Saturation"
            value={s}
            min={0}
            max={1}
            format={percent}
            onChange={(x, commit) => apply({ h, s: x, v }, commit)}
          />
          <ColorSlider
            label="Brightness"
            value={v}
            min={0}
            max={1}
            format={percent}
            onChange={(x, commit) => apply({ h, s, v: x }, commit)}
          />
          <ColorSlider
            label="Contrast"
            value={contrast}
            min={-1}
            max={1}
            format={(x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`}
            onChange={(x, commit) => {
              contrastBase.current ??= color;
              const hex = contrastColor(contrastBase.current, x);
              setLocal({ hex, hsv: hexToHsv(hex) });
              setColor(hex, commit);
              if (commit) {
                contrastBase.current = null;
                setContrast(0);
              } else setContrast(x);
            }}
          />
        </div>
      )}

      <div className={styles.current}>
        <span style={{ background: color }} />
        <input
          aria-label="Hex color"
          value={draft ?? color}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => e.key === 'Enter' && commitDraft()}
        />
      </div>

      {recent.length > 0 && (
        <>
          <h3 className={ui.section}>Recent</h3>
          <div className={styles.swatches}>
            {recent.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                aria-label={`Recent ${c}`}
                onClick={() => setColor(c, true)}
              />
            ))}
          </div>
        </>
      )}

      <h3 className={ui.section}>Palette</h3>
      <div className={styles.swatches}>
        {PALETTE.map((c) => (
          <button
            key={c}
            style={{ background: c }}
            aria-label={`Color ${c}`}
            aria-pressed={c === color}
            onClick={() => setColor(c, true)}
          />
        ))}
      </div>
    </Panel>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  /** `commit` on release, which also records the color in the recents. */
  onChange: (value: number, commit: boolean) => void;
}

function ColorSlider({ label, value, min, max, step = 0.01, format, onChange }: SliderProps) {
  const commit = (e: { currentTarget: HTMLInputElement }) =>
    onChange(Number(e.currentTarget.value), true);
  return (
    <label className={ui.row}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <output>{format(value)}</output>
    </label>
  );
}
