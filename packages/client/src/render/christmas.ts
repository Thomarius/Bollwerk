import type { ArtConfig, ChristmasStyleConfig } from '@bollwerk/config';
import { Structure, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { climax, cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { ChristmasSeaLife } from './seaLife.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  Fireworks,
  FlagHoist,
  GhostMotion,
  GunAims,
  Landings,
  RuinSmoke,
  WinnerBanners,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawChoices,
  drawDrain,
  drawFireReticle,
  drawMainCastles,
  drawOvertimeBorder,
  drawSealGlow,
  drawSealPreview,
  drawSelectable,
  drawShotTarget,
  hex,
  mixed,
  shotLift,
  shotProgress,
  tileX,
  tileY,
  type Cell,
  type Debris,
  type EffectFrame,
  type FinishLook,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
} from './theme.js';
import { outline, trace, wallGeometry } from './walls.js';
import { ShapeTheme } from './shapeTheme.js';
import { GOLD, NIGHT, SNOW, SNOW_SHADE, WARM, drawBow } from './yule.js';

/** Something with a place and an age: a burst of snow, a splash. */
interface Aged {
  x: number;
  y: number;
  age: number;
}

/** A puff of snow, in tiles. */
interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

/** A scrap thrown from a burst present, in tiles: wrapping paper or a curl of ribbon. */
interface Scrap {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  owner: number;
  ribbon: boolean;
}

/** Where a snowball came down on the ground: a dent in the snow, fading over the rounds. */
interface Dent {
  x: number;
  y: number;
  round: number;
}

/** A snowflake falling, in tiles on screen. */
interface Flake {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}

/** A figure to stamp, by where it stands: `foot` orders them, nearest last. */
interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/** How a gun feels: watching, throwing, or melted while silenced. */
type Mood = 'ready' | 'throw' | 'melted';

const THROW_MS = 360;
const BURST_MS = 220;
const SPLASH_MS = 700;
/** How long a light takes to go out as a breach lowers its tree's "flag". */
const FLICKER_MS = 70;

const PINE = 0x1d4a35;
const PINE_DARK = 0x12301f;
const BARK = 0x5a3a22;
const COAL = 0x1a1a22;
const CARROT = 0xe8742a;
const ICE = 0xbfe0f4;
const DEAD = 0x8a8478;
/** A melted snowman's pool and its rim. */
const MELT = 0x6aa6dc;
const MELT_EDGE = 0x2f6aa8;

/**
 * The fairy lights on a tree, in tiles from its foot: wound round it from the bottom tier up.
 * The baubles hang between them.
 */
const LIGHTS: readonly (readonly [number, number])[] = [
  [-0.62, -0.62],
  [-0.2, -0.68],
  [0.25, -0.66],
  [0.62, -0.6],
  [-0.42, -1.1],
  [0.05, -1.16],
  [0.45, -1.08],
  [-0.25, -1.6],
  [0.25, -1.62],
  [0.02, -2.02],
];
const BAUBLES: readonly (readonly [number, number, number])[] = [
  [-0.4, -0.78, 0.11],
  [0.42, -0.82, 0.11],
  [0.02, -0.92, 0.1],
  [-0.2, -1.3, 0.1],
  [0.28, -1.36, 0.1],
  [-0.05, -1.82, 0.09],
];
/** The tiers of a tree, each its foot's height, half-width at the foot, and its apex. */
const TIERS: readonly (readonly [number, number, number])[] = [
  [-0.5, 0.86, -1.4],
  [-1.0, 0.68, -1.9],
  [-1.5, 0.5, -2.42],
];
const STAR_Y = -2.5;

/** How Christmas sends off the winners: snowflakes in their colours, and a stocking for a flag. */
const FINISH: FinishLook = { spark: 'flakes', flag: 'stocking' };

/**
 * The Christmas look, for either look: Christmas Eve on snowy islands in a midnight sea, snow
 * always falling, thick as a blizzard in snowy weather and as the match comes to its climax.
 * Walls are presents wrapped in the owner's colour, tied with white ribbon, snow lying on them;
 * sealed ground is the owner's tartan laid on the snow. Castles are Christmas trees, standing in
 * a present, hung with baubles in the owner's colour, and **sealed is the tree lit**: its fairy
 * lights twinkling warm white, its star shining; a breach makes them flicker out, a player's
 * who is out has a bare brown tree. Guns are snowmen in the owner's scarf and hat-band, throwing
 * snowballs that trail sparkles in their colour; a silenced one has half melted, its hat over
 * its eyes. A hit bursts a present into scraps of paper and ribbon. A snow globe stands in the
 * corner, its snow settling slowly, shaken into a blizzard at the climax; Santa's sleigh flies
 * across the outer sea now and then, and ice floes drift by with seals and polar bears.
 */
export class ChristmasTheme extends ShapeTheme implements Theme {
  readonly id = 'christmas' as const;

  private style!: ChristmasStyleConfig;
  private weather: Weather = 'clear';
  private readonly seaLife = new ChristmasSeaLife();

  private readonly terrainGfx = new Graphics();
  private readonly dentGfx = new Graphics();
  private dentsDrawn = '';
  /** The snow globe, redrawn only when the window changes or while it is being shaken. */
  private readonly globeMemos = new Memos();
  private readonly globeFlakes = new Stamps();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawChristmasScenery(g, view, items),
    () => SNOW,
  );
  /** Presents and the guns' bases, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  /**
   * The trees with their lights and stars, and the snowmen, in one: placed nearest last, so a
   * snowman standing north of a tree no longer hides its top.
   */
  private readonly figureStamps = new Stamps();
  private figures: Figure[] = [];
  private readonly effectGfx = new Graphics();
  private readonly ballStamps = new Stamps();
  private readonly scrapStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  /** The halos of lights, stars and sparkles, added. */
  private readonly glow = new Discs();
  private readonly snowStamps = new Stamps();
  private readonly mist = new Discs();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly lit = new FlagHoist();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  private clock = 0;
  private round = 0;
  private corner: TimerSpot | null = null;
  private dents: Dent[] = [];
  private bursts: Aged[] = [];
  private splashes: Aged[] = [];
  private puffs: Puff[] = [];
  private scraps: Scrap[] = [];
  private flakes: Flake[] = [];

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.christmas;
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    this.glow.container.blendMode = 'add';
    layers.terrain.addChild(
      this.terrainGfx,
      this.dentGfx,
      this.globeMemos.container,
      this.globeFlakes.container,
    );
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.figureStamps.container,
      this.effectGfx,
      this.ballStamps.container,
      this.scrapStamps.container,
      this.lateGfx,
      this.glow.container,
      this.snowStamps.container,
      this.mist.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.globeMemos.destroy();
    for (const s of [
      this.globeFlakes,
      this.figureStamps,
      this.ballStamps,
      this.scrapStamps,
      this.snowStamps,
    ]) {
      s.destroy();
    }
    this.glow.destroy();
    this.mist.destroy();
    this.book.destroy();
    for (const g of [
      this.terrainGfx,
      this.dentGfx,
      this.underGfx,
      this.effectGfx,
      this.lateGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    const g = this.terrainGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);

    // The midnight sea, lighter where it laps the ice, and the stars of the sky glinting in it.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    g.fill({ color: hex(palette.waterDeep) });
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    for (const [r, colour] of [
      [3, palette.waterMid],
      [1, palette.waterShallow],
    ] as const) {
      for (let y = -r; y < state.height + r; y++) {
        for (let x = -r; x < state.width + r; x++) {
          if (land(x, y) || !near(x, y, r)) continue;
          g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.8);
        }
      }
      g.fill({ color: hex(colour) });
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y) || near(x, y, 1) || hash(x, y, 3000) > 0.05) continue;
        const sx = tileX(view, x + hash(x, y, 3001));
        const sy = tileY(view, y + hash(x, y, 3002));
        const r = t * (0.04 + 0.05 * hash(x, y, 3003));
        g.moveTo(sx - r, sy).lineTo(sx + r, sy);
        g.moveTo(sx, sy - r).lineTo(sx, sy + r);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.035), color: SNOW, alpha: 0.45 });

    // The snow: drifts in soft blue shade, glints of frost, and the ice along the shore.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x >> 1, y >> 1, 3004) > 0.35) continue;
      g.ellipse(tileX(view, x + 0.5), tileY(view, y + 0.6), t * 0.8, t * 0.32);
    }
    g.fill({ color: hex(palette.grassDark), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 3005) > 0.08) continue;
      const sx = tileX(view, x + 0.2 + hash(x, y, 3006) * 0.6);
      const sy = tileY(view, y + 0.2 + hash(x, y, 3007) * 0.6);
      const r = t * 0.07;
      g.moveTo(sx - r, sy).lineTo(sx + r, sy);
      g.moveTo(sx, sy - r).lineTo(sx, sy + r);
    }
    g.stroke({ width: Math.max(1, t * 0.03), color: 0xffffff, alpha: 0.9 });
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.04 });
    }
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.24, color: ICE, alpha: 0.7, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: Math.max(1.5, t * 0.07), color: SNOW, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: 1, color: NIGHT, alpha: 0.6, cap: 'square' });

    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.dentsDrawn = '';
  }

  /** Dents in the snow where snowballs came down, drawn again only when one comes or fades. */
  private drawDents(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.dents = this.dents.filter((d) => state.round - d.round < rounds);
    const key = `${state.round}|${this.dents.length}|${viewKey(view)}`;
    if (key === this.dentsDrawn) return;
    this.dentsDrawn = key;
    const g = this.dentGfx;
    g.clear();
    const t = view.tile;
    for (const d of this.dents) {
      const fade = 1 - (state.round - d.round) / rounds;
      const x = tileX(view, d.x + 0.5);
      const y = tileY(view, d.y + 0.55);
      g.ellipse(x, y, t * 0.36, t * 0.22);
      g.fill({ color: SNOW_SHADE, alpha: 0.8 * fade });
      g.ellipse(x + t * 0.04, y + t * 0.03, t * 0.22, t * 0.12);
      g.fill({ color: hex(this.art.palette.craterDark), alpha: 0.5 * fade });
      g.ellipse(x, y, t * 0.38, t * 0.24);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0xffffff, alpha: 0.8 * fade });
    }
  }

  // ------------------------------------------------------------------ the snow globe

  /**
   * The snow globe in the corner: on a turned wooden base with a gold plaque, a glass globe
   * holding a cottage with a lit window and a fir in the snow, flakes settling slowly in it.
   * At the climax — overtime and the final round — someone shakes it: it rocks, and its snow
   * whirls up into a blizzard.
   */
  private drawGlobe(state: MatchState, view: ViewTransform): void {
    this.globeMemos.begin();
    this.globeFlakes.begin();
    const spot = this.corner;
    if (spot !== null) {
      const still = motionReduced();
      const shaken = climax(state) && !still;
      const rock = shaken ? Math.round(Math.sin(this.clock / 90) * 3) : 0;
      const t = view.tile;
      const s = spot.size * t;
      const cx = tileX(view, spot.x) + rock * s * 0.01;
      const cy = tileY(view, spot.y) - s * 0.06;
      const r = s * 0.32;
      this.globeMemos.draw('globe', `${viewKey(view)}|${rock}`, (g) =>
        drawGlobeFigure(g, cx, cy, r, s),
      );
      // Its snow: settling in slow spirals, or whirling round fast while it is shaken.
      const flake = this.book.get('globe-flake', t, (k) => {
        k.circle(0, 0, Math.max(1, s * 0.012));
        k.fill({ color: 0xffffff });
      });
      for (let n = 0; n < this.style.globeFlakes; n++) {
        const h1 = hash(n, 1, 3010);
        const h2 = hash(n, 2, 3011);
        let fx: number;
        let fy: number;
        if (shaken) {
          const a = this.clock / (300 + h1 * 400) + h2 * Math.PI * 2;
          const d = r * (0.2 + 0.65 * h1);
          fx = cx + Math.cos(a) * d;
          fy = cy + Math.sin(a) * d;
        } else {
          const fall = still ? h1 : (this.clock / (9000 + h2 * 6000) + h1) % 1;
          fx = cx + (h2 - 0.5) * r * 1.4 + Math.sin(this.clock / 1200 + n) * r * 0.06;
          fy = cy - r * 0.8 + fall * r * 1.35;
        }
        if (Math.hypot(fx - cx, fy - cy) > r * 0.88 || fy > cy + r * 0.55) continue;
        this.globeFlakes.place(flake, fx, fy, { scale: 0.6 + h1 });
      }
    }
    this.globeMemos.end();
    this.globeFlakes.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as the owner's tartan, laid on the snow. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawTartan(g, island, view));
  }

  /**
   * The owner's tartan: the snow washed in their colour, a broad band of their dark shade
   * across and down every other tile, a thin line of their light along each tile's edge, so
   * the stripes cross into the checks of a plaid; edged in their colour.
   */
  private drawTartan(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    for (let player = 0; player < state.players.length; player++) {
      const owned = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.floorAlpha });
      for (const { x, y } of cells) {
        if (x % 2 === 0) g.rect(tileX(view, x + 0.3), tileY(view, y), t * 0.4, t);
        if (y % 2 === 0) g.rect(tileX(view, x), tileY(view, y + 0.3), t, t * 0.4);
      }
      g.fill({ color: this.colour(player, 'dark'), alpha: 0.35 });
      for (const { x, y } of cells) {
        const left = tileX(view, x);
        const top = tileY(view, y);
        g.moveTo(left + t * 0.88, top).lineTo(left + t * 0.88, top + t);
        g.moveTo(left, top + t * 0.88).lineTo(left + t, top + t * 0.88);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(player, 'light'), alpha: 0.7 });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: this.colour(player, 'base') });
    }
    dimEliminated(g, state, view, NIGHT);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const wallAt = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;
    for (let owner = 0; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const out = owner === 0 || state.players[owner - 1]?.eliminated !== false;
      this.drawPresents(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, SNOW_SHADE, this.colour(cannon.owner, 'base'), 0.6);
    }
  }

  /**
   * Walls as presents: each block a box wrapped in the owner's colour, a white ribbon tied
   * across its top and down its face, snow lying along the tops where nothing stands to the
   * north. A player's who is out, and rubble, are plain brown cardboard. Straight strokes only:
   * a wall is redrawn at every hit on its island.
   */
  private drawPresents(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'base') });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? mixed(DEAD, 0x000000, 0.3) : this.colour(player, 'dark') });
    // Each box's wrapping pattern, a dot of the lighter shade in two corners.
    if (!dead) {
      for (const b of wall.blocks) {
        g.rect(b.left + t * 0.15, b.top + t * 0.12, t * 0.12, t * 0.12);
        g.rect(b.left + t * 0.72, b.lip - t * 0.26, t * 0.12, t * 0.12);
      }
      g.fill({ color: this.colour(player, 'light'), alpha: 0.6 });
    }
    // The ribbon, across and down the top, and on down the face.
    const ribbon = Math.max(1, t * 0.09);
    for (const b of wall.blocks) {
      const mid = (b.top + b.lip) / 2;
      g.rect(b.left, mid - ribbon / 2, t, ribbon);
      g.rect(b.left + t / 2 - ribbon / 2, b.top, ribbon, (b.faced ? b.top + t : b.lip) - b.top);
    }
    g.fill({ color: dead ? 0xd8d0c0 : SNOW, alpha: 0.95 });
    // The seams between the boxes, dark, so each reads as a present of its own and the
    // ribbons do not run on from box to box into a grid.
    for (const b of wall.blocks) {
      g.rect(b.left + t * 0.03, b.top + t * 0.03, t * 0.94, b.lip - b.top - t * 0.06);
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: NIGHT, alpha: 0.85 });
    // A bow on one box in three, where its ribbons cross.
    if (!dead) {
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 3021) > 0.33) continue;
        const bx = b.left + t / 2;
        const by = (b.top + b.lip) / 2;
        const r = t * 0.16;
        g.poly([bx, by, bx - r, by - r * 0.7, bx - r, by + r * 0.5]);
        g.poly([bx, by, bx + r, by - r * 0.7, bx + r, by + r * 0.5]);
      }
      g.fill({ color: SNOW });
    }
    // Snow on the tops open to the sky, in a lumpy strip.
    for (const b of wall.blocks) {
      if (joins(b.x, b.y - 1)) continue;
      g.rect(b.left, b.top, t, t * 0.14);
      g.rect(b.left + t * (0.1 + 0.4 * hash(b.x, b.y, 3020)), b.top + t * 0.12, t * 0.22, t * 0.08);
    }
    g.fill({ color: SNOW });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.07), color: NIGHT, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    this.bursts.push({ x, y, age: 0 });
    if (!this.land(x, y) && debris.length === 0) {
      this.splashes.push({ x, y, age: 0 });
      return;
    }
    if (debris.length === 0) {
      this.dents.push({ x, y, round: this.round });
      this.puff(x + 0.5, y + 0.5, 0.3);
      return;
    }
    for (const block of debris) {
      this.puff(block.x + 0.5, block.y + 0.4, 0.4);
      for (let k = 0; k < 7; k++)
        this.throwScrap(block.x + 0.5, block.y + 0.4, block.owner - 1, k < 2);
    }
  }

  private puff(x: number, y: number, r: number, life = 700): void {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.random();
      this.puffs.push({
        x,
        y,
        vx: Math.cos(a) * 0.8,
        vy: Math.sin(a) * 0.5 - 0.4,
        r: r * (0.6 + Math.random() * 0.5),
        age: 0,
        life,
      });
    }
  }

  private throwScrap(x: number, y: number, owner: number, ribbon: boolean): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const v = 2.5 + Math.random() * 3.5;
    this.scraps.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 800 + Math.random() * 400,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 16,
      owner,
      ribbon,
    });
  }

  /** The sweep: a lone present bursts in a puff of snow and a few scraps. */
  noteCrumble(block: Debris): void {
    this.puff(block.x + 0.5, block.y + 0.5, 0.3);
    for (let k = 0; k < 3; k++)
      this.throwScrap(block.x + 0.5, block.y + 0.5, block.owner - 1, k === 0);
  }

  /** A piece set down settles into the snow, a puff of it thrown up round it. */
  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    for (let k = 0; k < Math.min(3, cells.length); k++) {
      const c = cells[Math.floor(Math.random() * cells.length)]!;
      this.puff(c.x + 0.5, c.y + 0.8, 0.16, 450);
    }
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    under.clear();
    this.effectGfx.clear();
    this.lateGfx.clear();
    this.glow.begin(view.tile);
    perf.begin('flow');
    this.drawDents(state, view);
    this.drawGlobe(state, view);
    perf.end('flow');
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x6a7280, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.figures = [];
    this.drawTrees(state, view, frame);
    drawMainCastles(this.effectGfx, view, state, this.art, frame.castleSealed);
    this.drawSnowmen(state, view, frame.deltaMs);
    // Nearest last; a tree's lights keep their place after it, the sort being stable.
    this.figures.sort((a, b) => a.foot - b.foot);
    this.figureStamps.begin();
    for (const f of this.figures) this.figureStamps.place(f.context, f.x, f.y, f.options);
    this.figureStamps.end();
    this.drawShots(state, view, frame);
    this.scrapStamps.begin();
    this.drawBursts(view, frame.deltaMs);
    this.drawPuffs(view, frame.deltaMs);
    this.drawScraps(view, frame.deltaMs);
    this.scrapStamps.end();
    this.drawSplashes(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawSnow(state, view, frame.deltaMs);
    this.glow.end();
  }

  /**
   * The Christmas trees, each stamped for its owner, with its lights and star placed over it:
   * lit as a flag is raised — sealing lights them, the lights twinkling to new brightnesses
   * every `twinkleMs`, the star shining; a breach flickers them out. A player's who is out
   * has a bare brown tree, no lights at all.
   */
  private drawTrees(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    const twinkle = still ? 0 : Math.floor(this.clock / this.style.twinkleMs);
    const flicker = Math.floor(this.clock / FLICKER_MS);
    this.lit.update(frame.castleSealed, this.clock, this.art);
    const bulb = this.book.get('bulb', t, (k) => {
      k.circle(0, 0, Math.max(1.2, t * 0.07));
      k.fill({ color: 0xffffff });
    });
    const star = this.book.get('star', t, (k) => drawTreeStar(k, t * 0.24));
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      let level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      // Going out, the lights sputter: on and off by turns as they fade.
      if (this.lit.lowering(castle.id) && !still && hash(castle.id, flicker, 3030) < 0.45)
        level = 0;
      // Unlit, the tree is stamped in the dark: its baubles dulled and the garland dim, since
      // the lights alone were too small to tell a sealed castle at board scale.
      const dark = level <= 0;
      const figure = this.book.get(`tree|${out ? -1 : player}|${dark}`, t, (k) =>
        drawTreeFigure(
          k,
          t,
          out ? null : this.colour(player, 'base'),
          out ? null : this.colour(player, 'light'),
          dark,
        ),
      );
      const x = tileX(view, castle.x + castle.w / 2);
      const y = tileY(view, castle.y + castle.h) - t * 0.04;
      this.figures.push({ foot: y, context: figure, x, y });
      if (out) continue;
      this.figures.push({
        foot: y,
        context: star,
        x,
        y: y + STAR_Y * t,
        options: {
          tint: level > 0 ? 0xffffff : 0x6a6a72,
          scale: 1 + 0.08 * level * (still ? 0 : Math.sin(this.clock / 300 + castle.id)),
        },
      });
      if (level <= 0) continue;
      this.glow.disc(x, y + STAR_Y * t, t * 0.6, GOLD, this.style.glowAlpha * level);
      LIGHTS.forEach(([lx, ly], n) => {
        const shine = 0.45 + 0.55 * hash(castle.id * 31 + n, twinkle, 3031);
        const px = x + lx * t;
        const py = y + ly * t;
        this.figures.push({
          foot: y,
          context: bulb,
          x: px,
          y: py,
          options: { tint: WARM, alpha: level * (0.5 + 0.5 * shine) },
        });
        this.glow.disc(px, py, t * 0.2, WARM, this.style.glowAlpha * level * shine * 0.6);
      });
    }
  }

  /**
   * The guns, snowmen stamped for each owner and mood, facing their target: watching; throwing
   * as they fire, leaning into it, the throwing arm high; a silenced one half melted, slumped
   * into a puddle, its hat down over its eyes.
   */
  private drawSnowmen(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const throwing = cannon.active && aim.firedAgo < THROW_MS;
      const mood: Mood = !cannon.active ? 'melted' : throwing ? 'throw' : 'ready';
      const figure = this.book.get(`snowman|${cannon.owner}|${mood}`, t, (k) =>
        drawSnowmanFigure(
          k,
          t,
          this.colour(cannon.owner, 'base'),
          this.colour(cannon.owner, 'light'),
          mood,
        ),
      );
      let rotation = 0;
      if (throwing && !still) {
        const q = aim.firedAgo / THROW_MS;
        rotation = dir * 0.16 * Math.sin(q * Math.PI);
      }
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.22;
      this.figures.push({
        foot,
        context: figure,
        x: tileX(view, cannon.x + cannon.w / 2),
        y: foot,
        options: { scale: dir, scaleY: 1, rotation },
      });
    }
    this.aims.prune(state);
  }

  /** Shots: snowballs, a shadow under them, sparkles trailing behind in the owner's colour. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const ball = this.book.get('snowball', t, (k) => {
      k.circle(0, 0, t * 0.2);
      k.fill({ color: SNOW_SHADE });
      k.circle(-t * 0.03, -t * 0.03, t * 0.16);
      k.fill({ color: SNOW });
      k.circle(0, 0, t * 0.2);
      k.stroke({ width: Math.max(1, t * 0.05), color: NIGHT });
    });
    const sparkle = this.book.get('sparkle', t, (k) => {
      const r = t * 0.12;
      k.poly([
        0,
        -r,
        r * 0.25,
        -r * 0.25,
        r,
        0,
        r * 0.25,
        r * 0.25,
        0,
        r,
        -r * 0.25,
        r * 0.25,
        -r,
        0,
        -r * 0.25,
        -r * 0.25,
      ]);
      k.fill({ color: 0xffffff });
    });
    this.ballStamps.begin();
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const at = (q: number): [number, number] => [
        tileX(view, shot.fromX + (shot.toX - shot.fromX) * q + 0.5),
        tileY(view, shot.fromY + (shot.toY - shot.fromY) * q + 0.5) - shotLift(shot, q) * t,
      ];
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const high = Math.min(1, shotLift(shot, p) / 3);
      this.underGfx.ellipse(gx, gy, t * 0.2, t * 0.07);
      this.underGfx.fill({ color: NIGHT, alpha: 0.3 - 0.1 * high });
      const light = this.colour(shot.owner, 'light');
      for (let k = 3; k >= 1; k--) {
        const q = p - k * 0.035;
        if (q <= 0) continue;
        const [sx, sy] = at(q);
        this.ballStamps.place(sparkle, sx, sy, {
          tint: light,
          scale: 1 - k * 0.2,
          rotation: this.clock / 200 + k,
          alpha: 1 - k * 0.25,
        });
        this.glow.disc(sx, sy, t * 0.25, light, 0.25 * (1 - k * 0.25));
      }
      const [x, y] = at(p);
      this.ballStamps.place(ball, x, y, { scale: 1 + 0.25 * high });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
    this.ballStamps.end();
  }

  /** The burst where anything strikes: a white flash of snow, the one flash at a spot. */
  private drawBursts(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const burst = this.book.get('burst', t, (k) => {
      for (let n = 0; n < 8; n++) {
        const a = (n / 8) * Math.PI * 2;
        k.circle(Math.cos(a) * t * 0.35, Math.sin(a) * t * 0.35, t * 0.22);
      }
      k.circle(0, 0, t * 0.4);
      k.fill({ color: 0xffffff });
    });
    for (const b of this.bursts) {
      b.age += deltaMs;
      const k = b.age / BURST_MS;
      if (k >= 1) continue;
      this.scrapStamps.place(burst, tileX(view, b.x + 0.5), tileY(view, b.y + 0.45), {
        scale: 0.6 + 0.7 * k,
        alpha: 0.9 * (1 - k),
      });
    }
    this.bursts = this.bursts.filter((b) => b.age < BURST_MS);
  }

  /** Puffs of snow thrown up, swelling and settling. */
  private drawPuffs(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const disc = this.book.get('puff', t, (k) => {
      k.circle(0, 0, t * 0.5);
      k.fill({ color: 0xffffff });
    });
    const dt = deltaMs / 1000;
    for (const p of this.puffs) {
      p.age += deltaMs;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.8 * dt;
      const k = p.age / p.life;
      if (k >= 1) continue;
      this.scrapStamps.place(disc, tileX(view, p.x), tileY(view, p.y), {
        scale: (p.r / 0.5) * (0.6 + 0.6 * k),
        alpha: 0.85 * (1 - k),
        tint: k < 0.5 ? SNOW : SNOW_SHADE,
      });
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
  }

  /** Scraps of a burst present: wrapping paper in the owner's colour, and curls of white ribbon. */
  private drawScraps(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const paper = this.book.get('paper', t, (k) => {
      k.poly([-t * 0.12, -t * 0.08, t * 0.13, -t * 0.1, t * 0.1, t * 0.09, -t * 0.1, t * 0.08]);
      k.fill({ color: 0xffffff });
      k.stroke({ width: 1, color: NIGHT, alpha: 0.6 });
    });
    const curl = this.book.get('curl', t, (k) => {
      k.moveTo(-t * 0.15, 0)
        .quadraticCurveTo(-t * 0.07, -t * 0.14, 0, 0)
        .quadraticCurveTo(t * 0.07, t * 0.14, t * 0.15, 0);
      k.stroke({ width: Math.max(1.5, t * 0.06), color: SNOW, cap: 'round' });
    });
    const dt = deltaMs / 1000;
    for (const s of this.scraps) {
      s.age += deltaMs;
      s.vy += 7 * dt;
      s.vx *= Math.exp(-1.5 * dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
      const k = s.age / s.life;
      if (k >= 1) continue;
      this.scrapStamps.place(s.ribbon ? curl : paper, tileX(view, s.x), tileY(view, s.y), {
        rotation: s.angle,
        scaleY: s.ribbon ? 1 : Math.abs(Math.cos(s.angle * 1.3)) * 0.8 + 0.2,
        alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
        tint: s.ribbon ? 0xffffff : s.owner < 0 ? DEAD : this.colour(s.owner, 'base'),
      });
    }
    this.scraps = this.scraps.filter((s) => s.age < s.life);
  }

  /** A snowball in the sea: a ring spreading, drops and chips of ice thrown up. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      g.ellipse(x, y, t * (0.25 + 0.6 * k), t * (0.12 + 0.3 * k));
      g.stroke({ width: Math.max(1, t * 0.05), color: ICE, alpha: 0.8 * (1 - k) });
      if (k < 0.6) {
        const q = k / 0.6;
        for (let n = 0; n < 5; n++) {
          const a = -Math.PI * (0.15 + 0.7 * (n / 4));
          g.rect(
            x + Math.cos(a) * t * (0.2 + 0.6 * q),
            y + Math.sin(a) * t * (0.2 + 0.7 * q) + q * q * t * 0.7,
            t * 0.08,
            t * 0.08,
          );
        }
        g.fill({ color: SNOW, alpha: 1 - q });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /**
   * Snow, always falling, drifting as it falls; a blizzard, thicker, faster and slanting on
   * the wind, in snowy weather and as the match comes to its climax. Fog is snow mist; the
   * rest of the weather only thins or thickens the fall. None with motion reduced.
   */
  private drawSnow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.snowStamps.begin();
    this.mist.begin(t);
    const blizzard = this.weather === 'snow' || climax(state);
    const count = blizzard
      ? this.style.blizzardCount
      : this.weather === 'clear'
        ? this.style.snowCount * 0.6
        : this.style.snowCount;
    if (!still) {
      while (this.flakes.length < count) {
        this.flakes.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          speed: 0.8 + Math.random() * 1.2,
          size: 0.5 + Math.random(),
          phase: Math.random() * Math.PI * 2,
        });
      }
      if (this.flakes.length > count) this.flakes.length = Math.floor(count);
      const flake = this.book.get('flake', t, (k) => {
        k.circle(0, 0, Math.max(1, t * 0.06));
        k.fill({ color: 0xffffff });
      });
      const dt = deltaMs / 1000;
      const wind = blizzard ? 2.5 : 0.3;
      const fall = blizzard ? 2.2 : 1;
      for (const f of this.flakes) {
        f.y += f.speed * fall * dt;
        f.x += (wind + Math.sin(this.clock / 800 + f.phase) * 0.4) * dt;
        if (f.y > rows) {
          f.y = -0.5;
          f.x = Math.random() * cols;
        }
        if (f.x > cols + 1) f.x -= cols + 2;
        this.snowStamps.place(flake, f.x * t, view.top + f.y * t, {
          scale: f.size,
          alpha: 0.6 + (0.3 * f.size) / 1.5,
        });
      }
    }
    if (this.weather === 'fog') {
      const { mistBanks, mistAlpha } = this.style;
      for (let n = 0; n < mistBanks; n++) {
        const drift = still ? 0 : this.clock / 60000;
        const fx = (((hash(n, this.seed, 3040) + drift * (0.5 + hash(n, 1, 3041))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 3042);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.2],
          [2.5, 0.5, 2.4],
          [-2.3, 0.6, 2.2],
        ] as const) {
          for (const f of [1, 0.75, 0.5]) {
            this.mist.disc(x + dx * t, y + dy * t, r * t * f, 0xdce8f4, mistAlpha / 3);
          }
        }
      }
    }
    this.snowStamps.end();
    this.mist.end();
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const now = performance.now();
    drawOvertimeBorder(g, state, view, this.art, now);
    drawSelectable(g, view, ghost, this.art, now);
    drawBuildHints(g, view, ghost, this.art, now);
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      // The piece in hand as a present still being wrapped, a bow on it; where it does not fit,
      // unwrapped — grey, its edge broken into dashes, no bow. The difference is in form,
      // since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.45 : 0.5,
      });
      const edge = outline(cells, inPiece, view);
      if (ghost.valid) {
        trace(g, edge);
        g.stroke({ width: Math.max(2, t * 0.14), color: NIGHT });
        trace(g, edge);
        g.stroke({ width: Math.max(1, t * 0.07), color: SNOW });
        const first = cells.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
        drawBow(g, tileX(view, first.x + 0.5), tileY(view, first.y + 0.35), t * 0.28, SNOW);
        return;
      }
      edge.forEach((s, n) => {
        if (n % 2 === 1) return;
        g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
      });
      g.stroke({ width: Math.max(2, t * 0.12), color: SNOW, alpha: 0.9 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The snowman's place, a ring of snow, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.roundRect(x + t * 0.1, y + t * 0.1, w - t * 0.2, h - t * 0.2, t * 0.3);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(x + t * 0.3, y + h - t * 0.3).lineTo(x + w - t * 0.3, y + t * 0.3);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * A Christmas tree, its foot's middle at the origin, `t` a tile: standing in a present wrapped
 * in the owner's colour, its trunk, three tiers of dark fir each with snow along its foot, a
 * gold garland looped across them and baubles in the owner's colours. The lights and the star
 * are placed over it. With no colour given it is the bare brown tree of a player who is out.
 */
function drawTreeFigure(
  g: Graphics,
  t: number,
  body: number | null,
  light: number | null,
  dark = false,
): void {
  const u = (v: number): number => v * t;
  const dead = body === null;
  g.ellipse(u(0.05), -u(0.02), u(0.9), u(0.16));
  g.fill({ color: NIGHT, alpha: 0.3 });
  // The present it stands in.
  g.rect(-u(0.42), -u(0.42), u(0.84), u(0.42));
  g.fill({ color: body ?? DEAD });
  g.rect(-u(0.06), -u(0.42), u(0.12), u(0.42));
  g.fill({ color: dead ? 0xd8d0c0 : SNOW });
  g.rect(-u(0.42), -u(0.42), u(0.84), u(0.42));
  g.stroke({ width: Math.max(1, u(0.05)), color: NIGHT });
  g.rect(-u(0.07), -u(0.58), u(0.14), u(0.16));
  g.fill({ color: BARK });
  // The tiers, the bottom first, each with a scalloped skirt of snow.
  for (const [foot, half, apex] of TIERS) {
    const tier = [-u(half), u(foot), 0, u(apex), u(half), u(foot)];
    g.poly(tier);
    g.fill({ color: dead ? 0x6a5a48 : PINE });
    g.poly([0, u(apex), u(half), u(foot), u(half * 0.3), u(foot)]);
    g.fill({ color: dead ? 0x54463a : PINE_DARK, alpha: 0.7 });
    g.poly(tier);
    g.stroke({ width: Math.max(1, u(0.05)), color: NIGHT, join: 'round' });
    if (dead) continue;
    for (let k = 0; k < 4; k++) {
      const cx = -u(half) + u((half * 2 * (k + 0.5)) / 4);
      g.ellipse(cx, u(foot) - u(0.03), u((half * 2) / 8 + 0.03), u(0.07));
    }
    g.fill({ color: SNOW });
  }
  if (dead) {
    // Bare: a few needles left, fallen round its foot.
    for (let k = 0; k < 7; k++) {
      g.moveTo(-u(0.6) + u(0.2 * k), -u(0.04)).lineTo(-u(0.55) + u(0.2 * k), -u(0.1));
    }
    g.stroke({ width: Math.max(1, u(0.04)), color: 0x6a5a48 });
    return;
  }
  // The garland, looped across each tier.
  for (const [foot, half] of TIERS) {
    g.moveTo(-u(half * 0.8), u(foot - 0.18)).quadraticCurveTo(
      0,
      u(foot - 0.02),
      u(half * 0.7),
      u(foot - 0.32),
    );
  }
  g.stroke({ width: Math.max(1, u(0.05)), color: dark ? mixed(GOLD, PINE_DARK, 0.6) : GOLD });
  for (const [bx, by, r] of BAUBLES) g.circle(u(bx), u(by), u(r));
  g.fill({ color: dark ? mixed(body, PINE_DARK, 0.7) : body });
  for (const [bx, by, r] of BAUBLES) g.circle(u(bx), u(by), u(r));
  g.stroke({ width: Math.max(1, u(0.035)), color: NIGHT });
  if (dark) return;
  for (const [bx, by, r] of BAUBLES) g.circle(u(bx - r * 0.35), u(by - r * 0.35), u(r * 0.3));
  g.fill({ color: light ?? SNOW, alpha: 0.9 });
}

/** A tree's star, five-pointed, in gold, at the origin, `r` to its points. */
function drawTreeStar(g: Graphics, r: number): void {
  const points: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const d = k % 2 === 0 ? r : r * 0.45;
    points.push(Math.cos(a) * d, Math.sin(a) * d);
  }
  g.poly(points);
  g.fill({ color: GOLD });
  g.stroke({ width: Math.max(1, r * 0.15), color: 0x8a6a1a, join: 'round' });
  g.circle(-r * 0.15, -r * 0.2, r * 0.15);
  g.fill({ color: 0xfff8d8 });
}

/**
 * A snowman, facing right, its foot's middle at the origin: three balls of snow shaded blue on
 * the right, coal eyes and buttons, a carrot nose, stick arms, a scarf in the owner's colour and
 * a top hat with a band of it. `throw` has the right arm flung high and forward; `melted` is
 * slumped into a puddle, smaller and lopsided, the hat tipped over its eyes, arms drooping.
 */
function drawSnowmanFigure(g: Graphics, t: number, scarf: number, light: number, mood: Mood): void {
  const u = (v: number): number => v * t;
  const melted = mood === 'melted';
  const ink = Math.max(1, u(0.045));
  if (melted) {
    // A wide pool of meltwater, bluer than any snow, so a silenced gun reads at eight players
    // by its puddle and its height alone.
    g.ellipse(u(0.05), -u(0.04), u(0.92), u(0.24));
    g.fill({ color: MELT });
    g.ellipse(u(0.05), -u(0.04), u(0.92), u(0.24));
    g.stroke({ width: ink, color: MELT_EDGE });
    g.ellipse(-u(0.35), -u(0.08), u(0.2), u(0.05));
    g.fill({ color: ICE, alpha: 0.9 });
  } else {
    g.ellipse(u(0.05), -u(0.02), u(0.55), u(0.12));
    g.fill({ color: NIGHT, alpha: 0.25 });
  }
  const balls: [number, number, number, number][] = melted
    ? [
        [0, -0.16, 0.5, 0.2],
        [0.04, -0.42, 0.3, 0.16],
        [0.1, -0.64, 0.18, 0.14],
      ]
    : [
        [0, -0.38, 0.38, 0.38],
        [0, -0.92, 0.28, 0.28],
        [0, -1.33, 0.2, 0.2],
      ];
  const [, , , headR] = balls[2]!;
  const head = { x: u(balls[2]![0]), y: u(balls[2]![1]) };
  // The arms, behind the body.
  const arms: [number, number, number, number][] = melted
    ? [
        [-0.22, -0.42, -0.6, -0.12],
        [0.26, -0.42, 0.62, -0.12],
      ]
    : mood === 'throw'
      ? [
          [-0.24, -0.98, -0.6, -0.78],
          [0.22, -1.02, 0.55, -1.55],
        ]
      : [
          [-0.24, -0.98, -0.62, -1.2],
          [0.24, -0.98, 0.6, -1.12],
        ];
  for (const [ax, ay, bx, by] of arms) {
    g.moveTo(u(ax), u(ay)).lineTo(u(bx), u(by));
    // A twig forking off near its end.
    const fx = ax + (bx - ax) * 0.7;
    const fy = ay + (by - ay) * 0.7;
    g.moveTo(u(fx), u(fy)).lineTo(u(fx + (bx - ax) * 0.2), u(fy - 0.14));
  }
  g.stroke({ width: Math.max(1.5, u(0.06)), color: BARK, cap: 'round' });
  if (mood === 'throw') {
    g.circle(u(0.58), u(-1.6), u(0.1));
    g.fill({ color: SNOW });
    g.stroke({ width: ink, color: NIGHT });
  }
  for (const [bx, by, rx, ry] of balls) {
    g.ellipse(u(bx), u(by), u(rx), u(ry));
    g.fill({ color: SNOW_SHADE });
    g.ellipse(u(bx - rx * 0.1), u(by - ry * 0.1), u(rx * 0.86), u(ry * 0.86));
    g.fill({ color: SNOW });
    g.ellipse(u(bx), u(by), u(rx), u(ry));
    g.stroke({ width: ink, color: NIGHT });
  }
  // Coal buttons down the middle.
  const middle = balls[1]!;
  for (const dy of [-0.1, 0.05]) g.circle(u(middle[0] + 0.03), u(middle[1] + dy), u(0.035));
  g.fill({ color: COAL });
  // The scarf at the neck, its end hanging behind.
  const neck = u(middle[1] - middle[3] + 0.02);
  g.roundRect(-u(0.22), neck - u(0.06), u(0.44), u(0.12), u(0.05));
  g.poly([
    -u(0.18),
    neck,
    -u(0.3),
    neck + u(0.32),
    -u(0.17),
    neck + u(0.34),
    -u(0.08),
    neck + u(0.02),
  ]);
  g.fill({ color: scarf });
  g.moveTo(-u(0.27), neck + u(0.24)).lineTo(-u(0.15), neck + u(0.26));
  g.stroke({ width: Math.max(1, u(0.04)), color: light });
  g.roundRect(-u(0.22), neck - u(0.06), u(0.44), u(0.12), u(0.05));
  g.stroke({ width: ink, color: NIGHT });
  // The face: coal eyes, a carrot nose, a smile of coal — or, melted, the hat over its eyes.
  if (!melted) {
    for (const ex of [0.02, 0.11]) g.circle(head.x + u(ex), head.y - u(0.05), u(0.03));
    for (let k = 0; k < 4; k++)
      g.circle(
        head.x + u(-0.04 + k * 0.05),
        head.y + u(0.09 + (k === 0 || k === 3 ? -0.02 : 0)),
        u(0.018),
      );
    g.fill({ color: COAL });
  }
  g.poly([
    head.x + u(0.12),
    head.y - u(0.01),
    head.x + u(melted ? 0.26 : 0.38),
    head.y + u(melted ? 0.1 : 0.03),
    head.x + u(0.12),
    head.y + u(0.04),
  ]);
  g.fill({ color: CARROT });
  // The hat: tipped forward over its eyes when melted. Turned first and then moved: Pixi's
  // turn turns whatever move came before it too.
  g.save();
  g.rotateTransform(melted ? 0.35 : 0);
  g.translateTransform(head.x, head.y - u(headR * 0.85) + (melted ? u(0.08) : 0));
  g.rect(-u(0.25), -u(0.05), u(0.5), u(0.07));
  g.rect(-u(0.16), -u(0.36), u(0.32), u(0.32));
  g.fill({ color: COAL });
  g.rect(-u(0.16), -u(0.14), u(0.32), u(0.07));
  g.fill({ color: scarf });
  g.restore();
  if (!melted) return;
  // Drips running down its side into the pool, and a wisp of steam rising off it.
  for (const [dx, dy] of [
    [0.38, -0.3],
    [-0.42, -0.24],
  ] as const) {
    g.moveTo(u(dx), u(dy - 0.14)).lineTo(u(dx), u(dy));
    g.stroke({ width: Math.max(1, u(0.05)), color: MELT, cap: 'round' });
    g.circle(u(dx), u(dy + 0.03), u(0.05));
    g.fill({ color: MELT });
  }
  g.moveTo(head.x - u(0.05), head.y - u(0.45))
    .quadraticCurveTo(head.x + u(0.12), head.y - u(0.62), head.x - u(0.02), head.y - u(0.78))
    .quadraticCurveTo(head.x - u(0.14), head.y - u(0.92), head.x + u(0.06), head.y - u(1.06));
  g.stroke({ width: Math.max(1.5, u(0.07)), color: SNOW_SHADE, alpha: 0.85, cap: 'round' });
}

/**
 * The snow globe, (cx, cy) its glass's middle, `r` its radius, `s` its corner's square: a
 * turned wooden base with a gold plaque, the glass with the light on it, and inside a drift of
 * snow, a fir and a cottage with a lit window and snow on its roof. Its flakes are stamped.
 */
function drawGlobeFigure(g: Graphics, cx: number, cy: number, r: number, s: number): void {
  const ink = Math.max(1, s * 0.012);
  g.ellipse(cx + s * 0.03, cy + r + s * 0.14, s * 0.4, s * 0.05);
  g.fill({ color: 0x000000, alpha: 0.3 });
  // The base.
  g.poly([
    cx - r * 0.95,
    cy + r * 0.7,
    cx + r * 0.95,
    cy + r * 0.7,
    cx + r * 1.15,
    cy + r * 1.3,
    cx - r * 1.15,
    cy + r * 1.3,
  ]);
  g.fill({ color: 0x6a3e22 });
  g.stroke({ width: ink, color: NIGHT, join: 'round' });
  g.rect(cx - r * 1.2, cy + r * 1.28, r * 2.4, r * 0.14);
  g.fill({ color: 0x4a2a16 });
  g.rect(cx - r * 0.35, cy + r * 0.88, r * 0.7, r * 0.24);
  g.fill({ color: GOLD });
  g.stroke({ width: ink * 0.7, color: 0x8a6a1a });
  // Inside the glass: the night, a drift of snow, the fir and the cottage.
  g.circle(cx, cy, r);
  g.fill({ color: 0x1a2c58, alpha: 0.85 });
  g.ellipse(cx, cy + r * 0.62, r * 0.85, r * 0.3);
  g.fill({ color: SNOW });
  g.poly([cx - r * 0.55, cy + r * 0.45, cx - r * 0.3, cy - r * 0.25, cx - r * 0.05, cy + r * 0.45]);
  g.fill({ color: PINE });
  g.rect(cx + r * 0.0, cy + r * 0.1, r * 0.5, r * 0.4);
  g.fill({ color: 0x8a5a3a });
  g.poly([
    cx - r * 0.06,
    cy + r * 0.12,
    cx + r * 0.25,
    cy - r * 0.18,
    cx + r * 0.56,
    cy + r * 0.12,
  ]);
  g.fill({ color: SNOW });
  g.rect(cx + r * 0.15, cy + r * 0.2, r * 0.14, r * 0.14);
  g.fill({ color: WARM });
  // The glass: rimmed, and a curve of light across its shoulder.
  g.circle(cx, cy, r);
  g.stroke({ width: ink * 1.5, color: 0xdfefff, alpha: 0.8 });
  g.moveTo(cx - r * 0.7, cy - r * 0.3).quadraticCurveTo(
    cx - r * 0.6,
    cy - r * 0.7,
    cx - r * 0.2,
    cy - r * 0.8,
  );
  g.stroke({ width: ink * 2, color: 0xffffff, alpha: 0.6, cap: 'round' });
}

/**
 * Christmas's scenery, none like a present, a snowman or a snowball: a tree is a snow-laden fir;
 * a pine a tall spruce with snow on its boughs; a bush a wooden sled or a lantern on a post
 * glowing warm; a boulder a rock capped with snow, or one in three an igloo.
 */
function drawChristmasScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.05);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree' || item.kind === 'pine') {
      const tall = item.kind === 'pine' ? 1.25 : 1;
      g.ellipse(cx + t * 0.1, cy + t * 0.42, t * 0.32, t * 0.07);
      g.fill({ color: NIGHT, alpha: 0.2 });
      g.rect(cx - t * 0.04, cy + t * 0.25, t * 0.08, t * 0.17);
      g.fill({ color: BARK });
      for (const [foot, half, apex] of [
        [0.3, 0.34, -0.15],
        [0.05, 0.27, -0.38 * tall],
        [-0.2 * tall, 0.2, -0.6 * tall],
      ] as const) {
        g.poly([cx - half * t, cy + foot * t, cx, cy + apex * t, cx + half * t, cy + foot * t]);
      }
      g.fill({ color: PINE });
      for (const [foot, half] of [
        [0.3, 0.34],
        [0.05, 0.27],
        [-0.2 * tall, 0.2],
      ] as const) {
        g.rect(cx - half * t, cy + foot * t - t * 0.06, half * 2 * t, t * 0.07);
      }
      g.fill({ color: SNOW });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        // A wooden sled, its runners curled up at the front.
        g.rect(cx - t * 0.28, cy - t * 0.05, t * 0.5, t * 0.1);
        g.fill({ color: 0x8a5a3a });
        g.moveTo(cx - t * 0.3, cy + t * 0.14)
          .lineTo(cx + t * 0.22, cy + t * 0.14)
          .quadraticCurveTo(cx + t * 0.36, cy + t * 0.12, cx + t * 0.3, cy - t * 0.04);
        g.stroke({ width: ink, color: 0x5a3a22, cap: 'round' });
      } else {
        // A lantern on a post, its light warm in the snow.
        g.ellipse(cx, cy + t * 0.35, t * 0.3, t * 0.12);
        g.fill({ color: WARM, alpha: 0.35 });
        g.rect(cx - t * 0.03, cy - t * 0.15, t * 0.06, t * 0.5);
        g.fill({ color: 0x2a2a34 });
        g.rect(cx - t * 0.09, cy - t * 0.36, t * 0.18, t * 0.22);
        g.fill({ color: WARM });
        g.stroke({ width: ink, color: 0x2a2a34 });
        g.rect(cx - t * 0.12, cy - t * 0.4, t * 0.24, t * 0.05);
        g.fill({ color: SNOW });
      }
    } else if (item.variant % 3 === 0) {
      // An igloo: a dome of snow blocks, its doorway dark.
      g.moveTo(cx - t * 0.38, cy + t * 0.3)
        .quadraticCurveTo(cx - t * 0.36, cy - t * 0.32, cx, cy - t * 0.32)
        .quadraticCurveTo(cx + t * 0.36, cy - t * 0.32, cx + t * 0.38, cy + t * 0.3)
        .closePath();
      g.fill({ color: SNOW });
      g.stroke({ width: ink, color: SNOW_SHADE });
      g.moveTo(cx - t * 0.34, cy + t * 0.05).lineTo(cx + t * 0.34, cy + t * 0.05);
      g.moveTo(cx - t * 0.25, cy - t * 0.17).lineTo(cx + t * 0.25, cy - t * 0.17);
      g.stroke({ width: Math.max(1, ink * 0.6), color: SNOW_SHADE });
      g.moveTo(cx + t * 0.04, cy + t * 0.3)
        .lineTo(cx + t * 0.04, cy + t * 0.12)
        .quadraticCurveTo(cx + t * 0.14, cy, cx + t * 0.24, cy + t * 0.12)
        .lineTo(cx + t * 0.24, cy + t * 0.3)
        .closePath();
      g.fill({ color: 0x2a3a5a });
    } else {
      // A rock, snow on its top.
      g.poly([
        cx - t * 0.32,
        cy + t * 0.28,
        cx - t * 0.22,
        cy - t * 0.1,
        cx + t * 0.1,
        cy - t * 0.2,
        cx + t * 0.3,
        cy + t * 0.04,
        cx + t * 0.3,
        cy + t * 0.28,
      ]);
      g.fill({ color: 0x5a6476 });
      g.poly([
        cx - t * 0.24,
        cy - t * 0.04,
        cx - t * 0.2,
        cy - t * 0.12,
        cx + t * 0.1,
        cy - t * 0.22,
        cx + t * 0.28,
        cy,
        cx + t * 0.05,
        cy - t * 0.06,
      ]);
      g.fill({ color: SNOW });
    }
  }
}
