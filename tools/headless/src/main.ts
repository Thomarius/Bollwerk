import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs as parseFlags } from 'node:util';

import {
  BALANCED,
  MAX_LEVEL,
  MIN_LEVEL,
  RulesetSchema,
  TOWER_VARIANTS,
  parsePersonality,
  personalityWords,
  validateConfigBundle,
  type AiConfig,
  type BotSetup,
  type Personality,
  type Ruleset,
  type TowerVariant,
} from '@bollwerk/config';
import { loadConfigBundle } from '@bollwerk/config/node';
import { Bot, PlanningSlots, dealPersonalities, drawnSpecial, takeBotTurns } from '@bollwerk/ai';
import {
  Rng,
  createMatch,
  drainEvents,
  generateTerrain,
  hashMatchState,
  renderAscii,
  seatOrder,
  step,
  type Action,
  type MatchState,
} from '@bollwerk/sim';
import { MatchRecorder } from '@bollwerk/protocol';

import { repoRoot, usageError, wholeNumber } from './cli.js';
import { replayAll } from './replay.js';
import { runTournaments } from './tournament.js';
import { summariseStats } from './summary.js';
import {
  RoundStats,
  outcomeOf,
  outcomesCsv,
  statsCsv,
  type MatchOutcome,
  type StatRow,
} from '@bollwerk/analysis';

/**
 * Headless harness: runs matches with no renderer.
 *
 * Its job is to catch what a UI cannot show you — a phase machine that stalls, a
 * seed that generates no valid map, a replay that does not reproduce. Beyond the
 * outcome it can also record, per round, the handful of quantities every open
 * question about the bots turns out to be about: see `--stats`.
 */

interface Args {
  matches: number;
  players: number;
  seed: number;
  maxTicks: number;
  map: boolean;
  /** Skill level per seat, repeating if shorter than the table. */
  levels: number[];
  /** Personality per seat, repeating; `dealt` deals one from the seed as a match does. */
  personalities: (Personality | 'dealt')[];
  /** Whether the matches play special towers (`--specials on`). */
  specials: boolean;
  /** Each seat's tower, repeating: a kind, none, or `random` — drawn as a match draws a bot's. */
  towers: (TowerVariant | null | 'random')[];
  stats: string | null;
  /** One row per match: who won, how it ended, the final scores (`MatchOutcome`). */
  outcomes: string | null;
  /** Players per team; 1 is free-for-all. Seats go into teams in order, then shuffle. */
  teams: number;
  /** Overrides `scoring.maxRounds`; undefined keeps the ruleset's, null lifts the cap. */
  maxRounds: number | null | undefined;
  /** Recordings to replay, files or directories of them, instead of running bots. */
  replay: string[];
  /** Per seat, repeating: whether its bot plays each build phase out in advance. */
  plans: boolean[];
  /** Every planned phase's strategies and their scores, a JSON line each. */
  planLog: string | null;
  /** A folder to write each match into as a recording, as the server would, for tools reading them. */
  record: string | null;
  /** The strategies a planning bot weighs, by name; all when null. */
  planSet: string[] | null;
  /** Simulated pieces a tick the table's planning bots share; unlimited when null. */
  planSteps: number | null;
  /** Per seat, repeating: the minimum of guns a plan should leave; the config's when null. */
  minGuns: number[] | null;
  /** Per seat, repeating: whether it fails a round on purpose short of them. */
  failOnPurpose: boolean[] | null;
  /** Ruleset values to override, `path=json` each (`--set`). */
  set: string[];
}

/**
 * The ruleset with `--set` values written over it, `specials.architect.3.repairRadius=2.6`
 * each, the value read as JSON and the whole checked by the schema as the file is: a soak
 * tries a lever without editing config/, which a soak running beside it would read.
 */
