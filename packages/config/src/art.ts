import { z } from 'zod';

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

/**
 * Palette keys are enumerated rather than left open, so a typo in art.default.json
 * fails at startup instead of rendering an undefined colour.
 */
export const PaletteSchema = z.strictObject({
  waterDeep: HexColor,
  waterMid: HexColor,
  waterShallow: HexColor,
  waterFoam: HexColor,
  sand: HexColor,
  grassDark: HexColor,
  grassMid: HexColor,
  grassLight: HexColor,
  rockDark: HexColor,
  rockMid: HexColor,
  rockLight: HexColor,
  shadow: HexColor,
  craterDark: HexColor,
  craterMid: HexColor,
  emberHot: HexColor,
  emberMid: HexColor,
  emberCool: HexColor,
  uiInk: HexColor,
  uiPanel: HexColor,
  uiAccent: HexColor,
  uiValid: HexColor,
  uiInvalid: HexColor,
});
export type Palette = z.infer<typeof PaletteSchema>;

export const PlayerPaletteSchema = z.strictObject({
  name: z.string().min(1),
  base: HexColor,
  light: HexColor,
  dark: HexColor,
  /** Degrees of hue rotation applied to generated sprites for this player. */
  hueRotate: z.number().min(0).max(360),
});
export type PlayerPalette = z.infer<typeof PlayerPaletteSchema>;

/**
 * Visual styles are interchangeable implementations of one renderer interface.
 * `flat` is the minimal look: solid colour, no textures, no atlas to generate. `night` is
 * the pixel style under a palette of its own (`stylePalettes`). `cyberpunk` is neon
 * outlines on a dark circuit board, `blueprint` a plan in white ink on blue paper,
 * `parchment` an old hand-drawn map, `bricks` a board built of toy bricks.
 */
export const ArtStyleSchema = z.enum([
  'flat',
  'pixel',
  'night',
  'cyberpunk',
  'blueprint',
  'parchment',
  'bricks',
]);
export type ArtStyle = z.infer<typeof ArtStyleSchema>;

/**
 * The shapes a player can carry beside their colour (PLAN 11.15 X6), so eight players,
 * and colour-blind players, can tell islands apart. Plain filled outlines, distinct at a
 * dozen pixels. Drawn off the board only: on the board they would clutter it.
 */
export const PlayerShapeSchema = z.enum([
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'plus',
  'hexagon',
  'invertedTriangle',
]);
export type PlayerShape = z.infer<typeof PlayerShapeSchema>;

