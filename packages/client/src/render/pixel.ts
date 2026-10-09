import type { ArtConfig, ArtStyle } from '@bollwerk/config';
import { Rng, Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { BlurFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';

import { bloomWanted, motionReduced } from '../motion.js';
import { inFinalRound } from '../scores.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot } from './corner.js';
import { SEA_NE, SEA_NW, SEA_SE, SEA_SW, filletCorners } from './pixel/coast.js';
import { daylight, shadowCast, weatherFor, type Weather } from './pixel/atmosphere.js';
import { PILE_CORNERS, pileCorner, ringCorners, spreadOut, type RingCorner } from './pixel/life.js';
import { OceanLife } from './pixel/ocean.js';
import { release } from './release.js';
import { SceneryTracker, placeScenery } from './scenery.js';
import { Discs, SpritePool, StampBook, Stamps } from './stamps.js';
import { seaDepth } from './ocean.js';
import {
  CASTLE_CHIMNEY,
  CASTLE_WINDOWS,
  E,
  FILLET_CORNERS,
  KEY,
  N,
  S,
  W,
  buildAtlas,
  buildAtlasPaced,
} from './pixel/generators.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
  Landings,
  RuinSmoke,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawSealPreview,
  drawChoices,
  drawSelectable,
  drawFireReticle,
  drawOvertimeBorder,
  drawDrain,
  drawSealGlow,
  drawMainCastles,
  drawShotTarget,
  hex,
  playerColour,
  tileX,
  tileY,
  type Cell,
  type Debris,
  type EffectFrame,
  type Ghost,
  type Theme,
  type Pace,
  type ThemeLayers,
  type ViewTransform,
  shotLift,
  type FinishLook,
  GunAims,
  mixed,
  shotProgress,
} from './theme.js';

interface Blast {
  x: number;
  y: number;
  age: number;
}

/** A fragment of wall, in tile coordinates, thrown up by a shot. */
interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  colour: number;
}

/** A scorch mark on open ground, fading over the rounds after the shot. */
interface Crater {
  index: number;
  variant: number;
  round: number;
}

/** Cracks in a standing wall block beside a breach, for the rest of the round. */
interface Crack {
  level: number;
  round: number;
}

/** Rings spreading on the sea where a shot came down in it. */
interface Splash {
  x: number;
  y: number;
  age: number;
}

/** A destroyed wall block's embers and smoke, rising for a while after. */
interface Smoulder {
  x: number;
  y: number;
  age: number;
  seed: number;
}

/** A puff of gun smoke drifting off from a muzzle, in tile coordinates. */
interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** A surf sprite along the coast, and where it is in its breath. */
interface Surf {
  sprite: Sprite;
  phase: number;
}

/** A glint of light on the sea, or a wave crest drifting on it, in tile coordinates. */
interface Glint {
  x: number;
  y: number;
  age: number;
  life: number;
}

/** A cloud's shadow: blobs round a centre, in tiles, drifting with the wind. */
interface Cloud {
  x: number;
  y: number;
  blobs: { dx: number; dy: number; r: number }[];
  reach: number;
}

/** A sheep grazing an island's open land, in tile coordinates at its feet. */
interface Sheep {
  x: number;
  y: number;
  /** Where it is walking to; where it stands while it grazes. */
  tx: number;
  ty: number;
  speed: number;
  /** Until it moves on, once there. */
  restMs: number;
  grazing: boolean;
  left: boolean;
  island: number;
  /** Through its steps, for the walk. */
  stepMs: number;
}

/** A mason walking off from a piece just laid, in tile coordinates at his feet. */
interface Mason {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/**
 * A brazier on the outer corner of a sealed ring, at Night, on the wall block `index`, which
 * must still stand for it to burn.
 */
interface Brazier extends RingCorner {
  /** The castle whose torches it burns with: lit while that castle is sealed. */
  castleId: number;
}

/** The balls in the pile beside a gun at the start of a round, one gone with each shot. */
const PILE = 3;

/** How long each recoil and muzzle-flash frame is held. */
const FX_FRAME_MS = 50;

/** The tile across each corner a sea tile may be filled in at. */
const ACROSS: Record<number, [number, number]> = {
  [SEA_NW]: [-1, -1],
  [SEA_NE]: [1, -1],
  [SEA_SE]: [1, 1],
  [SEA_SW]: [-1, 1],
};

/** The way the wind blows, as a unit vector: mostly east, a little south. */
const WIND_X = 0.94;
const WIND_Y = 0.34;

/** Mixes a colour toward white, so tinting a texture shifts its hue without crushing it. */
function washed(colour: number, amount: number): number {
  return mixed(colour, 0xffffff, amount);
}

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'streak', flag: 'swallowtail' };

/**
 * The procedural pixel style.
 *
 * Every sprite is generated at boot from the palette and packed into one texture, so
 * the whole board draws in a single batch and the repository carries no binary art.
 * Terrain, walls and structures are generated in neutral stone and grass and tinted
 * per player, which keeps the atlas small and guarantees the two styles agree on
 * colour — both read the same palette.
 */
export class PixelTheme implements Theme {
  readonly id: ArtStyle;

  private art!: ArtConfig;
  private textures = new Map<string, Texture>();
  private readonly seed: number;

