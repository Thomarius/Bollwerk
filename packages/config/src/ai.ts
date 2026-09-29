import { z } from 'zod';

/**
 * The tier names seats were set by before skill and personality were split (PLAN 11.6).
 * Each now stands for a level and a personality (`tierSetup`); the lobby moves to levels
 * in the next step, and these go with it.
 */
export const DifficultySchema = z.enum(['recruit', 'gunner', 'marshal', 'baron']);
export type DifficultyName = z.infer<typeof DifficultySchema>;

/** Skill levels, 1 to 10, as the lobby offers them. */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

/**
 * Skill: how well a bot plays, not how — pace, aim, judgement and care, in human units.
 *
 * Rates are milliseconds between actions rather than per-tick probabilities: a
 * probability is opaque, does not survive a change to the tick rate or a phase length,
 * and cannot be compared against what a person actually manages. These can.
 */
export const SkillSchema = z.strictObject({
  /**
   * Time to place a piece, as `base + perCell * cells`. Placement slows with piece
   * complexity because a larger shape takes longer to fit — which is why a human's rate
   * falls from roughly 25 pieces a build phase early to 15 late, as the size bands widen.
   */
  placementBaseMs: z.number().int().nonnegative(),
  placementPerCellMs: z.number().int().nonnegative(),
  /** Time between shots. Clicking is fast, so this is small; the reload is the real limit. */
  fireIntervalMs: z.number().int().nonnegative(),
  /** Chance of shooting somewhere other than the opponent's weakest point. */
  aimJitter: z.number().min(0).max(1),
  /**
   * Judgement of what can be finished. A plan is attempted when its cost fits inside the
   * pieces the bot can still lay this phase, times this (and the risk trait's scale).
   * Below 1 it insists on slack; above 1 it gambles on finishing.
   */
  riskMargin: z.number().positive(),
  /** Ticks between recomputing the plan. */
  replanTicks: z.number().int().positive(),
  /**
   * Mistakes, as a hurried person makes them: the chance of taking a worse fit for a
   * piece, and while any, a castle and gun spots chosen carelessly. Players like to see a
   * bot slip.
   */
  sloppiness: z.number().min(0).max(1),
});
export type Skill = z.infer<typeof SkillSchema>;

/** One anchor of the level table; levels between anchors are interpolated. */
export const SkillAnchorSchema = SkillSchema.extend({
  level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
});
export type SkillAnchor = z.infer<typeof SkillAnchorSchema>;

export const RiskValues = ['defensive', 'balanced', 'offensive'] as const;
export type Risk = (typeof RiskValues)[number];

/** What a risk trait sets: how big a wall it reaches for, and how soon. */
export const RiskTraitSchema = z.strictObject({
  /** Most castles it will try to bring inside its walls. */
  maxCastles: z.number().int().min(1),
  /** Scales the skill's `riskMargin`: under 1 more cautious, over 1 bolder. */
  riskScale: z.number().positive(),
  /**
   * Whether thickening a wall is a build priority at all. A second layer makes a breach
   * take two shots, but it scores nothing.
   */
  thickens: z.boolean(),
  /**
   * Whether, once a castle is sealed, it reaches for the next one straight away —
   * whether or not this phase can close it — rather than only when it is affordable.
   */
  expandsWhenSealed: z.boolean(),
});
export type RiskTrait = z.infer<typeof RiskTraitSchema>;

/** Targeting values; point-maximizing, finisher and grudge join in phase 3 of 11.6. */
export const TargetingValues = ['strategic'] as const;
export type Targeting = (typeof TargetingValues)[number];

export const TargetingTraitSchema = z.strictObject({
  /** Share of aimed shots sent where this trait chooses; the rest by the neutral rule. */
  share: z.number().min(0).max(1),
});

/** Cannon-space values; max cannons and secondary join in phases 3 and 4 of 11.6. */
export const CannonValues = ['balanced'] as const;
export type CannonSpace = (typeof CannonValues)[number];

/** How a bot plays, which it is dealt rather than chosen: one value of each trait. */
export interface Personality {
  risk: Risk;
  targeting: Targeting;
  cannons: CannonSpace;
}

