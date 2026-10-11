import { BALANCED, defaultAiConfig, defaultRuleset, type AiConfig } from '@bollwerk/config';
import {
  Rng,
  applyEnclosure,
  currentPieceId,
  pieceCells,
  stateFromAscii,
  type Action,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/** Every level settling for the second-best fit always, or never. */
const sloppy = (sloppiness: number): AiConfig => ({
  ...defaultAiConfig,
  levels: defaultAiConfig.levels.map((anchor) => ({ ...anchor, sloppiness })),
});

/** Only squares, whose every turn is the same placement. */
const squares = {
  ...defaultRuleset,
  build: {
    ...defaultRuleset.build,
    pieces: [{ name: 'o4', weight: 1 }],
    sizeSchedule: [{ fromRound: 0, sizes: [4] }],
  },
};

/** A castle in a ring with its east side open, in a build phase: a wall to finish. */
function board(): MatchState {
  const state = stateFromAscii(
    `
    ..............
    .,,,,,,,,,,,,.
    .,,########,,.
    .,,#,,,,,,,,,.
    .,,#,,@@,,,,,.
    .,,#,,@@,,,,,.
    .,,#,,,,,,,,,.
    .,,########,,.
    .,,,,,,,,,,,,.
    ..............
  `,
    squares,
  );
  applyEnclosure(state);
  state.phase = 'build';
  state.phaseEndTick = 10_000;
  state.players[0]!.startingCastleId = 0;
  return state;
}

/** The tiles a placement covers, to compare two placements by. */
function covered(state: MatchState, action: Action | null): string {
  if (action?.kind !== 'place_piece') return `no placement (${action?.kind ?? 'none'})`;
  return pieceCells(currentPieceId(state, 0), action.rotation)
    .map(([dx, dy]) => `${action.x + dx},${action.y + dy}`)
    .sort()
    .join(' ');
}

/** The bot's first piece of the phase: a bot takes a piece's time before laying it. */
function firstPiece(bot: Bot, state: MatchState): Action | null {
  const rng = new Rng(1);
  for (; state.tick < state.phaseEndTick; state.tick++) {
    const action = bot.think(state, rng);
    if (action !== null) return action;
  }
  return null;
}

describe('a sloppy bot', () => {
  it('settles for a different fit, never the one it would have chosen', () => {
    // A square tried at four turns was the same placement four times, and the repeats
    // ranked second: the "worse fit" a hurried bot slipped into was the best one again.
    const careful = board();
    const hurried = board();
    const best = covered(
      careful,
      firstPiece(new Bot(0, { level: 1, personality: BALANCED }, sloppy(0)), careful),
    );
    const second = covered(
      hurried,
      firstPiece(new Bot(0, { level: 1, personality: BALANCED }, sloppy(1)), hurried),
    );
    expect(best).not.toMatch(/^no placement/);
    expect(second).not.toMatch(/^no placement/);
    expect(second).not.toBe(best);
  });
});
