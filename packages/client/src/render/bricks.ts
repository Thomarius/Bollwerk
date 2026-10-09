import type { ArtConfig, BricksStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { FillPattern, Graphics, Matrix, Texture, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { Circling, behindCorner, outerOcean } from './ocean.js';
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
import { BricksSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { outline, trace, wallGeometry } from './walls.js';

/** A brick knocked loose by a shot or the sweep, tumbling as it falls. */
interface Loose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  colour: number;
  /** How long it lasts, in milliseconds. */
  life: number;
  /** The ground it bounces off, a little below where it was knocked from, in tiles. */
  floor: number;
}

/** Rings where a shot came down in the sea. */
interface Splash {
  x: number;
  y: number;
  age: number;
}

/** A piece that has just clicked down: its studs flash. */
interface Click {
  cells: readonly Cell[];
  age: number;
}

/** A stud popped off a castle as it seals, flying up and falling away. */
interface Pop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  colour: number;
  /** A twinkle of light rather than a stud. */
  spark: boolean;
}

/** How long a recoil takes to come home. */
const RECOIL_MS = 160;
/** How long a splash's rings spread. */
const SPLASH_MS = 520;
/** How long the flash off a piece's studs lasts as it clicks down. */
const CLICK_MS = 260;

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'brick', flag: 'brick' };

/**
 * The toy bricks look (PLAN 11.11 W8): the board built of studded plastic bricks on
 * baseplates — green under the land, blue under the sea, whose studs are faint so the sea
 * stays calm behind the game. Walls are bricks in the owner's colour, a stud on every
 * top, standing up to the pixel style's height so a banner's wipe lines up; sealed
 * ground is smooth tiles laid over the studs; castles are brick towers flying a flag;
 * guns are a grey brick mount with a round barrel. Pieces click down, and a hit knocks
 * bricks loose. The player colours are the shared ones: bright and clean already.
 */
export class BricksTheme implements Theme {
  readonly id = 'bricks' as const;

  private art!: ArtConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new BricksSeaLife();
  private style!: BricksStyleConfig;

