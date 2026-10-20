export interface DebugFlags {
  /** On-screen HUD: FPS, pointer sample rate, pressure/tilt, PWA state. */
  hud: boolean;
  /** Stream console output to the dev/preview server terminal. */
  remoteLog: boolean;
}

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'drawthing:debug';
const PARAMS: Record<keyof DebugFlags, string> = { hud: 'debug', remoteLog: 'log' };

/**
 * `?debug` and `?log` switch the flags on, `?debug=0` / `?log=0` switch them off. The result is
 * remembered per device, so an installed PWA (which always launches at start_url) keeps them.
 */
export function readDebugFlags(
  search: string,
  storage: FlagStorage | null = browserStorage(),
): DebugFlags {
  const params = new URLSearchParams(search);
  let saved: Partial<DebugFlags> = {};
  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as Partial<DebugFlags>;
  } catch {
    // Corrupt or blocked storage: fall back to defaults.
  }
  const resolve = (key: keyof DebugFlags) => {
    const param = params.get(PARAMS[key]);
    return param === null ? saved[key] === true : param !== '0';
  };
  const flags: DebugFlags = { hud: resolve('hud'), remoteLog: resolve('remoteLog') };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Private mode / quota: flags just won't persist.
  }
  return flags;
}

function browserStorage(): FlagStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
