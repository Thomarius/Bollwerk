import { describe, expect, it } from 'vitest';

import { BALANCED, botProfile, skillAt, tierSetup } from './ai.js';
import { defaultAiConfig } from './defaults.js';

describe('skill levels', () => {
  it('takes an anchored level as it stands', () => {
    // Level 5 is the old gunner and Level 8 the old marshal, so measurements still map.
    expect(skillAt(defaultAiConfig, 5)).toMatchObject({ fireIntervalMs: 210, aimJitter: 0.25 });
    expect(skillAt(defaultAiConfig, 8)).toMatchObject({ fireIntervalMs: 150, aimJitter: 0.05 });
  });

  it('interpolates between anchors, rounding whole-number fields', () => {
    // Level 6 is a third of the way from Level 5 (210 ms) to Level 8 (150 ms).
    const six = skillAt(defaultAiConfig, 6);
    expect(six.fireIntervalMs).toBe(190);
    expect(six.aimJitter).toBeCloseTo(0.25 - 0.2 / 3);
    expect(Number.isInteger(six.replanTicks)).toBe(true);
  });

  it('gets steadily better from Level 1 to Level 10', () => {
    for (let level = 1; level < 10; level++) {
      const here = skillAt(defaultAiConfig, level);
      const next = skillAt(defaultAiConfig, level + 1);
      expect(next.fireIntervalMs).toBeLessThanOrEqual(here.fireIntervalMs);
      expect(next.placementBaseMs).toBeLessThanOrEqual(here.placementBaseMs);
      expect(next.aimJitter).toBeLessThanOrEqual(here.aimJitter);
      expect(next.sloppiness).toBeLessThanOrEqual(here.sloppiness);
    }
  });

  it('makes mistakes only below the old gunner, and clamps levels out of range', () => {
    expect(skillAt(defaultAiConfig, 2).sloppiness).toBeGreaterThan(0);
    expect(skillAt(defaultAiConfig, 5).sloppiness).toBe(0);
    expect(skillAt(defaultAiConfig, 0)).toEqual(skillAt(defaultAiConfig, 1));
    expect(skillAt(defaultAiConfig, 99)).toEqual(skillAt(defaultAiConfig, 10));
  });
});

describe('a bot built from a level and a personality', () => {
  it('scales the level’s judgement by the risk trait', () => {
    const balanced = botProfile(defaultAiConfig, { level: 5, personality: BALANCED });
    const defensive = botProfile(defaultAiConfig, {
      level: 5,
      personality: { ...BALANCED, risk: 'defensive' },
    });
    expect(defensive.riskMargin).toBeLessThan(balanced.riskMargin);
    expect(defensive.fireIntervalMs).toBe(balanced.fireIntervalMs);
  });

  it('keeps each old tier’s play: baron is the marshal’s skill reaching for more', () => {
    const marshal = botProfile(defaultAiConfig, tierSetup('marshal'));
    const baron = botProfile(defaultAiConfig, tierSetup('baron'));
    expect(baron.fireIntervalMs).toBe(marshal.fireIntervalMs);
    expect(baron).toMatchObject({ maxCastles: 4, expandsWhenSealed: true });
    expect(marshal).toMatchObject({ maxCastles: 2, expandsWhenSealed: false, riskMargin: 1 });
  });
});
