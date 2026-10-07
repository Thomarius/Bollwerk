import { describe, expect, it } from 'vitest';

import { across } from './chocolate.js';
import { hash } from './noise.js';

describe('the chocolate shine', () => {
  it('crosses a block corner to corner as the band passes over it', () => {
    // A 16 by 11 top: the band enters at the top-left corner and leaves at the bottom-right.
    expect(across(0, 16, 11)).toBeNull();
    expect(across(5, 16, 11)).toEqual([0, 5, 5, 0]);
    expect(across(13, 16, 11)).toEqual([2, 11, 13, 0]);
    expect(across(20, 16, 11)).toEqual([9, 11, 16, 4]);
    expect(across(27, 16, 11)).toBeNull();
  });

  it('keeps every crossing inside the block', () => {
    for (let c = 0; c <= 27; c += 0.5) {
      const seg = across(c, 16, 11);
      if (seg === null) continue;
      const [ua, va, ub, vb] = seg;
      for (const [u, v] of [
        [ua, va],
        [ub, vb],
      ] as const) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(16);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(11);
        expect(u + v).toBeCloseTo(c);
      }
    }
  });
});

describe('the chocolate decoration', () => {
  it('stays put from one redraw to the next, and varies from tile to tile', () => {
    expect(hash(3, 4, 1)).toBe(hash(3, 4, 1));
    const values = new Set<number>();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) values.add(hash(x, y, 1));
    expect(values.size).toBe(400);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // Spread over the range, not bunched: about a quarter below 0.25.
    const low = [...values].filter((v) => v < 0.25).length;
    expect(low).toBeGreaterThan(60);
    expect(low).toBeLessThan(140);
  });
});
