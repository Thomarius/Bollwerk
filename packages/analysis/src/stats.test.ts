import { defaultConfigBundle } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { piecesBudget, statsCsv, type StatRow } from './stats.js';

describe('the pieces budget', () => {
  it('prices a bot tier’s phase, and leaves a person unrated', () => {
    expect(piecesBudget(defaultConfigBundle, 'gunner')).toBeGreaterThan(0);
    expect(piecesBudget(defaultConfigBundle, 'human')).toBeNull();
  });

  it('writes a person’s as an empty cell, not a zero that reads as none used', () => {
    const row: StatRow = {
      match: 'm',
      seed: 1,
      round: 1,
      player: 0,
      difficulty: 'human',
      enclosedCastles: 1,
      cannonsAwarded: 2,
      eliminated: false,
      cannonsOwned: 3,
      cannonsActive: 3,
      cannonRoom: 4,
      wallTiles: 50,
      piecesPlaced: 20,
      piecesBudget: null,
      shotsFired: 10,
      territoryPoints: 40,
      damagePoints: 12,
      score: 52,
      repairAtBuild: 8,
      repairLeft: 0,
      repairStuck: 0,
    };
    const [head, line] = statsCsv([row]).trim().split('\n');
    const cells = Object.fromEntries(
      (head ?? '').split(',').map((column, i) => [column, (line ?? '').split(',')[i]]),
    );
    expect(cells.piecesBudget).toBe('');
    expect(cells.piecesPlaced).toBe('20');
  });
});
