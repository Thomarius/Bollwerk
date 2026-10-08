import { parseArgs as parseFlags } from 'node:util';

import { TOURNAMENT_LENGTHS, type ConfigBundle, type TournamentLength } from '@bollwerk/config';
import {
  HOST_TEAM,
  Progress,
  createTournament,
  hostHistory,
  rollHostMatch,
  stepsOf,
  teamLimits,
  type Save,
  type SettingLimits,
  type Step,
  type TournamentSettings,
} from '@bollwerk/tournament';

import { usageError, wholeNumber } from './cli.js';

/**
 * Whole tournaments played by rolls alone, the host's matches too as if the host were a
 * bot of `--host-level` (TOURNAMENT T1): one prints its shape and the host's road, many
 * print how often the host goes how far. For checking a tournament's shape, and for
 * calibrating the level ratings (T2).
 */

const USAGE =
  'usage: npm start -w @bollwerk/headless -- --tournament [--count N] [--seed N] ' +
  '[--team-size 1-4] [--length short|medium|long] [--league] [--double] [--teams MIN-MAX] ' +
  '[--levels MIN-MAX] [--archnemesis] [--host-level 1-10]';

const FLAGS = {
  tournament: { type: 'boolean' },
  count: { type: 'string' },
  seed: { type: 'string' },
  'team-size': { type: 'string' },
  length: { type: 'string' },
  league: { type: 'boolean' },
  double: { type: 'boolean' },
  teams: { type: 'string' },
  levels: { type: 'string' },
  archnemesis: { type: 'boolean' },
  'host-level': { type: 'string' },
  help: { type: 'boolean' },
} as const;

function range(flag: string, value: string): { min: number; max: number } {
  const [min, max = min] = value.split('-').map((part) => wholeNumber(flag, part, 1));
  if (min === undefined || max === undefined || min > max) {
    usageError(`--${flag} wants MIN-MAX, not "${value}"`);
  }
  return { min, max };
}

export function runTournaments(argv: string[], bundle: ConfigBundle): void {
  let values: ReturnType<typeof parseFlags<{ options: typeof FLAGS }>>['values'];
  try {
    values = parseFlags({ args: argv, options: FLAGS, strict: true }).values;
  } catch (error) {
    usageError(`${(error as Error).message}\n${USAGE}`);
  }
  if (values.help === true) {
    console.log(USAGE);
    return;
  }
  const length = (values.length ?? 'medium') as TournamentLength;
  if (!TOURNAMENT_LENGTHS.includes(length)) usageError(`--length wants short, medium or long`);
  const teamSize = wholeNumber('team-size', values['team-size'] ?? '1', 1);
  const limits: SettingLimits = {
    players: bundle.ruleset.players,
    teamSize: bundle.server.lobbySettings.teamSize,
    maxRounds: bundle.tournament.maxRounds,
    continues: bundle.server.lobbySettings.continues,
  };
  const widest = teamLimits(teamSize, limits.players);
  if (widest === null) usageError(`no match can be played in teams of ${teamSize}`);
  const count = wholeNumber('count', values.count ?? '1', 1);
  const firstSeed = wholeNumber('seed', values.seed ?? '1');
  const hostLevel = wholeNumber('host-level', values['host-level'] ?? '5', 1);
  const levels = range('levels', values.levels ?? '3-6');

  const settingsFor = (seed: number): TournamentSettings => ({
    seed,
    teamSize,
    hostName: 'Host',
    teamName: 'Host team',
    teamBots: Array.from({ length: teamSize - 1 }, (_, i) => ({
      name: `Mate ${i + 1}`,
      level: hostLevel,
    })),
    levels,
    archnemesis: values.archnemesis === true ? 'Nemesis' : null,
    length,
    league: values.league === true,
    knockout: values.double === true ? 'double' : 'single',
    matchTeams: values.teams === undefined ? widest : range('teams', values.teams),
    maxRounds: bundle.ruleset.scoring.maxRounds ?? limits.maxRounds.max,
  });

  const play = (seed: number): { save: Save; progress: Progress; ms: number } => {
    const started = performance.now();
    const save = createTournament(settingsFor(seed), bundle.tournament, limits, {
      id: `headless-${seed}`,
      now: new Date().toISOString(),
    });
    let progress = new Progress(save);
    while (progress.status.kind === 'playing') {
      progress = rollHostMatch(save, bundle.tournament, hostLevel);
    }
    return { save, progress, ms: performance.now() - started };
  };

  if (count === 1) {
    const { save, progress, ms } = play(firstSeed);
    printOne(save, progress, ms);
    return;
  }

  let won = 0;
  let matches = 0;
  let ms = 0;
  const outBy = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const result = play(firstSeed + i);
    ms += result.ms;
    matches += hostHistory(result.save).length;
    if (result.progress.status.kind === 'won') won++;
    else if (result.progress.status.kind === 'out') {
      const step = stepsOf(result.save)[result.progress.status.step] as Step;
      const where = stepName(step, result.save);
      outBy.set(where, (outBy.get(where) ?? 0) + 1);
    }
  }
  const settings = settingsFor(firstSeed);
  console.log(
    `${count} ${length} tournaments, teams of ${teamSize}, ${settings.matchTeams.min}-${settings.matchTeams.max} ` +
      `teams a match, ${settings.league ? 'a league, ' : ''}${settings.knockout} elimination, ` +
      `opponents L${levels.min}-${levels.max}, the host as L${hostLevel}`,
  );
  console.log(`  won ${won} (${((100 * won) / count).toFixed(1)}%)`);
  console.log(`  matches played by the host, mean ${(matches / count).toFixed(2)}`);
  for (const [where, n] of [...outBy].sort((a, b) => b[1] - a[1])) {
    console.log(`  out at ${where}: ${n}`);
  }
  console.log(`  ${(ms / count).toFixed(1)} ms a tournament`);
}

