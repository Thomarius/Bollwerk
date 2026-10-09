import { describe, expect, it } from 'vitest';

import { parseSharpness, renderResolution } from './sharpness.js';

describe('the sharpness', () => {
  it('is sharp unless fast was chosen', () => {
    expect(parseSharpness(null)).toBe('sharp');
    expect(parseSharpness('blurry')).toBe('sharp');
    expect(parseSharpness('fast')).toBe('fast');
  });

  it("draws at the screen's density up to 2, or at 1 when fast", () => {
    expect(renderResolution('sharp', 1)).toBe(1);
    expect(renderResolution('sharp', 1.5)).toBe(1.5);
    expect(renderResolution('sharp', 3)).toBe(2);
    expect(renderResolution('fast', 2)).toBe(1);
  });
});
