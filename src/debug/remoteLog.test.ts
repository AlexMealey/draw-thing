import { describe, expect, it } from 'vitest';
import { serializeArg } from './remoteLog';

describe('serializeArg', () => {
  it('passes primitives through', () => {
    expect(serializeArg('hi')).toBe('hi');
    expect(serializeArg(42)).toBe('42');
    expect(serializeArg(undefined)).toBe('undefined');
    expect(serializeArg(null)).toBe('null');
    expect(serializeArg(10n)).toBe('10');
  });

  it('uses the stack for errors', () => {
    const err = new Error('boom');
    expect(serializeArg(err)).toContain('Error: boom');
  });

  it('serializes objects, marking cycles instead of throwing', () => {
    const a: Record<string, unknown> = { n: 1, big: 2n };
    a.self = a;
    expect(serializeArg(a)).toBe('{"n":1,"big":"2n","self":"[Seen]"}');
  });

  it('names functions', () => {
    expect(serializeArg(function draw() {})).toBe('[Function draw]');
  });

  it('truncates long values', () => {
    const out = serializeArg('x'.repeat(5000));
    expect(out.length).toBeLessThan(2100);
    expect(out).toMatch(/\(\+3000\)$/);
  });
});
