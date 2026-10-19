import type { ArtConfig, SportsStyleConfig } from '@bollwerk/config';
import { isLoaded, Structure, type Cannon, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, FillPattern, Graphics, Texture, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';
import { climax, cornerSpot, pressing } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { SportsSeaLife } from './seaLife.js';
import { ShapeTheme } from './shapeTheme.js';
import {
  INK,
  SPORTS,
  ballIdle,
  ballPoint,
  drawBall,
  drawBench,
  drawFigure,
  heldWhenReady,
  inFlight,
  type Pose,
  type Sport,
} from './sports/figures.js';
import { drawStands, standsSize } from './sports/stands.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import { TerrainStrips, whole, type TerrainPass, type TerrainPlan } from './terrainStrips.js';
import {
  Fireworks,
  FlagHoist,
  GhostMotion,
  GunAims,
  Landings,
  MainCastles,
  RuinSmoke,
  WinnerBanners,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawCannonGhost,
  drawChoices,
  drawDrain,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
  drawSealPreview,
  drawSelectable,
  drawShotTarget,
  hex,
  shotLift,
  shotScale,
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

/** Chalk: the lines on the pitch, the guns' boxes, the dust a ball raises. */
export const CHALK = 0xf4f4ee;
const GOLD = 0xe8c25a;
const GOLD_LIGHT = 0xfff0b0;
const GOLD_DULL = 0xa08850;
const TARNISHED = 0x8a8a90;
const DEAD = 0x8a8a90;
const DEAD_DARK = 0x5a5a60;
const LED = 0xf2c230;
const LED_RED = 0xff5040;
const CONCRETE_EDGE = 0x55575c;

/** A figure's release, then its follow-through, after a shot (the user's poses, 2026-10-19). */
const RELEASE_MS = 110;
const FIRE_MS = 340;
/** How long a ball bounces off what it struck, and the crowd's arms are up for a catch. */
const BOUNCE_MS = 520;
const CATCH_MS = 900;
/** A shot's height, at most, at which its ball has grown to its largest. */
const HIGH_TILES = 3;

/** How the stadium sends off its winners: confetti, and a supporters' scarf held up. */
const FINISH: FinishLook = { spark: 'confetti', flag: 'scarf' };

/** Something with a place and an age. */
interface Aged {
  x: number;
  y: number;
  age: number;
}

/** A crater on the pitch: a divot, fading over the rounds. */
interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A thing thrown: a piece of padding in the owner's colour, or a puff of chalk dust. */
interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  owner: number;
  dust: boolean;
  r: number;
}

/** A ball bouncing off where its shot came down. */
interface Bounce extends Aged {
  sport: Sport;
  dir: number;
}

/** A wave going round the stands from a castle just sealed, in its owner's colour. */
interface Wave extends Aged {
  colour: number;
}

/** A figure to stamp, by where it stands: `foot` orders them, nearest last. */
interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/** Where a shot's ball leaves its gun from, against the sim's start, and whose sport it is. */
interface Launch {
  sport: Sport;
  dir: number;
  /** From the shot's start to the ball in the figure, and from it to the figure's feet. */
  ox: number;
  oy: number;
  ground: number;
  toX: number;
  toY: number;
}

/** How a trophy stands: shining while sealed, dull while open, tarnished once its player is out. */
type Trophy = 'shine' | 'dull' | 'tarnished';

/** The sport a gun plays, by its id and the match's seed: every client sees the same. */
export function sportOf(cannonId: number, seed: number): Sport {
  return SPORTS[Math.floor(hash(cannonId, seed, 9100) * SPORTS.length)] ?? 'soccer';
}

/** The sport of the cannon icon in a round: one for every gun placed in it. */
export function iconSport(round: number, seed: number): Sport {
  return SPORTS[Math.floor(hash(round, seed, 9101) * SPORTS.length)] ?? 'soccer';
}

/**
 * A repeating pattern drawn once on a canvas, laid into shapes as a fill in screen space,
 * as Noir's hatching is: the stands, seated or on their feet.
 */
function standsPattern(tile: number, standing: boolean): FillPattern {
  const { width, height } = standsSize(tile);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) drawStands(ctx, tile, standing);
  return new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
}

/**
 * The Sports look, for either look (ARCHIVE 14d): a stadium. The islands are pitches,
 * striped turf ringed by a running track; the sea is the stands, the crowd a pattern laid in
 * once, a wave going round it when a castle is sealed. Walls are padded barriers in the
 * owner's colour, castles trophies on plinths of it — shining while sealed. **The guns are
 * sportsmen** in the owner's jersey, of ten ball sports, a sport to a gun by its id: ready, the
 * moment before the strike, the ball apart from the figure; firing, the release and the
 * follow-through, the ball leaving from where it was; reloading, the same figure without its
 * ball until the shot lands; silenced, sat on the bench. A hit bounces the ball off in a
 * puff of chalk; a ball into the stands is caught. A scoreboard stands in the corner;
 * floodlights and camera flashes at the climax; confetti for the winners.
 */
export class SportsTheme extends ShapeTheme implements Theme {
  readonly id = 'sports' as const;

  private style!: SportsStyleConfig;
  private readonly seaLife = new SportsSeaLife();

  private stands: FillPattern | null = null;
  private standing: FillPattern | null = null;
  private patternTile = 0;

