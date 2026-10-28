import { describe, expect, it } from 'vitest';

import { parseVolume } from './audio.js';
import { speakerToggle, volumePercent } from './volume.js';

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

describe('a slider’s speaker', () => {
  it('silences a slider, remembering its level, and brings that level back', () => {
    const silenced = speakerToggle(0.4, null);
    expect(silenced).toEqual({ value: 0, remembered: 0.4 });
    expect(speakerToggle(silenced.value, silenced.remembered)).toEqual({
      value: 0.4,
      remembered: null,
    });
  });

  it('brings a slider dragged to nothing back to full', () => {
    expect(speakerToggle(0, null)).toEqual({ value: 1, remembered: null });
    expect(speakerToggle(0, 0)).toEqual({ value: 1, remembered: null });
  });

  it('shows a volume as a whole percentage, kept between silent and full', () => {
    expect(volumePercent(0.35)).toBe('35%');
    expect(volumePercent(0)).toBe('0%');
    expect(volumePercent(1.2)).toBe('100%');
  });
});
