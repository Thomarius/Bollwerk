import { stateFromAscii, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { IslandParts, withDrawBudget } from './islandParts.js';
import type { ViewTransform } from './theme.js';

/** Three islands, each a different wall, with the sea between. */
const board = (): MatchState =>
  stateFromAscii(
    `
    1#1.2#2.3#3
    111.222.333
  `,
    undefined,
    `
    111.222.333
    111.222.333
  `,
  );

const view: ViewTransform = { tile: 8, originX: 0, originY: 0, width: 88, height: 16, top: 0 };

/** The islands a draw drew, by the part's own island; slow enough to run out any budget. */
function drawing(): { drawn: number[]; draw: (g: unknown, part: MatchState) => void } {
  const drawn: number[] = [];
  return {
    drawn,
    draw: (_g, part) => {
      const wall = part.structure.findIndex((cell) => cell !== 0);
      const island = wall < 0 ? 0 : (part.islandId[wall] as number);
      drawn.push(island);
      const until = performance.now() + 3;
      while (performance.now() < until) {
        // Standing in for an island's drawing, which takes its time.
      }
    },
  };
}

describe('islands drawn under a budget', () => {
  it('draws one island when the budget is spent, and the rest at the next calls', () => {
    const parts = new IslandParts();
    const state = board();
    const { drawn, draw } = drawing();
    const rounds: boolean[] = [];
    for (let i = 0; i < 10 && rounds.at(-1) !== true; i++) {
      rounds.push(withDrawBudget(1, () => parts.draw(state, view, draw)));
    }
    // Every island once, none twice, over as many calls as it took: at least one a call.
    expect(rounds.at(-1)).toBe(true);
    expect(rounds.slice(0, -1).every((done) => !done)).toBe(true);
    expect(drawn.filter((id) => id > 0).sort()).toEqual([1, 2, 3]);
    expect(rounds.length).toBeGreaterThan(1);
    // Drawn whole, a draw now has nothing left to do.
    const before = drawn.length;
    parts.draw(state, view, draw);
    expect(drawn.length).toBe(before);
  });

  it('finishes an island it left even when the view has not changed since', () => {
    const parts = new IslandParts();
    const state = board();
    const { drawn, draw } = drawing();
    expect(withDrawBudget(1, () => parts.draw(state, view, draw))).toBe(false);
    // Without a budget, the next draw takes up every island the first one left.
    parts.draw(state, view, draw);
    expect(drawn.filter((id) => id > 0).sort()).toEqual([1, 2, 3]);
  });

  it('draws everything outside a budget, as ever', () => {
    const parts = new IslandParts();
    const { drawn, draw } = drawing();
    parts.draw(board(), view, draw);
    expect(drawn.filter((id) => id > 0).sort()).toEqual([1, 2, 3]);
  });
});
