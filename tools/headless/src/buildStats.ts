/**
 * How people and bots build, round by round — castles sealed, ground and points, guns owned
 * and firing, room for guns, wall, pieces laid — from the per-round statistics a soak and a
 * replay share (`RoundStats`), people by name and bots by level: the building yardstick of PLAN
 * §11 item 1, as `shotStats.ts` is the shooting one.
 *
 *   npx tsx tools/headless/src/buildStats.ts recordings/ --alias You=Thomas --since 20261011
 *   npx tsx tools/headless/src/buildStats.ts --bots 3,5,7 --matches 6 --players 4
 *
 * A row is a player's round, read at the resolution that ends its build phase; a player out of
 * the match has none. `--bots` plays, for each level listed, tables of that many bots all at that
 * level, balanced.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { Bot, PlanningSlots, takeBotTurns } from '@bollwerk/ai';
import { RoundStats, statsOfRecording, type StatRow } from '@bollwerk/analysis';
import { BALANCED, type ConfigBundle } from '@bollwerk/config';
import { loadConfigBundle } from '@bollwerk/config/node';
import { parseRecording, setupOfRecorded } from '@bollwerk/protocol';
import { Rng, createMatch, drainEvents, step } from '@bollwerk/sim';

import { repoRoot } from './cli.js';

/** Stages of a match: the opening, and three spans after it. */
const STAGES = [
  { name: 'R1', from: 1, to: 1 },
  { name: 'R2-4', from: 2, to: 4 },
  { name: 'R5-7', from: 5, to: 7 },
  { name: 'R8+', from: 8, to: 99 },
] as const;

const groups = new Map<string, { rows: StatRow[]; matches: Set<string> }>();
function add(key: string, row: StatRow): void {
  let group = groups.get(key);
  if (group === undefined) groups.set(key, (group = { rows: [], matches: new Set() }));
  group.rows.push(row);
  group.matches.add(row.match);
}

/** People's names as typed (`--alias You=Thomas`: a local page calls its player "You"). */
const aliases = new Map<string, string>();

/** Every recording in `paths`, replayed: people by their name, bots by level. */
function fromRecordings(
  bundle: ConfigBundle,
  paths: readonly string[],
  since: string | undefined,
): void {
  const files = paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((name) => name.endsWith('.jsonl'))
          .sort()
          .map((name) => join(path, name))
      : [path],
  );
  for (const file of files) {
    let lines;
    try {
      lines = parseRecording(readFileSync(file, 'utf8'));
    } catch {
      console.log(`${file}: not a recording this code reads`);
      continue;
    }
    const header = lines[0];
    if (header?.kind !== 'header') continue;
    // Recordings are named by the time they began, as their ids: `--since` keeps the later.
    if (since !== undefined && header.id.slice(0, since.length) < since) continue;
    const keyOf = header.players.map((p, id) => {
      const setup = setupOfRecorded(header.players[id]);
      return setup === null ? (aliases.get(p.name) ?? p.name) : `bot L${setup.level}`;
    });
    const { rows, replay } = statsOfRecording(bundle, lines);
    const exact = replay.mismatches.length === 0 && replay.refused === 0;
    console.log(`${header.id} ${exact ? 'exact' : 'DIVERGED'}  ${keyOf.join(' | ')}`);
    if (!exact) continue;
    for (const row of rows) add(keyOf[row.player] as string, row);
  }
}

