import { defaultArtConfig } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { daylight, weatherFor } from './atmosphere.js';

describe('the light of the day', () => {
  it('opens in morning gold, is plain at noon, and sets at the last round', () => {
    const morning = daylight(1, 10, 0.2);
    const noon = daylight(4, 10, 0.2);
    const sunset = daylight(10, 10, 0.2);
    expect(morning.alpha).toBeGreaterThan(0);
    expect(noon.alpha).toBeLessThan(morning.alpha);
    expect(sunset.alpha).toBeCloseTo(0.2);
    // Redder as the sun goes down: less green in it than the morning's gold.
    expect((sunset.colour >> 8) & 0xff).toBeLessThan((morning.colour >> 8) & 0xff);
  });

  it('keeps to the round cap whatever it is, and comes round again without one', () => {
    expect(daylight(5, 5, 0.2).alpha).toBeCloseTo(0.2);
    expect(daylight(11, null, 0.2)).toEqual(daylight(1, null, 0.2));
  });
});

describe('the weather', () => {
  const odds = defaultArtConfig.pixel.weatherOdds;
  it('is the same for a seed every time, and every kind comes up across seeds', () => {
    expect(weatherFor(7, odds)).toBe(weatherFor(7, odds));
    const seen = new Set(Array.from({ length: 200 }, (_, seed) => weatherFor(seed, odds)));
    expect(seen).toEqual(new Set(['clear', 'overcast', 'rain', 'fog']));
  });

  it('is only what has odds', () => {
    const clearOnly = { clear: 1, overcast: 0, rain: 0, fog: 0 };
    for (let seed = 0; seed < 50; seed++) expect(weatherFor(seed, clearOnly)).toBe('clear');
  });
});