function withOverrides(ruleset: Ruleset, overrides: readonly string[]): Ruleset {
  const out = structuredClone(ruleset) as unknown as Record<string, unknown>;
  for (const override of overrides) {
    const eq = override.indexOf('=');
    if (eq < 1) usageError(`--set wants path=value, not ${override}`);
    const path = override.slice(0, eq).split('.');
    let value: unknown;
    try {
      value = JSON.parse(override.slice(eq + 1));
    } catch {
      usageError(`--set ${override}: the value is not JSON`);
    }
    let node = out;
    for (const key of path.slice(0, -1)) {
      const next = node[key];
      if (typeof next !== 'object' || next === null) usageError(`--set: no ${path.join('.')}`);
      node = next as Record<string, unknown>;
    }
    const last = path.at(-1) as string;
    if (!(last in node)) usageError(`--set: no ${path.join('.')}`);
    node[last] = value;
  }
  const parsed = RulesetSchema.safeParse(out);
  if (!parsed.success) usageError(`--set: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Seat levels: one sets the whole table; a comma-separated list sets each seat in turn
 * and repeats if it is shorter than the table. A table of identical bots answers "do
 * matches end?" but cannot answer "does Level 8 beat Level 5?", the ladder 11.6 tunes.
 */
function parseLevels(value: string | undefined): number[] | null {
  if (value === undefined) return null;
  const levels = value.split(',').map((n) => Number(n.trim()));
  if (levels.some((l) => !Number.isInteger(l) || l < MIN_LEVEL || l > MAX_LEVEL)) return null;
  return levels;
}

/** Seat personalities, likewise: `offensive`, `defensive,balanced`, or `dealt`. */
/** Seat towers, each at its cost: `bertha3`, `none`, `random`, or a list of them. */
function parseTowers(value: string | undefined): (TowerVariant | null | 'random')[] | null {
  if (value === undefined) return ['random'];
  const out: (TowerVariant | null | 'random')[] = [];
  for (const text of value.split(',').map((t) => t.trim())) {
    if (text === 'none') out.push(null);
    else if (text === 'random' || (TOWER_VARIANTS as readonly string[]).includes(text)) {
      out.push(text as TowerVariant | 'random');
    } else return null;
  }
  return out;
}

function parsePersonalities(value: string | undefined): (Personality | 'dealt')[] | null {
  if (value === undefined) return null;
  const out: (Personality | 'dealt')[] = [];
  for (const text of value.split(',').map((t) => t.trim())) {
    if (text === 'dealt') {
      out.push('dealt');
      continue;
    }
    const personality = parsePersonality(text);
    if (personality === null) return null;
    out.push(personality);
  }
  return out;
}

const USAGE =
  'usage: npm start -w @bollwerk/headless -- [--matches N] [--players N] [--seed N] ' +
  '[--max-ticks N] [--max-rounds N|none] [--teams N] [--level 1-10[,...]] ' +
  '[--personality offensive|dealt|...[,...]] [--specials on|off] [--special bertha2|bertha3|architect2|architect3|rapid2|rapid3|lightning2|lightning3|biggest2|biggest3|none|random[,...]] [--plans 1,0[,...]] [--set path=json ...] [--stats FILE] [--outcomes FILE] [--record DIR] [--map]\n' +
  '       npm start -w @bollwerk/headless -- --replay recordings/ [more files or dirs] [--stats FILE]\n' +
  '       npm start -w @bollwerk/headless -- --tournament [--help for its flags]';

/**
 * The flags, refused whole when one is unknown, lacks its value or is not a number: they
 * were once read loosely, so a typo ran the defaults and `--stats --level 5` wrote a file
 * called `--level`. What `--replay` replays are the arguments that are not flags.
 */
function parseArgs(argv: string[]): Args {
  let parsed: ReturnType<typeof parseFlags<{ options: typeof FLAGS; allowPositionals: true }>>;
  try {
    parsed = parseFlags({ args: argv, options: FLAGS, allowPositionals: true, strict: true });
  } catch (error) {
    usageError(`${(error as Error).message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    console.log(USAGE);
    process.exit(0);
  }
  if (positionals.length > 0 && values.replay !== true) {
    usageError(`unexpected ${positionals.join(' ')}: only --replay takes files\n${USAGE}`);
  }
  if (values.replay === true && positionals.length === 0) {
    usageError('--replay wants recordings: files, or directories of them');
  }
  const levels = values.level === undefined ? [5] : parseLevels(values.level);
  if (levels === null)
    usageError(`--level wants ${MIN_LEVEL}-${MAX_LEVEL}, or a comma-separated list`);
  // Balanced unless asked, so a soak measures what it says rather than a random draw.
  const personalities =
    values.personality === undefined ? [BALANCED] : parsePersonalities(values.personality);
  if (personalities === null) {
    usageError('--personality wants trait values joined by -, "dealt", or a list');
  }
  if (values.specials !== undefined && values.specials !== 'on' && values.specials !== 'off') {
    usageError('--specials wants on or off');
  }
  const towers = parseTowers(values.special);
  if (towers === null) usageError(`--special wants ${TOWER_VARIANTS.join(', ')}, none or random`);
  const number = (flag: keyof typeof values, fallback: number, min: number): number => {
    const value = values[flag];
    return typeof value === 'string' ? wholeNumber(flag, value, min) : fallback;
  };
  return {
    matches: number('matches', 20, 1),
    players: number('players', 3, 2),
    seed: number('seed', 1, 0),
    maxTicks: number('max-ticks', 150_000, 1),
    map: values.map === true,
    levels,
    personalities,
    specials: values.specials === 'on',
    towers,
    stats: values.stats ?? null,
    outcomes: values.outcomes ?? null,
    maxRounds:
      values['max-rounds'] === undefined
        ? undefined
        : values['max-rounds'] === 'none'
          ? null
          : number('max-rounds', 0, 1),
    teams: number('teams', 1, 1),
    replay: values.replay === true ? positionals : [],
    planLog: values['plan-log'] ?? null,
    record: values.record ?? null,
    planSet: values['plan-set']?.split(',') ?? null,
    planSteps: values['plan-steps'] === undefined ? null : Number(values['plan-steps']),
    minGuns: values['min-guns']?.split(',').map(Number) ?? null,
    failOnPurpose: values['fail-on-purpose']?.split(',').map((v) => v.trim() === '1') ?? null,
    plans: values.plans?.split(',').map((v) => v.trim() === '1') ?? [bundle.ai.planning.enabled],
    set: values.set ?? [],
  };
}

const FLAGS = {
  matches: { type: 'string' },
  players: { type: 'string' },
  seed: { type: 'string' },
  'max-ticks': { type: 'string' },
  'max-rounds': { type: 'string' },
  teams: { type: 'string' },
  level: { type: 'string' },
  personality: { type: 'string' },
  specials: { type: 'string' },
  special: { type: 'string' },
  plans: { type: 'string' },
  'plan-log': { type: 'string' },
  record: { type: 'string' },
  'plan-set': { type: 'string' },
  'plan-steps': { type: 'string' },
  'min-guns': { type: 'string' },
  'fail-on-purpose': { type: 'string' },
  set: { type: 'string', multiple: true },
  stats: { type: 'string' },
  outcomes: { type: 'string' },
  map: { type: 'boolean' },
  replay: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

function describeOutcome(state: MatchState): string {
  if (state.phase !== 'game_over') return `unfinished (${state.phase}, round ${state.round})`;
  if (state.draw) return 'draw';
  if (state.winners.length === 0) return 'no winner';
  const who = state.winners.map((id) => `player ${id}`).join(' + ');
  return state.endedBy === 'round_cap' ? `${who} on points` : `${who} last standing`;
}

// ------------------------------------------------------------------------- teams

/** Each seat's team: seats go into teams in order, as a room's default table has them. */
function teamsBySeat(players: number, size: number): number[] {
  return Array.from({ length: players }, (_, seat) => (size > 1 ? Math.floor(seat / size) : seat));
}

/**
 * Each player's team, by player id, seated the way a room seats them: seats go into
 * teams in order, then each seat is dealt its island from the seed (`seatOrder`).
 */
function teamSeating(seed: number, players: number, size: number): number[] {
  const teams = teamsBySeat(players, size);
  const order = seatOrder(seed, teams, bundle.terrain);
  const byPlayer = new Array<number>(players).fill(0);
  order.forEach((player, seat) => {
    byPlayer[player] = teams[seat] as number;
  });
  return byPlayer;
}

/** How a match's teams sat, and how it ended. */
interface TeamLayout {
  /** Mean distance between a team's islands, by team, in tiles. */
  spread: number[];
  winners: number[];
  byElimination: boolean;
  rounds: number;
}

/**
 * How far apart each team's islands are. Random seating can put teammates side by side
 * one match and across the map the next; on a map with every position symmetric that
 * should not decide anything, and this is how to see whether it does.
 */
function teamLayout(state: MatchState): TeamLayout {
  const centre = state.players.map((p) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < state.islandId.length; i++) {
      if (state.islandId[i] !== p.islandId) continue;
      sx += i % state.width;
      sy += Math.floor(i / state.width);
      n++;
    }
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
  });
  const teams = [...new Set(state.players.map((p) => p.team))].sort((a, b) => a - b);
  const spread = teams.map((team) => {
    const members = state.players.filter((p) => p.team === team).map((p) => centre[p.id]!);
    let total = 0;
    let pairs = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        total += Math.hypot(members[a]!.x - members[b]!.x, members[a]!.y - members[b]!.y);
        pairs++;
      }
    }
    return pairs === 0 ? 0 : total / pairs;
  });
  const winners = [...new Set(state.winners.map((id) => state.players[id]!.team))];
  return { spread, winners, byElimination: state.endedBy === 'elimination', rounds: state.round };
}

