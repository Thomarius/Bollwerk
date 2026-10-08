import { LevelSchema, MAX_LEVEL, TOURNAMENT_LENGTHS } from '@bollwerk/config';
import { z } from 'zod';

/**
 * What the host chooses as a tournament is made (TOURNAMENT §1.2), fixed for its whole
 * length. The choices that are not settings on purpose — league points, tie-breaks, the
 * field's size — follow from these and the tournament config.
 */

const NameSchema = z.string().trim().min(1).max(24);
const RangeSchema = z.strictObject({ min: z.number().int(), max: z.number().int() });

export const TournamentSettingsSchema = z.strictObject({
  /** Every draw of the tournament comes from streams of this seed (TOURNAMENT §1.1). */
  seed: z.number().int().nonnegative().max(0xffffffff),
  teamSize: z.number().int().min(1),
  /** The host's own name, which their seat carries in every match. */
  hostName: NameSchema,
  /** The host's team; at team size 1 the team goes by the host's name instead. */
  teamName: NameSchema,
  /** One for each seat of the host's team beyond the host's, in seat order. */
  teamBots: z.array(z.strictObject({ name: NameSchema, level: LevelSchema })),
  /** The levels opponents' bots are dealt, each uniformly in the range. */
  levels: z.strictObject({ min: LevelSchema, max: LevelSchema }),
  /** The archnemesis's name, or null for none: one bot a level above the range's top. */
  archnemesis: NameSchema.nullable(),
  length: z.enum(TOURNAMENT_LENGTHS),
  league: z.boolean(),
  knockout: z.enum(['single', 'double']),
  /** Teams a match, the knockout's double-elimination final excepted (TOURNAMENT §1.5). */
  matchTeams: RangeSchema,
  maxRounds: z.number().int().positive(),
  /**
   * Continues each player has in every match, lives less one. Optional: tournaments saved
   * before it was a setting (2026-10-08) play on the rules' own.
   */
  continues: z.number().int().nonnegative().optional(),
});
export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;

/** What the rules and the server allow, against which settings are checked. */
export interface SettingLimits {
  players: { min: number; max: number };
  teamSize: { min: number; max: number };
  maxRounds: { min: number; max: number };
  continues: { min: number; max: number };
}

/**
 * The teams a match may hold at a team size: at least two, and seats for all within the
 * player limits. Null when the size allows no match at all.
 */
export function teamLimits(
  teamSize: number,
  players: { min: number; max: number },
): { min: number; max: number } | null {
  const min = Math.max(2, Math.ceil(players.min / teamSize));
  const max = Math.floor(players.max / teamSize);
  return max >= min ? { min, max } : null;
}

/** Everything wrong with a tournament's settings, as text; empty when it can be made. */
export function settingsProblems(settings: TournamentSettings, limits: SettingLimits): string[] {
  const problems: string[] = [];
  const { teamSize, levels, matchTeams, maxRounds } = settings;
  if (teamSize < limits.teamSize.min || teamSize > limits.teamSize.max) {
    problems.push(`team size ${teamSize} is outside ${limits.teamSize.min}-${limits.teamSize.max}`);
  }
  if (settings.teamBots.length !== teamSize - 1) {
    problems.push(`a team of ${teamSize} needs ${teamSize - 1} team bots`);
  }
  if (levels.min > levels.max) problems.push('the level range is reversed');
  if (settings.archnemesis !== null && levels.max >= MAX_LEVEL) {
    problems.push(`an archnemesis needs a range topping out below Level ${MAX_LEVEL}`);
  }
  const teams = teamLimits(teamSize, limits.players);
  if (teams === null) {
    problems.push(`no match can be played in teams of ${teamSize}`);
  } else if (
    matchTeams.min < teams.min ||
    matchTeams.max > teams.max ||
    matchTeams.min > matchTeams.max
  ) {
    problems.push(`teams a match must be within ${teams.min}-${teams.max}`);
  }
  if (maxRounds < limits.maxRounds.min || maxRounds > limits.maxRounds.max) {
    problems.push(`rounds a match must be within ${limits.maxRounds.min}-${limits.maxRounds.max}`);
  }
  const { continues } = settings;
  if (
    continues !== undefined &&
    (continues < limits.continues.min || continues > limits.continues.max)
  ) {
    problems.push(`continues must be within ${limits.continues.min}-${limits.continues.max}`);
  }
  return problems;
}
