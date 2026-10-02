import type { MatchOutcome, StatRow } from '@bollwerk/analysis';
import { describe, expect, it } from 'vitest';

import { chunksOf, soakPlan, CHUNK_MATCHES } from './soakPlan.js';
import { detail, measure, soakSummary, type SoakGroup } from './soakSummary.js';

function row(
  match: string,
  round: number,
  player: number,
  score: number,
  extra: Partial<StatRow> = {},
): StatRow {
  return {
    match,
    seed: 1,
    round,
    player,
    level: 5,
    personality: '',
    enclosedCastles: 1,
    cannonsAwarded: 2,
    eliminated: false,
    cannonsOwned: 3,
    cannonsActive: 3,
    cannonRoom: 4,
    pockets: 0,
    wallTiles: 50,
    piecesPlaced: 10,
    piecesBudget: 10,
    shotsFired: 5,
    territoryPoints: 10,
    damagePoints: 5,
    score,
    repairAtBuild: 0,
    repairLeft: 0,
    repairStuck: 0,
    ...extra,
  };
}

function outcome(match: string, extra: Partial<MatchOutcome>): MatchOutcome {
  return {
    match,
    seed: 1,
    players: 2,
    teams: [0, 1],
    levels: [5, 5],
    personalities: ['balanced-strategic-balanced', 'offensive-strategic-balanced'],
    rounds: 6,
    endedBy: 'round_cap',
    draw: false,
    winners: [],
    scores: [],
    hash: '0',
    ...extra,
  };
}

/**
 * Two matches whose measures are known. In "a" player 0 leads after round 5 and player 1
 * passes them in round 6 to win at the cap, 110 to 100; player 0 failed round 2. In "b"
 * player 1 is knocked out in round 3, failing it, and player 0 is left standing.
 */
const rows: StatRow[] = [
  ...[1, 2, 3, 4, 5, 6].flatMap((r) => [
    row('a', r, 0, r === 6 ? 100 : r * 18, r === 2 ? { enclosedCastles: 0 } : {}),
    row('a', r, 1, r === 6 ? 110 : r * 15),
  ]),
  row('b', 1, 0, 20),
  row('b', 1, 1, 10),
  row('b', 2, 0, 40),
  row('b', 2, 1, 20, { enclosedCastles: 0 }),
  row('b', 3, 0, 60),
  row('b', 3, 1, 20, { enclosedCastles: 0, eliminated: true }),
];
const outcomes = [
  outcome('a', { winners: [1], scores: [100, 110] }),
  outcome('b', { rounds: 3, endedBy: 'elimination', winners: [0], scores: [60, 20] }),
];
const group: SoakGroup = { name: 'known', stats: rows, outcomes };

describe('the soak summary', () => {
  it('measures how the matches ended, and how close the points one was', () => {
    const m = measure(group);
    expect(m).toMatchObject({
      matches: 2,
      byCap: 1,
      byElimination: 1,
      draws: 0,
      ties: 0,
      rounds: 4.5,
    });
    expect(m.marginMedian).toBeCloseTo(10 / 110);
    expect(m.marginUnder10).toBe(1);
  });

  it('counts a change of lead after round 5, and whether round 5’s leader won', () => {
    const m = measure(group);
    // "a" changed hands in round 6; "b" never reached round 5, so it has no leader then.
    expect(m.leadChanged).toBe(0.5);
    expect(m.leaderAt5Won).toBe(0);
  });

  it('counts failed seals, lives spent and knockouts', () => {
    const m = measure(group);
    // Four players a match each: a/0 failed once, b/1 twice; a/1 and b/0 never.
    expect(m.failsPerPlayer).toBe(0.75);
    expect(m.spentOne).toBe(0.5);
    expect(m.failedRounds).toBeCloseTo(3 / rows.length);
    expect(m.knockoutsPerMatch).toBe(0.5);
    expect(m.knockoutRounds).toEqual([3]);
  });

  it('shares the wins by island and by trait against their fair shares', () => {
    const text = detail(group).join('\n');
    expect(text).toMatch(/island 1\s+50\.0% \(fair 50\.0%/);
    expect(text).toMatch(/wins by risk:\n\s+balanced\s+50\.0%/);
  });

  it('scores a team match by team, and splits a shared win', () => {
    const team = outcome('t', {
      players: 4,
      teams: [0, 0, 1, 1],
      levels: [5, 5, 5, 5],
      personalities: Array(4).fill('balanced-strategic-balanced'),
      winners: [2, 3],
      scores: [50, 50, 60, 45],
    });
    const m = measure({ name: 't', stats: [], outcomes: [team] });
    // 105 against 100: a margin of 1/21.
    expect(m.marginMedian).toBeCloseTo(5 / 105);
  });

  it('lays the pairings out as a matrix of the odd seat’s wins', () => {
    const pair = (odd: number, field: number, winner: number): SoakGroup => ({
      name: `p${odd}${field}`,
      stats: [],
      outcomes: [
        outcome('x', {
          players: 3,
          teams: [0, 1, 2],
          levels: [odd, field, field],
          winners: [winner],
        }),
      ],
      pairing: { odd, field, seatOf: new Map([['x', 0]]) },
      matrixOnly: true,
    });
    const text = soakSummary([pair(3, 7, 0), pair(7, 3, 1)]);
    expect(text).toMatch(/L3 +100% \(1\)/);
    expect(text).toMatch(/L7 +0% \(1\)/);
    expect(text).not.toContain('== p37');
  });

  it('counts the control by its seat, not its level, since every seat has the level', () => {
    const control: SoakGroup = {
      name: 'c',
      stats: [],
      outcomes: ['x', 'y', 'z'].map((match, i) =>
        outcome(match, { players: 3, teams: [0, 1, 2], levels: [5, 5, 5], winners: [i] }),
      ),
      // The odd seat was 0 in every match; it won one of the three.
      pairing: {
        odd: 5,
        field: 5,
        seatOf: new Map([
          ['x', 0],
          ['y', 0],
          ['z', 0],
        ]),
      },
    };
    expect(soakSummary([control])).toMatch(/L5 +33% \(3\)/);
  });

  it('follows the odd seat through the rotations', () => {
    const odd = chunksOf(soakPlan())
      .map((c) => c.batch)
      .filter((b) => b.group === 's2-L3');
    for (const b of odd) expect(b.levels[b.pairing!.seat]).toBe(3);
  });
});

describe('the soak plan', () => {
  const batches = soakPlan();
  const chunks = chunksOf(batches);

  it('names every batch once, and gives none a seed another plays', () => {
    expect(new Set(batches.map((b) => b.name)).size).toBe(batches.length);
    const seeds = chunks.flatMap((c) => Array.from({ length: c.matches }, (_, i) => c.seed + i));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('cuts each batch into chunks that add up to it', () => {
    for (const b of batches.filter((b) => b.replay !== true)) {
      const mine = chunks.filter((c) => c.batch === b);
      expect(mine.reduce((s, c) => s + c.matches, 0)).toBe(b.matches);
      expect(mine.every((c) => c.matches <= CHUNK_MATCHES)).toBe(true);
    }
  });

  it('plays a mixed table from every seat', () => {
    const mix = batches.filter((b) => b.group === 's1-mix356').map((b) => b.levels.join(','));
    expect(mix).toEqual(['3,5,6', '5,6,3', '6,3,5']);
  });
});
