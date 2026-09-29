import { TRAIT_VALUES } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { dealPersonality } from './personality.js';

describe('dealing a personality', () => {
  it('deals the same to the same seed and player, as a server and a local match must', () => {
    expect(dealPersonality(42, 1)).toEqual(dealPersonality(42, 1));
  });

  it('deals from every value, and differently between players and matches', () => {
    const risks = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (let player = 0; player < 4; player++) risks.add(dealPersonality(seed, player).risk);
    }
    expect([...risks].sort()).toEqual([...TRAIT_VALUES.risk].sort());
    const table = [0, 1, 2, 3].map((p) => dealPersonality(7, p).risk);
    const another = [0, 1, 2, 3].map((p) => dealPersonality(8, p).risk);
    expect(table.join() === another.join() && new Set(table).size === 1).toBe(false);
  });
});
