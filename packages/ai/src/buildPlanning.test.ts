import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  defaultRuleset,
  defaultTerrainConfig,
} from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { Builder } from './building.js';
import { DEFAULT_PLAN_WEIGHTS, choosePlan, scoreOf, strategiesFor } from './buildPlanning.js';
import { PlanningSlots } from './planning.js';
import { rollOutBuild } from './rollout.js';

describe('a bot planning its build phases', () => {
  it('chooses a plan every phase and lays it exactly, beside bots that do not', () => {
    const ruleset = { ...defaultRuleset, scoring: { ...defaultRuleset.scoring, maxRounds: 4 } };
    const state = createMatch({
      seed: 3,
      ruleset,
      terrainConfig: defaultTerrainConfig,
      players: [0, 1, 2].map((i) => ({ name: `b${i}`, isBot: true })),
    });
    const rng = new Rng(3);
    // A sloppy level too: its slips are drawn from a stream seeded when it plans.
    const slots = new PlanningSlots(defaultAiConfig.plansPerTick);
    const bots = [
      new Bot(0, { level: 8, personality: BALANCED }, defaultAiConfig, slots, { plansAhead: true }),
      new Bot(1, { level: 2, personality: BALANCED }, defaultAiConfig, slots, { plansAhead: true }),
      new Bot(2, { level: 8, personality: BALANCED }, defaultAiConfig, slots),
    ];
    const plans = new Set<object>();
    while (state.phase !== 'game_over' && state.tick < 20_000) {
      for (const player of state.players) {
        const action = bots[player.id]?.think(state, rng) ?? null;
        if (action !== null) expect(applyAction(state, action)).toBeNull();
      }
      if (state.phase === 'build') {
        for (const bot of bots.slice(0, 2)) if (bot.lastPlan !== null) plans.add(bot.lastPlan);
      }
      step(state);
      drainEvents(state);
    }
    expect(state.phase).toBe('game_over');
    expect(plans.size).toBeGreaterThanOrEqual(6);
    expect(bots[0]?.diverged).toBe(0);
    expect(bots[1]?.diverged).toBe(0);
  }, 120_000);
});

describe('strategies sharing a start', () => {
  it('score, played once and branched, as each played alone', () => {
    const ruleset = { ...defaultRuleset, scoring: { ...defaultRuleset.scoring, maxRounds: 3 } };
    const state = createMatch({
      seed: 4,
      ruleset,
      terrainConfig: defaultTerrainConfig,
      players: [0, 1, 2].map((i) => ({ name: `b${i}`, isBot: true })),
    });
    const setup = { level: 8, personality: BALANCED };
    const profile = botProfile(defaultAiConfig, setup);
    const bots = [0, 1, 2].map((id) => new Bot(id, setup));
    const rng = new Rng(4);
    let compared = 0;
    let round = -1;
    while (state.phase !== 'game_over' && state.tick < 20_000) {
      if (
        round !== state.round &&
        state.phase === 'intermission' &&
        state.pendingPhase === 'build' &&
        state.shots.length === 0
      ) {
        round = state.round;
        const branched = new Map(
          choosePlan(state, 0, profile, 9)?.weighed.map((w) => [w.name, w.score]) ?? [],
        );
        for (const strategy of strategiesFor(state, 0)) {
          if (strategy.stages.length === 0) continue;
          const builder = new Builder(0, profile, new PlanningSlots());
          builder.strategy = strategy;
          const alone = rollOutBuild(state, 0, builder, new Rng(9));
          expect(branched.get(strategy.name), `round ${round} ${strategy.name}`).toBe(
            scoreOf(alone!, 0, profile, DEFAULT_PLAN_WEIGHTS),
          );
          compared++;
        }
      }
      for (const player of state.players) {
        const action = bots[player.id]?.think(state, rng) ?? null;
        if (action !== null) applyAction(state, action);
      }
      step(state);
      drainEvents(state);
    }
    expect(compared).toBeGreaterThan(20);
  }, 120_000);
});