  private readonly terrainGfx = new Graphics();
  /** The crane on its barge in the corner (PLAN 11.24), redrawn each frame as it works. */
  private readonly craneGfx = new Graphics();
  private crane: TimerSpot | null = null;
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land, built of bricks; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawBrickScenery(g, view, items, this.art),
    () => hex(this.art.palette.grassLight),
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** What lies over the guns: shots, splashes, the finish. */
  private readonly lateGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private loose: Loose[] = [];
  private splashes: Splash[] = [];
  private clicks: Click[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private readonly flags = new FlagHoist();
  /** The flag panels, a `Graphics` a castle redrawn only while its flag moves (`Memos`). */
  private readonly flagMemo = new Memos();
  /** The studs of the sea and of the land, drawn for the tile size (`studPattern`). */
  private patterns: { sea: FillPattern; land: FillPattern } | null = null;
  private readonly gulls = new Circling();
  /** Gulls and the studs popping off a castle as it seals, stamped (`Stamps`). */
  private readonly book = new StampBook();
  private readonly stamps = new Stamps();
  private pops: Pop[] = [];
  /** Whether each castle was sealed at the last frame, to see one seal. */
  private sealedBefore: readonly boolean[] | null = null;
  private clock = 0;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.bricks;
    layers.terrain.addChild(this.terrainGfx, this.craneGfx);
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.effectGfx,
      this.gunMemo.container,
      this.flagMemo.container,
      this.lateGfx,
      this.stamps.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.gunMemo.destroy();
    this.flagMemo.destroy();
    this.stamps.destroy();
    this.book.destroy();
    if (this.patterns !== null) {
      for (const p of [this.patterns.sea, this.patterns.land]) p.texture.destroy(true);
      this.patterns = null;
    }
    this.lateGfx.destroy();
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [this.terrainGfx, this.craneGfx, this.effectGfx, this.overlayGfx]) {
      g.destroy();
    }
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  /** A stud: a round boss with its lit rim to the north-west and its shade to the south. */
  private stud(g: Graphics, cx: number, cy: number, t: number, colour: number, alpha = 1): void {
    const r = (t * this.style.studScale) / 2;
    g.circle(cx, cy + r * 0.25, r);
    g.fill({ color: 0x000000, alpha: 0.22 * alpha });
    g.circle(cx, cy, r);
    g.fill({ color: colour, alpha });
    g.moveTo(cx - r * 0.7, cy - r * 0.1);
    g.arc(cx, cy, r * 0.7, Math.PI, Math.PI * 1.5);
    g.stroke({ width: Math.max(1, t * 0.05), color: 0xffffff, alpha: 0.55 * alpha });
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.crane = cornerSpot(state, view);
    this.seaLife.corner = this.crane;
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

    // The sea's baseplate runs out past the board to the window's edge.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const sea = (): void => {
      g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    };
    sea();
    g.fill({ color: hex(palette.waterMid) });
    // A plate of shallow water one tile out from the coast, as a toy harbour's lighter plate:
    // the coast reads from afar without anything moving on the sea.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y)) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1 && !near; dx++) near = land(x + dx, y + dy);
        }
        if (near) g.rect(tileX(view, x), tileY(view, y), t, t);
      }
    }
    g.fill({ color: hex(palette.waterShallow), alpha: this.style.shallowPlateAlpha });
    // The joins between baseplates, a darker seam every few tiles, as plates laid side by side.
    const every = this.style.plateSeamTiles;
    for (let x = Math.ceil(x0 / every) * every; x < x1; x += every) {
      g.moveTo(tileX(view, x), tileY(view, y0)).lineTo(tileX(view, x), tileY(view, y1));
    }
    for (let y = Math.ceil(y0 / every) * every; y < y1; y += every) {
      g.moveTo(tileX(view, x0), tileY(view, y)).lineTo(tileX(view, x1), tileY(view, y));
    }
    g.stroke({
      width: Math.max(1, t * 0.08),
      color: hex(palette.shadow),
      alpha: this.style.plateSeamAlpha,
    });
    // The sea's studs, every other tile so it stays calm: a pattern of round studs drawn once
    // for the tile size, since circles of a few pixels drawn as shapes come out as diamonds,
    // and a fill is a handful of vertices where a stud a shape was dozens.
    const old = this.patterns;
    this.patterns = {
      sea: studPattern(view, 2, palette.waterShallow, this.style.studScale),
      land: studPattern(view, 1, palette.grassLight, this.style.studScale),
    };
    sea();
    g.fill({ fill: this.patterns.sea, alpha: this.style.seaStudAlpha });

    // The land's plate, raised: a darker edge where it drops to the sea on its south.
    const cells: Cell[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      cells.push({ x, y: (i - x) / state.width });
      g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
    }
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of cells) {
      if (land(x, y + 1)) continue;
      g.rect(tileX(view, x), tileY(view, y + 1), t, t * 0.22);
    }
    g.fill({ color: hex(palette.grassDark) });
    // A faint tint of the owner on each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of cells) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.06 });
    }
    // The land's studs, every tile, from the same kind of pattern.
    for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ fill: this.patterns.land, alpha: this.style.landStudAlpha });
    trace(g, outline(cells, land, view));
    g.stroke({ width: 1, color: hex(palette.grassDark) });
    // Gulls wheel over the outer ocean, placed afresh with the board.
    this.gulls.layout(outerOcean(state, view), this.style.gulls, [1.5, 3]);
    // The old patterns' textures only once nothing is filled with them any more.
    if (old !== null) for (const p of [old.sea, old.land]) p.texture.destroy(true);
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as smooth tiles laid over the studs: each tile bevelled, lit on its north
   * and west edges and shaded on its south and east, its shade shifted a little from its
   * neighbours', and now and then one printed with a grille or an arrow in the owner's
   * colour — so it reads as a floor of tiles, not as tinted grass, and never as a wall,
   * which is studded and stands up.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const gap = Math.max(1, t * 0.06);
    const bevel = Math.max(1, t * 0.08);
    const { territoryAlpha, tileShift, printedTileOdds, sheenAlpha } = this.style;
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const light = this.colour(player, 'light');
      const base = this.colour(player, 'base');
      // Two shades, by a hash of the tile, so the floor is laid of separate tiles.
      for (const shade of [0, 1]) {
        for (const { x, y } of cells) {
          if ((hash(x, y, 4517) < 0.4 ? 1 : 0) !== shade) continue;
          g.rect(tileX(view, x) + gap / 2, tileY(view, y) + gap / 2, t - gap, t - gap);
        }
        g.fill({
          color: shade === 0 ? light : mixed(light, base, tileShift),
          alpha: territoryAlpha,
        });
      }
      // The bevel: a lit edge to the north-west, a shaded one to the south-east.
      const lo = gap / 2 + bevel / 2;
      const hi = t - gap / 2 - bevel / 2;
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        g.moveTo(px + lo, py + hi)
          .lineTo(px + lo, py + lo)
          .lineTo(px + hi, py + lo);
      }
      g.stroke({ width: bevel, color: 0xffffff, alpha: sheenAlpha });
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        g.moveTo(px + hi, py + lo)
          .lineTo(px + hi, py + hi)
          .lineTo(px + lo, py + hi);
      }
      g.stroke({ width: bevel, color: 0x000000, alpha: 0.2 });
      // Printed tiles, in the owner's own colour on the light: a grille of three slots, or an
      // arrow pointing one of four ways. Chevrons, not a ring or a cross, which say target.
      let printed = 0;
      for (const { x, y } of cells) {
        if (hash(x, y, 2203) >= printedTileOdds) continue;
        printed++;
        const cx = tileX(view, x + 0.5);
        const cy = tileY(view, y + 0.5);
        const kind = hash(x, y, 811);
        if (kind < 0.5) {
          for (const dy of [-0.2, 0, 0.2]) {
            g.roundRect(cx - t * 0.24, cy + dy * t - t * 0.05, t * 0.48, t * 0.1, t * 0.05);
          }
        } else {
          const turn = Math.floor(kind * 8) % 4;
          const c = [1, 0, -1, 0][turn] as number;
          const s = [0, 1, 0, -1][turn] as number;
          const at = (u: number, v: number): [number, number] => [
            cx + (u * c - v * s) * t,
            cy + (u * s + v * c) * t,
          ];
          g.poly([
            ...at(0.26, 0),
            ...at(0, -0.24),
            ...at(0, -0.1),
            ...at(-0.24, -0.1),
            ...at(-0.24, 0.1),
            ...at(0, 0.1),
            ...at(0, 0.24),
          ]);
        }
      }
      // Only with something printed: a fill straight after a stroke fills the stroke's path.
      if (printed > 0) g.fill({ color: base, alpha: 0.85 });
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
      this.drawBricks(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's wall: grey bricks lying loose, askew, no studs up.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const jitter = ((x * 7 + y * 13) % 5) / 5;
      g.rect(tileX(view, x + 0.1 + jitter * 0.1), tileY(view, y + 0.3), t * 0.7, t * 0.45);
    }
    g.fill({ color: hex(palette.rockMid) });

    // Castles: a tower built of bricks; a player's main castle a little grander.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const main = state.players[owner]?.startingCastleId === castle.id;
      this.drawCastle(g, view, castle, owner, main);
    }

    // Guns stand on a grey plate filling their square, which says what a gun takes up while
    // building (`cannonBase`'s reason); the cannon on it, carriage, wheels and barrel, turns
    // with its aim and is drawn with the barrel (`drawGuns`). A silenced gun's plate is dark.
    for (const cannon of state.cannons) {
      const x = tileX(view, cannon.x);
      const y = tileY(view, cannon.y);
      const w = cannon.w * t;
      const h = cannon.h * t;
      const inset = t * 0.08;
      const face = this.faceFraction() * t * 0.6;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2 - face);
      g.fill({ color: hex(cannon.active ? palette.rockMid : palette.rockDark) });
      g.rect(x + inset, y + h - inset - face, w - inset * 2, face);
      g.fill({ color: hex(cannon.active ? palette.rockDark : palette.craterDark) });
      // A band in the owner's colour along its edge, so whose gun it is reads at a glance.
      g.rect(x + inset, y + h - inset - face, w - inset * 2, Math.max(1, face * 0.45));
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      g.stroke({ width: 1, color: hex(palette.craterDark), alpha: 0.5 });
      for (const [sx, sy] of [
        [0.3, 0.3],
        [cannon.w - 0.3, 0.3],
        [0.3, cannon.h - 0.4],
        [cannon.w - 0.3, cannon.h - 0.4],
      ] as const) {
        this.stud(
          g,
          x + sx * t,
          y + sy * t,
          t * 0.75,
          hex(cannon.active ? palette.rockLight : palette.rockDark),
        );
      }
    }
  }

  /**
   * A castle as a tower built of toy bricks, standing on its 2x2 square: a broad lower
   * storey coursed in bricks with an arched dark doorway, a ledge on it carrying studs, a
   * narrower upper storey with a clear window brick, and along its top a row of 1x1
   * crenellation bricks, each with its stud. A main castle is a little grander: its upper
   * storey wider and taller, a round turret brick at each end of the ledge, four merlons. The
   * flag panel on top is an effect, hoisted and lowered (`drawFlags`).
   */
  private drawCastle(
    g: Graphics,
    view: ViewTransform,
    castle: { x: number; y: number; w: number; h: number },
    owner: number,
    main: boolean,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const base = this.colour(owner, 'base');
    const light = this.colour(owner, 'light');
    const dark = this.colour(owner, 'dark');
    const seam = { width: 1, color: 0x000000, alpha: 0.28 };
    const x = tileX(view, castle.x);
    const y = tileY(view, castle.y);
    const w = castle.w * t;
    const h = castle.h * t;
    const left = x + t * 0.1;
    const right = x + w - t * 0.1;
    const foot = y + h - t * 0.08;

    // Its shadow on the ground.
    g.rect(left + t * 0.06, foot - t * 0.02, right - left, t * 0.1);
    g.fill({ color: 0x000000, alpha: 0.25 });

    // The lower storey's face, its right side in shade, coursed in staggered bricks.
    const lowTop = y + h * 0.5;
    const side = t * 0.16;
    g.rect(left, lowTop, right - left, foot - lowTop);
    g.fill({ color: base });
    g.rect(right - side, lowTop, side, foot - lowTop);
    g.fill({ color: dark });
    const courses = 3;
    const course = (foot - lowTop) / courses;
    for (let k = 1; k < courses; k++) {
      g.moveTo(left, lowTop + course * k).lineTo(right, lowTop + course * k);
    }
    for (let k = 0; k < courses; k++) {
      const shift = k % 2 === 0 ? 0 : t * 0.25;
      for (let bx = left + shift + t * 0.5; bx < right - t * 0.1; bx += t * 0.5) {
        g.moveTo(bx, lowTop + course * k).lineTo(bx, lowTop + course * (k + 1));
      }
    }
    g.rect(left, lowTop, right - left, foot - lowTop);
    g.stroke(seam);
    // The doorway, an arch of dark under a lighter keystone course.
    const doorW = t * 0.46;
    const doorH = (foot - lowTop) * 0.78;
    const dx = x + w / 2 - doorW / 2 - side / 2;
    g.rect(dx, foot - doorH + doorW / 2, doorW, doorH - doorW / 2);
    g.circle(dx + doorW / 2, foot - doorH + doorW / 2, doorW / 2);
    g.fill({ color: hex(palette.shadow) });
    const archR = doorW / 2 + t * 0.04;
    g.moveTo(dx + doorW / 2 - archR, foot - doorH + doorW / 2);
    g.arc(dx + doorW / 2, foot - doorH + doorW / 2, archR, Math.PI, Math.PI * 2);
    g.stroke({ width: Math.max(1, t * 0.06), color: light });

    // The ledge on the lower storey, seen from above, its studs either side of the upper.
    const ledge = t * 0.26;
    g.rect(left, lowTop - ledge, right - left, ledge);
    g.fill({ color: mixed(base, light, 0.35) });
    g.rect(left, lowTop - ledge, right - left, ledge);
    g.stroke(seam);

    // The upper storey, narrower (wider for a main castle), with its window brick.
    const upInset = main ? t * 0.36 : t * 0.5;
    const ul = left + upInset;
    const ur = right - upInset;
    const upTop = y + (main ? t * 0.2 : t * 0.36);
    const upFoot = lowTop - ledge * 0.4;
    g.rect(ul, upTop, ur - ul, upFoot - upTop);
    g.fill({ color: base });
    g.rect(ur - side * 0.8, upTop, side * 0.8, upFoot - upTop);
    g.fill({ color: dark });
    g.rect(ul, upTop, ur - ul, upFoot - upTop);
    g.stroke(seam);
    // A clear window brick: the sky through it, a frame and a glint across the glass.
    const win = Math.min(ur - ul, upFoot - upTop) * 0.5;
    const wx = (ul + ur) / 2 - win / 2 - side * 0.3;
    const wy = upTop + (upFoot - upTop) * 0.48 - win / 2;
    g.rect(wx, wy, win, win);
    g.fill({ color: hex(palette.waterFoam), alpha: 0.75 });
    g.stroke({ width: Math.max(1, t * 0.05), color: dark });
    g.moveTo(wx + win * 0.25, wy + win * 0.8).lineTo(wx + win * 0.75, wy + win * 0.2);
    g.stroke({ width: Math.max(1, t * 0.05), color: 0xffffff, alpha: 0.8 });

    // The ledge's studs, or on a main castle a round turret brick at each end.
    for (const cx of [(left + ul) / 2, (ur + right) / 2]) {
      const cy = lowTop - ledge / 2;
      if (main) {
        const r = t * 0.17;
        g.rect(cx - r, cy - t * 0.42, r * 2, t * 0.42);
        g.fill({ color: base });
        g.rect(cx + r * 0.4, cy - t * 0.42, r * 0.6, t * 0.42);
        g.fill({ color: dark });
        g.ellipse(cx, cy, r, r * 0.45);
        g.fill({ color: base });
        g.ellipse(cx, cy - t * 0.42, r, r * 0.45);
        g.fill({ color: light });
        g.stroke(seam);
        this.stud(g, cx, cy - t * 0.45, t * 0.8, light);
      } else {
        this.stud(g, cx, cy - t * 0.02, t * 0.8, light);
      }
    }

    // The crenellations: a row of 1x1 bricks along the top, each carrying its stud.
    const merlons = main ? 4 : 3;
    const pitch = (ur - ul) / merlons;
    const mw = pitch * 0.72;
    const mh = t * 0.2;
    for (let k = 0; k < merlons; k++) {
      const mx = ul + pitch * k + (pitch - mw) / 2;
      g.rect(mx, upTop - mh, mw, mh);
    }
    g.fill({ color: base });
    for (let k = 0; k < merlons; k++) {
      const mx = ul + pitch * k + (pitch - mw) / 2;
      g.rect(mx, upTop - mh, mw, mh);
    }
    g.stroke(seam);
    for (let k = 0; k < merlons; k++) {
      this.stud(g, ul + pitch * (k + 0.5), upTop - mh * 0.55, Math.min(t, mw * 2.2), light);
    }
  }

  /**
   * Bricks in the owner's colour, standing up as the pixel style's walls do: a top with a
   * stud and a lit edge, a darker front face, and the seams between bricks.
   */
  private drawBricks(
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
    g.fill({ color: this.colour(player, 'base'), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha });
    // Seams: every brick is its own, so a shot visibly takes one.
    for (const b of wall.blocks) {
      g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
    }
    g.stroke({ width: 1, color: 0x000000, alpha: 0.28 * alpha });
    // The plastic's sheen along each top's lit edges.
    for (const b of wall.blocks) {
      g.moveTo(b.left + 1, b.lip - 1)
        .lineTo(b.left + 1, b.top + 1)
        .lineTo(b.left + t - 1, b.top + 1);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: this.style.sheenAlpha * alpha });
    for (const b of wall.blocks) {
      // In the lighter shade, so every brick visibly carries its stud.
      this.stud(
        g,
        b.left + t / 2,
        b.top + (b.lip - b.top) / 2,
        t,
        this.colour(player, 'light'),
        alpha,
      );
    }
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
    if (inSea) this.splashes.push({ x, y, age: 0 });
    // A hit knocks the brick apart: its halves and a stud or two fly off and bounce away.
    for (const block of debris) {
      for (let k = 0; k < 5; k++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const speed = 2 + Math.random() * 2.5;
        this.loose.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          spin: Math.random() * Math.PI,
          age: 0,
          colour: this.colour(block.owner, k === 0 ? 'light' : 'base'),
          life: this.art.generators.fx.debrisMs,
          floor: block.y + 0.9,
        });
      }
    }
  }

  /** The sweep: a loose brick pops up off the wall and falls away. */
  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(block.owner, 'base');
    this.loose.push({
      x: block.x + 0.5,
      y: block.y + 0.5,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -3,
      spin: 0,
      age: 0,
      colour,
      life: this.art.flat.crumbleMs,
      floor: block.y + 0.9,
    });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    this.clicks.push({ cells, age: 0 });
  }

  /**
   * A crane built of bricks on a barge in the corner: a studded grey barge, a white cab on
   * its turntable, a dark lattice jib swinging round — shorter as it turns toward or away
   * from the viewer — and a brick on its hook, lowered to the deck and lifted again twice a
   * swing. In white, grey and black: a crane's yellow would be the amber player's. Its
   * hazard light strobes white in overtime. Still, mid-swing, when motion is reduced.
   */
  private drawCrane(state: MatchState, view: ViewTransform, spot: TimerSpot): void {
    const g = this.craneGfx;
    const { palette } = this.art;
    // A third larger than its square, which a crane's open lattice does not fill.
    const s = spot.size * view.tile * 1.35;
    const still = motionReduced();
    const edge = { width: Math.max(1, s * 0.012), color: hex(palette.shadow), alpha: 0.6 };
    const phase = still ? 0.15 : (this.clock / this.style.craneSwingMs) % 1;
    const bob = still ? 0 : Math.sin(this.clock / 900) * s * 0.008;
    const cx = tileX(view, spot.x);
    const water = tileY(view, spot.y) + s * 0.28;
    const deck = water - s * 0.1 + bob;
    const studs = (x0: number, y: number, n: number, pitch: number, colour: number): void => {
      for (let k = 0; k < n; k++) this.stud(g, x0 + (k + 0.5) * pitch, y, pitch * 1.6, colour);
    };

    // The barge: a long flat brick with its studs, foam along its waterline.
    const bargeW = s * 0.9;
    const bx = cx - bargeW / 2;
    g.rect(bx, deck, bargeW, s * 0.12);
    g.fill({ color: hex(palette.rockMid) });
    g.stroke(edge);
    studs(bx, deck - s * 0.012, 8, bargeW / 8, hex(palette.rockMid));
    for (let k = 0; k < 6; k++)
      g.circle(bx + (k + 0.5) * (bargeW / 6), water + s * 0.02, s * 0.025);
    g.fill({ color: hex(palette.waterFoam), alpha: 0.7 });

    // The cab on its turntable, toward the barge's stern, a window in it.
    const cabX = bx + bargeW * 0.12;
    const cabW = s * 0.24;
    const cabTop = deck - s * 0.22;
    g.rect(cabX - s * 0.01, deck - s * 0.035, cabW + s * 0.02, s * 0.035);
    g.fill({ color: hex(palette.rockDark) });
    g.rect(cabX, cabTop, cabW, s * 0.19);
    g.fill({ color: hex(palette.uiInk) });
    g.stroke(edge);
    g.rect(cabX + cabW * 0.55, cabTop + s * 0.035, cabW * 0.32, s * 0.07);
    g.fill({ color: hex(palette.waterShallow) });
    studs(cabX, cabTop - s * 0.01, 3, cabW / 3, hex(palette.uiInk));

    // The jib: from the cab's top, luffed up, swinging about the upright — so its reach
    // across the picture is the cosine of the swing.
    const swing = Math.sin(phase * Math.PI * 2) * 0.95;
    const reach = s * 0.62 * Math.cos(swing) + s * 0.08;
    const pivot = { x: cabX + cabW * 0.7, y: cabTop - s * 0.02 };
    const luff = 0.62;
    const tip = { x: pivot.x + reach * Math.cos(luff), y: pivot.y - s * 0.62 * Math.sin(luff) };
    const nx = -(tip.y - pivot.y);
    const ny = tip.x - pivot.x;
    const nl = Math.hypot(nx, ny) || 1;
    const half = s * 0.025;
    const ox = (nx / nl) * half;
    const oy = (ny / nl) * half;
    g.moveTo(pivot.x + ox, pivot.y + oy).lineTo(tip.x + ox, tip.y + oy);
    g.moveTo(pivot.x - ox, pivot.y - oy).lineTo(tip.x - ox, tip.y - oy);
    const bays = 6;
    for (let k = 0; k < bays; k++) {
      const a = k / bays;
      const b = (k + 1) / bays;
      const side = k % 2 === 0 ? 1 : -1;
      g.moveTo(
        pivot.x + (tip.x - pivot.x) * a + ox * side,
        pivot.y + (tip.y - pivot.y) * a + oy * side,
      ).lineTo(
        pivot.x + (tip.x - pivot.x) * b - ox * side,
        pivot.y + (tip.y - pivot.y) * b - oy * side,
      );
    }
    g.stroke({ width: Math.max(1, s * 0.016), color: hex(palette.rockDark) });

    // The hook's cable, paying out to the deck and back twice a swing, and the brick on it.
    const drop = 0.5 - 0.5 * Math.cos(phase * Math.PI * 4);
    const hookY = tip.y + s * 0.08 + (deck - s * 0.1 - tip.y - s * 0.08) * drop;
    g.moveTo(tip.x, tip.y).lineTo(tip.x, hookY);
    g.stroke({ width: 1, color: hex(palette.rockDark) });
    g.rect(tip.x - s * 0.07, hookY, s * 0.14, s * 0.07);
    g.fill({ color: hex(palette.rockLight) });
    g.stroke(edge);
    studs(tip.x - s * 0.07, hookY - s * 0.006, 2, s * 0.07, hex(palette.rockLight));

    // The hazard light on the cab, strobing white in overtime.
    const strobe =
      state.phase === 'build' &&
      state.overtime &&
      (still || Math.floor(this.clock / 180) % 3 === 0);
    g.circle(cabX + cabW * 0.25, cabTop - s * 0.04, s * 0.022);
    g.fill({ color: strobe ? 0xffffff : hex(palette.rockMid) });
    if (strobe) {
      g.circle(cabX + cabW * 0.25, cabTop - s * 0.04, s * 0.07);
      g.fill({ color: 0xffffff, alpha: 0.35 });
    }
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();
    this.lateGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    this.clock += frame.deltaMs;
    this.craneGfx.clear();
    if (this.crane !== null) this.drawCrane(state, view, this.crane);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.drawClicks(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawGuns(state, view, frame.deltaMs);
    this.drawFlags(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawSplashes(view, frame.deltaMs);
    this.drawLoose(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.stamps.begin();
    this.drawPops(state, view, frame);
    this.drawGulls(view, frame.deltaMs);
    this.stamps.end();
  }

  /** A piece clicking down: a flash off its studs, as plastic snapping home catches light. */
  private drawClicks(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const r = (t * this.style.studScale) / 2;
    for (const click of this.clicks) {
      click.age += deltaMs;
      const k = click.age / CLICK_MS;
      if (k >= 1) continue;
      for (const c of click.cells) {
        g.circle(tileX(view, c.x + 0.5), tileY(view, c.y + 0.35), r * (1 + 0.8 * k));
      }
      g.stroke({ width: Math.max(1, t * 0.08), color: 0xffffff, alpha: 0.8 * (1 - k) });
    }
    this.clicks = this.clicks.filter((c) => c.age < CLICK_MS);
  }

  /**
   * The guns as toy cannon, turning with their aim: a grey bracket brick on two black round
   * wheel plates, a round barrel brick in the owner's colour, banded where its bricks join,
   * kicking back on a shot, with a round plate at the muzzle in the owner's dark (a white ball
   * there read as a shot leaving the gun, S1). A silenced gun's barrel lies lowered, short and
   * dark, its muzzle dropped to the ground, so it reads at a glance at eight players.
   */
  private drawGuns(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const { palette } = this.art;
    const memo = this.gunMemo;
    memo.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      // Still between shots: drawn again only as it turns and kicks.
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.w},${cannon.h},${cannon.owner},${cannon.active}|${aim.angle}|${aim.firedAgo < RECOIL_MS ? aim.firedAgo : '-'}`;
      memo.draw(cannon.id, key, (g) => {
        const live = cannon.active;
        const kick = live ? Math.max(0, 1 - aim.firedAgo / RECOIL_MS) : 0;
        const cx = tileX(view, cannon.x + cannon.w / 2);
        const cy = tileY(view, cannon.y + cannon.h / 2 - this.faceFraction() * 0.3);
        const fx = Math.sin(aim.angle);
        const fy = -Math.cos(aim.angle);
        // A point `u` tiles along the barrel and `v` across it.
        const at = (u: number, v: number): [number, number] => [
          cx + (u * fx - v * fy) * t,
          cy + (u * fy + v * fx) * t,
        ];
        const back = -0.12 * kick;
        const edge = { width: Math.max(1, t * 0.05), color: hex(palette.craterDark) };

        // The wheel plates, either side of the carriage, a grey hub stud in each.
        for (const v of [-0.4, 0.4]) {
          const [wx, wy] = at(-0.15 + back, v);
          g.circle(wx, wy, t * 0.24);
          g.fill({ color: 0x1b1d22 });
          g.circle(wx, wy, t * 0.09);
          g.fill({ color: hex(live ? palette.rockMid : palette.rockDark) });
        }
        // The bracket brick the barrel rests in.
        g.poly([
          ...at(-0.48 + back, -0.3),
          ...at(0.12 + back, -0.3),
          ...at(0.12 + back, 0.3),
          ...at(-0.48 + back, 0.3),
        ]);
        g.fill({ color: hex(live ? palette.rockLight : palette.craterDark) });
        g.stroke(edge);

        const width = Math.max(3, t * 0.36);
        if (live) {
          const length = 0.95 - 0.28 * kick;
          const [bx, by] = at(-0.3 + back, 0);
          const [ex, ey] = at(length, 0);
          g.moveTo(bx, by).lineTo(ex, ey);
          g.stroke({ width: width + 2, color: this.colour(cannon.owner, 'dark'), cap: 'round' });
          g.moveTo(bx, by).lineTo(ex, ey);
          g.stroke({ width, color: this.colour(cannon.owner, 'base'), cap: 'round' });
          // Its sheen, and the bands where the round bricks of the barrel join.
          g.moveTo(...at(-0.2 + back, -0.08)).lineTo(...at(length - 0.1, -0.08));
          g.stroke({ width: Math.max(1, t * 0.06), color: this.colour(cannon.owner, 'light') });
          for (const u of [0.15, 0.5]) {
            g.moveTo(...at(u - 0.28 * kick, -0.18)).lineTo(...at(u - 0.28 * kick, 0.18));
          }
          g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(cannon.owner, 'dark') });
          g.circle(ex, ey, width * 0.58);
          g.fill({ color: this.colour(cannon.owner, 'dark') });
          g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.craterDark), alpha: 0.6 });
        } else {
          // Lowered: short, the muzzle tipped down toward the ground.
          const [bx, by] = at(-0.2, 0);
          const [mx, my] = at(0.3, 0);
          const ey = my + t * 0.22;
          g.moveTo(bx, by).lineTo(mx, ey);
          g.stroke({ width, color: hex(palette.craterDark), cap: 'round' });
          g.circle(mx, ey, width * 0.5);
          g.fill({ color: hex(palette.rockDark) });
          g.stroke(edge);
        }
      });
    }
    memo.end();
    this.aims.prune(state);
  }

  /**
   * A hinged flag panel over each sealed castle, on a short bar on its top: hoisted on
   * sealing, swinging out on its hinge as it rises; lowered by a breach, darkening and hanging
   * down off its hinge as it drops. Memoised a castle, so a flag still is not redrawn.
   */
  private drawFlags(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const { palette } = this.art;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    const memo = this.flagMemo;
    memo.begin();
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const main = state.players[owner]?.startingCastleId === castle.id;
      const lowering = this.flags.lowering(castle.id);
      const key = `${viewKey(view)}|${castle.x},${castle.y}|${owner}|${main}|${raised.toFixed(3)}|${lowering}`;
      memo.draw(castle.id, key, (g) => {
        const pole = tileX(view, castle.x + castle.w / 2) - t * 0.08;
        const base = tileY(view, castle.y) + t * (main ? 0.02 : 0.18);
        const top = base - t * 0.95;
        // The bar, grey, a stud on its tip.
        g.rect(pole - t * 0.05, top, t * 0.1, base - top);
        g.fill({ color: hex(palette.rockLight) });
        g.stroke({ width: 1, color: hex(palette.craterDark), alpha: 0.6 });
        this.stud(g, pole, top, t * 0.5, hex(palette.rockLight));
        // The panel on its hinge: out level when up, hanging down the bar when down.
        const len = t * 0.72;
        const deep = t * 0.46;
        const hingeY = base - deep - raised * (base - top - deep - t * 0.05);
        const swing = (1 - raised) * 1.25;
        const c = Math.cos(swing);
        const s = Math.sin(swing);
        const at = (u: number, v: number): [number, number] => [
          pole + t * 0.05 + u * c - v * s,
          hingeY + u * s + v * c,
        ];
        g.poly([...at(0, 0), ...at(len, 0), ...at(len, deep), ...at(0, deep)]);
        g.fill({ color: this.colour(owner, lowering ? 'dark' : 'light') });
        g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(owner, 'dark') });
        // A stripe printed across it, and the hinge's two clips on the bar.
        g.poly([
          ...at(0, deep * 0.38),
          ...at(len, deep * 0.38),
          ...at(len, deep * 0.62),
          ...at(0, deep * 0.62),
        ]);
        g.fill({ color: this.colour(owner, 'base'), alpha: 0.8 });
        for (const v of [0.12, 0.72]) {
          g.rect(pole - t * 0.08, hingeY + deep * v - t * 0.04, t * 0.16, t * 0.1);
        }
        g.fill({ color: hex(palette.rockMid) });
      });
    }
    memo.end();
  }

  /**
   * Studs popping off a castle as it seals, flying up and falling away with a twinkle of
   * light among them, stamped (`Stamps`). Only on a castle seen to change from open to
   * sealed, never for every castle sealed as a look first draws.
   */
  private drawPops(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const before = this.sealedBefore;
    this.sealedBefore = frame.castleSealed;
    const t = view.tile;
    const { studPopMs, studPops } = this.style;
    if (before !== null && !motionReduced()) {
      for (const castle of state.castles) {
        if (before[castle.id] !== false || frame.castleSealed[castle.id] !== true) continue;
        for (let k = 0; k < studPops; k++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          const speed = 2.4 + Math.random() * 2.2;
          this.pops.push({
            x: castle.x + castle.w / 2 + (Math.random() - 0.5) * 0.8,
            y: castle.y + 0.4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: -Math.random() * 120,
            colour: this.colour(castle.islandId - 1, k % 3 === 0 ? 'base' : 'light'),
            spark: k % 4 === 3,
          });
        }
      }
    }
    const stud = this.book.get('stud', t, (g) => {
      const r = (t * this.style.studScale) / 2;
      g.circle(0, r * 0.25, r);
      g.fill({ color: 0x000000, alpha: 0.3 });
      g.circle(0, 0, r);
      g.fill({ color: 0xffffff });
      g.circle(-r * 0.3, -r * 0.3, r * 0.3);
      g.fill({ color: 0xffffff });
    });
    const spark = this.book.get('spark', t, (g) => {
      const r = t * 0.32;
      g.poly([
        0,
        -r,
        r * 0.18,
        -r * 0.18,
        r,
        0,
        r * 0.18,
        r * 0.18,
        0,
        r,
        -r * 0.18,
        r * 0.18,
        -r,
        0,
        -r * 0.18,
        -r * 0.18,
      ]);
      g.fill({ color: 0xffffff });
    });
    const dt = frame.deltaMs / 1000;
    for (const p of this.pops) {
      p.age += frame.deltaMs;
      if (p.age < 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 9 * dt;
      const k = p.age / studPopMs;
      if (k >= 1) continue;
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (p.spark) {
        this.stamps.place(spark, tileX(view, p.x), tileY(view, p.y), {
          scale: 0.6 + 0.6 * Math.sin(Math.PI * k),
          rotation: k * 2,
          alpha: fade,
        });
      } else {
        this.stamps.place(stud, tileX(view, p.x), tileY(view, p.y), {
          tint: p.colour,
          alpha: fade,
          scale: 1.4,
        });
      }
    }
    this.pops = this.pops.filter((p) => p.age < studPopMs);
  }

  /**
   * Gulls of bricks wheeling over the outer ocean, seen from above: a white body brick, grey
   * wing slopes beating now and then between glides, a yellow beak, and a shadow on the sea
   * below. Stamped: a wing position a stamp, only placed and turned each frame.
   */
  private drawGulls(view: ViewTransform, deltaMs: number): void {
    if (motionReduced()) return;
    this.gulls.step(deltaMs);
    const { palette } = this.art;
    // Never under eighteen pixels a unit, or at eight players a gull is a speck.
    const u = Math.max(view.tile, 18);
    // Seen from above, a gull is its wings: long, bent back at the wrist, black at the tips,
    // on a short white body — straight wings on a long body read as a toy aeroplane.
    const frames = [1, 0.7, 0.4].map((span, k) =>
      this.book.get(`gull${k}|${u}`, view.tile, (g) => {
        const edge = { width: Math.max(1, u * 0.035), color: hex(palette.shadow), alpha: 0.6 };
        for (const side of [-1, 1]) {
          const v = (n: number): number => side * u * n * span;
          g.poly([
            u * 0.08,
            v(0.08),
            u * 0.16,
            v(0.36),
            -u * 0.1,
            v(0.72),
            -u * 0.2,
            v(0.7),
            -u * 0.04,
            v(0.36),
            -u * 0.1,
            v(0.08),
          ]);
          g.fill({ color: hex(palette.rockLight) });
          g.stroke(edge);
          g.poly([-u * 0.03, v(0.58), -u * 0.1, v(0.72), -u * 0.2, v(0.7), -u * 0.1, v(0.56)]);
          g.fill({ color: hex(palette.craterDark) });
        }
        g.roundRect(-u * 0.24, -u * 0.08, u * 0.46, u * 0.16, u * 0.08);
        g.fill({ color: 0xffffff });
        g.stroke(edge);
        g.poly([u * 0.22, -u * 0.03, u * 0.32, 0, u * 0.22, u * 0.03]);
        g.fill({ color: hex(palette.uiAccent) });
      }),
    );
    const shadow = this.book.get(`gullShadow|${u}`, view.tile, (g) => {
      g.ellipse(0, 0, u * 0.22, u * 0.1);
      g.fill({ color: 0x000000, alpha: 0.15 });
    });
    for (const [k, gull] of this.gulls.items.entries()) {
      const p = Circling.at(gull);
      if (behindCorner(this.crane, p.x, p.y)) continue;
      const dx = -Math.sin(gull.angle) * Math.sign(gull.speed);
      const dy = Math.cos(gull.angle) * 0.6 * Math.sign(gull.speed);
      const heading = Math.atan2(dy, dx);
      // Beats its wings for a second now and then, and glides between.
      const beat = Math.sin(this.clock / 90 + k * 2);
      const flapping = Math.sin(this.clock / 1700 + k * 3) > 0.3;
      const wing = flapping ? (beat > 0.3 ? 0 : beat < -0.3 ? 2 : 1) : 0;
      const x = tileX(view, p.x);
      const y = tileY(view, p.y);
      this.stamps.place(shadow, x + u * 0.5, y + u * 0.9, { rotation: heading });
      this.stamps.place(frames[wing] as GraphicsContext, x, y, { rotation: heading });
    }
  }

  /** Shots: a round brick lobbed, growing toward the top of its arc over a shadow. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / 3);
      g.ellipse(gx, gy, t * (0.28 - 0.12 * high), t * (0.14 - 0.06 * high));
      g.fill({ color: 0x000000, alpha: 0.3 - 0.15 * high });
      const hy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5 - lift);
      const r = t * (0.26 + 0.12 * high);
      g.circle(gx, hy, r);
      g.fill({ color: this.colour(shot.owner, 'base') });
      g.stroke({ width: 1, color: this.colour(shot.owner, 'dark') });
      this.stud(g, gx, hy - r * 0.15, r * 1.9, this.colour(shot.owner, 'light'));
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.circle(cx, cy, t * (0.25 + 1.2 * k));
      g.circle(cx, cy, t * (0.1 + 0.6 * k));
      g.stroke({ width: 2, color: hex(this.art.palette.waterFoam), alpha: 1 - k });
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /** Loose bricks: small blocks tumbling, bouncing once off the ground, then gone. */
  private drawLoose(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.loose) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 12 * dt;
      b.spin += dt * 7;
      if (b.y > b.floor && b.vy > 0) {
        b.y = b.floor;
        b.vy *= -0.35;
        b.vx *= 0.6;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      const w = t * 0.34;
      const h = t * 0.22;
      const c = Math.cos(b.spin);
      const s = Math.sin(b.spin);
      const corner = (dx: number, dy: number): [number, number] => [
        x + dx * c - dy * s,
        y + dx * s + dy * c,
      ];
      g.poly([
        ...corner(-w / 2, -h / 2),
        ...corner(w / 2, -h / 2),
        ...corner(w / 2, h / 2),
        ...corner(-w / 2, h / 2),
      ]);
      g.fill({ color: b.colour, alpha });
    }
    this.loose = this.loose.filter((b) => b.age < b.life);
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
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      if (ghost.valid) {
        // The piece in hand as the bricks it will be, a little see-through.
        const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
        this.drawBricks(g, view, cells, (x, y) => inPiece.has(`${x},${y}`), humanPlayer, 0.7);
        return;
      }
      // Where it does not fit: hollow, a red outline and a cross in each cell — a red
      // brick would be the crimson player's own colour, so the difference is in form.
      trace(
        g,
        outline(cells, (x, y) => cells.some((c) => c.x === x && c.y === y), view),
      );
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        g.moveTo(px + t * 0.25, py + t * 0.25).lineTo(px + t * 0.75, py + t * 0.75);
        g.moveTo(px + t * 0.25, py + t * 0.75).lineTo(px + t * 0.75, py + t * 0.25);
      }
      g.stroke({ width: Math.max(1.5, t * 0.1), color: hex(palette.uiInvalid) });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      const inset = t * 0.18;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        // Struck through: red alone would vanish on the crimson player's own bricks.
        g.moveTo(x + inset, y + h - inset).lineTo(x + w - inset, y + inset);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * A baseplate's studs as a repeating pattern, `period` tiles square with a stud on its
 * diagonal (every tile for 1, every other for 2), drawn once on a small canvas for the tile
 * size and laid into the plate as a fill (`FillPattern`) lined up with the board. A canvas
 * draws a stud round at any size, with its shade and its lit rim; circles of a few pixels
 * drawn as shapes came out as diamonds at board scale (the style review).
 */
function studPattern(
  view: ViewTransform,
  period: number,
  colour: string,
  studScale: number,
): FillPattern {
  const t = view.tile;
  const size = Math.max(4, Math.round(t * period));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const u = size / period;
  const r = (u * studScale) / 2;
  if (ctx !== null) {
    for (let k = 0; k < period; k++) {
      const cx = (k + 0.5) * u;
      const cy = (k + 0.5) * u;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(cx + r * 0.1, cy + r * 0.3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.62, Math.PI * 1.02, Math.PI * 1.62);
      ctx.stroke();
    }
  }
  const pattern = new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
  const k = (t * period) / size;
  pattern.setTransform(new Matrix().scale(k, k).translate(view.originX, view.originY));
  return pattern;
}

/**
 * Toy bricks' scenery, built of bricks too: a tree a brown stud trunk under stacked round
 * plates of green, a pine a stepped cone of plates, a bush a round green plate — or, one
 * in two, a flower, a round plate of red or yellow — and a boulder a grey sloped brick.
 */
function drawBrickScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.rect(cx - t * 0.08, cy, t * 0.16, t * 0.3);
      g.fill({ color: 0x7a4a22 });
      for (const [dy, r] of [
        [0.02, 0.36],
        [-0.16, 0.26],
      ] as const) {
        g.circle(cx, cy + dy * t + t * 0.05, r * t);
        g.fill({ color: 0x000000, alpha: 0.2 });
        g.circle(cx, cy + dy * t, r * t);
        g.fill({ color: hex(palette.grassLight) });
      }
      g.circle(cx - t * 0.07, cy - t * 0.22, t * 0.06);
      g.fill({ color: 0xffffff, alpha: 0.5 });
    } else if (item.kind === 'pine') {
      for (const [dy, half] of [
        [0.15, 0.34],
        [-0.05, 0.25],
        [-0.25, 0.15],
      ] as const) {
        g.rect(cx - half * t, cy + dy * t, half * 2 * t, t * 0.18);
        g.fill({ color: hex(palette.grassDark) });
        g.rect(cx - half * t, cy + dy * t, half * 2 * t, t * 0.05);
        g.fill({ color: hex(palette.grassLight), alpha: 0.7 });
      }
    } else if (item.kind === 'bush') {
      const flower = item.variant % 2 === 1;
      const colour = flower
        ? item.variant % 4 === 1
          ? 0xe8403a
          : 0xffd23c
        : hex(palette.grassLight);
      g.circle(cx, cy + t * 0.04, t * 0.2);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.circle(cx, cy, t * 0.2);
      g.fill({ color: colour });
      g.circle(cx - t * 0.05, cy - t * 0.05, t * 0.06);
      g.fill({ color: 0xffffff, alpha: 0.55 });
    } else {
      // A sloped brick: its studs on the high side, the slope falling away to the south.
      g.rect(cx - t * 0.32, cy - t * 0.2, t * 0.64, t * 0.2);
      g.fill({ color: hex(palette.rockMid) });
      g.poly([
        cx - t * 0.32,
        cy,
        cx + t * 0.32,
        cy,
        cx + t * 0.32,
        cy + t * 0.26,
        cx - t * 0.32,
        cy + t * 0.26,
      ]);
      g.fill({ color: hex(palette.rockDark) });
      for (const dx of [-0.14, 0.14]) {
        g.circle(cx + dx * t, cy - t * 0.12, t * 0.08);
      }
      g.fill({ color: hex(palette.rockLight) });
    }
  }
}