export const FlatStyleSchema = z.strictObject({
  /** Opacity of the island tint, which is what makes ownership readable. */
  landAlpha: z.number().min(0).max(1),
  territoryAlpha: z.number().min(0).max(1),
  /** Gap left around each structure tile, so walls read as blocks rather than a mass. */
  structureInsetPx: z.number().int().nonnegative(),
  outlineWidthPx: z.number().int().positive(),
  /** Inner mark that distinguishes a castle keep from a plain block, as a fraction of the tile. */
  castleCoreScale: z.number().min(0).max(1),
  /** Bore of a cannon, as a fraction of its footprint. */
  cannonBoreScale: z.number().min(0).max(1),
  /** How long a swept wall block takes to fade as the banner passes over it. */
  crumbleMs: z.number().int().positive(),
  /** A plain boat crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
});
export type FlatStyleConfig = z.infer<typeof FlatStyleSchema>;

/**
 * The cyberpunk look. Brightness means structure and colour ownership, so walls
 * are the brightest lines on the board. Glow is a second, wider shape blended additively
 * rather than a bloom filter, which costs frame rate at eight players. Sizes in tiles
 * where they should scale with the map, in pixels where a line must stay crisp.
 */
export const CyberpunkStyleSchema = z.strictObject({
  /** Thin rain over the city, as streaks on screen at once per thousand tiles of view. */
  rainPerThousandTiles: z.number().nonnegative(),
  /** How far a wall hit's flash is split into its colours, in pixels. */
  splitPx: z.number().nonnegative(),
  /** The bright line round the outside of a wall, a castle and a gun. */
  wallLinePx: z.number().positive(),
  /** Width of the glow drawn under every bright line. */
  glowWidthTiles: z.number().positive(),
  glowAlpha: z.number().min(0).max(1),
  /** The grid over land, and its lit counterpart over sealed ground. */
  gridAlpha: z.number().min(0).max(1),
  /** The fill of sealed ground in its owner's colour, under the lit grid. */
  territoryAlpha: z.number().min(0).max(1),
  /** How many circuit traces the sea carries, per tile of it. */
  tracesPerSeaTile: z.number().nonnegative(),
  /** Distance from land over which the traces fade out. */
  traceFadeTiles: z.number().positive(),
  /** How fast a pulse runs along a trace. */
  pulseTilesPerSecond: z.number().positive(),
  /** A sealed castle's hologram flag flickering on. */
  hologramFlickerMs: z.number().int().positive(),
  /** A gun silenced by a breach, flickering as it powers down. */
  powerDownMs: z.number().int().positive(),
  /** The burst of glitch where a shot comes down. */
  glitchMs: z.number().int().positive(),
  /** Drones circling over the outer ocean, each with a searchlight on the water. */
  drones: z.number().int().nonnegative(),
  /** A hover-craft crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  hovercraftEveryMs: z.number().int().positive(),
  hovercraftTilesPerSecond: z.number().positive(),
});
export type CyberpunkStyleConfig = z.infer<typeof CyberpunkStyleSchema>;

/** The blueprint look: the board as an architect's plan, in ink on blue paper. */
export const BlueprintStyleSchema = z.strictObject({
  /** The ink line round walls, castles and guns. */
  lineWidthPx: z.number().positive(),
  /** Between the lines of hatching, in walls and sealed ground. */
  hatchTiles: z.number().positive(),
  /** The drafting grid over the whole sheet, and a heavier line every so many tiles. */
  gridAlpha: z.number().min(0).max(1),
  gridMajorEvery: z.number().int().positive(),
  /** The diagonal hatching that marks water on a plan. */
  seaHatchAlpha: z.number().min(0).max(1),
  /** Sealed ground's cross-hatching in the owner's ink. */
  territoryAlpha: z.number().min(0).max(1),
  /** A ship's plan on its dashed course crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
});
export type BlueprintStyleConfig = z.infer<typeof BlueprintStyleSchema>;

/**
 * Night's torchlight, the one thing it draws that the pixel style does not. Light falls
 * on the ground, under the walls, never on their colour: warm stone turned azure grey.
 */
export const NightStyleSchema = z.strictObject({
  /** Across the pool of light round a sealed castle's torches. */
  torchPoolTiles: z.number().positive(),
  /** How bright the pool is at its heart, blended additively. */
  torchGlowAlpha: z.number().min(0).max(1),
  /** The quickest of a flame's flickers. */
  torchFlickerMs: z.number().int().positive(),
  /** A torch catching as its castle is sealed; doused ones go out in a fifth of it. */
  torchIgniteMs: z.number().int().positive(),
  /** The ground a muzzle flash lights, and for how long. */
  muzzleLightTiles: z.number().positive(),
  muzzleLightMs: z.number().int().positive(),
  /** The glow round a shot in flight, burning as it goes. */
  shotGlowTiles: z.number().positive(),
  /** A smouldering breach's glow on the ground at its brightest. */
  breachGlowAlpha: z.number().min(0).max(1),
});
export type NightStyleConfig = z.infer<typeof NightStyleSchema>;

/**
 * What the pixel style draws beyond its sprites, and Night with it: the sea's glints and
 * crests, the shadows of clouds, the light in a sealed castle's windows.
 */
export const PixelStyleSchema = z.strictObject({
  /** Glints winking on the sea: how many a tile of water starts in a second, and how long each lasts. */
  glintsPerTileSecond: z.number().nonnegative(),
  glintMs: z.number().int().positive(),
  /** Wave crests on the open sea, forming, drifting with the wind and breaking up. */
  crestsPerTileSecond: z.number().nonnegative(),
  crestMs: z.number().int().positive(),
  /** Clouds overhead, as the shadows they cast: how many to a thousand tiles of view. */
  cloudsPerThousandTiles: z.number().nonnegative(),
  /** Across one cloud, the smallest and the largest. */
  cloudTiles: z.tuple([z.number().positive(), z.number().positive()]),
  cloudShadowAlpha: z.number().min(0).max(1),
  /** The wind the clouds and the crests drift on. */
  windTilesPerSecond: z.number().nonnegative(),
  /** A sealed castle's lit windows, at their brightest. */
  windowGlowAlpha: z.number().min(0).max(1),
  /**
   * Life out on the ocean, beyond the islands where no shot flies: a boat under sail
   * crossing now and then, gulls wheeling, a fish jumping.
   */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
  gulls: z.number().int().nonnegative(),
  fishEveryMs: z.number().int().positive(),
  /** The strongest the light of the day is laid on the ground, at sunset in the last round. */
  daylightAlpha: z.number().min(0).max(1),
  /** How often a match has each weather, relatively. */
  weatherOdds: z.strictObject({
    clear: z.number().nonnegative(),
    overcast: z.number().nonnegative(),
    rain: z.number().nonnegative(),
    fog: z.number().nonnegative(),
    /** Falling flakes and white on the tops of walls and castles (11.15). */
    snow: z.number().nonnegative(),
  }),
  /** Rain falling, as streaks on screen at once per thousand tiles of view. */
  rainPerThousandTiles: z.number().nonnegative(),
  /**
   * Distant thunder in the rain (11.15): a faint double flash over the whole board, at a
   * random interval between the two, never bright enough to pass for an impact.
   */
  thunderEveryMs: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  thunderAlpha: z.number().min(0).max(1),
  /** Snow falling, as flakes on screen at once per thousand tiles of view (11.15). */
  snowPerThousandTiles: z.number().nonnegative(),
  /** Night: fireflies over the land, per hundred tiles of it. */
  firefliesPerHundredTiles: z.number().nonnegative(),
  /** Night: a lighthouse's beam, how far it reaches and one turn of it. */
  beamTiles: z.number().positive(),
  beamTurnMs: z.number().int().positive(),
});
export type PixelStyleConfig = z.infer<typeof PixelStyleSchema>;

/** Trees, bushes and boulders on open land, placed from the seed; see `scenery.ts`. */
export const ScenerySchema = z.strictObject({
  /** Copses, per hundred tiles of open land. */
  clustersPerHundredTiles: z.number().nonnegative(),
  /** Across a copse from its centre. */
  clusterRadiusTiles: z.number().positive(),
  /** How thickly a copse is filled at its centre, thinning toward its edge. */
  clusterFill: z.number().min(0).max(1),
  /** Trees, bushes and boulders standing alone, per hundred tiles of open land. */
  singlesPerHundredTiles: z.number().nonnegative(),
});
export type SceneryConfig = z.infer<typeof ScenerySchema>;

/** The parchment look: an old map, in ink and watercolour on sepia paper. */
export const ParchmentStyleSchema = z.strictObject({
  /** The ink line round walls, castles and guns, and along the coast. */
  inkWidthPx: z.number().positive(),
  /** The engraver's lines rippling out from each coast, at these distances in tiles. */
  contourTiles: z.array(z.number().positive()),
  /** Wave strokes on the open sea, per tile of it. */
  wavesPerSeaTile: z.number().nonnegative(),
  /** The paper's grain and stains, over land and sea alike. */
  grainAlpha: z.number().min(0).max(1),
  /** Sealed ground's watercolour wash in the owner's colour. */
  washAlpha: z.number().min(0).max(1),
  /** The shadow a wall or castle casts on the paper to its south. */
  shadowAlpha: z.number().min(0).max(1),
  /** An engraved ship crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
  /** A sea serpent's coils arching out of the water and back, now and then, for so long. */
  serpentEveryMs: z.number().int().positive(),
  serpentMs: z.number().int().positive(),
});
export type ParchmentStyleConfig = z.infer<typeof ParchmentStyleSchema>;

/**
 * The toy bricks look: a board built of studded plastic bricks on baseplates — green
 * under the land, blue under the sea — which suits pieces that are tetrominoes already.
 */
export const BricksStyleSchema = z.strictObject({
  /** Across a stud, as a fraction of the tile. */
  studScale: z.number().positive().max(1),
  /** How strongly the land's baseplate shows its studs. */
  landStudAlpha: z.number().min(0).max(1),
  /** And the sea's: faint, since a busy sea would fight the game above it. */
  seaStudAlpha: z.number().min(0).max(1),
  /** Sealed ground: smooth tiles laid over the studs, in the owner's colour. */
  territoryAlpha: z.number().min(0).max(1),
  /** The plastic's sheen along each brick's lit edge. */
  sheenAlpha: z.number().min(0).max(1),
  /** A boat of bricks crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
  /** A rubber duck, bobbing crossing the outer ocean now and then (`render/ocean.ts`), one at a time. */
  duckEveryMs: z.number().int().positive(),
  duckTilesPerSecond: z.number().positive(),
  /** A shark's fin circling now and then, for so long. */
  sharkEveryMs: z.number().int().positive(),
  sharkMs: z.number().int().positive(),
});
export type BricksStyleConfig = z.infer<typeof BricksStyleSchema>;

/** One of the two looks a match is drawn in. */
export type ArtLook = 'build' | 'combat';

/**
 * Which style draws which part of the match. The combat look is on screen during combat
 * and the build look everywhere else; the banners either side of combat swap one for the
 * other as they cross the board, as the original did. The same style for both switches
 * nothing.
 */

export const ArtStylesSchema = z
  .strictObject({
    build: ArtStyleSchema,
    combat: ArtStyleSchema,
  })
  .refine((styles) => styleServes(styles.build, 'build'), {
    message: 'the build look must be a style made for building',
    path: ['build'],
  })
  .refine((styles) => styleServes(styles.combat, 'combat'), {
    message: 'the combat look must be a style made for combat',
    path: ['combat'],
  });
export type ArtStyles = z.infer<typeof ArtStylesSchema>;

/**
 * Which looks each style is made for. A style may be made for one look only — a calm
 * drafting-paper build look, say — and is then offered for that one
 * alone. A property of the drawing code rather than a tunable, so it lives here, and a
 * style cannot be added without saying.
 */
export const STYLE_LOOKS: Record<ArtStyle, readonly ArtLook[]> = {
  flat: ['build', 'combat'],
  pixel: ['build', 'combat'],
  night: ['build', 'combat'],
  cyberpunk: ['build', 'combat'],
  blueprint: ['build', 'combat'],
  parchment: ['build', 'combat'],
  bricks: ['build', 'combat'],
};

export function styleServes(
  style: ArtStyle,
  look: ArtLook,
  looks: Record<ArtStyle, readonly ArtLook[]> = STYLE_LOOKS,
): boolean {
  return looks[style].includes(look);
}

/** The styles made for a look, in the order the menu offers them. */
export function stylesFor(
  look: ArtLook,
  looks: Record<ArtStyle, readonly ArtLook[]> = STYLE_LOOKS,
): ArtStyle[] {
  return ArtStyleSchema.options.filter((style) => styleServes(style, look, looks));
}

/**
 * The first of `candidates` that names a style made for `look` — a link's, then what the
 * menu saved, then the default, say — so a stale or hand-typed choice falls through to
 * the next rather than drawing a look in a style that was never made for it.
 */
export function chooseStyle(
  look: ArtLook,
  candidates: readonly unknown[],
  fallback: ArtStyle,
  looks: Record<ArtStyle, readonly ArtLook[]> = STYLE_LOOKS,
): ArtStyle {
  for (const candidate of candidates) {
    const style = ArtStyleSchema.safeParse(candidate);
    if (style.success && styleServes(style.data, look, looks)) return style.data;
  }
  return fallback;
}

/**
 * A style's own colours, over the shared ones: any palette entries it names, and the
 * player ramps whole if it restyles them. What it leaves out it shares, so a style that
 * sets nothing looks exactly as it did before styles had colours of their own.
 */
export const StylePaletteSchema = z.strictObject({
  palette: PaletteSchema.partial().optional(),
  players: z.array(PlayerPaletteSchema).optional(),
  teamFamilies: z.array(z.array(PlayerPaletteSchema).min(1)).optional(),
});
export type StylePalette = z.infer<typeof StylePaletteSchema>;

/**
 * How far, in degrees, a style may move a player's hue. The looks swap under the banner
 * mid-match, so a style may restyle a player's colour — neon, ink, pastel — but not
 * change it: red that became magenta under the banner could not be followed. Fifteen is
 * the gap between the two closest hues of one team family (azure and sky), which tell
 * apart by lightness instead.
 */
export const MAX_STYLE_HUE_SHIFT = 15;

/** Hue of a #rrggbb colour in degrees, or null for a grey, which has none. */
export function hueOf(colour: string): number | null {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return null;
  const sector = max === r ? (g - b) / span : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (sector * 60 + 360) % 360;
}

/** Problems with a style's ramps against the shared ones they restyle, one per player. */
function rampProblems(own: readonly PlayerPalette[], shared: readonly PlayerPalette[]): string[] {
  if (own.length !== shared.length) {
    return [`has ${own.length} players where the shared ramps have ${shared.length}`];
  }
  const problems: string[] = [];
  own.forEach((entry, i) => {
    const base = shared[i]!;
    if (entry.name !== base.name) {
      problems.push(`player ${i} is "${entry.name}" where the shared ramps have "${base.name}"`);
      return;
    }
    const [a, b] = [hueOf(entry.base), hueOf(base.base)];
    const shift = a === null || b === null ? 180 : Math.abs(((a - b + 540) % 360) - 180);
    if (shift > MAX_STYLE_HUE_SHIFT) {
      problems.push(`"${entry.name}" moves its hue by ${Math.round(shift)} degrees`);
    }
  });
  return problems;
}

/**
 * The art as one style draws it: the shared config with that style's own colours laid
 * over it. Every theme is handed this rather than the shared art.
 */
export function artForStyle(art: ArtConfig, style: ArtStyle): ArtConfig {
  const own = art.stylePalettes[style];
  if (own === undefined) return art;
  return {
    ...art,
    // Parsed from JSON, so an entry is present with a colour or absent, never undefined.
    palette: { ...art.palette, ...own.palette } as Palette,
    players: own.players ?? art.players,
    teamFamilies: own.teamFamilies ?? art.teamFamilies,
  };
}

export const ArtConfigSchema = z
  .strictObject({
    styles: ArtStylesSchema,
    flat: FlatStyleSchema,
    cyberpunk: CyberpunkStyleSchema,
    blueprint: BlueprintStyleSchema,
    night: NightStyleSchema,
    pixel: PixelStyleSchema,
    parchment: ParchmentStyleSchema,
    bricks: BricksStyleSchema,
    scenery: ScenerySchema,
    /** Effects both styles draw alike, because they carry information. */
    effects: z.strictObject({
      /** How fast newly sealed ground floods out from the castle. */
      sealFloodTilesPerSecond: z.number().positive(),
      /**
       * How fast ground lost to a breach drains away from the gap as the "Rebuild"
       * banner reveals it (`drainFrom`, PLAN 11.15).
       */
      drainTilesPerSecond: z.number().positive(),
      /** How far behind the flood's front the glow trails off. */
      sealGlowTiles: z.number().positive(),
      /** A sealed castle's flag, from the foot of its pole to the head. */
      flagRaiseMs: z.number().int().positive(),
      /** A breached castle's flag, from the head of its pole to gone. */
      flagLowerMs: z.number().int().positive(),
      /** A placed piece settling into place. */
      landingMs: z.number().int().positive(),
      /** Dust thrown from each open edge of a placed piece, in the pixel style. */
      landingDustPerEdge: z.number().int().nonnegative(),
      /** One pulse of the red border round the board in overtime. */
      overtimePulseMs: z.number().int().positive(),
      /** The points banked at a resolution counting up as the territory is tallied. */
      tallyMs: z.number().int().positive(),
      /** A lost life's walls crumbling outward from the middle of the island. */
      lifeCrumbleMs: z.number().int().positive(),
      /** Between rockets over the winners, once the match is over. */
      fireworkEveryMs: z.number().int().positive(),
      /** How long the winners' banners take to be hoisted over their castles (11.15). */
      winnerBannerRiseMs: z.number().int().positive(),
      /** The rings breaking out from a castle as a player chooses it. */
      choiceBurstMs: z.number().int().positive(),
      /** The dotted course from the gun a click would fire to the cursor. */
      aimLineAlpha: z.number().min(0).max(1),
      /** The "Final round" stamp across the board as the last round opens. */
      finalStampMs: z.number().int().positive(),
      /** Embers drifting up the screen's edges through the final round (11.15). */
      finalEmberCount: z.number().int().nonnegative(),
    }),
    /**
     * The camera, which moves only while nothing is playable: onto the viewer's island as
     * the match opens and out to the whole map, and slowly onto the winner at game over.
     * Still under reduced motion.
     */
    camera: z.strictObject({
      /** How close the opening starts on the viewer's island, the whole map being 1. */
      openingZoom: z.number().min(1),
      /** Share of the opening intermission held on the island before pulling out. */
      openingHold: z.number().min(0).max(0.9),
      /** How close the push onto the winner ends. */
      winnerZoom: z.number().min(1),
      /** How long the push onto the winner takes. */
      winnerPushMs: z.number().int().positive(),
    }),
    /** The end-of-match summary. */
    summary: z.strictObject({
      /**
       * How long the fireworks and the push onto the winner hold the screen before the
       * summary comes up over them.
       */
      delayMs: z.number().int().nonnegative(),
    }),
    /** How long the HUD holds its news. */
    hud: z.strictObject({
      /** The points an island banked, over it, after each resolution. */
      pointsBannerMs: z.number().int().positive(),
      /**
       * When the badge beside Pause warns about the connection, online only: amber for a
       * slow round trip or a page falling behind the server, red for a bad one. Behind is
       * in ticks; a page that has caught up stays within two (CATCH_UP_MARGIN_TICKS).
       */
      network: z.strictObject({
        slowPingMs: z.number().int().positive(),
        badPingMs: z.number().int().positive(),
        slowBehindTicks: z.number().int().positive(),
        badBehindTicks: z.number().int().positive(),
      }),
    }),
    /** The menu's title, split between the two chosen looks at a banner's line. */
    menu: z.strictObject({
      /** One sweep of the line across it, as the banners cross the board. */
      titleSweepMs: z.number().int().positive(),
      /** Between sweeps, while the menu is open. */
      titleSweepEveryMs: z.number().int().positive(),
      /** One breath of the surf round the lobby map's coasts, each tile a little out of step. */
      mapSurfMs: z.number().int().positive(),
      /** One breath of the castles on the lobby map. */
      mapCastleMs: z.number().int().positive(),
    }),
    tileSizePx: z.number().int().positive(),
    atlasSizePx: z.number().int().positive(),
    pixelSnap: z.boolean(),
    scaleMode: z.enum(['nearest', 'linear']),

    palette: PaletteSchema,
    players: z.array(PlayerPaletteSchema).min(2),
    /**
     * Colours for team matches: one family per team, one shade per member, so a team
     * reads as one hue while each player keeps a colour of their own. Free-for-all uses
     * `players`. Four shades of one hue are hard to tell apart, which is why every team
     * also carries a letter.
     */
    teamFamilies: z.array(z.array(PlayerPaletteSchema).min(1)).min(2),
    /**
     * Each player's shape, by player in free-for-all and by team in a team match, where
     * teammates share one as they share a hue. No shape twice, or two would look alike.
     */
    playerShapes: z
      .array(PlayerShapeSchema)
      .min(2)
      .refine((shapes) => new Set(shapes).size === shapes.length, 'a shape is listed twice'),
    /** Each style's own colours, where it has any; see `StylePaletteSchema`. */
    stylePalettes: z.partialRecord(ArtStyleSchema, StylePaletteSchema),

    dither: z.strictObject({
      enabled: z.boolean(),
      matrix: z.enum(['bayer2', 'bayer4', 'bayer8']),
      strength: z.number().min(0).max(1),
    }),

    generators: z.strictObject({
      terrain: z.strictObject({
        grassVariants: z.number().int().positive(),
        rockVariants: z.number().int().positive(),
        shorelineTileset: z.enum(['blob47', 'edge16']),
        waterAnimFrames: z.number().int().positive(),
        waterAnimMsPerFrame: z.number().int().positive(),
        noiseDetailFrequency: z.number().positive(),
        /** Flagstone tiles for sealed ground, in the pixel style. */
        courtyardVariants: z.number().int().positive(),
        /** How far from land, in tiles, the sea goes on darkening. */
        depthShadeTiles: z.number().int().positive(),
        /** How much darker the open sea is than the water by the shore, 0 to 1. */
        depthShadeStrength: z.number().min(0).max(1),
        /** One breath of the surf along the coast. */
        foamCycleMs: z.number().int().positive(),
        /** Sea tiles drawn apart, so the water does not repeat in a visible grid. */
        waterVariants: z.number().int().positive(),
        /** The sand between grass and sea, in sprite pixels. */
        beachPx: z.number().int().positive(),
        /**
         * The radius a coast's corners are rounded to, in sprite pixels: cut back where
         * the land turns outward, filled in where it turns in. Drawing only; the land a
         * player may build on is the tiles, as ever.
         */
        coastRadiusPx: z.number().int().nonnegative(),
      }),
      wall: z.strictObject({
        neighbourVariants: z.literal(16),
        damageStates: z.number().int().positive(),
        blockRows: z.number().int().positive(),
        mortarJitter: z.number().min(0).max(1),
        /** Height of the front face on a block with nothing to its south. */
        frontFacePx: z.number().int().positive(),
        rubbleVariants: z.number().int().positive(),
        /** Opacity of the shadow a wall, castle or gun casts on the ground. */
        shadowAlpha: z.number().min(0).max(1),
      }),
      castle: z.strictObject({
        towerCountRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        battlementPeriodPx: z.number().int().positive(),
        bannerWidthPx: z.number().int().positive(),
        bannerWaveFrames: z.number().int().positive(),
      }),
      cannon: z.strictObject({
        rotationSteps: z.number().int().positive(),
        barrelLengthPx: z.number().int().positive(),
        recoilFrames: z.number().int().positive(),
        /** One puff of the smoke an inert gun gives off, from rising to gone. */
        inertSmokeMs: z.number().int().positive(),
      }),
      fx: z.strictObject({
        explosionFrames: z.number().int().positive(),
        explosionMsPerFrame: z.number().int().positive(),
        muzzleFlashFrames: z.number().int().positive(),
        craterDecalVariants: z.number().int().positive(),
        /** Rounds a scorch mark takes to fade from open ground. */
        craterRounds: z.number().int().positive(),
        /** Rings spreading where a shot comes down in the sea. */
        splashMs: z.number().int().positive(),
        /** Embers and smoke rising from where a wall block was destroyed. */
        smoulderMs: z.number().int().positive(),
        /** Smoke drifting from a gun's muzzle after it fires. */
        muzzleSmokeMs: z.number().int().positive(),
        muzzleSmokePuffs: z.number().int().nonnegative(),
        shotTrailLengthPx: z.number().int().nonnegative(),
        /** Fragments thrown up by each wall block a shot destroys. */
        debrisPerTile: z.number().int().nonnegative(),
        debrisMs: z.number().int().positive(),
        /**
         * The board shakes when a shot breaks a wall on the player's own island — not
         * for every impact, which across a whole map would be constant.
         */
        shakePx: z.number().nonnegative(),
        shakeMs: z.number().int().positive(),
      }),
      reticle: z.strictObject({
        sizePx: z.number().int().positive(),
        spinMsPerRevolution: z.number().int().positive(),
      }),
    }),
  })
  .refine((a) => a.generators.castle.towerCountRange[0] <= a.generators.castle.towerCountRange[1], {
    message: 'towerCountRange must be [min, max] with min <= max',
    path: ['generators', 'castle', 'towerCountRange'],
  })
  .superRefine((a, ctx) => {
    for (const [style, own] of Object.entries(a.stylePalettes)) {
      const problems = [
        ...(own?.players ? rampProblems(own.players, a.players) : []),
        ...(own?.teamFamilies
          ? own.teamFamilies.length === a.teamFamilies.length
            ? own.teamFamilies.flatMap((family, t) =>
                rampProblems(family, a.teamFamilies[t]!).map((p) => `team family ${t} ${p}`),
              )
            : [`has ${own.teamFamilies.length} team families, not ${a.teamFamilies.length}`]
          : []),
      ];
      for (const problem of problems) {
        ctx.addIssue({
          code: 'custom',
          message: `style "${style}": ${problem}`,
          path: ['stylePalettes', style],
        });
      }
    }
  });

export type ArtConfig = z.infer<typeof ArtConfigSchema>;
