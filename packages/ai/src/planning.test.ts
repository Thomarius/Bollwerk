import { BALANCED, defaultAiConfig, defaultRuleset, defaultTerrainConfig } from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { PlanningSlots, turnOrder } from './planning.js';

describe('planning slots', () => {
  it('grant a fixed number of plans a tick, afresh each tick', () => {
    const slots = new PlanningSlots(2);
    expect([slots.take(5), slots.take(5), slots.take(5)]).toEqual([true, true, false]);
    expect(slots.take(6)).toBe(true);
  });

  it('never hold back a bot that has them to itself', () => {
    const slots = new PlanningSlots();
    for (let i = 0; i < 100; i++) expect(slots.take(1)).toBe(true);
  });
});

describe('turn order', () => {
  it('rotates the players by the round, so nobody always waits', () => {
    expect(turnOrder([0, 1, 2, 3], 0)).toEqual([0, 1, 2, 3]);
    expect(turnOrder([0, 1, 2, 3], 1)).toEqual([1, 2, 3, 0]);
    expect(turnOrder([0, 1, 2, 3], 6)).toEqual([2, 3, 0, 1]);
    expect(turnOrder([], 3)).toEqual([]);
  });
});

/** Slots that remember how many plans each tick granted, and how many were refused. */
class CountingSlots extends PlanningSlots {
  readonly granted = new Map<number, number>();
  refused = 0;

  override take(tick: number): boolean {
    const ok = super.take(tick);
    if (ok) this.granted.set(tick, (this.granted.get(tick) ?? 0) + 1);
    else this.refused++;
    return ok;
  }
}

describe('a table sharing its plans', () => {
  it('plans a few at a time and still seals every castle in round one', () => {
    // Eight bots of one level are dealt the same pieces at the same pace, so without the
    // limit all eight planned on the same ticks, all phase long.
    const seed = 3;
    const state = createMatch({
      seed,
      ruleset: defaultRuleset,
      terrainConfig: defaultTerrainConfig,
      players: Array.from({ length: 8 }, (_, i) => ({ name: `L8 ${i}`, isBot: true })),
    });
    const slots = new CountingSlots(defaultAiConfig.plansPerTick);
    const bots = state.players.map(
      (p) => new Bot(p.id, { level: 8, personality: BALANCED }, defaultAiConfig, slots),
    );
    const rng = new Rng(seed);
    let sealed: number[] | null = null;
    while (sealed === null && state.tick < 20_000) {
      for (const player of turnOrder(state.players, state.round)) {
        const action = bots[player.id]?.think(state, rng) ?? null;
        if (action !== null) expect(applyAction(state, action)).toBeNull();
      }
      step(state);
      for (const event of drainEvents(state)) {
        if (event.kind === 'round_resolved') sealed = event.results.map((r) => r.enclosedCastles);
      }
    }

    expect(slots.refused).toBeGreaterThan(0);
    expect(Math.max(...slots.granted.values())).toBeLessThanOrEqual(defaultAiConfig.plansPerTick);
    expect(sealed).not.toBeNull();
    for (const castles of sealed ?? []) expect(castles).toBeGreaterThan(0);
  });
});
