import { z } from 'zod';

/** Shape of the crater a landed shot punches into a wall. */
export const CraterPatternSchema = z.enum(['single', 'plus5', 'square9']);
export type CraterPattern = z.infer<typeof CraterPatternSchema>;

const ms = z.number().int().nonnegative();

/** The special towers a player may bring (docs/SPECIAL_TOWERS.md), in their order everywhere. */
export const SPECIAL_KINDS = [
  'bertha',
  'architect',
  'rapid',
  'lightning',
  'biggest',
  'laser',
  'frost',
] as const;
export const SpecialKindSchema = z.enum(SPECIAL_KINDS);
export type SpecialKind = z.infer<typeof SpecialKindSchema>;

/**
 * What a tower may cost in cannons (the user's, 2026-10-16): every tower comes at two
 * costs, the dearer the stronger, and never at one — a tower is a trade of guns.
 */
export const TOWER_COSTS = [2, 3] as const;
export type TowerCost = (typeof TOWER_COSTS)[number];

/**
 * A tower at a cost — what a player brings to a match, named by both (`bertha3`), so a
 * loadout is one value on the wire, in a recording, a preference and a command line.
 */
export const TOWER_VARIANTS = [
  'bertha2',
  'bertha3',
  'architect2',
  'architect3',
  'rapid2',
  'rapid3',
  'lightning2',
  'lightning3',
  'biggest2',
  'biggest3',
  'laser2',
  'laser3',
  'frost2',
  'frost3',
] as const satisfies readonly `${SpecialKind}${TowerCost}`[];
export const TowerVariantSchema = z.enum(TOWER_VARIANTS);
export type TowerVariant = z.infer<typeof TowerVariantSchema>;

export function variantOf(kind: SpecialKind, cost: TowerCost): TowerVariant {
  return `${kind}${cost}` as TowerVariant;
}

export function variantKind(variant: TowerVariant): SpecialKind {
  return variant.slice(0, -1) as SpecialKind;
}

export function variantCost(variant: TowerVariant): TowerCost {
  return Number(variant.slice(-1)) as TowerCost;
}

const footprint = z.tuple([z.number().int().positive(), z.number().int().positive()]);

/** What every tower's variant has: its footprint and its flight against a gun's. */
const towerFields = {
  footprint,
  /**
   * A factor on a shot's flight time, which is its reload: below 1 fires more often.
   * Exactly 1 leaves the flight as an ordinary gun's, tick for tick.
   */
  flightFactor: z.number().positive(),
};

/**
 * A tower's variants by cost, `"2"` and `"3"`, each with its own levers. A variant left
 * out is not offered — a tower that cannot be balanced at one cost comes at the other.
 */
function byCost<T extends z.ZodType>(variant: T) {
  return z
    .strictObject({ '2': variant.optional(), '3': variant.optional() })
    .refine((v) => v['2'] !== undefined || v['3'] !== undefined, {
      message: 'a tower needs a variant at one cost at least',
    });
}

const BerthaSchema = z.strictObject({ ...towerFields, crater: CraterPatternSchema });
const ArchitectSchema = z.strictObject({
  ...towerFields,
  /** Tiles from its footprint's centre to a tile's centre: a circle (`inRepairReach`). */
  repairRadius: z.number().nonnegative(),
});
/** As many cannons on one footprint as it cost, a barrel each (`barrelsOf`). */
const RapidSchema = z.strictObject(towerFields);
/**
 * Strikes the tile aimed at on the instant, then jumps on to walls nearby (`strikeLightning`);
 * its reload is still an ordinary shot's flight to the tile aimed at, times `flightFactor`.
 */
const LightningSchema = z.strictObject({
  ...towerFields,
  /** Strikes after the first, each from the last; the balance's main lever (the user's). */
  jumps: z.number().int().nonnegative(),
  /** How far a jump reaches, in tiles from the last strike's centre to a tile's: a circle. */
  jumpRadius: z.number().positive(),
  /** The chance a jump strikes a tile at random in its reach rather than a wall. */
  missChance: z.number().min(0).max(1),
});