  /** The stands and the pitches, in strips of rows (`TerrainStrips`). */
  private readonly terrainStrips = new TerrainStrips();
  /** The crowd on its feet where a wave passes, over the stands. */
  private readonly waveGfx = new Graphics();
  private waveDrawn = false;
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  private readonly cornerMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawSportsScenery(g, view, items),
    () => CHALK,
  );
  /** Barriers and the guns' chalked boxes, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  /** The trophies, the figures and their balls in one: placed nearest last. */
  private readonly figureStamps = new Stamps();
  private figures: Figure[] = [];
  private readonly crowns = new MainCastles();
  private readonly effectGfx = new Graphics();
  private readonly shadowStamps = new Stamps();
  private readonly ballStamps = new Stamps();
  private readonly burstStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  /** The trophies' gleam, the floodlights and the camera flashes, added. */
  private readonly glow = new Discs();
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
  /** Rows of the stands, each a list of runs of open stands [from, to) in tiles. */
  private standRows = new Map<number, [number, number][]>();
  private craters: Crater[] = [];
  private thrown: Thrown[] = [];
  private bounces: Bounce[] = [];
  private catches: Aged[] = [];
  private waves: Wave[] = [];
  private readonly launches = new Map<number, Launch>();
  /** Whether each gun had a ball last frame, and since when it has one again. */
  private readonly caught = new Map<number, { loaded: boolean; since: number }>();
  private readonly sealed = new Map<number, boolean>();

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.sports;
    this.glow.container.blendMode = 'add';
    layers.terrain.addChild(
      this.terrainStrips.container,
      this.waveGfx,
      this.craterGfx,
      this.cornerMemos.container,
    );
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.figureStamps.container,
      this.crowns.gfx,
      this.effectGfx,
      this.shadowStamps.container,
      this.ballStamps.container,
      this.burstStamps.container,
      this.lateGfx,
      this.glow.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  /** The round's sport for the cannon icon: the icon is drawn again when it changes. */
  iconKey(): string {
    return iconSport(this.round, this.seed);
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.cornerMemos.destroy();
    for (const s of [this.figureStamps, this.shadowStamps, this.ballStamps, this.burstStamps]) {
      s.destroy();
    }
    this.glow.destroy();
    this.book.destroy();
    release(this.terrainStrips.container);
    for (const g of [
      this.waveGfx,
      this.craterGfx,
      this.underGfx,
      this.crowns.gfx,
      this.effectGfx,
      this.lateGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
    this.dropPatterns();
  }

  private dropPatterns(): void {
    for (const p of [this.stands, this.standing]) p?.texture.destroy(true);
    this.stands = null;
    this.standing = null;
  }

  /** The stands' two patterns for this tile size, drawn again only when it changes. */
  private patternsFor(tile: number): void {
    if (tile === this.patternTile && this.stands !== null) return;
    this.dropPatterns();
    this.patternTile = tile;
    this.stands = standsPattern(tile, false);
    this.standing = standsPattern(tile, true);
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The stands all round, a crowd in rows of seats; a concrete concourse where they meet the
   * pitches; each island a pitch, ringed at its coast by a red running track between chalk
   * lines, its turf mown in stripes.
   */
  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrainStrips.draw(state, view, () => this.planTerrain(state, view));
  }

  private planTerrain(state: MatchState, view: ViewTransform): TerrainPlan {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    this.patternsFor(view.tile);
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);
    const near = (x: number, y: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    /** The track: land with open sea beside it, corners too. */
    const track = (x: number, y: number): boolean => {
      if (!land(x, y)) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (!land(x + dx, y + dy)) return true;
      }
      return false;
    };
    const turf = (x: number, y: number): boolean => land(x, y) && !track(x, y);
    const concourse = (x: number, y: number): boolean => !land(x, y) && near(x, y);

    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    // The open stands of each row, where a wave may stand them up: not the concourse.
    this.standRows = new Map();
    for (let y = y0; y < y1; y++) {
      const runs: [number, number][] = [];
      let from: number | null = null;
      for (let x = x0; x <= x1; x++) {
        const open = x < x1 && !land(x, y) && !near(x, y);
        if (open && from === null) from = x;
        if (!open && from !== null) {
          runs.push([from, x]);
          from = null;
        }
      }
      this.standRows.set(y, runs);
    }
    const sea = (g: Graphics): void => {
      g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    };
    const cells = (from: number, to: number, keep: (x: number, y: number) => boolean): Cell[] => {
      const out: Cell[] = [];
      for (let y = Math.max(-1, from); y < Math.min(state.height + 1, to); y++) {
        for (let x = -1; x <= state.width; x++) if (keep(x, y)) out.push({ x, y });
      }
      return out;
    };
    const fill = (g: Graphics, list: readonly Cell[]): void => {
      for (const { x, y } of list) g.rect(tileX(view, x), tileY(view, y), t, t);
    };
    const stands = this.stands;
    const passes: TerrainPass[] = [
      whole((g) => {
        sea(g);
        g.fill({ color: hex(palette.waterDeep) });
      }),
    ];
    if (stands !== null) {
      passes.push(
        whole((g) => {
          sea(g);
          g.fill({ fill: stands });
        }),
      );
    }
    passes.push(
      // The concourse, edged dark where the stands begin.
      (g, from, to) => {
        fill(g, cells(from, to, concourse));
        g.fill({ color: hex(palette.waterShallow) });
      },
      (g, from, to) => {
        trace(
          g,
          outline(cells(from, to, concourse), (x, y) => concourse(x, y) || land(x, y), view),
        );
        g.stroke({ width: Math.max(1, t * 0.08), color: CONCRETE_EDGE });
      },
      // The track, then the turf, mown in stripes two rows wide.
      (g, from, to) => {
        fill(g, cells(from, to, track));
        g.fill({ color: hex(palette.sand) });
      },
      (g, from, to) => {
        fill(g, cells(from, to, turf));
        g.fill({ color: hex(palette.grassMid) });
      },
      (g, from, to) => {
        fill(
          g,
          cells(from, to, (x, y) => turf(x, y) && Math.floor(y / 2) % 2 === 0),
        );
        g.fill({ color: hex(palette.grassLight) });
      },
      // The chalk either side of the track. Lanes along its middle as well drew a grid, the
      // track a tile wide and stepped at every corner of the coast.
      (g, from, to) => {
        trace(g, outline(cells(from, to, turf), turf, view));
        g.stroke({ width: Math.max(1, t * 0.08), color: CHALK, alpha: 0.9 });
      },
      (g, from, to) => {
        trace(g, outline(cells(from, to, land), land, view));
        g.stroke({ width: Math.max(1, t * 0.06), color: CHALK, alpha: 0.75 });
      },
    );

    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.cratersDrawn = '';
    return { rows: [y0, y1], passes };
  }

  /** Divots where balls came down, soil torn up through the turf; drawn when one comes or fades. */
  private drawCraters(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => state.round - c.round < rounds);
    const key = `${state.round}|${this.craters.length}|${viewKey(view)}`;
    if (key === this.cratersDrawn) return;
    this.cratersDrawn = key;
    const g = this.craterGfx;
    clearDrawn(g);
    const t = view.tile;
    const { palette } = this.art;
    for (const c of this.craters) {
      const fade = 1 - (state.round - c.round) / rounds;
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.5);
      g.ellipse(x, y, t * 0.36, t * 0.24);
      g.fill({ color: hex(palette.craterMid), alpha: 0.9 * fade });
      g.ellipse(x + t * 0.04, y + t * 0.03, t * 0.22, t * 0.13);
      g.fill({ color: hex(palette.craterDark), alpha: 0.9 * fade });
      // Tufts of turf thrown up round it.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + hash(c.x, c.y, 9110 + k);
        const r = t * (0.42 + 0.12 * hash(c.x, c.y, 9120 + k));
        g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, t * 0.09, t * 0.05);
      }
      g.fill({ color: hex(palette.grassDark), alpha: fade });
    }
  }

  // ------------------------------------------------------------------ the scoreboard

  /**
   * The scoreboard in the corner: a dark board on two legs, the phase's seconds in amber
   * figures and the round under them; in the last seconds, and overtime, the figures red and
   * flashing.
   */
  private drawCorner(state: MatchState, view: ViewTransform): void {
    this.cornerMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const left = Math.max(
        0,
        Math.ceil((state.phaseEndTick - state.tick) / state.ruleset.tickRateHz),
      );
      const counting = state.phase !== 'intermission' && state.phase !== 'game_over';
      const hurry = pressing(state);
      const blink = hurry && !motionReduced() && Math.floor(this.clock / 250) % 2 === 1;
      const key = `${viewKey(view)}|${counting ? left : -1}|${state.round}|${hurry}|${blink}`;
      this.cornerMemos.draw('scoreboard', key, (g) =>
        drawScoreboard(
          g,
          view,
          spot,
          counting ? Math.min(99, left) : null,
          state.round,
          hurry,
          blink,
        ),
      );
    }
    this.cornerMemos.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as fresh-mown turf in the owner's colour, chalked round. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawTurf(g, island, view));
  }

  private drawTurf(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      // Fresh turf, lit, under a wash of the owner's colour: a wash alone over the green
      // turned red olive, as the guns' boxes did.
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: 0xffffff, alpha: 0.45 });
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: this.colour(player, 'light'), alpha: this.style.floorAlpha });
      // Mown across the stripes of the pitch: lighter every other pair of columns.
      for (const { x, y } of cells) {
        if (Math.floor(x / 2) % 2 === 0) g.rect(tileX(view, x), tileY(view, y), t, t);
      }
      g.fill({ color: 0xffffff, alpha: 0.08 });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: this.colour(player, 'light'), alpha: 0.85 });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.05), color: CHALK });
    }
    dimEliminated(g, state, view, INK);
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
      this.drawBarriers(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    // The guns' boxes, chalked: the outline alone (the user's, 2026-10-19).
    for (const cannon of state.cannons) cannonBase(g, view, cannon, null, CHALK);
  }

  /**
   * Walls as padded pitch-side barriers: the top in the owner's colour, the face in their
   * dark shade with one white stripe along it, a soft shadow below, inked round. Plain on
   * purpose, so a wall reads at a glance. A player's who is out, and rubble, grey.
   */
  private drawBarriers(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const b of wall.blocks) {
      if (joins(b.x, b.y + 1)) continue;
      g.rect(b.left + t * 0.06, b.top + t + (b.faced ? wall.face : 0) - t * 0.04, t, t * 0.18);
    }
    g.fill({ color: 0x000000, alpha: 0.22 });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'base') });
    // A soft highlight along each top's upper edge: padding, not stone.
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, Math.max(1, r.h * 0.22));
    g.fill({ color: 0xffffff, alpha: 0.18 });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD_DARK : this.colour(player, 'dark') });
    trace(g, wall.strips);
    g.stroke({ width: Math.max(1, t * 0.07), color: 0xffffff, alpha: dead ? 0.4 : 0.85 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.07), color: INK, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    if (!this.land(x, y) && debris.length === 0) {
      this.catches.push({ x, y, age: 0 });
      return;
    }
    this.dust(x + 0.5, y + 0.4, 3);
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      for (let k = 0; k < 5; k++) this.throwPad(block.x + 0.5, block.y + 0.4, block.owner - 1);
    }
  }

  private dust(x: number, y: number, count: number): void {
    for (let k = 0; k < count; k++) {
      this.thrown.push({
        x: x + (Math.random() - 0.5) * 0.4,
        y,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -0.4 - Math.random() * 0.4,
        age: 0,
        life: 700 + Math.random() * 300,
        angle: 0,
        spin: 0,
        owner: -1,
        dust: true,
        r: 0.22 + Math.random() * 0.14,
      });
    }
  }

  private throwPad(x: number, y: number, owner: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const v = 2.5 + Math.random() * 3;
    this.thrown.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 650 + Math.random() * 350,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      owner,
      dust: false,
      r: 0,
    });
  }

  /** The sweep: a lone stretch of barrier knocked over in a puff of chalk. */
  noteCrumble(block: Debris): void {
    this.dust(block.x + 0.5, block.y + 0.5, 1);
    for (let k = 0; k < 2; k++) this.throwPad(block.x + 0.5, block.y + 0.5, block.owner - 1);
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    clearDrawn(under);
    clearDrawn(this.effectGfx);
    clearDrawn(this.lateGfx);
    this.glow.begin(view.tile);
    perf.begin('flow');
    this.drawCraters(state, view);
    this.drawCorner(state, view);
    this.noteSeals(state, frame);
    this.drawWaves(view, frame.deltaMs);
    perf.end('flow');
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x8a8c92, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.figures = [];
    this.drawTrophies(state, view, frame);
    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawGuns(state, view, frame.deltaMs);
    this.figures.sort((a, b) => a.foot - b.foot);
    this.figureStamps.begin();
    for (const f of this.figures) this.figureStamps.place(f.context, f.x, f.y, f.options);
    this.figureStamps.end();
    this.shadowStamps.begin();
    this.ballStamps.begin();
    this.drawShots(state, view, frame);
    this.burstStamps.begin();
    this.drawBounces(view, frame.deltaMs);
    this.drawThrown(view, frame.deltaMs);
    this.drawCatches(view, frame.deltaMs);
    this.burstStamps.end();
    this.ballStamps.end();
    this.shadowStamps.end();
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawClimax(state, view);
    this.glow.end();
  }

  /** A castle just sealed sets a wave going round the stands near it, in its owner's colour. */
  private noteSeals(state: MatchState, frame: EffectFrame): void {
    for (const castle of state.castles) {
      const now = frame.castleSealed[castle.id] === true;
      const was = this.sealed.get(castle.id);
      this.sealed.set(castle.id, now);
      if (was !== false || !now || motionReduced()) continue;
      if (this.waves.length >= this.style.wavesAtOnce) continue;
      this.waves.push({
        x: castle.x + castle.w / 2,
        y: castle.y + castle.h / 2,
        age: 0,
        colour: this.colour(castle.islandId - 1, 'light'),
      });
    }
  }

  /**
   * The waves: the crowd on its feet in a band three tiles wide, running out both ways from
   * the castle along the rows of open stands near it, tinted in the sealer's colour, fading.
   * A handful of rectangles a row, and nothing at all while no wave is going.
   */
  private drawWaves(view: ViewTransform, deltaMs: number): void {
    const g = this.waveGfx;
    const life = this.style.waveMs;
    this.waves = this.waves.filter((w) => (w.age += deltaMs) < life);
    if (this.waves.length === 0) {
      if (this.waveDrawn) clearDrawn(g);
      this.waveDrawn = false;
      return;
    }
    clearDrawn(g);
    this.waveDrawn = true;
    const t = view.tile;
    const standing = this.standing;
    for (const w of this.waves) {
      const k = w.age / life;
      const reach = (w.age / 1000) * this.style.waveTilesPerSecond;
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const rows = this.style.waveRows;
      const bands = [w.x - reach, w.x + reach];
      const rects: [number, number, number, number][] = [];
      for (let y = Math.floor(w.y) - rows; y <= Math.floor(w.y) + rows; y++) {
        const runs = this.standRows.get(y);
        if (runs === undefined) continue;
        for (const c of bands) {
          const a = c - 1.5;
          const b = c + 1.5;
          for (const [from, to] of runs) {
            const xa = Math.max(a, from);
            const xb = Math.min(b, to);
            if (xb > xa) rects.push([tileX(view, xa), tileY(view, y), (xb - xa) * t, t]);
          }
        }
      }
      if (rects.length === 0) continue;
      if (standing !== null) {
        for (const r of rects) g.rect(...r);
        g.fill({ fill: standing, alpha: fade });
      }
      for (const r of rects) g.rect(...r);
      g.fill({ color: w.colour, alpha: 0.16 * fade });
    }
  }

  /**
   * The trophies, a cup on a plinth in the owner's colour — shining while sealed, as a flag is
   * raised, a glint running over it; dull while open; tarnished and tipped once the player is
   * out.
   */
  private drawTrophies(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.lit.update(frame.castleSealed, this.clock, this.art);
    const glint = this.book.get('glint', t, (k) => drawGlint(k, t));
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      const trophy: Trophy = out ? 'tarnished' : level > 0.5 ? 'shine' : 'dull';
      const figure = this.book.get(`trophy|${out ? -1 : player}|${trophy}`, t, (k) =>
        drawTrophy(k, t, out ? DEAD : this.colour(player, 'base'), trophy),
      );
      const x = tileX(view, castle.x + castle.w / 2);
      const y = tileY(view, castle.y + castle.h) - t * 0.06;
      this.figures.push({
        foot: y,
        context: figure,
        x,
        y,
        options: trophy === 'tarnished' ? { rotation: 0.14 } : {},
      });
      if (trophy !== 'shine') continue;
      this.glow.disc(x, y - t * 1.3, t * 0.9, GOLD, 0.18 * level);
      if (still) continue;
      // A glint crossing the cup now and then, each trophy on its own beat.
      const q = ((this.clock + castle.id * 977) % 3200) / 3200;
      if (q < 0.25) {
        const s = Math.sin((q / 0.25) * Math.PI);
        this.figures.push({
          foot: y + 0.001,
          context: glint,
          x: x - t * 0.3 + (q / 0.25) * t * 0.5,
          y: y - t * 1.45,
          options: { scale: 0.4 + 0.8 * s, alpha: s, rotation: q * 3 },
        });
      }
    }
  }

  /**
   * The cannon icon: the round's sport, its figure ready with its ball, facing right, in the
   * player's jersey; one sport for every gun of the round.
   */
  drawCannonIcon(root: Container, size: number, player: number): void {
    const sport = iconSport(this.round, this.seed);
    const t = size / 2.3;
    const fig = new Graphics();
    drawFigure(fig, t, sport, 'ready');
    fig.tint = this.colour(player, 'base');
    const ball = new Graphics();
    drawBall(ball, t, sport);
    const at = ballPoint(sport, 'ready');
    ball.position.set(at.x * t, at.y * t);
    ball.rotation = at.turn;
    const box = new Container();
    box.addChild(fig, ball);
    const b = box.getLocalBounds();
    box.position.set(size / 2 - (b.x + b.width / 2), size / 2 - (b.y + b.height / 2));
    // On a disc of turf, chalked round: the figure is ink, and vanished over the dark stands.
    const turf = new Graphics();
    turf.circle(size / 2, size / 2, size * 0.48);
    turf.fill({ color: hex(this.art.palette.grassMid) });
    turf.stroke({ width: Math.max(1, size * 0.04), color: CHALK });
    root.addChild(turf, box);
  }

  /**
   * The guns: a sportsman each, in the owner's jersey, facing the target. Ready, the moment
   * before the strike, breathing, its ball doing its sport's small motion; firing, the release,
   * then the follow-through; reloading, the same figure without its ball, which comes back into
   * it as the shot lands; silenced, sat on the bench, its ball beside it.
   */
  private drawGuns(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const bench = this.book.get('bench', t, (k) => drawBench(k, t));
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const sport = sportOf(cannon.id, this.seed);
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const out = state.players[cannon.owner]?.eliminated !== false;
      const pose: Pose = !cannon.active
        ? 'bench'
        : aim.firedAgo < RELEASE_MS
          ? 'release'
          : aim.firedAgo < FIRE_MS
            ? 'follow'
            : 'ready';
      const figure = this.book.get(`fig|${sport}|${pose}`, t, (k) => drawFigure(k, t, sport, pose));
      const x = tileX(view, cannon.x + cannon.w / 2);
      const foot = this.feet(view, cannon);
      const bob =
        still || pose !== 'ready'
          ? 0
          : Math.sin(((this.clock + cannon.id * 370) / this.style.breatheMs) * Math.PI * 2);
      const tint = out ? DEAD : this.colour(cannon.owner, 'base');
      if (pose === 'bench') {
        this.figures.push({
          foot: foot - 0.002,
          context: bench,
          x,
          y: foot,
          options: { scale: dir, scaleY: 1 },
        });
      }
      this.figures.push({
        foot,
        context: figure,
        x,
        y: foot - bob * t * 0.02,
        options: { scale: dir, scaleY: 1 + bob * 0.015, tint },
      });
      // The ball, while the gun has one: back in hand as its shot lands, growing in.
      const loaded = isLoaded(cannon);
      const seen = this.caught.get(cannon.id);
      if (seen === undefined) this.caught.set(cannon.id, { loaded, since: -1e9 });
      else if (loaded !== seen.loaded) {
        seen.loaded = loaded;
        if (loaded) seen.since = this.clock;
      }
      if (!loaded) continue;
      const since = this.clock - (this.caught.get(cannon.id)?.since ?? -1e9);
      const grow = still ? 1 : Math.min(1, since / this.style.catchMs);
      const held = pose === 'bench' ? 'bench' : 'ready';
      const at = ballPoint(sport, held);
      const idle =
        held === 'ready' && !still
          ? ballIdle(sport, ((this.clock + cannon.id * 290) / this.style.ballBeatMs) % 1)
          : { dx: 0, dy: 0, turn: 0 };
      const inHand = held === 'ready' && heldWhenReady(sport);
      const by = inHand
        ? (at.y + idle.dy) * (1 + bob * 0.015) * t - bob * t * 0.02
        : (at.y + idle.dy) * t;
      const ball = this.book.get(`ball|${sport}`, t, (k) => drawBall(k, t, sport));
      this.figures.push({
        foot: foot + 0.001,
        context: ball,
        x: x + dir * (at.x + idle.dx) * t,
        y: foot + by,
        options: { scale: dir * grow, scaleY: grow, rotation: dir * (at.turn + idle.turn) },
      });
    }
    this.aims.prune(state);
    if (this.caught.size > state.cannons.length) {
      const live = new Set(state.cannons.map((c) => c.id));
      for (const id of this.caught.keys()) if (!live.has(id)) this.caught.delete(id);
    }
  }

  /** Where a gun's figure stands, its feet, in screen pixels: a little up from its box's foot. */
  private feet(view: ViewTransform, cannon: Cannon): number {
    return tileY(view, cannon.y + cannon.h) - view.tile * 0.3;
  }

  /**
   * Shots: each gun's own ball, leaving from where it was in the figure — the sim's path plus
   * the offset to it, shrinking to nothing by the landing — spinning, or the shuttlecock and the
   * football turned along their flight; a shadow on the ground under. As a shot lands its ball
   * bounces off.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    const shadow = this.shadow(t);
    const flying = new Set<number>();
    for (const shot of state.shots) {
      flying.add(shot.id);
      const launch = this.launchOf(state, shot);
      const p = shotProgress(shot, now);
      const where = (q: number): [number, number, number] => {
        const gx = shot.fromX + (shot.toX - shot.fromX) * q + 0.5;
        const gy = shot.fromY + (shot.toY - shot.fromY) * q + 0.5;
        const lift = shotLift(shot, q);
        return [
          gx + launch.ox * (1 - q),
          gy + launch.oy * (1 - q) - lift,
          gy + launch.ground * (1 - q),
        ];
      };
      const [bx, by, ground] = where(p);
      const [nx, ny] = where(Math.min(1, p + 0.01));
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / HIGH_TILES);
      const sx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5 + launch.ox * (1 - p));
      this.shadowStamps.place(shadow, sx, tileY(view, ground), {
        scale: 1 - 0.3 * high,
        alpha: 0.32 - 0.12 * high,
      });
      const turn = inFlight(launch.sport, nx - bx, ny - by, still ? 0 : p);
      const grow = (1 + 0.25 * high) * shotScale(shot, this.art);
      const ball = this.book.get(`ball|${launch.sport}`, t, (k) => drawBall(k, t, launch.sport));
      this.ballStamps.place(ball, tileX(view, bx), tileY(view, by), {
        rotation: still && turn.scaleY === 1 ? 0 : turn.rotation,
        scale: turn.scaleX * grow,
        scaleY: turn.scaleY * grow,
      });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
    // The shots gone since the last frame have landed: their balls bounce off.
    for (const [id, launch] of this.launches) {
      if (flying.has(id)) continue;
      this.launches.delete(id);
      if (!still) {
        this.bounces.push({
          x: launch.toX + 0.5,
          y: launch.toY + 0.5,
          age: 0,
          sport: launch.sport,
          dir: launch.dir,
        });
      }
    }
  }

  /** A ball's shadow on the ground, black for its stamp's alpha. */
  private shadow(t: number): GraphicsContext {
    return this.book.get('shadow', t, (k) => {
      k.ellipse(0, 0, t * 0.2, t * 0.07);
      k.fill({ color: 0x000000 });
    });
  }

  /** Where a shot's ball leaves from, worked out once from its gun as it first flies. */
  private launchOf(state: MatchState, shot: Shot): Launch {
    const known = this.launches.get(shot.id);
    if (known !== undefined) return known;
    const sport = sportOf(shot.cannonId, this.seed);
    const cannon = state.cannons.find((c) => c.id === shot.cannonId);
    const aim = this.aims.of(state, shot.cannonId);
    const dir =
      aim === null ? (shot.toX >= shot.fromX ? 1 : -1) : Math.sin(aim.angle) >= 0 ? 1 : -1;
    let ox = 0;
    let oy = 0;
    let ground = 0;
    if (cannon !== undefined) {
      const at = ballPoint(sport, 'release');
      const feetY = cannon.y + cannon.h - 0.3;
      ox = cannon.x + cannon.w / 2 + dir * at.x - (shot.fromX + 0.5);
      oy = feetY + at.y - (shot.fromY + 0.5);
      ground = feetY - (shot.fromY + 0.5);
    }
    const launch = { sport, dir, ox, oy, ground, toX: shot.toX, toY: shot.toY };
    this.launches.set(shot.id, launch);
    return launch;
  }

  /** A ball bouncing up off where it struck, and falling away, its shadow under it. */
  private drawBounces(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    for (const b of this.bounces) {
      b.age += deltaMs;
      const k = b.age / BOUNCE_MS;
      if (k >= 1) continue;
      const x = b.x + b.dir * k * 0.9;
      const up = Math.sin(k * Math.PI) * 0.9;
      const ball = this.book.get(`ball|${b.sport}`, t, (g) => drawBall(g, t, b.sport));
      const shadow = this.shadow(t);
      this.shadowStamps.place(shadow, tileX(view, x), tileY(view, b.y), { alpha: 0.25 * (1 - k) });
      this.burstStamps.place(ball, tileX(view, x), tileY(view, b.y - up), {
        rotation: b.dir * k * 6,
        scale: b.dir,
        scaleY: 1,
        alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
      });
    }
    this.bounces = this.bounces.filter((b) => b.age < BOUNCE_MS);
  }

  /** Pieces of padding flying in the owner's colour; chalk dust puffing up and thinning. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const pad = this.book.get('pad', t, (k) => {
      k.roundRect(-t * 0.13, -t * 0.07, t * 0.26, t * 0.14, t * 0.05);
      k.fill({ color: 0xffffff });
      k.stroke({ width: Math.max(1, t * 0.035), color: INK });
    });
    const puff = this.book.get('dust', t, (k) => {
      k.circle(0, 0, t * 0.5);
      k.fill({ color: CHALK, alpha: 0.85 });
    });
    const dt = deltaMs / 1000;
    for (const s of this.thrown) {
      s.age += deltaMs;
      if (s.dust) {
        s.vx *= Math.exp(-1.2 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      } else {
        s.vy += 7 * dt;
        s.vx *= Math.exp(-1.5 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.angle += s.spin * dt;
      }
      const k = s.age / s.life;
      if (k >= 1) continue;
      if (s.dust) {
        this.burstStamps.place(puff, tileX(view, s.x), tileY(view, s.y), {
          scale: (s.r / 0.5) * (0.6 + 1.1 * k),
          alpha: 0.7 * (1 - k),
        });
      } else {
        this.burstStamps.place(pad, tileX(view, s.x), tileY(view, s.y), {
          rotation: s.angle,
          alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
          tint: s.owner < 0 ? DEAD : this.colour(s.owner, 'base'),
        });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /** A ball into the stands is caught: arms shoot up round where it came down, then sink. */
  private drawCatches(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const c of this.catches) {
      c.age += deltaMs;
      const k = c.age / CATCH_MS;
      if (k >= 1) continue;
      const up = k < 0.2 ? k / 0.2 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const cx = tileX(view, c.x + 0.5);
      const cy = tileY(view, c.y + 0.6);
      for (let n = 0; n < 6; n++) {
        const ax = cx + (n - 2.5) * t * 0.22;
        const ay = cy + (n % 2) * t * 0.12;
        g.moveTo(ax, ay).lineTo(ax + (n - 2.5) * t * 0.03, ay - t * 0.4 * up);
      }
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0xf0c8a0, cap: 'round', alpha: up });
    }
    this.catches = this.catches.filter((c) => c.age < CATCH_MS);
  }

  /**
   * The climax — overtime and the final round: the floodlights on, a glow from each corner of
   * the stadium, and camera flashes popping in the stands. None of the flashes with motion
   * reduced.
   */
  private drawClimax(state: MatchState, view: ViewTransform): void {
    if (!climax(state)) return;
    const { floodlightAlpha, flashesPerSecond } = this.style;
    const r = Math.max(view.width, view.height) * 0.35;
    for (const [fx, fy] of [
      [0, view.top],
      [view.width, view.top],
      [0, view.height],
      [view.width, view.height],
    ] as const) {
      this.glow.disc(fx, fy, r, 0xfff6dc, floodlightAlpha);
    }
    if (motionReduced()) return;
    // Each flash a short pop at a spot drawn from its slot of time, so none needs keeping.
    const slot = 1000 / Math.max(1, flashesPerSecond);
    const n = Math.floor(this.clock / slot);
    for (let k = n - 2; k <= n; k++) {
      const age = this.clock - k * slot;
      if (age > 140) continue;
      const fx = hash(k, this.seed, 9130) * view.width;
      const fy = view.top + hash(k, this.seed, 9131) * (view.height - view.top);
      const tx = Math.floor((fx - view.originX) / view.tile);
      const ty = Math.floor((fy - view.originY) / view.tile);
      if (this.land(tx, ty)) continue;
      this.glow.disc(fx, fy, view.tile * 0.35, 0xffffff, 0.7 * (1 - age / 140));
    }
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
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
      // The piece in hand in the owner's colour, chalked out in dashes; where it does not fit,
      // grey, its chalk shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.55 : 0.45,
      });
      const edge = outline(cells, inPiece, view);
      const shake = ghost.valid ? 0 : Math.sin(now / 30) * t * 0.05;
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.12), color: INK, alpha: 0.6 });
      for (const s of edge) {
        // Dashes along each edge: two to a tile.
        for (const [a, b] of [
          [0.1, 0.4],
          [0.6, 0.9],
        ] as const) {
          g.moveTo(s.x1 + (s.x2 - s.x1) * a + shake, s.y1 + (s.y2 - s.y1) * a - shake);
          g.lineTo(s.x1 + (s.x2 - s.x1) * b + shake, s.y1 + (s.y2 - s.y1) * b - shake);
        }
      }
      g.stroke({ width: Math.max(1.5, t * 0.08), color: CHALK, alpha: ghost.valid ? 1 : 0.8 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      drawCannonGhost(g, view, ghost, colour, Math.max(1.5, t * 0.1));
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/** A glint on gold: a four-pointed star, white. */
function drawGlint(g: Graphics, t: number): void {
  const r = t * 0.22;
  const w = r * 0.22;
  g.poly([0, -r, w, -w, r, 0, w, w, 0, r, -w, w, -r, 0, -w, -w]);
  g.fill({ color: 0xffffff });
}

/**
 * A trophy, its foot's middle at the origin, `t` a tile: a plinth in the owner's colour with
 * a gold plate, a stem and knop, and a cup with two handles. Shining, the gold bright with a
 * light streak down it; dull, a browner gold; tarnished, grey.
 */
function drawTrophy(g: Graphics, t: number, colour: number, state: Trophy): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.06));
  const gold = state === 'shine' ? GOLD : state === 'dull' ? GOLD_DULL : TARNISHED;
  const light = state === 'shine' ? GOLD_LIGHT : state === 'dull' ? 0xc8b078 : 0xb8b8bc;
  // Its shadow, the plinth, and the plate on it.
  g.ellipse(0, -u(0.02), u(0.7), u(0.12));
  g.fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(-u(0.55), -u(0.46), u(1.1), u(0.46), u(0.05));
  g.fill({ color: colour });
  g.rect(-u(0.55), -u(0.16), u(1.1), u(0.16));
  g.fill({ color: 0x000000, alpha: 0.25 });
  g.rect(-u(0.28), -u(0.38), u(0.56), u(0.14));
  g.fill({ color: gold });
  g.roundRect(-u(0.55), -u(0.46), u(1.1), u(0.46), u(0.05));
  g.stroke({ width: ink, color: INK });
  // The stem and its knop.
  g.poly([-u(0.24), -u(0.46), u(0.24), -u(0.46), u(0.08), -u(0.66), -u(0.08), -u(0.66)]);
  g.fill({ color: gold });
  g.stroke({ width: ink, color: INK, join: 'round' });
  g.rect(-u(0.06), -u(0.86), u(0.12), u(0.22));
  g.fill({ color: gold });
  g.stroke({ width: ink, color: INK });
  g.ellipse(0, -u(0.76), u(0.13), u(0.06));
  g.fill({ color: gold });
  g.stroke({ width: ink, color: INK });
  // The handles, behind the cup's rim.
  for (const side of [-1, 1]) {
    g.moveTo(side * u(0.42), -u(1.62)).bezierCurveTo(
      side * u(0.82),
      -u(1.66),
      side * u(0.78),
      -u(1.18),
      side * u(0.3),
      -u(1.12),
    );
    g.stroke({ width: Math.max(2, u(0.16)), color: INK, cap: 'round' });
    g.moveTo(side * u(0.42), -u(1.62)).bezierCurveTo(
      side * u(0.82),
      -u(1.66),
      side * u(0.78),
      -u(1.18),
      side * u(0.3),
      -u(1.12),
    );
    g.stroke({ width: Math.max(1, u(0.08)), color: gold, cap: 'round' });
  }
  // The cup.
  g.moveTo(-u(0.52), -u(1.76))
    .lineTo(u(0.52), -u(1.76))
    .bezierCurveTo(u(0.5), -u(1.2), u(0.3), -u(0.9), 0, -u(0.86))
    .bezierCurveTo(-u(0.3), -u(0.9), -u(0.5), -u(1.2), -u(0.52), -u(1.76));
  g.fill({ color: gold });
  g.stroke({ width: ink, color: INK, join: 'round' });
  g.moveTo(-u(0.34), -u(1.66)).bezierCurveTo(
    -u(0.34),
    -u(1.3),
    -u(0.24),
    -u(1.08),
    -u(0.12),
    -u(1.0),
  );
  g.stroke({ width: Math.max(1, u(0.08)), color: light, cap: 'round', alpha: 0.9 });
  g.ellipse(0, -u(1.76), u(0.52), u(0.08));
  g.fill({ color: state === 'tarnished' ? 0x6a6a70 : 0x8a6a2a });
  g.stroke({ width: ink, color: INK });
}

