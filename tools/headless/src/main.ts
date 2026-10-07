import { writeFileSync } from 'node:fs';
import { parseArgs as parseFlags } from 'node:util';

import {
  BALANCED,
  MAX_LEVEL,
  MIN_LEVEL,
  parsePersonality,
  personalityWords,
  validateConfigBundle,
  type BotSetup,
  type Personality,
} from '@bollwerk/config';
import { loadConfigBundle } from '@bollwerk/config/node';
import { Bot, PlanningSlots, dealPersonalities, takeBotTurns } from '@bollwerk/ai';
import {
  Rng,
  createMatch,
  drainEvents,
  generateTerrain,
  hashMatchState,
  renderAscii,
  seatOrder,
  step,
  type MatchState,
} from '@bollwerk/sim';

import { repoRoot, usageError, wholeNumber } from './cli.js';
import { replayAll } from './replay.js';
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
  stats: string | null;
  /** One row per match: who won, how it ended, the final scores (`MatchOutcome`). */
  outcomes: string | null;
  /** Players per team; 1 is free-for-all. Seats go into teams in order, then shuffle. */
  teams: number;
  /** Overrides `scoring.maxRounds`; undefined keeps the ruleset's, null lifts the cap. */
  maxRounds: number | null | undefined;
  /** Recordings to replay, files or directories of them, instead of running bots. */
  replay: string[];
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
  '[--personality offensive|dealt|...[,...]] [--stats FILE] [--outcomes FILE] [--map]\n' +
  '       npm start -w @bollwerk/headless -- --replay recordings/ [more files or dirs] [--stats FILE]';

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

/**
 * Each player's team, by player id, seated the way a room seats them: seats go into
 * teams in order, then which island each seat gets is shuffled from the seed.
 */
function teamSeating(seed: number, players: number, size: number): number[] {
  const order = seatOrder(seed, players);
  const byPlayer = new Array<number>(players).fill(0);
  order.forEach((player, seat) => {
    byPlayer[player] = size > 1 ? Math.floor(seat / size) : seat;
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

const args = parseArgs(process.argv.slice(2));
const bundle = loadConfigBundle(repoRoot);

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
  const map = generateTerrain(bundle.terrain, args.players, args.seed);
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
/** How a seat is named in the output: `L5`, with a fixed personality after it. */
function seatLabel(p: number): string {
  const personality = args.personalities[p % args.personalities.length] as Personality | 'dealt';
  const level = `L${args.levels[p % args.levels.length]}`;
  if (personality === 'dealt') return `${level} dealt`;
  const words = personalityWords(personality);
  return words === personalityWords(BALANCED) ? level : `${level} ${words}`;
}
const table = Array.from({ length: args.players }, (_, p) => seatLabel(p));

console.log(
  // No grid size here: it is measured from the island, which varies a little with the
  // seed, so there is no one figure to quote. `--map` prints each map's own.
  `running ${args.matches} match(es), ${args.players} bots (${table.join(', ')})\n`,
);

const ruleset =
  args.maxRounds === undefined
    ? bundle.ruleset
    : { ...bundle.ruleset, scoring: { ...bundle.ruleset.scoring, maxRounds: args.maxRounds } };

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
    })),
  });
  const rng = new Rng(seed);
  const slots = new PlanningSlots(bundle.ai.plansPerTick);
  const bots = state.players.map((p) => new Bot(p.id, seatSetup(p.id, seed), bundle.ai, slots));
  let refused = 0;

  const sampler = new RoundStats(bundle, `sim-${seed}`, seed, (p) => seatSetup(p, seed));

  while (state.phase !== 'game_over' && state.tick < args.maxTicks) {
    for (const turn of takeBotTurns(state, rng, (player) => bots[player])) {
      if (turn.rejection !== null) refused++;
    }
    step(state);
    const events = drainEvents(state);
    if (args.stats !== null) sampler.observe(state, events);
  }
  stats.push(...sampler.rows);
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
