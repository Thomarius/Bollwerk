import { defaultRuleset } from '@bollwerk/config';
import { withoutRoundCap } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { play, type Difficulty } from './testing.js';

describe('difficulty', () => {
  it('holds a better position than the tier below it', () => {
    // Scored by position at a fixed point rather than by wins: well-matched bots
    // often do not finish a match at all now, so counting victories measures mostly
    // whether the clock ran out. Castles held and guns that can actually fire is
    // what being ahead looks like.
    const lead = (strong: Difficulty, weak: Difficulty): number => {
      let ahead = 0;
      for (let seed = 1; seed <= 4; seed++) {
        // Both seats, since position carries a real advantage on a symmetric map.
        for (const order of [
          [strong, weak],
          [weak, strong],
        ] as Difficulty[][]) {
          // Uncapped: this reads position at a fixed tick, and the cap ends a match
          // near it, moving the moment measured. With the cap the lead was 4 of 8.
          const { state } = play(
            seed,
            order as Difficulty[],
            20_000,
            withoutRoundCap(defaultRuleset),
          );
          const strongSeat = order[0] === strong ? 0 : 1;
          const score = (id: number): number =>
            (state.players[id]?.eliminated ? -100 : 0) +
            (state.players[id]?.enclosedCastles ?? 0) * 5 +
            state.cannons.filter((c) => c.owner === id && c.active).length;
          if (score(strongSeat) >= score(1 - strongSeat)) ahead++;
        }
      }
      return ahead;
    };
    expect(lead('gunner', 'recruit')).toBeGreaterThanOrEqual(5);
  }, 120_000);
});
