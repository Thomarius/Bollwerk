import { describe, expect, it } from 'vitest';

import { hueNearness, hueOf } from './hue.js';

describe('hues', () => {
  it('reads a colour as its hue and chroma', () => {
    expect(hueOf(0xff0000)).toEqual({ hue: 0, chroma: 1 });
    expect(hueOf(0x0000ff).hue).toBe(240);
    expect(hueOf(0x808080).chroma).toBe(0);
  });

  it('is near the ground only within its span, across the wrap at red', () => {
    expect(hueNearness(0x2040c0, 0x2040c0, 45)).toBe(1);
    expect(hueNearness(0xff0010, 0xff1000, 40)).toBeGreaterThan(0.8);
    expect(hueNearness(0x00ff00, 0x0000ff, 45)).toBe(0);
    // A grey has no hue to sink into the ground with.
    expect(hueNearness(0x7a7a80, 0x6060a0, 45)).toBe(0);
  });
});