/** Seven-segment figures: which of a, b, c, d, e, f, g each digit lights. */
const SEGMENTS = [
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
] as const;

/** A digit in seven segments, its top left at (x, y), `w` wide and twice that high. */
function drawDigit(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  digit: number,
  colour: number,
): void {
  const lit = SEGMENTS[digit] ?? '';
  const s = Math.max(1, w * 0.2);
  const h = w;
  const bars: Record<string, [number, number, number, number]> = {
    a: [x + s, y, w - 2 * s, s],
    b: [x + w - s, y + s, s, h - s],
    c: [x + w - s, y + h, s, h - s],
    d: [x + s, y + 2 * h - s, w - 2 * s, s],
    e: [x, y + h, s, h - s],
    f: [x, y + s, s, h - s],
    g: [x + s, y + h - s / 2, w - 2 * s, s],
  };
  for (const [name, bar] of Object.entries(bars)) {
    g.rect(...bar);
    g.fill({ color: colour, alpha: lit.includes(name) ? 1 : 0.1 });
  }
}

/**
 * The scoreboard, its square's middle at the corner's spot: a dark board framed in grey on two
 * legs; the phase's seconds in big amber figures (none between phases), red and flashing when
 * the clock presses; the round under them in small white ones beside a dot.
 */
function drawScoreboard(
  g: Graphics,
  view: ViewTransform,
  spot: TimerSpot,
  seconds: number | null,
  round: number,
  hurry: boolean,
  blink: boolean,
): void {
  const t = view.tile;
  const s = spot.size * t;
  const cx = tileX(view, spot.x);
  const cy = tileY(view, spot.y);
  const ink = Math.max(1, s * 0.015);
  const w = s * 0.86;
  const h = s * 0.56;
  const top = cy - s * 0.4;
  // The legs, then the board.
  for (const lx of [-0.3, 0.3]) {
    g.rect(cx + lx * s - s * 0.03, top + h, s * 0.06, s * 0.34);
    g.fill({ color: 0x6a6c72 });
  }
  g.ellipse(cx, top + h + s * 0.34, s * 0.42, s * 0.05);
  g.fill({ color: 0x000000, alpha: 0.3 });
  g.roundRect(cx - w / 2 - s * 0.03, top - s * 0.03, w + s * 0.06, h + s * 0.06, s * 0.03);
  g.fill({ color: 0x8a8c92 });
  g.stroke({ width: ink, color: INK });
  g.rect(cx - w / 2, top, w, h);
  g.fill({ color: 0x101216 });
  const colour = hurry ? LED_RED : LED;
  const dw = w * 0.16;
  const dy = top + h * 0.1;
  if (seconds !== null && !blink) {
    drawDigit(g, cx - dw * 1.15, dy, dw, Math.floor(seconds / 10), colour);
    drawDigit(g, cx + dw * 0.15, dy, dw, seconds % 10, colour);
  } else {
    for (const ox of [-dw * 1.15, dw * 0.15]) drawDigit(g, cx + ox, dy, dw, 8, 0x000000);
  }
  // The round, small, under a rule.
  const rw = w * 0.09;
  const ry = top + h * 0.72;
  g.rect(cx - w * 0.4, ry - h * 0.06, w * 0.8, Math.max(1, h * 0.015));
  g.fill({ color: 0x3a3c42 });
  g.circle(cx - rw * 2, ry + rw, rw * 0.35);
  g.fill({ color: 0xf4f4ee });
  const r = Math.min(99, round);
  drawDigit(g, cx - rw * 0.9, ry, rw, Math.floor(r / 10), 0xf4f4ee);
  drawDigit(g, cx + rw * 0.4, ry, rw, r % 10, 0xf4f4ee);
}

