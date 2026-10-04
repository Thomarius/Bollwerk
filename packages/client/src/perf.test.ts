import { describe, expect, it } from 'vitest';

import { spread, stutters } from './perf.js';

describe('perf readout', () => {
  it('spreads samples into mean, percentiles and worst', () => {
    const s = spread([4, 1, 3, 2, 10]);
    expect(s.mean).toBe(4);
    expect(s.p50).toBe(3);
    expect(s.max).toBe(10);
    expect(spread([])).toEqual({ mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it('counts a frame shown twice as a stutter at any refresh rate', () => {
    // 144 Hz: 7 ms typical, so a 15 ms frame doubled though far under 33 ms.
    expect(stutters([7, 7, 7, 15, 7, 40, 60])).toEqual({ doubled: 3, over33: 2, over50: 1 });
  });
});
