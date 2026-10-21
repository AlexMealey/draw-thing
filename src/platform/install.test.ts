import { describe, expect, it } from 'vitest';
import type { PlatformInfo } from './env';
import { coachAtLaunch, installRoute } from './install';

const platform = (os: PlatformInfo['os'], standalone = false): PlatformInfo => ({
  os,
  standalone,
  touch: true,
});

describe('installRoute', () => {
  it('knows an installed app', () => {
    expect(installRoute(platform('ipados', true), false)).toBe('installed');
    expect(installRoute(platform('windows', true), true)).toBe('installed');
  });

  it('prefers the browser install dialog, then the iOS Share menu', () => {
    expect(installRoute(platform('windows'), true)).toBe('prompt');
    expect(installRoute(platform('ipados'), false)).toBe('ios');
    expect(installRoute(platform('ios'), false)).toBe('ios');
    expect(installRoute(platform('macos'), false)).toBe('browser');
  });
});

describe('coachAtLaunch', () => {
  it('opens once, on iOS only', () => {
    expect(coachAtLaunch('ios', false)).toBe(true);
    expect(coachAtLaunch('ios', true)).toBe(false);
    expect(coachAtLaunch('prompt', false)).toBe(false);
    expect(coachAtLaunch('installed', false)).toBe(false);
  });
});
