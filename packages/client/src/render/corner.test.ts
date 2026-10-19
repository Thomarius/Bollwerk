import { defaultArtConfig, type ArtConfig } from '@bollwerk/config';
import { stateFromAscii, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { climax, climaxLevel, pressing } from './corner.js';

const board = (): MatchState =>
  stateFromAscii(`
      ....
      .##.
      ....
    `);

/** A board in `phase`, `secondsLeft` before it ends. */
function at(
  phase: 'build' | 'combat' | 'cannon_place' | 'intermission' | 'game_over',
  secondsLeft: number,
  overtime = false,
): MatchState {
  const state = board();
  state.phase = phase;
  state.tick = 1000;
  state.phaseEndTick = 1000 + secondsLeft * state.ruleset.tickRateHz;
  state.overtime = overtime;
  return state;
}

describe('the corner pieces hurrying', () => {
  it("hurries over a phase's last seconds and in overtime", () => {
    expect(pressing(at('combat', 12))).toBe(false);
    expect(pressing(at('combat', 4))).toBe(true);
    expect(pressing(at('build', 2, true))).toBe(true);
  });

  it('never between phases, nor once the match is over', () => {
    expect(pressing(at('intermission', 1))).toBe(false);
    expect(pressing(at('game_over', -10))).toBe(false);
  });
});

describe('the climax', () => {
  const art = (climaxBuildSeconds: number): ArtConfig => ({
    ...defaultArtConfig,
    effects: { ...defaultArtConfig.effects, climaxBuildSeconds },
  });

  it("comes in over the build phase's last seconds, as the corner pieces hurry", () => {
    const five = art(5);
    expect(climaxLevel(at('build', 12), five)).toBe(0);
    expect(climaxLevel(at('build', 5), five)).toBe(0);
    // Eased in over its first second, not popping on.
    expect(climaxLevel(at('build', 4.5), five)).toBeCloseTo(0.5);
    expect(climaxLevel(at('build', 4), five)).toBe(1);
    expect(climaxLevel(at('build', 1), five)).toBe(1);
    expect(climax(at('build', 4.5), five)).toBe(true);
    expect(pressing(at('build', 4.5))).toBe(true);
  });

  it('only in the build phase: not the cannon phase, nor combat', () => {
    const five = art(5);
    expect(climaxLevel(at('cannon_place', 2), five)).toBe(0);
    expect(climaxLevel(at('combat', 2), five)).toBe(0);
    expect(climaxLevel(at('intermission', 1), five)).toBe(0);
  });

  it('wholly in overtime and the final round, as before', () => {
    for (const seconds of [0, 5]) {
      expect(climaxLevel(at('build', 2, true), art(seconds))).toBe(1);
      const final = at('combat', 8);
      final.ruleset = { ...final.ruleset, scoring: { ...final.ruleset.scoring, maxRounds: 4 } };
      final.round = 4;
      expect(climaxLevel(final, art(seconds))).toBe(1);
    }
  });

  it('keeps to overtime and the final round alone when set to 0', () => {
    expect(climax(at('build', 2), art(0))).toBe(false);
    expect(climax(at('build', 0.5), art(0))).toBe(false);
  });
});