function summariseTeams(layouts: TeamLayout[]): void {
  console.log('\nteams:');
  const teamCount = layouts[0]?.spread.length ?? 0;
  for (let team = 0; team < teamCount; team++) {
    const won = layouts.filter((l) => l.winners.length === 1 && l.winners[0] === team).length;
    console.log(`  team ${String.fromCharCode(65 + team)} won ${won} of ${layouts.length}`);
  }
  const shared = layouts.filter((l) => l.winners.length !== 1).length;
  if (shared > 0) console.log(`  shared or drawn ${shared}`);

  const eliminated = layouts.filter((l) => l.byElimination).length;
  const rounds = layouts.reduce((sum, l) => sum + l.rounds, 0) / layouts.length;
  console.log(`  ${eliminated} ended by elimination; ${rounds.toFixed(1)} rounds on average`);

  // Where one team sat more tightly than another, did that help? Relative to the match's
  // own geometry — island size, and so every distance, changes from seed to seed — a team
  // is more compact if its spread is under 90% of the widest team's.
  const uneven = layouts.filter((l) => Math.min(...l.spread) < 0.9 * Math.max(...l.spread));
  const compactWon = uneven.filter(
    (l) => l.winners.length === 1 && l.spread[l.winners[0]!]! === Math.min(...l.spread),
  ).length;
  if (uneven.length > 0) {
    const fair = (1 / teamCount) * uneven.length;
    console.log(
      `  where teams sat unevenly (${uneven.length} matches), the most compact won ${compactWon}` +
        ` — ${fair.toFixed(1)} if it made no difference`,
    );
  }
  if (uneven.length < layouts.length) {
    console.log(`  ${layouts.length - uneven.length} matches seated every team alike`);
  }
}

