import { BALANCED, defaultAiConfig } from '@bollwerk/config';
import { Rng, applyEnclosure, stateFromAscii, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/**
 * Nothing sealed. The main castle, on the left, has four guns round it and no wall; the other,
 * far to the right, stands in its ring with one block missing. Sealing the right one is a block
 * of work and keeps no gun firing: a hollow seal (ARCHIVE 13t).
 */
function board(lives: number, near = false): MatchState {
  const state = stateFromAscii(
    near
      ? NEAR
      : `
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
  `,
  );
  applyEnclosure(state);
  state.phase = 'build';
  // Time for about seven pieces at Level 1: enough for the wall round the guns, not within a
  // defensive Level 1's margin for risk, which covers the one block only.
  state.phaseEndTick = 525;
  state.players[0]!.startingCastleId = state.castles.find((c) => c.x === 7)!.id;
  state.teams[0]!.continuesRemaining = lives;
  return state;
}

/**
 * The same, but the gunless castle stands nine tiles from the guns rather than across the
 * island: counted as a gun within twelve tiles of a castle, a wall round it looked to keep
 * every gun, and bots in the test matches of 2026-10-11 sealed such a castle round after
 * round with all their guns dead (ARCHIVE 13y).
 */
const NEAR = `
    ...............................
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    .,,**,,,,,**,,,,,,,########,,,.
    .,,**,,,,,**,,,,,,,#,,,,,,#,,,.
    .,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,,,,,@@,,,,,,,,,,#,,@@,,,,,,.
    .,,,,,,@@,,,,,,,,,,#,,@@,,#,,,.
    .,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,,,,,,,,,,,,,,,,,#,,,,,,#,,,.
    .,,**,,,,,**,,,,,,,########,,,.
    .,,**,,,,,**,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,,,,,,,,,,.
    ...............................
  `;

/** Which castle the bot's first piece goes beside: the left one or the right one. */
function firstPieceGoesTo(lives: number, near = false): 'guns' | 'hollow' {
  const state = board(lives, near);
  const bot = new Bot(
    0,
    { level: 1, personality: { ...BALANCED, risk: 'defensive' } },
    defaultAiConfig,
  );
  const rng = new Rng(1);
  for (; state.tick < state.phaseEndTick; state.tick++) {
    const action = bot.think(state, rng);
    if (action?.kind === 'place_piece') return action.x < 15 ? 'guns' : 'hollow';
  }
  throw new Error('the bot laid nothing');
}

describe('a hollow seal', () => {
  it('is passed over while a life is left: the wall keeping the guns is built at full pace', () => {
    expect(firstPieceGoesTo(2)).toBe('guns');
  });

  it('is seen for what it is beside the guns too: only guns its wall encloses count', () => {
    expect(firstPieceGoesTo(2, true)).toBe('guns');
  });

  it('is still taken with no life left, to survive the round', () => {
    expect(firstPieceGoesTo(0)).toBe('hollow');
  });
});
