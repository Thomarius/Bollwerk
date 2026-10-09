import type { ArtConfig, ChocolateStyleConfig } from '@bollwerk/config';
import { Structure, type Cannon, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics, Matrix, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { IslandParts } from './islandParts.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
  GunAims,
  type Aim,
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
  shotLift,
  tileX,
  tileY,
  type Cell,
  type Debris,
  type EffectFrame,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
  type FinishLook,
  mixed,
  shotProgress,
} from './theme.js';
import { hash } from './noise.js';
import { weatherFor } from './pixel/atmosphere.js';
import { climax, roseSpot } from './corner.js';
import { ChocolateSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { outline, trace, wallGeometry } from './walls.js';
import { cannonBase } from './cannonBase.js';
import { ShapeTheme } from './shapeTheme.js';

/** A swirl on the river, carried along by the current, melting back in as it ages. */
interface Swirl {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  turn: number;
  /** Its group of stamps (`SWIRL_GROUPS`), whose turns step together. */
  group: number;
  /** Its turn in whole steps of a sixty-fourth, past its group's share of one. */
  quarter: number;
  /** The stamp it showed last frame, kept until its group next steps. */
  shown?: GraphicsContext;
}

/**
 * The swirls are dealt into this many groups, each a render group of its own. A stamp given
 * another shape makes Pixi gather its whole render group again, and with five hundred swirls
 * each stepping its turn on its own beat that was every frame, three times what the rest of
 * the board costs to gather. A group's swirls step together, the groups a sixteenth of a
 * step apart, so a frame gathers one group of some thirty; a swirl melted away is replaced
 * as its group next steps, within a quarter of a second.
 */
const SWIRL_GROUPS = 16;

/** Something thrown up — a crumb, a drop of chocolate, a sprinkle — in tile coordinates. */
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  floor: number;
  size: number;
  colour: number;
  spin: number;
}

/** A square of the bar snapped off by a shot, flipping as it flies. */
interface Snapped {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  colour: number;
}

/** Where a shot came down on open ground: a splat of chocolate, hardening and fading. */
interface Splat {
  x: number;
  y: number;
  round: number;
  seed: number;
}

/** Where a block was shot away: its neighbours show bite marks for the rest of the round. */
interface Bite {
  x: number;
  y: number;
  round: number;
}

/** Something with a place and an age: a ring on the river, a melting block, a puff. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A piece just poured into its mould, wobbling as it sets. */
interface Wobble {
  cells: readonly Cell[];
  owner: number;
  age: number;
}

/** A sprinkle falling over the board, in screen pixels. */
interface Sprinkle {
  x: number;
  y: number;
  vy: number;
  angle: number;
  colour: number;
}

const RECOIL_MS = 160;
const RING_MS = 1100;
const MELT_MS = 900;
const WOBBLE_MS = 560;
const PUFF_MS = 700;
/** A whole turn. */
const TAU = Math.PI * 2;
const SNAP_MS = 700;

/** Candy for the sprinkles: neutral sweet-shop colours, so none reads as a player's. */
const SPRINKLES = [0xfffaf0, 0xffb3cf, 0xa8e6ff, 0xfff07a, 0xc9a7ff, 0xffc48a] as const;

/**
 * Of the lollipops, the share drawn as a gingerbread house and as a gummy bear instead,
 * chosen by eye (S9): a house or two to an island, a bear in a handful of lollipops.
 */
const GINGERBREAD_SHARE = 0.08;
const GUMMY_SHARE = 0.25;
/** A gummy bear's size against a lollipop's, by eye. */
const GUMMY_SCALE = 1.3;

/**
 * How far each band of the shallows reaches out from the coast, in tiles: the lighter
 * river, the shallows and the cream rim. Chosen by eye at two and eight players (S9): the
 * rim shows a quarter of a tile past the biscuit crumb, and the outer band stays under the
 * two tiles that the narrowest channel at eight players leaves either side.
 */
const SHALLOW_REACH = [1.6, 0.9, 0.55] as const;

/** Lollipops and candy floss, pastel, so none reads as a player's colour on the board. */
const CANDY = [0xffa8cc, 0xa8dcff, 0xffe08a, 0xc8b0ff] as const;

/**
 * Where a line u + v = c crosses a w by h box, as a segment, or null if it misses: the
 * shine's stroke across one block's top, so the band runs on unbroken from block to block.
 */
export function across(c: number, w: number, h: number): [number, number, number, number] | null {
  const ua = Math.max(0, c - h);
  const ub = Math.min(w, c);
  if (ub <= ua) return null;
  return [ua, c - ua, ub, c - ub];
}

/** A castle drawn as a cake: where its tiers and fountain stand on screen. */
interface Cake {
  cx: number;
  /** The lower tier: its top face's top edge, its lip, its foot, its half-width. */
  top1: number;
  lip1: number;
  foot1: number;
  half1: number;
  top2: number;
  lip2: number;
  half2: number;
  /** The fountain's basin, on the upper tier. */
  bowlY: number;
  bowlR: number;
}

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'sprinkle', flag: 'candy' };

/**
 * The chocolate look: a sweet-shop land on a river of milk chocolate, for either look. The
 * river flows — swirls ride its current across the whole map, and pour over a chocolate
 * fall in a corner of it — round meadows of mint sugar grass edged in biscuit crumb. Walls
 * are a bar of chocolate, scored into squares, under a glossy coating in the owner's
 * colour, and their faces show the bar cut through: coating, a layer of filling, chocolate.
 * Now and then a shine slides across a player's walls. Castles are chocolate fountains on
 * a tiered cake, running while sealed and stopped when breached; guns candy canes on a
 * cupcake, firing foil-wrapped bonbons. A hit snaps a square off and leaves bite marks on
 * its neighbours; the sweep melts what it takes; a piece in hand is an empty mould, poured
 * as it goes down. Sealed ground is iced, edged with piped icing and sprinkled. The player
 * colours are the shared ones, bright as candy already.
 */
export class ChocolateTheme extends ShapeTheme implements Theme {
  readonly id = 'chocolate' as const;

  private style!: ChocolateStyleConfig;
  /** Life on the outer river (`seaLife.ts`). */
  private readonly seaLife = new ChocolateSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The fall's streams, still: drawn again only when the board moves (`drawFallStill`). */
  private readonly fallGfx = new Graphics();
  private fallDrawn = '';
  /** What moves on the fall — gloss, ripples, the splash — over the streams, each frame. */
  private readonly flowGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawChocolateScenery(g, view, items, this.art),
    () => hex(this.art.palette.rockLight),
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /** The bite marks, between what lies under them and over them: redrawn as they change. */
  private readonly biteGfx = new Graphics();
  private bitesDrawn = '';
  /** The effects over the bite marks: melting blocks, ruins' smoke, the castles to choose. */
  private readonly effectTopGfx = new Graphics();
  /** Splats on open ground: drawn again when one lands or a round fades them. */
  private readonly splatGfx = new Graphics();
  private splatsDrawn = '';
  /**
   * The swirls on the river, up to 500 of them: stamps drawn once a size and a sixty-fourth
   * of a turn (PLAN 11.22). Squashed into the board's perspective, a swirl turned is not
   * the same shape rotated, and a turned stamp would thin its line unevenly; they turn once
   * in sixteen seconds, a step every quarter second. Stroked anew each frame they were
   * 35 000 vertices at eight players.
   */
  private readonly swirlGroups = Array.from({ length: SWIRL_GROUPS }, () => {
    const stamps = new Stamps();
    stamps.container.enableRenderGroup();
    return stamps;
  });
  private readonly swirlLayer = new Container();
  /** Each swirl group's turn, in steps, as last drawn: a change is the group's beat. */
  private readonly swirlBeats: number[] = [];
  private readonly book = new StampBook();
  /**
   * The swirls' stamps by size and step, as the book holds them, kept in an array for the
   * tile they were drawn at: looked up by name, five hundred keys a frame were built and
   * hashed for nothing.
   */
  private swirlContexts: (GraphicsContext | undefined)[] = [];
  private swirlTile = 0;
  /** The main castles' crowns: the shared mark, drawn again only as one changes. */
  private readonly crownGfx = new Graphics();
  private crownKey = '';
  /**
   * The fountains' still parts, a `Graphics` a castle redrawn only as it starts or stops
   * (`Memos`), and their moving jets and drips as stamps over them. Drawn anew each frame
   * they were some 8 000 vertices at eight players, most of what this style rebuilt.
   */
  private readonly fountainMemo = new Memos();
  private readonly fountainStamps = new Stamps();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** The shots in flight, over the guns (`drawShots`). */
  private readonly shotStamps = new Stamps();
  /** A shot's twisted end, from the unit triangle to its corners: one matrix, reused. */
  private readonly corners = new Matrix();
  /** What lies over the shots: where one's own will land, splashes, the finish. */
  private readonly lateGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private round = 0;
  /** Sea tiles a swirl may set out from: not against a coast. */
  private seaCells: Cell[] = [];
  private swirls: Swirl[] = [];
  private fall: TimerSpot | null = null;
  /** Wall blocks by tile, kept from the last structures drawn, for the shine to cross. */
  private walls: { x: number; y: number; owner: number }[] = [];
  private splats: Splat[] = [];
  private bites: Bite[] = [];
  private bits: Bit[] = [];
  private snapped: Snapped[] = [];
  private rings: Aged[] = [];
  private melts: Aged[] = [];
  private wobbles: Wobble[] = [];
  private sprinkles: Sprinkle[] = [];
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The fountains run as a flag flies: started by sealing, stopped by a breach. */
  private readonly fountains = new FlagHoist();
  /** Snow, drawn from the seed as Medieval's weather is, falls here as sprinkles. */
  private snowy = false;
  private clock = 0;

