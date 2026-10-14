import { z } from 'zod';

/**
 * The tier names seats were set by before skill and personality were split (PLAN 11.6).
 * Kept only to read recordings made before: each stands for a level and a personality
 * (`tierSetup`).
 */
export const DifficultySchema = z.enum(['recruit', 'gunner', 'marshal', 'baron']);
export type DifficultyName = z.infer<typeof DifficultySchema>;

/** Skill levels, 1 to 10, as the lobby offers them. */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const LevelSchema = z.number().int().min(MIN_LEVEL).max(MAX_LEVEL);

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
  /**
   * How long a gun stands ready before it is fired: a person's attention, which the reload
   * leaves free. Both testers' guns waited about 560 ms on average while they clicked every
   * 170-200 ms (ARCHIVE 13r), so this, not the clicking, sets how often each gun fires.
   */
  readyDelayMs: z.number().int().nonnegative(),
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
   * piece. Players like to see a bot slip.
   */
  sloppiness: z.number().min(0).max(1),
  /**
   * The chance that a castle, or the spot for a gun, is chosen carelessly — a castle at
   * random, a gun's place half by chance. The weightiest mistake a bot makes: a careless
   * Level 4 wins 64% against two that are not (2026-10-05), so it fades by level rather
   * than stopping at once, which made the step from Level 4 to 5 a cliff.
   */
  carelessness: z.number().min(0).max(1),
  /**
   * How many strategies it weighs for a build phase at most (ARCHIVE 13zf), in
   * `ai.planning.order`: how far ahead it thinks. Time may cut the search shorter.
   */
  planDepth: z.number().int().positive(),
  /**
   * The chance it takes another of its better plans that seal rather than the best: a
   * choice made under time pressure, as a person makes it.
   */
  planSlip: z.number().min(0).max(1),
  /**
   * The chance it takes a plan that fails the round — a repair not finished, a wall too
   * ambitious for the time — while its team has a life to spare. People do; a bot that
   * never did would be limited by its speed alone (the user, 2026-10-12).
   */
  planBlunder: z.number().min(0).max(1),
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
  /**
   * Defensive: once its castle is sealed, thicken first — until no way in takes fewer
   * than two shots, or no piece can thicken it further — and then reach for the next
   * castle straight away, whether or not this phase can close it.
   */
  expandsWhenSafe: z.boolean(),
  /**
   * Offensive: with a small breach, close it with a roomier wall than it had, widening
   * the ground it holds in the same repair, when that fits the pieces left this phase.
   */
  widensWhileRepairing: z.boolean(),
  /**
   * Which castle to open from, among those whose roomy wall costs little more than the
   * cheapest: the cheapest, the one with most castles near it to reach for, or the one
   * farthest from any opponent.
   */
  castleChoice: z.enum(['cheapest', 'central', 'sheltered']),
  /**
   * Once sealed, builds the most valuable wall it can finish this phase — the standing wall
   * pushed out to take in another castle, or a stretch of land beside it — before the rest
   * of the ladder (ARCHIVE 13zg, B).
   */
  widensWhenSealed: z.boolean(),
});
export type RiskTrait = z.infer<typeof RiskTraitSchema>;

/**
 * Targeting values: point-maximizing (`points`, the nearest opponent's walls, closest to
 * its own guns first), strategic (whoever earns most points a round), finisher (the
 * weakest opponent) and grudge (whoever hit it hardest last round).
 */
export const TargetingValues = ['points', 'strategic', 'finisher', 'grudge'] as const;
export type Targeting = (typeof TargetingValues)[number];

export const TargetingTraitSchema = z.strictObject({
  /** Share of aimed shots sent where this trait chooses; the rest by the neutral rule. */
  share: z.number().min(0).max(1),
});

/** Cannon-space values: max cannons, balanced, and secondary (cannon space comes second). */
export const CannonValues = ['max', 'balanced', 'secondary'] as const;
export type CannonSpace = (typeof CannonValues)[number];

/** What a cannon-space trait sets: how much room for guns a bot asks of its walls. */
export const CannonTraitSchema = z.strictObject({
  /**
   * The band of room asked for round each castle when planning a wall, in tiles. Without
   * it the planner returns the tightest wall that works, the one with no room for a gun.
   * Three, re-swept for the rectangular islands of ARCHIVE 10l: it was two on the wedge
   * map, where three bought room for fourteen cannons against a reward of three a round;
   * at two on rectangles marshal's room for another cannon fell to 1.8, and three took it
   * back to 7.3. Four was tried under points scoring (10s) and was badly worse — one win
   * in twelve, rounds forfeited 26% to 43%.
   */
  roomRadius: z.number().int().nonnegative(),
  /** Room asked for beyond the guns about to be earned, in guns. */
  roomMargin: z.number().int().nonnegative(),
  /** Whether a thin wall is thickened before room is sought. */
  thickenFirst: z.boolean(),
  /** Pockets — sealed ground with no castle (§1.3) — walled for guns, at most this many. */
  maxPockets: z.number().int().nonnegative(),
});
export type CannonTrait = z.infer<typeof CannonTraitSchema>;

