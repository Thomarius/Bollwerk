import { describe, expect, it } from 'vitest';

import { parseStyleMusic, styleTrackChance } from './styleMusicSetting.js';

describe('the style music setting', () => {
  it('gives the chances the user chose: always, half the time, never', () => {
    expect(styleTrackChance('always')).toBe(1);
    expect(styleTrackChance('half')).toBe(0.5);
    expect(styleTrackChance('never')).toBe(0);
  });

  it('reads only its own three values back', () => {
    expect(parseStyleMusic('half')).toBe('half');
    expect(parseStyleMusic('sometimes')).toBeNull();
    expect(parseStyleMusic(null)).toBeNull();
  });
});
