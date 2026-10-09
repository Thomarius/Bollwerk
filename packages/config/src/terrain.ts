import { z } from 'zod';

/**
 * How the player islands are arranged.
 *
 * `ring` puts them on a circle, so every player has the same two neighbours at the
 * same distance — uniform, and the right answer for odd counts. `grid` packs them in
 * rows, which is tighter but gives edge and middle seats different neighbourhoods.
 * `hex` is a ring of six laid flat for a wide screen: two islands above, two below, one
 * at each side — the top and bottom pairs `rowGapTiles` apart.
 * Which is worth more depends on the count, so it is a table rather than a rule.
 */
export const PatternKindSchema = z.enum(['ring', 'grid', 'hex']);
export type PatternKind = z.infer<typeof PatternKindSchema>;

/**
 * One fair way to seat a table's teams on a pattern's islands: each team's islands, by
 * placement index (0 up to players - 1, in the order the pattern lays them out), and how
 * often it is drawn against the pattern's other layouts.
 */
export const TeamLayoutSchema = z.strictObject({
  weight: z.number().int().positive(),
  teams: z.array(z.array(z.number().int().nonnegative()).min(1)).min(2),
});
export type TeamLayout = z.infer<typeof TeamLayoutSchema>;

export const IslandPatternSchema = z
  .strictObject({
    players: z.number().int().min(2).max(8),
    /**
     * For tables of teams of this size only, in place of the count's own pattern; omitted,
     * for every table of this count that has no pattern of its own.
     */
    teamSize: z.number().int().min(2).optional(),
    kind: PatternKindSchema,
    /** Grid only; ignored by a ring. */
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    /**
     * Hex only: the water between the top pair of islands and the bottom pair, in tiles —
     * never less than the channel. Below an island's height and two channels the side
     * islands cannot stand beside the rows and go outside them: a compact map for a wide
     * screen, its seats unalike (the users' choice for three teams of two, 2026-10-09). At
     * that height the six stand as a flat hexagon, every neighbour at about one distance.
     */
    rowGapTiles: z.number().int().nonnegative().optional(),
    /**
     * The fair seatings of `teamSize` teams on these islands: one is drawn for each match
     * and the teams dealt onto it, rather than every seat shuffled onto any island. Where a
     * pattern has none, seats are shuffled freely.
     */
    teamLayouts: z.array(TeamLayoutSchema).min(1).optional(),
  })
  .refine((p) => p.kind !== 'grid' || (p.cols !== undefined && p.rows !== undefined), {
    message: 'a grid pattern needs cols and rows',
  })
  .refine((p) => p.kind !== 'grid' || (p.cols ?? 0) * (p.rows ?? 0) >= p.players, {
    message: 'cols x rows must be at least players',
  })
  .refine((p) => p.kind !== 'hex' || p.players === 6, {
    message: 'a hex pattern is six islands',
  })
  .refine((p) => p.kind === 'hex' || p.rowGapTiles === undefined, {
    message: 'rowGapTiles belongs to a hex',
  })
  .refine((p) => p.teamLayouts === undefined || p.teamSize !== undefined, {
    message: 'team layouts belong to a pattern for one team size',
  })
  .refine(
    (p) =>
      (p.teamLayouts ?? []).every((layout) => {
        // Every island once, in teams of the pattern's size.
        const islands = layout.teams.flat().sort((a, b) => a - b);
        return (
          layout.teams.every((team) => team.length === p.teamSize) &&
          islands.length === p.players &&
          islands.every((island, i) => island === i)
        );
      }),
    { message: "a team layout must put every island in exactly one team of the pattern's size" },
  );
export type IslandPattern = z.infer<typeof IslandPatternSchema>;

export const TerrainConfigSchema = z
  .strictObject({
    /**
     * One pattern per supported player count. The map's dimensions are not configured:
     * they are measured from the island box and the pattern, so a count that needs a
     * bigger map gets one instead of being squeezed into a fixed grid.
     */
    patterns: z.array(IslandPatternSchema).min(1),

    island: z.strictObject({
      /**
       * The rectangle one island is generated inside.
       *
       * Every island is this box, transformed and translated, so the box is what the
       * map is measured from. It wants real slack over `targetAreaTiles`: an island
       * that nearly fills its box has its coastline pinned by the box rather than by
       * the noise, and every seed then produces the same map.
       */
      boxWidth: z.number().int().min(8).max(256),
      boxHeight: z.number().int().min(8).max(256),
      targetAreaTiles: z.number().int().positive(),
      /** Accepted deviation from targetAreaTiles, as a fraction. */
      areaTolerance: z.number().min(0).max(1),
      noiseOctaves: z.number().int().min(1).max(8),
      noiseFrequency: z.number().positive(),
      /** How far noise moves the coast, 1 being about three tiles either way. */
      coastlineRoughness: z.number().min(0).max(2),
      /**
       * The island is cut from a rounded rectangle rather than a square one: the radius of
       * its corners, in tiles. At 0 every island kept its box's square corners and read as
       * a rectangle with a ragged edge; the user found them boxy.
       */
      cornerRadiusTiles: z.number().nonnegative().default(0),
      /** Minimum water separation between any two islands. */
      minWaterGapTiles: z.number().int().positive(),
      erosionPasses: z.number().int().nonnegative().max(8),
    }),

    castles: z.strictObject({
      perIsland: z.number().int().positive(),
      footprint: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      minSpacingTiles: z.number().int().nonnegative(),
      minDistanceFromShoreTiles: z.number().int().nonnegative(),
    }),

    startingWall: z.strictObject({
      /** Radius of the auto-built ring granted around the chosen starting castle. */
      ringRadiusTiles: z.number().int().positive(),
    }),

    generation: z.strictObject({
      maxRetries: z.number().int().positive(),
    }),
  })
  .refine((t) => t.island.targetAreaTiles < t.island.boxWidth * t.island.boxHeight, {
    message: 'island.targetAreaTiles must be smaller than the island box',
    path: ['island', 'targetAreaTiles'],
  });

export type TerrainConfig = z.infer<typeof TerrainConfigSchema>;