  private terrainLayer!: Container;
  /**
   * The terrain's sprites, ten thousand at eight players, as a render group of their own
   * (PLAN 11.22): Pixi then keeps their batch from frame to frame, where in the layer with
   * the sea's crests, redrawn every frame, it gathered and packed every one of them again.
   */
  private readonly tileLayer = new Container({ isRenderGroup: true });
  private structureLayer!: Container;
  private effectLayer!: Container;
  /**
   * Sprites for the layers emptied and filled again: the effects and the piece in hand
   * every frame, the walls at every hit, the paving and scorches as they change. Made anew
   * each time, the old ones were left to the collector, two hundred a frame at eight
   * players, and the walls' shadow was a new `Graphics` at every hit, never destroyed.
   */
  private readonly pools = new Map<Container, SpritePool>();
  /** The walls' shadows and the snow lying on them, redrawn with the walls. */
  private readonly shade = new Graphics();
  private readonly snowCaps = new Graphics();
  private readonly territoryGfx = new Graphics();
  private readonly ghostMotion = new GhostMotion();
  /** Under the piece's sprites: the shadow it casts while held. */
  private readonly ghostShadow = new Graphics();
  private readonly ruins = new RuinSmoke();
  /** Chunks of wall thrown out by a shot, tumbling and then lying where they fell. */
  private chunks: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    colour: number;
    size: number;
  }[] = [];
  private readonly overlayGfx = new Graphics();
  private readonly effectGfx = new Graphics();

  /** Water sprites are kept so the sea can be animated without rebuilding the map. */
  private waterSprites: Sprite[] = [];
  /** Which variant of the sea each of `waterSprites` is drawn from. */
  private waterVariants: number[] = [];
  /** Open water far enough from land for a crest to drift without reaching it. */
  private openSea: Cell[] = [];
  /** Every tile of water drawn, for the glints. */
  private seaCells: Cell[] = [];
  private readonly seaGfx = new Graphics();
  /**
   * The piece in the corner (PLAN 11.24): Medieval's windmill, Night's fishing boat. In the
   * terrain layer, so the day's light and the clouds pass over it as over the ground.
   */
  private readonly cornerGfx = new Graphics();
  private corner: TimerSpot | null = null;
  /**
   * The clouds' shadows, a stamp a cloud drawn once and only moved (PLAN 11.22): their 700
   * soft discs, filled anew each frame, were 48 000 vertices at eight players, most of
   * what Medieval cost.
   */
  private readonly cloudStamps = new Stamps();
  private readonly cloudBook = new StampBook();
  /** Which set of clouds the book's stamps are of; a new set is drawn afresh. */
  private cloudSet = 0;
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryTracker();
  private readonly sceneryLayer = new Container();
  private islandId: Uint8Array | null = null;
  private readonly ocean = new OceanLife();
  /** The light of the day and the weather's cast, on the ground and sea under the walls. */
  private readonly daylightGfx = new Graphics();
  private weather: Weather = 'clear';
  private rain: { x: number; y: number; speed: number }[] = [];
  /** Snowflakes, drifting as they fall. */
  private snow: { x: number; y: number; speed: number; phase: number }[] = [];
  /** Distant thunder: until the next flash, and how far into the one showing. */
  private thunder = { untilMs: 0, ageMs: -1 };
  /** Rings where raindrops strike the sea. */
  private ripples: Glint[] = [];
  /** Night: fireflies over the land, and lighthouses on the sea off each island. */
  private land: Cell[] = [];
  private fireflies: { x: number; y: number; phase: number; drift: number }[] = [];
  private lighthouses: Cell[] = [];
  private glints: Glint[] = [];
  private crests: Glint[] = [];
  private clouds: Cloud[] = [];
  /** The tiles drawn, margin and all, which the clouds wrap round. */
  private drawn = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private waterFrame = -1;
  private waterElapsed = 0;
  private blasts: Blast[] = [];
  private fragments: Fragment[] = [];
  /** By cannon id. A gun that has never fired faces the nearest enemy castle. */
  private readonly aims = new GunAims();
  private bannerElapsed = 0;
  /** Milliseconds since the theme began drawing, for anything that loops. */
  private clock = 0;

  /** Flagstones on sealed ground, under the scorch marks and the greying of the out. */
  private readonly courtLayer = new Container();
  private readonly craterLayer = new Container();
  private craters: Crater[] = [];
  /** By tile index. */
  private cracks = new Map<number, Crack>();
  private surf: Surf[] = [];
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private splashes: Splash[] = [];
  private smoulders: Smoulder[] = [];
  private puffs: Puff[] = [];
  private readonly flags = new FlagHoist();
  /** The piece in hand, drawn as the wall it would make. */
  private readonly ghostLayer = new Container();
  /**
   * Sheep and masons, over the ground but under the walls (the territory layer), so neither
   * can ever hide a wall, a gun or a castle: one walking into a wall goes behind it.
   */
  private readonly flockLayer = new Container();
  private sheep: Sheep[] = [];
  private masons: Mason[] = [];
  /**
   * What lies on a castle under the shared marks: its lights and its chimney's smoke, and
   * Night's braziers on the walls. Below the effects' drawing, so the crown at a castle's
   * foot and the marks where shots will land stay on top of them.
   */
  private readonly lightLayer = new Container();
  /** The phase as last drawn: masons come only to a piece laid in the build. */
  private phase = '';
  private board: MatchState | null = null;
  /** Shots each gun has fired this round, by cannon id, for the pile of balls beside it. */
  private readonly fired = new Map<number, number>();
  /** Each castle's chimney: whether it is sealed, and since when, for the wisps in the air. */
  private readonly chimneys = new Map<number, { sealed: boolean; since: number }>();
  private braziers: Brazier[] = [];
  /** Each island's middle, which a gun's sandbags face away from; for the board it was of. */
  private centres: { of: Uint8Array | null; at: Map<number, { x: number; y: number }> } = {
    of: null,
    at: new Map(),
  };
  /**
   * Night's lighthouse beams, a soft wedge drawn once and only turned (`Stamps`): brightest
   * at the lamp and fading to its reach, its edges soft, where a flat grey wedge was a shape
   * laid on the sea rather than light.
   */
  private readonly beamStamps = new Stamps();
  private readonly beamBook = new StampBook();

  /** Remembered from the last draw, since impacts arrive without the board. */
  private terrain: Uint8Array | null = null;
  private width = 0;
  private view: ViewTransform = { tile: 16, originX: 0, originY: 0, width: 0, height: 0, top: 0 };
  private round = 0;

  /**
   * Night's torchlight: light on the ground in the territory layer, under the walls so
   * it never colours them, and round flames and shots in flight above them. Both blend
   * additively. Unused by the pixel style itself.
   */
  private readonly groundLight = new Graphics();
  private readonly airLight = new Graphics();
  /**
   * The discs of light in those two, stamps of one disc (PLAN 11.22): the torches' pools
   * and flames, flickering, were most of what Night drew anew each frame.
   */
  private readonly groundDiscs = new Discs();
  private readonly airDiscs = new Discs();
  /** Muzzle flashes lighting the ground, in tile coordinates. */
  private lights: { x: number; y: number; age: number }[] = [];
  /** Each castle's torches: how far alight, 0 to 1, and whether it was sealed. */
  private readonly torches = new Map<number, { lit: number; sealed: boolean }>();

  /** `id` is the style this draws, which decides the palette it is handed. */
  constructor(seed = 1, id: ArtStyle = 'pixel') {
    this.seed = seed;
    this.id = id;
  }

  async init(layers: ThemeLayers, art: ArtConfig, pace?: Pace): Promise<void> {
    this.art = art;
    this.textures =
      pace === undefined ? buildAtlas(art, this.seed) : await buildAtlasPaced(art, this.seed, pace);

    this.terrainLayer = layers.terrain;
    // A render group of its own, as the terrain's tiles are: thousands of wall sprites, which
    // Pixi would otherwise gather and pack again with every frame's effects (PLAN 11.22).
    this.structureLayer = new Container({ isRenderGroup: true });
    layers.structures.addChild(this.structureLayer);
    this.effectLayer = layers.effects;
    for (const layer of [
      this.structureLayer,
      this.effectLayer,
      this.ghostLayer,
      this.courtLayer,
      this.craterLayer,
      this.flockLayer,
      this.lightLayer,
    ]) {
      this.pools.set(layer, new SpritePool());
    }

    layers.territory.addChild(
      this.courtLayer,
      this.craterLayer,
      this.sceneryLayer,
      this.flockLayer,
      this.daylightGfx,
      this.territoryGfx,
      this.groundLight,
      this.groundDiscs.container,
      this.beamStamps.container,
    );
    for (const light of [this.groundLight, this.groundDiscs.container, this.beamStamps.container]) {
      light.blendMode = 'add';
    }
    for (const light of [this.airLight, this.airDiscs.container]) light.blendMode = 'add';
    if (this.torchlit && bloomWanted()) {
      // High effects: the light bloomed by a real blur rather than only the wider shapes.
      for (const light of [this.groundLight, this.groundDiscs.container]) {
        light.filters = [new BlurFilter({ strength: 6, quality: 2 })];
      }
      for (const light of [this.airLight, this.airDiscs.container]) {
        light.filters = [new BlurFilter({ strength: 4, quality: 2 })];
      }
    }
    layers.effects.addChild(this.effectGfx);
    layers.overlay.addChild(this.ghostShadow, this.ghostLayer, this.overlayGfx);
  }

  destroy(): void {
    this.terrainLayer?.removeChildren();
    release(this.tileLayer);
    // The pooled sprites go with their pools, not twice over with their layers.
    for (const [layer, pool] of this.pools) {
      layer.removeChildren();
      pool.destroy();
    }
    this.pools.clear();
    this.shade.destroy();
    this.snowCaps.destroy();
    if (this.structureLayer) release(this.structureLayer);
    this.territoryGfx.destroy();
    this.overlayGfx.destroy();
    release(this.ghostLayer);
    this.effectGfx.destroy();
    this.groundLight.destroy();
    this.airLight.destroy();
    this.groundDiscs.destroy();
    this.airDiscs.destroy();
    this.seaGfx.destroy();
    this.cornerGfx.destroy();
    this.ghostShadow.destroy();
    this.cloudStamps.destroy();
    this.cloudBook.destroy();
    release(this.courtLayer);
    release(this.sceneryLayer);
    release(this.craterLayer);
    release(this.flockLayer);
    release(this.lightLayer);
    this.beamStamps.destroy();
    this.beamBook.destroy();
    // The frames share one atlas that none of them owns: released with them, or it stays
    // uploaded for the page's life (PLAN 11.23).
    const sources = new Set([...this.textures.values()].map((texture) => texture.source));
    for (const texture of this.textures.values()) texture.destroy();
    for (const source of sources) source.destroy();
    this.textures.clear();
    this.waterSprites = [];
    this.waterVariants = [];
    this.surf = [];
  }

  /** Empties a pooled layer for drawing again, its sprites back in its pool. */
  private empty(layer: Container): void {
    layer.removeChildren();
    this.pools.get(layer)?.begin();
  }

  private texture(key: string): Texture {
    return this.textures.get(key) ?? Texture.EMPTY;
  }

  private place(
    parent: Container,
    key: string,
    view: ViewTransform,
    x: number,
    y: number,
    tiles = 1,
  ): Sprite {
    const texture = this.texture(key);
    const sprite = this.pools.get(parent)?.take(texture) ?? new Sprite(texture);
    sprite.x = tileX(view, x);
    sprite.y = tileY(view, y);
    sprite.width = view.tile * tiles;
    sprite.height = view.tile * tiles;
    // Sprites are generated at 16 pixels a tile but displayed at whatever the map
    // scales to, so snap to the pixel grid rather than let edges land on halves.
    sprite.roundPixels = true;
    parent.addChild(sprite);
    return sprite;
  }

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrainLayer.removeChildren();
    this.tileLayer.removeChildren();
    this.waterSprites = [];
    this.waterVariants = [];
    this.openSea = [];
    this.seaCells = [];
    this.surf = [];
    this.waterFrame = -1;
    this.terrain = state.terrain;
    this.width = state.width;
    this.view = view;

    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    const variants = this.art.generators.terrain.grassVariants;
    const seaVariants = this.art.generators.terrain.waterVariants;
    const sea = (x: number, y: number): Sprite => {
      // Scattered by a hash of the tile rather than in a pattern, which would show.
      const variant = (((x * 73856093) ^ (y * 19349663)) >>> 0) % seaVariants;
      const sprite = this.place(this.tileLayer, KEY.water(0, variant), view, x, y);
      this.waterSprites.push(sprite);
      this.waterVariants.push(variant);
      return sprite;
    };
    const beachTint = (owner: number): number =>
      owner >= 0 ? washed(playerColour(this.art, owner, 'base'), 0.82) : 0xffffff;

    // Water runs past the board to the window's edge. Drawn only across the grid, the
    // animated sea stopped in a hard rectangle with the page's flat blue beyond it.
    const marginX = Math.ceil(view.originX / view.tile) + 1;
    const marginY = Math.ceil(view.originY / view.tile) + 1;
    const depth = seaDepth(state, marginX, marginY, this.art.generators.terrain.depthShadeTiles);
    const spanX = state.width + marginX * 2;
    const deepest = this.art.generators.terrain.depthShadeTiles;
    const strength = this.art.generators.terrain.depthShadeStrength;
    for (let y = -marginY; y < state.height + marginY; y++) {
      for (let x = -marginX; x < state.width + marginX; x++) {
        const inside = x >= 0 && y >= 0 && x < state.width && y < state.height;
        const i = y * state.width + x;
        if (!inside || state.terrain[i] !== Terrain.Land) {
          const sprite = sea(x, y);
          // Darker the further from land, so the islands stand in shallows and the
          // channels between them read as open sea.
          const d = depth[(y + marginY) * spanX + (x + marginX)] as number;
          const shade = Math.round(255 * (1 - (strength * Math.max(0, d - 1)) / (deepest - 1)));
          sprite.tint = (shade << 16) | (shade << 8) | Math.min(255, shade + 24);
          this.seaCells.push({ x, y });
          if (d >= 3) this.openSea.push({ x, y });

          let coast = 0;
          if (land(x, y - 1)) coast |= N;
          if (land(x + 1, y)) coast |= E;
          if (land(x, y + 1)) coast |= S;
          if (land(x - 1, y)) coast |= W;
          if (coast !== 0) {
            const surf = this.place(this.tileLayer, KEY.foam(coast), view, x, y);
            this.surf.push({ sprite: surf, phase: ((x * 7 + y * 11) % 13) / 13 });
          }
          // Where the coast turns inward, the corner of the sea is filled with beach.
          const corners = filletCorners((dx, dy) => land(x + dx, y + dy));
          for (const corner of FILLET_CORNERS) {
            if ((corners & corner) === 0) continue;
            // Tinted for the island across the corner, which the fillet belongs to.
            const [dx, dy] = ACROSS[corner] as [number, number];
            const owner = (state.islandId[(y + dy) * state.width + x + dx] as number) - 1;
            const fillet = this.place(this.tileLayer, KEY.fillet(corner), view, x, y);
            fillet.tint = beachTint(owner);
          }
          continue;
        }

        // Which sides meet the sea decides the tile; the top nibble carries the
        // diagonals so a headland does not come out square.
        let mask = 0;
        if (!land(x, y - 1)) mask |= N;
        if (!land(x + 1, y)) mask |= E;
        if (!land(x, y + 1)) mask |= S;
        if (!land(x - 1, y)) mask |= W;
        if (!land(x - 1, y - 1)) mask |= 16;
        if (!land(x + 1, y - 1)) mask |= 32;
        if (!land(x + 1, y + 1)) mask |= 64;
        if (!land(x - 1, y + 1)) mask |= 128;

        // A coast tile's rounded corners show the sea, so it is laid on some.
        if (mask !== 0) sea(x, y).tint = 0xffffff;
        const key = mask === 0 ? KEY.grass((x * 7 + y * 13) % variants) : KEY.shore(mask);
        const sprite = this.place(this.tileLayer, key, view, x, y);

        // Only a hint of the owner's colour. Tinting hard enough to identify an
        // island by its grass turns the ground muddy and throws away the generated
        // texture; ownership is carried by the shoreline, the walls and the
        // territory shading instead.
        const owner = (state.islandId[i] as number) - 1;
        if (owner >= 0) {
          const wash = mask === 0 ? 0.78 : 0.45;
          sprite.tint = washed(playerColour(this.art, owner, 'base'), wash);
        }
        // The beach over it, tinted faintly: sand as hard-tinted as the grass beside it
        // made the coast a coloured rim rather than a shore.
        if (mask !== 0)
          this.place(this.tileLayer, KEY.beach(mask), view, x, y).tint = beachTint(owner);
      }
    }
    this.layoutFarmland(state, view);
    this.terrainLayer.addChild(this.tileLayer, this.seaGfx, this.cornerGfx);
    this.islandId = state.islandId;
    this.corner = cornerSpot(state, view);
    this.ocean.corner = this.corner;
    this.ocean.layout(state, view, this.art);
    this.weather = this.torchlit ? 'clear' : weatherFor(state.seed, this.art.pixel.weatherOdds);
    this.layoutNight(state, view);
    this.layoutSheep(state);
    this.scenery.sync(state, this.art.scenery);
    this.layoutScenery();
    this.drawn = {
      x0: -marginX,
      y0: -marginY,
      x1: state.width + marginX,
      y1: state.height + marginY,
    };
    this.layoutCraters();
  }

  /**
   * Life on the land, laid into the terrain once from the seed, under everything built: a
   * dirt track running south from each castle's gate, and on each island's open land a few
   * fields in strips, tilled earth and a crop coming up row by row. Kept clear of the trees
   * and of each other, and two tiles in from the coast, so a field is never taken for a beach.
   */
  private layoutFarmland(state: MatchState, view: ViewTransform): void {
    const { width: w, height: h } = state;
    const rng = new Rng((state.seed ^ 0xf1e1d5) >>> 0);
    const land = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < w && y < h && state.terrain[y * w + x] === Terrain.Land;
    const blocked = new Uint8Array(w * h);
    for (const item of placeScenery(state, this.art.scenery)) blocked[item.index] = 1;
    const block = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) blocked[y * w + x] = 1;
      }
    };
    const tint = (index: number, wash: number): number => {
      const owner = (state.islandId[index] as number) - 1;
      return owner >= 0 ? washed(playerColour(this.art, owner, 'base'), wash) : 0xffffff;
    };

    const [shortest, longest] = this.art.pixel.trackTiles;
    for (const castle of state.castles) {
      const gate = castle.x + castle.w / 2;
      const length = shortest + rng.nextInt(Math.max(1, longest - shortest + 1));
      let run = 0;
      while (run < length) {
        const y = castle.y + castle.h + run;
        const clear = [Math.floor(gate - 0.5), Math.floor(gate)].every(
          (x) => land(x, y) && land(x, y + 1) && blocked[y * w + x] === 0,
        );
        if (!clear) break;
        run++;
      }
      // Wandering a little, a quarter tile aside at a time, never more than half a tile off.
      let offset = 0;
      for (let k = 0; k < run; k++) {
        const y = castle.y + castle.h + k;
        const shift = k === 0 ? 0 : ([-4, 0, 4][rng.nextInt(3)] as number);
        const bend = Math.abs(offset + shift) > 8 ? 0 : shift;
        const sprite = this.place(
          this.tileLayer,
          KEY.track(bend, k === run - 1),
          view,
          gate - 0.5 + offset / this.art.tileSizePx,
          y,
        );
        offset += bend;
        // At Night pale earth stood out of the dark ground as a white stripe.
        sprite.tint = this.torchlit ? 0x707070 : tint(y * w + Math.floor(gate), 0.9);
      }
      block(castle.x - 1, castle.y - 1, castle.x + castle.w, castle.y + castle.h + run);
    }

    const islands = new Map<number, Cell[]>();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (state.terrain[i] !== Terrain.Land) continue;
        const id = state.islandId[i] as number;
        const list = islands.get(id) ?? [];
        list.push({ x, y });
        islands.set(id, list);
      }
    }
    // Open land two tiles in from the sea: a field's edge on the beach read as more beach.
    const inland = (x: number, y: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) if (!land(x + dx, y + dy)) return false;
      }
      return true;
    };
    for (const [id, cells] of [...islands.entries()].sort((a, b) => a[0] - b[0])) {
      for (let n = 0; n < this.art.pixel.fieldsPerIsland; n++) {
        for (let attempt = 0; attempt < 16; attempt++) {
          const at = cells[rng.nextInt(cells.length)] as Cell;
          const fw = 3 + rng.nextInt(2);
          const fh = 2 + rng.nextInt(3);
          let fits = true;
          for (let y = at.y; y < at.y + fh && fits; y++) {
            for (let x = at.x; x < at.x + fw && fits; x++) {
              fits =
                inland(x, y) &&
                blocked[y * w + x] === 0 &&
                (state.islandId[y * w + x] as number) === id;
            }
          }
          if (!fits) continue;
          const first = rng.nextInt(2);
          for (let y = at.y; y < at.y + fh; y++) {
            const kind = (y - at.y + first) % 2 === 0 ? 'tilled' : 'crop';
            for (let x = at.x; x < at.x + fw; x++) {
              const sprite = this.place(this.tileLayer, KEY.field(kind, (x + y) % 2), view, x, y);
              // At Night pale strips beside a wall read as paving: they sink into the dark.
              sprite.tint = this.torchlit ? 0x8c8c8c : tint(y * w + x, 0.88);
              // A little of the grass through it, so a field is ground and not a patch
              // laid on it that could pass for paving.
              sprite.alpha = 0.8;
            }
          }
          block(at.x - 1, at.y - 1, at.x + fw, at.y + fh);
          break;
        }
      }
    }
  }

  /**
   * Trees, bushes and boulders where they still stand, tinted as faintly as the grass
   * under them so they sit on their island rather than on top of it.
   */
  private layoutScenery(): void {
    this.sceneryLayer.removeChildren();
    for (const item of this.scenery.visible()) {
      const sprite = this.place(
        this.sceneryLayer,
        KEY.scenery(item.kind, item.variant),
        this.view,
        item.x,
        item.y,
      );
      const owner = ((this.islandId?.[item.index] as number | undefined) ?? 0) - 1;
      if (owner >= 0) sprite.tint = washed(playerColour(this.art, owner, 'base'), 0.88);
    }
  }

  /** Places the scorch marks, whose sprites must follow the camera. */
  private layoutCraters(): void {
    this.empty(this.craterLayer);
    const rounds = this.art.generators.fx.craterRounds;
    for (const crater of this.craters) {
      const x = crater.index % this.width;
      const y = (crater.index - x) / this.width;
      const sprite = this.place(this.craterLayer, KEY.crater(crater.variant), this.view, x, y);
      sprite.alpha = 0.9 * (1 - (this.round - crater.round) / rounds);
    }
  }

  /**
   * Sealed ground as a courtyard of flagstones in the owner's colour. A wash of colour
   * was hard to read at a glance under textured grass; paving says "held" by itself.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.empty(this.courtLayer);
    const variants = this.art.generators.terrain.courtyardVariants;
    for (let i = 0; i < state.territory.length; i++) {
      const owner = (state.territory[i] as number) - 1;
      if (owner < 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const sprite = this.place(this.courtLayer, KEY.court((x * 5 + y * 3) % variants), view, x, y);
      // At Night pale paving was as light as the walls round it (the style review): there
      // the court is the owner's colour in shadow, so the lit walls stand up out of it.
      sprite.tint = this.torchlit
        ? mixed(playerColour(this.art, owner, 'base'), hex(this.art.palette.shadow), 0.45)
        : washed(playerColour(this.art, owner, 'light'), 0.55);
      // Opaque: the grass's speckle showing through made a one-tile pocket read as a
      // breach rather than paving.
      sprite.alpha = 1;
    }
    const g = this.territoryGfx;
    g.clear();
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
    this.layoutBraziers(state);
    if (this.scenery.sync(state, this.art.scenery)) this.layoutScenery();
  }

  drawStructures(state: MatchState, view: ViewTransform): void {
    if (this.scenery.sync(state, this.art.scenery)) this.layoutScenery();
    this.empty(this.structureLayer);
    // Shadows first, under everything that casts them.
    const shade = this.shade;
    shade.clear();
    this.structureLayer.addChild(shade);
    this.dropShadows(shade, state, view);

    // Cracks last only the round they were made in: the walls are dressed again by
    // the time the next barrage comes.
    for (const [index, crack] of this.cracks) {
      if (crack.round !== state.round || state.structure[index] !== Structure.Wall) {
        this.cracks.delete(index);
      }
    }
    const worst = this.art.generators.wall.damageStates - 1;
    const rubbleVariants = this.art.generators.wall.rubbleVariants;

    const isWall = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.structure[y * state.width + x] === Structure.Wall;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const i = y * state.width + x;
        if (state.structure[i] !== Structure.Wall) continue;

        // Joins to its neighbours, so a run of blocks reads as one wall.
        let mask = 0;
        if (isWall(x, y - 1)) mask |= N;
        if (isWall(x + 1, y)) mask |= E;
        if (isWall(x, y + 1)) mask |= S;
        if (isWall(x - 1, y)) mask |= W;

        const owner = (state.owner[i] as number) - 1;
        if (owner < 0) {
          // An eliminated player's wall: still in the way, but nobody's any more.
          this.place(this.structureLayer, KEY.rubble((x * 3 + y * 7) % rubbleVariants), view, x, y);
          continue;
        }
        const damage = Math.min(worst, this.cracks.get(i)?.level ?? 0);
        const sprite = this.place(this.structureLayer, KEY.wall(mask, damage), view, x, y);
        sprite.tint = washed(playerColour(this.art, owner, 'light'), 0.15);
      }
    }

    const mains = mainCastles(state);
    for (const castle of state.castles) {
      // The main castle's larger keep, and its roof gilded over the tint, which turns gold
      // the owner's colour; the shared crown at its foot stays as it is.
      const main = mains.has(castle.id);
      const sprite = this.place(
        this.structureLayer,
        main ? KEY.mainCastle : KEY.castle,
        view,
        castle.x,
        castle.y,
        castle.w,
      );
      sprite.tint = washed(playerColour(this.art, castle.islandId - 1, 'base'), 0.35);
      if (main) {
        const gilt = this.place(this.structureLayer, KEY.gilt, view, castle.x, castle.y, castle.w);
        // At Night the gold catches only the torchlight, not shining out of the dark.
        if (this.torchlit) gilt.tint = 0xa89c8c;
      }
    }

    for (const cannon of state.cannons) {
      const sprite = this.place(
        this.structureLayer,
        KEY.cannon,
        view,
        cannon.x,
        cannon.y,
        cannon.w,
      );
      sprite.tint = cannon.active
        ? washed(playerColour(this.art, cannon.owner, 'base'), 0.3)
        : hex(this.art.palette.rockDark);
      sprite.alpha = cannon.active ? 1 : 0.7;
      // Sandbags on the side facing away from the island's middle, out toward the sea and
      // the enemy; greyed with the rest of a silenced gun.
      const bags = this.place(
        this.structureLayer,
        KEY.sandbags(this.outward(state, cannon)),
        view,
        cannon.x,
        cannon.y,
        cannon.w,
      );
      if (!cannon.active) {
        bags.tint = 0x8a8a8a;
        bags.alpha = 0.8;
      }
    }

    // Snow lies on every top edge a wall shows, and along the top of each castle: drawn
    // with the walls rather than every frame, since it moves only when they do.
    // The weather from the seed, as `drawTerrain` sets it: the walls may be drawn first.
    this.snowCaps.clear();
    if (!this.torchlit && weatherFor(state.seed, this.art.pixel.weatherOdds) === 'snow') {
      const g = this.snowCaps;
      const cap = Math.max(2, Math.round(view.tile * 0.2));
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] === 0) continue;
        const x = i % state.width;
        const y = (i - x) / state.width;
        if (y > 0 && state.structure[i - state.width] === Structure.Wall) continue;
        g.rect(tileX(view, x), tileY(view, y), view.tile, cap);
      }
      for (const castle of state.castles) {
        g.rect(tileX(view, castle.x) + 1, tileY(view, castle.y), castle.w * view.tile - 2, cap);
      }
      g.fill({ color: 0xf4f7ff, alpha: 0.85 });
      this.structureLayer.addChild(g);
    }
  }

  /**
   * Which of eight ways (0 east, clockwise) a gun faces away from its island's middle: where
   * its sandbags go, and its pile of balls opposite.
   */
  private outward(
    state: MatchState,
    cannon: { x: number; y: number; w: number; h: number },
  ): number {
    if (this.centres.of !== state.islandId) {
      const sums = new Map<number, { x: number; y: number; n: number }>();
      for (let i = 0; i < state.islandId.length; i++) {
        const id = state.islandId[i] as number;
        if (id === 0 || state.terrain[i] !== Terrain.Land) continue;
        const sum = sums.get(id) ?? { x: 0, y: 0, n: 0 };
        sum.x += i % state.width;
        sum.y += Math.floor(i / state.width);
        sum.n++;
        sums.set(id, sum);
      }
      this.centres = {
        of: state.islandId,
        at: new Map([...sums].map(([id, s]) => [id, { x: s.x / s.n + 0.5, y: s.y / s.n + 0.5 }])),
      };
    }
    const gx = cannon.x + cannon.w / 2;
    const gy = cannon.y + cannon.h / 2;
    const island = state.islandId[Math.floor(gy) * state.width + Math.floor(gx)] as number;
    const centre = this.centres.at.get(island);
    if (centre === undefined) return 2;
    const angle = Math.atan2(gy - centre.y, gx - centre.x);
    return (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8) as number;
  }

  /**
   * What stands up casts a shadow onto the ground to its south, as the light falls on
   * the generated sprites from the north. With the front faces, it is what lifts the
   * walls off the map. Rubble casts none; it is lying down.
   */
  private dropShadows(g: Graphics, state: MatchState, view: ViewTransform): void {
    // Long and leaning in the morning and at sunset, short at noon (`shadowCast`, PLAN
    // 11.15); Night's are the torchlit board's, as they always were.
    const cast = this.torchlit
      ? { length: 0.35, lean: 0 }
      : shadowCast(state.round, state.ruleset.scoring.maxRounds);
    const depth = view.tile * cast.length;
    const lean = view.tile * cast.lean;
    // A strip under an edge, sheared by the lean.
    const strip = (left: number, top: number, width: number): void => {
      g.poly([
        left,
        top,
        left + width,
        top,
        left + width + lean,
        top + depth,
        left + lean,
        top + depth,
      ]);
    };
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] === 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      if (y + 1 < state.height && state.structure[i + state.width] === Structure.Wall) continue;
      strip(tileX(view, x), tileY(view, y + 1), view.tile);
    }
    for (const castle of state.castles) {
      strip(tileX(view, castle.x), tileY(view, castle.y + castle.h), castle.w * view.tile);
    }
    g.fill({ color: hex(this.art.palette.shadow), alpha: this.art.generators.wall.shadowAlpha });
    for (const cannon of state.cannons) {
      g.ellipse(
        tileX(view, cannon.x + cannon.w / 2 + 0.12 + cast.lean * 0.5),
        tileY(view, cannon.y + cannon.h / 2 + 0.2 + (cast.length - 0.35) * 0.5),
        (cannon.w * view.tile) / 2 - 1,
        (cannon.h * view.tile) / 2 - 2,
      );
    }
    g.fill({ color: hex(this.art.palette.shadow), alpha: this.art.generators.wall.shadowAlpha });
  }

  /**
   * A shot lands, and what it hits decides how it looks: the sea takes it in a splash,
   * open ground in a blast and a puff of dust, a wall in a blast that leaves the breach
   * smouldering.
   */
  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea =
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      this.terrain[y * this.width + x] !== Terrain.Land;
    this.scatter(x, y);
    if (inSea) {
      this.splash(x, y);
      return;
    }
    this.blasts.push({ x, y, age: 0 });
    this.scorch(x, y);
    if (debris.length === 0) this.dust(x, y);
    for (const block of debris) {
      this.smoulders.push({ x: block.x, y: block.y, age: 0, seed: Math.random() * 10 });
    }
    // The blocks either side of a breach are shaken too.
    const worst = this.art.generators.wall.damageStates - 1;
    for (const block of debris) {
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const nx = block.x + dx;
        const ny = block.y + dy;
        if (nx < 0 || ny < 0 || nx >= this.width) continue;
        const index = ny * this.width + nx;
        const level = Math.min(worst, (this.cracks.get(index)?.level ?? 0) + 1);
        this.cracks.set(index, { level, round: this.round });
      }
    }
    // Chunks of the block itself, thrown out a little way to lie as rubble for a while.
    for (const block of debris) {
      for (let k = 0; k < 4; k++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + Math.random() * 1.1;
        this.chunks.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          z: 0.2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.7,
          vz: 2.2 + Math.random() * 1.6,
          age: 0,
          colour: playerColour(this.art, block.owner, k % 2 === 0 ? 'dark' : 'base'),
          size: 0.16 + Math.random() * 0.1,
        });
      }
    }
    const count = this.art.generators.fx.debrisPerTile;
    for (const block of debris) {
      const colour = playerColour(this.art, block.owner, 'base');
      for (let k = 0; k < count; k++) {
        // Cosmetic, so an ordinary random source: nothing here reaches the sim.
        const spread = (Math.random() - 0.5) * 2;
        this.fragments.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: spread * 2.2,
          vy: -2.5 - Math.random() * 2.5,
          age: 0,
          colour,
        });
      }
    }
  }

  /**
   * A piece set down: it settles, and kicks up a little dust from its outer edges —
   * light and brief, a stone laid rather than a shot landing.
   */
  noteLanding(cells: readonly Cell[], owner: number): void {
    this.landings.add(cells, owner);
    if (this.phase === 'build') this.sendMason(cells);
    // Whatever stood there is knocked flat: leaves, or chips of the boulder.
    for (const item of this.scenery.take(cells, this.width)) {
      const { palette } = this.art;
      const colours =
        item.kind === 'rock'
          ? [hex(palette.rockMid), hex(palette.rockLight)]
          : [hex(palette.grassDark), hex(palette.grassLight), hex(palette.grassMid)];
      for (let k = 0; k < 9; k++) {
        const angle = Math.random() * Math.PI * 2;
        this.fragments.push({
          x: item.x + 0.5,
          y: item.y + 0.4,
          vx: Math.cos(angle) * (0.8 + Math.random() * 1.2),
          vy: -1.8 - Math.random() * 1.6,
          age: 0,
          colour: colours[k % colours.length] as number,
        });
      }
    }
    const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
    const colour = hex(this.art.palette.sand);
    const count = this.art.effects.landingDustPerEdge;
    for (const cell of cells) {
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        if (inPiece.has(`${cell.x + dx},${cell.y + dy}`)) continue;
        for (let k = 0; k < count; k++) {
          const along = Math.random() - 0.5;
          this.fragments.push({
            x: cell.x + 0.5 + dx * 0.5 + (dy === 0 ? 0 : along),
            y: cell.y + 0.5 + dy * 0.5 + (dx === 0 ? 0 : along),
            vx: dx * (0.6 + Math.random() * 0.8),
            vy: dy * (0.6 + Math.random() * 0.8) - 0.8,
            age: 0,
            colour,
          });
        }
      }
    }
  }

  /**
   * A mason walks off from a piece just laid, out of one of its open sides onto ground with
   * nothing built on it, if it has one.
   */
  private sendMason(cells: readonly Cell[]): void {
    const state = this.board;
    if (state === null || this.art.pixel.masons === 0) return;
    const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
    const exits: { x: number; y: number; dx: number; dy: number }[] = [];
    for (const cell of cells) {
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (inPiece.has(`${nx},${ny}`)) continue;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
        const i = ny * state.width + nx;
        if (state.terrain[i] !== Terrain.Land || state.structure[i] !== Structure.Empty) continue;
        exits.push({ x: cell.x, y: cell.y, dx, dy });
      }
    }
    const exit = exits[Math.floor(Math.random() * exits.length)];
    if (exit === undefined) return;
    const side = (Math.random() - 0.5) * 0.5;
    const speed = 0.55;
    this.masons.push({
      x: exit.x + 0.5 + exit.dx * 0.7 + (exit.dy !== 0 ? side : 0),
      y: exit.y + 0.6 + exit.dy * 0.7 + (exit.dx !== 0 ? side * 0.5 : 0),
      vx: (exit.dx + (exit.dy !== 0 ? side : 0)) * speed,
      vy: exit.dy * speed * 0.8 + (exit.dx !== 0 ? side * 0.2 : 0),
      age: 0,
    });
    if (this.masons.length > this.art.pixel.masons) this.masons.shift();
  }

  /** Rings on the water, and spray thrown up and falling back. */
  private splash(x: number, y: number): void {
    this.splashes.push({ x, y, age: 0 });
    const colour = hex(this.art.palette.waterFoam);
    for (let k = 0; k < 8; k++) {
      const angle = Math.random() * Math.PI * 2;
      this.fragments.push({
        x: x + 0.5,
        y: y + 0.5,
        vx: Math.cos(angle) * (0.8 + Math.random()),
        vy: -2.2 - Math.random() * 1.8,
        age: 0,
        colour,
      });
    }
  }

  /** Earth thrown up by a shot that hit open ground. */
  private dust(x: number, y: number): void {
    const colours = [hex(this.art.palette.sand), hex(this.art.palette.craterMid)];
    for (let k = 0; k < 7; k++) {
      this.fragments.push({
        x: x + 0.5,
        y: y + 0.5,
        vx: (Math.random() - 0.5) * 3,
        vy: -1.5 - Math.random() * 2,
        age: 0,
        colour: colours[k % 2] as number,
      });
    }
  }

  /** Leaves a scorch mark where a shot came down on land, replacing any older one. */
  private scorch(x: number, y: number): void {
    if (this.terrain === null || x < 0 || y < 0 || x >= this.width) return;
    const index = y * this.width + x;
    if (this.terrain[index] !== Terrain.Land) return;
    this.craters = this.craters.filter((c) => c.index !== index);
    const variant = Math.floor(Math.random() * this.art.generators.fx.craterDecalVariants);
    this.craters.push({ index, variant, round: this.round });
    this.layoutCraters();
  }

  /** The banner takes a swept block: a puff of its stone, lighter than a hit's. */
  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockMid) : playerColour(this.art, block.owner, 'base');
    const count = Math.ceil(this.art.generators.fx.debrisPerTile / 2);
    for (let k = 0; k < count; k++) {
      this.fragments.push({
        x: block.x + 0.2 + Math.random() * 0.6,
        y: block.y + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -1 - Math.random() * 1.2,
        age: 0,
        colour,
      });
    }
  }

  noteShot(shot: Shot): void {
    const angle = this.aims.fire(shot);
    this.fired.set(shot.cannonId, (this.fired.get(shot.cannonId) ?? 0) + 1);
    // Smoke from the muzzle, blown out along the barrel and then drifting off. The
    // shot's origin is the tile at the gun's centre, so the muzzle is half a tile on
    // from there plus the barrel's length.
    const reach = this.art.generators.cannon.barrelLengthPx / this.art.tileSizePx + 0.15;
    const mx = shot.fromX + 0.5 + Math.sin(angle) * reach;
    const my = shot.fromY + 0.5 - Math.cos(angle) * reach;
    if (this.torchlit) this.lights.push({ x: mx, y: my, age: 0 });
    for (let k = 0; k < this.art.generators.fx.muzzleSmokePuffs; k++) {
      const push = 0.4 + Math.random() * 0.5;
      this.puffs.push({
        x: mx,
        y: my,
        vx: Math.sin(angle) * push + (Math.random() - 0.5) * 0.3,
        vy: -Math.cos(angle) * push - 0.25 + (Math.random() - 0.5) * 0.3,
        age: -k * 60,
      });
    }
  }

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();

    this.clock += frame.deltaMs;
    this.phase = state.phase;
    this.board = state;
    this.animateWater(frame.deltaMs);
    this.empty(this.effectLayer);
    this.empty(this.lightLayer);
    this.empty(this.flockLayer);
    this.effectLayer.addChild(
      this.cloudStamps.container,
      this.lightLayer,
      g,
      this.airLight,
      this.airDiscs.container,
    );
    this.age(state);
    this.beamStamps.begin();
    this.groundLight.clear();
    this.airLight.clear();
    this.groundDiscs.begin(view.tile);
    this.airDiscs.begin(view.tile);
    const still = motionReduced();
    this.drawSea(view, frame.deltaMs, still);
    this.drawCorner(state, view, still);
    this.drawClouds(view, frame.deltaMs, still);
    this.drawDaylight(state, view);
    this.drawRain(view, frame.deltaMs, still);
    this.drawSnow(view, frame.deltaMs, still);
    this.drawReflections(state, view, frame.castleSealed, still);
    if (this.torchlit) this.drawTorchlight(state, view, frame);
    if (this.torchlit) this.drawBraziers(state, view);
    this.drawNight(view, frame.deltaMs, still);
    this.beamStamps.end();
    this.drawWindows(state, view, frame);
    this.drawChimneys(state, view, frame, still);
    this.drawSheep(state, view, frame.deltaMs, still);
    this.drawMasons(view, frame.deltaMs);

    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.ruins.draw(
      g,
      view,
      state,
      hex(this.art.palette.rockLight),
      hex(this.art.palette.emberMid),
      frame.deltaMs,
    );
    this.drawChunks(view, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.winnerBanners.draw(g, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawSplashes(view, frame.deltaMs);
    this.drawSmoulders(view, frame.deltaMs);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawInertSmoke(state, view);
    this.drawPuffs(view, frame.deltaMs);
    this.drawBanners(state, view, frame);

    const now = state.tick + frame.tickFraction;
    const trail = this.art.generators.fx.shotTrailLengthPx / this.art.tileSizePx;
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    for (const shot of state.shots) {
      const t = shotProgress(shot, now);
      const x = shot.fromX + (shot.toX - shot.fromX) * t;
      const y = shot.fromY + (shot.toY - shot.fromY) * t;
      // A parabolic lift sells the lob. The shot still lands exactly on impactTick.
      const lift = shotLift(shot, t);

      // A short trail behind the ball along the same arc, of pooled sprites: by day the
      // smoke of the powder, thinning behind it; at Night embers shed by the burning ball,
      // flickering, over a fainter smoke.
      const distance = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
      const back = distance > 0 ? trail / distance : 0;
      const puffs = 4;
      for (let k = puffs; k >= 1; k--) {
        const tk = t - (back * k) / puffs;
        if (tk <= 0) continue;
        const px = shot.fromX + (shot.toX - shot.fromX) * tk + 0.5;
        const py = shot.fromY + (shot.toY - shot.fromY) * tk - shotLift(shot, tk) + 0.5;
        const size = 0.24 + 0.07 * k;
        const puff = this.place(
          this.effectLayer,
          KEY.smoke((shot.id + k) % 2),
          view,
          px - size / 2,
          py - size / 2,
          size,
        );
        puff.tint = this.torchlit ? 0x5a6070 : 0xd8d8dc;
        puff.alpha = (this.torchlit ? 0.3 : 0.55) * (1 - k / (puffs + 1));
      }
      if (this.torchlit) {
        for (let k = 1; k <= 5; k++) {
          const tk = t - (back * k) / 4;
          if (tk <= 0) continue;
          const wobble = Math.sin(this.clock / 50 + k * 2.3 + shot.id);
          const px = shot.fromX + (shot.toX - shot.fromX) * tk + 0.5 + wobble * 0.1;
          const py =
            shot.fromY + (shot.toY - shot.fromY) * tk - shotLift(shot, tk) + 0.5 + k * 0.03;
          const size = 0.3 * (1 - k * 0.1);
          const spark = this.place(
            this.effectLayer,
            KEY.ember,
            view,
            px - size / 2,
            py - size / 2,
            size,
          );
          spark.alpha = Math.max(0, (1 - k / 6) * (0.75 + 0.25 * wobble));
        }
      }

      // Height sold twice: the ball grows as it nears the top of its arc, as if
      // coming toward the viewer, and its shadow on the ground shrinks and fades.
      const height = Math.min(1, lift / 3);
      const shadow = view.tile * 0.25 * (1 - 0.45 * height);
      g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), shadow);
      g.fill({ color: hex(this.art.palette.shadow), alpha: 0.4 - 0.2 * height });

      const size = 0.6 * (1 + 0.55 * height);
      const ball = this.place(
        this.effectLayer,
        this.torchlit ? KEY.burningShot : KEY.shot,
        view,
        0,
        0,
        size,
      );
      ball.x = tileX(view, x + 0.5) - (view.tile * size) / 2;
      ball.y = tileY(view, y + 0.5 - lift) - (view.tile * size) / 2;
      if (this.torchlit) {
        // Burning shot, glowing as it goes.
        const glow = view.tile * this.art.night.shotGlowTiles;
        const bx = tileX(view, x + 0.5);
        const by = tileY(view, y + 0.5 - lift);
        this.airDiscs.disc(bx, by, glow, hex(this.art.palette.emberMid), 0.28);
        this.airDiscs.disc(bx, by, glow * 0.5, hex(this.art.palette.emberHot), 0.35);
      }

      drawShotTarget(g, view, shot, t, this.art, frame.humanPlayer);
    }

    const frames = this.art.generators.fx.explosionFrames;
    const perFrame = this.art.generators.fx.explosionMsPerFrame;
    for (const blast of this.blasts) {
      blast.age += frame.deltaMs;
      const index = Math.floor(blast.age / perFrame);
      if (index >= frames) continue;
      this.place(this.effectLayer, KEY.blast(index), view, blast.x - 0.5, blast.y - 0.5, 2);
    }
    this.blasts = this.blasts.filter((b) => b.age < frames * perFrame);

    // Fragments arc up and fall back under a little gravity, fading as they go.
    const life = this.art.generators.fx.debrisMs;
    const dt = frame.deltaMs / 1000;
    for (const f of this.fragments) {
      f.age += frame.deltaMs;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 9 * dt;
      const size = Math.max(1, view.tile * 0.16);
      g.rect(tileX(view, f.x) - size / 2, tileY(view, f.y) - size / 2, size, size);
      g.fill({ color: f.colour, alpha: Math.max(0, 1 - f.age / life) });
    }
    this.fragments = this.fragments.filter((f) => f.age < life);
    this.groundDiscs.end();
    this.airDiscs.end();
  }

  /**
   * Life on the sea: glints winking where the light catches it, and wave crests forming
   * on open water, drifting with the wind and breaking up. Both are born at random, at a
   * rate per tile of sea, so a large map is no busier than a small one. A glint is a
   * flicker, so there are none when motion is reduced; nor crests, which drift.
   */
  private drawSea(view: ViewTransform, deltaMs: number, still: boolean): void {
    const g = this.seaGfx;
    g.clear();
    if (still) {
      this.glints = [];
      this.crests = [];
      return;
    }
    const style = this.art.pixel;
    const spawn = (cells: Cell[], rate: number, life: number, into: Glint[]): void => {
      let due = cells.length * rate * (deltaMs / 1000);
      while (due > 0 && cells.length > 0) {
        if (due < 1 && Math.random() >= due) break;
        const cell = cells[Math.floor(Math.random() * cells.length)] as Cell;
        into.push({ x: cell.x + Math.random(), y: cell.y + Math.random(), age: 0, life });
        due -= 1;
      }
    };
    spawn(this.seaCells, style.glintsPerTileSecond, style.glintMs, this.glints);
    spawn(this.openSea, style.crestsPerTileSecond, style.crestMs, this.crests);

    // One sprite pixel at the size the board is drawn, so the sea's life is pixel art too.
    const px = Math.max(1, Math.round(view.tile / this.art.tileSizePx));
    const light = hex(this.art.palette.uiInk);
    for (const glint of this.glints) {
      glint.age += deltaMs;
      const bright = Math.sin(Math.PI * Math.min(1, glint.age / glint.life));
      const x = Math.round(tileX(view, glint.x));
      const y = Math.round(tileY(view, glint.y));
      g.rect(x - px, y, px * 3, px);
      g.rect(x, y - px, px, px * 3);
      g.fill({ color: light, alpha: 0.35 * bright });
      g.rect(x, y, px, px);
      g.fill({ color: light, alpha: 0.8 * bright });
    }
    this.glints = this.glints.filter((glint) => glint.age < glint.life);

    for (const ripple of this.ripples) {
      ripple.age += deltaMs;
      const t = Math.min(1, ripple.age / ripple.life);
      g.ellipse(
        tileX(view, ripple.x),
        tileY(view, ripple.y),
        view.tile * 0.25 * t + px,
        view.tile * 0.1 * t + px,
      );
      g.stroke({ width: px, color: light, alpha: 0.35 * (1 - t) });
    }
    this.ripples = this.ripples.filter((ripple) => ripple.age < ripple.life);

    const wind = this.art.pixel.windTilesPerSecond * (deltaMs / 1000);
    const foam = hex(this.art.palette.waterFoam);
    const deep = hex(this.art.palette.waterDeep);
    for (const crest of this.crests) {
      crest.age += deltaMs;
      crest.x += wind * WIND_X;
      crest.y += wind * WIND_Y;
      const t = crest.age / crest.life;
      const strength = Math.sin(Math.PI * Math.min(1, t));
      // A crest: a lit line over the shade of its trough, lengthening as it forms and
      // fading as it breaks. An arc, tried first, read as a gull.
      const half = Math.round(view.tile * (0.3 + 0.35 * strength));
      const cx = Math.round(tileX(view, crest.x));
      const cy = Math.round(tileY(view, crest.y));
      g.rect(cx - half, cy, half * 2, px);
      g.fill({ color: foam, alpha: 0.45 * strength });
      g.rect(cx - Math.round(half * 0.6), cy + px, Math.round(half * 1.2), px);
      g.fill({ color: deep, alpha: 0.5 * strength });
    }
    this.crests = this.crests.filter((crest) => crest.age < crest.life);
    this.ocean.draw(g, view, this.art, deltaMs);
  }

  /**
   * The shadows of clouds passing over, drifting with the wind across everything drawn
   * and round again. Soft-edged: each blob is six discs, each inside the last, and
   * where blobs overlap the shadow deepens as a cloud thickens in its middle. Night has
   * none — there is no sun to cast them. Still when motion is reduced, not gone.
   */
  private drawClouds(view: ViewTransform, deltaMs: number, still: boolean): void {
    const stamps = this.cloudStamps;
    stamps.begin();
    this.cloudsOf(view, deltaMs, still);
    stamps.end();
  }

  private cloudsOf(view: ViewTransform, deltaMs: number, still: boolean): void {
    if (this.torchlit) return;
    const style = this.art.pixel;
    const { x0, y0, x1, y1 } = this.drawn;
    const spanX = x1 - x0;
    const spanY = y1 - y0;
    if (spanX <= 0 || spanY <= 0) return;
    // An overcast or rainy match has more of them and darker; fog is clouds on the water,
    // pale banks drifting instead of shadows.
    const heavy = this.weather === 'overcast' || this.weather === 'rain' || this.weather === 'snow';
    const fog = this.weather === 'fog';
    const wanted = Math.round(
      (spanX * spanY * style.cloudsPerThousandTiles * (heavy ? 2.5 : fog ? 1.6 : 1)) / 1000,
    );
    if (this.clouds.length !== wanted) {
      this.cloudSet++;
      const [small, large] = style.cloudTiles;
      this.clouds = Array.from({ length: wanted }, () => {
        const size = small + Math.random() * (large - small);
        // Wider than tall, as clouds' shadows fall, from a spread of blobs.
        const blobs = Array.from({ length: 6 + Math.floor(Math.random() * 4) }, () => ({
          dx: (Math.random() - 0.5) * size * 1.1,
          dy: (Math.random() - 0.5) * size * 0.35,
          r: size * (0.14 + Math.random() * 0.14),
        }));
        return { x: x0 + Math.random() * spanX, y: y0 + Math.random() * spanY, blobs, reach: size };
      });
    }
    const drift = still ? 0 : style.windTilesPerSecond * (deltaMs / 1000);
    const colour = hex(fog ? this.art.palette.uiInk : this.art.palette.shadow);
    const rings = [1, 0.86, 0.72, 0.58, 0.44, 0.3];
    const alpha = (style.cloudShadowAlpha * (heavy ? 1.25 : fog ? 1.1 : 1)) / rings.length;
    for (const [n, cloud] of this.clouds.entries()) {
      cloud.x += drift * WIND_X;
      cloud.y += drift * WIND_Y;
      // Round again once wholly past the far edge, entering from the near one.
      if (cloud.x - cloud.reach > x1) cloud.x -= spanX + cloud.reach * 2;
      if (cloud.y - cloud.reach > y1) cloud.y -= spanY + cloud.reach * 2;
      const shadow = this.cloudBook.get(`${this.cloudSet}|${n}`, view.tile, (g) => {
        for (const blob of cloud.blobs) {
          for (const k of rings) {
            g.circle(view.tile * blob.dx, view.tile * blob.dy, view.tile * blob.r * k);
            g.fill({ color: colour, alpha });
          }
        }
      });
      this.cloudStamps.place(shadow, tileX(view, cloud.x), tileY(view, cloud.y));
    }
  }

  /**
   * The light of the day, and the grey of an overcast sky, laid over the ground and the
   * sea in the territory layer — under the walls, so no player's colour moves with it.
   * Night keeps its own light.
   */
  private drawDaylight(state: MatchState, view: ViewTransform): void {
    const g = this.daylightGfx;
    g.clear();
    if (this.torchlit) return;
    const { x0, y0, x1, y1 } = this.drawn;
    const area = (): void => {
      g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * view.tile, (y1 - y0) * view.tile);
    };
    const day = daylight(
      state.round,
      state.ruleset.scoring.maxRounds,
      this.art.pixel.daylightAlpha,
    );
    if (day.alpha > 0) {
      area();
      g.fill({ color: day.colour, alpha: day.alpha });
    }
    if (this.weather === 'overcast' || this.weather === 'rain' || this.weather === 'snow') {
      area();
      g.fill({ color: hex(this.art.palette.rockDark), alpha: 0.12 });
    }
  }

  /** The corner's piece: the windmill by day, the fishing boat at Night. */
  private drawCorner(state: MatchState, view: ViewTransform, still: boolean): void {
    const g = this.cornerGfx;
    g.clear();
    const spot = this.corner;
    if (spot === null) return;
    // Laid out on a grid of 40 by 40 of the art's own pixels, the spot's square, each as
    // many of the screen's as keeps it pixel art at any size.
    const s = spot.size * view.tile;
    const p = Math.max(1, Math.round(s / 40));
    const left = Math.round(tileX(view, spot.x) - 20 * p);
    const top = Math.round(tileY(view, spot.y) - 20 * p);
    const dot = (x: number, y: number, w = 1, h = 1): void => {
      g.rect(left + Math.round(x) * p, top + Math.round(y) * p, w * p, h * p);
    };
    if (this.torchlit) this.drawFishingBoat(state, still, dot, left, top, p);
    else this.drawWindmill(dot, still);
  }

  /**
   * Medieval's windmill on a rocky islet: a tapered stone tower under a wooden cap, its four
   * sails of cloth on their frames turning — quicker in rain — drawn a pixel at a time as
   * they turn, so they stay pixel art at any angle; and its reflection in the sea below,
   * as the castles on a south coast have theirs.
   */
  private drawWindmill(
    dot: (x: number, y: number, w?: number, h?: number) => void,
    still: boolean,
  ): void {
    const g = this.cornerGfx;
    const { palette } = this.art;
    const turnMs =
      this.weather === 'rain' ? this.art.pixel.windmillRainTurnMs : this.art.pixel.windmillTurnMs;
    // The reflection, three wavering strips under the islet.
    for (let k = 0; k < 3; k++) {
      const shift = still ? 0 : Math.round(Math.sin(this.clock / 420 + k * 1.3));
      dot(15 + shift + k, 38 + k, 10 - 2 * k, 1);
      g.fill({ color: hex(palette.rockLight), alpha: 0.28 - k * 0.08 });
    }
    // The islet: grey rock, darker at the waterline, grass on its top.
    dot(10, 34, 20, 3);
    dot(12, 33, 16, 1);
    g.fill({ color: hex(palette.rockMid) });
    dot(11, 37, 18, 1);
    g.fill({ color: hex(palette.rockDark) });
    dot(14, 32, 12, 1);
    g.fill({ color: hex(palette.grassMid) });
    // The tower, narrowing as it rises, shaded on its west side.
    for (let y = 14; y <= 32; y++) {
      const half = 3 + Math.round(((y - 14) / 18) * 2);
      dot(20 - half, y, half * 2, 1);
    }
    g.fill({ color: hex(palette.rockLight) });
    for (let y = 14; y <= 32; y++) dot(20 - 3 - Math.round(((y - 14) / 18) * 2), y, 1, 1);
    g.fill({ color: hex(palette.rockMid) });
    // Its door and a window.
    dot(19, 28, 2, 4);
    dot(20, 21, 1, 2);
    g.fill({ color: hex(palette.craterDark) });
    // The cap, a wooden roof.
    for (let k = 0; k < 5; k++) dot(15 + k, 14 - k, 10 - 2 * k, 1);
    g.fill({ color: hex(palette.craterMid) });
    dot(15, 14, 10, 1);
    g.fill({ color: hex(palette.craterDark) });
    // The sails: four arms from the hub, cloth along the outer part of each, one side.
    const turn = still ? 0.4 : (this.clock / turnMs) * Math.PI * 2;
    const hub = { x: 20, y: 13 };
    for (let arm = 0; arm < 4; arm++) {
      const a = turn + (arm * Math.PI) / 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      for (let d = 5; d <= 16; d++) {
        for (let e = 1; e <= 3; e++) dot(hub.x + dx * d - dy * e, hub.y + dy * d + dx * e);
      }
      g.fill({ color: hex(palette.uiInk), alpha: 0.92 });
      for (let d = 0; d <= 16; d++) dot(hub.x + dx * d, hub.y + dy * d);
      g.fill({ color: hex(palette.craterDark) });
    }
    dot(hub.x, hub.y);
    g.fill({ color: hex(palette.rockDark) });
  }

  /**
   * Night's fishing boat at anchor, rocking on the swell: a cabin with its window lit, a
   * furled sail, and two lanterns — one swaying from the yard — each lighting the water
   * under it as the torches light the ground, and flaring in the final round.
   */
  private drawFishingBoat(
    state: MatchState,
    still: boolean,
    dot: (x: number, y: number, w?: number, h?: number) => void,
    left: number,
    top: number,
    p: number,
  ): void {
    const g = this.cornerGfx;
    const { palette } = this.art;
    const bob = still ? 0 : Math.round(Math.sin(this.clock / 1700));
    const flare = inFinalRound(state) ? 1.5 : 1;
    const swing = still
      ? 0
      : 0.35 * Math.sin((this.clock / this.art.pixel.lanternSwingMs) * Math.PI * 2);
    const lanterns = [
      { x: 27 + Math.sin(swing) * 5, y: 11 + bob + Math.cos(swing) * 5 },
      { x: 10, y: 20 + bob },
    ];
    // The lanterns' light on the water, under the boat, and their reflections in it:
    // drawn here rather than with the torches' pools, which lie over the terrain and so
    // over the hull.
    for (const lantern of lanterns) {
      for (const [r, alpha] of [
        [9, 0.06],
        [6, 0.08],
        [3.5, 0.1],
      ] as const) {
        g.ellipse(left + (lantern.x + 0.5) * p, top + 33 * p, r * p * flare, r * 0.4 * p * flare);
        g.fill({ color: hex(palette.emberHot), alpha: alpha * flare });
      }
      for (let k = 0; k < 3; k++) {
        const wobble = still ? 0 : Math.round(Math.sin(this.clock / 260 + k * 1.9 + lantern.x));
        dot(lantern.x - 1 + wobble, 34 + k * 2, k === 2 ? 2 : 3, 1);
      }
      g.fill({ color: hex(palette.emberMid), alpha: 0.5 });
    }
    // The anchor's line, slanting down into the water from the bow.
    for (let k = 0; k < 6; k++) dot(32 + k, 30 + bob + k);
    g.fill({ color: hex(palette.craterDark), alpha: 0.6 });
    // The hull: a dark gunwale, planks, the keel's shadow; the bow raised.
    dot(8, 28 + bob, 25, 1);
    dot(31, 26 + bob, 2, 2);
    g.fill({ color: hex(palette.craterDark) });
    dot(9, 29 + bob, 23, 2);
    dot(11, 31 + bob, 19, 1);
    g.fill({ color: hex(palette.craterMid) });
    dot(13, 32 + bob, 15, 1);
    g.fill({ color: hex(palette.shadow) });
    // Moonlight along the gunwale and down the mast, or the hull is lost in the dark sea.
    dot(8, 27 + bob, 24, 1);
    dot(23, 8 + bob, 1, 15);
    g.fill({ color: hex(palette.uiInk), alpha: 0.35 });
    // The cabin, its window lit.
    dot(12, 23 + bob, 7, 5);
    g.fill({ color: hex(palette.rockMid) });
    dot(14, 25 + bob, 3, 2);
    g.fill({ color: hex(palette.emberHot) });
    // The mast, the yard and its sail furled on it, and a pole at the stern.
    dot(22, 8 + bob, 1, 20);
    dot(16, 11 + bob, 12, 1);
    dot(10, 21 + bob, 1, 7);
    g.fill({ color: hex(palette.craterDark) });
    dot(17, 12 + bob, 10, 1);
    g.fill({ color: hex(palette.rockLight) });
    // The lanterns: one hanging from the yard's end on its rope, swinging; one on the
    // stern's pole; a halo round each flame.
    for (let k = 1; k <= 4; k++) dot(27 + Math.sin(swing) * k, 11 + bob + Math.cos(swing) * k);
    g.fill({ color: hex(palette.craterDark) });
    for (const lantern of lanterns) {
      dot(lantern.x - 0.5, lantern.y - 1, 2, 1);
      g.fill({ color: hex(palette.craterDark) });
      dot(lantern.x - 0.5, lantern.y, 2, 2);
      g.fill({ color: hex(palette.emberHot) });
      const x = left + (lantern.x + 0.5) * p;
      const y = top + (lantern.y + 1) * p;
      this.airDiscs.disc(x, y, p * 2.5 * flare, hex(palette.emberHot), 0.18 * flare);
    }
  }

  /**
   * Rain in a rainy match: fine streaks slanting with the wind over everything, and
   * rings where drops strike the sea. None when motion is reduced.
   */
  private drawRain(view: ViewTransform, deltaMs: number, still: boolean): void {
    if (this.weather !== 'rain' || still) {
      this.rain = [];
      this.ripples = [];
      return;
    }
    const g = this.effectGfx;
    const { x0, y0, x1, y1 } = this.drawn;
    this.drawThunder(view, deltaMs);
    const wanted = Math.round(((x1 - x0) * (y1 - y0) * this.art.pixel.rainPerThousandTiles) / 1000);
    while (this.rain.length < wanted) {
      this.rain.push({
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        speed: 14 + Math.random() * 8,
      });
    }
    const dt = deltaMs / 1000;
    for (const drop of this.rain) {
      drop.y += drop.speed * dt;
      drop.x += drop.speed * 0.25 * dt;
      if (drop.y > y1) {
        drop.y = y0;
        drop.x = x0 + Math.random() * (x1 - x0);
      }
      const x = tileX(view, drop.x);
      const y = tileY(view, drop.y);
      g.moveTo(x, y).lineTo(x - view.tile * 0.12, y - view.tile * 0.5);
    }
    g.stroke({ width: 1, color: hex(this.art.palette.rockLight), alpha: 0.3 });
    // Rings where drops strike the sea, as the glints are born.
    const rings = this.seaCells.length * 0.03 * dt;
    for (let k = 0; k < Math.floor(rings) + (Math.random() < rings % 1 ? 1 : 0); k++) {
      const cell = this.seaCells[Math.floor(Math.random() * this.seaCells.length)];
      if (cell !== undefined) {
        this.ripples.push({
          x: cell.x + Math.random(),
          y: cell.y + Math.random(),
          age: 0,
          life: 500,
        });
      }
    }
  }

  /**
   * Reflections in the sea (PLAN 11.15): a wall block or castle with the sea just south
   * of it lies mirrored faintly on the water below, as a few stripes of its owner's
   * colour rippling side to side; at Night a sealed castle's is warm, with its torches.
   * Still under reduced motion.
   */
  private drawReflections(
    state: MatchState,
    view: ViewTransform,
    castleSealed: readonly boolean[],
    still: boolean,
  ): void {
    if (this.terrain === null) return;
    const g = this.effectGfx;
    const t = still ? 0 : performance.now() / 420;
    const water = (x: number, y: number): boolean =>
      y < state.height && this.terrain?.[y * state.width + x] !== Terrain.Land;
    const mirror = (x: number, y: number, w: number, colour: number): void => {
      for (let k = 0; k < 3; k++) {
        const shift = Math.sin(t + x * 0.7 + k * 1.3) * view.tile * 0.08;
        g.rect(
          tileX(view, x) + view.tile * 0.08 + shift,
          tileY(view, y) + view.tile * (0.12 + k * 0.28),
          w * view.tile - view.tile * 0.16,
          Math.max(1, view.tile * 0.12),
        );
        g.fill({ color: colour, alpha: 0.3 - k * 0.08 });
      }
    };
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      if (!water(x, y + 1)) continue;
      const owner = state.owner[i] as number;
      mirror(
        x,
        y + 1,
        1,
        owner === 0 ? hex(this.art.palette.rockLight) : playerColour(this.art, owner - 1, 'base'),
      );
    }
    for (const castle of state.castles) {
      const y = castle.y + castle.h;
      for (let x = castle.x; x < castle.x + castle.w; x++) {
        if (!water(x, y)) continue;
        const lit = this.torchlit && castleSealed[castle.id] === true;
        mirror(
          x,
          y,
          1,
          lit
            ? hex(this.art.palette.emberMid)
            : playerColour(this.art, castle.islandId - 1, 'base'),
        );
      }
    }
  }

  /**
   * Snow, as one of the match's weathers (PLAN 11.15): flakes drifting down slowly over
   * everything, and white lying on the tops of walls and castles — the lie of it drawn
   * even under reduced motion, which stops only the falling.
   */
  private drawSnow(view: ViewTransform, deltaMs: number, still: boolean): void {
    if (this.weather !== 'snow') {
      this.snow = [];
      return;
    }
    const g = this.effectGfx;
    // The snow lying on the walls is drawn with them, in `drawStructures`.
    if (still) {
      this.snow = [];
      return;
    }
    const { x0, y0, x1, y1 } = this.drawn;
    const wanted = Math.round(((x1 - x0) * (y1 - y0) * this.art.pixel.snowPerThousandTiles) / 1000);
    while (this.snow.length < wanted) {
      this.snow.push({
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        speed: 1.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const dt = deltaMs / 1000;
    const r = Math.max(1, view.tile * 0.08);
    for (const flake of this.snow) {
      flake.y += flake.speed * dt;
      flake.phase += dt * 1.7;
      flake.x += Math.sin(flake.phase) * 0.6 * dt;
      if (flake.y > y1) {
        flake.y = y0;
        flake.x = x0 + Math.random() * (x1 - x0);
      }
      g.circle(tileX(view, flake.x), tileY(view, flake.y), r);
    }
    g.fill({ color: 0xffffff, alpha: 0.8 });
  }

  /**
   * Distant thunder in the rain (PLAN 11.15): now and then the whole sky flickers twice,
   * faintly — over everything drawn, so it is weather and never a flash at one spot, which
   * is what an impact is.
   */
  private drawThunder(view: ViewTransform, deltaMs: number): void {
    const [soonest, latest] = this.art.pixel.thunderEveryMs;
    const t = this.thunder;
    if (t.ageMs < 0) {
      if (t.untilMs <= 0) t.untilMs = soonest + Math.random() * (latest - soonest);
      t.untilMs -= deltaMs;
      if (t.untilMs > 0) return;
      t.ageMs = 0;
      t.untilMs = 0;
    }
    t.ageMs += deltaMs;
    // Two flickers, the second the brighter, then gone.
    const at = t.ageMs;
    const flicker = (start: number, span: number): number =>
      at < start || at > start + span ? 0 : 1 - (at - start) / span;
    const light = Math.max(0.6 * flicker(0, 120), flicker(180, 380));
    if (at > 600) t.ageMs = -1;
    if (light <= 0) return;
    const { x0, y0, x1, y1 } = this.drawn;
    const g = this.effectGfx;
    g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * view.tile, (y1 - y0) * view.tile);
    g.fill({ color: 0xe8eeff, alpha: this.art.pixel.thunderAlpha * light });
  }

  /**
   * Night's land and lighthouses, measured when the board is laid out: the tiles of land
   * the fireflies wander, and for each island a lighthouse on the sea off the corner of it
   * farthest from the middle of the map, where it looks out over open water.
   */
  private layoutNight(state: MatchState, view: ViewTransform): void {
    this.land = [];
    this.lighthouses = [];
    this.fireflies = [];
    if (!this.torchlit) return;
    const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      this.land.push({ x, y });
      const id = state.islandId[i] as number;
      const box = boxes.get(id) ?? { x0: x, y0: y, x1: x, y1: y };
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      boxes.set(id, box);
    }
    const mx = state.width / 2;
    const my = state.height / 2;
    const sea = (x: number, y: number): boolean =>
      x < 0 ||
      y < 0 ||
      x >= state.width ||
      y >= state.height ||
      state.terrain[y * state.width + x] !== Terrain.Land;
    for (const box of boxes.values()) {
      const corners: Cell[] = [
        { x: box.x0 - 1, y: box.y0 - 1 },
        { x: box.x1 + 1, y: box.y0 - 1 },
        { x: box.x1 + 1, y: box.y1 + 1 },
        { x: box.x0 - 1, y: box.y1 + 1 },
      ];
      // The tower stands two tiles high, so the tile above its foot must be sea too.
      const far = corners
        .filter((c) => sea(c.x, c.y) && sea(c.x, c.y - 1))
        .sort((a, b) => Math.hypot(b.x - mx, b.y - my) - Math.hypot(a.x - mx, a.y - my))[0];
      if (far !== undefined) this.lighthouses.push(far);
    }
    // Drawn once with the terrain, in its render group: only the lamp's glow and the beam
    // change from frame to frame.
    for (const spot of this.lighthouses) {
      const tower = this.place(this.tileLayer, KEY.lighthouse, view, spot.x, spot.y - 1);
      tower.height = view.tile * 2;
    }
    const count = Math.round((this.land.length * this.art.pixel.firefliesPerHundredTiles) / 100);
    for (let k = 0; k < count; k++) {
      const at = this.land[Math.floor(Math.random() * this.land.length)] as Cell;
      this.fireflies.push({
        x: at.x + Math.random(),
        y: at.y + Math.random(),
        phase: Math.random() * Math.PI * 2,
        drift: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * Night on the sea and land: a path of moonlight shimmering on the outer ocean, fireflies
   * winking over the fields, and a lighthouse off each island whose beam turns slowly over
   * the water — lit into the ground, under the walls, like the torches' pools.
   */
  private drawNight(view: ViewTransform, deltaMs: number, still: boolean): void {
    if (!this.torchlit) return;
    const { palette } = this.art;
    const t = view.tile;
    const px = Math.max(1, Math.round(t / this.art.tileSizePx));
    const sea = this.seaGfx;

    // The moon's path: broken glints of moonlight on the outer ocean, in whichever band of
    // it clear of the land is the deeper, the path widening and fading as it comes nearer.
    // Each glint winks out and back on its own beat, so the path shimmers; a fixed column
    // of grey dashes read as a glitch (the style review). Above the land alone, it was
    // under the HUD bar at three players.
    const bands: number[][] = [];
    for (const y of this.ocean.rows()) {
      const last = bands[bands.length - 1];
      if (last !== undefined && last[last.length - 1] === y - 1) last.push(y);
      else bands.push([y]);
    }
    const rows = bands.sort((a, b) => b.length - a.length)[0] ?? [];
    if (rows.length > 0) {
      const column = tileX(view, this.drawn.x0 + (this.drawn.x1 - this.drawn.x0) * 0.72);
      const lines = rows.length * 3;
      // Three strengths, a fill each, rather than a fill per glint.
      const strengths = [0.18, 0.32, 0.5];
      for (let level = 0; level < strengths.length; level++) {
        for (let line = 0; line < lines; line++) {
          const near = line / Math.max(1, lines - 1);
          const spread = t * (0.4 + near * 1.6);
          const glints = 3 + Math.floor(near * 4);
          for (let d = 0; d < glints; d++) {
            const h = glint(line * 7 + d);
            const shine = still ? 0.6 : Math.sin(this.clock / (380 + h * 400) + h * 40);
            // Brightest down the middle of the path, as the moon's light is.
            const alpha = shine * (1 - near * 0.6) * (1 - Math.abs(h * 2 - 1) * 0.5);
            if (alpha < 0.15) continue;
            const at = alpha > 0.6 ? 2 : alpha > 0.35 ? 1 : 0;
            if (at !== level) continue;
            const length = Math.max(px * 2, Math.round(t * (0.2 + 0.5 * glint(line * 13 + d))));
            const drift = still ? 0 : Math.sin(this.clock / 900 + h * 9) * t * 0.12;
            const x = Math.round(column + (h * 2 - 1) * spread + drift - length / 2);
            const y = Math.round(tileY(view, (rows[0] as number) + (line + 0.5) / 3));
            sea.rect(x, y, length, px);
          }
        }
        sea.fill({ color: 0xdfe8ff, alpha: strengths[level] as number });
      }
    }

    // Lighthouses: the tower is a sprite with the terrain; its lamp glows and its beam turns
    // over the water.
    const turn = still ? 0 : (this.clock / this.art.pixel.beamTurnMs) * Math.PI * 2;
    const fullReach = t * this.art.pixel.beamTiles;
    const beam = this.beamBook.get('beam', t, (g) =>
      drawBeam(g, t, fullReach, this.art.night.beamAlpha),
    );
    // The screen, clear of the HUD bar: the sea is drawn past it, out of sight.
    const bounds = {
      x0: t * 0.5,
      y0: view.top + t * 0.5,
      x1: view.width - t * 0.5,
      y1: view.height - t * 0.5,
    };
    this.lighthouses.forEach((spot, k) => {
      // The lamp room, near the top of the two-tile sprite.
      const cx = tileX(view, spot.x + 0.5);
      const cy = tileY(view, spot.y - 1 + 5 / 16);
      const angle = turn + k * 1.9;
      // Not past the edge of the screen: a lighthouse near it swung its beam off the
      // screen and under the HUD bar (the style review). Shortened whole, so a beam near
      // the edge is a smaller wedge rather than one cut off square.
      const reach = Math.min(fullReach, beamRoom(cx, cy, angle, bounds));
      if (reach > t * 0.5) {
        this.beamStamps.place(beam, cx, cy, {
          rotation: angle,
          scale: reach / fullReach,
          tint: hex(palette.emberHot),
        });
      }
      const pulse = still ? 1 : 0.85 + 0.15 * Math.sin(this.clock / 300 + k);
      this.airDiscs.disc(cx, cy, t * 0.45, hex(palette.emberMid), 0.3 * pulse);
      this.airDiscs.disc(cx, cy, t * 0.2, hex(palette.emberHot), 0.35 * pulse);
    });

    // Fireflies wandering and winking; none when motion is reduced.
    if (still) return;
    const dt = deltaMs / 1000;
    for (const fly of this.fireflies) {
      fly.drift += (Math.random() - 0.5) * 2 * dt;
      fly.x += Math.cos(fly.drift) * 0.3 * dt;
      fly.y += Math.sin(fly.drift) * 0.3 * dt;
      const glow = Math.max(0, Math.sin(this.clock / 700 + fly.phase));
      if (glow <= 0.05) continue;
      const x = tileX(view, fly.x);
      const y = tileY(view, fly.y);
      this.airDiscs.disc(x, y, t * 0.18, 0xd8ff6a, 0.25 * glow);
      this.effectGfx.rect(x, y, px, px);
      this.effectGfx.fill({ color: 0xf0ffb0, alpha: glow });
    }
  }

  /**
   * A sealed castle's windows lit, warm whatever its owner's colour: the sprite is tinted,
   * so the light is drawn over it rather than into it. Dark once breached, like Night's
   * torches — and with them, on Night, a little light spilling out.
   */
  private drawWindows(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const glow = this.art.pixel.windowGlowAlpha;
    const mains = mainCastles(state);
    for (const castle of state.castles) {
      if (!(frame.castleSealed[castle.id] ?? false)) continue;
      // Every window and slit in one sprite, over the castle's own, flickering as one.
      const flicker = 0.85 + 0.15 * Math.sin(this.clock / 230 + castle.id * 1.3);
      const lit = this.place(
        this.lightLayer,
        KEY.lights(mains.has(castle.id)),
        view,
        castle.x,
        castle.y,
        castle.w,
      );
      lit.alpha = glow * flicker;
      if (!this.torchlit) continue;
      const w = castle.w * view.tile;
      const h = castle.h * view.tile;
      // At Night a little light spilling from the keep's windows.
      CASTLE_WINDOWS.slice(0, 2).forEach((window, k) => {
        this.airDiscs.disc(
          tileX(view, castle.x) + (window.x + window.w / 2) * w,
          tileY(view, castle.y) + (window.y + window.h / 2) * h,
          view.tile * 0.32,
          hex(this.art.palette.emberMid),
          0.2 * (0.85 + 0.15 * Math.sin(this.clock / 230 + castle.id * 1.3 + k * 2.1)),
        );
      });
    }
  }

  /**
   * A sealed castle's chimney smokes: a slow wisp rising from the keep's roof, thinning as
   * it goes. A breach stops it — the wisps in the air rise on and thin away, no new one
   * follows — and sealing again starts it, from the chimney up. Pooled sprites of one puff.
   */
  private drawChimneys(
    state: MatchState,
    view: ViewTransform,
    frame: EffectFrame,
    still: boolean,
  ): void {
    const period = this.art.pixel.chimneySmokeMs;
    const tint = this.torchlit ? 0x8a90a0 : 0xe2e2e6;
    for (const castle of state.castles) {
      const sealed = frame.castleSealed[castle.id] ?? false;
      let chimney = this.chimneys.get(castle.id);
      if (chimney === undefined) {
        // As first seen: smoking already if sealed, and nothing in the air if not.
        chimney = { sealed, since: -Infinity };
        this.chimneys.set(castle.id, chimney);
      } else if (chimney.sealed !== sealed) {
        chimney.sealed = sealed;
        chimney.since = this.clock;
      }
      if (!sealed && this.clock - chimney.since > period) continue;
      for (let k = 0; k < 3; k++) {
        const t = still ? (k + 0.5) / 3 : (this.clock / period + k / 3 + castle.id * 0.37) % 1;
        const born = this.clock - t * period;
        if (sealed ? born < chimney.since : born >= chimney.since) continue;
        const x =
          castle.x + CASTLE_CHIMNEY.x * castle.w + Math.sin(t * 5 + castle.id) * 0.06 + t * 0.15;
        const y = castle.y + CASTLE_CHIMNEY.y * castle.h - t * 0.95;
        const size = 0.24 + 0.36 * t;
        const wisp = this.place(
          this.lightLayer,
          KEY.smoke(k % 2),
          view,
          x - size / 2,
          y - size / 2,
          size,
        );
        wisp.tint = tint;
        wisp.alpha = 0.8 * (1 - t) * Math.min(1, t * 6);
      }
    }
  }

  /**
   * Night's braziers, burning on the outer corners of each island's sealed rings with the
   * castle they guard: alight with its torches, out with them at a breach. A small flame of
   * three frames, its light on the wall top, and a faint pool on the ground outside the
   * corner, drawn in the territory layer as the torches' pools are.
   */
  private drawBraziers(state: MatchState, view: ViewTransform): void {
    const glow = this.art.night.brazierGlowAlpha;
    const warm = hex(this.art.palette.emberMid);
    for (const [k, brazier] of this.braziers.entries()) {
      if (state.structure[brazier.index] !== Structure.Wall) continue;
      const bx = brazier.x + 0.5 + brazier.dx * 0.2;
      const by = brazier.y + 0.5 + brazier.dy * 0.2;
      const size = 0.5;
      this.place(this.lightLayer, KEY.brazier, view, bx - size / 2, by - size / 2, size);
      const lit = this.torches.get(brazier.castleId)?.lit ?? 0;
      if (lit <= 0) continue;
      const flicker =
        0.8 +
        0.12 * Math.sin(this.clock / this.art.night.torchFlickerMs + k * 1.7) +
        0.08 * Math.sin(this.clock / 61 + k * 3.1);
      const frameNo = Math.floor(this.clock / 110 + k) % 3;
      const fire = this.place(
        this.lightLayer,
        KEY.flame(frameNo),
        view,
        bx - 0.19,
        by - 0.5,
        0.375,
      );
      fire.height = (view.tile * 0.5 * 8) / 6;
      fire.alpha = lit;
      const x = tileX(view, bx);
      const y = tileY(view, by - 0.2);
      this.airDiscs.disc(x, y, view.tile * 0.5 * flicker, warm, 0.25 * lit * flicker);
      // The pool on the ground beyond the corner, where the wall does not cover it.
      for (const r of [1, 0.6]) {
        this.groundDiscs.disc(
          tileX(view, bx + brazier.dx * 0.4),
          tileY(view, by + brazier.dy * 0.4),
          view.tile * 1.3 * r,
          warm,
          glow * 0.5 * lit * flicker,
        );
      }
    }
  }

  /**
   * Night's braziers placed afresh with the territory: on the outer corners of each sealed
   * ring — a wall block with the ring running on along both sides of it and sealed ground
   * between them, nothing outside it — and no more than `braziersPerIsland` to an island,
   * spread round its rings as far apart as they will go.
   */
  private layoutBraziers(state: MatchState): void {
    this.braziers = [];
    if (!this.torchlit) return;
    const byOwner = new Map<number, RingCorner[]>();
    for (const corner of ringCorners(state)) {
      byOwner.set(corner.owner, [...(byOwner.get(corner.owner) ?? []), corner]);
    }
    for (const [owner, corners] of byOwner) {
      for (const corner of spreadOut(corners, this.art.night.braziersPerIsland, 3)) {
        // It burns with the nearest castle of its island: that castle's ring, as a rule.
        let nearest = Infinity;
        let castleId = -1;
        for (const castle of state.castles) {
          if (castle.islandId !== owner) continue;
          const d = Math.hypot(
            castle.x + castle.w / 2 - corner.x,
            castle.y + castle.h / 2 - corner.y,
          );
          if (d < nearest) {
            nearest = d;
            castleId = castle.id;
          }
        }
        if (castleId >= 0) this.braziers.push({ ...corner, castleId });
      }
    }
  }

  /**
   * Sheep on each island's open land by day, two or three to a flock, placed from the seed
   * so a look made again puts them back where they were; after that they wander as they
   * like. None at Night: they are folded.
   */
  private layoutSheep(state: MatchState): void {
    this.sheep = [];
    if (this.torchlit) return;
    const rng = new Rng((state.seed ^ 0x5bee9) >>> 0);
    const islands = new Map<number, Cell[]>();
    for (let i = 0; i < state.terrain.length; i++) {
      const x = i % state.width;
      const y = (i - x) / state.width;
      if (
        !this.pasture(state, x, y) ||
        !this.pasture(state, x + 1, y) ||
        !this.pasture(state, x, y + 1)
      )
        continue;
      const id = state.islandId[i] as number;
      const list = islands.get(id) ?? [];
      list.push({ x, y });
      islands.set(id, list);
    }
    const [fewest, most] = this.art.pixel.sheepPerIsland;
    for (const [island, cells] of [...islands.entries()].sort((a, b) => a[0] - b[0])) {
      const centre = cells[rng.nextInt(cells.length)] as Cell;
      const near = cells.filter(
        (c) => Math.abs(c.x - centre.x) <= 2 && Math.abs(c.y - centre.y) <= 2,
      );
      const count = fewest + rng.nextInt(Math.max(1, most - fewest + 1));
      for (let k = 0; k < count; k++) {
        const at = near[rng.nextInt(near.length)] as Cell;
        const x = at.x + 0.25 + rng.nextFloat() * 0.5;
        const y = at.y + 0.4 + rng.nextFloat() * 0.4;
        this.sheep.push({
          x,
          y,
          tx: x,
          ty: y,
          speed: 0,
          restMs: rng.nextFloat() * 4000,
          grazing: rng.nextFloat() < 0.6,
          left: rng.nextFloat() < 0.5,
          island,
          stepMs: 0,
        });
      }
    }
  }

  /**
   * Ground a sheep may stand on: open land, nothing built on it and nobody's sealed ground.
   * Kept off the walls, the guns, the castles and the courts, so a sheep never stands where
   * it could be mistaken for part of the game.
   */
  private pasture(state: MatchState, x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return false;
    const i = ty * state.width + tx;
    return (
      state.terrain[i] === Terrain.Land &&
      state.structure[i] === Structure.Empty &&
      (state.territory[i] as number) === 0
    );
  }

  /**
   * The sheep: ambling a tile or two, then grazing a while, then on again; running from a
   * shot landing near (`noteImpact`), and moving off at once from ground built on or
   * sealed under them, or out of sight if there is no pasture left near.
   */
  private drawSheep(state: MatchState, view: ViewTransform, deltaMs: number, still: boolean): void {
    if (this.torchlit) return;
    const dt = deltaMs / 1000;
    const amble = this.art.pixel.sheepTilesPerSecond;
    const w = (view.tile * 12) / 16;
    const h = (view.tile * 10) / 16;
    for (const sheep of this.sheep) {
      if (!this.pasture(state, sheep.x, sheep.y) && !this.pasture(state, sheep.tx, sheep.ty)) {
        const refuge = this.nearestPasture(state, sheep);
        if (refuge === null) continue;
        sheep.tx = refuge.x;
        sheep.ty = refuge.y;
        sheep.speed = amble * 4;
      }
      const dx = sheep.tx - sheep.x;
      const dy = sheep.ty - sheep.y;
      const d = Math.hypot(dx, dy);
      const moving = d > 0.02 && !still;
      if (moving) {
        const stepTiles = Math.min(d, sheep.speed * dt);
        const nx = sheep.x + (dx / d) * stepTiles;
        const ny = sheep.y + (dy / d) * stepTiles;
        // Not on into ground built on since it set off, unless it is leaving such ground.
        if (this.pasture(state, sheep.x, sheep.y) && !this.pasture(state, nx, ny)) {
          sheep.tx = sheep.x;
          sheep.ty = sheep.y;
        } else {
          sheep.x = nx;
          sheep.y = ny;
        }
        sheep.left = dx < 0;
        sheep.stepMs += deltaMs * (sheep.speed / amble);
      } else if (!still) {
        sheep.restMs -= deltaMs;
        if (sheep.restMs <= 0) this.wander(state, sheep, amble);
      }
      const pose = moving ? 1 + (Math.floor(sheep.stepMs / 180) % 2) : sheep.grazing ? 3 : 0;
      const sprite = this.place(this.flockLayer, KEY.sheep(pose, sheep.left), view, 0, 0);
      sprite.width = w;
      sprite.height = h;
      sprite.x = Math.round(tileX(view, sheep.x) - w / 2);
      sprite.y = Math.round(tileY(view, sheep.y) - h * 0.85);
    }
  }

  /** A sheep moves on: somewhere a tile or two off it can walk to over open pasture. */
  private wander(state: MatchState, sheep: Sheep, amble: number): void {
    sheep.restMs = 2500 + Math.random() * 6000;
    sheep.grazing = Math.random() < 0.65;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = 0.6 + Math.random() * 1.4;
      const tx = sheep.x + Math.cos(angle) * reach;
      const ty = sheep.y + Math.sin(angle) * reach * 0.7;
      if (!this.walkable(state, sheep, tx, ty)) continue;
      sheep.tx = tx;
      sheep.ty = ty;
      sheep.speed = amble * (0.8 + Math.random() * 0.4);
      return;
    }
  }

  /** Whether the way from a sheep to (`tx`, `ty`) is pasture of its own island all along. */
  private walkable(state: MatchState, sheep: Sheep, tx: number, ty: number): boolean {
    for (let k = 1; k <= 4; k++) {
      const x = sheep.x + ((tx - sheep.x) * k) / 4;
      const y = sheep.y + ((ty - sheep.y) * k) / 4;
      if (!this.pasture(state, x, y)) return false;
      if ((state.islandId[Math.floor(y) * state.width + Math.floor(x)] as number) !== sheep.island)
        return false;
    }
    return true;
  }

  /** The middle of the nearest tile of pasture on a sheep's island, within a few tiles. */
  private nearestPasture(state: MatchState, sheep: Sheep): Cell | null {
    const sx = Math.floor(sheep.x);
    const sy = Math.floor(sheep.y);
    for (let r = 1; r <= 5; r++) {
      let best: Cell | null = null;
      let bestD = Infinity;
      for (let y = sy - r; y <= sy + r; y++) {
        for (let x = sx - r; x <= sx + r; x++) {
          if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) !== r) continue;
          if (!this.pasture(state, x, y)) continue;
          if ((state.islandId[y * state.width + x] as number) !== sheep.island) continue;
          const d = Math.hypot(x + 0.5 - sheep.x, y + 0.6 - sheep.y);
          if (d < bestD) {
            bestD = d;
            best = { x: x + 0.5, y: y + 0.6 };
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** Sheep near a shot coming down run from it, as far as open pasture goes that way. */
  private scatter(x: number, y: number): void {
    const state = this.board;
    if (state === null) return;
    const run = this.art.pixel.sheepTilesPerSecond * 5;
    for (const sheep of this.sheep) {
      const dx = sheep.x - (x + 0.5);
      const dy = sheep.y - (y + 0.5);
      const d = Math.hypot(dx, dy);
      if (d > 3.5) continue;
      const ux = d > 0.01 ? dx / d : Math.random() - 0.5;
      const uy = d > 0.01 ? dy / d : Math.random() - 0.5;
      let reach = 0;
      for (let step = 0.25; step <= 2.5; step += 0.25) {
        if (!this.walkable(state, sheep, sheep.x + ux * step, sheep.y + uy * step)) break;
        reach = step;
      }
      if (reach === 0) continue;
      sheep.tx = sheep.x + ux * reach;
      sheep.ty = sheep.y + uy * reach;
      sheep.speed = run;
      sheep.restMs = 1500 + Math.random() * 1500;
      sheep.grazing = false;
    }
  }

  /**
   * Masons at a piece just laid: one comes from it with his hod on his shoulder and walks
   * off over open ground, fading as he goes. Under the walls, so a wall hides him rather
   * than he it; at most `masons` at once, the oldest going first.
   */
  private drawMasons(view: ViewTransform, deltaMs: number): void {
    const life = this.art.pixel.masonMs;
    const dt = deltaMs / 1000;
    const w = (view.tile * 8) / 16;
    const h = (view.tile * 12) / 16;
    for (const mason of this.masons) {
      mason.age += deltaMs;
      mason.x += mason.vx * dt;
      mason.y += mason.vy * dt;
      const frameNo = Math.floor(mason.age / 140) % 2;
      const sprite = this.place(this.flockLayer, KEY.mason(frameNo, mason.vx < 0), view, 0, 0);
      sprite.width = w;
      sprite.height = h;
      sprite.x = Math.round(tileX(view, mason.x) - w / 2);
      sprite.y = Math.round(tileY(view, mason.y) - h * 0.9);
      sprite.alpha = Math.min(1, mason.age / 150, (life - mason.age) / 400);
    }
    this.masons = this.masons.filter((mason) => mason.age < life);
  }

  /**
   * Chunks of a shot-away block: thrown up and out, bouncing once where they come down,
   * then lying as rubble with their shadows until they fade, over the time the breach
   * smoulders.
   */
  private drawChunks(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const dt = deltaMs / 1000;
    const span = this.art.generators.fx.smoulderMs;
    const light = hex(this.art.palette.rockLight);
    for (const c of this.chunks) {
      c.age += deltaMs;
      if (c.z > 0 || c.vz > 0) {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.vz -= 9 * dt;
        if (c.z <= 0) {
          // One bounce, losing most of its way, then still.
          c.z = 0;
          c.vz = Math.abs(c.vz) > 1.5 ? Math.abs(c.vz) * 0.3 : 0;
          c.vx *= 0.4;
          c.vy *= 0.4;
          if (c.vz === 0) c.vx = c.vy = 0;
        }
      }
      const fade = Math.min(1, Math.max(0, (span - c.age) / (span * 0.3)));
      const s = view.tile * c.size;
      const x = tileX(view, c.x) - s / 2;
      const y = tileY(view, c.y - c.z) - s / 2;
      g.ellipse(tileX(view, c.x), tileY(view, c.y) + s * 0.4, s * 0.6, s * 0.3);
      g.fill({ color: hex(this.art.palette.shadow), alpha: 0.35 * fade });
      g.rect(x, y, s, s);
      g.fill({ color: c.colour, alpha: fade });
      g.rect(x, y, s, Math.max(1, s * 0.3));
      g.fill({ color: light, alpha: 0.5 * fade });
    }
    this.chunks = this.chunks.filter((c) => c.age < span);
  }

  /** Whether this is Night, which is lit by torches; the pixel style is not. */
  private get torchlit(): boolean {
    return this.id === 'night';
  }

  /**
   * Night's torchlight. Every sealed castle has two torches flanking its gate and a warm
   * pool of light on the ground round them, so a lit castle reads as sealed and a dark
   * one as breached across the map: a breach douses them with a puff of smoke, and
   * sealing again lights them. Muzzle flashes light the ground round a gun for a moment,
   * and a smouldering breach glows as long as its embers do.
   */
  private drawTorchlight(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const night = this.art.night;
    const { palette } = this.art;
    const g = this.effectGfx;
    const warm = hex(palette.emberMid);
    const pool = (x: number, y: number, radius: number, alpha: number): void => {
      // Three discs, each inside the last, so the light is brightest at its heart.
      for (const k of [1, 0.66, 0.36]) {
        this.groundDiscs.disc(
          tileX(view, x),
          tileY(view, y),
          view.tile * radius * k,
          warm,
          alpha * 0.4,
        );
      }
    };
    const flicker = (seed: number): number =>
      0.8 +
      0.12 * Math.sin(this.clock / night.torchFlickerMs + seed * 1.7) +
      0.08 * Math.sin(this.clock / (night.torchFlickerMs * 0.43) + seed * 3.1);

    for (const castle of state.castles) {
      const sealed = frame.castleSealed[castle.id] ?? false;
      const torch = this.torches.get(castle.id) ?? { lit: sealed ? 1 : 0, sealed };
      const spots = [-1, 1].map((side) => ({
        x: castle.x + castle.w / 2 + side * castle.w * 0.3,
        y: castle.y + castle.h * 0.78,
      }));
      const next = nextTorch(torch, sealed, frame.deltaMs, night.torchIgniteMs);
      if (next.doused) {
        // Doused: a puff of smoke from each torch as it goes out.
        for (const spot of spots) {
          for (let k = 0; k < 3; k++) {
            this.puffs.push({
              x: spot.x,
              y: spot.y - 0.3,
              vx: (Math.random() - 0.5) * 0.3,
              vy: -0.5 - Math.random() * 0.3,
              age: -k * 70,
            });
          }
        }
      }
      torch.sealed = next.sealed;
      torch.lit = next.lit;
      this.torches.set(castle.id, torch);
      if (torch.lit <= 0) continue;

      spots.forEach((spot, k) => {
        const f = flicker(castle.id * 2 + k) * torch.lit;
        pool(
          spot.x,
          spot.y + 0.3,
          (night.torchPoolTiles / 2) * (0.92 + 0.08 * f),
          night.torchGlowAlpha * f,
        );
        // The torch: a short stave, and its flame swaying a little as it burns.
        const sx = tileX(view, spot.x);
        const sy = tileY(view, spot.y);
        const t = view.tile;
        g.rect(sx - t * 0.04, sy - t * 0.15, t * 0.08, t * 0.3);
        g.fill({ color: hex(palette.rockDark) });
        const sway = Math.sin(this.clock / (night.torchFlickerMs * 1.9) + k * 2) * t * 0.03;
        const fx = sx + sway;
        const fy = sy - t * 0.25;
        g.circle(fx, fy, t * 0.16 * f);
        g.fill({ color: warm, alpha: 0.95 });
        g.circle(fx, fy + t * 0.03, t * 0.08 * f);
        g.fill({ color: hex(palette.emberHot) });
        this.airDiscs.disc(fx, fy, t * 0.55 * f, warm, 0.28 * f);
      });
    }

    const span = night.muzzleLightMs;
    for (const light of this.lights) {
      light.age += frame.deltaMs;
      const k = light.age / span;
      if (k < 1)
        pool(light.x, light.y, night.muzzleLightTiles / 2, night.torchGlowAlpha * 1.4 * (1 - k));
    }
    this.lights = this.lights.filter((light) => light.age < span);

    const smoulder = this.art.generators.fx.smoulderMs;
    for (const s of this.smoulders) {
      const life = 1 - s.age / smoulder;
      if (life > 0)
        pool(s.x + 0.5, s.y + 0.5, 0.75, night.breachGlowAlpha * life * flicker(s.seed * 10));
    }
  }

  /** Two rings spreading and fading on the water where a shot went in. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.generators.fx.splashMs;
    const foam = hex(this.art.palette.waterFoam);
    const white = hex(this.art.palette.uiInk);
    for (const splash of this.splashes) {
      splash.age += deltaMs;
      const cx = tileX(view, splash.x + 0.5);
      const cy = tileY(view, splash.y + 0.5);
      // The plume where it went in, gone in the first third.
      const plume = splash.age / span / 0.35;
      if (plume < 1) {
        g.circle(cx, cy - view.tile * 0.25 * plume, view.tile * 0.32 * (1 - plume * 0.6));
        g.fill({ color: white, alpha: 0.85 * (1 - plume) });
      }
      for (const [lag, colour] of [
        [0, white],
        [0.3, foam],
      ] as const) {
        const t = splash.age / span - lag;
        if (t <= 0 || t >= 1) continue;
        g.ellipse(cx, cy, view.tile * (0.25 + 0.95 * t), view.tile * (0.15 + 0.6 * t));
        g.stroke({ width: Math.max(2, view.tile / 7), color: colour, alpha: 0.9 * (1 - t) });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < span * 1.3);
  }

  /**
   * A breach smoulders for a while: smoke curling up from it and embers winking at the
   * ground, dying away together. It marks where the wall was hit long after the blast.
   */
  private drawSmoulders(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.generators.fx.smoulderMs;
    // Dark, as burning stone and timber give off, and so it reads against the grass
    // where grey vanished.
    const smoke = hex(this.art.palette.rockDark);
    const embers = [hex(this.art.palette.emberHot), hex(this.art.palette.emberMid)];
    for (const s of this.smoulders) {
      s.age += deltaMs;
      const life = 1 - s.age / span;
      if (life <= 0) continue;
      for (let k = 0; k < 3; k++) {
        const t = (s.age / 900 + k / 3 + s.seed) % 1;
        const x = s.x + 0.5 + Math.sin(t * 4 + s.seed) * 0.2;
        const y = s.y + 0.4 - t * 1.1;
        g.circle(tileX(view, x), tileY(view, y), view.tile * (0.14 + t * 0.28));
        g.fill({ color: smoke, alpha: 0.6 * (1 - t) * life });
      }
      for (let k = 0; k < 3; k++) {
        const flicker = Math.sin(s.age / 70 + k * 2.1 + s.seed * 3);
        if (flicker < -0.2) continue;
        const px = s.x + 0.25 + ((k * 0.37 + s.seed) % 0.5);
        const py = s.y + 0.55 + ((k * 0.23 + s.seed) % 0.3);
        const size = Math.max(2, view.tile / 8);
        g.rect(tileX(view, px), tileY(view, py), size, size);
        g.fill({ color: embers[k % 2] as number, alpha: (0.6 + 0.4 * flicker) * life });
      }
    }
    this.smoulders = this.smoulders.filter((s) => s.age < span);
  }

  /** Gun smoke: puffs slowing as they drift, swelling and thinning to nothing. */
  private drawPuffs(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.generators.fx.muzzleSmokeMs;
    const colour = hex(this.art.palette.rockLight);
    const dt = deltaMs / 1000;
    for (const puff of this.puffs) {
      puff.age += deltaMs;
      if (puff.age < 0) continue;
      const drag = Math.exp(-2.5 * dt);
      puff.vx *= drag;
      puff.vy = puff.vy * drag - 0.15 * dt;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      const t = puff.age / span;
      if (t >= 1) continue;
      g.circle(tileX(view, puff.x), tileY(view, puff.y), view.tile * (0.15 + 0.35 * t));
      g.fill({ color: colour, alpha: 0.55 * (1 - t) });
    }
    this.puffs = this.puffs.filter((p) => p.age < span);
  }

  /** Fades the scorch marks as rounds pass, and forgets the ones that have gone. */
  private age(state: MatchState): void {
    if (state.round === this.round) return;
    this.round = state.round;
    // The piles beside the guns are full again for the new round.
    this.fired.clear();
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => this.round - c.round < rounds);
    this.layoutCraters();
  }

  /**
   * An inert gun smoulders: grey puffs rise from it and fade. With its slumped barrel
   * that says "silenced" without the struck-through mark the flat style uses, which
   * reads as information rather than as part of a battlefield.
   */
  private drawInertSmoke(state: MatchState, view: ViewTransform): void {
    const g = this.effectGfx;
    const period = this.art.generators.cannon.inertSmokeMs;
    const colour = hex(this.art.palette.rockDark);
    for (const cannon of state.cannons) {
      if (cannon.active) continue;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2;
      for (let k = 0; k < 3; k++) {
        const t = (this.clock / period + k / 3 + cannon.id * 0.37) % 1;
        const x = cx + Math.sin(t * 5 + cannon.id) * 0.18;
        const y = cy - 0.2 - t * 1.3;
        g.circle(tileX(view, x), tileY(view, y), view.tile * (0.12 + t * 0.22));
        g.fill({ color: colour, alpha: 0.45 * (1 - t) });
      }
    }
  }

  /** Barrels turn to their last target and kick back when they fire. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const steps = this.art.generators.cannon.rotationSteps;
    const recoilFrames = this.art.generators.cannon.recoilFrames;
    const flashFrames = this.art.generators.fx.muzzleFlashFrames;
    const length = this.art.generators.cannon.barrelLengthPx / this.art.tileSizePx;
    const g = this.effectGfx;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const step = ((Math.round((aim.angle / (2 * Math.PI)) * steps) % steps) + steps) % steps;
      // Back at once, then home a frame at a time.
      const kick = Math.floor(aim.firedAgo / FX_FRAME_MS);
      const recoil = kick < recoilFrames ? recoilFrames - 1 - kick : 0;
      // The pile of balls in the corner away from the sandbags, one gone with each shot this
      // round's barrage; a silenced gun has none to hand.
      if (cannon.active) {
        const left =
          state.phase === 'combat' ? Math.max(0, PILE - (this.fired.get(cannon.id) ?? 0)) : PILE;
        if (left > 0) {
          const corner = PILE_CORNERS[pileCorner(this.outward(state, cannon))] as [number, number];
          this.place(
            this.effectLayer,
            KEY.balls(left),
            view,
            cannon.x + corner[0] * (cannon.w - 0.5),
            cannon.y + corner[1] * (cannon.h - 0.5),
            0.5,
          );
        }
      }
      // The carriage runs back with the barrel, and a silenced one stands dark.
      const bed = this.place(
        this.effectLayer,
        KEY.carriage(step, recoil),
        view,
        cannon.x,
        cannon.y,
        cannon.w,
      );
      if (!cannon.active) bed.tint = 0x8a8a8a;
      const sprite = this.place(
        this.effectLayer,
        cannon.active ? KEY.barrel(step, recoil) : KEY.droop(step),
        view,
        cannon.x,
        cannon.y,
        cannon.w,
      );
      // The owner's light colour, a step above the base's, so the barrel reads on it.
      sprite.tint = cannon.active
        ? washed(playerColour(this.art, cannon.owner, 'light'), 0.45)
        : hex(this.art.palette.rockMid);

      if (cannon.active && kick < flashFrames) {
        const cx = cannon.x + cannon.w / 2 + Math.sin(aim.angle) * (length + 0.15);
        const cy = cannon.y + cannon.h / 2 - Math.cos(aim.angle) * (length + 0.15);
        const r = view.tile * (0.35 - kick * 0.09);
        g.circle(tileX(view, cx), tileY(view, cy), r);
        g.fill({ color: hex(this.art.palette.emberHot), alpha: 0.9 });
        g.circle(tileX(view, cx), tileY(view, cy), r * 0.55);
        g.fill({ color: hex(this.art.palette.uiInk), alpha: 0.9 });
      }
    }
    this.aims.prune(state);
  }

  /** A banner in the owner's colour flies over every castle sealed as things stand. */
  private drawBanners(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const frames = this.art.generators.castle.bannerWaveFrames;
    this.bannerElapsed += frame.deltaMs;
    const wave = Math.floor(this.bannerElapsed / 160) % frames;
    const texture = this.texture(KEY.banner(wave));
    const g = this.effectGfx;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      // A knocked-out player's flags fly at half-mast, struck dark, for the rest of it.
      const out = state.players[castle.islandId - 1]?.eliminated === true;
      const raised = out ? 0.5 : this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      // A pole rising from the middle of the castle, the banner hoisted to its head
      // above the roofline, where it reads from across the map.
      const poleX = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - view.tile * 0.9;
      const length = view.tile * 1.4;
      const pole = Math.max(2, Math.round(view.tile / 10));
      g.rect(poleX - pole / 2, top, pole, length);
      g.fill({ color: hex(this.art.palette.rockDark) });
      const sprite = this.pools.get(this.effectLayer)?.take(texture) ?? new Sprite(texture);
      sprite.width = view.tile * 0.8;
      sprite.height = (view.tile * 0.8 * texture.height) / Math.max(1, texture.width);
      sprite.x = poleX + pole / 2;
      sprite.y = top + (1 - raised) * (length - sprite.height);
      // A flag coming down after a breach is struck in a darker shade.
      sprite.tint = playerColour(
        this.art,
        castle.islandId - 1,
        out || this.flags.lowering(castle.id) ? 'dark' : 'base',
      );
      this.effectLayer.addChild(sprite);
    }
  }

  /**
   * The piece in hand as the wall it would make: each block joined to the others and to
   * the wall already standing, so a player sees the shape they are about to have rather
   * than a stencil. Whether it fits stays plain — the player's colour when it does, red
   * when it does not, each with an outline in the style's usual valid or invalid ink.
   */
  private drawGhostWall(
    state: MatchState,
    view: ViewTransform,
    ghost: Ghost,
    humanPlayer: number,
  ): void {
    const anchor = ghost.tile;
    if (anchor === null) return;
    const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
    const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
    const joins = (x: number, y: number): boolean =>
      inPiece.has(`${x},${y}`) ||
      (x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.structure[y * state.width + x] === Structure.Wall);
    const tint = ghost.valid
      ? washed(playerColour(this.art, humanPlayer, 'light'), 0.15)
      : hex(this.art.palette.uiInvalid);
    for (const { x, y } of cells) {
      let mask = 0;
      if (joins(x, y - 1)) mask |= N;
      if (joins(x + 1, y)) mask |= E;
      if (joins(x, y + 1)) mask |= S;
      if (joins(x - 1, y)) mask |= W;
      const sprite = this.place(this.ghostLayer, KEY.wall(mask, 0), view, x, y);
      sprite.tint = tint;
      sprite.alpha = ghost.valid ? 0.8 : 0.6;
    }
    // Round the piece's outside only; lines between its own blocks would cut up the
    // joined wall the sprites just drew.
    const g = this.overlayGfx;
    for (const { x, y } of cells) {
      const left = tileX(view, x);
      const top = tileY(view, y);
      const right = left + view.tile;
      const bottom = top + view.tile;
      if (!inPiece.has(`${x},${y - 1}`)) g.moveTo(left, top).lineTo(right, top);
      if (!inPiece.has(`${x + 1},${y}`)) g.moveTo(right, top).lineTo(right, bottom);
      if (!inPiece.has(`${x},${y + 1}`)) g.moveTo(left, bottom).lineTo(right, bottom);
      if (!inPiece.has(`${x - 1},${y}`)) g.moveTo(left, top).lineTo(left, bottom);
    }
    g.stroke({
      width: 1,
      color: ghost.valid ? hex(this.art.palette.uiValid) : hex(this.art.palette.uiInvalid),
      alpha: 0.8,
    });
  }

  /** Cycles the sea through its generated frames. */
  private animateWater(deltaMs: number): void {
    // The surf breathes along the coast, each tile a little out of step with the next.
    const cycle = this.art.generators.terrain.foamCycleMs;
    for (const surf of this.surf) {
      const t = (this.clock / cycle + surf.phase) * Math.PI * 2;
      surf.sprite.alpha = 0.45 + 0.4 * Math.sin(t);
    }
    const frames = this.art.generators.terrain.waterAnimFrames;
    this.waterElapsed += deltaMs;
    const next =
      Math.floor(this.waterElapsed / this.art.generators.terrain.waterAnimMsPerFrame) % frames;
    if (next === this.waterFrame) return;
    this.waterFrame = next;
    const textures = Array.from({ length: this.art.generators.terrain.waterVariants }, (_, v) =>
      this.texture(KEY.water(next, v)),
    );
    this.waterSprites.forEach((sprite, k) => {
      sprite.texture = textures[this.waterVariants[k] as number] as Texture;
    });
  }

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    this.ghostShadow.clear();
    this.empty(this.ghostLayer);
    drawOvertimeBorder(g, state, view, this.art, performance.now());

    drawSelectable(g, view, ghost, this.art, performance.now());

    drawBuildHints(g, view, ghost, this.art, performance.now());
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(this.ghostShadow, g, view, ghost, this.art);

    if (!ghost.tile) return;
    const colour = ghost.valid ? hex(this.art.palette.uiValid) : hex(this.art.palette.uiInvalid);

    if (state.phase === 'build' && ghost.cells.length > 0) {
      this.drawGhostWall(state, view, ghost, humanPlayer);
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      g.rect(
        tileX(view, ghost.tile.x),
        tileY(view, ghost.tile.y),
        ghost.footprint.w * view.tile,
        ghost.footprint.h * view.tile,
      );
      g.fill({ color: colour, alpha: 0.45 });
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/** The castles chosen as their players' main castles, by id. */
function mainCastles(state: MatchState): Set<number> {
  const ids = new Set<number>();
  for (const player of state.players) {
    if (player.startingCastleId !== null) ids.add(player.startingCastleId);
  }
  return ids;
}

/**
 * A castle's torches one frame on: catching over `igniteMs` while it is sealed, going out
 * five times as fast once it is not, and doused — smoke to be puffed — at the moment a
 * lit castle loses its seal.
 */
export function nextTorch(
  torch: { lit: number; sealed: boolean },
  sealed: boolean,
  deltaMs: number,
  igniteMs: number,
): { lit: number; sealed: boolean; doused: boolean } {
  const rate = deltaMs / (sealed ? igniteMs : igniteMs / 5);
  return {
    lit: Math.max(0, Math.min(1, torch.lit + (sealed ? rate : -rate))),
    sealed,
    doused: torch.sealed && !sealed && torch.lit > 0,
  };
}

/** A glint's place in the moon's path, 0 to 1: fixed for a glint, scattered between them. */
function glint(n: number): number {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * A lighthouse's beam, pointing east from the origin for `reach` pixels: nested wedges, each
 * narrower than the last, in bands fading with distance, so it is brightest along its middle
 * and near the lamp and has no hard edge. Drawn once at a tile size, in white, for a stamp.
 */
function drawBeam(g: Graphics, tile: number, reach: number, alpha: number): void {
  const widths = [0.2, 0.15, 0.1, 0.055];
  const bands = 12;
  const start = tile * 0.25;
  for (const half of widths) {
    for (let i = 0; i < bands; i++) {
      const r0 = start + ((reach - start) * i) / bands;
      const r1 = start + ((reach - start) * (i + 1)) / bands;
      const fade = 1 - (i + 0.5) / bands;
      const c = Math.cos(half);
      const s = Math.sin(half);
      g.poly([c * r0, -s * r0, c * r1, -s * r1, c * r1, s * r1, c * r0, s * r0]);
      g.fill({ color: 0xffffff, alpha: (alpha / widths.length) * fade * fade });
    }
  }
}

/** How far a beam from (x, y) at `angle` runs before it leaves `bounds`, in pixels. */
function beamRoom(
  x: number,
  y: number,
  angle: number,
  bounds: { x0: number; y0: number; x1: number; y1: number },
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let room = Infinity;
  if (dx > 1e-6) room = Math.min(room, (bounds.x1 - x) / dx);
  if (dx < -1e-6) room = Math.min(room, (bounds.x0 - x) / dx);
  if (dy > 1e-6) room = Math.min(room, (bounds.y1 - y) / dy);
  if (dy < -1e-6) room = Math.min(room, (bounds.y0 - y) / dy);
  return Math.max(0, room);
}
