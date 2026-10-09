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
 * `parchment` an old hand-drawn map, `bricks` a board built of toy bricks, `glass` a
 * church window of stained glass, `chocolate` a sweet-shop land on a river of chocolate,
 * `halloween` a haunted land round a bog, `sakura` an Edo castle town as a woodblock print,
 * `oktoberfest` the beer festival on an island in a sea of beer, `opera` a night at the opera
 * on a sea whose waves are staves, `office` an open-plan office at war with itself,
 * `undersea` a coral reef on the seabed, the deep all round it, `electric` a storm
 * laboratory under a thunderstorm, `cartoon` a 1930s rubber-hose cartoon in black and white, `christmas` a snowy island on Christmas Eve,
 * `noir` a crime city at night drawn as a cel-shaded graphic novel.
 */
export const ArtStyleSchema = z.enum([
  'flat',
  'pixel',
  'night',
  'cyberpunk',
  'blueprint',
  'parchment',
  'bricks',
  'glass',
  'chocolate',
  'halloween',
  'sakura',
  'oktoberfest',
  'opera',
  'office',
  'undersea',
  'electric',
  'cartoon',
  'christmas',
  'noir',
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
  /** The buoy in the corner (PLAN 11.24): a blink of its light, and while the clock presses. */
  buoyBlinkMs: z.number().int().positive(),
  buoyHurriedBlinkMs: z.number().int().positive(),
  /** One bob of it on the swell. */
  buoyBobMs: z.number().int().positive(),
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
  /** The holographic billboard in the corner (PLAN 11.24): one turn of its emblem. */
  billboardTurnMs: z.number().int().positive(),
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
  /** Contour lines on the land, at these distances inland from the coast in tiles (S3). */
  landContourTiles: z.array(z.number().positive()),
  /** Each castle's tag ("KEEP B-2") is lettered only from this tile size up, where it reads. */
  tagMinTilePx: z.number().positive(),
  /** The drafting compass swinging its arc round a ring as it seals, for so long. */
  compassMs: z.number().int().positive(),
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
  /** Braziers burning on the outer corners of each island's sealed rings, at most. */
  braziersPerIsland: z.number().int().nonnegative(),
  /** A brazier's light on the ground round it at its brightest. */
  brazierGlowAlpha: z.number().min(0).max(1),
  /** A lighthouse's beam at its brightest, by the lamp, fading toward its reach. */
  beamAlpha: z.number().min(0).max(1),
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
  /** Medieval's windmill in the corner (PLAN 11.24): one turn of its sails, and in rain. */
  windmillTurnMs: z.number().int().positive(),
  windmillRainTurnMs: z.number().int().positive(),
  /** Night's fishing boat in the corner: one swing of the lantern on its mast. */
  lanternSwingMs: z.number().int().positive(),
  /** Patches of field on each island's open land, in strips of tilled earth and crop. */
  fieldsPerIsland: z.number().int().nonnegative(),
  /** A dirt track south from each castle's gate, the shortest and the longest. */
  trackTiles: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  /** Sheep grazing each island's open land by day, the fewest and the most. */
  sheepPerIsland: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  /** A sheep's amble; it runs from a shot landing near at several times this. */
  sheepTilesPerSecond: z.number().positive(),
  /** A wisp of smoke from a sealed castle's chimney, from the roof until it has thinned away. */
  chimneySmokeMs: z.number().int().positive(),
  /** Masons walking off from a piece just laid: the most at once, and how long each walks. */
  masons: z.number().int().nonnegative(),
  masonMs: z.number().int().positive(),
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
  /**
   * How far the coast and its contours waver across their course, in tiles: a pen's hand
   * along a coast, where the tile grid drew a staircase (S2).
   */
  coastWaverTiles: z.number().nonnegative(),
  /** The stipple dotted along the sea side of every coast, a dot this many tiles apart. */
  stippleTiles: z.number().positive(),
  /** The rhumb lines radiating from the compass rose across the open sea. */
  rhumbAlpha: z.number().min(0).max(1),
  /** Each island's name, lettered in script across its land, and how faint. */
  islandNames: z.array(z.string().min(1).max(24)).min(8),
  nameAlpha: z.number().min(0).max(1),
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
  /** The crane on its barge in the corner (PLAN 11.24): one swing of its jib round and back. */
  craneSwingMs: z.number().int().positive(),
});
export type BricksStyleConfig = z.infer<typeof BricksStyleSchema>;

