import { z } from 'zod';

import { MAX_LEVEL } from './ai.js';

/**
 * Tournament mode (docs/TOURNAMENT.md): how long each length runs, how large a field may
 * grow, how strong each level counts in a quick roll, and the names teams and bots are
 * given. The host's choices are not here — they travel in the tournament's save.
 */

const LengthSchema = z.strictObject({
  /** League matchdays, when the tournament has a league stage. */
  leagueMatchdays: z.number().int().min(1),
  /** Knockout rounds a team that never loses plays, the final included. */
  knockoutRounds: z.number().int().min(1),
});

/** Names, each used once in a tournament; trimmed and unique, or the schema refuses them. */
const NamePoolSchema = z
  .array(z.string().trim().min(1).max(16))
  .min(1)
  .refine((names) => new Set(names).size === names.length, { message: 'names must be unique' });

export const TournamentConfigSchema = z.strictObject({
  lengths: z.strictObject({ short: LengthSchema, medium: LengthSchema, long: LengthSchema }),
  /**
   * The league's field as a multiple of the knockout's: the top of the table goes through,
   * so 2 means half the league goes home after it.
   */
  leagueFactor: z.number().int().min(1),
  /**
   * The largest knockout field: the product of the round sizes is brought under it by
   * lowering the largest, never below the minimum match size (TOURNAMENT §1.3).
   */
  maxField: z.number().int().min(2),
  /**
   * Each level's strength in a quick roll, Level 1 first: a team counts the sum of its
   * members', and places are drawn in proportion to it (Plackett–Luce, TOURNAMENT §1.6).
   * Linear on purpose, the user's choice (2026-10-08): fitted to the soak's ladder they ran
   * from 1 to 414, the cliff from Level 4 to 5 a factor of eight, and a roll should feel
   * like a contest rather than replay the bots' real gaps.
   */
  levelRatings: z.array(z.number().positive()).length(MAX_LEVEL),
  names: z.strictObject({
    /** Bots: given names that read well in most countries, in every language alike. */
    players: NamePoolSchema,
    /** Teams of two or more; a team of one goes by its player's name. */
    teams: NamePoolSchema,
  }),
});
export type TournamentConfig = z.infer<typeof TournamentConfigSchema>;
export type TournamentLength = keyof TournamentConfig['lengths'];
export const TOURNAMENT_LENGTHS = [
  'short',
  'medium',
  'long',
] as const satisfies readonly TournamentLength[];
