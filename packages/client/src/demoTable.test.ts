import { applySettings, defaultConfigBundle, teamsBalanced } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { demoSetup, DEMO_TABLES, idleDue, rollDemoTable, tableCaption } from './demoTable.js';

/** Rolls handed out in order, for a table chosen exactly. */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

const STYLES = { build: 'flat', combat: 'pixel' } as const;

describe('the demo table', () => {
  it('is one of three player counts and team sizes, alike in chance', () => {
    expect(rollDemoTable(rolls(0, 0, 0))).toMatchObject({ players: 3, teamSize: 1 });
    expect(rollDemoTable(rolls(0.4, 0, 0))).toMatchObject({ players: 4, teamSize: 1 });
    expect(rollDemoTable(rolls(0.99, 0, 0))).toMatchObject({ players: 4, teamSize: 2 });
    // A roll of exactly 1 is out of range for Math.random, and still a table.
    expect(DEMO_TABLES).toContainEqual(
      expect.objectContaining({
        players: rollDemoTable(rolls(1, 0, 0)).players,
        teamSize: rollDemoTable(rolls(1, 0, 0)).teamSize,
      }),
    );
  });

  it('plays special towers half the time, on a seed of 32 bits', () => {
    expect(rollDemoTable(rolls(0, 0.2, 0)).specials).toBe(true);
    expect(rollDemoTable(rolls(0, 0.7, 0)).specials).toBe(false);
    const { seed } = rollDemoTable(rolls(0, 0, 0.999999));
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true);
  });

  it('seats only bots at the demo level, over the demo rounds', () => {
    const { demo } = defaultConfigBundle.art;
    const setup = demoSetup({ players: 3, teamSize: 1, specials: false, seed: 7 }, STYLES, 'You');
    expect(setup.seats).toEqual([demo.botLevel, demo.botLevel, demo.botLevel]);
    expect(setup.settings.maxRounds).toBe(demo.rounds);
    expect(setup.teams).toBeUndefined();
    // Bots draw their towers from the seed, the host choosing none.
    expect(setup.botTowers).toBeUndefined();
    expect(setup.styles).toEqual(STYLES);
    expect(setup.seed).toBe(7);
  });

  it('puts two against two in teams of two, and its rules are valid', () => {
    const setup = demoSetup({ players: 4, teamSize: 2, specials: true, seed: 1 }, STYLES, 'You');
    expect(teamsBalanced(setup.teams ?? [], 2)).toBe(true);
    const ruleset = applySettings(defaultConfigBundle.ruleset, setup.settings);
    expect(ruleset.specials.enabled).toBe(true);
    expect(ruleset.scoring.maxRounds).toBe(defaultConfigBundle.art.demo.rounds);
  });

  it('is named as the match starts', () => {
    expect(tableCaption({ players: 3, teamSize: 1, specials: true, seed: 0 })).toEqual([
      '3 players, free-for-all',
      'Special towers',
    ]);
    expect(tableCaption({ players: 4, teamSize: 2, specials: false, seed: 0 })).toEqual([
      'Two against two',
      'Classic rules',
    ]);
  });
});

describe('the idle clock', () => {
  it('starts the demo once the menu has stood untouched long enough', () => {
    expect(idleDue(1000, 30_999, 30_000)).toBe(false);
    expect(idleDue(1000, 31_000, 30_000)).toBe(true);
  });
});
