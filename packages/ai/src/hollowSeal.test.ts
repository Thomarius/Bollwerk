import { BALANCED, defaultAiConfig } from '@bollwerk/config';
import { Rng, applyEnclosure, stateFromAscii, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/**
 * Nothing sealed. The main castle, on the left, has four guns round it and no wall; the other,
 * far to the right, stands in its ring with one block missing. Sealing the right one is a block
 * of work and keeps no gun firing: a hollow seal (ARCHIVE 13t).
 */
function board(lives: number): MatchState {
  const state = stateFromAscii(`
    ...........................................
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    .,,**,,,,,**,,,,,,,,,,,,,,,,,,,########,,,.
    .,,**,,,,,**,,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,,,,,@@,,,,,,,,,,,,,,,,,,,,,,#,,@@,,,,,,.
    .,,,,,,@@,,,,,,,,,,,,,,,,,,,,,,#,,@@,,#,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,**,,,,,**,,,,,,,,,,,,,,,,,,,########,,,.
    .,,**,,,,,**,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    ...........................................
  `);
  applyEnclosure(state);
  state.phase = 'build';
  // Time for about seven pieces at Level 1: enough for the wall round the guns, not within a
  // defensive Level 1's margin for risk, which covers the one block only.
  state.phaseEndTick = 525;
  state.players[0]!.startingCastleId = state.castles.find((c) => c.x === 7)!.id;
  state.teams[0]!.continuesRemaining = lives;
  return state;
}

/** Which castle the bot's first piece goes beside: the left one or the right one. */
function firstPieceGoesTo(lives: number): 'guns' | 'hollow' {
  const state = board(lives);
  const bot = new Bot(
    0,
    { level: 1, personality: { ...BALANCED, risk: 'defensive' } },
    defaultAiConfig,
  );
  const rng = new Rng(1);
  for (; state.tick < state.phaseEndTick; state.tick++) {
    const action = bot.think(state, rng);
    if (action?.kind === 'place_piece') return action.x < state.width / 2 ? 'guns' : 'hollow';
  }
  throw new Error('the bot laid nothing');
}

describe('a hollow seal', () => {
  it('is passed over while a life is left: the wall keeping the guns is built at full pace', () => {
    expect(firstPieceGoesTo(2)).toBe('guns');
  });

  it('is still taken with no life left, to survive the round', () => {
    expect(firstPieceGoesTo(0)).toBe('hollow');
  });
});
