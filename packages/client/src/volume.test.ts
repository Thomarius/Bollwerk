import { describe, expect, it } from 'vitest';

import { parseVolume } from './audio.js';

describe('a volume read back from storage', () => {
  it('is full when nothing is stored, or what is stored is not a volume', () => {
    expect(parseVolume(null)).toBe(1);
    expect(parseVolume(undefined)).toBe(1);
    expect(parseVolume('')).toBe(1);
    expect(parseVolume('loud')).toBe(1);
  });

  it('is what was stored, kept between silent and full', () => {
    expect(parseVolume('0.35')).toBe(0.35);
    expect(parseVolume('0')).toBe(0);
    expect(parseVolume('7')).toBe(1);
    expect(parseVolume('-1')).toBe(0);
  });
});
