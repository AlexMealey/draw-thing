import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import type { Curve } from '../../engine/brush/curves';
import styles from './Brushes.module.css';

interface Props {
  label: string;
  curve: Curve;
  onChange: (curve: Curve) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Two-handle cubic-bezier editor: pressure in (x) → response out (y). */
export function PressureCurveEditor({ label, curve, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const [x1, y1, x2, y2] = curve;

  const set = (handle: 0 | 1, x: number, y: number) =>
    onChange(handle === 0 ? [clamp01(x), clamp01(y), x2, y2] : [x1, y1, clamp01(x), clamp01(y)]);

  const move = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (dragging.current === null || !r) return;
    set(dragging.current, (e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  };

  const key = (handle: 0 | 1) => (e: KeyboardEvent) => {
    const [hx, hy] = handle === 0 ? [x1, y1] : [x2, y2];
    const d = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, d],
      ArrowDown: [0, -d],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    set(handle, hx + m[0], hy + m[1]);
  };

  const P = (x: number, y: number) => `${x * 100} ${(1 - y) * 100}`;
  const handle = (i: 0 | 1, x: number, y: number) => (
    <circle
      className={styles.handle}
      cx={x * 100}
      cy={(1 - y) * 100}
      r={5}
      tabIndex={0}
      role="slider"
      aria-label={`${label} handle ${i + 1}`}
      aria-valuenow={Math.round(y * 100)}
      aria-valuetext={`input ${Math.round(x * 100)}%, output ${Math.round(y * 100)}%`}
      onKeyDown={key(i)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = i;
      }}
    />
  );

  return (
    <svg
      ref={svg}
      className={styles.curve}
      viewBox="-6 -6 112 112"
      aria-label={label}
      onPointerMove={move}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      {[25, 50, 75].map((v) => (
        <g key={v} className={styles.grid}>
          <line x1={v} y1={0} x2={v} y2={100} />
          <line x1={0} y1={v} x2={100} y2={v} />
        </g>
      ))}
      <line className={styles.guide} x1={0} y1={100} x2={x1 * 100} y2={(1 - y1) * 100} />
      <line className={styles.guide} x1={100} y1={0} x2={x2 * 100} y2={(1 - y2) * 100} />
      <path className={styles.line} d={`M ${P(0, 0)} C ${P(x1, y1)} ${P(x2, y2)} ${P(1, 1)}`} />
      {handle(0, x1, y1)}
      {handle(1, x2, y2)}
    </svg>
  );
}
