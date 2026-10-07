import { describe, expect, it } from 'vitest';

import { play } from './testing.js';

describe('bot competence', () => {
  it('seals a castle in the first build phase', () => {
    // Asked at the resolution, not at a tick chosen to fall inside the phase.
    // `enclosedCastles` is live while building, so a bot part-way through widening its
    // wall reads as zero — which is correct, and says nothing about whether it will
    // close in time. The resolution is where the rules themselves ask the question.
    const { resolutions } = play(3, ['gunner', 'gunner'], 3000);
    const first = resolutions.filter((r) => r.round === 1);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some((r) => r.enclosedCastles >= 1)).toBe(true);
  });

  it('expands beyond the castle it started with', () => {
    // A bot that only ever holds one castle earns two cannons a round forever, has
    // nowhere to put them, and is always one breach from elimination.
    const { resolutions } = play(5, ['marshal', 'marshal'], 30_000);
    expect(resolutions.length).toBeGreaterThan(2);
    // Over the match, not at the end of it: a match that ends in a simultaneous
    // elimination leaves every player holding nothing, which is a fact about how it
    // finished rather than about whether anyone ever expanded.
    expect(Math.max(...resolutions.map((r) => r.enclosedCastles))).toBeGreaterThan(1);
  }, 60_000);

  it('leaves room inside the wall for the cannons it earns', () => {
    // The regression this exists for, and the reason bot matches used to run forever.
    // A minimum cut is the *tightest* wall that works, so a planner handed the cut and
    // told to build it walls itself in against the castle with nowhere to stand a gun.
    // Measured before the fix: gunner and marshal held room for 0.3 cannons, averaged
    // over every surviving player-round, behind a 37-tile ring — and half the guns they
    // owned were outside it and silent. Two of those cannot hurt each other, so nobody
    // ever wins.
    //
    // The wall only has to be roomy enough to spend the reward it is about to earn,
    // which is two cannons for the first castle and one for each after.
    //
    // Over three seeds, against 0.6. The share of cramped player-rounds sits near half
    // in soaks — 50% before bots closed breaches tight-first, 56% after, 52% once they
    // stopped idling (2026-09-25, 240 player-rounds each) — so a single seed held to
    // 0.5 was a coin flip, not a test. What this guards against is 0.3 cannons of room.
    let cramped = 0;
    let total = 0;
    for (const seed of [1, 2, 3]) {
      const { resolutions } = play(seed, ['marshal', 'gunner', 'gunner'], 20_000);
      expect(resolutions.length).toBeGreaterThan(4);
      cramped += resolutions.filter((r) => r.cannonRoom < 2).length;
      total += resolutions.length;
    }
    expect(cramped / total).toBeLessThan(0.6);
  }, 180_000);
});
