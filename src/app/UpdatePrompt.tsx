import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import styles from './UpdatePrompt.module.css';

/**
 * Service worker registration plus "offline ready" / "update ready" toasts.
 * From Phase 5 on, the update toast should only appear in the gallery or right after a save
 * (ROADMAP §1.3), so an update never interrupts a drawing.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(id);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;

  const dismiss = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div role="status" className={styles.toast}>
      <span>{needRefresh ? 'A new version is ready.' : 'Ready to work offline.'}</span>
      {needRefresh && (
        <button className={styles.primary} onClick={() => void updateServiceWorker()}>
          Reload
        </button>
      )}
      <button onClick={dismiss}>{needRefresh ? 'Later' : 'OK'}</button>
    </div>
  );
}
