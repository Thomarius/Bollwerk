import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  defaultRuleset,
  defaultTerrainConfig,
  type BotSetup,
} from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step, type RoundResult } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { Builder } from './building.js';
import { PlanningSlots } from './planning.js';
import { rollOutBuild, type Placement } from './rollout.js';

// Careful levels only: a sloppy bot draws from the table's shared stream as it fits, which
// the rollout cannot know until the plan draws for itself (ARCHIVE 13zf).
const SETUPS: BotSetup[] = [
  { level: 5, personality: BALANCED },
  { level: 8, personality: { risk: 'offensive', targeting: 'points', cannons: 'max' } },
  { level: 10, personality: { risk: 'defensive', targeting: 'finisher', cannons: 'secondary' } },
];

describe('a build phase rolled out', () => {
  it('predicts every piece, its tick, and the round it ends in', () => {
    let compared = 0;
    for (const seed of [1, 2]) {
      const state = createMatch({
        seed,
        ruleset: defaultRuleset,
        terrainConfig: defaultTerrainConfig,
        players: SETUPS.map((_, i) => ({ name: `b${i}`, isBot: true })),
      });
      const rng = new Rng(seed);
      // The ladder, live, against which the ladder's rollouts are checked.
      const bots = SETUPS.map(
        (setup, id) =>
          new Bot(id, setup, defaultAiConfig, new PlanningSlots(), { plansAhead: false }),
      );
      let predicted: Map<number, { placements: Placement[]; result: RoundResult | null }> | null =
        null;
      const laid = new Map<number, Placement[]>();

      while (state.phase !== 'game_over' && state.tick < 30_000) {
        // Rolled out where a bot will plan: the first tick of the intermission before a
        // build phase with nothing left in the air.
        if (
          predicted === null &&
          state.phase === 'intermission' &&
          state.pendingPhase === 'build' &&
          state.shots.length === 0
        ) {
          predicted = new Map();
          laid.clear();
          for (const player of state.players) {
            if (player.eliminated) continue;
            const builder = new Builder(
              player.id,
              botProfile(defaultAiConfig, SETUPS[player.id] as BotSetup),
              new PlanningSlots(),
            );
            const rollout = rollOutBuild(state, player.id, builder, new Rng(0));
            expect(rollout).not.toBeNull();
            predicted.set(player.id, {
              placements: rollout!.placements,
              result: rollout!.result,
            });
            laid.set(player.id, []);
          }
        }
        for (const player of state.players) {
          const action = bots[player.id]?.think(state, rng) ?? null;
          if (action === null) continue;
          expect(applyAction(state, action)).toBeNull();
          if (action.kind === 'place_piece') {
            laid.get(player.id)?.push({
              tick: state.tick,
              x: action.x,
              y: action.y,
              rotation: action.rotation,
            });
          }
        }
        step(state);
        for (const event of drainEvents(state)) {
          if (event.kind !== 'round_resolved' || predicted === null) continue;
          for (const [player, guess] of predicted) {
            const where = `seed ${seed} round ${event.round} player ${player}`;
            expect(laid.get(player), where).toEqual(guess.placements);
            expect(
              event.results.find((r) => r.player === player),
              where,
            ).toEqual(guess.result);
            compared++;
          }
          predicted = null;
        }
      }
    }
    expect(compared).toBeGreaterThan(20);
  }, 300_000);
});
