export type OS = 'ipados' | 'ios' | 'windows' | 'android' | 'macos' | 'other';

export interface PlatformInfo {
  os: OS;
  /** Launched as an installed app (home screen / Start menu) rather than a browser tab. */
  standalone: boolean;
  touch: boolean;
}

export const OS_LABEL: Record<OS, string> = {
  ipados: 'iPadOS',
  ios: 'iOS',
  windows: 'Windows',
  android: 'Android',
  macos: 'macOS',
  other: 'Other',
};

export function detectOS(userAgent: string, maxTouchPoints: number): OS {
  if (/iPad/.test(userAgent)) return 'ipados';
  if (/iPhone|iPod/.test(userAgent)) return 'ios';
  // iPadOS Safari requests desktop sites with a Mac UA; only touch support gives it away.
  if (/Macintosh/.test(userAgent)) return maxTouchPoints > 1 ? 'ipados' : 'macos';
  if (/Android/.test(userAgent)) return 'android';
  if (/Windows/.test(userAgent)) return 'windows';
  return 'other';
}

const STANDALONE_MODES = ['standalone', 'fullscreen', 'window-controls-overlay'];

export function currentPlatform(): PlatformInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    os: detectOS(nav.userAgent, nav.maxTouchPoints),
    standalone:
      nav.standalone === true || // iOS home-screen apps
      STANDALONE_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches),
    touch: nav.maxTouchPoints > 0,
  };
}
