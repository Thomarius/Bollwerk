import { BALANCED, defaultAiConfig, type AiConfig } from '@bollwerk/config';
import {
  Rng,
  applyAction,
  applyEnclosure,
  computeEnclosure,
  stateFromAscii,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/** Every risk trait with widening once sealed set as asked. */
const widening = (on: boolean): AiConfig => ({
  ...defaultAiConfig,
  risk: {
    defensive: { ...defaultAiConfig.risk.defensive, widensWhenSealed: on },
    balanced: { ...defaultAiConfig.risk.balanced, widensWhenSealed: on },
    offensive: { ...defaultAiConfig.risk.offensive, widensWhenSealed: on },
  },
});

/**
 * A castle sealed in its starting ring, and a second castle on open ground beside it: a
 * wall pushed out from the ring takes it in for a few blocks, where a wall with room round
 * both would have to be built anew outside the ring.
 */
function board(): MatchState {
  const state = stateFromAscii(`
    ......................
    .,,,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,.
    .,,########,,,,,,,,,,.
    .,,#,,,,,,#,,,,,,,,,,.
    .,,#,,,,,,#,,,,@@,,,,.
    .,,#,,@@,,#,,,,@@,,,,.
    .,,#,,@@,,#,,,,,,,,,,.
    .,,#,,,,,,#,,,,,,,,,,.
    .,,#,,,,,,#,,,,,,,,,,.
    .,,########,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,.
    .,,,,,,,,,,,,,,,,,,,,.
    ......................
  `);
  applyEnclosure(state);
  state.phase = 'build';
  // Twelve seconds: time for the wall pushed out to the castle, not for a wall with room
  // round both, which is what the ladder below widening reaches for.
  state.phaseEndTick = 360;
  const main = state.castles.find((c) => c.x === 6)!;
  state.players[0]!.startingCastleId = main.id;
  return state;
}

/** Castles sealed after the bot has laid what the phase gives it. */
function castlesAfterAPhase(on: boolean): number {
  const state = board();
  const bot = new Bot(0, { level: 5, personality: BALANCED }, widening(on));
  const rng = new Rng(1);
  for (; state.tick < state.phaseEndTick; state.tick++) {
    const action = bot.think(state, rng);
    if (action !== null) expect(applyAction(state, action)).toBeNull();
  }
  return computeEnclosure(state).enclosedCastlesByPlayer[0] ?? 0;
}

describe('a sealed bot widening its wall', () => {
  it('pushes the standing wall out to take in the castle beside it', () => {
    expect(castlesAfterAPhase(true)).toBe(2);
  });

  it('where without it the phase goes on thickening the ring', () => {
    expect(castlesAfterAPhase(false)).toBe(1);
  });
});
