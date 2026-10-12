import { BALANCED, defaultAiConfig, defaultRuleset, defaultTerrainConfig } from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { PlanningSlots } from './planning.js';

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
