// docs/BOT_LEARNING.md, step 3: the cross-entropy method over the fit weights. Each
// iteration samples weight vectors from a Gaussian, plays each head to head against two
// of today's bots (`fitEval.ts`, every candidate on the same seeds), keeps the best and
// refits the Gaussian to them. `plan` is held at 4: the choice is an argmax, so only the
// ratios of the weights matter.
//
//   npx tsx src/cem.ts [--iterations 10] [--population 16] [--elite 4] [--matches 24]
//                      [--level 5] [--out /tmp/bw/cem] [--resume]
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { FIT_FEATURES, type FitFeature, type FitWeights } from '@bollwerk/config';
import { Rng } from '@bollwerk/sim';

import { type FitResult } from './fitEval.js';

const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '10' },
    population: { type: 'string', default: '16' },
    elite: { type: 'string', default: '4' },
    matches: { type: 'string', default: '24' },
    level: { type: 'string', default: '5' },
    workers: { type: 'string', default: '4' },
    out: { type: 'string', default: '/tmp/bw/cem' },
    resume: { type: 'boolean', default: false },
  },
  strict: true,
});
const iterations = Number(values.iterations);
const population = Number(values.population);
const elite = Number(values.elite);
const matches = Number(values.matches);
const level = Number(values.level);
const workers = Number(values.workers);
const out = values.out;
mkdirSync(out, { recursive: true });

/** Held fixed, for scale. */
const FIXED: Partial<FitWeights> = { plan: 4 };
const FREE = FIT_FEATURES.filter((f) => !(f in FIXED));

/** Where the search starts: roughly the hand-made fit. */
const START: Record<FitFeature, number> = {
  plan: 4,
  planUrgent: 0,
  planCompletes: 0,
  tight: 0,
  tightUrgent: 0,
  tightCompletes: 0,
  thicken: 1,
  skin: 0.5,
  indoors: -5,
  waste: -1,
};
const START_SPREAD = 2;
/** Spread never falls below this, so the search does not stop looking. */
const SPREAD_FLOOR = 0.3;

interface State {
  iteration: number;
  mean: Record<FitFeature, number>;
  spread: Record<FitFeature, number>;
}

const statePath = join(out, 'state.json');
let state: State =
  values.resume && existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as State)
    : {
        iteration: 0,
        mean: { ...START },
        spread: Object.fromEntries(FIT_FEATURES.map((f) => [f, START_SPREAD])) as Record<
          FitFeature,
          number
        >,
      };

function evaluate(weights: FitWeights, seeds: number[]): Promise<FitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'tsx',
        'src/fitEval.ts',
        '--weights',
        JSON.stringify(weights),
        '--seeds',
        seeds.join(','),
        '--level',
        String(level),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let text = '';
    child.stdout.on('data', (d: Buffer) => (text += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`fitEval exited ${code}`));
      else resolve(JSON.parse(text.trim().split('\n').at(-1) ?? '{}') as FitResult);
    });
  });
}

async function pool<T, R>(items: T[], run: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const k = next++;
        results[k] = await run(items[k] as T);
      }
    }),
  );
  return results;
}

const round = (x: number): number => Math.round(x * 100) / 100;

for (; state.iteration < iterations;) {
  const k = state.iteration;
  const rng = new Rng(7919 * (k + 1));
  const seeds = Array.from({ length: matches }, (_, i) => 100_000 + k * 1000 + i);
  // A normal draw from two uniforms (Box-Muller): tools may use Math, the sim may not.
  const normal = (): number =>
    Math.sqrt(-2 * Math.log(1 - rng.nextFloat())) * Math.cos(2 * Math.PI * rng.nextFloat());
  const candidates: FitWeights[] = [{ ...state.mean }];
  for (let c = 0; c < population; c++) {
    const w = { ...state.mean };
    for (const f of FREE) w[f] = round(state.mean[f] + state.spread[f] * normal());
    candidates.push(w);
  }
  const started = Date.now();
  const results = await pool(candidates, (w) => evaluate(w, seeds));
  const scored = candidates.map((w, c) => ({ w, r: results[c] as FitResult, mean: c === 0 }));
  for (const s of scored) {
    appendFileSync(join(out, 'log.jsonl'), `${JSON.stringify({ iteration: k, ...s })}\n`);
  }
  const ranked = scored
    .filter((s) => !s.mean)
    .sort((a, b) => b.r.relative - a.r.relative)
    .slice(0, elite);
  const mean = { ...state.mean };
  const spread = { ...state.spread };
  for (const f of FREE) {
    const xs = ranked.map((s) => s.w[f]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    mean[f] = round(m);
    spread[f] = round(Math.max(SPREAD_FLOOR, Math.sqrt(v)));
  }
  const at = scored[0]!.r;
  console.log(
    `iteration ${k}: mean scored ${round(at.relative)} (wins ${at.wins}/${at.matches}, failed ${at.failed}/${at.rounds}); ` +
      `best ${round(ranked[0]!.r.relative)}; ${Math.round((Date.now() - started) / 1000)} s`,
  );
  console.log(`  next mean ${JSON.stringify(mean)}`);
  state = { iteration: k + 1, mean, spread };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
