import { useState } from 'react';
import type { InstallRoute } from '../platform/install';
import { promptInstall } from '../platform/pwa';
import styles from './InstallCoach.module.css';
import { AddSquareIcon, ShareIcon } from './ui/icons';
import ui from './ui/ui.module.css';

interface Props {
  route: InstallRoute;
  onClose: () => void;
}

/**
 * Explains how to install DrawThing (ROADMAP §1.3). On iOS that's by hand, from Safari's Share
 * menu, and it matters: the Home Screen app keeps its own storage, and Safari may clear a site's
 * data after 7 days without a visit.
 */
export function InstallCoach({ route, onClose }: Props) {
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Install DrawThing"
      >
        <h2>Install DrawThing</h2>
        {route === 'ios' && (
          <>
            <p>Add it to your Home Screen to draw full screen, offline, with artwork kept safe.</p>
            <ol className={styles.steps}>
              <li>
                <ShareIcon className={styles.icon} />
                <span>
                  Tap <strong>Share</strong> in Safari’s toolbar.
                </span>
              </li>
              <li>
                <AddSquareIcon className={styles.icon} />
                <span>
                  Choose <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li>
                <img className={styles.icon} src="/pwa-64x64.png" alt="" />
                <span>Open DrawThing from your Home Screen.</span>
              </li>
            </ol>
            <p className={styles.note}>
              The Home Screen app has its own storage: artwork made here in Safari stays in Safari,
              so install before you start. To move artwork, share it as .drawthing from the gallery
              and import it in the app.
            </p>
          </>
        )}
        {route === 'prompt' && (
          <p>
            Get DrawThing in its own window: it works offline, keeps your artwork safe, and opens
            .drawthing, PSD and image files from your file manager.
          </p>
        )}
        {route === 'browser' && (
          <p>
            Look for <strong>Install</strong> or <strong>Add to Home Screen</strong> in your
            browser’s menu or address bar.
          </p>
        )}
        {route === 'installed' && <p>DrawThing is installed. You’re all set.</p>}
        <div className={styles.buttons}>
          {route === 'prompt' ? (
            <>
              <button className={ui.textButton} onClick={onClose}>
                Not now
              </button>
              <button
                className={`${ui.textButton} ${ui.primary}`}
                onClick={() => void install()}
                disabled={busy}
              >
                Install
              </button>
            </>
          ) : (
            <button className={`${ui.textButton} ${ui.primary}`} onClick={onClose}>
              Got it
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
