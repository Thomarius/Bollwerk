import { stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { pressing } from './corner.js';

describe('the corner pieces hurrying', () => {
  const board = (): ReturnType<typeof stateFromAscii> =>
    stateFromAscii(`
      ....
      .##.
      ....
    `);
  const at = (
    phase: 'build' | 'combat' | 'intermission' | 'game_over',
    secondsLeft: number,
    overtime = false,
  ): boolean => {
    const state = board();
    state.phase = phase;
    state.tick = 1000;
    state.phaseEndTick = 1000 + secondsLeft * state.ruleset.tickRateHz;
    state.overtime = overtime;
    return pressing(state);
  };

  it("hurries over a phase's last seconds and in overtime", () => {
    expect(at('combat', 12)).toBe(false);
    expect(at('combat', 4)).toBe(true);
    expect(at('build', 2, true)).toBe(true);
  });

  it('never between phases, nor once the match is over', () => {
    expect(at('intermission', 1)).toBe(false);
    expect(at('game_over', -10)).toBe(false);
  });
});
