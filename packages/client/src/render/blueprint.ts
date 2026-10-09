import type { ArtConfig, BlueprintStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics, Text } from 'pixi.js';

import { t as t_ } from '../i18n.js';
import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { TitleBlock, titleBlockRect } from './titleBlock.js';
import { loops, rounded } from './inkline.js';
import { release } from './release.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
  GunAims,
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
  mixed,
  playerColour,
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
  shotProgress,
} from './theme.js';
import { BlueprintSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { dashed, hatch, outline, trace, wallGeometry, type Segment } from './walls.js';
import { cannonBase } from './cannonBase.js';
import { hueNearness } from './hue.js';

/** A mark where a shot landed: rings for a moment, and on a wall a demolition cross. */
interface Mark {
  /** Its revision cloud, drawn once and faded by its alpha (`drawMarks`). */
  cloud: Graphics | null;
  x: number;
  y: number;
  age: number;
  onWall: boolean;
  inSea: boolean;
}

/** A line fragment thrown up by a destroyed block, in tile coordinates. */
interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  colour: number;
}

/** How much of a shot's course its dashed trail shows, in tiles. */
const TRAIL_TILES = 4;

/** A block the sweep took, its outline dashing away. */
interface Fade {
  x: number;
  y: number;
  age: number;
  colour: number;
}

/** How long a recoil takes to come home. */
const RECOIL_MS = 160;
/** How long an impact's rings spread. */
const RING_MS = 420;

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'mark', flag: 'pennant' };

/**
 * The blueprint look: the board as an architect's plan, drawn in ink on blue paper.
 *
 * Clean and calm, which is what building needs, and offered for combat too. A drafting
 * grid runs over the whole sheet; the sea is hatched as a plan marks water, and the coast
 * is a bold contour. Walls are drawn as walls are on a plan — an outline hatched inside —
 * and stand up as the pixel style's do, to the same height. Castles are floor-plan
 * symbols filled in while sealed; guns are survey marks; sealed ground is cross-hatched
 * inside a dashed boundary. The piece in hand is dashed, as proposed construction is.
 * Player colours are the shared hues washed toward white, so they read on blue.
 */
export class BlueprintTheme implements Theme {
  readonly id = 'blueprint' as const;

  private art!: ArtConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new BlueprintSeaLife();
  private style!: BlueprintStyleConfig;

  private readonly terrainGfx = new Graphics();
  /** The drawing's title block, in the corner (PLAN 11.24). */
  private readonly titleBlock = new TitleBlock();
  private corner: TimerSpot | null = null;
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  /**
   * An eraser's smudge where a block was shot away, for the rest of the round, under the
   * walls so a block drawn in again covers it; and pencil strokes over a piece just laid,
   * sketched and then inked over.
   */
  private readonly smudgeStamps = new Stamps();
  private readonly smudgeBook = new StampBook();
  /** What the smudges were last placed for: they change only as a block is shot away. */
  private smudgeKey = '';
  private smudges: { x: number; y: number; round: number }[] = [];
  private pencils: { cells: readonly Cell[]; age: number }[] = [];
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawBlueprintScenery(g, view, items, this.art),
    () => hex(this.art.palette.rockLight),
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /**
   * Sealed keeps' walls filled in, over `effectGfx`, redrawn only as a keep is sealed or
   * breached; and the drafting compass over them, as it was drawn after them.
   */
  private readonly keepGfx = new Graphics();
  private keepKey = '';
  private readonly compassGfx = new Graphics();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** What lies over the guns: the pennants. */
  private readonly lateGfx = new Graphics();
  /**
   * The main castles' crowns, over the pennants, redrawn only when one changes: drawn every
   * frame they were a few hundred vertices rebuilt for nothing.
   */
  private readonly crownGfx = new Graphics();
  private crownKey = '';
  /** Where the clouds were drawn for: a change of view draws them again. */
  private cloudKey = '';
  /** Shots in the air: their trails, the crosses below them, their targets. */
  private readonly shotGfx = new Graphics();
  /** The shots' heads over them, stamped (`drawShots`). */
  private readonly heads = new Stamps();
  private readonly headBook = new StampBook();
  /** The rings of their landings. */
  private readonly ringGfx = new Graphics();
  /**
   * The revision clouds round breaches, a `Graphics` each, drawn once and faded by its
   * alpha: redrawn every frame they fade, about 2,000 vertices a frame at eight players.
   */
  private readonly cloudLayer = new Container();
  /** Over the clouds: fragments, fades and the finish. */
  private readonly topGfx = new Graphics();
  private readonly overlayGfx = new Graphics();
  /** Each castle's tag lettered over it ("KEEP B-2"), where the tiles are large enough. */
  private readonly tagLayer = new Container();
  private readonly tags: Text[] = [];
  /** When each castle was last seen sealing, for the drafting compass's arc round it. */
  private readonly sealing = new Map<number, number>();
  private sealedBefore: readonly boolean[] = [];

