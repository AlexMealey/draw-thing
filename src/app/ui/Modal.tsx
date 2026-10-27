import type { ReactNode } from 'react';
import { CloseIcon } from './icons';
import styles from './Modal.module.css';
import ui from './ui.module.css';

interface Props {
  title: string;
  onClose: () => void;
  /** Extra header controls (left of the close button). */
  actions?: ReactNode;
  /** Sheet width, CSS px. */
  width?: number;
  children: ReactNode;
}

/** A centered window over a dimmed screen; tapping outside it closes it. */
export function Modal({ title, onClose, actions, width = 440, children }: Props) {
  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ ['--modal-w' as string]: `${width}px` }}
      >
        <header className={styles.header}>
          <h2>{title}</h2>
          {actions}
          <button className={ui.iconButton} aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  );
}