function stepName(step: Step, save: Save): string {
  switch (step.kind) {
    case 'league':
      return 'the league';
    case 'knockout': {
      const fromEnd = save.plan.rounds.length - 1 - step.round;
      const final = save.settings.knockout === 'double' ? 'winners final' : 'final';
      return fromEnd === 0 ? final : `knockout round ${step.round + 1}`;
    }
    case 'losers':
      return `losers round ${step.round + 1}`;
    case 'final':
      return 'final';
  }
}

function printOne(save: Save, progress: Progress, ms: number): void {
  const { plan, teams } = save;
  console.log(
    `${teams.length} teams; the knockout ${plan.advance}, rounds of ${plan.rounds.join(', ')} teams` +
      (plan.losers.length > 0
        ? `; the losers' bracket ${plan.losers.map((l) => `${l.size}@${l.after + 1}`).join(', ')}`
        : '') +
      (plan.matchdays.length > 0 ? `; ${plan.matchdays.length} league matchdays` : ''),
  );
  const describe = (id: number): string => {
    const team = teams[id];
    if (team === undefined) return `#${id}`;
    const levels = team.members.map((m) => (m.level === null ? 'host' : `L${m.level}`)).join('+');
    return `${team.name}${team.archnemesis ? ' (archnemesis)' : ''} [${levels}]`;
  };
  console.log(`the host's team: ${describe(HOST_TEAM)}`);
  for (const { step, kind, match } of hostHistory(save)) {
    const place = match.order.indexOf(HOST_TEAM) + 1;
    const others = match.teams.filter((t) => t !== HOST_TEAM).map(describe);
    console.log(
      `  step ${step + 1}, ${stepName(kind, save)}: place ${place} of ${match.teams.length}, against ${others.join(', ')}`,
    );
  }
  if (progress.status.kind === 'won') console.log('won the tournament');
  else if (progress.status.kind === 'out') {
    const winner = progress.winner;
    console.log(
      `out; ${winner === null ? 'the tournament goes on without them' : `won by ${describe(winner)}`}`,
    );
  }
  if (plan.matchdays.length > 0) {
    const table = progress.table().slice(0, 5);
    console.log(
      `the league's top five: ${table.map((r) => `${describe(r.team)} ${r.points} (${r.buchholz})`).join('; ')}`,
    );
  }
  console.log(
    `${ms.toFixed(1)} ms, a save of ${(JSON.stringify(save).length / 1024).toFixed(0)} KB`,
  );
}
