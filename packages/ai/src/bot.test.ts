import { defaultRuleset } from '@bollwerk/config';
import { Rng, applyEnclosure, stateFromAscii, withoutContinues } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { bot, play } from './testing.js';

describe('cannon siting', () => {
  it('keeps a gun off a wall with the sea behind it, while any other spot exists', () => {
    // Every spot in this ring touches a wall, so clearance ties everywhere and range
    // used to decide: the east end, nearest the enemy. But the east wall is the coast.
    // Shot out beside a cannon, that block leaves a hole only a one-cell piece fits.
    const state = stateFromAscii(
      `
      ..............................
      .,,,,,,,,,,,,.................
      .,,##########.................
      .,,#@@,,,,,,#............@@...
      .,,#@@,,,,,,#............@@...
      .,,#,,,,,,,,#.................
      .,,##########.................
      .,,,,,,,,,,,,.................
      ..............................
    `,
      defaultRuleset,
      `
      ..............................
      ..............................
      ..............................
      .........................22...
      .........................22...
      ..............................
      ..............................
      ..............................
      ..............................
    `,
    );
    applyEnclosure(state);
    state.phase = 'cannon_place';
    state.players[0]!.startingCastleId = 0;
    state.players[0]!.cannonsToPlace = 1;

    const action = bot(0, 'marshal').think(state, new Rng(1));
    expect(action?.kind).toBe('place_cannon');
    // Columns 10-11 would put the gun against the coastal east wall.
    expect((action as { x: number }).x).toBeLessThan(10);
    // Still as far forward as that allows: range decides among the spots that are safe.
    expect((action as { x: number }).x).toBe(9);
  });
});

describe('bot conduct', () => {
  it('never asks for a move the rules refuse', () => {
    // A bot goes through the same validated action API as a person, so it cannot
    // cheat. It should also not be wasting the server's time with illegal requests:
    // everything it asks for is derived from the state it was just handed.
    for (const seed of [1, 2]) {
      expect(play(seed, ['marshal', 'gunner', 'recruit']).rejections).toEqual([]);
    }
  }, 60_000);

  it('keeps its guns inside the wall', () => {
    // The regression this exists for: a minimum cut is the *tightest* wall that
    // works, so the planner drew it closer to the castle every round, and the sweep
    // then took the old outer wall away. Bots ended up owning fifteen cannons with
    // two active between them, and a match nobody could win. Cannons are now sinks
    // in the cut, so a wall has to enclose them.
    // Measured at the resolutions rather than at the final state: a match now ends in
    // a handful of rounds, and the last of them is the one where somebody's wall came
    // down — the worst possible moment to count anybody's working guns.
    // Seed 1 rather than 3, which is now decided in two rounds — too short to show
    // whether guns survive a sustained barrage, which is the whole question here.
    // Three seats, not two. Two-player matches are currently erratic — see PLAN 10m —
    // and a competence test run on them measures that instead of the bot. Three is the
    // documented focus count and the one every balance number is quoted at.
    const { resolutions } = play(1, ['gunner', 'gunner', 'gunner']);
    const late = resolutions.filter((r) => r.round >= 3);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.max(...late.map((r) => r.activeCannons))).toBeGreaterThan(2);
  }, 90_000);
});

describe('bot pacing', () => {
  it('builds at a rate a person could manage', () => {
    // A person lays roughly 20-30 pieces in a 25-second build phase while the pieces
    // are small, falling to 10-18 once the large ones arrive. A bot placing six a
    // second would be unbeatable for a reason that has nothing to do with playing
    // well, so the budget is time in milliseconds, not a per-tick chance.
    // Three seats for the same reason as the tests above: build rate is what this
    // measures, and a two-player match now ends before there are enough phases to
    // measure it over.
    const { placementsPerPhase } = play(3, ['marshal', 'marshal', 'marshal'], 20_000);
    expect(placementsPerPhase.length).toBeGreaterThan(2);
    for (const count of placementsPerPhase) {
      expect(count).toBeLessThanOrEqual(30);
    }
    // And it is actually using the phase, not stopping after a token repair.
    expect(placementsPerPhase[0]).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('slows down as the pieces get harder to place', () => {
    // The piece schedule widens over the match, and a bigger shape takes longer to
    // fit, so the rate should fall of its own accord rather than by a separate rule.
    //
    // Continues off, because a continue rewinds the schedule to round one and the rate
    // climbs straight back — which is the feature working, and the opposite of what
    // this measures.
    const { placementsPerPhase } = play(
      5,
      ['marshal', 'marshal'],
      30_000,
      withoutContinues(defaultRuleset),
    );
    // However many phases the match lasts — it is much shorter than it used to be —
    // the last one should be slower going than the first.
    expect(placementsPerPhase.length).toBeGreaterThanOrEqual(3);
    const first = placementsPerPhase[0] as number;
    const later = placementsPerPhase[placementsPerPhase.length - 1] as number;
    expect(later).toBeLessThan(first);
  }, 60_000);
});