/**
 * The features a placement is scored by, each a count of the piece's cells unless said:
 * on the plan, on the tightest repair, on the thickening targets, on the outer skin,
 * spilt inside the wall, on none of them; the plan's and the repair's cells again times
 * the urgency (the repair's cost over what the phase can still lay); and 1 when the
 * placement finishes the plan or the repair.
 */
export const FIT_FEATURES = [
  'plan',
  'planUrgent',
  'planCompletes',
  'tight',
  'tightUrgent',
  'tightCompletes',
  'thicken',
  'skin',
  'indoors',
  'waste',
] as const;
export type FitFeature = (typeof FIT_FEATURES)[number];

export const FitWeightsSchema = z.strictObject(
  Object.fromEntries(FIT_FEATURES.map((f) => [f, z.number()])) as Record<FitFeature, z.ZodNumber>,
);
export type FitWeights = Record<FitFeature, number>;

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

/** Every value of each trait, so a personality can be dealt or parsed. */
export const TRAIT_VALUES = {
  risk: RiskValues,
  targeting: TargetingValues,
  cannons: CannonValues,
} as const satisfies { [K in keyof Personality]: readonly Personality[K][] };

/** A personality in words, as the summary reveals it and recordings carry it. */
export function personalityWords(p: Personality): string {
  const targeting = p.targeting === 'points' ? 'point-maximizing' : p.targeting;
  return `${p.risk} · ${targeting} · ${p.cannons} cannons`;
}

/**
 * A personality from a short text — `offensive`, or `defensive-strategic-balanced` —
 * for fixing one in tests and soaks. Each word is a value of exactly one trait; traits not
 * named are balanced. Null if a word names nothing.
 */
