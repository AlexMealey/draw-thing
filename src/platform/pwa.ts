import { registerSW } from 'virtual:pwa-register';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Chromium's deferred install prompt (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LaunchParams {
  files?: readonly FileSystemFileHandle[];
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

interface PwaState {
  /** A new version is installed and waiting; it takes over on the next reload. */
  updateReady: boolean;
  /** The app shell has just been cached for the first time. */
  offlineReady: boolean;
  /** Set while Chromium would let us show its install dialog. */
  installPrompt: BeforeInstallPromptEvent | null;
  /** Files the app was opened with ("Open with DrawThing"), until the app takes them. */
  launchFiles: File[] | null;
}

export const pwaStore = createStore<PwaState>()(() => ({
  updateReady: false,
  offlineReady: false,
  installPrompt: null,
  launchFiles: null,
}));

export function usePwa<T>(selector: (state: PwaState) => T): T {
  return useStore(pwaStore, selector);
}

/** Installed apps can stay open for days, so look for a new version now and then. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

/** Registers the service worker and listens for install and file-launch events. Call once. */
export function startPwa() {
  updateSW = registerSW({
    onNeedRefresh: () => pwaStore.setState({ updateReady: true }),
    onOfflineReady: () => pwaStore.setState({ offlineReady: true }),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => {}); // offline: try later
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // shown from our own Install button instead
    pwaStore.setState({ installPrompt: e });
  });
  window.addEventListener('appinstalled', () => {
    pwaStore.setState({ installPrompt: null });
    void navigator.storage?.persist?.().catch(() => {});
  });

  // File handlers (manifest `file_handlers`): with `launch_handler: focus-existing`, files
  // opened while the app is running arrive here too, without reloading it.
  window.launchQueue?.setConsumer((params) => {
    const handles = params.files ?? [];
    if (handles.length === 0) return;
    void Promise.all(handles.map((h) => h.getFile())).then(
      (files) => pwaStore.setState({ launchFiles: files }),
      (err: unknown) => console.error('Couldn’t read the opened files', err),
    );
  });
}

/** Saves first, then switches to the waiting version (reloads the page). */
export async function applyUpdate(save: () => Promise<void>) {
  await save();
  await updateSW?.(true);
}

/** Shows Chromium's install dialog; true if the user installed. */
export async function promptInstall(): Promise<boolean> {
  const prompt = pwaStore.getState().installPrompt;
  if (!prompt) return false;
  pwaStore.setState({ installPrompt: null }); // each event can prompt only once
  await prompt.prompt();
  return (await prompt.userChoice).outcome === 'accepted';
}
