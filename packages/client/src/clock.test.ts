import { describe, expect, it } from 'vitest';

import { COUNTDOWN_FROM, countdownBeat, countdownGain, showsClock } from './clock.js';

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

describe('the countdown beat', () => {
  const at = (tick: number, phase = 'build', overtime = false) =>
    ({ phase, overtime, tick, phaseEndTick: 300, ruleset: { tickRateHz: 30 } }) as never;

  it('is silent before the last five seconds, in overtime and outside building', () => {
    expect(countdownBeat(at(149))).toBeNull();
    expect(countdownBeat(at(280, 'build', true))).toBeNull();
    expect(countdownBeat(at(280, 'combat'))).toBeNull();
  });

  it('starts at each tick and rises through the second', () => {
    // Five seconds left exactly is the first tick's own instant.
    expect(countdownBeat(at(150))).toBe(0);
    expect(countdownBeat(at(151))).toBeCloseTo(1 / 30 + 0.0, 5);
    expect(countdownBeat(at(165))).toBeCloseTo(0.5, 5);
  });
});