/**
 * The Allerdickste Bertha (2026-10-17, the user's): one enormous shell a combat phase, its
 * crater a circle. Its flight is fixed, whatever the distance — and the flight is the reload,
 * so a flight as long as the combat phase fires it once in each.
 */
const BiggestSchema = z.strictObject({
  footprint,
  /** The shell's flight, in milliseconds, near or far alike. */
  flightMs: z.number().int().positive(),
  /**
   * The crater: every tile whose centre is no farther than this from the tile aimed at, in
   * tiles — a circle, as the Architect's reach is (radius 3 clears 29 tiles, 4 clears 49).
   */
  craterRadius: z.number().nonnegative(),
});

/**
 * The Laser Tower (2026-10-21, the user's): a beam on the instant from the tower through the
 * tile aimed at and on to the map's edge, clearing the first `pierce` opponents' walls on its
 * line (`fireLaser`). Its reload is an ordinary shot's flight to the first wall it clears —
 * to the tile aimed at if it clears none — times `flightFactor`.
 */
const LaserSchema = z.strictObject({
  ...towerFields,
  /**
   * Walls the beam clears before it stops; the balance's lever. A fraction is the chance of
   * one more — 3.5 clears 3, and a fourth half the time (the user's).
   */
  pierce: z.number().positive(),
});

/**
 * The Frost Cannon (2026-10-21, the user's): an ordinary shot, but the tile it hits — wall or
 * ground — is frozen for the first `freezeShare` of the next build phase, nothing to be built on
 * it (`freezeTile`). Its reload an ordinary shot's flight, times `flightFactor`.
 */
const FrostSchema = z.strictObject({
  ...towerFields,
  /**
   * The share of the next build phase a tile it hits stays frozen, from its start; the balance's
   * lever (the user's). 1 is the whole phase, its overtime too.
   */
  freezeShare: z.number().positive().max(1),
  /**
   * Whether a whole phase's freeze (`freezeShare` 1) lasts through the overtime too, or thaws as
   * the build clock runs out (the user's, 2026-10-21, a lever of its own). Less than a whole
   * phase ends before the overtime either way.
   */
  throughOvertime: z.boolean(),
});

/**
 * Special towers (docs/SPECIAL_TOWERS.md): a cannon with an ability of its own, bought in
 * the cannon phase for several ordinary ones. Whether they are played at all is `enabled`,
 * which a match's settings write; the rest is each variant's balance.
 */
export const SpecialsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Towers a player may buy in one cannon phase. */
  perRound: z.number().int().positive(),
  /**
   * Towers that may stand on a player's island at once; null for no limit. A continue
   * wipes the island, its towers with it, and so frees the count.
   */
  maxOwned: z.number().int().positive().nullable(),
  /** Offence: a wider crater, fired first whenever it is ready. */
  bertha: byCost(BerthaSchema),
  /** Defence: rebuilds its owner's walls lost to shots nearby once a barrage is over. */
  architect: byCost(ArchitectSchema),
  /** More guns in less room: its cost in cannons, stacked. */
  rapid: byCost(RapidSchema),
  /**
   * Strikes at once and jumps from wall to wall (2026-10-17). Absent from rulesets written
   * before it — v0.9.7's recordings — and then not offered.
   */
  lightning: byCost(LightningSchema).optional(),
  /**
   * One enormous shell a combat phase (2026-10-17). Absent from rulesets written before it —
   * v0.9.9's recordings — and then not offered.
   */
  biggest: byCost(BiggestSchema).optional(),
  /**
   * A beam through the first walls on its line (2026-10-21). Absent from rulesets written
   * before it — v0.9.11's recordings — and then not offered.
   */
  laser: byCost(LaserSchema).optional(),
  /**
   * Freezes the tile it hits against building (2026-10-21). Absent from rulesets written before
   * it, and then not offered.
   */
  frost: byCost(FrostSchema).optional(),
});
export type Specials = z.infer<typeof SpecialsSchema>;
export type BerthaVariant = z.infer<typeof BerthaSchema>;
export type ArchitectVariant = z.infer<typeof ArchitectSchema>;
export type RapidVariant = z.infer<typeof RapidSchema>;
export type LightningVariant = z.infer<typeof LightningSchema>;
export type BiggestVariant = z.infer<typeof BiggestSchema>;
export type LaserVariant = z.infer<typeof LaserSchema>;
export type FrostVariant = z.infer<typeof FrostSchema>;
export type VariantConfig =
  | BerthaVariant
  | ArchitectVariant
  | RapidVariant
  | LightningVariant
  | BiggestVariant
  | LaserVariant
  | FrostVariant;

