import { TRAIT_VALUES, type Personality } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { dealPersonalities } from './personality.js';

const traits = Object.keys(TRAIT_VALUES) as (keyof Personality)[];

describe('dealing personalities', () => {
  it('deals the same to the same seed and table, as a server and a local match must', () => {
    const table = [true, false, true, true];
    expect(dealPersonalities(42, table)).toEqual(dealPersonalities(42, table));
  });

  it('mixes a table: no two bots share a value until its bag is spent', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dealt = dealPersonalities(seed, new Array<boolean>(8).fill(true));
      for (const trait of traits) {
        const size = TRAIT_VALUES[trait].length;
        // Each bag's worth in player order is every value once.
        for (let start = 0; start + size <= dealt.length; start += size) {
          const values = dealt.slice(start, start + size).map((p) => p[trait]);
          expect(new Set(values).size).toBe(size);
        }
      }
    }
  });

  it('deals the bots first, so a person between them cannot make two repeat', () => {
    for (let seed = 0; seed < 200; seed++) {
      // A person in player 1, bots either side: three bots, three risks.
      const dealt = dealPersonalities(seed, [true, false, true, true]);
      const bots = [0, 2, 3].map((p) => dealt[p] as Personality);
      for (const trait of ['risk', 'cannons'] as const) {
        expect(new Set(bots.map((p) => p[trait])).size).toBe(3);
      }
      expect(dealt[1]).toBeDefined();
    }
  });

  it('deals every value, and differently between matches', () => {
    const seen = new Map<keyof Personality, Set<string>>(traits.map((t) => [t, new Set()]));
    for (let seed = 0; seed < 40; seed++) {
      for (const p of dealPersonalities(seed, [true, true])) {
        for (const trait of traits) seen.get(trait)?.add(p[trait]);
      }
    }
    for (const trait of traits) {
      expect([...(seen.get(trait) ?? [])].sort()).toEqual([...TRAIT_VALUES[trait]].sort());
    }
    const one = JSON.stringify(dealPersonalities(7, [true, true, true]));
    expect(JSON.stringify(dealPersonalities(8, [true, true, true]))).not.toBe(one);
  });
});
