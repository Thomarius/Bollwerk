import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs as parseFlags } from 'node:util';

import { parseOutcomesCsv } from '@bollwerk/analysis';

import { repoRoot, usageError, wholeNumber } from './cli.js';

/**
 * The special towers' balance soaks (SPECIAL_TOWERS.md §6, ARCHIVE 13zk): two-player tables
 * of equal bots, one tower variant against another or none, each pairing at each level on
 * the same seeds in both seat orders — so a share differs between pairings by the towers,
 * not by the maps.
 *
 *   npx tsx tools/headless/src/towerSoak.ts --out soaks/towers-x \
 *     --pairs architect3:none,architect3:architect2 --levels 3,5,8 --matches 96 \
 *     [--set specials.architect.3.repairRadius=3 ...] [--workers 4] [--seed 1000]
 *   npx tsx tools/headless/src/towerSoak.ts --out soaks/towers-x --summary
 *
 * `--players N` (2 by default) plays N-player free-for-all tables: the pairing's first variant in
 * one seat and its second in every other, that seat taken by each in turn on the same seeds —
 * so the first's share is to be read against 1/N (2026-10-30, the user's: a tower aimed down
 * four lines may meet only one rival of two).
 *
 * A chunk's outcomes are written under a temporary name and renamed when its process ends,
 * so a chunk whose file exists is complete and is skipped: the same command carries on after
 * a stop, and a pairing already measured into a folder of the same levers is not run again.
 * The folder remembers its `--set` and commit and refuses to mix others into it.
 */

const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const harness = join(repoRoot, 'tools', 'headless', 'src', 'main.ts');
const fromCwd = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);
/** Matches a harness process plays: small enough to share the work out evenly. */
const CHUNK = 12;

const FLAGS = {
  out: { type: 'string' },
  pairs: { type: 'string' },
  levels: { type: 'string' },
  matches: { type: 'string' },
  seed: { type: 'string' },
  workers: { type: 'string' },
  players: { type: 'string' },
  set: { type: 'string', multiple: true },
  summary: { type: 'boolean' },
} as const;

interface Chunk {
  name: string;
  args: string[];
}

const { values } = (() => {
  try {
    return parseFlags({ args: process.argv.slice(2), options: FLAGS, strict: true });
  } catch (error) {
    usageError(`${(error as Error).message}; see the head of tools/headless/src/towerSoak.ts`);
  }
})();
if (values.out === undefined) usageError('--out wants a folder');
const out = fromCwd(values.out);

if (values.summary === true) {
  console.log(summary(out));
  process.exit(0);
}

const pairs = (values.pairs ?? '').split(',').map((p) => p.split(':'));
if (pairs.some((p) => p.length !== 2 || p.some((v) => v === ''))) {
  usageError('--pairs wants a:b[,c:d...], each a variant or none');
}
const levels = (values.levels ?? '5').split(',').map((l) => wholeNumber('levels', l, 1));
const players = wholeNumber('players', values.players ?? '2', 2);
const matches = wholeNumber('matches', values.matches ?? '96', 2);
if (matches % (players * CHUNK) !== 0) {
  usageError(`--matches wants a multiple of ${players * CHUNK}`);
}
const seed = wholeNumber('seed', values.seed ?? '1000', 0);
const workers = wholeNumber('workers', values.workers ?? String(cpus().length), 1);
const overrides = values.set ?? [];

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })
  .toString()
  .trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot }).length > 0;
// Two players as before, so a folder of the old soaks still matches its levers.
const meta = `${JSON.stringify({ set: [...overrides].sort(), ...(players === 2 ? {} : { players }) })}\n`;
mkdirSync(out, { recursive: true });
const metaFile = join(out, 'set.json');
if (existsSync(metaFile) && readFileSync(metaFile, 'utf8') !== meta) {
  usageError(`${out} was soaked with other levers: ${readFileSync(metaFile, 'utf8').trim()}`);
}
writeFileSync(metaFile, meta);
const stamp = `${commit}${dirty ? '-dirty' : ''}`;
const commitFile = join(out, 'commits.txt');
const commits = existsSync(commitFile) ? readFileSync(commitFile, 'utf8').split('\n') : [];
if (!commits.includes(stamp))
  writeFileSync(commitFile, [...commits, stamp].join('\n').trim() + '\n');