/** Tables of `players` bots all at `level`, balanced, `matches` of them. */
function fromBots(bundle: ConfigBundle, level: number, matches: number, players: number): void {
  for (let m = 0; m < matches; m++) {
    const seed = 1000 + m;
    const setup = { level, personality: BALANCED };
    const state = createMatch({
      seed,
      ruleset: bundle.ruleset,
      terrainConfig: bundle.terrain,
      players: Array.from({ length: players }, (_, p) => ({
        name: `L${level} ${p}`,
        isBot: true,
        team: p,
      })),
    });
    const rng = new Rng(seed);
    const slots = new PlanningSlots(bundle.ai.plansPerTick);
    const bots = state.players.map((p) => new Bot(p.id, setup, bundle.ai, slots));
    const sampler = new RoundStats(bundle, `sim-L${level}-${seed}`, seed, () => setup);
    drainEvents(state);
    while (state.phase !== 'game_over' && state.tick < 200_000) {
      takeBotTurns(state, rng, (player) => bots[player]);
      step(state);
      sampler.observe(state, drainEvents(state));
    }
    for (const row of sampler.rows) add(`bot L${String(level).padStart(2)}`, row);
  }
  console.log(`played ${matches} match(es) of ${players} bots at L${level}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bots: { type: 'string' },
    matches: { type: 'string', default: '4' },
    players: { type: 'string', default: '4' },
    alias: { type: 'string', multiple: true, default: [] },
    since: { type: 'string' },
  },
});
for (const pair of values.alias) {
  const [from, to] = pair.split('=');
  if (from !== undefined && to !== undefined) aliases.set(from, to);
}
const bundle = loadConfigBundle(repoRoot);
if (values.bots !== undefined) {
  for (const level of values.bots.split(',').map(Number)) {
    fromBots(bundle, level, Number(values.matches), Number(values.players));
  }
} else {
  fromRecordings(
    bundle,
    positionals.length > 0 ? positionals : [join(repoRoot, 'recordings')],
    values.since,
  );
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const live = (rows: readonly StatRow[]): StatRow[] => rows.filter((r) => !r.eliminated);
const f = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : '-');

const order = [...groups.keys()].sort();
console.log(
  '\ngroup        matches rounds | points/rd territory damage | castles failed | guns active  share room | walls pieces vsPace',
);
for (const key of order) {
  const { rows, matches } = groups.get(key) as { rows: StatRow[]; matches: Set<string> };
  const r = live(rows);
  const owned = mean(r.map((x) => x.cannonsOwned));
  const active = mean(r.map((x) => x.cannonsActive));
  const paced = r.filter((x) => x.piecesBudget !== null && x.piecesBudget > 0);
  console.log(
    [
      key.padEnd(12),
      String(matches.size).padStart(7),
      String(r.length).padStart(6),
      '|',
      f(mean(r.map((x) => x.territoryPoints + x.damagePoints)), 0).padStart(9),
      f(mean(r.map((x) => x.territoryPoints)), 0).padStart(9),
      f(mean(r.map((x) => x.damagePoints)), 0).padStart(6),
      '|',
      f(mean(r.map((x) => x.enclosedCastles))).padStart(7),
      `${f((100 * r.filter((x) => x.enclosedCastles === 0).length) / (r.length || 1), 0)}%`.padStart(
        6,
      ),
      '|',
      f(owned).padStart(4),
      f(active).padStart(6),
      `${f((100 * active) / (owned || 1), 0)}%`.padStart(6),
      f(mean(r.map((x) => x.cannonRoom))).padStart(4),
      '|',
      f(mean(r.map((x) => x.wallTiles)), 0).padStart(5),
      f(mean(r.map((x) => x.piecesPlaced))).padStart(6),
      (paced.length === 0
        ? '-'
        : f(mean(paced.map((x) => x.piecesPlaced / (x.piecesBudget as number))), 2)
      ).padStart(6),
    ].join(' '),
  );
}

for (const [title, value, digits] of [
  ['territory points a round', (x: StatRow) => x.territoryPoints, 0],
  ['castles sealed', (x: StatRow) => x.enclosedCastles, 1],
  ['guns active', (x: StatRow) => x.cannonsActive, 1],
  ['pieces laid', (x: StatRow) => x.piecesPlaced, 1],
] as const) {
  console.log(`\n${title}, by stage: ${STAGES.map((s) => s.name.padStart(6)).join(' ')}`);
  for (const key of order) {
    const r = live((groups.get(key) as { rows: StatRow[] }).rows);
    const cells = STAGES.map((s) => {
      const in_ = r.filter((x) => x.round >= s.from && x.round <= s.to);
      return (in_.length === 0 ? '-' : f(mean(in_.map(value)), digits)).padStart(6);
    });
    console.log(`  ${key.padEnd(30)} ${cells.join(' ')}`);
  }
}
