import type { TournamentConfig } from '@bollwerk/config';
import { streamFor } from '@bollwerk/sim';

import { drawLeague, knockoutSizes, loserRounds, product } from './plan.js';
import { settle } from './progress.js';
import { createTeams } from './roster.js';
import { SAVE_VERSION, type Save } from './save.js';
import { settingsProblems, type SettingLimits, type TournamentSettings } from './settings.js';

/**
 * A new tournament, its whole schedule made at once (TOURNAMENT §1.1): the knockout's round
 * sizes and so its field, the league's field and every matchday, the losers' bracket, the
 * draw, and every team. Throws on settings that cannot make one; the menu never sends such.
 */
export function createTournament(
  settings: TournamentSettings,
  config: TournamentConfig,
  limits: SettingLimits,
  meta: { id: string; now: string },
): Save {
  const problems = settingsProblems(settings, limits);
  if (problems.length > 0) throw new Error(`cannot make this tournament: ${problems.join('; ')}`);
  const { seed, matchTeams } = settings;
  const length = config.lengths[settings.length];

  const rounds = knockoutSizes(
    streamFor(seed, 'knockout'),
    length.knockoutRounds,
    matchTeams,
    config.maxField,
  );
  const advance = product(rounds);
  // Every knockout size divides the league's field, so each matchday has one that fits.
  const field = settings.league ? advance * config.leagueFactor : advance;
  const ids = Array.from({ length: field }, (_, id) => id);

  const save: Save = {
    version: SAVE_VERSION,
    id: meta.id,
    createdAt: meta.now,
    playedAt: meta.now,
    settings,
    teams: createTeams(settings, config, field),
    plan: {
      matchdays: settings.league
        ? drawLeague(streamFor(seed, 'league'), field, length.leagueMatchdays, matchTeams)
        : [],
      advance,
      rounds,
      losers:
        settings.knockout === 'double'
          ? loserRounds(streamFor(seed, 'losers'), rounds, matchTeams)
          : [],
      draw: settings.league ? null : streamFor(seed, 'draw').shuffle(ids),
    },
    steps: [],
  };
  settle(save, config);
  return save;
}
