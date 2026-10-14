/**
 * What each build strategy costs to roll out, and what it scores, planned the usual way and
 * lean — planning again only once its plan is built (ARCHIVE 13zf, pruning). Bot tables
 * where every seat plans with the whole set, so the boards are those planning bots meet.
 *
 *   npx tsx tools/headless/src/strategyCost.ts --level 8 --players 4 --matches 2
 */
import { parseArgs } from 'node:util';

import {
  Bot,
  DEFAULT_PLAN_WEIGHTS,
  PlanningSlots,
  dealPersonalities,
  rollOutBuild,
  scoreOf,
  strategiesFor,
} from '@bollwerk/ai';
import { Builder } from '../../../packages/ai/src/building.js';
import {
  botProfile,
  defaultAiConfig,
  defaultRuleset,
  defaultTerrainConfig,
  type BotSetup,
} from '@bollwerk/config';
import { Rng, applyAction, createMatch, drainEvents, step } from '@bollwerk/sim';

const { values } = parseArgs({
  options: {
    level: { type: 'string', default: '8' },
    players: { type: 'string', default: '4' },
    matches: { type: 'string', default: '2' },
  },
});
const level = Number(values.level);
const players = Number(values.players);

const SHOWN = [
  'ladder',
  'alone1/reachAll',
  'alone2/next',
  'alone1/next',
  'alone2/reachAll',
  'alone1/reach2#2',
  'alone1/reach2#1',
  'hold/next',
  'hold/reachAll',
];
type Tally = { n: number; ms: number; score: number; leanMs: number; leanScore: number };
const tally = new Map<string, Tally>();

for (let m = 0; m < Number(values.matches); m++) {
  const seed = 500 + m;
  const state = createMatch({
    seed,
    ruleset: defaultRuleset,
    terrainConfig: defaultTerrainConfig,
    players: Array.from({ length: players }, (_, i) => ({ name: `b${i}`, isBot: true })),
  });
  const personalities = dealPersonalities(
    seed,
    state.players.map(() => true),
  );
  const setups: BotSetup[] = personalities.map((personality) => ({ level, personality }));
  const bots = setups.map(
    (setup, id) => new Bot(id, setup, defaultAiConfig, new PlanningSlots(), { plansAhead: true }),
  );
  const rng = new Rng(seed);
  let measured = -1;
  while (state.phase !== 'game_over' && state.tick < 40_000) {
    if (
      measured !== state.round &&
      state.phase === 'intermission' &&
      state.pendingPhase === 'build' &&
      state.shots.length === 0
    ) {
      measured = state.round;
      for (const player of state.players) {
        if (player.eliminated) continue;
        const profile = botProfile(defaultAiConfig, setups[player.id] as BotSetup);
        for (const strategy of strategiesFor(state, player.id)) {
          if (!SHOWN.includes(strategy.name)) continue;
          const run = (lean: boolean): [number, number] => {
            const builder = new Builder(player.id, profile, new PlanningSlots());
            builder.strategy = strategy.name === 'ladder' ? null : strategy;
            builder.lean = lean;
            const start = performance.now();
            const rollout = rollOutBuild(state, player.id, builder, new Rng(seed));
            const ms = performance.now() - start;
            const score = scoreOf(rollout!, player.id, profile, DEFAULT_PLAN_WEIGHTS);
            return [ms, Math.max(score, -600)];
          };
          const [ms, score] = run(false);
          const [leanMs, leanScore] = run(true);
          const t = tally.get(strategy.name) ?? { n: 0, ms: 0, score: 0, leanMs: 0, leanScore: 0 };
          t.n++;
          t.ms += ms;
          t.score += score;
          t.leanMs += leanMs;
          t.leanScore += leanScore;
          tally.set(strategy.name, t);
        }
      }
    }
    for (const player of state.players) {
      const action = bots[player.id]?.think(state, rng) ?? null;
      if (action !== null) applyAction(state, action);
    }
    step(state);
    drainEvents(state);
  }
}

console.log(`level ${level}, ${players} players (failed rounds counted at -600)`);
console.log('strategy              phases   ms   score  lean ms  lean score');
for (const name of SHOWN) {
  const t = tally.get(name);
  if (t === undefined) continue;
  console.log(
    `${name.padEnd(20)} ${String(t.n).padStart(7)} ${(t.ms / t.n).toFixed(0).padStart(5)} ${(t.score / t.n).toFixed(0).padStart(7)} ${(t.leanMs / t.n).toFixed(0).padStart(8)} ${(t.leanScore / t.n).toFixed(0).padStart(11)}`,
  );
}
