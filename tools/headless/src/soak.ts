import { spawn, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { cpus, constants, setPriority } from 'node:os';
import { parseArgs as parseFlags } from 'node:util';
import { basename, join, resolve } from 'node:path';

import {
  parseOutcomesCsv,
  parseStatsCsv,
  type MatchOutcome,
  type StatRow,
} from '@bollwerk/analysis';

import { repoRoot, usageError, wholeNumber } from './cli.js';
import { chunkArgs, chunksOf, soakPlan, type Batch, type Chunk } from './soakPlan.js';
import { soakSummary, type SoakGroup } from './soakSummary.js';

/**
 * The soak runner (ARCHIVE 12h), `npm run soak` from the repository root.
 *
 * Runs the plan's chunks in a pool of harness processes at below-normal priority, each
 * writing `<chunk>.csv`, `<chunk>.outcomes.csv` and `<chunk>.log` into `soaks/<date>/`.
 * Files are written under a temporary name and renamed when the process ends, so a chunk
 * whose files exist is complete: run the same command again after any stop and it carries
 * on. It refuses a tree with uncommitted changes, and a folder begun at another commit,
 * since a soak measures one version of the bots. At the end it writes `summary.txt`.
 *
 *   npm run soak                      all of it, into soaks/<today>/
 *   npm run soak -- --out soaks/x     a folder of one's choosing, or one to resume
 *   npm run soak -- --workers 8       processes at once (all cores but two by default)
 *   npm run soak -- --only s1,s4      batches whose names start so
 *   npm run soak -- --trial           every batch at one chunk of two matches, a dry run
 *   npm run soak -- --list            the plan and its estimated cost, running nothing
 *   npm run soak -- --summary         remake summary.txt from what is there
 *   npm run soak -- --summarise FILE...   a summary of any stats tables, recordings' too
 */

const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const harness = join(repoRoot, 'tools', 'headless', 'src', 'main.ts');
/**
 * How much slower a match runs with ten at once than alone: 2.8, measured in the trial of
 * 2026-10-02 (three players 9.1 s against 3.2, eight 30.6 against 12). Twelve logical
 * cores are six physical ones, so the estimate needs it.
 */
const CONTENTION = 2.8;
const fromCwd = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);

interface Options {
  out: string;
  workers: number;
  only: string[];
  trial: boolean;
  list: boolean;
  summary: boolean;
  summarise: string[];
}

/** The flags, refused whole when one is unknown or lacks its value, as the harness's are. */
function parseOptions(argv: string[]): Options {
  // The local date, as the person starting it reads the calendar; UTC would differ at night.
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  let parsed: ReturnType<typeof parseFlags<{ options: typeof FLAGS; allowPositionals: true }>>;
  try {
    parsed = parseFlags({ args: argv, options: FLAGS, allowPositionals: true, strict: true });
  } catch (error) {
    usageError(`${(error as Error).message}; see the head of tools/headless/src/soak.ts`);
  }
  const { values, positionals } = parsed;
  // What --summarise summarises are the arguments that are not flags.
  if (positionals.length > 0 && values.summarise !== true) {
    usageError(`unexpected ${positionals.join(' ')}: only --summarise takes files`);
  }
  const trial = values.trial === true;
  const out =
    values.out !== undefined
      ? fromCwd(values.out)
      : join(repoRoot, 'soaks', trial ? `trial-${today}` : today);
  return {
    out,
    workers:
      values.workers === undefined
        ? Math.max(1, cpus().length - 2)
        : wholeNumber('workers', values.workers, 1),
    only: values.only === undefined ? [] : values.only.split(',').map((s) => s.trim()),
    trial,
    list: values.list === true,
    summary: values.summary === true,
    summarise: values.summarise === true ? positionals.map(fromCwd) : [],
  };
}

const FLAGS = {
  out: { type: 'string' },
  workers: { type: 'string' },
  only: { type: 'string' },
  trial: { type: 'boolean' },
  list: { type: 'boolean' },
  summary: { type: 'boolean' },
  summarise: { type: 'boolean' },
} as const;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

