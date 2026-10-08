import { LevelSchema, PersonalitySchema } from '@bollwerk/config';
import { z } from 'zod';

import { TournamentSettingsSchema } from './settings.js';

/**
 * A tournament as it is saved, and as the rest of the package reads it: the settings, the
 * field, the plan fixed at creation, and every finished step's results. Everything else —
 * the table, the bracket, who is out, the next match — is derived from these (`Progress`).
 *
 * Rolled results are stored rather than rolled again on loading, so a later change to the
 * ratings or the roll cannot rewrite a tournament's history under its player.
 */

/** Bumped on any change a save from before could not be read by: such saves are only deleted. */
export const SAVE_VERSION = 1;

export const MemberSchema = z.strictObject({
  name: z.string(),
  /** Null for the host, the one person whose seat every match has. */
  level: LevelSchema.nullable(),
  personality: PersonalitySchema.nullable(),
});
export type Member = z.infer<typeof MemberSchema>;

export const TeamSchema = z.strictObject({
  name: z.string(),
  /** In seat order; a team's first member leads it. */
  members: z.array(MemberSchema).min(1),
  /** The team the archnemesis leads. */
  archnemesis: z.boolean(),
});
export type Team = z.infer<typeof TeamSchema>;

export const MatchRecordSchema = z.strictObject({
  /** The teams that met, by id, in the bracket's order. */
  teams: z.array(z.number().int().nonnegative()).min(2),
  /** The same teams, best placed first. */
  order: z.array(z.number().int().nonnegative()).min(2),
  /** Team scores, as `order`, for a match that was played; null for a rolled one. */
  scores: z.array(z.number().int()).nullable(),
});
export type MatchRecord = z.infer<typeof MatchRecordSchema>;

export const StepRecordSchema = z.strictObject({
  matches: z.array(MatchRecordSchema),
  /** Teams of the losers' bracket that went through without playing. */
  byes: z.array(z.number().int().nonnegative()),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export const LoserRoundSchema = z.strictObject({
  /** The winners' bracket round, 0-based, whose losers have joined the pool by then. */
  after: z.number().int().nonnegative(),
  /** Teams in each of its matches. */
  size: z.number().int().min(2),
});
export type LoserRound = z.infer<typeof LoserRoundSchema>;

export const PlanSchema = z.strictObject({
  /** The league: by matchday, its matches as team ids. Empty without a league. */
  matchdays: z.array(z.array(z.array(z.number().int().nonnegative()))),
  /** Teams in the knockout: the product of `rounds`. */
  advance: z.number().int().min(2),
  /** Teams in each match of each knockout round, the first round first. */
  rounds: z.array(z.number().int().min(2)).min(1),
  /** The losers' bracket of double elimination, in order; empty for single. */
  losers: z.array(LoserRoundSchema),
  /** The knockout's draw without a league, best seed first; null when the league seeds it. */
  draw: z.array(z.number().int().nonnegative()).nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const SaveSchema = z.strictObject({
  version: z.literal(SAVE_VERSION),
  id: z.string().min(1),
  /** ISO dates, for the resume list; the only clock a tournament reads. */
  createdAt: z.string(),
  playedAt: z.string(),
  settings: TournamentSettingsSchema,
  /** The field, by id. Team 0 is the host's. */
  teams: z.array(TeamSchema).min(2),
  plan: PlanSchema,
  /** Every finished step, in order. A step is finished whole or not at all. */
  steps: z.array(StepRecordSchema),
});
export type Save = z.infer<typeof SaveSchema>;

/** The host's team, always team 0. */
export const HOST_TEAM = 0;

export type ParsedSave = { ok: true; save: Save } | { ok: false; reason: 'version' | 'invalid' };

/**
 * A save read back from storage. One of another version is told apart from a damaged
 * one, since the resume list offers the first for deletion with an explanation.
 */
export function parseSave(raw: unknown): ParsedSave {
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version !== SAVE_VERSION)
    return { ok: false, reason: 'version' };
  const parsed = SaveSchema.safeParse(raw);
  return parsed.success ? { ok: true, save: parsed.data } : { ok: false, reason: 'invalid' };
}
