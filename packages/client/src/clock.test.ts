import { describe, expect, it } from 'vitest';

import { COUNTDOWN_FROM, countdownGain, showsClock } from './clock.js';

describe('the clock', () => {
  it('is shown in every timed phase but hidden in overtime', () => {
    expect(showsClock({ phase: 'build', overtime: false })).toBe(true);
    expect(showsClock({ phase: 'combat', overtime: false })).toBe(true);
    expect(showsClock({ phase: 'build', overtime: true })).toBe(false);
  });
});

describe('the countdown', () => {
  it('ticks over the last five seconds', () => {
    expect(COUNTDOWN_FROM).toBe(5);
  });

  it('grows louder with every tick, reaching full volume on the last', () => {
    const gains = [5, 4, 3, 2, 1].map(countdownGain);
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1]!);
    expect(gains[0]).toBeCloseTo(0.35);
    expect(gains[4]).toBe(1);
  });
});