function plan(o: Options): Batch[] {
  let batches = soakPlan();
  if (o.only.length > 0) batches = batches.filter((b) => o.only.some((p) => b.name.startsWith(p)));
  // The trial plays every batch, a chunk of two matches each, to prove the whole path.
  if (o.trial) batches = batches.map((b) => ({ ...b, matches: b.replay === true ? 0 : 2 }));
  return batches;
}

const files = (out: string, chunk: Chunk) => ({
  stats: join(out, `${chunk.name}.csv`),
  outcomes: join(out, `${chunk.name}.outcomes.csv`),
  log: join(out, `${chunk.name}.log`),
});

function isDone(out: string, chunk: Chunk): boolean {
  const f = files(out, chunk);
  return existsSync(f.stats) && (chunk.batch.replay === true || existsSync(f.outcomes));
}

/** One chunk as a harness process, its files renamed into place once it ends. */
function runChunk(out: string, chunk: Chunk): Promise<{ code: number; ok: boolean }> {
  const f = files(out, chunk);
  const part = { stats: `${f.stats}.part`, outcomes: `${f.outcomes}.part` };
  const recordings = join(repoRoot, 'recordings');
  return new Promise((done) => {
    const log = createWriteStream(f.log);
    const child = spawn(
      process.execPath,
      [tsx, harness, ...chunkArgs(chunk, part.stats, part.outcomes, recordings)],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    try {
      // The machine stays usable while the weekend's run goes on behind it.
      if (child.pid !== undefined) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not permitted: it runs at normal priority, which only costs responsiveness.
    }
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('close', (code) => {
      log.end();
      const written =
        existsSync(part.stats) && (chunk.batch.replay === true || existsSync(part.outcomes));
      if (written) {
        renameSync(part.stats, f.stats);
        if (chunk.batch.replay !== true) renameSync(part.outcomes, f.outcomes);
      }
      // Exit 1 with the files written is a bot asking for something the rules refuse:
      // the data stands, and the problem is reported beside it.
      if (code !== 0)
        appendFileSync(
          join(out, 'problems.txt'),
          `${chunk.name}: exit ${code}${written ? '' : ', no files'}\n`,
        );
      done({ code: code ?? -1, ok: written });
    });
  });
}

/** Every chunk file of a batch, read and joined, grouped as the plan groups them. */
function groupsFrom(out: string, batches: readonly Batch[]): SoakGroup[] {
  const names = readdirSync(out);
  const groups = new Map<string, SoakGroup>();
  for (const batch of batches) {
    const stats: StatRow[] = [];
    const outcomes: MatchOutcome[] = [];
    const prefix = batch.replay === true ? `${batch.name}.csv` : `${batch.name}.`;
    for (const name of names) {
      if (batch.replay === true ? name !== prefix : !name.startsWith(prefix)) continue;
      if (name.endsWith('.outcomes.csv'))
        outcomes.push(...parseOutcomesCsv(readFileSync(join(out, name), 'utf8')));
      else if (name.endsWith('.csv'))
        stats.push(...parseStatsCsv(readFileSync(join(out, name), 'utf8')));
    }
    if (stats.length === 0 && outcomes.length === 0) continue;
    const group: SoakGroup = groups.get(batch.group) ?? {
      name: batch.group,
      stats: [],
      outcomes: batch.replay === true ? null : [],
      ...(batch.pairing === undefined
        ? {}
        : { pairing: { odd: batch.pairing.odd, field: batch.pairing.field, seatOf: new Map() } }),
      ...(batch.matrixOnly === true ? { matrixOnly: true } : {}),
    };
    group.stats.push(...stats);
    group.outcomes?.push(...outcomes);
    // Seeds are the batch's own, so a match's id says which rotation, and so which seat.
    for (const o of outcomes) group.pairing?.seatOf.set(o.match, batch.pairing!.seat);
    groups.set(batch.group, group);
  }
  return [...groups.values()];
}

function writeSummary(out: string, batches: readonly Batch[], heading: string[]): string {
  const path = join(out, 'summary.txt');
  writeFileSync(path, soakSummary(groupsFrom(out, batches), heading), 'utf8');
  return path;
}

async function main(): Promise<void> {
  const o = parseOptions(process.argv.slice(2));

  if (o.summarise.length > 0) {
    // Any stats tables, each its own group, with outcomes beside them where there are any.
    const groups: SoakGroup[] = o.summarise.map((path) => {
      const beside = path.replace(/(\.stats)?\.csv$/, '.outcomes.csv');
      return {
        name: basename(path),
        stats: parseStatsCsv(readFileSync(path, 'utf8')),
        outcomes:
          beside !== path && existsSync(beside)
            ? parseOutcomesCsv(readFileSync(beside, 'utf8'))
            : null,
      };
    });
    process.stdout.write(soakSummary(groups));
    return;
  }

  const batches = plan(o);
  const chunks = chunksOf(batches);
  const cost = chunks.reduce((s, c) => s + c.cost, 0);
  const matches = chunks.reduce((s, c) => s + c.matches, 0);

  if (o.list) {
    for (const b of batches)
      console.log(`  ${b.name.padEnd(26)} ${String(b.matches).padStart(5)} matches`);
    console.log(
      `\n${batches.length} batches, ${chunks.length} chunks, ${matches} matches; about ` +
        `${hours(cost)} of one core, ${hours((cost / o.workers) * CONTENTION)} on ${o.workers} workers`,
    );
    return;
  }

  mkdirSync(o.out, { recursive: true });
  const runFile = join(o.out, 'run.json');
  const commit = git('rev-parse', '--short', 'HEAD');
  const heading = (started: string): string[] => [
    `Soak at ${commit}, begun ${started}${o.trial ? ' (trial)' : ''}`,
    `${batches.length} batches, ${matches} matches planned; folder ${o.out}`,
  ];

  if (o.summary) {
    const run = existsSync(runFile)
      ? (JSON.parse(readFileSync(runFile, 'utf8')) as { started: string })
      : null;
    console.log(`wrote ${writeSummary(o.out, batches, heading(run?.started ?? '?'))}`);
    return;
  }

  // One version of the bots a folder: a soak reads the working tree as it runs. The trial
  // only proves the path, so it may run on changes not yet committed.
  if (!o.trial && git('status', '--porcelain') !== '') {
    console.error(
      'the working tree has uncommitted changes; commit them first, so the soak measures one version',
    );
    process.exit(1);
  }
  let started = new Date().toISOString();
  if (existsSync(runFile)) {
    const run = JSON.parse(readFileSync(runFile, 'utf8')) as { commit: string; started: string };
    if (run.commit !== commit) {
      console.error(
        `${o.out} was begun at ${run.commit}, not ${commit}; resume there or choose another --out`,
      );
      process.exit(1);
    }
    started = run.started;
  } else {
    writeFileSync(
      runFile,
      JSON.stringify({ commit, started, workers: o.workers, trial: o.trial }, null, 2),
    );
  }

  const todo = chunks.filter((c) => !isDone(o.out, c));
  const total = chunks.length;
  let finished = total - todo.length;
  let failed = 0;
  const begun = Date.now();
  const costLeft = (): number => todo.reduce((s, c) => s + c.cost, 0);
  console.log(
    `soak at ${commit}: ${total} chunks, ${finished} already done, ${todo.length} to run on ${o.workers} workers ` +
      `(about ${hours((costLeft() / o.workers) * CONTENTION)}) into ${o.out}`,
  );

  let doneCost = 0;
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (let chunk = queue.shift(); chunk !== undefined; chunk = queue.shift()) {
      const { ok } = await runChunk(o.out, chunk);
      if (ok) finished++;
      else failed++;
      doneCost += chunk.cost;
      // The time left by the cost still queued, at the pace the run has had so far.
      const elapsed = (Date.now() - begun) / 1000;
      const pace = elapsed / Math.max(1, doneCost);
      const left = queue.reduce((s, c) => s + c.cost, 0) * pace;
      const line =
        `[${new Date().toLocaleTimeString()}] ${finished}/${total} chunks` +
        `${failed > 0 ? `, ${failed} failed` : ''}, ${hours(elapsed)} so far, about ${hours(left)} left — ${chunk.name}`;
      console.log(line);
      writeFileSync(join(o.out, 'progress.txt'), `${line}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.workers, Math.max(1, todo.length)) }, worker));

  const summary = writeSummary(o.out, batches, heading(started));
  console.log(
    `\ndone: ${finished}/${total} chunks${failed > 0 ? `, ${failed} failed (problems.txt)` : ''}; ${summary}`,
  );
}

void main();
