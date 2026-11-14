import { describe, expect, it } from 'vitest';
import { frameAtTick, frameTimes, gifDelays, resample, totalTicks } from './timing';

describe('animation timing', () => {
  it('finds the frame showing at a tick, wrapping around', () => {
    const holds = [1, 2, 3]; // ticks 0 | 1 2 | 3 4 5
    expect(totalTicks(holds)).toBe(6);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((t) => frameAtTick(holds, t))).toEqual([
      0, 1, 1, 2, 2, 2, 0, 1,
    ]);
    expect(frameAtTick(holds, 2.99)).toBe(1);
    expect(frameAtTick([], 3)).toBe(-1);
  });

  it('times frames from their holds and the frame rate', () => {
    expect(frameTimes([1, 2, 1], 4)).toEqual([
      { start: 0, duration: 0.25 },
      { start: 0.25, duration: 0.5 },
      { start: 0.75, duration: 0.25 },
    ]);
  });

  it('gives GIF delays in centiseconds that add up to the exact length', () => {
    expect(gifDelays([1, 1, 1], 30)).toEqual([3, 4, 3]);
    expect(gifDelays([1, 2], 12)).toEqual([8, 17]); // 8.33 + 16.67 = 25
    const delays = gifDelays(Array(24).fill(1), 24);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('never goes under the shortest delay browsers honour', () => {
    expect(gifDelays([1, 1], 60)).toEqual([2, 2]);
  });

  it('resamples to a constant video frame rate', () => {
    // 2 fps animation (frames of 0.5 s, 1 s) at 4 fps video: 6 video frames.
    expect(resample([1, 2], 2, 4)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(resample([1, 1, 1], 12, 12)).toEqual([0, 1, 2]);
  });
});
