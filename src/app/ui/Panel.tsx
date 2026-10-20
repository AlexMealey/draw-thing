import { type ReactNode, useRef, useState } from 'react';
import { CloseIcon } from './icons';
import styles from './Panel.module.css';
import ui from './ui.module.css';

interface Props {
  title: string;
  onClose: () => void;
  side?: 'left' | 'right';
  /** Extra header controls (left of the close button). */
  actions?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
}

const DISMISS_PX = 80;

/**
 * A floating popover under the top bar on wide screens, and a bottom sheet (drag the handle down
 * to dismiss) on narrow or portrait ones, so the canvas keeps as much room as possible.
 */
export function Panel({ title, onClose, side = 'right', actions, leading, children }: Props) {
  const [dragY, setDragY] = useState(0);
  const start = useRef<number | null>(null);

  return (
    <section
      className={styles.panel}
      data-side={side}
      role="dialog"
      aria-label={title}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
    >
      <button
        className={styles.grab}
        aria-label={`Close ${title}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = e.clientY;
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDragY(Math.max(0, e.clientY - start.current));
        }}
        onPointerUp={() => {
          const tapped = dragY < 4;
          if (tapped || dragY > DISMISS_PX) onClose();
          start.current = null;
          setDragY(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragY(0);
        }}
      />
      <header className={styles.header}>
        {leading}
        <h2>{title}</h2>
        {actions}
        <button className={`${ui.iconButton} ${styles.close}`} aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
