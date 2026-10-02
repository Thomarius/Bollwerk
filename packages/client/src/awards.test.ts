import { defaultRuleset } from '@rampart/config';
import type { MatchState } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { awardCandidates, drawAwards, type Award } from './awards.js';
import { LocalMatch } from './localMatch.js';
import { MatchLog } from './summary.js';

/** Three players and five rounds of scores; everything else empty unless a test fills it. */
function table(scores: number[][], castles?: number[][]): { log: MatchLog; state: MatchState } {
  const log = new MatchLog();
  scores.forEach((byPlayer, k) => {
    log.scores.push({ round: k + 1, byPlayer, castles: castles?.[k] ?? byPlayer.map(() => 1) });
    log.territoryPoints.push(byPlayer.map(() => 0));
    log.guns.push(byPlayer.map(() => 0));
  });
  const last = scores.at(-1) ?? [];
  const state = {
    seed: 7,
    endedBy: 'round_cap',
    winners: [last.indexOf(Math.max(...last))],
    players: last.map((score, id) => ({
      id,
      name: ['Ada', 'Bo', 'Cy'][id],
      score,
      eliminated: false,
      team: id,
    })),
    teams: last.map((_, id) => ({ id, continuesRemaining: 2, continuesAtStart: 2 })),
  } as unknown as MatchState;
  return { log, state };
}

const ids = (awards: readonly Award[]): string[] => awards.map((a) => `${a.id}:${a.player}`);

describe('the awards a match earns', () => {
  it('gives an award to the one player with the most, and to nobody on a tie', () => {
    const { log, state } = table([[10, 10, 10]]);
    log.destroyed.set(0, 12).set(1, 30).set(2, 5);
    log.pieces.set(0, 20).set(1, 20);
    const found = ids(awardCandidates(log, state));
    expect(found).toContain('wrecker:1');
    expect(found.some((a) => a.startsWith('mason'))).toBe(false);
  });

  it('names an iron wall only for a player sealed every round who spent no life', () => {
    const scores = [
      [10, 10, 10],
      [20, 20, 20],
      [30, 30, 30],
    ];
    const { log, state } = table(scores, [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    log.livesSpent.set(2, 1);
    expect(ids(awardCandidates(log, state)).filter((a) => a.startsWith('iron-wall'))).toEqual([
      'iron-wall:0',
    ]);
  });

  it('marks a comeback from where a player stood after round 5 to where they finished', () => {
    // Cy is third after round 5 and first at the end.
    const { log, state } = table([
      [10, 8, 5],
      [20, 16, 10],
      [30, 24, 15],
      [40, 32, 20],
      [50, 40, 25],
      [60, 50, 90],
    ]);
    const comeback = awardCandidates(log, state).find((a) => a.id === 'comeback');
    expect(comeback).toMatchObject({ player: 2, detail: '3rd after round 5, 1st at the end' });
  });

  it('names the nemesis after the opponent whose wall they broke most', () => {
    const { log, state } = table([[10, 10, 10]]);
    log.brokeOf.set(
      2,
      new Map([
        [0, 9],
        [1, 3],
      ]),
    );
    const nemesis = awardCandidates(log, state).find((a) => a.id === 'nemesis');
    expect(nemesis).toMatchObject({
      title: "Ada's nemesis",
      player: 2,
      detail: "9 blocks of Ada's wall",
    });
  });

  it('calls a win by under 5% a photo finish', () => {
    const { log, state } = table([[400, 390, 100]]);
    expect(awardCandidates(log, state).find((a) => a.id === 'photo-finish')).toMatchObject({
      player: 0,
      detail: 'won by 10 points',
    });
  });
});

describe('drawing the awards to show', () => {
  const candidates: Award[] = [
    { id: 'a', title: 'A', player: 0, detail: '' },
    { id: 'b', title: 'B', player: 0, detail: '' },
    { id: 'c', title: 'C', player: 1, detail: '' },
    { id: 'd', title: 'D', player: 2, detail: '' },
    { id: 'e', title: 'E', player: 1, detail: '' },
  ];

  it('draws the same three from the same seed, as every screen at a table must', () => {
    expect(drawAwards(candidates, 42)).toEqual(drawAwards(candidates, 42));
    expect(drawAwards(candidates, 42)).toHaveLength(3);
  });

  it('gives each to a different player while it can, and never an award twice', () => {
    for (let seed = 0; seed < 50; seed++) {
      const drawn = drawAwards(candidates, seed);
      expect(new Set(drawn.map((a) => a.player)).size).toBe(3);
      expect(new Set(drawn.map((a) => a.id)).size).toBe(drawn.length);
    }
    // One player alone: both their awards rather than none.
    const solo = candidates.filter((a) => a.player === 0);
    expect(drawAwards(solo, 3)).toHaveLength(2);
  });
});

describe('the awards of a match played out', () => {
  it('finds some, every one for a player in the match', () => {
    const match = new LocalMatch({
      seed: 5,
      seats: [5, 5, 5],
      ruleset: { ...defaultRuleset, scoring: { ...defaultRuleset.scoring, maxRounds: 5 } },
    });
    const log = new MatchLog();
    for (let frame = 0; frame < 120_000 && !match.finished; frame++) {
      log.note(match.advance(1000 / 30), match.state);
    }
    expect(match.state.phase).toBe('game_over');
    const found = awardCandidates(log, match.state);
    expect(found.length).toBeGreaterThan(2);
    for (const award of found) expect(match.state.players[award.player]).toBeDefined();
    expect(log.pieces.size).toBeGreaterThan(0);
    expect([...log.brokeOf.values()].some((v) => v.size > 0)).toBe(true);
    expect(drawAwards(found, match.state.seed)).toHaveLength(3);
  }, 120_000);
});