/** The variants the ruleset offers, in their order everywhere. */
export function offeredVariants(specials: Specials): TowerVariant[] {
  return TOWER_VARIANTS.filter((v) => specials[variantKind(v)]?.[variantCost(v)] !== undefined);
}

/** A variant's levers; throws for one the ruleset does not offer, which the sim never allows. */
export function variantConfig(specials: Specials, variant: TowerVariant): VariantConfig {
  const found = specials[variantKind(variant)]?.[variantCost(variant)];
  if (found === undefined) throw new Error(`${variant} is not offered by this ruleset`);
  return found;
}

/**
 * Towers off, for rulesets written before they existed — recordings above all. With
 * `enabled` false no other value is ever read.
 */
const SPECIALS_OFF: Specials = {
  enabled: false,
  perRound: 1,
  maxOwned: 3,
  bertha: { '3': { footprint: [2, 2], flightFactor: 1, crater: 'plus5' } },
  architect: { '2': { footprint: [2, 2], flightFactor: 1, repairRadius: 2 } },
  rapid: { '2': { footprint: [2, 2], flightFactor: 1 } },
};

export const RulesetSchema = z
  .strictObject({
    tickRateHz: z.number().int().positive().max(120),

    players: z.strictObject({
      min: z.number().int().min(2),
      max: z.number().int().max(8),
    }),

    phases: z.strictObject({
      castleSelectMs: ms,
      combatMs: ms,
      buildMs: ms,
      cannonPlaceMs: ms,
      /**
       * Breathing room after a phase's clock runs out, before the announcement
       * for the next one begins. Shots still in the air land during it.
       */
      endOfPhasePauseMs: ms,
      /**
       * How long the phase announcement takes to cross the screen. The next phase
       * does not begin until it has left, so this is match timing, not decoration.
       */
      transitionBannerMs: ms,
      /**
       * Added to the intermission when somebody spends a continue or is knocked out,
       * so the banner announcing it has the board to itself. In the ruleset rather
       * than the client because it lengthens a phase, and phase length is part of what
       * every client has to agree on.
       */
      continueBannerMs: ms,
    }),

    cannons: z.strictObject({
      startingCount: z.number().int().nonnegative(),
      /** Cannons granted for enclosing the first castle — the main one, see below. */
      firstCastleReward: z.number().int().nonnegative(),
      /** Additional cannons per castle beyond the first. */
      perAdditionalCastleReward: z.number().int().nonnegative(),
      /**
       * The first castle's reward goes to the **main castle** — the one the player chose,
       * afresh after each continue — and only while it is sealed; every other sealed
       * castle earns `perAdditionalCastleReward`, as in the original. Off, the first
       * sealed castle earns it, whichever it is. Defaults off so that recordings made
       * before it existed replay as they were played.
       */
      firstRewardForMainCastle: z.boolean().default(false),
      footprint: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      /** A cannon outside an enclosed region cannot fire, but survives. */
      inertWhenNotEnclosed: z.boolean(),
      /** Hard cap on total cannons per player; null = uncapped. */
      maxTotal: z.number().int().positive().nullable(),
    }),

    shots: z.strictObject({
      baseFlightMs: ms,
      /** Flight time scales with distance: base + perTile * tiles. */
      perTileFlightMs: z.number().nonnegative(),
      maxRangeTiles: z.number().int().positive().nullable(),
      craterPattern: CraterPatternSchema,
      damagesWalls: z.boolean(),
      /**
       * Whether a shot may destroy wall its own player built. Off, a target on your own
       * island is refused outright and only a live opponent's wall is ever cleared —
       * otherwise shooting a spare stretch of your own wall would score for damage you
       * were going to repair anyway.
       */
      damagesOwnWalls: z.boolean(),
    }),

    specials: SpecialsSchema.default(SPECIALS_OFF),

    build: z.strictObject({
      /**
       * After the build clock runs out, a short window in which every player may place
       * the one piece they are holding, and no more — so a piece being lined up as the
       * clock hit zero is not simply lost. Ends early once everyone still in has used
       * it. Zero turns it off.
       */
      overtimeMs: z.number().int().nonnegative(),
      /** All players draw from one seeded sequence, so luck is never a factor. */
      sharedPieceSequence: z.boolean(),
      restrictToOwnIsland: z.boolean(),
      /** Piece names must exist in the simulation's catalogue. Weights are relative. */
      pieces: z
        .array(
          z.strictObject({
            name: z.string().min(1),
            weight: z.number().positive(),
          }),
        )
        .min(1),
      /**
       * Which piece sizes are in the bag, by round.
       *
       * The draw narrows as a match goes on: small pieces that can plug any gap give
       * way to large ones that cannot, so sealing gets harder for everyone. This is
       * the game's difficulty ramp, and the one thing in the rules that forces a long
       * match toward a resolution.
       *
       * Each band applies from its round until the next one begins; the last runs to
       * the end of the match.
       */
      sizeSchedule: z
        .array(
          z.strictObject({
            fromRound: z.number().int().nonnegative(),
            sizes: z.array(z.number().int().min(1).max(5)).min(1),
          }),
        )
        .min(1),
    }),

    enclosure: z.strictObject({
      /**
       * Connectivity of the escape flood, not of the wall. 8 means the sea slips
       * through a diagonal join, so a sealing wall must be a 4-connected loop and
       * has to include its corners. 4 would let a diagonal step stand in for one.
       */
      connectivity: z.union([z.literal(4), z.literal(8)]),
      /**
       * A sealed region on a player's island holding no castle — a pocket — is their
       * territory for every purpose (guns, points) while they hold a sealed castle
       * anywhere, as in the original. False: only regions round a castle count. Pockets
       * never keep a player in the round: surviving still needs a sealed castle.
       */
      castlelessRegionsCount: z.boolean(),
      /**
       * Between the build phase and the next barrage, clear wall that is doing no
       * work: loose ends, and anything not linked to sealed ground. Without it the
       * board silts up with stray blocks, and the space a cannon needs goes with it.
       */
      sweepOrphanedWalls: z.boolean(),
    }),

    elimination: z.strictObject({
      onZeroEnclosedCastles: z.boolean(),
      simultaneousIsDraw: z.boolean(),
      /**
       * Lives. Failing to seal a castle spends one instead of ending the match: the
       * island is wiped, a fresh castle is chosen, and a new ring is raised around it.
       * Zero means failing is final, which is how the game behaved before this existed.
       */
      continues: z.number().int().nonnegative(),
      /**
       * Extra opening cannons per continue already spent, so a player on their last
       * life fields more guns than one on their first.
       */
      extraCannonsPerContinue: z.number().int().nonnegative(),
      /**
       * The most extra cannons a continue can bring. The bonus counts lives spent by the
       * whole team, which in a large team would otherwise grow past any sense.
       */
      maxExtraCannons: z.number().int().nonnegative(),
      /**
       * Whether a continue also rewinds the player's piece schedule to round one.
       *
       * The schedule widens with the round, so this hands somebody starting again the
       * small pieces they need to close a ring — and leaves whoever has survived
       * longest working with the awkward ones. It makes the round a *personal* count,
       * which is why it cannot coexist with a shared piece sequence.
       */
      resetPieceScheduleOnContinue: z.boolean(),
    }),

    teams: z.strictObject({
      /**
       * Who may place pieces on a teammate's island. People by default: a bot laying
       * wall on a person's island against their plan would be infuriating, while a
       * bot replans around a person's help as it does around a breach. The piece comes
       * from the placer's own queue, so helping spends their own build time.
       */
      crossIslandBuild: z.enum(['none', 'humans', 'all']),
    }),

    /**
     * Points, banked at each build-phase resolution by every player holding a sealed
     * castle. With a cap they decide most matches, so these weights are the balance.
     */
    scoring: z.strictObject({
      /**
       * The match ends at the resolution of this round, and the highest-scoring
       * survivor wins. Null means no cap, which exists for tests about elimination:
       * the game is balanced around the cap, and a host cannot choose to lift it.
       */
      maxRounds: z.number().int().positive().nullable(),
      /** Per opponent's wall tile destroyed during the round. */
      wallPoints: z.number().int().nonnegative(),
      /** Per tile of sealed territory, pockets and castle and gun footprints included. */
      tilePoints: z.number().int().nonnegative(),
      /**
       * The old rule: the tiles multiplied by the castles sealed, which grew with the square
       * of the castles held (ARCHIVE 13ze). Off since 2026-10-14; defaults on so that
       * recordings made before it existed replay as they were played.
       */
      castleMultiplier: z.boolean().default(true),
      /**
       * Per gun firing at the resolution — standing on sealed territory once the round is
       * resolved, so not the guns just earned. Defaults to none, the old rule, for the
       * same recordings.
       */
      gunPoints: z.number().int().nonnegative().default(0),
      /**
       * Whether damage still scores for a player who ends the round without a sealed
       * castle. Off by default: failing to seal forfeits the round's points entirely.
       */
      scoreDamageOnFailedRound: z.boolean(),
    }),
  })
  .refine((r) => r.players.max >= r.players.min, {
    message: 'players.max must be >= players.min',
    path: ['players', 'max'],
  })
  .refine((r) => !r.elimination.resetPieceScheduleOnContinue || !r.build.sharedPieceSequence, {
    // Rewinding one player's schedule is precisely that player drawing from a
    // different bag from everybody else, so the two cannot both be true. Checking it
    // here means the consequence has to be written down in the config rather than
    // discovered in a match.
    message:
      'elimination.resetPieceScheduleOnContinue requires build.sharedPieceSequence to be false',
    path: ['elimination', 'resetPieceScheduleOnContinue'],
  })
  .refine((r) => r.shots.damagesWalls, {
    message: 'shots.damagesWalls must be true — walls are the only damageable structure',
    path: ['shots', 'damagesWalls'],
  });

export type Ruleset = z.infer<typeof RulesetSchema>;

/**
 * Keys the ruleset once had and no code ever read, removed 2026-10-07: rules that looked
 * configurable and were not (the coastline never counts, a shared region always counts
 * every castle, only walls are ever damaged) and settings for things that never existed
 * (a piece preview count, skipping a piece). Old recordings carry them in their headers.
 */
export const RETIRED_RULESET_KEYS: readonly (readonly [string, string])[] = [
  ['shots', 'damagesCastles'],
  ['shots', 'damagesCannons'],
  ['build', 'previewCount'],
  ['build', 'allowSkip'],
  ['enclosure', 'shorelineCountsAsWall'],
  ['enclosure', 'sharedRegionCountsAllCastles'],
];

/**
 * A ruleset as an older recording holds it, without the retired keys, so it reads under
 * today's schema — which still refuses every other key it does not know.
 */
export function withoutRetiredKeys(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const ruleset: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [section, key] of RETIRED_RULESET_KEYS) {
    const part = ruleset[section];
    if (typeof part !== 'object' || part === null || !(key in part)) continue;
    const { [key]: _retired, ...rest } = part as Record<string, unknown>;
    ruleset[section] = rest;
  }
  return ruleset;
}