// -------------------------------------------------------------------------- run

// Whole tournaments by rolls (ARCHIVE 13w): flags of their own, and no match is run.
if (process.argv[2] === '--tournament') {
  runTournaments(process.argv.slice(2), loadConfigBundle(repoRoot));
  process.exit(0);
}

const bundle = loadConfigBundle(repoRoot);
const args = parseArgs(process.argv.slice(2));
bundle.ruleset = withOverrides(bundle.ruleset, args.set);

const problems = validateConfigBundle(bundle);
if (problems.length > 0) {
  console.error(`configuration is invalid:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

if (args.replay.length > 0) {
  const rows = replayAll(bundle, args.replay);
  if (args.stats !== null) {
    writeFileSync(args.stats, statsCsv(rows), 'utf8');
    console.log(`\n${rows.length} row(s) written to ${args.stats}`);
  }
  summariseStats(rows);
  process.exit(0);
}

if (args.map) {
  // `--teams 2` shows the map a table of teams of two plays on: a ring at six.
  const map = generateTerrain(bundle.terrain, args.players, args.seed, args.teams);
  const structure = new Uint8Array(map.width * map.height);
  for (const castle of map.castles) {
    for (let oy = 0; oy < castle.h; oy++) {
      for (let ox = 0; ox < castle.w; ox++) {
        structure[(castle.y + oy) * map.width + castle.x + ox] = 2;
      }
    }
  }
  console.log(
    `${args.players}p seed ${args.seed} — areas ${map.islandAreas.join('/')}, ` +
      `${map.width}x${map.height}, ${map.attempts} attempt(s)`,
  );
  console.log(renderAscii({ ...map, structure }));
  process.exit(0);
}

/** The rules for a seat's bot: the config's, with its minimum of guns as the flags set it. */
function seatAi(p: number): AiConfig {
  const planning = { ...bundle.ai.planning };
  if (args.minGuns !== null) planning.minGuns = args.minGuns[p % args.minGuns.length] as number;
  if (args.failOnPurpose !== null) {
    planning.failsOnPurpose = args.failOnPurpose[p % args.failOnPurpose.length] as boolean;
  }
  return { ...bundle.ai, planning };
}

/** Whether a seat's bot plays its build phases out in advance (ARCHIVE 13zf). */
function seatPlans(p: number): boolean {
  return args.plans[p % args.plans.length] === true;
}

/** Who sits in each seat — a level and a personality — repeating the lists as needed. */
function seatSetup(p: number, seed: number): BotSetup {
  const personality = args.personalities[p % args.personalities.length] as Personality | 'dealt';
  return {
    level: args.levels[p % args.levels.length] as number,
    // Every seat a bot's, so the table is dealt as a match of bots alone is.
    personality:
      personality === 'dealt'
        ? (dealPersonalities(seed, new Array<boolean>(args.players).fill(true))[p] as Personality)
        : personality,
  };
}
/** The tower a seat brings, when the matches play them: `random` drawn as a match draws it. */
function seatTower(p: number, seed: number): TowerVariant | null {
  if (!args.specials) return null;
  const tower = args.towers[p % args.towers.length] as TowerVariant | null | 'random';
  return tower === 'random' ? drawnSpecial(seed, p, ruleset.specials) : tower;
}

/**
 * How a seat is named in the output: `L5`, with a fixed personality after it, and its tower
 * where the matches play them — so a soak of one tower against none reads by seat.
 */
function seatLabel(p: number): string {
  const personality = args.personalities[p % args.personalities.length] as Personality | 'dealt';
  const level = `L${args.levels[p % args.levels.length]}${seatPlans(p) ? '+plan' : ''}`;
  const tower = args.specials ? ` ${args.towers[p % args.towers.length] ?? 'none'}` : '';
  if (personality === 'dealt') return `${level} dealt${tower}`;
  const words = personalityWords(personality);
  return (words === personalityWords(BALANCED) ? level : `${level} ${words}`) + tower;
}
const table = Array.from({ length: args.players }, (_, p) => seatLabel(p));

console.log(
  // No grid size here: it is measured from the island, which varies a little with the
  // seed, so there is no one figure to quote. `--map` prints each map's own.
  `running ${args.matches} match(es), ${args.players} bots (${table.join(', ')})\n`,
);

const capped =
  args.maxRounds === undefined
    ? bundle.ruleset
    : { ...bundle.ruleset, scoring: { ...bundle.ruleset.scoring, maxRounds: args.maxRounds } };
const ruleset = { ...capped, specials: { ...capped.specials, enabled: args.specials } };

const layouts: TeamLayout[] = [];
const started = Date.now();
const outcomes = new Map<string, number>();
const wins = new Map<string, number>();
const stats: StatRow[] = [];
const matchOutcomes: MatchOutcome[] = [];
let refusedTotal = 0;
let totalTicks = 0;
let totalRounds = 0;
let unfinished = 0;
// The strategies planning bots chose, by kind, and the phases whose plan did not come true.
const chosenPlans = new Map<string, number>();
const noted = new Set<object>();
let diverged = 0;
let weighedTotal = 0;
let gaveUp = 0;
let hollowKept = 0;
let slips = 0;
let blunders = 0;
// The bots' time on each tick, all their turns together: what a room waits for.
const tickMs: number[] = [];

/** Writes a match as the server records one, every bot seat named by its level and personality. */
function recorderFor(state: MatchState, seed: number): MatchRecorder | null {
  if (args.record === null) return null;
  mkdirSync(args.record, { recursive: true });
  const id = `bots-${args.players}p-${seed}`;
  const file = join(args.record, `${id}.jsonl`);
  writeFileSync(file, '');
  return new MatchRecorder((line) => appendFileSync(file, `${JSON.stringify(line)}\n`), {
    id,
    source: 'local',
    startedAt: new Date().toISOString(),
    code: null,
    seed,
    ruleset: state.ruleset,
    terrain: bundle.terrain,
    players: state.players.map((p) => ({
      name: p.name,
      isBot: true,
      team: p.team,
      level: seatSetup(p.id, seed).level,
      personality: seatSetup(p.id, seed).personality,
      special: p.special,
    })),
  });
}

for (let i = 0; i < args.matches; i++) {
  const seed = args.seed + i;
  const state = createMatch({
    seed,
    ruleset,
    terrainConfig: bundle.terrain,
    players: teamSeating(seed, args.players, args.teams).map((team, p) => ({
      name: `${seatLabel(p)} ${p}`,
      isBot: true,
      team,
      special: seatTower(p, seed),
    })),
  });
  const rng = new Rng(seed);
  const slots = new PlanningSlots(
    bundle.ai.plansPerTick,
    args.planSteps ?? bundle.ai.planning.stepsPerTick,
  );
  const bots = state.players.map(
    (p) =>
      new Bot(p.id, seatSetup(p.id, seed), seatAi(p.id), slots, {
        plansAhead: seatPlans(p.id),
        ...(args.planSet === null ? {} : { planStrategies: args.planSet }),
      }),
  );
  let refused = 0;

  const sampler = new RoundStats(bundle, `sim-${seed}`, seed, (p) => seatSetup(p, seed));
  const recorder = recorderFor(state, seed);

  while (state.phase !== 'game_over' && state.tick < args.maxTicks) {
    const before = state.phase;
    const thinking = performance.now();
    const tick = state.tick;
    const applied: Action[] = [];
    for (const turn of takeBotTurns(state, rng, (player) => bots[player])) {
      if (turn.rejection !== null) refused++;
      else applied.push(turn.action);
    }
    tickMs.push(performance.now() - thinking);
    if (before === 'intermission' && state.pendingPhase === 'build') {
      for (const bot of bots) {
        const plan = bot.lastPlan;
        if (plan === null || noted.has(plan)) continue;
        noted.add(plan);
        weighedTotal += plan.weighed.length;
        chosenPlans.set(plan.name, (chosenPlans.get(plan.name) ?? 0) + 1);
        if (args.planLog !== null) {
          const player = bots.indexOf(bot);
          appendFileSync(
            args.planLog,
            `${JSON.stringify({ seed, round: state.round, player, level: seatSetup(player, seed).level, players: args.players, chosen: plan.name, weighed: plan.weighed })}\n`,
          );
        }
      }
    }
    step(state);
    recorder?.stepped(tick, applied, state);
    const events = drainEvents(state);
    if (args.stats !== null) sampler.observe(state, events);
  }
  stats.push(...sampler.rows);
  for (const bot of bots) {
    diverged += bot.diverged;
    gaveUp += bot.gaveUp;
    hollowKept += bot.hollowKept;
    slips += bot.slips;
    blunders += bot.blunders;
  }
  if (refused > 0) refusedTotal += refused;

  if (args.teams > 1) layouts.push(teamLayout(state));
  const outcome = describeOutcome(state);
  outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  // A shared win counts for each player who shares it.
  for (const winner of state.phase === 'game_over' ? state.winners : []) {
    const label = seatLabel(winner);
    wins.set(label, (wins.get(label) ?? 0) + 1);
  }
  totalTicks += state.tick;
  totalRounds += state.round;
  if (state.phase !== 'game_over') unfinished++;

  const hash = hashMatchState(state);
  matchOutcomes.push(outcomeOf(`sim-${seed}`, state, (p) => seatSetup(p, seed), hash));

  console.log(
    `  seed ${String(seed).padStart(5)}  ${String(state.round).padStart(3)} rounds  ` +
      `${String(state.tick).padStart(6)} ticks  hash ${hash}  ${outcome}`,
  );
}

const elapsed = Date.now() - started;
console.log(
  `\n${args.matches} matches in ${elapsed}ms (${(elapsed / args.matches).toFixed(1)}ms each)`,
);
console.log(
  `average ${(totalRounds / args.matches).toFixed(1)} rounds, ${(totalTicks / args.matches).toFixed(0)} ticks`,
);
for (const [outcome, count] of [...outcomes].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${outcome}`);
}

