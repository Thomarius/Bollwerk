import { defaultRuleset } from '@rampart/config';
import type { MatchEvent, Shot } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { LocalMatch } from './localMatch.js';
import { MatchLog, mostCastlesOf, scoreChart } from './summary.js';

const shot = (id: number, owner: number): Shot => ({
  id,
  cannonId: id,
  owner,
  fromX: 0,
  fromY: 0,
  toX: 5,
  toY: 5,
  launchTick: 0,
  impactTick: 10,
});

describe('the match log', () => {
  it('credits destroyed wall to whoever fired the shot that landed', () => {
    const log = new MatchLog();
    const players = { players: [{ score: 0 }, { score: 0 }] } as never;
    log.note(
      [
        { kind: 'shot_fired', tick: 1, shot: shot(7, 1) },
        { kind: 'shot_fired', tick: 1, shot: shot(8, 0) },
      ],
      players,
    );
    log.note(
      [
        { kind: 'shot_impact', tick: 11, shotId: 7, x: 5, y: 5, destroyed: [40] },
        // Into the sea: counted as nothing.
        { kind: 'shot_impact', tick: 11, shotId: 8, x: 5, y: 5, destroyed: [] },
      ],
      players,
    );
    expect(log.destroyed.get(1)).toBe(1);
    expect(log.destroyed.get(0)).toBeUndefined();
  });

  it('keeps each round’s scores, the most castles held and the lives spent', () => {
    const log = new MatchLog();
    const resolved = (round: number, castles: number[]): MatchEvent => ({
      kind: 'round_resolved',
      tick: round * 100,
      round,
      results: castles.map((enclosedCastles, player) => ({
        player,
        enclosedCastles,
        cannonsAwarded: 2,
        eliminated: false,
        territoryPoints: 0,
        damagePoints: 0,
      })),
    });
    log.note([resolved(1, [1, 2])], { players: [{ score: 30 }, { score: 60 }] } as never);
    log.note(
      [
        resolved(2, [0, 1]),
        { kind: 'player_continued', tick: 200, player: 0, round: 2, continuesRemaining: 1 },
      ],
      { players: [{ score: 30 }, { score: 95 }] } as never,
    );
    expect(log.scores.map(({ round, byPlayer }) => ({ round, byPlayer }))).toEqual([
      { round: 1, byPlayer: [30, 60] },
      { round: 2, byPlayer: [30, 95] },
    ]);
    expect(mostCastlesOf(log, [1])).toBe(2);
    // A team's best is its best round together — 3 in round one — not 1 + 2 + ... apart.
    expect(mostCastlesOf(log, [0, 1])).toBe(3);
    expect(log.livesSpent.get(0)).toBe(1);
  });

  it('agrees with a whole match played out, round by round and at the end', () => {
    const match = new LocalMatch({
      seed: 5,
      seats: [5, 5],
      ruleset: { ...defaultRuleset, scoring: { ...defaultRuleset.scoring, maxRounds: 3 } },
    });
    const log = new MatchLog();
    for (let frame = 0; frame < 60_000 && !match.finished; frame++) {
      log.note(match.advance(1000 / 30), match.state);
    }
    expect(match.state.phase).toBe('game_over');
    expect(log.scores.map((s) => s.round)).toEqual([1, 2, 3]);
    expect(log.scores.at(-1)?.byPlayer).toEqual(match.state.players.map((p) => p.score));
    // Lives spent are the team pool's, in free-for-all the player's own.
    for (const p of match.state.players) {
      const pool = match.state.teams[p.team]!;
      expect(log.livesSpent.get(p.id) ?? 0).toBe(pool.continuesAtStart - pool.continuesRemaining);
    }
    expect([...log.destroyed.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  }, 60_000);
});

describe('the score chart', () => {
  it('runs every line from nought, and puts the best score at the top', () => {
    const [a, b] = scoreChart(
      [
        { key: 0, scores: [50, 100] },
        { key: 1, scores: [20, 40] },
      ],
      2,
      200,
      100,
    );
    expect(a?.points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
    expect(b?.points.at(-1)).toEqual({ x: 200, y: 60 });
  });
});