export function parsePersonality(text: string): Personality | null {
  const out: Personality = { ...BALANCED };
  for (const word of text.split(/[-,\s]+/).filter((w) => w.length > 0)) {
    if (word === 'balanced') continue;
    const trait = (Object.keys(TRAIT_VALUES) as (keyof Personality)[]).find((k) =>
      (TRAIT_VALUES[k] as readonly string[]).includes(word),
    );
    if (trait === undefined) return null;
    (out as Record<keyof Personality, string>)[trait] = word;
  }
  return out;
}

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
    cannons: z.strictObject({
      max: CannonTraitSchema,
      balanced: CannonTraitSchema,
      secondary: CannonTraitSchema,
    }),
    targeting: z.strictObject({
      points: TargetingTraitSchema,
      strategic: TargetingTraitSchema,
      finisher: TargetingTraitSchema,
      grudge: TargetingTraitSchema,
    }),
    /**
     * Plans a table's bots may make on one tick between them (`PlanningSlots`): a wall's
     * plan, or a castle's choice. One costs about 5 ms; bots of one level are dealt the
     * same pieces at the same pace, so without a limit they all planned on the same ticks
     * — eight at once, 40 to 90 ms where a tick is 33 (2026-10-05). A bot finding none
     * left waits a tick.
     */
    plansPerTick: z.number().int().positive(),
    /**
     * Each build phase played out in advance for several strategies, the best kept
     * (ARCHIVE 13zf): searched in the intermission, a simulated piece at a time
     * within the table's budget, and ended at the bot's first piece, so the game never waits.
     */
    planning: z.strictObject({
      enabled: z.boolean(),
      /**
       * Simulated pieces a tick the table's bots share. A piece costs about 1.2 ms, at most
       * 33; at 8, eight Level 8 bots planning cost a tick what today's did (p99 14.6 ms
       * against 14.9), each weighing 11 strategies a phase; at 16 the worst tick rose to
       * 130-160 ms.
       */
      stepsPerTick: z.number().int().positive(),
      /**
       * The guns a plan should leave ready for the next barrage — firing, or a reward with
       * room — the user's minimum (2026-10-12): a plan reaching it is chosen over any that
       * does not. 0: no minimum.
       */
      minGuns: z.number().int().nonnegative(),
      /**
       * With no plan reaching `minGuns`, fail the round on purpose and spend a life — a
       * fresh castle, ring and the starting guns — while the team has one to spare, the
       * round is not the last, and nobody in the team is a person, whose lives they share.
       */
      failsOnPurpose: z.boolean(),
      /** The strategies tried first, most promising first; the rest follow as offered. */
      order: z.array(z.string().min(1)),
      /** What an outcome is worth beyond the round's points, in points (`scoreOf`). */
      weights: z.strictObject({
        /** Each gun ready for the next barrage: firing, or a reward with room to stand. */
        gun: z.number().nonnegative(),
        /** The best castle nearly sealed: the points it would add, times how nearly. */
        prospect: z.number().nonnegative(),
        /** A failed round: below anything that seals. */
        failure: z.number().positive(),
      }),
    }),
    /**
     * How much nearness counts when a bot picks whom to breach by threat: a rival twice as far
     * must be `2 ** this` times the threat. People shot mostly at their nearest rivals, and at
     * a far one only when it threatened most (ARCHIVE 13r). 0: distance does not count.
     */
    rivalDistanceExponent: z.number().nonnegative(),
    /**
     * How a bot misses as people do (PLAN §11 item 1, ARCHIVE 13r): the share of its shots that
     * go where it aimed, rising in a line from Level 1 to perfect, and the rest wasted as the
     * testers' were — on the tile its last shot went to, or a tile beside the wall it aimed at.
     */
    aim: z.strictObject({
      /** Its own accuracy at Level 1: the casual tester's was 61%, the good one's 77%. */
      accuracyAtLevel1: z.number().min(0).max(1),
      /** The level from which it never misses on its own. */
      perfectFromLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
      /** Of the shots that miss, the share fired again at the last shot's tile. */
      doubleShare: z.number().min(0).max(1),
      /** How recent the last shot must be for that: a person clicks twice in 150–300 ms. */
      doubleWithinMs: z.number().int().nonnegative(),
    }),
    /**
     * A learned scoring of where to lay the piece in hand (ARCHIVE 13zg, step 3):
     * a weight per feature of a placement, summed. Null: the hand-made fit, which covers
     * the first wall in the ladder's order that a piece reaches.
     */
    fitWeights: FitWeightsSchema.nullable(),
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
    readyDelayMs: whole(below.readyDelayMs, above.readyDelayMs),
    aimJitter: mix(below.aimJitter, above.aimJitter),
    riskMargin: mix(below.riskMargin, above.riskMargin),
    replanTicks: whole(below.replanTicks, above.replanTicks),
    sloppiness: mix(below.sloppiness, above.sloppiness),
    carelessness: mix(below.carelessness, above.carelessness),
    planDepth: whole(below.planDepth, above.planDepth),
    planSlip: mix(below.planSlip, above.planSlip),
    planBlunder: mix(below.planBlunder, above.planBlunder),
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
  /** Its targeting trait, and the share of aimed shots that trait decides. */
  targeting: Targeting;
  targetShare: number;
  expandsWhenSafe: boolean;
  widensWhileRepairing: boolean;
  castleChoice: RiskTrait['castleChoice'];
  widensWhenSealed: boolean;
  fitWeights: FitWeights | null;
  /** The share of its shots that go where it aimed (`aim`); the rest miss as people do. */
  ownAccuracy: number;
  doubleShare: number;
  doubleWithinMs: number;
  rivalDistanceExponent: number;
  roomRadius: number;
  roomMargin: number;
  thickenFirst: boolean;
  maxPockets: number;
}

/** A level's own accuracy: a line from Level 1's to 1 at `perfectFromLevel`, then 1. */
export function ownAccuracyAt(ai: AiConfig, level: number): number {
  const { accuracyAtLevel1, perfectFromLevel } = ai.aim;
  if (perfectFromLevel <= MIN_LEVEL) return 1;
  const t = (Math.round(level) - MIN_LEVEL) / (perfectFromLevel - MIN_LEVEL);
  return Math.min(1, accuracyAtLevel1 + (1 - accuracyAtLevel1) * Math.max(0, t));
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
    expandsWhenSafe: risk.expandsWhenSafe,
    widensWhileRepairing: risk.widensWhileRepairing,
    castleChoice: risk.castleChoice,
    widensWhenSealed: risk.widensWhenSealed,
    fitWeights: ai.fitWeights,
    ownAccuracy: ownAccuracyAt(ai, setup.level),
    doubleShare: ai.aim.doubleShare,
    doubleWithinMs: ai.aim.doubleWithinMs,
    rivalDistanceExponent: ai.rivalDistanceExponent,
    picksTarget: true,
    targeting: setup.personality.targeting,
    targetShare: ai.targeting[setup.personality.targeting].share,
    ...ai.cannons[setup.personality.cannons],
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
