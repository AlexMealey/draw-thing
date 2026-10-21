import type { PlatformInfo } from './env';

/**
 * How this browser installs the app: already installed, through Chromium's install dialog
 * (`beforeinstallprompt`), by hand from Safari's Share menu (iOS never offers a prompt), or
 * from the browser's own menu, if it can at all.
 */
export type InstallRoute = 'installed' | 'prompt' | 'ios' | 'browser';

export function installRoute(platform: PlatformInfo, canPrompt: boolean): InstallRoute {
  if (platform.standalone) return 'installed';
  if (canPrompt) return 'prompt';
  if (platform.os === 'ipados' || platform.os === 'ios') return 'ios';
  return 'browser';
}

/**
 * Whether the coach opens by itself at launch. Only on iOS: its Safari tab and Home Screen app
 * keep separate storage, so installing has to come before the artwork does.
 */
export function coachAtLaunch(route: InstallRoute, seen: boolean): boolean {
  return route === 'ios' && !seen;
}
