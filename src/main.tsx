import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { DebugHud } from './debug/DebugHud';
import { readDebugFlags } from './debug/flags';
import { installRemoteLog } from './debug/remoteLog';
import { observeLongTasks } from './engine/perf';
import { LazyLab } from './lab/lazy';
import { startPwa } from './platform/pwa';
import './styles/global.css';

const flags = readDebugFlags(location.search);
if (flags.remoteLog) installRemoteLog();
observeLongTasks();
startPwa();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

// Benchmarks, soak test and regression scenes.
const lab = new URLSearchParams(location.search).has('lab');

createRoot(root).render(
  <StrictMode>
    {lab ? (
      <Suspense>
        <LazyLab />
        {flags.hud && <DebugHud />}
      </Suspense>
    ) : (
      <App debug={flags.hud} />
    )}
  </StrictMode>,
);
