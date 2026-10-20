import { describe, expect, it } from 'vitest';
import { detectOS } from './env';

const UA = {
  iPadSafariDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iPadChrome:
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  surfaceEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('detectOS', () => {
  it('sees through the iPadOS desktop-class Mac user agent via touch points', () => {
    expect(detectOS(UA.iPadSafariDesktopMode, 5)).toBe('ipados');
    expect(detectOS(UA.iPadSafariDesktopMode, 0)).toBe('macos');
  });

  it('recognises explicit iPad, iPhone, Windows and Android agents', () => {
    expect(detectOS(UA.iPadChrome, 5)).toBe('ipados');
    expect(detectOS(UA.iPhone, 5)).toBe('ios');
    expect(detectOS(UA.surfaceEdge, 10)).toBe('windows');
    expect(detectOS(UA.android, 10)).toBe('android');
  });

  it('falls back to other', () => {
    expect(detectOS('curl/8.0', 0)).toBe('other');
  });
});
