import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import styles from './VerticalSlider.module.css';

interface Props {
  label: string;
  /** 0..1 position along the track (callers map their own scale). */
  position: number;
  display: string;
  onChange: (position: number) => void;
  /** Which side the value bubble opens to. */
  bubbleSide?: 'left' | 'right';
}

/** Procreate-style sidebar slider: drag anywhere on the track, value bubble while dragging. */
export function VerticalSlider({
  label,
  position,
  display,
  onChange,
  bubbleSide = 'right',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const p = Math.min(1, Math.max(0, position));

  const fromPointer = (e: PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onChange(Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)));
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(1, p + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(0, p - step));
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`${styles.slider} ${bubbleSide === 'left' ? styles.right : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-valuetext={display}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        fromPointer(e);
      }}
      onPointerMove={(e) => dragging && fromPointer(e)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <div className={styles.fill} style={{ height: `${p * 100}%` }} />
      <div className={styles.thumb} style={{ bottom: `${p * 100}%` }} />
      {dragging && (
        <div className={styles.bubble} style={{ bottom: `${p * 100}%` }}>
          {display}
        </div>
      )}
    </div>
  );
}