if (commits.filter((c) => c !== '').some((c) => c !== stamp)) {
  console.warn(`warning: ${out} also holds chunks from ${commits.join(' ')}`);
}

const chunks: Chunk[] = [];
for (const [a, b] of pairs as [string, string][]) {
  for (const level of levels) {
    for (let first = seed; first < seed + matches / players; first += CHUNK) {
      for (let order = 0; order < players; order++) {
        // The first variant in seat `order`, the second in every other.
        const towers = Array.from({ length: players }, (_, s) => (s === order ? a : b)).join(',');
        chunks.push({
          name: `${a}-${b}-L${level}-o${order}-s${first}`,
          args: [
            ...['--players', String(players), '--level', String(level), '--specials', 'on'],
            ...['--special', towers, '--matches', String(CHUNK), '--seed', String(first)],
            ...overrides.flatMap((o) => ['--set', o]),
          ],
        });
      }
    }
  }
}
const todo = chunks.filter((c) => !existsSync(join(out, `${c.name}.outcomes.csv`)));
console.log(`${chunks.length - todo.length} of ${chunks.length} chunks done; ${workers} workers`);

const started = Date.now();
let done = 0;
await Promise.all(
  Array.from({ length: Math.min(workers, todo.length) }, async () => {
    for (let chunk = todo.shift(); chunk !== undefined; chunk = todo.shift()) {
      const file = join(out, `${chunk.name}.outcomes.csv`);
      const code = await new Promise<number | null>((ok) => {
        const child = spawn(
          process.execPath,
          [tsx, harness, ...chunk.args, '--outcomes', `${file}.part`],
          {
            cwd: repoRoot,
            stdio: 'ignore',
          },
        );
        child.on('close', ok);
      });
      if (code !== 0) {
        console.error(`${chunk.name} failed (exit ${code})`);
        continue;
      }
      renameSync(`${file}.part`, file);
      done++;
      const minutes = ((Date.now() - started) / 60_000).toFixed(1);
      console.log(`${chunk.name} (${done} this run, ${minutes} min)`);
    }
  }),
);
console.log(`\n${summary(out)}`);

/**
 * The share of matches the first of each pairing won, by level, a shared win or a draw
 * counting half; its standard error, and the rounds a match lasted.
 */
function summary(dir: string): string {
  const groups = new Map<string, { won: number; n: number; rounds: number; unfinished: number }>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.outcomes.csv'))) {
    const match = /^(.+)-(.+)-L(\d+)-o(\d+)-s\d+\.outcomes\.csv$/.exec(file);
    if (match === null) continue;
    const [, a, b, level, order] = match as unknown as [string, string, string, string, string];
    const key = `${a} vs ${b}  L${level}`;
    const group = groups.get(key) ?? { won: 0, n: 0, rounds: 0, unfinished: 0 };
    // In order k the pairing's first variant sat in seat k.
    const seat = Number(order);
    for (const o of parseOutcomesCsv(readFileSync(join(dir, file), 'utf8'))) {
      group.n++;
      group.rounds += o.rounds;
      if (o.endedBy === 'unfinished') group.unfinished++;
      if (o.winners.includes(seat)) group.won += 1 / o.winners.length;
    }
    groups.set(key, group);
  }
  const lines = [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }))
    .map(([key, g]) => {
      const share = g.won / g.n;
      const error = Math.sqrt((share * (1 - share)) / g.n);
      const unfinished = g.unfinished > 0 ? `, ${g.unfinished} unfinished` : '';
      return (
        `${key.padEnd(34)} ${(100 * share).toFixed(0).padStart(3)}% ±${(100 * error).toFixed(0)}` +
        `  of ${g.n}, ${(g.rounds / g.n).toFixed(1)} rounds${unfinished}`
      );
    });
  return [`levers: ${readFileSync(join(dir, 'set.json'), 'utf8').trim()}`, ...lines].join('\n');
}
