import { describe, expect, it } from 'vitest';
import { fileSize } from './format';

describe('fileSize', () => {
  it('picks a unit and keeps one decimal below 10', () => {
    expect(fileSize(512)).toBe('512 bytes');
    expect(fileSize(1536)).toBe('1.5 KB');
    expect(fileSize(42 * 1024 * 1024)).toBe('42 MB');
    expect(fileSize(2.4 * 1024 ** 3)).toBe('2.4 GB');
  });
});
