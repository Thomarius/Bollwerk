import { BALANCED, defaultConfigBundle } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { setupOfRecorded } from '@rampart/protocol';

import { piecesBudget, rowLabel, statsCsv, type StatRow } from './stats.js';

describe('the pieces budget', () => {
  it('prices a bot tier’s phase, and leaves a person unrated', () => {
    expect(piecesBudget(defaultConfigBundle, { level: 5, personality: BALANCED })).toBeGreaterThan(
      0,
    );
    expect(piecesBudget(defaultConfigBundle, 'human')).toBeNull();
  });

  it('writes a person’s as an empty cell, not a zero that reads as none used', () => {
    const row: StatRow = {
      match: 'm',
      seed: 1,
      round: 1,
      player: 0,
      level: null,
      personality: '',
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

describe('who played a recorded seat', () => {
  const player = { name: 'x', isBot: true, team: 0 };

  it('reads a level and a personality, a person as nobody', () => {
    const personality = { ...BALANCED, risk: 'offensive' as const };
    expect(setupOfRecorded({ ...player, level: 7, personality })).toEqual({
      level: 7,
      personality,
    });
    expect(setupOfRecorded({ ...player, isBot: false, level: null, personality: null })).toBeNull();
  });

  it('still reads recordings made before levels, by the tier they name', () => {
    expect(setupOfRecorded({ ...player, difficulty: 'marshal' })).toEqual({
      level: 8,
      personality: BALANCED,
    });
    expect(setupOfRecorded({ ...player, isBot: false, difficulty: null })).toBeNull();
  });

  it('labels rows by level, with a personality only when it is not balanced', () => {
    expect(rowLabel({ level: 5, personality: 'balanced · strategic · balanced cannons' })).toBe(
      'L5',
    );
    expect(rowLabel({ level: 5, personality: 'offensive · strategic · balanced cannons' })).toBe(
      'L5 offensive · strategic · balanced cannons',
    );
    expect(rowLabel({ level: null, personality: '' })).toBe('human');
  });
});