  private terrain: Uint8Array | null = null;
  private width = 0;
  private marks: Mark[] = [];
  private fragments: Fragment[] = [];
  private fades: Fade[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private readonly flags = new FlagHoist();
  private clock = 0;
  /** Each owner's ink as drawn on this paper (`colour`), worked out once. */
  private readonly inks = new Map<number, number>();
  private inkPaper = -1;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.blueprint;
    layers.terrain.addChild(this.terrainGfx, this.titleBlock.container);
    layers.territory.addChild(
      this.scenery.gfx,
      this.territory.container,
      this.smudgeStamps.container,
    );
    layers.structures.addChild(this.structures.container, this.tagLayer);
    layers.effects.addChild(
      this.seaLife.course,
      this.effectGfx,
      this.keepGfx,
      this.compassGfx,
      this.gunMemo.container,
      this.lateGfx,
      this.crownGfx,
      this.shotGfx,
      this.heads.container,
      this.ringGfx,
      this.cloudLayer,
      this.topGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.titleBlock.destroy();
    this.gunMemo.destroy();
    this.lateGfx.destroy();
    this.crownGfx.destroy();
    this.shotGfx.destroy();
    this.heads.destroy();
    this.headBook.destroy();
    this.ringGfx.destroy();
    this.topGfx.destroy();
    release(this.cloudLayer);
    this.territory.destroy();
    this.structures.destroy();
    this.smudgeStamps.destroy();
    this.smudgeBook.destroy();
    this.keepGfx.destroy();
    this.compassGfx.destroy();
    this.scenery.destroy();
    this.seaLife.course.destroy();
    for (const g of [this.terrainGfx, this.effectGfx, this.overlayGfx]) {
      g.destroy();
    }
    for (const tag of this.tags) tag.destroy();
    this.tagLayer.destroy();
  }

  /**
   * A player's ink, washed toward white as far as its hue is near the paper's: the blue
   * players' walls were blue on blue paper, the hardest to read (the style review).
   */
  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    const colour = playerColour(this.art, player, shade);
    const paper = hex(this.art.palette.grassMid);
    if (paper !== this.inkPaper) {
      this.inks.clear();
      this.inkPaper = paper;
    }
    let ink = this.inks.get(colour);
    if (ink === undefined) {
      ink = mixed(colour, 0xffffff, 0.55 * hueNearness(colour, paper, 45));
      this.inks.set(colour, ink);
    }
    return ink;
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.scenery.refresh(state, view, this.art, true);
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    // The sheet runs out past the board to the window's edge.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;

    // Water, hatched as a plan marks it.
    const sea: Segment[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y)) continue;
        sea.push(...hatch({ x: tileX(view, x), y: tileY(view, y), w: t, h: t }, t * 0.5, '/'));
      }
    }
    trace(g, sea);
    g.stroke({ width: 1, color: hex(palette.waterShallow), alpha: this.style.seaHatchAlpha * 2 });

    // Land as clean paper, tinted just enough to say whose island it is.
    for (let player = 0; player <= state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
        any = true;
      }
      if (!any) continue;
      g.fill({ color: hex(palette.grassMid) });
      if (player === 0) continue;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
      }
      g.fill({ color: this.colour(player - 1, 'dark'), alpha: 0.12 });
    }

    // The drafting grid over the whole sheet, heavier every few tiles.
    const every = this.style.gridMajorEvery;
    for (const major of [false, true]) {
      for (let x = x0; x <= x1; x++) {
        if ((x % every === 0) !== major) continue;
        g.moveTo(tileX(view, x), tileY(view, y0)).lineTo(tileX(view, x), tileY(view, y1));
      }
      for (let y = y0; y <= y1; y++) {
        if ((y % every === 0) !== major) continue;
        g.moveTo(tileX(view, x0), tileY(view, y)).lineTo(tileX(view, x1), tileY(view, y));
      }
      g.stroke({
        width: 1,
        color: hex(palette.grassLight),
        alpha: this.style.gridAlpha * (major ? 2 : 1),
      });
    }

    // Contour lines on the land, as a site plan surveys it: rings in from the coast at a
    // few distances, rounded as ground is, thin under everything built.
    const inland = landDepth(state);
    for (const k of this.style.landContourTiles) {
      const high = (x: number, y: number): boolean =>
        land(x, y) && (inland[y * state.width + x] as number) >= k;
      const cells: Cell[] = [];
      for (let i = 0; i < inland.length; i++) {
        if ((inland[i] as number) < k) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      const contour = loops(outline(cells, high, view), (px, py) =>
        high(Math.floor((px - tileX(view, 0)) / t), Math.floor((py - tileY(view, 0)) / t)),
      );
      for (const loop of contour)
        g.poly(
          rounded(loop, 3).flatMap((p) => [p.x, p.y]),
          true,
        );
      g.stroke({ width: 1, color: hex(palette.rockLight), alpha: 0.28 });
    }

    // A graphic scale over the title block, in tiles, its spans alternately filled.
    if (this.corner !== null) {
      const box = titleBlockRect(view, this.corner);
      const span = t;
      const spans = Math.max(2, Math.min(5, Math.floor((box.w * 0.8) / span)));
      const sx = box.x;
      const sy = box.y - t * 0.55;
      for (let k = 0; k < spans; k++) {
        g.rect(sx + k * span, sy, span, t * 0.18);
        if (k % 2 === 0) g.fill({ color: hex(palette.uiInk), alpha: 0.7 });
        g.stroke({ width: 1, color: hex(palette.uiInk), alpha: 0.8 });
      }
    }

    // The coast as a bold contour.
    const coast: Cell[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      coast.push({ x, y: (i - x) / state.width });
    }
    trace(g, outline(coast, land, view));
    g.stroke({ width: this.style.lineWidthPx, color: hex(palette.rockLight) });
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground cross-hatched in the owner's ink, inside a dashed boundary. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const lines: Segment[] = [];
      for (const { x, y } of cells) {
        const rect = { x: tileX(view, x), y: tileY(view, y), w: t, h: t };
        lines.push(...hatch(rect, t * 0.5, '/'), ...hatch(rect, t * 0.5, '\\'));
      }
      trace(g, lines);
      g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      const inside = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      trace(
        g,
        outline(cells, inside, view).flatMap((s) => dashed(s, t * 0.3, t * 0.2)),
      );
      g.stroke({ width: 1.5, color: this.colour(player, 'light') });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  /** The eraser's smudges and the pencil's strokes; see `smudgeGfx`. */
  private drawDraftsmanship(state: MatchState, view: ViewTransform, deltaMs: number): void {
    for (const s of this.smudges) if (s.round < 0) s.round = state.round;
    this.smudges = this.smudges.filter((s) => s.round === state.round);
    // Within a round smudges are only added, so their count says when they change; and each
    // is one shape stamped. Redrawn every frame in one `Graphics`, they were the style's
    // costliest drawing: 7,300 vertices a frame at eight players in round three, two
    // ellipses for every block shot away, and all of them again at each new one.
    const smudgeKey = `${viewKey(view)}|${state.round}|${this.smudges.length}`;
    if (smudgeKey !== this.smudgeKey) {
      this.smudgeKey = smudgeKey;
      this.placeSmudges(view);
    }
    this.drawPencils(view, deltaMs);
  }

  private placeSmudges(view: ViewTransform): void {
    const t = view.tile;
    const smudge = this.smudgeBook.get('smudge', t, (sm) => {
      sm.ellipse(0, 0, t * 0.55, t * 0.38);
      sm.fill({ color: hex(this.art.palette.rockLight), alpha: 0.07 });
      sm.ellipse(t * 0.1, -t * 0.05, t * 0.4, t * 0.24);
      sm.fill({ color: hex(this.art.palette.rockLight), alpha: 0.07 });
    });
    this.smudgeStamps.begin();
    for (const s of this.smudges) {
      this.smudgeStamps.place(smudge, tileX(view, s.x + 0.5), tileY(view, s.y + 0.5));
    }
    this.smudgeStamps.end();
  }

  private drawPencils(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const g = this.effectGfx;
    const span = 700;
    for (const p of this.pencils) {
      p.age += deltaMs;
      const k = p.age / span;
      if (k >= 1) continue;
      for (const c of p.cells) {
        const x = tileX(view, c.x);
        const y = tileY(view, c.y);
        g.moveTo(x + t * 0.1, y + t * 0.85).lineTo(x + t * 0.95, y + t * 0.2);
        g.moveTo(x - t * 0.05, y + t * 0.1).lineTo(x + t * 1.05, y + t * 0.05);
      }
      g.stroke({ width: 1, color: hex(this.art.palette.rockLight), alpha: 0.6 * (1 - k) });
    }
    this.pencils = this.pencils.filter((p) => p.age < span);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
    this.letterTags(state, view);
  }

  /**
   * Each castle's tag over its plan, as a drawing labels its rooms: the island's letter and
   * the castle's number on it. Only where the tiles are large enough to read it.
   */
  private letterTags(state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const shown = t >= this.style.tagMinTilePx;
    this.tagLayer.visible = shown;
    if (!shown) return;
    while (this.tags.length < state.castles.length) {
      const tag = new Text({
        text: '',
        style: {
          fontFamily: 'Consolas, "Lucida Console", "Courier New", monospace',
          fontSize: 24,
          fill: hex(this.art.palette.uiInk),
          letterSpacing: 1,
        },
      });
      tag.anchor.set(0.5, 1);
      this.tags.push(tag);
      this.tagLayer.addChild(tag);
    }
    const numbers = new Map<number, number>();
    this.tags.forEach((tag, n) => {
      const castle = state.castles[n];
      tag.visible = castle !== undefined;
      if (castle === undefined) return;
      const number = (numbers.get(castle.islandId) ?? 0) + 1;
      numbers.set(castle.islandId, number);
      const text = t_('plan.keep', {
        tag: `${String.fromCharCode(64 + castle.islandId)}-${number}`,
      });
      if (tag.text !== text) tag.text = text;
      tag.scale.set((t * 0.3) / 24);
      tag.alpha = 0.75;
      tag.x = tileX(view, castle.x + castle.w / 2);
      tag.y = tileY(view, castle.y) - t * 0.06;
    });
  }

  /** One island's structures, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const { palette } = this.art;
    const t = view.tile;
    const line = this.style.lineWidthPx;
    const wallOf = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;

    for (let owner = 1; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      this.drawWall(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's rubble: demolished, drawn dashed, lying flat.
    const rubble: Cell[] = [];
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      rubble.push({ x, y: (i - x) / state.width });
    }
    trace(
      g,
      outline(rubble, (x, y) => wallOf(x, y) === 0, view).flatMap((s) =>
        dashed(s, t * 0.2, t * 0.15),
      ),
    );
    g.stroke({ width: 1, color: hex(palette.rockDark) });

    // Castles as an architect plans a keep: its walls cut through and drawn at their
    // thickness, round towers at the corners, a door in the south wall with its swing, a
    // stair in the room; a player's main castle with its outline doubled. A sealed keep's
    // walls are filled solid (`drawKeeps`), as a plan fills what is built.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const main = state.players[owner]?.startingCastleId === castle.id;
      this.drawKeepPlan(g, view, castle, owner, main);
    }

    // Guns as emplacements in plan: an octagonal platform on the gun's square, its
    // centreline and swing drawn with the barrel (`drawBarrels`). Silenced: the platform
    // dashed and crossed out, as work struck from a drawing.
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, null, this.colour(cannon.owner, 'light'));
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = (Math.min(cannon.w, cannon.h) * t) / 2 - t * 0.16;
      const corners: [number, number][] = [];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2;
        corners.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      const ink = this.colour(cannon.owner, 'light');
      if (cannon.active) {
        g.poly(corners.flat());
        g.fill({ color: hex(palette.grassMid) });
        g.stroke({ width: line, color: ink });
        // The mount's ring inside the platform.
        g.circle(cx, cy, r * 0.42);
        g.stroke({ width: 1, color: this.colour(cannon.owner, 'base'), alpha: 0.8 });
        continue;
      }
      const edges = corners.map(([x1, y1], k) => {
        const [x2, y2] = corners[(k + 1) % 8] as [number, number];
        return { x1, y1, x2, y2 };
      });
      trace(
        g,
        edges.flatMap((s) => dashed(s, t * 0.16, t * 0.12)),
      );
      g.stroke({ width: line, color: ink, alpha: 0.85 });
      const d = r * 0.6;
      g.moveTo(cx - d, cy - d).lineTo(cx + d, cy + d);
      g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
      g.stroke({ width: 1.5, color: ink, alpha: 0.85 });
    }
  }

  /** The cut walls of a keep in plan, as rectangles, the door's gap left open. */
  private keepWalls(
    view: ViewTransform,
    castle: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number }[] {
    const t = view.tile;
    const x = tileX(view, castle.x) + t * 0.16;
    const y = tileY(view, castle.y) + t * 0.16;
    const w = castle.w * t - t * 0.32;
    const h = castle.h * t - t * 0.32;
    const k = t * 0.22;
    const door = t * 0.42;
    const half = (w - door) / 2;
    return [
      { x, y, w, h: k },
      { x, y: y + k, w: k, h: h - k * 2 },
      { x: x + w - k, y: y + k, w: k, h: h - k * 2 },
      { x, y: y + h - k, w: half, h: k },
      { x: x + w - half, y: y + h - k, w: half, h: k },
    ];
  }

  /** One keep's plan, for `IslandParts`; its walls filled when sealed by `drawKeeps`. */
  private drawKeepPlan(
    g: Graphics,
    view: ViewTransform,
    castle: { x: number; y: number; w: number; h: number },
    owner: number,
    main: boolean,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const line = this.style.lineWidthPx;
    const ink = this.colour(owner, 'light');
    const walls = this.keepWalls(view, castle);
    const x = tileX(view, castle.x) + t * 0.16;
    const y = tileY(view, castle.y) + t * 0.16;
    const w = castle.w * t - t * 0.32;
    const h = castle.h * t - t * 0.32;
    const k = t * 0.22;
    // The room, clean paper.
    g.rect(x, y, w, h);
    g.fill({ color: hex(palette.grassMid) });
    // The walls cut through, hatched as a section is until they are built (sealed).
    for (const r of walls) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(owner, 'dark'), alpha: 0.5 });
    trace(
      g,
      walls.flatMap((r) => hatch(r, t * 0.12, '/')),
    );
    g.stroke({ width: 1, color: this.colour(owner, 'base'), alpha: 0.75 });
    for (const r of walls) g.rect(r.x, r.y, r.w, r.h);
    g.stroke({ width: 1, color: ink });
    if (main) {
      // A main castle's outline doubled, as a plan marks the principal building.
      const m = t * 0.08;
      g.rect(x - m, y - m, w + m * 2, h + m * 2);
      g.stroke({ width: 1, color: ink });
    }
    // Round towers at the corners, their own wall's thickness inside.
    for (const [cx, cy] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ] as const) {
      g.circle(cx, cy, t * 0.24);
      g.fill({ color: hex(palette.grassMid) });
      g.stroke({ width: line * 0.75, color: ink });
      g.circle(cx, cy, t * 0.11);
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
    }
    // The door's swing: its leaf standing open from the west jamb, the arc it sweeps.
    const door = t * 0.42;
    const hinge = { x: x + (w - door) / 2, y: y + h - k };
    g.moveTo(hinge.x, hinge.y).lineTo(hinge.x, hinge.y - door);
    g.stroke({ width: 1.5, color: ink });
    g.moveTo(hinge.x, hinge.y - door);
    g.arc(hinge.x, hinge.y, door, -Math.PI / 2, 0);
    g.stroke({ width: 1, color: ink, alpha: 0.6 });
    // A stair in the north-east of the room: its treads, and the arrow going up.
    const sw = w * 0.22;
    const sx = x + w - k - sw - t * 0.08;
    const sy = y + k + t * 0.08;
    const sh = h * 0.36;
    g.rect(sx, sy, sw, sh);
    for (let n = 1; n < 5; n++) {
      g.moveTo(sx, sy + (sh * n) / 5).lineTo(sx + sw, sy + (sh * n) / 5);
    }
    g.moveTo(sx + sw / 2, sy + sh - t * 0.04).lineTo(sx + sw / 2, sy + t * 0.06);
    g.moveTo(sx + sw / 2 - sw * 0.25, sy + t * 0.16).lineTo(sx + sw / 2, sy + t * 0.06);
    g.lineTo(sx + sw / 2 + sw * 0.25, sy + t * 0.16);
    g.stroke({ width: 1, color: ink, alpha: 0.75 });
  }

  /**
   * Wall in the owner's ink, standing up: tops outlined and hatched inside, as walls are
   * on a plan, over front faces of the pixel style's height.
   */
  private drawWall(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
    alpha = 1,
  ): void {
    const t = view.tile;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha: 0.45 * alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha: 0.85 * alpha });

    trace(
      g,
      wall.tops.flatMap((r) => hatch(r, t * this.style.hatchTiles, '\\')),
    );
    g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: 0.75 * alpha });
    trace(g, [...wall.faceEdges, ...wall.strips]);
    g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: 0.7 * alpha });
    trace(g, wall.rim);
    g.stroke({ width: this.style.lineWidthPx, color: this.colour(player, 'light'), alpha });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea =
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      this.terrain[y * this.width + x] !== Terrain.Land;
    this.marks.push({ cloud: null, x, y, age: 0, onWall: debris.length > 0, inSea });
    for (const block of debris) this.smudges.push({ x: block.x, y: block.y, round: -1 });
    for (const block of debris) {
      for (let k = 0; k < 6; k++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 2;
        this.fragments.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          spin: Math.random() * Math.PI,
          age: 0,
          colour: this.colour(block.owner, 'light'),
        });
      }
    }
  }

  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockDark) : this.colour(block.owner, 'light');
    this.fades.push({ x: block.x, y: block.y, age: 0, colour });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.pencils.push({ cells, age: 0 });
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();
    this.compassGfx.clear();
    this.lateGfx.clear();
    this.shotGfx.clear();
    this.ringGfx.clear();
    this.topGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    this.clock += frame.deltaMs;
    this.titleBlock.container.visible = this.corner !== null;
    if (this.corner !== null) {
      this.titleBlock.draw(state, view, this.corner, this.art, frame.deltaMs, motionReduced());
    }
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawDraftsmanship(state, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockMid), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawKeeps(state, view, frame);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawPennants(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawMarks(view, frame.deltaMs);
    this.drawFragments(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.winnerBanners.draw(this.topGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.topGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A sealed keep's walls are filled in solid, as a plan fills what is built. */
  private drawKeeps(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    let key = viewKey(view);
    for (const castle of state.castles) {
      if (frame.castleSealed[castle.id] ?? false) {
        key += `|${castle.id},${castle.x},${castle.y},${castle.w},${castle.h},${castle.islandId}`;
      }
    }
    if (key === this.keepKey) return;
    this.keepKey = key;
    const g = this.keepGfx;
    g.clear();
    for (const castle of state.castles) {
      if (!(frame.castleSealed[castle.id] ?? false)) continue;
      for (const r of this.keepWalls(view, castle)) g.rect(r.x, r.y, r.w, r.h);
      g.fill({ color: this.colour(castle.islandId - 1, 'base'), alpha: 0.9 });
    }
  }

  /** Barrels as a line from the mount with an arrowhead, kicking back on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const memo = this.gunMemo;
    memo.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      // Still between shots: drawn again only as it turns and kicks.
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.w},${cannon.h},${cannon.owner},${cannon.active}|${aim.angle}|${aim.firedAgo < RECOIL_MS ? aim.firedAgo : '-'}`;
      memo.draw(cannon.id, key, (g) => {
        const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
        const length = cannon.active ? 1.05 - 0.3 * kick : 0.5;
        const cx = cannon.x + cannon.w / 2;
        const cy = cannon.y + cannon.h / 2;
        const sx = Math.sin(aim.angle);
        const sy = -Math.cos(aim.angle);
        const ex = tileX(view, cx + sx * length);
        const ey = tileY(view, cy + sy * length);
        const colour = cannon.active
          ? this.colour(cannon.owner, 'light')
          : hex(this.art.palette.rockDark);
        g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
        if (cannon.active) {
          // The arrowhead, as a direction is marked on a drawing.
          const head = t * 0.3;
          for (const side of [-1, 1]) {
            const a = aim.angle + Math.PI + side * 0.45;
            g.moveTo(ex, ey).lineTo(ex + Math.sin(a) * head, ey - Math.cos(a) * head);
          }
        }
        g.stroke({ width: Math.max(1.5, t * 0.12), color: colour });
        if (!cannon.active) return;
        // Its centreline, dash and dot, run on past the muzzle as a plan draws an axis,
        // and a dashed arc either side of it for the swing the mount allows.
        const ink = this.colour(cannon.owner, 'base');
        const pattern = [0.22, 0.07, 0.03, 0.07];
        let d = -0.6;
        for (let n = 0; d < 1.7; n++) {
          const on = n % 2 === 0;
          const step = pattern[n % 4] as number;
          if (on) {
            g.moveTo(tileX(view, cx + sx * d), tileY(view, cy + sy * d));
            g.lineTo(tileX(view, cx + sx * (d + step)), tileY(view, cy + sy * (d + step)));
          }
          d += step;
        }
        const r = t * 0.8;
        const mid = aim.angle - Math.PI / 2;
        for (let k = -3; k < 3; k += 2) {
          const a = mid + (k / 3) * 0.6;
          g.moveTo(tileX(view, cx) + Math.cos(a) * r, tileY(view, cy) + Math.sin(a) * r);
          g.arc(tileX(view, cx), tileY(view, cy), r, a, a + 0.2);
        }
        g.stroke({ width: 1, color: ink, alpha: 0.6 });
      });
    }
    memo.end();
    this.aims.prune(state);
  }

  /** A pennant on a pole over each sealed keep, hoisted as it is sealed. */
  private drawPennants(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    this.drawCompasses(state, view, frame);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const pole = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - t * 1.1;
      const foot = tileY(view, castle.y + castle.h / 2 - 0.2);
      g.moveTo(pole, foot).lineTo(pole, top);
      g.stroke({ width: 1, color: hex(this.art.palette.rockLight) });
      const height = t * 0.55;
      const y = foot - height - raised * (foot - top - height);
      g.poly([pole, y, pole + t * 0.8, y + height / 2, pole, y + height]);
      if (this.flags.lowering(castle.id)) {
        g.stroke({ width: 1, color: this.colour(owner, 'light') });
      } else {
        g.fill({ color: this.colour(owner, 'light') });
      }
    }
  }

  /**
   * The drafting compass, as a ring is sealed: its needle set in the keep, its pencil leg
   * swinging an arc once round the new enclosure, then lifted away.
   */
  private drawCompasses(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.compassGfx;
    const t = view.tile;
    const span = this.style.compassMs;
    frame.castleSealed.forEach((sealed, id) => {
      if (sealed && this.sealedBefore[id] === false) this.sealing.set(id, this.clock);
    });
    this.sealedBefore = [...frame.castleSealed];
    for (const [id, at] of this.sealing) {
      const k = (this.clock - at) / span;
      const castle = state.castles.find((c) => c.id === id);
      if (k >= 1 || castle === undefined) {
        this.sealing.delete(id);
        continue;
      }
      const owner = castle.islandId - 1;
      const ink = this.colour(owner, 'light');
      const cx = tileX(view, castle.x + castle.w / 2);
      const cy = tileY(view, castle.y + castle.h / 2);
      const r = t * 3.6;
      const swept = Math.min(1, k / 0.8) * Math.PI * 2;
      const start = -Math.PI / 2;
      const fade = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
      g.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
      g.arc(cx, cy, r, start, start + swept);
      g.stroke({ width: 1.5, color: ink, alpha: 0.7 * fade });
      // The instrument: two legs from a hinge over the middle of the swing.
      const px = cx + Math.cos(start + swept) * r;
      const py = cy + Math.sin(start + swept) * r;
      const hx = (cx + px) / 2 - Math.sin(start + swept) * t * 0.3;
      const hy = (cy + py) / 2 - t * 1.4;
      g.moveTo(cx, cy).lineTo(hx, hy).lineTo(px, py);
      g.moveTo(hx, hy).lineTo(hx, hy - t * 0.5);
      g.stroke({ width: 2, color: hex(this.art.palette.uiInk), alpha: 0.8 * fade });
      g.circle(hx, hy, t * 0.12);
      g.fill({ color: hex(this.art.palette.uiInk), alpha: 0.8 * fade });
    }
  }

  /** The main castles' crowns (`drawMainCastles`), drawn again only when one changes. */
  private drawCrowns(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    // Everything `drawMainCastles` reads: each player's main castle, where it stands, and
    // whether it is sealed.
    let key = viewKey(view);
    for (const player of state.players) {
      key += `|${player.id},${player.eliminated},${player.startingCastleId}`;
      if (player.eliminated || player.startingCastleId === null) continue;
      const castle = state.castles.find((c) => c.id === player.startingCastleId);
      if (castle === undefined) continue;
      key += `,${castle.x},${castle.y},${castle.w},${castle.h},${frame.castleSealed[castle.id] === true}`;
    }
    if (key === this.crownKey) return;
    this.crownKey = key;
    this.crownGfx.clear();
    drawMainCastles(this.crownGfx, view, state, this.art, frame.castleSealed);
  }

  /**
   * Shots as a projectile symbol — a ring with a cross — riding a dashed trajectory
   * from the gun, with a small cross on the ground below.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.shotGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    this.drawCrowns(state, view, frame);
    this.heads.begin();
    const trailAlpha = 0.45 * Math.min(1, Math.sqrt(6 / Math.max(1, state.shots.length)));
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const at = (tk: number): { x: number; y: number } => ({
        x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * tk + 0.5),
        y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * tk + 0.5 - shotLift(shot, tk)),
      });
      const colour = this.colour(shot.owner, 'light');
      // The trajectory behind it, in short dashes: only its last few tiles, and fainter
      // the more shots are in the air. Whole courses at eight players were a field of
      // scratches over the board (the style review).
      const range = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
      const from = Math.max(0, p - TRAIL_TILES / Math.max(1, range));
      const steps = 8;
      for (let k = 0; k < steps; k += 2) {
        const a = at(from + ((p - from) * k) / steps);
        const b = at(from + ((p - from) * (k + 1)) / steps);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 1, color: colour, alpha: trailAlpha });
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const s = t * 0.12;
      g.moveTo(gx - s, gy - s).lineTo(gx + s, gy + s);
      g.moveTo(gx - s, gy + s).lineTo(gx + s, gy - s);
      g.stroke({ width: 1, color: colour, alpha: 0.5 });
      const head = at(p);
      // The projectile stamped, by its colour and its radius to an eighth of a pixel: a
      // ring is a hundred vertices, and redrawn for every shot in the air each frame the
      // heads were most of what this style rebuilt (about 1,800 vertices at eight players).
      const exact = t * (0.2 + 0.08 * Math.min(1, shotLift(shot, p) / 3));
      const r = Math.round(exact * 8) / 8;
      const projectile = this.headBook.get(`${colour}|${r}`, t, (h) => {
        h.circle(0, 0, r);
        h.fill({ color: hex(this.art.palette.shadow) });
        h.stroke({ width: 1.5, color: colour });
        h.moveTo(-r, 0).lineTo(r, 0);
        h.moveTo(0, -r).lineTo(0, r);
        h.stroke({ width: 1, color: colour });
      });
      this.heads.place(projectile, head.x, head.y);
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    this.heads.end();
  }

  /**
   * Where a shot came down: rings spreading from it, and where it took a wall a cross
   * marking the block demolished, fading as the breach is left to smoulder.
   */
  private drawMarks(view: ViewTransform, deltaMs: number): void {
    const g = this.ringGfx;
    const t = view.tile;
    const key = viewKey(view);
    if (key !== this.cloudKey) {
      // The board moved: every cloud is drawn again where it now stands.
      this.cloudKey = key;
      for (const mark of this.marks) mark.cloud?.clear();
      for (const mark of this.marks) if (mark.cloud !== null) this.drawCloud(mark, view);
    }
    const linger = this.art.generators.fx.smoulderMs;
    for (const mark of this.marks) {
      mark.age += deltaMs;
      const cx = tileX(view, mark.x + 0.5);
      const cy = tileY(view, mark.y + 0.5);
      const ring = mark.age / RING_MS;
      if (ring < 1) {
        const colour = hex(mark.inSea ? this.art.palette.waterFoam : this.art.palette.uiInk);
        g.circle(cx, cy, t * (0.3 + 1.4 * ring));
        g.stroke({ width: 1.5, color: colour, alpha: 1 - ring });
        if (mark.inSea) {
          g.circle(cx, cy, t * (0.15 + 0.8 * ring));
          g.stroke({ width: 1, color: colour, alpha: 1 - ring });
        }
      }
      if (!mark.onWall) continue;
      const life = 1 - mark.age / linger;
      if (life <= 0) {
        if (mark.cloud !== null) mark.cloud.visible = false;
        continue;
      }
      if (mark.cloud === null) {
        mark.cloud = new Graphics();
        this.cloudLayer.addChild(mark.cloud);
        this.drawCloud(mark, view);
      }
      // Faded by the cloud's alpha rather than its strokes': the same product per vertex.
      mark.cloud.alpha = life;
    }
    this.marks = this.marks.filter((m) => {
      const keep = m.age < (m.onWall ? Math.max(linger, RING_MS) : RING_MS);
      if (!keep && m.cloud !== null) m.cloud.destroy();
      return keep;
    });
  }

  /** A revision cloud round a block shot away, at full strength; see `drawMarks`. */
  private drawCloud(mark: Mark, view: ViewTransform): void {
    const g = mark.cloud as Graphics;
    const t = view.tile;
    const cx = tileX(view, mark.x + 0.5);
    const cy = tileY(view, mark.y + 0.5);
    // A revision cloud round the block shot away, and its delta tag, as an architect
    // marks a change to a drawing.
    const red = hex(this.art.palette.uiInvalid);
    const r = t * 0.62;
    const bumps = 8;
    const turn = (mark.x * 7 + mark.y * 3) % 8;
    for (let k = 0; k <= bumps; k++) {
      const a = ((k + turn / 8) / bumps) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) {
        g.moveTo(px, py);
        continue;
      }
      // Each scallop three points of its curve rather than a curve: the cloud was redrawn
      // every frame it faded, at eight players for every breach on the board.
      const prev = a - (Math.PI * 2) / bumps;
      const m = a - Math.PI / bumps;
      const qx = cx + Math.cos(m) * r * 1.38;
      const qy = cy + Math.sin(m) * r * 1.38;
      const ax = cx + Math.cos(prev) * r;
      const ay = cy + Math.sin(prev) * r;
      for (const u of [1 / 3, 2 / 3, 1]) {
        const v = 1 - u;
        g.lineTo(
          v * v * ax + 2 * v * u * qx + u * u * px,
          v * v * ay + 2 * v * u * qy + u * u * py,
        );
      }
    }
    g.stroke({ width: 1.5, color: red });
    const tx = cx + r * 1.05;
    const ty = cy - r * 1.05;
    const side = t * 0.34;
    g.poly([
      tx,
      ty - side * 0.6,
      tx + side * 0.5,
      ty + side * 0.3,
      tx - side * 0.5,
      ty + side * 0.3,
    ]);
    g.stroke({ width: 1, color: red });
    g.moveTo(tx, ty - side * 0.2).lineTo(tx, ty + side * 0.15);
    g.stroke({ width: 1, color: red });
  }

  /** Pieces of line thrown up by a destroyed block, tumbling as they fall. */
  private drawFragments(view: ViewTransform, deltaMs: number): void {
    const g = this.topGfx;
    const life = this.art.generators.fx.debrisMs;
    const dt = deltaMs / 1000;
    const half = view.tile * 0.12;
    for (const f of this.fragments) {
      f.age += deltaMs;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 9 * dt;
      f.spin += dt * 8;
      const x = tileX(view, f.x);
      const y = tileY(view, f.y);
      g.moveTo(x - Math.cos(f.spin) * half, y - Math.sin(f.spin) * half);
      g.lineTo(x + Math.cos(f.spin) * half, y + Math.sin(f.spin) * half);
      g.stroke({ width: 1.5, color: f.colour, alpha: Math.max(0, 1 - f.age / life) });
    }
    this.fragments = this.fragments.filter((f) => f.age < life);
  }

  /** A block the sweep took, its outline breaking into dashes and fading. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const g = this.topGfx;
    const span = this.art.flat.crumbleMs;
    const t = view.tile;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const k = fade.age / span;
      if (k >= 1) continue;
      const cell = [{ x: fade.x, y: fade.y }];
      const gap = t * 0.1 + t * 0.4 * k;
      trace(
        g,
        outline(cell, () => false, view).flatMap((s) => dashed(s, t * 0.25, gap)),
      );
      g.stroke({ width: 1.5, color: fade.colour, alpha: 1 - k });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
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
      // Proposed construction, drawn dashed as a plan draws it: hatched in the player's
      // ink where it fits, and crossed out in red where it does not.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
      const inside = (x: number, y: number): boolean => inPiece.has(`${x},${y}`);
      const colour = ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.uiInvalid);
      const fill: Segment[] = [];
      for (const { x, y } of cells) {
        const rect = { x: tileX(view, x), y: tileY(view, y), w: t, h: t };
        if (ghost.valid) fill.push(...hatch(rect, t * this.style.hatchTiles, '\\'));
        else {
          fill.push({ x1: rect.x, y1: rect.y, x2: rect.x + t, y2: rect.y + t });
          fill.push({ x1: rect.x, y1: rect.y + t, x2: rect.x + t, y2: rect.y });
        }
      }
      trace(g, fill);
      g.stroke({ width: 1, color: colour, alpha: 0.7 });
      trace(
        g,
        outline(cells, inside, view).flatMap((s) => dashed(s, t * 0.3, t * 0.15)),
      );
      g.stroke({ width: this.style.lineWidthPx, color: colour });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = (Math.min(ghost.footprint.w, ghost.footprint.h) * t) / 2 - t * 0.2;
      for (let k = 0; k < 16; k += 2) {
        const a = (k / 16) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.arc(cx, cy, r, a, ((k + 1) / 16) * Math.PI * 2);
        g.stroke({ width: this.style.lineWidthPx, color: colour });
      }
      const reach = r + t * 0.25;
      g.moveTo(cx - reach, cy).lineTo(cx + reach, cy);
      g.moveTo(cx, cy - reach).lineTo(cx, cy + reach);
      if (!ghost.valid) {
        // Struck through: red alone would vanish on the crimson player's own ink.
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
      }
      g.stroke({ width: 1.5, color: colour });
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Blueprint's scenery as a plan draws it: a tree its canopy's scalloped edge, a
 * pine a circle with its needles ticked round it, a bush a small circle, a boulder an
 * outline with a line of hatching. Thin and pale, beneath the walls' weight.
 */
function drawBlueprintScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // A canopy's scalloped edge, as landscape plans draw trees: a plain circle with a
      // cross was a gun's survey mark in small.
      const r = t * (0.3 + (item.variant % 2) * 0.04);
      const points: number[] = [];
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        const bump = r * (0.84 + 0.16 * Math.abs(Math.sin(a * 3.5)));
        points.push(cx + Math.cos(a) * bump, cy + Math.sin(a) * bump);
      }
      g.poly(points);
      g.circle(cx, cy, Math.max(1, t * 0.03));
    } else if (item.kind === 'pine') {
      const r = t * 0.24;
      g.circle(cx, cy, r);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.lineTo(cx + Math.cos(a) * (r + t * 0.1), cy + Math.sin(a) * (r + t * 0.1));
      }
    } else if (item.kind === 'bush') {
      g.circle(cx - t * 0.1, cy, t * 0.14);
      g.circle(cx + t * 0.12, cy + t * 0.04, t * 0.12);
    } else {
      const r = t * 0.2;
      g.poly([
        cx - r,
        cy + r * 0.5,
        cx - r * 0.5,
        cy - r * 0.7,
        cx + r * 0.6,
        cy - r * 0.6,
        cx + r,
        cy + r * 0.4,
        cx + r * 0.1,
        cy + r * 0.8,
      ]);
      g.moveTo(cx - r * 0.3, cy + r * 0.5).lineTo(cx + r * 0.4, cy - r * 0.2);
    }
  }
  g.stroke({ width: 1, color: hex(art.palette.rockMid), alpha: 0.7 });
}

/** How far each land tile lies from the sea, in tiles, 4-connected: 1 on the coast. */
function landDepth(state: MatchState): Uint16Array {
  const { width, height, terrain } = state;
  const depth = new Uint16Array(terrain.length);
  const queue: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== Terrain.Land) continue;
    const x = i % width;
    const y = (i - x) / width;
    const coastal =
      x === 0 ||
      y === 0 ||
      x === width - 1 ||
      y === height - 1 ||
      terrain[i - 1] !== Terrain.Land ||
      terrain[i + 1] !== Terrain.Land ||
      terrain[i - width] !== Terrain.Land ||
      terrain[i + width] !== Terrain.Land;
    if (!coastal) continue;
    depth[i] = 1;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % width;
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (j < 0 || j >= terrain.length || terrain[j] !== Terrain.Land || depth[j] !== 0) continue;
      depth[j] = (depth[i] as number) + 1;
      queue.push(j);
    }
  }
  return depth;
}