export const PersonalitySchema = z.strictObject({
  risk: z.enum(RiskValues),
  targeting: z.enum(TargetingValues),
  cannons: z.enum(CannonValues),
});

/** Today's play, the baseline every trait is measured against. */
export const BALANCED: Personality = {
  risk: 'balanced',
  targeting: 'strategic',
  cannons: 'balanced',
};

export const AiConfigSchema = z
  .strictObject({
    /** The level table's anchors, by level; at least Level 1 and Level 10. */
    levels: z.array(SkillAnchorSchema).min(2),
    risk: z.strictObject({
      defensive: RiskTraitSchema,
      balanced: RiskTraitSchema,
      offensive: RiskTraitSchema,
    }),
    targeting: z.strictObject({ strategic: TargetingTraitSchema }),
  })
  .refine(
    (ai) =>
      ai.levels.some((a) => a.level === MIN_LEVEL) && ai.levels.some((a) => a.level === MAX_LEVEL),
    { message: `the level table must anchor Level ${MIN_LEVEL} and Level ${MAX_LEVEL}` },
  )
  .refine((ai) => new Set(ai.levels.map((a) => a.level)).size === ai.levels.length, {
    message: 'each level may be anchored once',
  });
export type AiConfig = z.infer<typeof AiConfigSchema>;

/**
 * A level's skill: an anchor's own values, or interpolated between the anchors either
 * side, so the table is tuned by editing a few rows. Whole-number fields are rounded.
 */
export function skillAt(ai: AiConfig, level: number): Skill {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
  const anchors = [...ai.levels].sort((a, b) => a.level - b.level);
  const exact = anchors.find((a) => a.level === clamped);
  const strip = ({ level: _level, ...skill }: SkillAnchor): Skill => skill;
  if (exact !== undefined) return strip(exact);
  const below = [...anchors].reverse().find((a) => a.level < clamped) as SkillAnchor;
  const above = anchors.find((a) => a.level > clamped) as SkillAnchor;
  const t = (clamped - below.level) / (above.level - below.level);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  const whole = (a: number, b: number): number => Math.round(mix(a, b));
  return {
    placementBaseMs: whole(below.placementBaseMs, above.placementBaseMs),
    placementPerCellMs: whole(below.placementPerCellMs, above.placementPerCellMs),
    fireIntervalMs: whole(below.fireIntervalMs, above.fireIntervalMs),
    aimJitter: mix(below.aimJitter, above.aimJitter),
    riskMargin: mix(below.riskMargin, above.riskMargin),
    replanTicks: whole(below.replanTicks, above.replanTicks),
    sloppiness: mix(below.sloppiness, above.sloppiness),
  };
}

/** What a bot is built from: how well it plays, and how. */
export interface BotSetup {
  level: number;
  personality: Personality;
}

/** Everything a bot reads while it plays: a level's skill under a personality. */
export interface BotProfile extends Skill {
  maxCastles: number;
  thickens: boolean;
  expandsWhenSealed: boolean;
  /** Whether it fires at the strongest opponent rather than one at random. */
  picksTarget: boolean;
  /** Share of aimed shots its targeting trait decides. */
  targetShare: number;
}

export function botProfile(ai: AiConfig, setup: BotSetup): BotProfile {
  const skill = skillAt(ai, setup.level);
  const risk = ai.risk[setup.personality.risk];
  return {
    ...skill,
    riskMargin: skill.riskMargin * risk.riskScale,
    maxCastles: risk.maxCastles,
    thickens: risk.thickens,
    expandsWhenSealed: risk.expandsWhenSealed,
    picksTarget: true,
    targetShare: ai.targeting[setup.personality.targeting].share,
  };
}

/**
 * What each old tier name stands for now: recruit about Level 2, gunner Level 5, marshal
 * Level 8, all balanced; baron marshal's skill with offensive risk, which is its old
 * profile exactly.
 */
export function tierSetup(tier: DifficultyName): BotSetup {
  switch (tier) {
    case 'recruit':
      return { level: 2, personality: BALANCED };
    case 'gunner':
      return { level: 5, personality: BALANCED };
    case 'marshal':
      return { level: 8, personality: BALANCED };
    case 'baron':
      return { level: 8, personality: { ...BALANCED, risk: 'offensive' } };
  }
}