  constructor(private readonly seed = 1) {
    super();
    for (const group of this.swirlGroups) this.swirlLayer.addChild(group.container);
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.chocolate;
    this.snowy = weatherFor(this.seed, art.pixel.weatherOdds) === 'snow';
    layers.terrain.addChild(
      this.terrainGfx,
      this.splatGfx,
      this.swirlLayer,
      this.fallGfx,
      this.flowGfx,
    );
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.effectGfx,
      this.biteGfx,
      this.effectTopGfx,
      this.crownGfx,
      this.fountainMemo.container,
      this.fountainStamps.container,
      this.gunMemo.container,
      this.shotStamps.container,
      this.lateGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.splatGfx.destroy();
    for (const group of this.swirlGroups) group.destroy();
    this.swirlLayer.destroy();
    this.book.destroy();
    this.gunMemo.destroy();
    this.fountainMemo.destroy();
    this.fountainStamps.destroy();
    this.shotStamps.destroy();
    this.lateGfx.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.fallGfx,
      this.flowGfx,
      this.crownGfx,
      this.effectGfx,
      this.biteGfx,
      this.effectTopGfx,
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

    // The river runs out past the board to the window's edge, lighter near the land.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    const depth = new Int8Array(w * h).fill(-1);
    const queue: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!land(x + x0, y + y0)) continue;
        depth[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
    // Only the first two rings are needed: they keep the swirls off the coast.
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const d = depth[i]!;
      if (d >= 2) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || depth[ny * w + nx] !== -1) continue;
        depth[ny * w + nx] = d + 1;
        queue.push(ny * w + nx);
      }
    }
    this.seaCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = depth[y * w + x]!;
        if (d < 0 || d >= 2) this.seaCells.push({ x: x + x0, y: y + y0 });
      }
    }
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    const coast = outline(ground, land, view);

    // The deep river everywhere, then the shallows as bands along the coast, each the coast
    // stroked wide with round ends, so they follow it smoothly and two islands' shallows
    // meeting in a channel merge into one even band. They were rings of a circle a tile,
    // four of them stepping darker outwards, which read as a muddy halo and, at eight
    // players, as heavy stepped blotches between the islands (S9). Opaque, so overlapping
    // strokes do not darken where they cross. Outermost a lighter river, then the shallows,
    // then a rim of cream where the chocolate laps the shore.
    g.rect(tileX(view, x0), tileY(view, y0), w * t, h * t);
    g.fill({ color: hex(palette.waterDeep) });
    const bands: [number, number][] = [
      [SHALLOW_REACH[0], mixed(hex(palette.waterDeep), hex(palette.waterMid), 0.6)],
      [SHALLOW_REACH[1], mixed(hex(palette.waterMid), hex(palette.waterShallow), 0.6)],
      [SHALLOW_REACH[2], mixed(hex(palette.waterShallow), hex(palette.waterFoam), 0.8)],
    ];
    for (const [reach, color] of bands) {
      trace(g, coast);
      g.stroke({ width: t * reach * 2, color, cap: 'round', join: 'round' });
    }

    // The meadow: mint sugar grass, a lighter patch here and there, tufts and a glint of sugar.
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 1) < 0.22) g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.7);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 2) > 0.4) continue;
      const px = tileX(view, x) + t * (0.2 + 0.6 * hash(x, y, 3));
      const py = tileY(view, y) + t * (0.3 + 0.5 * hash(x, y, 4));
      g.moveTo(px - t * 0.12, py - t * 0.14).lineTo(px, py);
      g.lineTo(px + t * 0.1, py - t * 0.16);
      g.moveTo(px, py).lineTo(px, py - t * 0.2);
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.grassDark), cap: 'round' });
    for (const { x, y } of ground) {
      if (hash(x, y, 5) > 0.25) continue;
      g.circle(
        tileX(view, x) + t * hash(x, y, 6),
        tileY(view, y) + t * hash(x, y, 7),
        Math.max(0.8, t * 0.04),
      );
    }
    g.fill({ color: 0xffffff, alpha: 0.8 });
    // A faint tint of the owner over each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.07 });
    }

    // The shore: a band of biscuit crumb along every coast, wet-dark where the river meets it,
    // and crumbs scattered on it.
    trace(g, coast);
    g.stroke({ width: t * 0.42, color: hex(palette.sand), cap: 'square' });
    for (const s of coast) {
      for (const k of [0.25, 0.7]) {
        const key = Math.round(s.x1 * 7 + s.y1 * 13 + k * 10);
        if (hash(key, 11) > 0.6) continue;
        const off = (hash(key, 12) - 0.5) * t * 0.3;
        const vertical = s.x1 === s.x2;
        g.circle(
          s.x1 + (s.x2 - s.x1) * k + (vertical ? off : 0),
          s.y1 + (s.y2 - s.y1) * k + (vertical ? 0 : off),
          Math.max(0.8, t * 0.06),
        );
      }
    }
    g.fill({ color: mixed(hex(palette.sand), hex(palette.craterMid), 0.45) });

    // The chocolate fall, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.fall = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.fall = this.fall;
    if (this.fall !== null) this.drawFallLedge(g, view, this.fall);
    this.seaLife.layout(state, view, this.art);
    this.swirls = [];
  }

  /**
   * The fall's still parts: the river's ledge of dark chocolate, the cliff it pours over,
   * the round pool below, rimmed in cream, and banks of meringue either side of the lip.
   * The streams themselves, their gloss and the splash move (`drawFall`). The fall was one
   * brown sheet on a brown pool, which read as a muddy trapezoid (S9); now dark cliff shows
   * between lighter streams, and the pool is dark under a cream rim.
   */
  private drawFallLedge(g: Graphics, view: ViewTransform, fall: TimerSpot): void {
    const { palette } = this.art;
    const t = view.tile;
    const f = this.fallShape(view, fall);
    const ink = Math.max(1, t * 0.06);
    // The pool: a deep round basin, a rim of cream round it.
    g.ellipse(f.cx, f.poolY, f.half * 1.15, f.half * 0.55);
    g.fill({ color: mixed(hex(palette.waterDeep), hex(palette.shadow), 0.45) });
    g.ellipse(f.cx, f.poolY, f.half * 1.15, f.half * 0.55);
    g.stroke({ width: Math.max(1.5, t * 0.16), color: hex(palette.waterFoam), alpha: 0.85 });
    // The cliff behind the streams, dark chocolate, wider at its foot.
    const top = f.lip;
    const foot = f.poolY;
    const wide = f.sheet * 1.2;
    g.poly([f.cx - wide, top, f.cx + wide, top, f.cx + wide * 1.1, foot, f.cx - wide * 1.1, foot]);
    g.fill({ color: hex(palette.craterDark) });
    // The ledge the river runs over: its top lighter, its front edge lit.
    g.roundRect(f.cx - wide, top - t * 0.5, wide * 2, t * 0.5, t * 0.12);
    g.fill({ color: hex(palette.waterMid) });
    g.stroke({ width: ink, color: hex(palette.shadow), alpha: 0.6 });
    // The banks: heaps of meringue either side of the lip, peaked and lit.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x = f.cx + side * (wide + t * (0.15 + k * 0.32));
        const y = f.lip - t * (0.05 + 0.18 * k) + t * 0.3 * hash(k, side, 21);
        const r = t * (0.38 - k * 0.06);
        g.circle(x, y, r);
        g.fill({ color: hex(palette.rockMid) });
        g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.rockDark) });
        g.circle(x - r * 0.3, y - r * 0.35, r * 0.4);
        g.fill({ color: hex(palette.rockLight) });
      }
    }
  }

  /** Where the fall stands: its middle, the lip, the sheet's half-width, the pool. */
  private fallShape(
    view: ViewTransform,
    fall: TimerSpot,
  ): { cx: number; lip: number; sheet: number; drop: number; poolY: number; half: number } {
    const t = view.tile;
    const half = (fall.size * t) / 2 - t * 0.4;
    const cy = tileY(view, fall.y);
    const lip = cy - half * 0.45;
    const drop = half * 0.9;
    return { cx: tileX(view, fall.x), lip, sheet: half * 0.55, drop, poolY: lip + drop, half };
  }

  // ------------------------------------------------------------------ the river, moving

  /** The river's surface, each frame: swirls carried on the current, the fall, the splats. */
  private drawFlow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.flowGfx;
    g.clear();
    const t = view.tile;
    const still = motionReduced();

    // Splats on open ground, hardening and fading over the rounds after.
    this.drawSplats(state, view);

    // Swirls, carried east on the current, melting in and out.
    const target = Math.min(500, Math.floor(this.seaCells.length / this.style.swirlTiles));
    while (this.swirls.length < target && this.seaCells.length > 0) {
      const group = Math.floor(Math.random() * SWIRL_GROUPS);
      this.swirls.push(this.newSwirl(still ? 0.5 : Math.random(), group));
    }
    const dt = still ? 0 : deltaMs / 1000;
    // The book draws its stamps afresh for a new tile size, and so must this, at once: the
    // old ones are destroyed.
    let fresh = false;
    if (t !== this.swirlTile) {
      this.swirlTile = t;
      this.swirlContexts = [];
      fresh = true;
    }
    // Which groups step this frame: their swirls may take another stamp.
    const beat = this.clock / 2600 / (TAU / 64);
    const steps: number[] = [];
    const stepping: boolean[] = [];
    for (let k = 0; k < SWIRL_GROUPS; k++) {
      const step = Math.round(k / SWIRL_GROUPS + beat);
      steps.push(step);
      stepping.push(fresh || this.swirlBeats[k] !== step);
      this.swirlBeats[k] = step;
      this.swirlGroups[k]!.begin();
    }
    const fall = this.fall;
    for (let i = 0; i < this.swirls.length; i++) {
      let s = this.swirls[i]!;
      s.age += still ? 0 : deltaMs;
      s.x += this.style.currentTilesPerSecond * dt;
      s.y += Math.sin(this.clock / 1400 + s.turn * 3) * 0.08 * dt;
      const stamps = this.swirlGroups[s.group]!;
      if (s.age >= s.life || this.land(Math.floor(s.x), Math.floor(s.y))) {
        if (!stepping[s.group] && s.shown !== undefined) {
          // Gone, its place in the group kept, unseen, until the group steps.
          stamps.place(s.shown, tileX(view, s.x), tileY(view, s.y), { alpha: 0 });
          continue;
        }
        s = this.newSwirl(0, s.group);
        this.swirls[i] = s;
      }
      // Drawn a twentieth of a tile apart in size and scaled the rest of the way.
      const size = Math.round(s.size * 20) / 20;
      const step = (((s.quarter + steps[s.group]!) % 64) + 64) % 64;
      const index = Math.round(s.size * 20) * 64 + step;
      let swirl = this.swirlContexts[index];
      if (swirl === undefined) {
        swirl = this.book.get(`swirl|${size}|${step}`, t, (k) =>
          this.drawSwirl(k, t * size, (step / 64) * TAU, t),
        );
        this.swirlContexts[index] = swirl;
      }
      s.shown = swirl;
      // None across the fall's pool and cliff, where the current does not run: there it is
      // placed unseen, so the stamps after it in its group keep theirs.
      const hidden =
        fall !== null &&
        Math.abs(s.x - fall.x) < fall.size / 2 &&
        Math.abs(s.y - fall.y) < fall.size / 2;
      const alpha = Math.sin((Math.PI * s.age) / s.life);
      const level = Math.max(0, Math.min(2, Math.floor(alpha * 3)));
      stamps.place(swirl, tileX(view, s.x), tileY(view, s.y), {
        scale: s.size / size,
        alpha: hidden ? 0 : 0.14 + 0.13 * level,
      });
    }
    for (const group of this.swirlGroups) group.end();

    this.drawFallStill(view);
    if (this.fall !== null) this.drawFall(view, this.fall);
  }

  /** One swirl at the origin, `r` its size and `a` its turn, in full: the stamp fades it. */
  private drawSwirl(g: Graphics, r: number, a: number, t: number): void {
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.6);
    for (let k = 1; k <= 10; k++) {
      const f = k / 10;
      const aa = a + f * Math.PI * 1.6;
      const rr = r * (1 - f * 0.65);
      g.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr * 0.6);
    }
    g.stroke({
      width: Math.max(1, t * 0.07),
      color: hex(this.art.palette.waterFoam),
      cap: 'round',
    });
  }

  /** The splats, drawn again only when one comes or fades. */
  private drawSplats(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.splats = this.splats.filter((s) => state.round - s.round < rounds);
    const last = this.splats.at(-1);
    const key = `${state.round}|${this.splats.length}|${last?.x},${last?.y},${last?.seed}|${viewKey(view)}`;
    if (key === this.splatsDrawn) return;
    this.splatsDrawn = key;
    const g = this.splatGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    for (const s of this.splats) {
      const fade = 1 - (state.round - s.round) / rounds;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.circle(cx, cy, t * 0.32);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + s.seed;
        const d = t * (0.36 + 0.2 * hash(s.x + k, s.y, 31));
        g.circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, t * (0.06 + 0.07 * hash(k, s.x, 32)));
      }
      g.fill({ color: hex(palette.craterMid), alpha: 0.8 * fade });
      g.circle(cx - t * 0.1, cy - t * 0.1, t * 0.08);
      g.fill({ color: 0xffffff, alpha: 0.35 * fade });
    }
  }

  /** A new swirl in `group`, its turn one of the group's sixty-four. */
  private newSwirl(age: number, group: number): Swirl {
    const at = this.seaCells[Math.floor(Math.random() * this.seaCells.length)]!;
    const life = this.style.swirlMs * (0.7 + Math.random() * 0.6);
    const quarter = Math.floor(Math.random() * 64);
    return {
      x: at.x + Math.random(),
      y: at.y + Math.random(),
      age: age * life,
      life,
      size: 0.3 + Math.random() * 0.35,
      turn: (quarter + group / SWIRL_GROUPS) * (TAU / 64),
      group,
      quarter,
    };
  }

  /** The fall's three streams: where each stands and how wide it is. */
  private streams(f: { cx: number; sheet: number }): { x: number; w: number }[] {
    return [-0.68, 0, 0.68].map((across, k) => ({
      x: f.cx + across * f.sheet,
      w: f.sheet * (k === 1 ? 0.3 : 0.24),
    }));
  }

  /**
   * The chocolate pouring over the lip in three streams, each a glossy rope lit down its
   * left side: still, so drawn once for the board and under what moves on it (`drawFall`).
   */
  private drawFallStill(view: ViewTransform): void {
    const fall = this.fall;
    const key = fall === null ? '' : `${viewKey(view)}|${fall.x},${fall.y},${fall.size}`;
    if (key === this.fallDrawn) return;
    this.fallDrawn = key;
    const g = this.fallGfx;
    g.clear();
    if (fall === null) return;
    const { palette } = this.art;
    const t = view.tile;
    const f = this.fallShape(view, fall);
    const body = hex(palette.waterShallow);
    const shade = hex(palette.waterMid);
    const gloss = hex(palette.waterFoam);
    const streams = this.streams(f);
    // The river on the ledge, gathering to the streams, and each stream curling over the lip.
    for (const s of streams) {
      g.roundRect(s.x - s.w * 1.15, f.lip - t * 0.42, s.w * 2.3, t * 0.48, s.w);
    }
    g.fill({ color: body });
    // The streams, swelling a little as they fall, each ending in the pool.
    for (const s of streams) {
      g.poly([
        s.x - s.w,
        f.lip,
        s.x + s.w,
        f.lip,
        s.x + s.w * 1.2,
        f.poolY,
        s.x - s.w * 1.2,
        f.poolY,
      ]);
    }
    g.fill({ color: body });
    for (const s of streams) {
      g.poly([
        s.x + s.w * 0.35,
        f.lip,
        s.x + s.w,
        f.lip,
        s.x + s.w * 1.2,
        f.poolY,
        s.x + s.w * 0.4,
        f.poolY,
      ]);
    }
    g.fill({ color: shade });
    // The light down each stream's left side, and on the curl over the lip.
    for (const s of streams) {
      g.moveTo(s.x - s.w * 0.55, f.lip - t * 0.25).lineTo(s.x - s.w * 0.6, f.lip);
      g.lineTo(s.x - s.w * 0.75, f.poolY - t * 0.1);
    }
    g.stroke({ width: Math.max(1, t * 0.08), color: gloss, alpha: 0.75, cap: 'round' });
  }

  /**
   * What moves on the fall, each frame over its streams: gloss running down them, and a
   * splash where each lands, a crown of drops thrown up and ripples spreading on the pool.
   */
  private drawFall(view: ViewTransform, fall: TimerSpot): void {
    const g = this.flowGfx;
    const t = view.tile;
    const f = this.fallShape(view, fall);
    const still = motionReduced();
    const gloss = hex(this.art.palette.waterFoam);
    const phase = (period: number, k: number): number =>
      still ? 0.5 : (((this.clock / period + hash(k, 42)) % 1) + 1) % 1;
    const streams = this.streams(f);
    // Gloss running down: short glints, each stream on its own beat.
    streams.forEach((s, k) => {
      for (let j = 0; j < 2; j++) {
        const run = phase(700, k * 2 + j);
        const y = f.lip + (f.poolY - f.lip) * run;
        const x = s.x + s.w * (0.05 - 0.2 * run) * (j === 0 ? 1 : -1);
        g.moveTo(x, y).lineTo(x, Math.min(f.poolY - t * 0.05, y + t * 0.3));
      }
    });
    g.stroke({ width: Math.max(1, t * 0.07), color: 0xffffff, alpha: 0.7, cap: 'round' });
    // Ripples spreading on the pool from each stream's foot.
    streams.forEach((s, k) => {
      const p = phase(1300, k + 10);
      g.ellipse(s.x, f.poolY + t * 0.05, s.w * (1.3 + p * 1.6), t * (0.12 + p * 0.18));
      g.stroke({ width: Math.max(1, t * 0.06), color: gloss, alpha: 0.6 * (1 - p) });
    });
    // The splash: a foot of cream where each lands, drops thrown up and falling back.
    for (const s of streams) g.ellipse(s.x, f.poolY, s.w * 1.4, t * 0.13);
    g.fill({ color: gloss, alpha: 0.9 });
    streams.forEach((s, k) => {
      for (let j = 0; j < 3; j++) {
        const p = phase(600, k * 3 + j + 20);
        const side = (j - 1) * 0.9 + (hash(k, j, 46) - 0.5) * 0.4;
        const x = s.x + side * s.w * (1 + p * 1.4);
        const y = f.poolY - Math.sin(p * Math.PI) * t * (0.3 + 0.15 * hash(k, j, 47));
        g.circle(x, y, t * 0.085 * (1 - p * 0.5));
      }
    });
    g.fill({ color: gloss, alpha: 0.9 });
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground iced in a pastel of the owner's colour, edged with a border of piped
   * icing all round where it ends, and sprinkled.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      const icing = mixed(this.colour(player, 'light'), 0xffffff, this.style.icingWhite);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: icing, alpha: this.style.territoryAlpha });
      // Sprinkles on the icing: the owner's darker shade, white and gold.
      const sprinkle = [this.colour(player, 'dark'), 0xffffff, hex(this.art.palette.uiAccent)];
      for (const [k, colour] of sprinkle.entries()) {
        for (const { x, y } of cells) {
          if (hash(x, y, 50 + k) > 0.3) continue;
          const px = tileX(view, x) + t * (0.2 + 0.6 * hash(x, y, 60 + k));
          const py = tileY(view, y) + t * (0.2 + 0.6 * hash(x, y, 70 + k));
          const a = hash(x, y, 80 + k) * Math.PI;
          const d = t * 0.1;
          g.moveTo(px - Math.cos(a) * d, py - Math.sin(a) * d);
          g.lineTo(px + Math.cos(a) * d, py + Math.sin(a) * d);
        }
        g.stroke({ width: Math.max(1, t * 0.08), color: colour, cap: 'round' });
      }
      // The piped border: a row of dollops just inside every edge where the icing ends.
      const dollop = t * 0.13;
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        const inset = t * 0.13;
        const sides: [boolean, number, number, number, number][] = [
          [!owned(x, y - 1), px, py + inset, px + t, py + inset],
          [!owned(x, y + 1), px, py + t - inset, px + t, py + t - inset],
          [!owned(x - 1, y), px + inset, py, px + inset, py + t],
          [!owned(x + 1, y), px + t - inset, py, px + t - inset, py + t],
        ];
        for (const [open, ax, ay, bx, by] of sides) {
          if (!open) continue;
          for (const k of [0.25, 0.75]) g.circle(ax + (bx - ax) * k, ay + (by - ay) * k, dollop);
        }
      }
      g.fill({ color: 0xffffff, alpha: 0.95 });
      g.stroke({ width: Math.max(1, t * 0.04), color: this.colour(player, 'base'), alpha: 0.7 });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  /** One island's structures, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const { palette } = this.art;
    const t = view.tile;
    const wallAt = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;

    this.walls = [];
    for (let owner = 0; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      if (owner > 0) for (const c of cells) this.walls.push({ ...c, owner: owner - 1 });
      this.drawBar(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawCake(g, view, castle);

    // Guns: a cupcake in a pleated case of the owner's colour, frosted; slumped when silenced.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = Math.min(cannon.w, cannon.h) * t * 0.4;
      cannonBase(
        g,
        view,
        cannon,
        this.colour(cannon.owner, 'dark'),
        this.colour(cannon.owner, 'base'),
      );
      g.ellipse(cx + t * 0.08, cy + r * 0.75, r * 0.95, r * 0.35);
      g.fill({ color: hex(palette.shadow), alpha: 0.3 });
      const caseTop = cy - r * 0.05;
      const caseFoot = cy + r * 0.75;
      g.poly([
        cx - r * 0.95,
        caseTop,
        cx + r * 0.95,
        caseTop,
        cx + r * 0.7,
        caseFoot,
        cx - r * 0.7,
        caseFoot,
      ]);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      for (let k = 1; k < 6; k++) {
        const f = k / 6;
        g.moveTo(cx - r * 0.95 + r * 1.9 * f, caseTop).lineTo(cx - r * 0.7 + r * 1.4 * f, caseFoot);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(cannon.owner, 'dark') });
      // The frosting: piled up while it is live, slumped flat and grey when not.
      const cream = cannon.active ? hex(palette.rockLight) : hex(palette.rockDark);
      const pile = cannon.active ? 1 : 0.45;
      g.ellipse(cx, caseTop, r, r * 0.42);
      g.ellipse(cx, caseTop - r * 0.32 * pile, r * 0.72, r * 0.34);
      g.ellipse(cx, caseTop - r * 0.6 * pile, r * 0.42, r * 0.24);
      g.fill({ color: cream });
      g.ellipse(cx, caseTop, r, r * 0.42);
      g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.5 });
      g.circle(cx - r * 0.3, caseTop - r * 0.4 * pile, r * 0.1);
      g.fill({ color: 0xffffff, alpha: 0.7 });
    }
  }

  /**
   * Walls as a bar of chocolate: each block a scored square under a glossy coating of the
   * owner's colour, its face showing the bar cut through — coating, a layer of filling,
   * chocolate — and here and there a drip of coating running down it. A player's who is out
   * (`player` -1) has gone grey-white with sugar bloom, as old chocolate does.
   */
  private drawBar(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
    alpha = 1,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const bloom = player < 0;
    const coat = bloom
      ? mixed(hex(palette.craterMid), hex(palette.rockMid), 0.7)
      : this.colour(player, 'base');
    const coatDark = bloom
      ? mixed(hex(palette.craterMid), hex(palette.rockMid), 0.5)
      : this.colour(player, 'dark');
    const coatLight = bloom ? hex(palette.rockLight) : this.colour(player, 'light');
    const chocolate = bloom
      ? mixed(hex(palette.craterMid), hex(palette.rockMid), 0.45)
      : hex(palette.craterMid);
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: coat, alpha });
    // Each square a bar's segment: the groove dark round it, and inside it a raised square
    // scored into the top, lit on its upper and left edges and shaded on the others, as a
    // moulded bar's are. Every block once carried the same curl of gloss, which repeated
    // down every wall like a stamp (S9); the shine that slides across now and then is gloss
    // enough.
    const bevel = Math.max(1, t * 0.055);
    for (const b of wall.blocks) {
      const inset = t * 0.2;
      g.rect(b.left + inset, b.top + inset, t - inset * 2, b.lip - b.top - inset * 2);
    }
    g.fill({ color: coatLight, alpha: 0.28 * alpha });
    for (const b of wall.blocks) g.rect(b.left, b.top, t, b.lip - b.top);
    g.stroke({ width: Math.max(1, t * 0.06), color: coatDark, alpha: 0.8 * alpha });
    for (const b of wall.blocks) {
      const inset = t * 0.2;
      const x1 = b.left + inset;
      const y1 = b.top + inset;
      const x2 = b.left + t - inset;
      const y2 = b.lip - inset;
      g.moveTo(x1, y2).lineTo(x1, y1).lineTo(x2, y1);
    }
    g.stroke({ width: bevel, color: 0xffffff, alpha: (bloom ? 0.2 : 0.55) * alpha });
    for (const b of wall.blocks) {
      const inset = t * 0.2;
      const x1 = b.left + inset;
      const y1 = b.top + inset;
      const x2 = b.left + t - inset;
      const y2 = b.lip - inset;
      g.moveTo(x2, y1).lineTo(x2, y2).lineTo(x1, y2);
    }
    g.stroke({ width: bevel, color: coatDark, alpha: 0.75 * alpha });

    // The bar cut through, down its face: coating, filling, chocolate.
    const face = wall.face;
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h * 0.3);
    g.fill({ color: coatDark, alpha });
    for (const r of wall.faces) g.rect(r.x, r.y + r.h * 0.3, r.w, r.h * 0.18);
    g.fill({ color: bloom ? hex(palette.rockMid) : hex(palette.rockLight), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y + r.h * 0.48, r.w, r.h * 0.52);
    g.fill({ color: chocolate, alpha });
    // Drips of coating running down over the chocolate: none on most blocks, one on some and
    // two on a few, each placed, sized and run to its own length by the block's hash, so no
    // two neighbours drip alike (S9). A bead of coating swells at the lip where each starts.
    if (!bloom) {
      for (const b of wall.blocks) {
        if (!b.faced) continue;
        const roll = hash(b.x, b.y, 90);
        if (roll > this.style.dripShare) continue;
        const two = roll < this.style.dripShare * 0.35;
        for (let k = 0; k < (two ? 2 : 1); k++) {
          // Two drips keep to their own halves of the block; one may fall anywhere on it.
          const from = two ? 0.14 + k * 0.44 : 0.16;
          const span = two ? 0.28 : 0.68;
          const x = b.left + t * (from + span * hash(b.x, b.y, 91 + k * 4));
          const length = face * (0.3 + 0.6 * hash(b.x, b.y, 92 + k * 4));
          const w = t * (0.08 + 0.08 * hash(b.x, b.y, 93 + k * 4));
          g.rect(x - w / 2, b.lip, w, length);
          g.circle(x, b.lip + length, w * 0.62);
          g.ellipse(x, b.lip, w * 1.1, w * 0.45);
        }
      }
      g.fill({ color: coatDark, alpha });
    }
    // Sugar bloom: pale blotches over the grey.
    if (bloom) {
      for (const b of wall.blocks) {
        for (let k = 0; k < 3; k++) {
          g.circle(
            b.left + t * (0.15 + 0.7 * hash(b.x, b.y, 93 + k)),
            b.top + t * (0.15 + 0.6 * hash(b.x, b.y, 96 + k)),
            t * (0.07 + 0.08 * hash(b.x, b.y, 99 + k)),
          );
        }
      }
      g.fill({ color: 0xffffff, alpha: 0.45 * alpha });
    }
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.75 * alpha });

    // On a snowy match, sprinkles lie on the tops of the walls.
    if (this.snowy && !bloom && alpha === 1) {
      for (const [k, colour] of SPRINKLES.entries()) {
        for (const b of wall.blocks) {
          if (hash(b.x, b.y, 110 + k) > 0.35) continue;
          const px = b.left + t * (0.15 + 0.7 * hash(b.x, b.y, 120 + k));
          const py = b.top + (b.lip - b.top) * (0.15 + 0.7 * hash(b.x, b.y, 130 + k));
          const a = hash(b.x, b.y, 140 + k) * Math.PI;
          const d = t * 0.09;
          g.moveTo(px - Math.cos(a) * d, py - Math.sin(a) * d);
          g.lineTo(px + Math.cos(a) * d, py + Math.sin(a) * d);
        }
        g.stroke({ width: Math.max(1, t * 0.07), color: colour, cap: 'round' });
      }
    }
  }

  private cake(view: ViewTransform, castle: Castle): Cake {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot1 = tileY(view, castle.y + castle.h) - t * 0.05;
    const lip1 = foot1 - W * 0.2;
    const top1 = lip1 - W * 0.42;
    const lip2 = top1 + W * 0.06;
    const top2 = lip2 - W * 0.42;
    return {
      cx,
      top1,
      lip1,
      foot1,
      half1: W * 0.47,
      top2,
      lip2,
      half2: W * 0.3,
      bowlY: top2 + W * 0.12,
      bowlR: W * 0.2,
    };
  }

  /**
   * A castle as a two-tier cake iced in the owner's colour, icing dripping over the edge of
   * each tier, with a chocolate fountain's basin on top. The chocolate in it, and its
   * running, are drawn with the effects, since they say whether the castle is sealed.
   */
  private drawCake(g: Graphics, view: ViewTransform, castle: Castle): void {
    const { palette } = this.art;
    const t = view.tile;
    const owner = castle.islandId - 1;
    const c = this.cake(view, castle);
    const sponge = hex(palette.craterMid);
    g.ellipse(c.cx + t * 0.1, c.foot1, c.half1 * 1.05, t * 0.22);
    g.fill({ color: hex(palette.shadow), alpha: 0.3 });
    for (const [top, lip, foot, half] of [
      [c.top1, c.lip1, c.foot1, c.half1],
      [c.top2, c.lip2, c.top1 + (c.lip1 - c.top1) * 0.5, c.half2],
    ] as const) {
      // The side of the tier, chocolate sponge, then its iced top.
      g.roundRect(c.cx - half, lip - t * 0.1, half * 2, foot - lip + t * 0.1, t * 0.12);
      g.fill({ color: sponge });
      g.roundRect(c.cx - half, top, half * 2, lip - top, t * 0.16);
      g.fill({ color: this.colour(owner, 'base') });
      g.roundRect(
        c.cx - half + t * 0.08,
        top + t * 0.06,
        half * 2 - t * 0.16,
        (lip - top) * 0.45,
        t * 0.1,
      );
      g.fill({ color: this.colour(owner, 'light'), alpha: 0.6 });
      // Icing running over the edge in drips of uneven length.
      const drips = Math.max(3, Math.round((half * 2) / (t * 0.28)));
      for (let k = 0; k < drips; k++) {
        const x = c.cx - half + (half * 2 * (k + 0.5)) / drips;
        const length = (foot - lip) * (0.2 + 0.45 * hash(castle.id, k + Math.round(half), 150));
        g.roundRect(x - t * 0.07, lip - t * 0.04, t * 0.14, length, t * 0.07);
      }
      g.fill({ color: this.colour(owner, 'base') });
      g.roundRect(c.cx - half, top, half * 2, foot - top, t * 0.14);
      g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.7 });
    }
    // The fountain's basin: a gold bowl on a stem, empty until the castle is sealed.
    g.rect(c.cx - t * 0.07, c.bowlY - c.bowlR * 1.6, t * 0.14, c.bowlR * 1.6);
    g.fill({ color: hex(palette.uiAccent) });
    g.ellipse(c.cx, c.bowlY, c.bowlR, c.bowlR * 0.5);
    g.fill({ color: hex(palette.uiAccent) });
    g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.7 });
    g.ellipse(c.cx, c.bowlY - c.bowlR * 0.05, c.bowlR * 0.75, c.bowlR * 0.3);
    g.fill({ color: hex(palette.craterDark), alpha: 0.6 });
    g.circle(c.cx, c.bowlY - c.bowlR * 1.6, t * 0.1);
    g.fill({ color: hex(palette.uiAccent) });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea = this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (inSea) {
      // Chocolate is thick: a slow crown of drops, then a lazy ring.
      this.rings.push({ x, y, age: 0, owner: -1 });
      const drops = this.style.splashDrops;
      for (let k = 0; k < drops; k++) {
        const a = (k / drops) * Math.PI * 2 + Math.random() * 0.4;
        this.bits.push({
          x: x + 0.5 + Math.cos(a) * 0.15,
          y: y + 0.5,
          vx: Math.cos(a) * 0.9,
          vy: -2.4 - Math.random() * 1.2,
          age: 0,
          life: 900,
          floor: y + 0.5 + Math.sin(a) * 0.3,
          size: 0.09 + Math.random() * 0.06,
          colour: hex(this.art.palette.waterShallow),
          spin: -1,
        });
      }
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.splats.push({ x, y, round: this.round, seed: Math.random() * 6 });
      return;
    }
    for (const block of debris) {
      this.bites.push({ x: block.x, y: block.y, round: this.round });
      const coat =
        block.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(block.owner, 'base');
      // The square snaps off and flips away, and the bar crumbles round the break.
      this.snapped.push({
        x: block.x + 0.5,
        y: block.y + 0.5,
        vx: (Math.random() - 0.5) * 2.4,
        vy: -3.2,
        age: 0,
        colour: coat,
      });
      for (let k = 0; k < this.style.crumbsPerBlock; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8;
        const v = 1.4 + Math.random() * 1.8;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * 1.4,
          floor: block.y + 0.85 + Math.random() * 0.3,
          size: 0.06 + Math.random() * 0.08,
          colour: k % 3 === 0 ? coat : hex(this.art.palette.craterMid),
          spin: Math.random() * Math.PI,
        });
      }
    }
  }

  /** The sweep: a block left alone melts into a puddle and sinks away. */
  noteCrumble(block: Debris): void {
    this.melts.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.wobbles.push({ cells, owner, age: 0 });
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    perf.begin('flow');
    this.drawFlow(state, view, frame.deltaMs);
    perf.end('flow');
    const g = this.effectGfx;
    g.clear();
    this.effectTopGfx.clear();
    this.lateGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.drawWobbles(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawShine(view);
    this.drawBites(state, view);
    const top = this.effectTopGfx;
    this.drawMelts(view, frame.deltaMs);
    this.ruins.draw(top, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(top, view, frame.choices, this.art);
    this.drawFountains(state, view, frame);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawRings(view, frame.deltaMs);
    this.drawSnapped(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawSprinkles(view, frame.deltaMs);
    this.drawHeat(state, view);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A piece poured into its mould: a stream from above, then the blocks wobble as they set. */
  private drawWobbles(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const w of this.wobbles) {
      w.age += deltaMs;
      const k = Math.min(1, w.age / WOBBLE_MS);
      const swing = Math.sin(k * Math.PI * 3) * (1 - k) * 0.16;
      for (const c of w.cells) {
        const cx = tileX(view, c.x + 0.5);
        const cy = tileY(view, c.y + 0.5);
        const sx = t * (1 + swing);
        const sy = t * (1 - swing);
        g.roundRect(cx - sx / 2, cy - sy / 2, sx, sy, t * 0.15);
      }
      g.fill({ color: this.colour(w.owner, 'light'), alpha: 0.5 * (1 - k) });
      if (k < 0.3) {
        for (const c of w.cells) {
          const cx = tileX(view, c.x + 0.5);
          const cy = tileY(view, c.y + 0.5);
          g.moveTo(cx, cy - t * 1.6 * (1 - k / 0.3)).lineTo(cx, cy);
        }
        g.stroke({
          width: t * 0.22,
          color: hex(this.art.palette.craterMid),
          alpha: 0.8,
          cap: 'round',
        });
      }
    }
    this.wobbles = this.wobbles.filter((w) => w.age < WOBBLE_MS);
  }

  /**
   * Now and then a band of gloss slides across a player's walls, corner to corner, like
   * light running over tempered chocolate. Each player's on its own beat.
   */
  private drawShine(view: ViewTransform): void {
    if (motionReduced() || this.walls.length === 0) return;
    const g = this.effectGfx;
    const t = view.tile;
    const face = this.faceFraction();
    const { shineEveryMs, shineMs } = this.style;
    const byOwner = new Map<number, { x: number; y: number }[]>();
    for (const w of this.walls) {
      const list = byOwner.get(w.owner);
      if (list === undefined) byOwner.set(w.owner, [w]);
      else list.push(w);
    }
    for (const [owner, blocks] of byOwner) {
      const k = ((this.clock + owner * 1777) % shineEveryMs) / shineMs;
      if (k >= 1) continue;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const b of blocks) {
        lo = Math.min(lo, b.x + b.y);
        hi = Math.max(hi, b.x + b.y + 2);
      }
      const d = lo - 1 + (hi - lo + 2) * k;
      for (const b of blocks) {
        const c = (d - (b.x + b.y)) * t;
        const h = t * (1 - face);
        const seg = across(c, t, h);
        if (seg === null) continue;
        const px = tileX(view, b.x);
        const py = tileY(view, b.y);
        g.moveTo(px + seg[0], py + seg[1]).lineTo(px + seg[2], py + seg[3]);
      }
      g.stroke({ width: t * 0.28, color: 0xffffff, alpha: 0.5, cap: 'round' });
    }
  }

  /**
   * Bite marks on the blocks either side of a breach, for the rest of the round. Hundreds
   * of arcs by the end of a round at eight players, some 4 000 vertices, so drawn again only
   * when a bite comes or goes or a block beside one does: the key names every tile read.
   */
  private drawBites(state: MatchState, view: ViewTransform): void {
    if (this.bites.some((b) => b.round !== state.round)) {
      this.bites = this.bites.filter((b) => b.round === state.round);
    }
    const wall = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.structure[y * state.width + x] === Structure.Wall;
    let key = viewKey(view);
    for (const b of this.bites) {
      key += `|${b.x},${b.y}:${+wall(b.x, b.y)}${+wall(b.x + 1, b.y)}${+wall(b.x - 1, b.y)}`;
      key += `${+wall(b.x, b.y + 1)}${+wall(b.x, b.y - 1)}`;
    }
    if (key === this.bitesDrawn) return;
    this.bitesDrawn = key;
    const g = this.biteGfx;
    g.clear();
    if (this.bites.length === 0) return;
    const t = view.tile;
    const r = t * 0.17;
    for (const b of this.bites) {
      if (wall(b.x, b.y)) continue;
      const left = tileX(view, b.x);
      const top = tileY(view, b.y);
      // Each neighbour still standing, its edge on the hole, and the way into it.
      const sides: [number, number, number, number, number, number][] = [
        [1, 0, left + t, top, 0, 1],
        [-1, 0, left, top, 0, 1],
        [0, 1, left, top + t, 1, 0],
        [0, -1, left, top, 1, 0],
      ];
      for (const [dx, dy, ex, ey, ax, ay] of sides) {
        if (!wall(b.x + dx, b.y + dy)) continue;
        const start = dx === 1 ? -Math.PI / 2 : dx === -1 ? Math.PI / 2 : dy === 1 ? 0 : Math.PI;
        for (const k of [0.3, 0.7]) {
          const bx = ex + ax * t * k;
          const by = ey + ay * t * k;
          g.moveTo(bx, by)
            .arc(bx, by, r, start, start + Math.PI)
            .lineTo(bx, by);
        }
      }
    }
    g.fill({ color: hex(this.art.palette.craterMid) });
  }

  /** The sweep's blocks: sagging into a puddle of their coating that sinks away. */
  private drawMelts(view: ViewTransform, deltaMs: number): void {
    const g = this.effectTopGfx;
    const t = view.tile;
    for (const m of this.melts) {
      m.age += deltaMs;
      const k = Math.min(1, m.age / MELT_MS);
      const colour = m.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(m.owner, 'base');
      const left = tileX(view, m.x);
      const top = tileY(view, m.y);
      const sag = t * (1 - Math.min(1, k * 1.6));
      if (sag > 0) {
        g.roundRect(left + t * 0.05, top + t - sag, t * 0.9, sag, t * 0.2);
        g.fill({ color: colour });
      }
      g.ellipse(left + t / 2, top + t * 0.85, t * (0.4 + 0.35 * k), t * (0.15 + 0.12 * k));
      g.fill({ color: colour, alpha: 0.85 * (1 - k) });
    }
    this.melts = this.melts.filter((m) => m.age < MELT_MS);
  }

  /**
   * The fountains: chocolate filling each sealed castle's basin, a jet rising from it and
   * running down over the tiers, beads of it sliding down each stream. Started by sealing
   * and stopped by a breach, as a flag is hoisted and lowered, so "sealed" is the chocolate
   * moving.
   *
   * What stands still — the basin's chocolate, the pools and the gloss — is a castle's
   * `Memos` entry, redrawn only while the fountain starts or stops; the jet and the drips are
   * stamps, a drip drawn once for each eighth of a pixel of its length. Nothing of a
   * fountain's touches another's or its own gloss, so the order of the parts is free.
   */
  private drawFountains(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const flow = hex(this.art.palette.waterShallow);
    const still = motionReduced();
    this.drawCrowns(state, view, frame.castleSealed);
    this.fountains.update(frame.castleSealed, this.clock, this.art);
    const memo = this.fountainMemo;
    const stamps = this.fountainStamps;
    const where = viewKey(view);
    memo.begin();
    stamps.begin();
    for (const castle of state.castles) {
      const running = this.fountains.raised(castle.id, this.clock, this.art);
      if (running === null) continue;
      const c = this.cake(view, castle);
      const key = `${where}|${castle.x},${castle.y},${castle.w},${castle.h}|${running}`;
      memo.draw(castle.id, key, (g) => this.drawFountainStill(g, view, c, running));
      // The jet, bobbing, from the stem's top into the basin.
      const jetTop = c.bowlY - c.bowlR * (1.6 + 0.8 * running);
      const bob = still ? 0 : Math.sin(this.clock / 180 + castle.id) * t * 0.05;
      const r = Math.round(t * 0.11 * running * 8) / 8;
      const jet = this.book.get(`jet|${r}`, t, (g) => {
        g.circle(0, 0, r);
        g.fill({ color: flow });
      });
      stamps.place(jet, c.cx, jetTop + bob);
      // A few thin drips between the pools, swelling and shrinking.
      const swell = (k: number): number =>
        still ? 0.8 : 0.65 + 0.35 * Math.sin(this.clock / 700 + k * 1.9 + castle.id);
      const upperFoot = c.top1 + (c.lip1 - c.top1) * 0.5;
      const drop = (x: number, from: number, length: number): void => {
        const long = Math.round(length * 8) / 8;
        const drip = this.book.get(`drip|${long}`, t, (g) => {
          const w = t * 0.11;
          g.roundRect(-w / 2, -t * 0.04, w, long, w / 2);
          g.circle(0, long - w * 0.3, w * 0.6);
          g.fill({ color: flow });
        });
        stamps.place(drip, x, from);
      };
      [-0.5, 0.5].forEach((s2, k) =>
        drop(c.cx + c.half2 * s2, c.lip2, (upperFoot - c.lip2) * swell(k) * running),
      );
      [-0.6, 0.6].forEach((s2, k) =>
        drop(c.cx + c.half1 * s2, c.lip1, (c.foot1 - c.lip1) * 0.7 * swell(k + 3) * running),
      );
    }
    memo.end();
    stamps.end();
  }

  /**
   * A fountain's still parts: the chocolate in the basin, a pool round the basin's stem on
   * the upper tier, a thin collar where it pools at that tier's foot, and the gloss. A glaze
   * over each whole tier hid the owner's icing, so a sealed cake read as plain brown, less
   * owned than a breached one (the style review).
   */
  private drawFountainStill(g: Graphics, view: ViewTransform, c: Cake, running: number): void {
    const t = view.tile;
    const { palette } = this.art;
    const flow = hex(palette.waterShallow);
    g.ellipse(c.cx, c.bowlY - c.bowlR * 0.05, c.bowlR * 0.75 * running, c.bowlR * 0.3 * running);
    g.fill({ color: flow });
    const upperFoot = c.top1 + (c.lip1 - c.top1) * 0.5;
    g.ellipse(
      c.cx,
      c.top2 + (c.lip2 - c.top2) * 0.6,
      c.half2 * 0.45 * running,
      (c.lip2 - c.top2) * 0.28 * running,
    );
    g.roundRect(
      c.cx - c.half2 * 1.05 * running,
      upperFoot - t * 0.05,
      c.half2 * 2.1 * running,
      t * 0.12 * running,
      t * 0.06,
    );
    g.fill({ color: flow });
    g.ellipse(
      c.cx - c.half2 * 0.15,
      c.top2 + (c.lip2 - c.top2) * 0.5,
      c.half2 * 0.18 * running,
      t * 0.04 * running,
    );
    g.fill({ color: hex(palette.waterFoam), alpha: 0.7 });
  }

  /** The main castles' crowns (`drawMainCastles`), drawn again only when one changes. */
  private drawCrowns(state: MatchState, view: ViewTransform, sealed: readonly boolean[]): void {
    let key = viewKey(view);
    for (const player of state.players) {
      if (player.eliminated || player.startingCastleId === null) continue;
      const castle = state.castles.find((c) => c.id === player.startingCastleId);
      if (castle === undefined) continue;
      key += `|${player.id}:${castle.x},${castle.y},${castle.w},${castle.h},${sealed[castle.id] === true}`;
    }
    if (key === this.crownKey) return;
    this.crownKey = key;
    this.crownGfx.clear();
    drawMainCastles(this.crownGfx, view, state, this.art, sealed);
  }

  /**
   * Barrels: a candy cane from the cupcake, striped in the owner's colour and white,
   * turning to its target and kicking back as it fires a puff of cocoa. A silenced gun's
   * cane droops, soft, its stripes faded.
   */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const memo = this.gunMemo;
    memo.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      // Still between shots: drawn again only as it fires, kicks and puffs.
      const moving = aim.firedAgo < Math.max(RECOIL_MS, PUFF_MS);
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.owner},${cannon.active}|${aim.angle}|${moving ? aim.firedAgo : '-'}`;
      memo.draw(cannon.id, key, (g) => this.drawBarrel(g, view, cannon, aim));
    }
    memo.end();
    this.aims.prune(state);
  }

  private drawBarrel(g: Graphics, view: ViewTransform, cannon: Cannon, aim: Aim): void {
    const t = view.tile;
    const { palette } = this.art;
    const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
    const length = cannon.active ? 1.05 - 0.3 * kick : 0.75;
    const cx = cannon.x + cannon.w / 2;
    const cy = cannon.y + cannon.h / 2 - 0.25;
    const dx = Math.sin(aim.angle);
    const dy = -Math.cos(aim.angle);
    const sx = tileX(view, cx);
    const sy = tileY(view, cy);
    const ex = tileX(view, cx + dx * length);
    const ey = tileY(view, cy + dy * length) + (cannon.active ? 0 : t * 0.35);
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2 + (cannon.active ? 0 : t * 0.25);
    const width = Math.max(3, t * 0.26);
    const stripe = this.colour(cannon.owner, cannon.active ? 'base' : 'dark');
    const white = cannon.active ? 0xffffff : hex(palette.rockMid);
    g.moveTo(sx, sy).quadraticCurveTo(mx, my, ex, ey);
    g.stroke({ width: width + this.ink(view) * 2, color: hex(palette.shadow), cap: 'round' });
    g.moveTo(sx, sy).quadraticCurveTo(mx, my, ex, ey);
    g.stroke({ width, color: white, cap: 'round' });
    // The stripes: short bands across the cane, every other one in the owner's colour.
    const at = (f: number): [number, number] => [
      (1 - f) * (1 - f) * sx + 2 * (1 - f) * f * mx + f * f * ex,
      (1 - f) * (1 - f) * sy + 2 * (1 - f) * f * my + f * f * ey,
    ];
    for (let k = 0; k < 6; k += 2) {
      const [ax, ay] = at(k / 6 + 0.04);
      const [bx, by] = at((k + 1) / 6 + 0.04);
      g.moveTo(ax, ay).lineTo(bx, by);
    }
    g.stroke({ width, color: stripe, cap: 'butt' });
    // The cocoa puff from the muzzle.
    if (cannon.active && aim.firedAgo < PUFF_MS) {
      const k = aim.firedAgo / PUFF_MS;
      for (let n = 0; n < 3; n++) {
        const d = t * (0.2 + 0.5 * k + n * 0.15);
        g.circle(ex + dx * d, ey + dy * d, t * (0.12 + 0.22 * k) * (1 - n * 0.2));
      }
      g.fill({ color: hex(palette.craterMid), alpha: 0.5 * (1 - k) });
    }
  }

  /**
   * Shots: a bonbon in foil of the owner's colour, its twisted ends spinning, over its
   * shadow. Stamps, placed in the order drawn, shot over shot: the shadow and the bonbon
   * drawn once for each eighth of a pixel of their size, each twisted end a triangle drawn
   * once and laid by its three corners. Drawn anew each frame they were some 2 000 vertices
   * in a salvo at eight players. The marks where one's own shots will land lie over them all
   * (`lateGfx`), as each lay over its own shot.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const stamps = this.shotStamps;
    const t = view.tile;
    const ink = this.ink(view);
    const now = state.tick + frame.tickFraction;
    const triangle = this.book.get('triangle', t, (k) => {
      k.poly([0, 0, 1, 0, 0, 1]);
      k.fill({ color: 0xffffff });
    });
    stamps.begin();
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / 3);
      const rx = Math.round(t * (0.28 - 0.12 * high) * 8) / 8;
      const shade = this.book.get(`shotShadow|${rx}`, t, (k) => {
        k.ellipse(0, 0, rx, rx / 2);
        k.fill({ color: 0x000000 });
      });
      // A stamp laid as a twisted end last frame keeps its skew, which `place` leaves alone.
      stamps.place(shade, gx, gy, { alpha: 0.28 - 0.14 * high }).skew.set(0, 0);
      const hy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5 - lift);
      const r = t * (0.2 + 0.1 * high);
      const spin = p * Math.PI * 5 + shot.id;
      const ux = Math.cos(spin);
      const uy = Math.sin(spin) * 0.6;
      const light = this.colour(shot.owner, 'light');
      for (const side of [1, -1]) {
        const bx = gx + ux * r * 0.8 * side;
        const by = hy + uy * r * 0.8 * side;
        const tx = gx + ux * r * 1.9 * side;
        const ty = hy + uy * r * 1.9 * side;
        // The unit triangle's corners carried to the end's: its base and its two tips.
        this.corners.set(
          tx - uy * r * 0.7 - bx,
          ty + ux * r * 0.7 - by,
          tx + uy * r * 0.7 - bx,
          ty - ux * r * 0.7 - by,
          bx,
          by,
        );
        stamps.place(triangle, 0, 0, { tint: light }).setFromMatrix(this.corners);
      }
      const radius = Math.round(r * 8) / 8;
      const bonbon = this.book.get(`bonbon|${shot.owner}|${radius}`, t, (k) => {
        k.circle(0, 0, radius);
        k.fill({ color: this.colour(shot.owner, 'base') });
        k.stroke({ width: ink, color: hex(this.art.palette.shadow), alpha: 0.8 });
        k.circle(-radius * 0.35, -radius * 0.35, radius * 0.28);
        k.fill({ color: 0xffffff, alpha: 0.85 });
      });
      stamps.place(bonbon, gx, hy).skew.set(0, 0);
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    stamps.end();
  }

  private drawRings(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.rings) {
      s.age += deltaMs;
      const k = s.age / RING_MS;
      if (k >= 1) continue;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.ellipse(cx, cy, t * (0.3 + 0.9 * k), t * (0.18 + 0.55 * k));
      g.stroke({
        width: Math.max(1.5, t * 0.1),
        color: hex(this.art.palette.waterFoam),
        alpha: 0.7 * (1 - k),
      });
    }
    this.rings = this.rings.filter((s) => s.age < RING_MS);
  }

  /** The squares a shot snaps off: flipping end over end as they fly, then gone. */
  private drawSnapped(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const s of this.snapped) {
      s.age += deltaMs;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 9 * dt;
      const k = s.age / SNAP_MS;
      if (k >= 1) continue;
      const flip = Math.cos(k * Math.PI * 4);
      const size = t * 0.8 * (1 - k * 0.5);
      const x = tileX(view, s.x);
      const y = tileY(view, s.y);
      g.rect(x - size / 2, y - (size * Math.abs(flip)) / 2, size, size * Math.abs(flip) + 1);
      g.fill({ color: flip > 0 ? s.colour : hex(this.art.palette.craterMid), alpha: 1 - k * k });
    }
    this.snapped = this.snapped.filter((s) => s.age < SNAP_MS);
  }

  /** Crumbs and drops of chocolate, falling and bouncing once; drops splash and are gone. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 7 * dt;
      if (b.y > b.floor && b.vy > 0) {
        if (b.spin < 0) {
          b.age = b.life;
          continue;
        }
        b.y = b.floor;
        b.vy *= -0.3;
        b.vx *= 0.5;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      const s = b.size * t;
      if (b.spin < 0) {
        g.circle(x, y, s);
        g.fill({ color: b.colour, alpha });
      } else {
        g.rect(x - s, y - s, s * 2, s * 1.6);
        g.fill({ color: b.colour, alpha });
      }
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** On a snowy match, sprinkles drift down over the board instead of snow. */
  private drawSprinkles(view: ViewTransform, deltaMs: number): void {
    if (!this.snowy || motionReduced()) return;
    const g = this.lateGfx;
    const t = view.tile;
    while (this.sprinkles.length < this.style.sprinkleCount) {
      this.sprinkles.push({
        x: Math.random() * view.width,
        y: view.top + Math.random() * (view.height - view.top),
        vy: t * (1.2 + Math.random()),
        angle: Math.random() * Math.PI,
        colour: SPRINKLES[Math.floor(Math.random() * SPRINKLES.length)]!,
      });
    }
    const dt = deltaMs / 1000;
    const groups = new Map<number, Sprinkle[]>();
    for (const s of this.sprinkles) {
      s.y += s.vy * dt;
      s.x += Math.sin(this.clock / 900 + s.angle * 4) * t * 0.3 * dt;
      s.angle += dt * 2;
      if (s.y > view.height) {
        s.y = view.top;
        s.x = Math.random() * view.width;
      }
      const list = groups.get(s.colour);
      if (list === undefined) groups.set(s.colour, [s]);
      else list.push(s);
    }
    const d = t * 0.12;
    for (const [colour, list] of groups) {
      for (const s of list) {
        g.moveTo(s.x - Math.cos(s.angle) * d, s.y - Math.sin(s.angle) * d);
        g.lineTo(s.x + Math.cos(s.angle) * d, s.y + Math.sin(s.angle) * d);
      }
      g.stroke({ width: Math.max(1.5, t * 0.09), color: colour, cap: 'round' });
    }
  }

  /**
   * The heat of overtime and the final round: chocolate melting down from the top of the
   * board, drips gathering and falling, while the shared border and dusk carry the meaning.
   */
  private drawHeat(state: MatchState, view: ViewTransform): void {
    const hot = climax(state);
    if (!hot) return;
    const g = this.lateGfx;
    const t = view.tile;
    const { palette } = this.art;
    const left = Math.max(0, view.originX);
    const right = Math.min(view.width, view.originX + this.width * t);
    const top = Math.max(view.top, view.originY);
    const still = motionReduced();
    g.rect(left, top, right - left, t * 0.28);
    const count = Math.max(6, Math.round((right - left) / (t * 1.8)));
    for (let k = 0; k < count; k++) {
      const x = left + ((right - left) * (k + 0.5)) / count + (hash(k, 160) - 0.5) * t;
      const period = 2600 + 1800 * hash(k, 161);
      const phase = still ? 0.5 : (((this.clock / period + hash(k, 162)) % 1) + 1) % 1;
      const max = t * (0.8 + 1.4 * hash(k, 163));
      const grow = Math.min(1, phase / 0.75);
      const length = max * grow;
      const w = t * (0.2 + 0.1 * hash(k, 164));
      g.rect(x - w / 2, top, w, length);
      g.circle(x, top + length, w * 0.7);
      // Gathered to its fullest, the drop lets go and falls.
      if (phase > 0.75) {
        const fall = (phase - 0.75) / 0.25;
        g.circle(x, top + max + fall * t * 3, w * 0.65);
      }
    }
    // Dark chocolate, so it stands out against the milk of the river, with a glossy streak.
    g.fill({ color: hex(palette.craterDark) });
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.shadow), alpha: 0.6 });
    for (let k = 0; k < count; k++) {
      const x = left + ((right - left) * (k + 0.5)) / count + (hash(k, 160) - 0.5) * t;
      g.moveTo(x - t * 0.04, top + t * 0.1).lineTo(x - t * 0.04, top + t * 0.45);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.waterFoam), alpha: 0.5 });
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    drawOvertimeBorder(g, state, view, this.art, performance.now());
    drawSelectable(g, view, ghost, this.art, performance.now());
    drawBuildHints(g, view, ghost, this.art, performance.now());
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      // The piece in hand as an empty mould, its cavities waiting to be poured; cracked
      // where it does not fit — the difference in form, since red is a player's colour.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const rim = ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: rim, alpha: 0.55 });
      for (const { x, y } of cells) {
        g.roundRect(
          tileX(view, x) + t * 0.14,
          tileY(view, y) + t * 0.14,
          t * 0.72,
          t * 0.72,
          t * 0.12,
        );
      }
      g.fill({ color: mixed(rim, hex(palette.shadow), 0.55), alpha: 0.7 });
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        g.moveTo(px + t * 0.2, py + t * 0.8).lineTo(px + t * 0.8, py + t * 0.8);
        g.lineTo(px + t * 0.8, py + t * 0.2);
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: 0xffffff, alpha: 0.45 });
      trace(g, outline(cells, inPiece, view));
      g.stroke({
        width: Math.max(1.5, t * 0.1),
        color: ghost.valid ? 0xffffff : hex(palette.uiInvalid),
        alpha: 0.9,
      });
      if (!ghost.valid) {
        for (const { x, y } of cells) {
          const px = tileX(view, x);
          const py = tileY(view, y);
          g.moveTo(px + t * 0.2, py + t * 0.15).lineTo(px + t * 0.45, py + t * 0.45);
          g.lineTo(px + t * 0.35, py + t * 0.6).lineTo(px + t * 0.75, py + t * 0.88);
        }
        g.stroke({ width: Math.max(1.5, t * 0.09), color: hex(palette.uiInvalid), join: 'round' });
      }
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // A cupcake case waiting for its cake, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.4;
      g.poly([
        cx - r * 0.95,
        cy - r * 0.05,
        cx + r * 0.95,
        cy - r * 0.05,
        cx + r * 0.7,
        cy + r * 0.75,
        cx - r * 0.7,
        cy + r * 0.75,
      ]);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      g.ellipse(cx, cy - r * 0.05, r, r * 0.42);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: colour });
      if (!ghost.valid) {
        g.moveTo(cx - r, cy + r).lineTo(cx + r, cy - r);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Chocolate's scenery, all sweets, none like a wall, a gun or a bonbon in flight: a tree a
 * lollipop with a swirl, or now and then a gummy bear or a gingerbread house, a pine a tall swirl of soft meringue, a bush a puff of candy floss,
 * a boulder a cookie lying flat with its chips.
 */
function drawChocolateScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  const ink = Math.max(1, t * 0.06);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    const candy = CANDY[item.variant % CANDY.length]!;
    // A lollipop's place is now and then taken by a gummy bear or a gingerbread house, so a
    // copse is not row after row of the same lollipop (S9); by the tile's hash, so it stays.
    const pick = hash(item.x, item.y, 150);
    if (item.kind === 'tree' && pick < GINGERBREAD_SHARE) {
      drawGingerbread(g, cx, cy, t, art);
    } else if (item.kind === 'tree' && pick < GINGERBREAD_SHARE + GUMMY_SHARE) {
      drawGummyBear(g, cx, cy, t, candy, art);
    } else if (item.kind === 'tree') {
      g.ellipse(cx + t * 0.08, cy + t * 0.36, t * 0.22, t * 0.08);
      g.fill({ color: hex(palette.shadow), alpha: 0.25 });
      g.moveTo(cx, cy + t * 0.36).lineTo(cx, cy - t * 0.05);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0xffffff });
      const r = t * 0.3;
      const y = cy - t * 0.15;
      g.circle(cx, y, r);
      g.fill({ color: candy });
      g.moveTo(cx, y);
      for (let k = 1; k <= 18; k++) {
        const f = k / 18;
        const a = f * Math.PI * 4;
        g.lineTo(cx + Math.cos(a) * r * f * 0.9, y + Math.sin(a) * r * f * 0.9);
      }
      g.stroke({ width: Math.max(1, t * 0.07), color: 0xffffff, alpha: 0.9 });
      g.circle(cx, y, r);
      g.stroke({ width: ink, color: hex(palette.shadow), alpha: 0.5 });
    } else if (item.kind === 'pine') {
      g.ellipse(cx + t * 0.08, cy + t * 0.34, t * 0.26, t * 0.09);
      g.fill({ color: hex(palette.shadow), alpha: 0.25 });
      for (const [dy, rx, ry] of [
        [0.22, 0.3, 0.14],
        [0.04, 0.24, 0.12],
        [-0.12, 0.17, 0.1],
        [-0.26, 0.1, 0.08],
      ] as const) {
        g.ellipse(cx, cy + t * dy, t * rx, t * ry);
      }
      g.fill({ color: hex(palette.rockLight) });
      g.moveTo(cx, cy - t * 0.42).lineTo(cx + t * 0.03, cy - t * 0.3);
      g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.rockLight), cap: 'round' });
      for (const dy of [0.22, 0.04, -0.12]) {
        g.moveTo(cx - t * 0.12, cy + t * (dy + 0.06)).lineTo(cx + t * 0.12, cy + t * (dy + 0.06));
      }
      g.stroke({ width: ink, color: hex(palette.rockDark), alpha: 0.7 });
    } else if (item.kind === 'bush') {
      const r = t * 0.16;
      for (const [dx, dy] of [
        [-0.13, 0.04],
        [0.13, 0.04],
        [0, -0.08],
      ] as const) {
        g.circle(cx + t * dx, cy + t * dy, r);
      }
      g.fill({ color: candy, alpha: 0.95 });
      g.circle(cx - t * 0.04, cy - t * 0.12, r * 0.45);
      g.fill({ color: 0xffffff, alpha: 0.55 });
    } else {
      g.ellipse(cx, cy + t * 0.04, t * 0.32, t * 0.22);
      g.fill({ color: hex(palette.sand) });
      g.stroke({ width: ink, color: mixed(hex(palette.sand), hex(palette.craterMid), 0.5) });
      for (let k = 0; k < 5; k++) {
        g.circle(
          cx + t * (hash(item.x, item.y, 170 + k) - 0.5) * 0.4,
          cy + t * (0.04 + (hash(item.x, item.y, 175 + k) - 0.5) * 0.24),
          t * 0.045,
        );
      }
      g.fill({ color: hex(palette.craterDark) });
    }
  }
}

/** A gummy bear sitting up, in a candy pastel, lit from the top left. */
function drawGummyBear(
  g: Graphics,
  cx: number,
  cy: number,
  t: number,
  candy: number,
  art: ArtConfig,
): void {
  const { palette } = art;
  // A little larger than a tile's sweets, or it read as a crumb beside the lollipops.
  const u = t * GUMMY_SCALE;
  g.ellipse(cx + t * 0.06, cy + t * 0.44, t * 0.24, t * 0.08);
  g.fill({ color: hex(palette.shadow), alpha: 0.25 });
  // Legs, body, arms, head and ears, as one soft shape.
  g.circle(cx - u * 0.11, cy + u * 0.27, u * 0.08);
  g.circle(cx + u * 0.11, cy + u * 0.27, u * 0.08);
  g.ellipse(cx, cy + u * 0.12, u * 0.15, u * 0.18);
  g.circle(cx - u * 0.16, cy + u * 0.06, u * 0.065);
  g.circle(cx + u * 0.16, cy + u * 0.06, u * 0.065);
  g.circle(cx - u * 0.11, cy - u * 0.25, u * 0.06);
  g.circle(cx + u * 0.11, cy - u * 0.25, u * 0.06);
  g.circle(cx, cy - u * 0.13, u * 0.14);
  g.fill({ color: candy, alpha: 0.92 });
  // A deeper shade on the belly, where the jelly is thickest, and the glint of its gloss.
  g.ellipse(cx + u * 0.02, cy + u * 0.16, u * 0.08, u * 0.1);
  g.fill({ color: mixed(candy, hex(palette.shadow), 0.18), alpha: 0.5 });
  g.circle(cx - u * 0.06, cy - u * 0.18, u * 0.035);
  g.circle(cx - u * 0.08, cy + u * 0.04, u * 0.03);
  g.fill({ color: 0xffffff, alpha: 0.8 });
}

/**
 * A gingerbread house: biscuit walls, a roof edged in piped icing with gumdrops on its
 * ridge, a door and two iced windows. Biscuit brown, never a player's colour, and nothing
 * like the cakes, which are the castles.
 */
function drawGingerbread(g: Graphics, cx: number, cy: number, t: number, art: ArtConfig): void {
  const { palette } = art;
  const biscuit = mixed(hex(palette.sand), hex(palette.craterMid), 0.35);
  const baked = mixed(hex(palette.sand), hex(palette.craterMid), 0.6);
  const icing = hex(palette.rockLight);
  const ink = Math.max(1, t * 0.05);
  g.ellipse(cx + t * 0.08, cy + t * 0.38, t * 0.36, t * 0.09);
  g.fill({ color: hex(palette.shadow), alpha: 0.25 });
  // The walls.
  const left = cx - t * 0.3;
  const top = cy - t * 0.02;
  g.rect(left, top, t * 0.6, t * 0.38);
  g.fill({ color: biscuit });
  g.stroke({ width: ink, color: baked });
  // The roof, two slopes over the eaves, with its icing scalloped along them.
  const eave = top + t * 0.02;
  const ridge = cy - t * 0.42;
  g.poly([cx - t * 0.4, eave, cx, ridge, cx + t * 0.4, eave]);
  g.fill({ color: baked });
  for (let k = 0; k <= 4; k++) {
    const f = k / 4;
    g.circle(cx - t * 0.4 * (1 - f), eave + (ridge - eave) * f, t * 0.05);
    g.circle(cx + t * 0.4 * (1 - f), eave + (ridge - eave) * f, t * 0.05);
  }
  g.fill({ color: icing });
  // Gumdrops on the ridge, in the candy pastels.
  for (const [k, dx] of [-0.08, 0.08].entries()) {
    g.circle(cx + t * dx, ridge + t * 0.12, t * 0.045);
    g.fill({ color: CANDY[k + 1]! });
  }
  // A door and two windows, framed in icing.
  g.roundRect(cx - t * 0.06, top + t * 0.16, t * 0.12, t * 0.22, t * 0.05);
  g.fill({ color: hex(palette.craterMid) });
  for (const dx of [-0.2, 0.12]) g.rect(cx + t * dx, top + t * 0.08, t * 0.08, t * 0.08);
  g.fill({ color: hex(palette.uiAccent), alpha: 0.85 });
  g.stroke({ width: ink, color: icing });
  g.moveTo(left, top + t * 0.38).lineTo(left + t * 0.6, top + t * 0.38);
  g.stroke({ width: ink, color: icing });
}
