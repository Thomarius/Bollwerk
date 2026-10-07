// docs/BOT_LEARNING.md, step 3: how well a bot with these fit weights plays against two of
// today's, at a table of three, its seat rotated by the seed. Prints one line of JSON.
//
//   npx tsx src/fitEval.ts --weights '{"plan":4,...}' --seeds 1,2,3 [--level 5]
//
// `--weights null` measures today's bot against itself, which is the noise.
import { parseArgs } from 'node:util';

import { type FitWeights } from '@bollwerk/config';
import { loadConfigBundle } from '@bollwerk/config/node';
import { Bot, PlanningSlots, dealPersonalities, takeBotTurns } from '@bollwerk/ai';
import { Rng, createMatch, drainEvents, step } from '@bollwerk/sim';

import { repoRoot } from './cli.js';

const PLAYERS = 3;

export interface FitResult {
  matches: number;
  /** Mean of (its score - the opponents' mean) / the opponents' mean, a match each. */
  relative: number;
  wins: number;
  /** Its rounds that failed to seal, and all its rounds. */
  failed: number;
  rounds: number;
}

export function evaluate(weights: FitWeights | null, seeds: number[], level: number): FitResult {
  const bundle = loadConfigBundle(repoRoot);
  const learned = { ...bundle.ai, fitWeights: weights };
  const out: FitResult = { matches: 0, relative: 0, wins: 0, failed: 0, rounds: 0 };
  for (const seed of seeds) {
    const seat = seed % PLAYERS;
    const state = createMatch({
      seed,
      ruleset: bundle.ruleset,
      terrainConfig: bundle.terrain,
      players: Array.from({ length: PLAYERS }, (_, p) => ({ name: `b${p}`, isBot: true, team: p })),
    });
    const rng = new Rng(seed);
    const slots = new PlanningSlots(bundle.ai.plansPerTick);
    const personalities = dealPersonalities(seed, new Array<boolean>(PLAYERS).fill(true));
    const bots = state.players.map(
      (p) =>
        new Bot(
          p.id,
          { level, personality: personalities[p.id]! },
          p.id === seat ? learned : bundle.ai,
          slots,
        ),
    );
    while (state.phase !== 'game_over' && state.tick < 200_000) {
      takeBotTurns(state, rng, (player) => bots[player]);
      step(state);
      for (const event of drainEvents(state)) {
        if (event.kind !== 'round_resolved') continue;
        for (const r of event.results) {
          if (r.player !== seat) continue;
          out.rounds++;
          if (r.enclosedCastles === 0) out.failed++;
        }
      }
    }
    const mine = state.players[seat]!.score;
    const others = state.players.filter((p) => p.id !== seat).map((p) => p.score);
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    out.relative += (mine - mean) / Math.max(1, mean);
    if (state.winners.length === 1 && state.winners[0] === seat) out.wins++;
    out.matches++;
  }
  out.relative /= Math.max(1, out.matches);
  return out;
}

if (process.argv[1]?.endsWith('fitEval.ts')) {
  const { values } = parseArgs({
    options: {
      weights: { type: 'string' },
      seeds: { type: 'string' },
      level: { type: 'string', default: '5' },
    },
    strict: true,
  });
  const weights = JSON.parse(values.weights ?? 'null') as FitWeights | null;
  const seeds = (values.seeds ?? '1').split(',').map(Number);
  console.log(JSON.stringify(evaluate(weights, seeds, Number(values.level))));
}