if (layouts.length > 0) summariseTeams(layouts);

{
  const sorted = [...tickMs].sort((a, b) => a - b);
  const at = (q: number): string => (sorted[Math.floor(q * (sorted.length - 1))] ?? 0).toFixed(1);
  console.log(
    `\nbots' time a tick: p50 ${at(0.5)} ms, p99 ${at(0.99)} ms, p99.9 ${at(0.999)} ms, worst ${at(1)} ms`,
  );
}

if (chosenPlans.size > 0) {
  const phases = [...chosenPlans.values()].reduce((a, b) => a + b, 0);
  console.log(
    `\nplans chosen, ${(weighedTotal / phases).toFixed(1)} strategies weighed a phase ` +
      `(${diverged} phase(s) went otherwise than planned, ${gaveUp} round(s) given up, ` +
      `${hollowKept} hollow seal(s) kept, ${slips} slip(s), ${blunders} blunder(s)):`,
  );
  for (const [name, count] of [...chosenPlans].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${name}`);
  }
}

// Only meaningful with a mixed table; with one kind of seat it is a seat count, worth
// seeing anyway because a symmetric map is supposed to make it a flat one.
if (new Set(table).size > 1) {
  console.log('\nwins by seat:');
  for (const label of new Set(table)) {
    const seats = table.filter((t) => t === label).length;
    console.log(
      `  ${label.padEnd(12)} ${String(wins.get(label) ?? 0).padStart(3)} (${seats} seat(s))`,
    );
  }
}

if (args.stats !== null) {
  writeFileSync(args.stats, statsCsv(stats), 'utf8');
  summariseStats(stats);
  console.log(`\n${stats.length} row(s) written to ${args.stats}`);
}
if (args.outcomes !== null) writeFileSync(args.outcomes, outcomesCsv(matchOutcomes), 'utf8');

// A bot asking for something the rules refuse is a bug in the bot: everything it
// proposes is derived from the state it was just handed.
if (refusedTotal > 0) {
  console.error(`\n${refusedTotal} action(s) were refused by the rules`);
  process.exit(1);
}
if (unfinished > 0) {
  console.error(
    `\n${unfinished} match(es) did not finish within ${args.maxTicks} ticks. ` +
      `Two evenly matched defenders can hold each other off indefinitely.`,
  );
}
