/**
 * What a build phase played out in advance costs (ARCHIVE 13zf, step 1): bot tables of
 * one level, each bot's coming build phase rolled out in the intermission before it, timed,
 * and checked against what the bot then did.
 *
 *   npx tsx tools/headless/src/rolloutCost.ts --levels 1,5,8,10 --players 4 --matches 3
 *
 * Sloppy levels draw from the table's stream as they fit, which a rollout made with its own
 * stream cannot match, so their placements are timed but not expected to agree.
 */
import { parseArgs } from 'node:util';

import { Bot, PlanningSlots, dealPersonalities, rollOutBuild, type Placement } from '@bollwerk/ai';
// Not exported: reached by its file, as `botReplay.ts` does.
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
    levels: { type: 'string', default: '1,5,8,10' },
    players: { type: 'string', default: '4' },
    matches: { type: 'string', default: '3' },
  },
});
const players = Number(values.players);
const matches = Number(values.matches);

const quantile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

console.log('level  rollouts  pieces  ms mean   p90    max   exact');
for (const level of values.levels.split(',').map(Number)) {
  const times: number[] = [];
  let pieces = 0;
  let exact = 0;
  for (let m = 0; m < matches; m++) {
    const seed = 1000 + m;
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
    const rng = new Rng(seed);
    const bots = setups.map((setup, id) => new Bot(id, setup));
    let predicted: Map<number, Placement[]> | null = null;
    const laid = new Map<number, Placement[]>();
    while (state.phase !== 'game_over' && state.tick < 40_000) {
      if (
        predicted === null &&
        state.phase === 'intermission' &&
        state.pendingPhase === 'build' &&
        state.shots.length === 0
      ) {
        predicted = new Map();
        for (const player of state.players) {
          if (player.eliminated) continue;
          const builder = new Builder(
            player.id,
            botProfile(defaultAiConfig, setups[player.id] as BotSetup),
            new PlanningSlots(),
          );
          const start = performance.now();
          const rollout = rollOutBuild(state, player.id, builder, new Rng(seed));
          times.push(performance.now() - start);
          pieces += rollout?.placements.length ?? 0;
          predicted.set(player.id, rollout?.placements ?? []);
          laid.set(player.id, []);
        }
      }
      for (const player of state.players) {
        const action = bots[player.id]?.think(state, rng) ?? null;
        if (action === null || applyAction(state, action) !== null) continue;
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
          if (JSON.stringify(guess) === JSON.stringify(laid.get(player))) exact++;
        }
        predicted = null;
        laid.clear();
      }
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  console.log(
    [
      String(level).padStart(5),
      String(times.length).padStart(9),
      (pieces / Math.max(1, times.length)).toFixed(1).padStart(7),
      mean.toFixed(1).padStart(9),
      quantile(sorted, 0.9).toFixed(1).padStart(6),
      (sorted.at(-1) ?? 0).toFixed(1).padStart(6),
      `${exact}/${times.length}`.padStart(8),
    ].join(' '),
  );
}
