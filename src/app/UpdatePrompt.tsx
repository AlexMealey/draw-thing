import { useEffect } from 'react';
import { pwaStore, usePwa } from '../platform/pwa';
import styles from './UpdatePrompt.module.css';

interface Props {
  /**
   * Whether the "update ready" toast may show now. The app only asks in the gallery or right
   * after a save (ROADMAP §1.3), so it never interrupts a drawing.
   */
  askUpdate: boolean;
  /** Saves, then reloads into the new version. */
  onRestart: () => void;
  onLater: () => void;
}

/** "Ready to work offline" and "update ready" toasts. */
export function UpdatePrompt({ askUpdate, onRestart, onLater }: Props) {
  const updateReady = usePwa((s) => s.updateReady);
  const offlineReady = usePwa((s) => s.offlineReady);

  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => pwaStore.setState({ offlineReady: false }), 4000);
    return () => clearTimeout(id);
  }, [offlineReady]);

  const update = updateReady && askUpdate;
  if (!update && !offlineReady) return null;

  return (
    <div role="status" className={styles.toast}>
      <span>{update ? 'A new version is ready.' : 'Ready to work offline.'}</span>
      {update && (
        <button className={styles.primary} onClick={onRestart}>
          Restart
        </button>
      )}
      <button onClick={update ? onLater : () => pwaStore.setState({ offlineReady: false })}>
        {update ? 'Later' : 'OK'}
      </button>
    </div>
  );
}
