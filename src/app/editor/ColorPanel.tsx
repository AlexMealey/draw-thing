import { type PointerEvent, useState } from 'react';
import { toolStore, useTools } from '../../state/toolStore';
import { type Hsv, hexToHsv, hsvToHex, normalizeHex } from '../color';
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

/** Procreate "Classic" picker: saturation/brightness square, hue strip, hex, recents, palette. */
export function ColorPanel({ onClose }: { onClose: () => void }) {
  const color = useTools((s) => s.color);
  const recent = useTools((s) => s.recentColors);
  const { setColor } = toolStore.getState();
  // HSV is kept locally so hue survives at zero saturation/brightness; it follows outside changes.
  const [local, setLocal] = useState({ hex: color, hsv: hexToHsv(color) });
  if (local.hex !== color) setLocal({ hex: color, hsv: hexToHsv(color) });
  const { h, s, v } = local.hsv;
  const [draft, setDraft] = useState<string | null>(null);

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
