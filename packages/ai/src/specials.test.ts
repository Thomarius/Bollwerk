import { BALANCED, defaultAiConfig, defaultRuleset } from '@bollwerk/config';
import {
  Rng,
  applyEnclosure,
  craterOffsets,
  stateFromAscii,
  withSpecials,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';

/** The bot's sealed ring on island 1, a rival's sealed ring on island 2 beside it. */
const BOARD = [
  `
  .............................
  .##########......##########..
  .#,,,,,,,,#......#,,,,,,,,#..
  .#,@@,,,,,#......#,,,@@,,,#..
  .#,@@,,,,,#......#,,,@@,,,#..
  .#,,,,,,,,#......#,,,,,,,,#..
  .#,,,,,,,,#......#,,,,,,,,#..
  .##########......##########..
  .............................
`,
  `
  .............................
  .1111111111......2222222222..
  .1111111111......2222222222..
  .1111111111......2222222222..
  .1111111111......2222222222..
  .1111111111......2222222222..
  .1111111111......2222222222..
  .1111111111......2222222222..
  .............................
`,
] as const;

function board(art: string = BOARD[0]): MatchState {
  const state = stateFromAscii(art, withSpecials(defaultRuleset), BOARD[1]);
  applyEnclosure(state);
  return state;
}

/** Level 10: every shot where it is aimed, none astray. */
const bot = (): Bot => new Bot(0, { level: 10, personality: BALANCED }, defaultAiConfig);

describe('a bot with a special tower', () => {
  function cannonPhase(owned: number): MatchState {
    const state = board();
    state.phase = 'cannon_place';
    state.phaseEndTick = 10_000;
    const player = state.players[0]!;
    player.startingCastleId = state.castles.find((c) => c.islandId === 1)!.id;
    player.special = 'bertha';
    player.cannonsToPlace = 3;
    // Guns it already owns, standing on its rival's island out of the way.
    for (let k = 0; k < owned; k++) {
      state.cannons.push({
        id: 100 + k,
        owner: 0,
        kind: 'cannon',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        active: true,
        shotId: null,
      });
    }
    return state;
  }

  it('buys it first in a cannon phase, inside the ground round its castle', () => {
    const state = cannonPhase(2);
    const action = bot().think(state, new Rng(1));
    expect(action).toMatchObject({ kind: 'place_cannon', special: true });
    if (action?.kind !== 'place_cannon') return;
    expect(state.territory[action.y * state.width + action.x]).toBe(1);
  });

  it('keeps its cannons when the tower would leave it too few guns', () => {
    // None owned: three cannons, or one tower — fewer than `minGuns`.
    const action = bot().think(cannonPhase(0), new Rng(1));
    expect(action?.kind).toBe('place_cannon');
    expect(action).not.toHaveProperty('special');
  });

  it('never asks for it at an opening placement', () => {
    const state = cannonPhase(2);
    state.players[0]!.openingPlacement = true;
    expect(bot().think(state, new Rng(1))).not.toHaveProperty('special');
  });
});

describe('a bot firing Big Bertha', () => {
  it('aims at the rival’s weakest wall, where the crater takes most of it', () => {
    // Its Bertha on its own island, ready; the rival's wall doubled along its west side.
    const state = board(`
      .............................
      .##########.....###########..
      .#,,,,,,,,#.....##,,,,,,,,#..
      .#,@@,,BB,#.....##,,,@@,,,#..
      .#,@@,,BB,#.....##,,,@@,,,#..
      .#,,,,,,,,#.....##,,,,,,,,#..
      .#,,,,,,,,#.....##,,,,,,,,#..
      .##########.....###########..
      .............................
    `);
    // The doubled side is island 2's too.
    for (let y = 1; y <= 7; y++) {
      const i = y * state.width + 16;
      state.islandId[i] = 2;
      state.owner[i] = 2;
    }
    applyEnclosure(state);
    const action = bot().think(state, new Rng(1));
    expect(action?.kind).toBe('fire');
    if (action?.kind !== 'fire') return;
    let walls = 0;
    for (const [dx, dy] of craterOffsets('plus5')) {
      const i = (action.y + dy) * state.width + action.x + dx;
      if (state.structure[i] === 1 && state.owner[i] === 2) walls++;
    }
    // The thin east side, not the doubled west, and a whole cross of it: three blocks.
    expect(action.x).toBeGreaterThan(18);
    expect(walls).toBe(3);
  });
});
