import { describe, expect, it } from 'vitest';

import { bloomWanted, carriedGraphics, parseGraphics, renderResolution } from './graphics.js';

describe('the graphics level', () => {
  it('reads only its own three values', () => {
    expect(parseGraphics('high')).toBe('high');
    expect(parseGraphics('low')).toBe('low');
    expect(parseGraphics('fast')).toBeNull();
    expect(parseGraphics(null)).toBeNull();
  });

  it('is carried over from the old Effects and Sharpness, Fast winning', () => {
    expect(carriedGraphics(null, null)).toBe('medium');
    expect(carriedGraphics('full', 'sharp')).toBe('medium');
    expect(carriedGraphics('reduced', null)).toBe('medium');
    expect(carriedGraphics('high', 'sharp')).toBe('high');
    expect(carriedGraphics('high', 'fast')).toBe('low');
    expect(carriedGraphics('reduced', 'fast')).toBe('low');
  });

  it('blooms only at High', () => {
    expect(bloomWanted('high')).toBe(true);
    expect(bloomWanted('medium')).toBe(false);
    expect(bloomWanted('low')).toBe(false);
  });

  it("draws at the screen's density up to 2, or at 1 at Low", () => {
    expect(renderResolution('high', 1)).toBe(1);
    expect(renderResolution('medium', 1.5)).toBe(1.5);
    expect(renderResolution('high', 3)).toBe(2);
    expect(renderResolution('low', 2)).toBe(1);
  });
});
