import { useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { currentPlatform, OS_LABEL } from '../platform/env';
import styles from './App.module.css';
import { UpdatePrompt } from './UpdatePrompt';

export function App({ debug }: { debug: boolean }) {
  const [platform] = useState(currentPlatform);

  return (
    <div className={styles.app}>
      <main className={styles.canvasHost} aria-label="Canvas">
        <div className={styles.placeholder}>
          <h1>DrawThing</h1>
          <p>Phase 0 shell. The drawing engine lands in Phase 1.</p>
          <p className={styles.meta}>
            {OS_LABEL[platform.os]} · {platform.standalone ? 'installed app' : 'browser tab'}
          </p>
        </div>
      </main>
      <UpdatePrompt />
      {debug && <DebugHud />}
    </div>
  );
}