/**
 * The stadium's scenery, in neutral colours so none of it is a player's: a tree is a corner
 * flag; a pine a water cooler on its stand; a bush a pair of training cones; a rock a bag of
 * balls, or one in three a stack of hurdles.
 */
function drawSportsScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.05);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.ellipse(cx, cy + t * 0.38, t * 0.16, t * 0.05);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.moveTo(cx, cy + t * 0.38).lineTo(cx, cy - t * 0.45);
      g.stroke({ width: Math.max(1.5, t * 0.06), color: CHALK });
      g.poly([cx, cy - t * 0.45, cx + t * 0.34, cy - t * 0.33, cx, cy - t * 0.2]);
      g.fill({ color: item.variant % 2 === 0 ? LED : 0xe86a2a });
      g.stroke({ width: ink, color: INK, join: 'round' });
    } else if (item.kind === 'pine') {
      // A water cooler: a blue-grey drum on a little stand, a white lid, a tap.
      g.rect(cx - t * 0.2, cy + t * 0.05, t * 0.04, t * 0.32);
      g.rect(cx + t * 0.16, cy + t * 0.05, t * 0.04, t * 0.32);
      g.fill({ color: 0x55575c });
      g.roundRect(cx - t * 0.22, cy - t * 0.38, t * 0.44, t * 0.46, t * 0.06);
      g.fill({ color: 0x5a7a9a });
      g.stroke({ width: ink, color: INK });
      g.rect(cx - t * 0.24, cy - t * 0.44, t * 0.48, t * 0.1);
      g.fill({ color: CHALK });
      g.stroke({ width: ink, color: INK });
      g.rect(cx - t * 0.05, cy - t * 0.02, t * 0.1, t * 0.06);
      g.fill({ color: INK });
    } else if (item.kind === 'bush') {
      // Two training cones.
      for (const [ox, s] of [
        [-0.16, 1],
        [0.18, 0.8],
      ] as const) {
        const bx = cx + ox * t;
        const by = cy + t * 0.3;
        g.poly([bx - t * 0.15 * s, by, bx + t * 0.15 * s, by, bx, by - t * 0.4 * s]);
        g.fill({ color: 0xf07a2a });
        g.stroke({ width: ink, color: INK, join: 'round' });
        g.rect(bx - t * 0.18 * s, by, t * 0.36 * s, t * 0.05);
        g.fill({ color: 0xf07a2a });
      }
    } else if (item.variant % 3 === 0) {
      // A hurdle: two legs and a white bar banded black.
      g.moveTo(cx - t * 0.32, cy + t * 0.3).lineTo(cx - t * 0.32, cy - t * 0.2);
      g.moveTo(cx + t * 0.32, cy + t * 0.3).lineTo(cx + t * 0.32, cy - t * 0.2);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x55575c });
      g.rect(cx - t * 0.38, cy - t * 0.28, t * 0.76, t * 0.12);
      g.fill({ color: CHALK });
      g.stroke({ width: ink, color: INK });
      for (const bx of [-0.2, 0.08]) g.rect(cx + bx * t, cy - t * 0.28, t * 0.12, t * 0.12);
      g.fill({ color: INK });
    } else {
      // A net bag of balls, white and orange.
      g.ellipse(cx, cy + t * 0.3, t * 0.32, t * 0.07);
      g.fill({ color: 0x000000, alpha: 0.2 });
      for (const [ox, oy, c] of [
        [-0.13, 0.12, 0xffffff],
        [0.13, 0.12, 0xe8792a],
        [0, -0.08, 0xffffff],
      ] as const) {
        g.circle(cx + ox * t, cy + oy * t, t * 0.15);
        g.fill({ color: c });
        g.stroke({ width: ink, color: INK });
      }
      g.moveTo(cx, cy - t * 0.23).lineTo(cx, cy - t * 0.42);
      g.stroke({ width: ink, color: INK });
    }
  }
}
