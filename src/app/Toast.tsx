import { useEffect } from 'react';
import styles from './Toast.module.css';

/** Brief, non-interactive message (e.g. "Layer 2 is locked"). */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 1800);
    return () => clearTimeout(id);
  }, [message, onDone]);
  return (
    <div className={styles.toast} role="status">
      {message}
    </div>
  );
}
