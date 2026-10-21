import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { readDebugFlags } from './debug/flags';
import { installRemoteLog } from './debug/remoteLog';
import { startPwa } from './platform/pwa';
import './styles/global.css';

const flags = readDebugFlags(location.search);
if (flags.remoteLog) installRemoteLog();
startPwa();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App debug={flags.hud} />
  </StrictMode>,
);