/**
 * The stained glass look (PLAN 11.18 Y7): the board as a church window, every tile a pane
 * of coloured glass held in lead, the light falling through it.
 */
export const GlassStyleSchema = z.strictObject({
  /** How far apart the points stand that land and sea are cut into panes round, in tiles. */
  paneTiles: z.number().min(1),
  /** The lead between panes, as a fraction of the tile. */
  leadTiles: z.number().positive().max(0.5),
  /** The heavier came along every coast, as a multiple of the lead. */
  coastLead: z.number().positive(),
  /** How far a pane's shade wanders from its neighbours', 0 to 1. */
  paneVariance: z.number().min(0).max(1),
  /** The light through each pane, as a sheen across its upper corner. */
  sheenAlpha: z.number().min(0).max(1),
  /** Sealed ground's panes in the owner's colour. */
  territoryAlpha: z.number().min(0).max(1),
  /** Shards a block breaks into when it is shot. */
  shardsPerBlock: z.number().int().nonnegative(),
  /** A fish of coloured glass leaping now and then on the outer ocean, for so long. */
  fishEveryMs: z.number().int().positive(),
  fishMs: z.number().int().positive(),
  /** A ship of glass crossing the outer ocean now and then, one at a time. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
});
export type GlassStyleConfig = z.infer<typeof GlassStyleSchema>;

/**
 * The chocolate look: candy meadows on a flowing river of milk chocolate, walls a bar of
 * chocolate under a coating in the owner's colour, castles chocolate fountains on a cake.
 */
export const ChocolateStyleSchema = z.strictObject({
  /** Swirls drifting with the river's current, one per so many tiles of sea. */
  swirlTiles: z.number().min(1),
  /** How fast the current carries them, in tiles a second. */
  currentTilesPerSecond: z.number().positive(),
  /** How long a swirl lasts before it melts back into the river. */
  swirlMs: z.number().int().positive(),
  /** Sealed ground's icing, over the meadow. */
  territoryAlpha: z.number().min(0).max(1),
  /** How far the icing is lightened from the owner's colour toward white, 0 to 1. */
  icingWhite: z.number().min(0).max(1),
  /** A band of gloss slides across each player's walls now and then, for so long. */
  shineEveryMs: z.number().int().positive(),
  shineMs: z.number().int().positive(),
  /** The share of wall blocks with a drip of coating running down their face. */
  dripShare: z.number().min(0).max(1),
  /** Crumbs a square throws as it is snapped off by a shot. */
  crumbsPerBlock: z.number().int().nonnegative(),
  /** Drops a shot throws up from the river. */
  splashDrops: z.number().int().nonnegative(),
  /** Sprinkles falling on a match whose weather is snow, on screen at once. */
  sprinkleCount: z.number().int().nonnegative(),
  /** A paddle-boat crossing the outer river now and then, one at a time. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
  /** Marshmallows bobbing up on the outer river now and then, for so long. */
  marshmallowEveryMs: z.number().int().positive(),
  marshmallowMs: z.number().int().positive(),
});
export type ChocolateStyleConfig = z.infer<typeof ChocolateStyleSchema>;

/**
 * The Halloween look: a haunted land round a bog — crypt-stone walls with spirit-light in
 * their mortar, haunted houses whose jack-o'-lantern is lit while sealed, cauldrons for
 * guns, spectral fireballs, and ghosts, fog and bats drifting over it all.
 */
export const HalloweenStyleSchema = z.strictObject({
  /** Fog banks drifting across the board, and how strongly they veil it. */
  fogBanks: z.number().int().nonnegative(),
  fogTilesPerSecond: z.number().positive(),
  fogAlpha: z.number().min(0).max(1),
  /** Bubbles rising in the bog, one at a time per so many tiles of it. */
  bubbleTiles: z.number().min(1),
  /** Sealed ground's tint in the owner's colour. */
  territoryAlpha: z.number().min(0).max(1),
  /** How long the ghost a shot frees from a wall takes to rise and fade. */
  ghostMs: z.number().int().positive(),
  /** The share of wall blocks with a cobweb in a corner. */
  cobwebShare: z.number().min(0).max(1),
  /** Pairs of eyes blinking at the screen's edges in the witching hour. */
  eyePairs: z.number().int().nonnegative(),
  /** Leaves falling on a match whose weather is snow, on screen at once. */
  leafCount: z.number().int().nonnegative(),
  /** A ghost ship drifting across the outer sea now and then, one at a time. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
  /** A flock of bats crossing it now and then. */
  batsEveryMs: z.number().int().positive(),
  batsTilesPerSecond: z.number().positive(),
});
export type HalloweenStyleConfig = z.infer<typeof HalloweenStyleSchema>;

/**
 * The Sakura look: an Edo castle town by the sea as a woodblock print — plastered walls
 * under tiled caps, keeps flying a carp streamer while sealed, raked gravel for sealed
 * ground, curling wave crests on an indigo sea, and cherry petals drifting over it all.
 */
export const SakuraStyleSchema = z.strictObject({
  /** Petals drifting over the board at once, and how fast they fall. */
  petalCount: z.number().int().nonnegative(),
  petalTilesPerSecond: z.number().positive(),
  /** Sealed ground's raked gravel, how strongly it covers the land, and its lines a tile. */
  territoryAlpha: z.number().min(0).max(1),
  rakeLines: z.number().int().min(1).max(4),
  /** Wave crests curling on the open sea, one at a time per so many tiles of it. */
  crestTiles: z.number().min(1),
  crestMs: z.number().int().positive(),
  /** How long the cloud a wall hit throws up takes to rise and fade. */
  puffMs: z.number().int().positive(),
  /** Bands of mist drifting across a foggy match, and how strongly they veil it. */
  mistBands: z.number().int().nonnegative(),
  mistAlpha: z.number().min(0).max(1),
  /** Snowflakes and rain streaks on screen at once, in a match with that weather. */
  snowCount: z.number().int().nonnegative(),
  rainCount: z.number().int().nonnegative(),
  /** A boat under a square sail crossing the outer sea now and then, one at a time. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
  /** A line of cranes flying over it now and then. */
  cranesEveryMs: z.number().int().positive(),
  cranesTilesPerSecond: z.number().positive(),
  /** A great wave rolling across it now and then. */
  waveEveryMs: z.number().int().positive(),
  waveTilesPerSecond: z.number().positive(),
});
export type SakuraStyleConfig = z.infer<typeof SakuraStyleSchema>;

/**
 * The Oktoberfest look: the fair on islands in a sea of beer — walls of stacked beer crates,
 * beer tents whose giant Maß fills while sealed, kegs firing pretzels, the Bavarian lozenges
 * for sealed ground, and a Ferris wheel turning in the corner.
 */
export const OktoberfestStyleSchema = z.strictObject({
  /** Bubbles rising in the beer, one at a time per so many tiles of it. */
  bubbleTiles: z.number().min(1),
  /** The owner's colour in the lozenges of sealed ground, and the white between them. */
  territoryAlpha: z.number().min(0).max(1),
  /** How long the Ferris wheel takes to turn once. */
  wheelTurnMs: z.number().int().positive(),
  /** A note rising from each sealed tent so often while the band plays. */
  noteEveryMs: z.number().int().positive(),
  /** How long the deposit's coin takes to flip up and fade, for a crate swept. */
  coinMs: z.number().int().positive(),
  /** Snowflakes and rain streaks on screen at once, in a match with that weather. */
  snowCount: z.number().int().nonnegative(),
  rainCount: z.number().int().nonnegative(),
  /** A Maß floating across the outer sea now and then, one at a time. */
  mugEveryMs: z.number().int().positive(),
  mugTilesPerSecond: z.number().positive(),
  /** A reveller drifting by asleep on a lilo now and then. */
  liloEveryMs: z.number().int().positive(),
  liloTilesPerSecond: z.number().positive(),
});
export type OktoberfestStyleConfig = z.infer<typeof OktoberfestStyleSchema>;

/**
 * The Opera look: a night at the opera — the sea's waves are staves with notes riding them,
 * walls are piano keys, castles opera houses that play while sealed, sealed ground a page of
 * the score, guns brass horns muted when silenced, and a conductor beating time in the corner.
 */
export const OperaStyleSchema = z.strictObject({
  /** The staves on the sea: tiles from one to the next, how high they swell, how long a wave. */
  staveEveryTiles: z.number().min(2),
  staveAmplitudeTiles: z.number().nonnegative(),
  staveWavelengthTiles: z.number().positive(),
  /** How fast the melody runs along them, and one note riding them per so many tiles of sea. */
  staveTilesPerSecond: z.number().positive(),
  noteTiles: z.number().min(1),
  /** Sealed ground's score paper, how strongly it covers the stage. */
  territoryAlpha: z.number().min(0).max(1),
  /** A note rising from each house so often while it plays. */
  risingNoteEveryMs: z.number().int().positive(),
  /** The conductor's beat, a crotchet: as a phase opens, and in its last seconds. */
  beatMs: z.number().int().positive(),
  hurriedBeatMs: z.number().int().positive(),
  /** The finale's spotlights, and how bright they are. */
  spotlights: z.number().int().nonnegative(),
  spotlightAlpha: z.number().min(0).max(1),
  /** Swans circling on the outer sea. */
  swans: z.number().int().nonnegative(),
  /** A gondola crossing it now and then, its gondolier singing. */
  gondolaEveryMs: z.number().int().positive(),
  gondolaTilesPerSecond: z.number().positive(),
  /** The Flying Dutchman's ship, now and then. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
});
export type OperaStyleConfig = z.infer<typeof OperaStyleSchema>;

/**
 * The Office look: an open-plan office at war with itself — the sea is the carpet, the land
 * the departments' linoleum, walls cubicle partitions, castles corner offices that work while
 * sealed, sealed ground booked inside floor tape, guns photocopiers on swivel bases throwing
 * paper planes, and a water cooler in the corner.
 */
export const OfficeStyleSchema = z.strictObject({
  /** The owner's carpet tiles on booked ground, how strongly they cover the linoleum. */
  territoryAlpha: z.number().min(0).max(1),
  /** The water cooler glugs a bubble up its bottle so often. */
  glugEveryMs: z.number().int().positive(),
  /** How brightly the fluorescent tubes flicker at the edges in the deadline. */
  flickerAlpha: z.number().min(0).max(1),
  /** Shreds of paper or drips from the ceiling at once, in a match with snow or rain. */
  snowCount: z.number().int().nonnegative(),
  rainCount: z.number().int().nonnegative(),
  /** Banks of burnt-popcorn haze drifting over the board, in a match with fog. */
  hazeBanks: z.number().int().nonnegative(),
  hazeAlpha: z.number().min(0).max(1),
  /** Robot vacuums wandering in circles on the outer carpet. */
  vacuums: z.number().int().nonnegative(),
  /** A paper plane gliding across it now and then. */
  gliderEveryMs: z.number().int().positive(),
  gliderTilesPerSecond: z.number().positive(),
  /** Somebody racing past on an office chair, spinning, now and then. */
  chairEveryMs: z.number().int().positive(),
  chairTilesPerSecond: z.number().positive(),
});
export type OfficeStyleConfig = z.infer<typeof OfficeStyleSchema>;

/**
 * The Under the sea look: the board on the seabed — each island a sunlit reef plateau of
 * sand, the deep dark all round it — with walls of coral, shell palaces whose giant clam opens
 * on its pearl while sealed, a meadow of seagrass for sealed ground, pufferfish for guns, and
 * a shipwreck with an octopus on it in the corner.
 */
export const UnderseaStyleSchema = z.strictObject({
  /** Sealed ground's meadow, how strongly the owner's colour covers the sand. */
  territoryAlpha: z.number().min(0).max(1),
  /** The light rippling over the sand, how bright, and how fast it moves. */
  causticAlpha: z.number().min(0).max(1),
  causticTilesPerSecond: z.number().nonnegative(),
  /** Shafts of light slanting down from the surface, and how bright they are. */
  shafts: z.number().int().nonnegative(),
  shaftAlpha: z.number().min(0).max(1),
  /** Marine snow drifting down at once, in any match and in one whose weather is snow. */
  marineSnow: z.number().int().nonnegative(),
  snowCount: z.number().int().nonnegative(),
  /** Raindrops ringing the surface above at once, in a match with rain. */
  rainCount: z.number().int().nonnegative(),
  /** Banks of a plankton bloom drifting over the board in a foggy match, and how thick. */
  bloomBanks: z.number().int().nonnegative(),
  bloomAlpha: z.number().min(0).max(1),
  /** Anglerfish lures glowing at the screen's edges as the deep comes up. */
  lures: z.number().int().nonnegative(),
  /** A whale's shadow passing over the whole board now and then, as the deep comes up. */
  whaleEveryMs: z.number().int().positive(),
  whaleTilesPerSecond: z.number().positive(),
  /** Schools of fish and jellyfish wheeling over the outer deep. */
  fishSchools: z.number().int().nonnegative(),
  jellyfish: z.number().int().nonnegative(),
  /** A sea turtle gliding across it now and then, one at a time. */
  turtleEveryMs: z.number().int().positive(),
  turtleTilesPerSecond: z.number().positive(),
  /** A manta ray gliding across it now and then. */
  mantaEveryMs: z.number().int().positive(),
  mantaTilesPerSecond: z.number().positive(),
});
export type UnderseaStyleConfig = z.infer<typeof UnderseaStyleSchema>;

/**
 * The Electric look: a storm laboratory on dark rock in a slate sea under a thunderstorm —
 * walls of Faraday cage, castles plasma globes whose filaments dance while sealed, Tesla towers
 * firing ball lightning, a charged floor for sealed ground, and a Jacob's ladder climbing in
 * the corner.
 */
export const ElectricStyleSchema = z.strictObject({
  /** Sealed ground's wash in the owner's colour, under its charged floor's grid. */
  territoryAlpha: z.number().min(0).max(1),
  /** How fast the charged floor's pulses run along its lines. */
  pulseTilesPerSecond: z.number().positive(),
  /** A crackle of current running along a player's walls, about so often for each. */
  crackleEveryMs: z.number().int().positive(),
  /** A bolt forking down onto the outer sea, about so often, and as the storm breaks. */
  boltEveryMs: z.number().int().positive(),
  stormBoltEveryMs: z.number().int().positive(),
  /** How bright the sky's flicker over the whole screen goes with a bolt. */
  flashAlpha: z.number().min(0).max(1),
  /** Rain streaks at once in a rainy match, and hailstones in a "snowy" one. */
  rainCount: z.number().int().nonnegative(),
  hailCount: z.number().int().nonnegative(),
  /** Banks of ionised mist in a foggy match, and how thick. */
  mistBanks: z.number().int().nonnegative(),
  mistAlpha: z.number().min(0).max(1),
  /** One climb of the Jacob's ladder's arc, as a phase opens, and while the clock presses. */
  ladderMs: z.number().int().positive(),
  hurriedLadderMs: z.number().int().positive(),
  /** An electric eel leaping from the outer sea now and then. */
  eelEveryMs: z.number().int().positive(),
  /** A ship with St. Elmo's fire on its masts crossing it now and then. */
  shipEveryMs: z.number().int().positive(),
  shipTilesPerSecond: z.number().positive(),
  /** A gull blown across it by the storm now and then. */
  gullEveryMs: z.number().int().positive(),
  gullTilesPerSecond: z.number().positive(),
});
export type ElectricStyleConfig = z.infer<typeof ElectricStyleSchema>;

/**
 * The Cartoon look: a 1930s rubber-hose cartoon reel, black ink on white under film grain,
 * the only colour a player's — living castles that dance while sealed, cannons with faces
 * firing bombs, a checkered dance floor for sealed ground, and an alarm clock on legs
 * dancing in the corner.
 */
export const CartoonStyleSchema = z.strictObject({
  /** The coloured squares of the dance floor, sealed ground, over the white ones. */
  floorAlpha: z.number().min(0).max(1),
  /** Drawings a second for everything that moves: a cartoon of the era moved "on twos". */
  framesPerSecond: z.number().positive(),
  /** One beat everything alive bounces to, and the beat while the clock presses. */
  beatMs: z.number().int().positive(),
  hurriedBeatMs: z.number().int().positive(),
  /** A note rising from each sealed castle, about so often. */
  noteEveryMs: z.number().int().positive(),
  /** Specks of film grain on screen at once, and how dark the flicker of the film goes. */
  grainCount: z.number().int().nonnegative(),
  flickerAlpha: z.number().min(0).max(1),
  /** A scratch running down the film now and then. */
  scratchEveryMs: z.number().int().positive(),
  /** How dark the vignette's corners go. */
  vignetteAlpha: z.number().min(0).max(1),
  /** Raindrops and snowflakes at once, in a match with that weather. */
  rainCount: z.number().int().nonnegative(),
  snowCount: z.number().int().nonnegative(),
  /** Banks of fog drifting over the board in a foggy match, and how thick. */
  fogBanks: z.number().int().nonnegative(),
  fogAlpha: z.number().min(0).max(1),
  /** A fish hopping out of the outer sea now and then, and a whale surfacing to spout. */
  fishEveryMs: z.number().int().positive(),
  whaleEveryMs: z.number().int().positive(),
  /** A rowing boat crossing the outer sea now and then. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
});
export type CartoonStyleConfig = z.infer<typeof CartoonStyleSchema>;

/**
 * The Christmas look: a snowy island on Christmas Eve in a midnight sea — walls of wrapped
 * presents, castles Christmas trees whose lights and star shine while sealed, snowmen throwing
 * snowballs for guns, a tartan for sealed ground, and a snow globe in the corner.
 */
export const ChristmasStyleSchema = z.strictObject({
  /** Sealed ground's tartan, the owner's colour washed over the snow under its stripes. */
  floorAlpha: z.number().min(0).max(1),
  /** How long the fairy lights hold before they twinkle to new brightnesses. */
  twinkleMs: z.number().int().positive(),
  /** How bright the lights' and stars' halos glow. */
  glowAlpha: z.number().min(0).max(1),
  /** Snowflakes falling at once in any match, and in a blizzard: snowy weather and the climax. */
  snowCount: z.number().int().nonnegative(),
  blizzardCount: z.number().int().nonnegative(),
  /** Banks of snow mist in a foggy match, and how thick. */
  mistBanks: z.number().int().nonnegative(),
  mistAlpha: z.number().min(0).max(1),
  /** Flakes in the snow globe in the corner. */
  globeFlakes: z.number().int().nonnegative(),
  /** Santa's sleigh flying across the outer sea now and then, and how fast. */
  sleighEveryMs: z.number().int().positive(),
  sleighTilesPerSecond: z.number().positive(),
  /** An ice floe drifting by with a seal or a polar bear on it, and how fast. */
  floeEveryMs: z.number().int().positive(),
  floeTilesPerSecond: z.number().positive(),
});
export type ChristmasStyleConfig = z.infer<typeof ChristmasStyleSchema>;

/**
 * The Noir look: a 1940s crime city at night drawn as a hard-boiled graphic novel —
 * cel-shaded, inked thick, its shadows hatched; black, white and grey, the players' colours
 * the only colour, glowing as neon. Sealed ground is turf in a street lamp's light.
 */
export const NoirStyleSchema = z.strictObject({
  /** The owner's colour washed into the lamplight on sealed ground. */
  floorAlpha: z.number().min(0).max(1),
  /** How dark the hatching lies on everything out of the light. */
  hatchAlpha: z.number().min(0).max(1),
  /** How bright the neon's and the lamps' halos glow. */
  glowAlpha: z.number().min(0).max(1),
  /** How long a sign or lamp holds each state as it sputters out at a breach. */
  flickerMs: z.number().int().positive(),
  /** One sweep of a gun's searchlight, there and back. */
  searchlightSweepMs: z.number().int().positive(),
  /** Raindrops falling at once, and in the final round's storm. */
  rainCount: z.number().int().nonnegative(),
  stormRainCount: z.number().int().nonnegative(),
  /** Banks of fog in a foggy match, and how thick. */
  mistBanks: z.number().int().nonnegative(),
  mistAlpha: z.number().min(0).max(1),
  /** Drains steaming on a dry night. */
  steamVents: z.number().int().nonnegative(),
  /** How long a big hit's impact frame holds the screen. */
  impactFrameMs: z.number().int().positive(),
  /** How long a sound word stays on the board, and the share of wall hits that get one. */
  wordMs: z.number().int().positive(),
  wordChance: z.number().min(0).max(1),
  /** Between lightning strikes in the final round's storm, on average. */
  lightningEveryMs: z.number().int().positive(),
  /** A tug crossing the outer sea now and then, and how fast. */
  boatEveryMs: z.number().int().positive(),
  boatTilesPerSecond: z.number().positive(),
});
export type NoirStyleConfig = z.infer<typeof NoirStyleSchema>;

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
  glass: ['build', 'combat'],
  chocolate: ['build', 'combat'],
  halloween: ['build', 'combat'],
  sakura: ['build', 'combat'],
  oktoberfest: ['build', 'combat'],
  opera: ['build', 'combat'],
  office: ['build', 'combat'],
  undersea: ['build', 'combat'],
  electric: ['build', 'combat'],
  cartoon: ['build', 'combat'],
  christmas: ['build', 'combat'],
  noir: ['build', 'combat'],
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
    glass: GlassStyleSchema,
    chocolate: ChocolateStyleSchema,
    halloween: HalloweenStyleSchema,
    sakura: SakuraStyleSchema,
    oktoberfest: OktoberfestStyleSchema,
    opera: OperaStyleSchema,
    office: OfficeStyleSchema,
    undersea: UnderseaStyleSchema,
    electric: ElectricStyleSchema,
    cartoon: CartoonStyleSchema,
    christmas: ChristmasStyleSchema,
    noir: NoirStyleSchema,
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
      /**
       * The points an island banked, over it, after each resolution — never past the
       * intermission, so they are gone as the cannon phase opens.
       */
      pointsBannerMs: z.number().int().positive(),
      /**
       * "You are here" over the viewer's island: through the opening announcement and this
       * long into choosing a castle, then faded over `youAreHereFadeMs` — it stood over the
       * island's middle, often on a castle, until one was chosen.
       */
      youAreHereMs: z.number().int().nonnegative(),
      youAreHereFadeMs: z.number().int().positive(),
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
      /** One pass of the line down across it, gliding without a pause while the menu is open. */
      titlePassMs: z.number().int().positive(),
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
