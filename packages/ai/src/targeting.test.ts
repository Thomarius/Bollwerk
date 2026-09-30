import { BALANCED, defaultAiConfig, type AiConfig, type Targeting } from '@rampart/config';
import { Rng, applyEnclosure, stateFromAscii, type MatchState } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/**
 * Three islands: the bot's, with a gun and a wall, and two rivals' walled castles — the
 * second island nearer the gun than the third.
 */
const BOARD = [
  `
  ..................................
  .**.#.....######.........######...
  .**.#.....#,@@,#.........#,@@,#...
  ..........#,@@,#.........#,@@,#...
  ..........######.........######...
  ..................................
`,
  `
  ..................................
  ..........222222.........333333...
  ..........222222.........333333...
  ..........222222.........333333...
  ..........222222.........333333...
  ..................................
`,
] as const;

/** Every aimed shot by the trait, and no stray aim: Level 10 has none. */
const ALL_BY_TRAIT: AiConfig = {
  ...defaultAiConfig,
  targeting: {
    points: { share: 1 },
    strategic: { share: 1 },
    finisher: { share: 1 },
    grudge: { share: 1 },
  },
};

function bot(targeting: Targeting): Bot {
  return new Bot(0, { level: 10, personality: { ...BALANCED, targeting } }, ALL_BY_TRAIT);
}

/** The board with its castles sealed, as the weakest-wall search looks for sealed ones. */
function board(): MatchState {
  const state = stateFromAscii(BOARD[0], undefined, BOARD[1]);
  applyEnclosure(state);
  // The bot's own island has no castle to seal it; its gun fires all the same here.
  for (const cannon of state.cannons) if (cannon.owner === 0) cannon.active = true;
  return state;
}

/** The island a bot's next shot lands on. */
function targetIsland(b: Bot, state: MatchState): number {
  const action = b.think(state, new Rng(1));
  if (action?.kind !== 'fire') throw new Error('the bot did not fire');
  return state.islandId[action.y * state.width + action.x] as number;
}

describe('targeting traits', () => {
  it('point-maximizing fires at the nearest opponent, the wall nearest its guns', () => {
    const state = board();
    expect(targetIsland(bot('points'), state)).toBe(2);
  });

  it('strategic fires at whoever earns most a round, however far', () => {
    const state = board();
    // Island 3 holds a sealed castle and its ground; island 2 nothing.
    state.players[2]!.enclosedCastles = 1;
    for (let i = 0; i < state.territory.length; i++) {
      if (state.islandId[i] === 3) state.territory[i] = 3;
    }
    expect(targetIsland(bot('strategic'), state)).toBe(3);
  });

  it('finisher fires at the opponent with fewest lives left', () => {
    const state = board();
    state.teams[1]!.continuesRemaining = 2;
    state.teams[2]!.continuesRemaining = 0;
    expect(targetIsland(bot('finisher'), state)).toBe(3);
  });

  it('grudge fires at whoever shot at its walls last round, and waits for a grudge', () => {
    const state = board();
    const grudging = bot('grudge');
    // Round 1: player 2, on island 3, has a shot on its way to the bot's wall.
    state.shots = [
      {
        id: 7,
        cannonId: 0,
        owner: 2,
        fromX: 26,
        fromY: 2,
        toX: 4,
        toY: 1,
        launchTick: 0,
        impactTick: 90,
      },
    ];
    grudging.think(state, new Rng(1));
    // Round 2: it answers.
    state.round = 2;
    state.tick += 100;
    state.shots = [];
    for (const cannon of state.cannons) cannon.shotId = null;
    expect(targetIsland(grudging, state)).toBe(3);
  });
});
