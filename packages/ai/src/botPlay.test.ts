import { defaultRuleset, defaultTerrainConfig } from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { bot, sealedByOracle, type Difficulty } from './testing.js';

describe('enclosure in real play', () => {
  it('agrees with an independent check at every resolution', () => {
    // Asked after a report of a castle counted as sealed with its only gap onto the
    // sea. The unit tests cover that picture; this covers whatever real play produces.
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const state = createMatch({
        seed,
        ruleset: defaultRuleset,
        terrainConfig: defaultTerrainConfig,
        players: [0, 1, 2].map((i) => ({ name: `b${i}`, isBot: true })),
      });
      const rng = new Rng(seed);
      const tiers: Difficulty[] = ['marshal', 'gunner', 'recruit'];
      const bots = state.players.map((p) => bot(p.id, tiers[p.id] as Difficulty));
      while (state.phase !== 'game_over' && state.tick < 20_000) {
        for (const player of state.players) {
          const action = bots[player.id]?.think(state, rng) ?? null;
          if (action !== null) applyAction(state, action);
        }
        step(state);
        if (!drainEvents(state).some((e) => e.kind === 'round_resolved')) continue;
        for (const castle of state.castles) {
          expect(castle.enclosed, `seed ${seed} round ${state.round} castle ${castle.id}`).toBe(
            sealedByOracle(state, castle.id),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});

describe('bots in teams', () => {
  it('play a 2v2 without ever aiming at a teammate, or asking for a refused move', () => {
    for (const seed of [1, 2]) {
      const state = createMatch({
        seed,
        ruleset: defaultRuleset,
        terrainConfig: defaultTerrainConfig,
        // Teammates on opposite corners of the grid one match, side by side the next.
        players: (seed === 1 ? [0, 1, 1, 0] : [0, 0, 1, 1]).map((team, i) => ({
          name: `b${i}`,
          isBot: true,
          team,
        })),
      });
      const rng = new Rng(seed);
      const bots = state.players.map((p) => bot(p.id, 'gunner'));
      const rejections: string[] = [];
      let shots = 0;
      while (state.phase !== 'game_over' && state.tick < 20_000) {
        for (const player of state.players) {
          const action = bots[player.id]?.think(state, rng) ?? null;
          if (action === null) continue;
          const rejection = applyAction(state, action);
          if (rejection !== null) rejections.push(rejection);
          if (action.kind === 'fire' && rejection === null) {
            shots++;
            const island = state.islandId[action.y * state.width + action.x] as number;
            expect(island === 0 || state.players[island - 1]!.team !== player.team).toBe(true);
          }
        }
        step(state);
        drainEvents(state);
      }
      expect(rejections).toEqual([]);
      expect(shots).toBeGreaterThan(20);
      expect(state.phase).toBe('game_over');
      // A team wins or loses whole: the winners are every member of one side.
      const teams = new Set(state.winners.map((id) => state.players[id]!.team));
      expect(teams.size).toBeLessThanOrEqual(1);
      if (teams.size === 1) expect(state.winners).toHaveLength(2);
    }
  }, 120_000);
});
