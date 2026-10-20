import { describe, expect, it } from 'vitest';
import { readDebugFlags } from './flags';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('readDebugFlags', () => {
  it('defaults to everything off', () => {
    expect(readDebugFlags('', memoryStorage())).toEqual({ hud: false, remoteLog: false });
  });

  it('turns flags on from the query string and remembers them', () => {
    const storage = memoryStorage();
    expect(readDebugFlags('?debug&log=1', storage)).toEqual({ hud: true, remoteLog: true });
    expect(readDebugFlags('?source=pwa', storage)).toEqual({ hud: true, remoteLog: true });
  });

  it('turns a remembered flag off with =0', () => {
    const storage = memoryStorage();
    readDebugFlags('?debug&log', storage);
    expect(readDebugFlags('?log=0', storage)).toEqual({ hud: true, remoteLog: false });
  });

  it('survives corrupt or missing storage', () => {
    expect(readDebugFlags('?debug', memoryStorage({ 'drawthing:debug': '{nope' }))).toEqual({
      hud: true,
      remoteLog: false,
    });
    expect(readDebugFlags('?log', null)).toEqual({ hud: false, remoteLog: true });
  });
});
