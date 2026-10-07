import { BALANCED, defaultRuleset } from '@bollwerk/config';
import {
  Rng,
  Structure,
  applyAction,
  applyEnclosure,
  computeEnclosure,
  stateFromAscii,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { coverable } from './coverage.js';

/** Only squares, as late rounds deal no piece small enough for a one-tile hole. */
const squares = {
  ...defaultRuleset,
  build: {
    ...defaultRuleset.build,
    pieces: [{ name: 'o4', weight: 1 }],
    sizeSchedule: [{ fromRound: 0, sizes: [4] }],
  },
};

/**
 * A castle in a ring against the sea to the east, with a gun inside against that wall. A
 * shot has taken the block beside the gun, at (13, 5): sea on one side, the gun on the
 * other, wall above and below, so no square covers it. Another has opened the west side.
 */
function board(): MatchState {
  const state = stateFromAscii(
    `
    ...............
    .,,,,,,,,,,,,..
    .,,,,#########.
    .,,,,#,,,,,,,#.
    .,,,,,,,,,,,,#.
    .,,,,,@@,,,**,.
    .,,,,#@@,,,**#.
    .,,,,#,,,,,,,#.
    .,,,,#,,,,,,,#.
    .,,,,#########.
    .,,,,,,,,,,,,..
    ...............
  `,
    squares,
  );
  applyEnclosure(state);
  state.phase = 'build';
  state.phaseEndTick = 100_000;
  state.players[0]!.startingCastleId = 0;
  return state;
}

const at = (state: MatchState, x: number, y: number): number => y * state.width + x;

describe('coverable', () => {
  it('says no piece of the bag covers a hole between the gun and the sea', () => {
    const state = board();
    expect(coverable(state, 0, at(state, 13, 5))).toBe(false);
    expect(coverable(state, 0, at(state, 5, 4))).toBe(true);
  });

  it('weighs a board with a placement stood in', () => {
    const state = board();
    const i = at(state, 2, 1);
    expect(coverable(state, 0, i)).toBe(true);
    const structure = state.structure.slice();
    for (const [x, y] of [
      [1, 1],
      [3, 1],
      [2, 2],
    ] as const)
      structure[at(state, x, y)] = Structure.Wall;
    expect(coverable(state, 0, i, structure)).toBe(false);
  });
});

describe('a bot facing a hole no piece can fill', () => {
  it('walls round it rather than spending the phase on a wall that cannot close', () => {
    const state = board();
    const bot = new Bot(0, { level: 5, personality: BALANCED });
    const rng = new Rng(1);
    let pieces = 0;
    for (let turn = 0; turn < 200 && pieces < 8; turn++) {
      const action = bot.think(state, rng);
      if (action?.kind === 'place_piece') {
        expect(applyAction(state, action)).toBeNull();
        pieces++;
        if ((computeEnclosure(state).enclosedCastlesByPlayer[0] ?? 0) > 0) break;
      }
      state.tick += 50;
    }
    // Seven pieces: the plan goes round the hole from the first. Planned through it, the
    // bot laid a square towards it before finding it unfillable, and needed eight.
    expect(pieces).toBeLessThanOrEqual(7);
    expect(computeEnclosure(state).enclosedCastlesByPlayer[0]).toBe(1);
    expect(state.structure[at(state, 13, 5)]).toBe(Structure.Empty);
  });
});
