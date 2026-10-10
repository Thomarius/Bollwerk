import type { ArtConfig, CyberpunkStyleConfig } from '@bollwerk/config';
import { Rng, Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import {
  BlurFilter,
  Container,
  FillPattern,
  Graphics,
  Matrix,
  Texture,
  type GraphicsContext,
} from 'pixi.js';

import { bloomWanted, motionReduced } from '../motion.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';
import { bannerProgress } from '../transition.js';

import { cornerSpot } from './corner.js';

import { IslandParts } from './islandParts.js';
import { CyberpunkSeaLife } from './seaLife.js';
import { seaDepth } from './ocean.js';
import { trace, wallGeometry } from './walls.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
import { release } from './release.js';
import {
  FlagHoist,
  GhostMotion,
  GunAims,
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
  MainCastles,
  drawShotTarget,
  dimmed,
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
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';

/** A circuit trace on the sea floor, as tile centres in board coordinates. */
export interface Trace {
  points: readonly { x: number; y: number }[];
  /** Distance from land at each point, for the fade toward the islands. */
  depth: readonly number[];
  /** Length along the trace, in tiles. */
  length: number;
  /** Where its pulse starts, 0 to 1. */
  phase: number;
}

/** The eight directions, clockwise from north: even ones orthogonal, odd ones diagonal. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * Traces laid across the sea the way a circuit board routes them: straight runs, bends
 * of 45 degrees, never crossing another trace's tile, and kept off the water close to
 * land, so the islands sit in clear ground. `depth` is distance from land over an area
 * `w` by `h`, whose top left is board tile (-marginX, -marginY). Seeded, so a map always
 * carries the same board.
 */
export function circuitTraces(
  depth: Float32Array,
  w: number,
  h: number,
  marginX: number,
  marginY: number,
  count: number,
  rng: Rng,
): Trace[] {
  // Clear of the coast by more than a tile, so no trace runs into the surf line.
  const clear = 1.5;
  const used = new Uint8Array(w * h);
  const open = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && used[y * w + x] === 0 && depth[y * w + x]! >= clear;
  const traces: Trace[] = [];
  for (let attempt = 0; attempt < count * 4 && traces.length < count; attempt++) {
    let x = rng.nextInt(w);
    let y = rng.nextInt(h);
    if (!open(x, y)) continue;
    let dir = rng.nextInt(4) * 2;
    const steps = 4 + rng.nextInt(12);
    let run = 2 + rng.nextInt(4);
    const cells = [{ x, y }];
    used[y * w + x] = 1;
    let length = 0;
    for (let step = 0; step < steps; step++) {
      if (run === 0) {
        // Bend by 45 degrees; a diagonal straightens out again soon, as tracks do.
        dir = (dir + (rng.nextInt(2) === 0 ? 1 : 7)) % 8;
        run = dir % 2 === 1 ? 1 + rng.nextInt(2) : 2 + rng.nextInt(4);
      }
      const [dx, dy] = DIRS[dir]!;
      if (!open(x + dx, y + dy)) break;
      // A diagonal must not slip between two tiles of another trace crossing it.
      if (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy))) break;
      x += dx;
      y += dy;
      used[y * w + x] = 1;
      cells.push({ x, y });
      length += dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      run--;
    }
    if (cells.length < 3) {
      for (const cell of cells) used[cell.y * w + cell.x] = 0;
      continue;
    }
    traces.push({
      points: cells.map((c) => ({ x: c.x - marginX, y: c.y - marginY })),
      depth: cells.map((c) => depth[c.y * w + c.x]!),
      length,
      phase: rng.nextFloat(),
    });
  }
  return traces;
}

/** A point `distance` tiles along a trace. */
function along(trace: Trace, distance: number): { x: number; y: number } {
  let left = distance;
  for (let k = 1; k < trace.points.length; k++) {
    const a = trace.points[k - 1]!;
    const b = trace.points[k]!;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= span)
      return { x: a.x + ((b.x - a.x) * left) / span, y: a.y + ((b.y - a.y) * left) / span };
    left -= span;
  }
  return trace.points[trace.points.length - 1]!;
}

/** Where a shot came down, and what it hit, for the light and glitch it makes. */
interface Burst {
  x: number;
  y: number;
  age: number;
  colour: number;
  onWall: boolean;
}

/** A breached wall shorting out: sparks arcing from it, dying away. */
interface Short {
  x: number;
  y: number;
  age: number;
  seed: number;
  colour: number;
}

/** A spark, in tile coordinates. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colour: number;
  /** Whether it falls, as a spark from a breach does, or drifts, as one from a muzzle. */
  gravity: number;
}

/** A block the sweep took, flickering out. */
interface Fade {
  x: number;
  y: number;
  age: number;
  colour: number;
}

/** How long a recoil takes to come home. */
const RECOIL_MS = 160;

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'neon', flag: 'hologram' };

/**
 * The cyberpunk look: the board as a circuit at night, for building and for combat.
 *
 * Brightness means structure and colour means ownership, so the walls are the brightest
 * lines on the board, each in its owner's neon, with land a dark grid and the sea near
 * black, crossed by traces with pulses running along them, a city of low blocks along the
 * outer coasts. Castles are server towers whose sign and reactor ring light while sealed,
 * and which fly a hologram; guns are hex turrets whose coils charge between shots; sealed
 * ground is a lit floor of hexes; shots are plasma tracers; a breach shorts out in sparks
 * and puts a tower out; a silenced gun flickers as it powers down; a banner arriving
 * glitches the board for a moment.
 *
 * Drawn from shapes, like the flat style, into one Graphics per layer and a second one,
 * blended additively, for the glow: a wider shape under each bright line rather than a
 * bloom filter, which costs frame rate at eight players.
 */
export class CyberpunkTheme implements Theme {
  readonly id = 'cyberpunk' as const;

  private art!: ArtConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new CyberpunkSeaLife();
  private style!: CyberpunkStyleConfig;
  private readonly seed: number;

  private readonly terrainGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics` redrawn where it changes: the wash, its lit hex floor over it. */
  private readonly territory = new IslandParts(2, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawCyberpunkScenery(g, view, items, this.art),
    () => hex(this.art.palette.waterFoam),
  );
  /**
   * Walls, houses and guns, an island to a `Graphics` redrawn where they change, in two
   * layers: the glow under, added, and the lines over it.
   */
  private readonly structures = new IslandParts(2);
  private readonly effectGfx = new Graphics();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** Their glow, the same way: added, so where it lies among the glow does not matter. */
  private readonly gunGlow = new Memos();
  /**
   * The main castles' crowns, drawn again only as one changes: under the shots, and neither
   * added nor bloomed, as `lateGfx` they were drawn into first.
   */
  private readonly crowns = new MainCastles();
  /** What lies over the guns: shots, splashes, the finish. */
  private readonly lateGfx = new Graphics();
  private readonly effectGlow = new Graphics();
  /**
   * The bright cores the glow lies round — a shot's white-hot head, a castle's core, a
   * muzzle flash, sparks and arcs — added like the glow but never bloomed: under
   * "Glowing" the blur took them with it, and shots flew as smudges (PLAN 11.24).
   */
  private readonly effectCore = new Graphics();
  /**
   * What is lit while a tower is sealed — its sign, its reactor ring, the tips of its masts
   * — and the guns' coils as they charge, with the soft light round each: shapes drawn once
   * for the tile size in white and only placed, turned, tinted and faded each frame
   * (`Stamps`), since they change every frame and a `Graphics` redrawn would be cut into
   * triangles sixty times a second. Added and never bloomed: a blur of its own would be
   * another screen-sized texture (ARCHIVE 12r), and the soft discs are soft already.
   */
  private readonly lights = new Stamps();
  private readonly book = new StampBook();
  /** Each tower's light, and when it last changed, for the sputter as a breach puts it out. */
  private readonly lit = new Map<number, { sealed: boolean; since: number }>();
  /** The lit hex floor of sealed ground, by tile size and colour (`hexFloor`). */
  private readonly floors = new Map<string, FillPattern>();
  /** Floors of an older tile size, kept to the end: an island not yet redrawn may still use one. */
  private readonly oldFloors: FillPattern[] = [];
  private floorView = '';
  /** The city's holographic adverts, each a `Graphics` drawn with the terrain and only faded. */
  private readonly ads = new Container();
  /** Time since the last banner arrived, for the glitch it brings; infinite when none. */
  private glitchAge = Number.POSITIVE_INFINITY;
  private bannerShowing = false;
  /** The holographic billboard in the corner (PLAN 11.24). */
  private billboard: TimerSpot | null = null;
  private readonly overlayGfx = new Graphics();
  private readonly overlayGlow = new Graphics();

  private traces: Trace[] = [];
  private traceKey = '';
  private terrain: Uint8Array | null = null;
  private width = 0;

  private bursts: Burst[] = [];
  private shorts: Short[] = [];
  private sparks: Spark[] = [];
  private fades: Fade[] = [];
  private readonly aims = new GunAims();
  /** Each gun's power, and when it last changed, for the flicker as it goes. */
  private readonly power = new Map<number, { active: boolean; since: number }>();
  /** When each castle's hologram came on, for its flicker. */
  private readonly projected = new Map<number, number>();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private readonly flags = new FlagHoist();
  private clock = 0;
  /** Rain over the city, in tile coordinates, across the area drawn. */
  private rain: { x: number; y: number; speed: number }[] = [];
  private drawn = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(seed = 1) {
    this.seed = seed;
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.cyberpunk;
    for (const glow of [
      this.structures.containers[0] as Container,
      this.effectGlow,
      this.gunGlow.container,
      this.overlayGlow,
    ]) {
      glow.blendMode = 'add';
      // High effects: the glow bloomed by a real blur, not only a wider shape under it. At
      // half resolution, where a blur loses nothing to the eye: each is a texture the size
      // of the screen and four passes over it, and the five at full resolution took the GPU
      // from 6.6 to 15.1 ms a frame at eight players, 57 to 39.5 fps; at half, 8.5 ms.
      if (bloomWanted()) {
        glow.filters = [new BlurFilter({ strength: 5, quality: 2, resolution: 0.5 })];
      }
    }
    // The lit floor of sealed ground, the cores, the lights and the adverts: added, never bloomed.
    for (const lit of [
      this.territory.containers[1] as Container,
      this.effectCore,
      this.lights.container,
      this.ads,
    ]) {
      lit.blendMode = 'add';
    }
    layers.terrain.addChild(this.terrainGfx, this.ads);
    layers.territory.addChild(this.scenery.gfx, ...this.territory.containers);
    layers.structures.addChild(...this.structures.containers);
    layers.effects.addChild(
      this.effectGfx,
      this.gunMemo.container,
      // Over the rails, so a coil lights on them, and under the crown and the shots.
      this.lights.container,
      this.crowns.gfx,
      this.lateGfx,
      this.effectGlow,
      this.gunGlow.container,
      this.effectCore,
    );
    layers.overlay.addChild(this.overlayGlow, this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.gunMemo.destroy();
    this.gunGlow.destroy();
    this.lateGfx.destroy();
    this.scenery.destroy();
    this.structures.destroy();
    this.territory.destroy();
    this.lights.destroy();
    this.book.destroy();
    release(this.ads);
    for (const p of [...this.floors.values(), ...this.oldFloors]) p.texture.destroy(true);
    this.floors.clear();
    this.oldFloors.length = 0;
    for (const g of [
      this.terrainGfx,
      this.effectGfx,
      this.effectGlow,
      this.effectCore,
      this.crowns.gfx,
      this.overlayGfx,
      this.overlayGlow,
    ]) {
      g.destroy();
    }
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.billboard = cornerSpot(state, view);
    this.seaLife.corner = this.billboard;
    this.seaLife.layout(state, view, this.art);
    this.scenery.refresh(state, view, this.art, true);
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    clearDrawn(g);
    const { palette } = this.art;
    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    // The circuit runs out past the board to the window's edge, as the pixel sea does.
    const marginX = Math.ceil(view.originX / view.tile) + 1;
    const marginY = Math.ceil(view.originY / view.tile) + 1;
    this.drawn = {
      x0: -marginX,
      y0: -marginY,
      x1: state.width + marginX,
      y1: state.height + marginY,
    };
    const key = `${marginX},${marginY}`;
    if (key !== this.traceKey) {
      this.traceKey = key;
      const w = state.width + marginX * 2;
      const h = state.height + marginY * 2;
      const fade = this.style.traceFadeTiles;
      const depth = seaDepth(state, marginX, marginY, fade + 2);
      const sea = depth.reduce((n, d) => (d >= 1.5 ? n + 1 : n), 0);
      const count = Math.round(sea * this.style.tracesPerSeaTile);
      this.traces = circuitTraces(depth, w, h, marginX, marginY, count, new Rng(this.seed));
    }
    const trace = hex(palette.waterShallow);
    const line = Math.max(1, Math.round(view.tile / 9));
    for (const t of this.traces) {
      for (let k = 1; k < t.points.length; k++) {
        const a = t.points[k - 1]!;
        const b = t.points[k]!;
        g.moveTo(tileX(view, a.x + 0.5), tileY(view, a.y + 0.5));
        g.lineTo(tileX(view, b.x + 0.5), tileY(view, b.y + 0.5));
        g.stroke({ width: line, color: trace, alpha: this.traceAlpha(t.depth[k]!) });
      }
      // A pad at either end, where the trace would meet a component.
      for (const end of [0, t.points.length - 1]) {
        const p = t.points[end]!;
        g.circle(tileX(view, p.x + 0.5), tileY(view, p.y + 0.5), view.tile * 0.2);
        g.stroke({ width: line, color: trace, alpha: this.traceAlpha(t.depth[end]!) });
      }
    }

    // Land as a dark board, tinted just enough to say whose island it is.
    for (let player = 0; player <= state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
        any = true;
      }
      if (!any) continue;
      g.fill({ color: hex(palette.grassMid) });
      if (player === 0) continue;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
      }
      g.fill({ color: this.colour(player - 1, 'dark'), alpha: 0.1 });
    }

    // The grid, one line along the top and left of every land tile.
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const left = tileX(view, x);
      const top = tileY(view, y);
      g.moveTo(left, top + view.tile)
        .lineTo(left, top)
        .lineTo(left + view.tile, top);
    }
    g.stroke({ width: 1, color: hex(palette.grassLight), alpha: this.style.gridAlpha });

    // The coast, in the owner's colour but dim: the land's edge is not a wall.
    for (let player = 1; player <= state.players.length; player++) {
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        const y = (i - x) / state.width;
        this.edges(g, view, x, y, (nx, ny) => land(nx, ny));
      }
      g.stroke({ width: 1, color: this.colour(player - 1, 'base'), alpha: 0.45 });
    }

    this.drawCity(g, state, view);
  }

  /**
   * A city along the outer coasts: low blocks on the water at the land's edge, a roof and a
   * front face with a few lit windows each, and over one or two a holographic advert that
   * flickers. On the sea, never the land, so no block can be taken for a wall or hide one,
   * and only where no other island's land is near, so none stands in a channel shots cross;
   * clear of the big timer's square and the corner's billboard. Seeded, and drawn once with
   * the terrain; the adverts are each a `Graphics` drawn then and only faded after.
   */
  private drawCity(g: Graphics, state: MatchState, view: ViewTransform): void {
    for (const ad of [...this.ads.children]) release(ad);
    const { palette } = this.art;
    const t = view.tile;
    const w = state.width;
    const h = state.height;
    const islandAt = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < w && y < h && state.terrain[y * w + x] === Terrain.Land
        ? (state.islandId[y * w + x] as number)
        : 0;
    const clear = this.style.cityClearTiles;
    const timer = timerSpot(state);
    const near = (spot: TimerSpot | null, x: number, y: number, pad: number): boolean =>
      spot !== null &&
      Math.abs(x + 0.5 - spot.x) < spot.size / 2 + pad &&
      Math.abs(y + 0.5 - spot.y) < spot.size / 2 + pad;
    const rng = new Rng(this.seed ^ 0x5c17ee);
    const blocks: { x: number; y: number; w: number; h: number; face: number; north: boolean }[] =
      [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (state.terrain[y * w + x] === Terrain.Land) continue;
        // The coast it stands on: the land beside it, and which way that lies.
        let island = 0;
        let dx = 0;
        let dy = 0;
        for (const [ox, oy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const id = islandAt(x + ox, y + oy);
          if (id === 0) continue;
          island = id;
          dx = ox;
          dy = oy;
        }
        if (island === 0 || rng.nextFloat() >= this.style.cityOdds) continue;
        let channel = false;
        for (let oy = -clear; oy <= clear && !channel; oy++) {
          for (let ox = -clear; ox <= clear; ox++) {
            const id = islandAt(x + ox, y + oy);
            if (id !== 0 && id !== island) {
              channel = true;
              break;
            }
          }
        }
        if (channel || near(timer, x, y, 1) || near(this.billboard, x, y, 1)) continue;
        // Set against the coast, a gap of water between it and its neighbours.
        const bw = 0.4 + rng.nextFloat() * 0.4;
        const bh = 0.4 + rng.nextFloat() * 0.4;
        const bx = dx < 0 ? 0.08 : dx > 0 ? 0.92 - bw : 0.1 + rng.nextFloat() * (0.8 - bw);
        const by = dy < 0 ? 0.08 : dy > 0 ? 0.92 - bh : 0.1 + rng.nextFloat() * (0.8 - bh);
        // Some stand taller than others: a face from a fifth to nearly half the block.
        const face = bh * (0.22 + rng.nextFloat() * 0.25);
        blocks.push({
          x: x + bx,
          y: y + by,
          w: bw,
          h: bh,
          face,
          north: [-1, 0, 1].some((ox) => islandAt(x + ox, y - 1) !== 0),
        });
      }
    }
    if (blocks.length === 0) return;
    const roof = (b: (typeof blocks)[number]): [number, number, number, number] => [
      tileX(view, b.x),
      tileY(view, b.y),
      b.w * t,
      Math.max(1, (b.h - b.face) * t),
    ];
    // Roofs, then the faces below them, darker, which is what stands a block up; the roof's
    // back edge catches the light.
    for (const b of blocks) g.rect(...roof(b));
    g.fill({ color: hex(palette.sand) });
    for (const b of blocks) g.rect(...roof(b));
    g.stroke({ width: 1, color: hex(palette.rockDark) });
    for (const b of blocks) {
      const [x, y, w] = roof(b);
      g.moveTo(x, y).lineTo(x + w, y);
    }
    g.stroke({ width: 1, color: hex(palette.rockMid), alpha: 0.8 });
    for (const b of blocks) {
      const [x, y, w, h] = roof(b);
      g.rect(x, y + h, w, b.face * t);
    }
    g.fill({ color: hex(palette.grassDark) });
    // Windows in rows along each face, some lit: warm mostly, a few in the sea's cyan.
    // Squares of a pixel or two, so none reads as a shot or a mark.
    const pane = Math.max(1, Math.round(t * 0.06));
    const lit: [number[], number[]] = [[], []];
    for (const b of blocks) {
      const [left, y, w, h] = roof(b);
      const rows = Math.max(1, Math.floor((b.face * t) / (pane * 2.5)));
      for (let r = 0; r < rows; r++) {
        const row = y + h + pane * (0.8 + r * 2.5);
        for (let px = left + pane; px < left + w - pane * 1.5; px += pane * 2.2) {
          const roll = rng.nextFloat();
          if (roll < 0.4) continue;
          (roll < 0.88 ? lit[0] : lit[1]).push(px, row);
        }
      }
    }
    for (const [k, colour] of [
      [0, palette.emberHot],
      [1, palette.waterFoam],
    ] as const) {
      const points = lit[k];
      for (let i = 0; i < points.length; i += 2) g.rect(points[i]!, points[i + 1]!, pane, pane);
      g.fill({ color: hex(colour), alpha: 0.75 });
    }
    // Rooftop clutter on the larger roofs: a vent or a water tank.
    for (const b of blocks) {
      if (b.w * b.h < 0.25 || rng.nextFloat() < 0.5) continue;
      const s = t * 0.14;
      g.rect(tileX(view, b.x + b.w * 0.3), tileY(view, b.y + b.h * 0.25), s, s);
    }
    g.fill({ color: hex(palette.rockDark) });

    // Adverts: a pane of light over a block, in the style's magenta or cyan, with a few bars
    // of text that is no text.
    // Only over a block with open water behind it: one with the land to its north would
    // stand its advert on the island.
    const open = blocks.filter((b) => !b.north);
    const ads = Math.min(this.style.holoAds, open.length);
    const taken = new Set<number>();
    for (let k = 0; k < ads; k++) {
      let pick = rng.nextInt(open.length);
      while (taken.has(pick)) pick = (pick + 1) % open.length;
      taken.add(pick);
      const b = open[pick]!;
      const colour = hex(k % 2 === 0 ? palette.emberMid : palette.waterFoam);
      const aw = Math.max(b.w, 0.6) * t;
      const ah = t * 0.42;
      const ax = tileX(view, b.x + b.w / 2) - aw / 2;
      const ay = tileY(view, b.y) - ah - t * 0.08;
      const ad = new Graphics();
      ad.rect(ax, ay, aw, ah);
      ad.fill({ color: colour, alpha: 0.14 });
      ad.stroke({ width: 1, color: colour, alpha: 0.8 });
      for (let line = 0; line < 3; line++) {
        const lw = aw * (0.35 + 0.45 * rng.nextFloat());
        const ly = ay + ah * (0.25 + line * 0.25);
        ad.moveTo(ax + aw * 0.12, ly).lineTo(ax + aw * 0.12 + lw * 0.76, ly);
      }
      ad.stroke({ width: Math.max(1, t * 0.05), color: colour, alpha: 0.7 });
      // The thin post it stands on, down to the roof.
      ad.moveTo(ax + aw / 2, ay + ah).lineTo(ax + aw / 2, tileY(view, b.y));
      ad.stroke({ width: 1, color: colour, alpha: 0.4 });
      this.ads.addChild(ad);
    }
  }

  /** The adverts flicker on their own beats, out now and then for a moment, as cheap signs do. */
  private flickerAds(): void {
    const still = motionReduced();
    this.ads.children.forEach((ad, k) => {
      if (still) {
        ad.alpha = 0.8;
        return;
      }
      const beat = this.clock / (170 + 60 * k) + k * 4.1;
      const out = Math.sin(beat) > 0.93 || Math.sin(beat * 0.37 + 1) > 0.97;
      ad.alpha = out ? 0.15 : 0.75 + 0.15 * Math.sin(this.clock / 300 + k);
    });
  }

  private traceAlpha(depth: number): number {
    return Math.max(0.15, Math.min(1, (depth - 1.5) / this.style.traceFadeTiles)) * 0.6;
  }

  /** Lines along whichever sides of a tile do not continue into `joins`. */
  private edges(
    g: Graphics,
    view: ViewTransform,
    x: number,
    y: number,
    joins: (x: number, y: number) => boolean,
  ): void {
    const left = tileX(view, x);
    const top = tileY(view, y);
    const right = left + view.tile;
    const bottom = top + view.tile;
    if (!joins(x, y - 1)) g.moveTo(left, top).lineTo(right, top);
    if (!joins(x + 1, y)) g.moveTo(right, top).lineTo(right, bottom);
    if (!joins(x, y + 1)) g.moveTo(left, bottom).lineTo(right, bottom);
    if (!joins(x - 1, y)) g.moveTo(left, top).lineTo(left, bottom);
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as a lit floor: the owner's colour under a bright grid. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island, [, grid]) =>
      this.drawSealed(g, grid as Graphics, island, view),
    );
  }

  /**
   * One island's sealed ground, for `IslandParts`: a wash of the owner's colour, and over it,
   * added, a lit floor of hexes in the owner's light colour, edged with a dashed neon line
   * a little inside its border. The tile grid it had was the land's grid in colour and hardly
   * read over the owner's tint (the style review); hexes are a pattern no wall or gun has,
   * so sealed ground reads at a glance and the walls, square and rimmed, stand apart from
   * it. The pattern is drawn once for the tile size and laid in as a fill (`hexFloor`), a
   * rectangle a tile, and still: nothing moves under the walls.
   */
  private drawSealed(g: Graphics, lit: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const w = state.width;
    const inset = t * 0.14;
    // Dashes in quarters of each edge, two a tile, so corners meet on a gap rather than
    // doubling up where the dashes of two edges would cross.
    const dash = (ax: number, ay: number, bx: number, by: number): void => {
      for (const [from, to] of [
        [0.12, 0.38],
        [0.62, 0.88],
      ] as const) {
        lit
          .moveTo(ax + (bx - ax) * from, ay + (by - ay) * from)
          .lineTo(ax + (bx - ax) * to, ay + (by - ay) * to);
      }
    };
    for (let player = 0; player < state.players.length; player++) {
      const mine = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < w && y < state.height && state.territory[y * w + x] === player + 1;
      let any = false;
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % w;
        g.rect(tileX(view, x), tileY(view, (i - x) / w), t, t);
        any = true;
      }
      if (!any) continue;
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % w;
        lit.rect(tileX(view, x), tileY(view, (i - x) / w), t, t);
      }
      const light = this.art.players[player % this.art.players.length]?.light ?? '#ffffff';
      lit.fill({ fill: this.hexFloor(view, light), alpha: this.style.floorAlpha });
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % w;
        const y = (i - x) / w;
        const left = tileX(view, x);
        const top = tileY(view, y);
        const right = left + t;
        const bottom = top + t;
        if (!mine(x, y - 1)) dash(left, top + inset, right, top + inset);
        if (!mine(x + 1, y)) dash(right - inset, top, right - inset, bottom);
        if (!mine(x, y + 1)) dash(left, bottom - inset, right, bottom - inset);
        if (!mine(x - 1, y)) dash(left + inset, top, left + inset, bottom);
      }
      lit.stroke({
        width: Math.max(1, t * 0.07),
        color: this.colour(player, 'light'),
        alpha: this.style.floorEdgeAlpha,
      });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  /**
   * The lit floor's hexes in one colour, drawn once on a small canvas for the tile size and
   * laid into sealed ground as a fill lined up with the board. A pattern takes no tint, so
   * there is one a colour, eight at most.
   */
  private hexFloor(view: ViewTransform, colour: string): FillPattern {
    // Lined up with the board, so a new origin makes them again as a new tile size does.
    if (viewKey(view) !== this.floorView) {
      this.oldFloors.push(...this.floors.values());
      this.floors.clear();
      this.floorView = viewKey(view);
    }
    let pattern = this.floors.get(colour);
    if (pattern === undefined) {
      pattern = hexPattern(view, colour, this.style.floorHexTiles);
      this.floors.set(colour, pattern);
    }
    return pattern;
  }

  /**
   * Thin rain over the city, falling fast and nearly straight, faint in the sea's neon so
   * it reads as weather and never as a shot. None when motion is reduced.
   */
  private drawRain(view: ViewTransform, deltaMs: number): void {
    if (motionReduced()) {
      this.rain = [];
      return;
    }
    const { x0, y0, x1, y1 } = this.drawn;
    const wanted = Math.round(((x1 - x0) * (y1 - y0) * this.style.rainPerThousandTiles) / 1000);
    while (this.rain.length < wanted) {
      this.rain.push({
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        speed: 18 + Math.random() * 10,
      });
    }
    const g = this.effectGfx;
    const dt = deltaMs / 1000;
    for (const drop of this.rain) {
      drop.y += drop.speed * dt;
      drop.x += drop.speed * 0.08 * dt;
      if (drop.y > y1) {
        drop.y = y0;
        drop.x = x0 + Math.random() * (x1 - x0);
      }
      const x = tileX(view, drop.x);
      const y = tileY(view, drop.y);
      g.moveTo(x, y).lineTo(x - view.tile * 0.05, y - view.tile * 0.6);
    }
    g.stroke({ width: 1, color: hex(this.art.palette.waterFoam), alpha: 0.16 });
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (glow, island, [, g]) =>
      this.drawIsland(g as Graphics, glow, island, view),
    );
  }

  /** One island's structures and their glow, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, glow: Graphics, state: MatchState, view: ViewTransform): void {
    const { palette } = this.art;
    const wallOf = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;

    // Walls, batched per owner, standing up as the pixel style's do, and to the same
    // height, so the two agree as the banner swaps them: a block with nothing to its
    // south shows a front face below its top. The top is a dark body with a neon line
    // round the outside of each run, the face a darker panel with a light strip, and the
    // owner's colour spills onto the ground in front, where a shadow would vanish on this
    // dark a board.
    for (let owner = 1; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const player = owner - 1;
      this.drawWall(g, glow, view, cells, (x, y) => wallOf(x, y) === owner, {
        dark: this.colour(player, 'dark'),
        base: this.colour(player, 'base'),
        light: this.colour(player, 'light'),
      });
    }

    // An eliminated player's rubble: dead, unlit, and lying down, so it has no face.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
    }
    g.fill({ color: hex(palette.rockDark), alpha: 0.75 });
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      this.edges(g, view, x, (i - x) / state.width, (nx, ny) => wallOf(nx, ny) === 0);
    }
    g.stroke({ width: 1, color: hex(palette.rockMid), alpha: 0.7 });

    // Castles as server towers, guns as hex turrets; what lights up on them is an effect.
    for (const castle of state.castles) {
      const main = state.players[castle.islandId - 1]?.startingCastleId === castle.id;
      this.drawTower(g, glow, view, castle, main);
    }
    for (const cannon of state.cannons) this.drawTurret(g, glow, view, cannon);
  }

  /**
   * A castle as a server tower seen from above and a little in front, standing on its 2x2:
   * a podium with its front face, a tower stepped back on it with a face of its own, vents
   * in the podium's roof, two antenna masts rising off the back, a vertical sign hung on
   * the front corner, and the reactor ring in the tower's roof. A main castle is an
   * arcology: a third tier on the tower and a third mast, all taller. Drawn here unlit — the
   * sign's glyphs dark, the ring a dead groove — since lit means sealed, which changes with
   * a shot and is drawn over it by `drawTowerLights`. The masts stand clear of the middle,
   * where the hologram flag flies.
   */
  private drawTower(
    g: Graphics,
    glow: Graphics,
    view: ViewTransform,
    castle: MatchState['castles'][number],
    main: boolean,
  ): void {
    const { palette } = this.art;
    const owner = castle.islandId - 1;
    const dark = this.colour(owner, 'dark');
    const base = this.colour(owner, 'base');
    const light = this.colour(owner, 'light');
    const line = this.style.wallLinePx;
    const hair = Math.max(1, view.tile * 0.05);
    const glowWidth = Math.max(line * 2, view.tile * this.style.glowWidthTiles);
    const tw = towerOf(view, castle, main, this.castleFace(castle));
    const { podium, face } = tw;

    // The podium's face, with its floors' windows dimly lit whatever the seal: the sign and
    // the reactor say sealed, not the building.
    g.rect(face.x, face.y, face.w, face.h);
    g.fill({ color: dimmed(dark, 0.55) });
    g.stroke({ width: 1, color: base, alpha: 0.6 });
    const pane = Math.max(1, Math.round(view.tile * 0.07));
    for (let x = tw.sign.x + tw.sign.w + pane * 2; x < face.x + face.w - pane * 2; x += pane * 3) {
      g.rect(x, face.y + face.h / 2 - pane / 2, pane, pane);
    }
    g.fill({ color: base, alpha: 0.45 });
    g.rect(podium.x, podium.y, podium.w, podium.h);
    g.fill({ color: mixed(dark, base, 0.15) });
    g.stroke({ width: line, color: light });
    glow.rect(podium.x, podium.y, podium.w, podium.h);
    glow.stroke({ width: glowWidth, color: base, alpha: this.style.glowAlpha });
    glow.rect(face.x, face.y + face.h, face.w, view.tile * 0.3);
    glow.fill({ color: base, alpha: 0.1 });

    // Vents in the podium's roof in front of the tower: grilles of slats.
    for (const v of tw.vents) g.rect(v.x, v.y, v.w, v.h);
    g.fill({ color: hex(palette.shadow), alpha: 0.65 });
    for (const v of tw.vents) {
      const slat = Math.max(2, v.w / 5);
      for (let x = v.x + slat / 2; x < v.x + v.w; x += slat) g.moveTo(x, v.y).lineTo(x, v.y + v.h);
    }
    g.stroke({ width: 1, color: base, alpha: 0.5 });

    // The tiers, each a lighter roof over a darker face with a strip of light, stepping up.
    // Each casts a band of shadow on what it stands on, below its face, so the step reads
    // on so dark a board.
    tw.tiers.forEach((tier, k) => {
      g.rect(tier.x, tier.y + tier.h + tier.face, tier.w, Math.max(1, tier.face * 0.6));
      g.fill({ color: hex(palette.shadow), alpha: 0.6 });
      g.rect(tier.x, tier.y + tier.h, tier.w, tier.face);
      g.fill({ color: dimmed(dark, 0.45) });
      g.moveTo(tier.x, tier.y + tier.h + tier.face / 2).lineTo(
        tier.x + tier.w,
        tier.y + tier.h + tier.face / 2,
      );
      g.stroke({ width: 1, color: base, alpha: 0.6 });
      g.rect(tier.x, tier.y, tier.w, tier.h);
      g.fill({ color: mixed(dark, base, 0.4 + 0.15 * k) });
      g.stroke({ width: Math.max(hair, line * 0.75), color: light, alpha: 0.95 });
    });

    // Masts: a rod tapering up from a wider foot, a short spar near the top — a crossbar as
    // wide as the foot made a plus sign of it — and the tip a lamp, dark here.
    for (const m of tw.masts) {
      const foot = view.tile * 0.07;
      g.poly([
        m.x - foot,
        m.foot,
        m.x + foot,
        m.foot,
        m.x + hair / 2,
        m.top,
        m.x - hair / 2,
        m.top,
      ]);
    }
    g.fill({ color: hex(palette.rockMid) });
    for (const m of tw.masts) {
      const bar = view.tile * 0.06;
      for (const f of m.bars) {
        const y = m.top + (m.foot - m.top) * f;
        g.moveTo(m.x - bar, y).lineTo(m.x + bar, y);
      }
    }
    g.stroke({ width: 1, color: hex(palette.rockLight), alpha: 0.7 });
    for (const m of tw.masts) g.circle(m.x, m.top, Math.max(1, view.tile * 0.05));
    g.fill({ color: dimmed(base, 0.5) });

    // The sign, hung on the front corner down over the face: a dark panel, its glyphs unlit.
    const { sign } = tw;
    g.rect(sign.x, sign.y, sign.w, sign.h);
    g.fill({ color: dimmed(dark, 0.35) });
    g.stroke({ width: 1, color: base, alpha: 0.55 });
    glyphs(g, sign, castle.id % 8);
    g.stroke({ width: hair, color: mixed(dark, base, 0.35), alpha: 0.9 });

    // The reactor's housing: a dark well with its ring and inner ring dead in it.
    const { reactor } = tw;
    g.circle(reactor.cx, reactor.cy, reactor.r * 1.2);
    g.fill({ color: hex(palette.shadow), alpha: 0.75 });
    g.circle(reactor.cx, reactor.cy, reactor.r);
    g.circle(reactor.cx, reactor.cy, reactor.r * 0.4);
    g.stroke({ width: Math.max(1.5, view.tile * 0.08), color: dimmed(base, 0.45) });
  }

  /**
   * A gun as a turret on the plain square every style keeps (`cannonBase`): a hexagonal
   * mount standing a little off the ground, its side showing, chevron decals on its flanks,
   * and the ring the rails turn on. Silenced, the S1 offline look: the mount grey and unlit,
   * a red scanline across it. The rails turn, so they are drawn with the effects.
   */
  private drawTurret(
    g: Graphics,
    glow: Graphics,
    view: ViewTransform,
    cannon: MatchState['cannons'][number],
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const line = this.style.wallLinePx;
    const glowWidth = Math.max(line * 2, t * this.style.glowWidthTiles);
    const hair = Math.max(1, t * 0.05);
    const cx = tileX(view, cannon.x + cannon.w / 2);
    const cy = tileY(view, cannon.y + cannon.h / 2);
    const r = turretRadius(view, cannon);
    const side = (t * this.art.generators.wall.frontFacePx * 0.6) / this.art.tileSizePx;
    const on = cannon.active;
    const dark = this.colour(cannon.owner, 'dark');
    const base = this.colour(cannon.owner, 'base');
    const light = this.colour(cannon.owner, 'light');
    cannonBase(g, view, cannon, dark, base, 0.4);
    g.poly(hexagon(cx, cy + side, r));
    g.fill({ color: on ? dimmed(dark, 0.5) : hex(palette.grassDark) });
    g.stroke({ width: 1, color: on ? base : hex(palette.rockDark), alpha: 0.6 });
    g.poly(hexagon(cx, cy, r));
    g.fill({ color: on ? dark : hex(palette.rockDark) });
    g.stroke({ width: line, color: on ? light : hex(palette.rockLight), alpha: on ? 1 : 0.7 });
    // Chevrons on the flanks, pointing out to the hex's corners, two a side.
    const c = r * 0.17;
    for (const s of [-1, 1]) {
      for (const at of [0.5, 0.7]) {
        const x = cx + s * r * at;
        g.moveTo(x, cy - c)
          .lineTo(x + s * c, cy)
          .lineTo(x, cy + c);
      }
    }
    g.stroke({ width: hair * 1.2, color: on ? base : hex(palette.rockMid), alpha: 0.9 });
    g.circle(cx, cy, r * 0.36);
    g.fill({ color: on ? dimmed(dark, 0.6) : hex(palette.grassDark) });
    g.stroke({ width: 1, color: on ? base : hex(palette.rockMid) });
    if (!on) {
      // Offline: a grey housing, unlit, and a red scanline across it — a near-black mount on
      // the near-black ground read as nothing at all, where a silenced gun must read at once.
      g.moveTo(cx - r * 0.7, cy + r * 0.45).lineTo(cx + r * 0.7, cy + r * 0.45);
      g.stroke({ width: line * 1.5, color: hex(palette.uiInvalid), alpha: 0.9, cap: 'round' });
      return;
    }
    glow.poly(hexagon(cx, cy, r));
    glow.stroke({ width: glowWidth * 0.8, color: base, alpha: this.style.glowAlpha });
  }

  /**
   * The piece in hand as the wall it would make, joined to itself and to the player's
   * wall standing, faces and all, in the player's colour and outlined in the valid ink —
   * or, where it does not fit, only a red outline round a faint fill.
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
    const standing = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.structure[y * state.width + x] === Structure.Wall &&
      state.owner[y * state.width + x] === humanPlayer + 1;
    const red = hex(this.art.palette.uiInvalid);
    const g = this.overlayGfx;
    if (ghost.valid) {
      this.drawWall(
        g,
        this.overlayGlow,
        view,
        cells,
        (x, y) => inPiece.has(`${x},${y}`) || standing(x, y),
        {
          dark: this.colour(humanPlayer, 'dark'),
          base: this.colour(humanPlayer, 'base'),
          light: this.colour(humanPlayer, 'light'),
        },
        0.85,
      );
    } else {
      // Hollow where it does not fit: a wall in red would be the crimson player's own
      // colour, so the difference is in the form — no body, only an outline — not the hue.
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
      g.fill({ color: red, alpha: 0.15 });
    }
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
    g.stroke(
      ghost.valid
        ? { width: 1, color: hex(this.art.palette.uiValid), alpha: 0.8 }
        : { width: this.style.wallLinePx, color: red, alpha: 0.9 },
    );
  }

  /**
   * Wall blocks standing up, in one set of colours: tops lit a step above their front
   * faces, each face with a strip of light and the colour spilling onto the ground in
   * front, the rim of the tops brightest of all. `joins` says which tiles count as the
   * same wall, for the rim and for whether a block has anything to its south. Standing
   * walls and the piece in hand are both drawn with it, so a piece looks like the wall
   * it will make.
   */
  private drawWall(
    g: Graphics,
    glow: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    ink: { dark: number; base: number; light: number },
    alpha = 1,
  ): void {
    const t = view.tile;
    const line = this.style.wallLinePx;
    const glowWidth = Math.max(line * 2, t * this.style.glowWidthTiles);
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    // The top lit a step above the face, which is what stands the wall up.
    g.fill({ color: mixed(ink.dark, ink.base, 0.3), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dimmed(ink.dark, 0.55), alpha });

    // The face's strip of light, and its edges: where it meets the ground, and its ends.
    trace(g, wall.strips);
    g.stroke({ width: 1, color: ink.base, alpha: 0.5 * alpha });
    trace(g, wall.faceEdges);
    g.stroke({ width: 1, color: ink.base, alpha: 0.6 * alpha });

    // Each block's cell on its top, faint, so a thick wall still shows the blocks a shot
    // takes out.
    const inset = Math.max(1, t * 0.18);
    for (const r of wall.tops) g.rect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    g.stroke({ width: 1, color: ink.base, alpha: 0.35 * alpha });

    // The rim of the tops: the brightest line on the board, and its glow.
    trace(g, wall.rim);
    g.stroke({ width: line, color: ink.light, alpha });
    trace(glow, wall.rim);
    glow.stroke({ width: glowWidth, color: ink.base, alpha: this.style.glowAlpha * alpha });

    // Light spilling onto the ground in front of each face, fading away from it.
    for (const [depth, spill] of [
      [0.35, 0.08],
      [0.15, 0.1],
    ] as const) {
      for (const r of wall.faces) glow.rect(r.x, r.y + r.h, r.w, t * depth);
      glow.fill({ color: ink.base, alpha: spill * alpha });
    }
  }

  /** A wall's front face, as a fraction of a tile: the pixel style's, so the two agree. */
  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  /** Height of a castle's front face, in tiles: the pixel keep's, in proportion. */
  private castleFace(castle: { h: number }): number {
    const { frontFacePx } = this.art.generators.wall;
    return (castle.h * (frontFacePx + 2)) / (this.art.tileSizePx * 3);
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    const angle = this.aims.fire(shot);
    // Sparks from the muzzle in place of smoke, thrown out along the barrel.
    const reach = 0.95;
    const mx = shot.fromX + 0.5 + Math.sin(angle) * reach;
    const my = shot.fromY + 0.5 - Math.cos(angle) * reach;
    const colours = [this.colour(shot.owner, 'light'), hex(this.art.palette.uiInk)];
    for (let k = 0; k < 8; k++) {
      const spread = angle + (Math.random() - 0.5) * 1.2;
      const speed = 1.5 + Math.random() * 2.5;
      this.sparks.push({
        x: mx,
        y: my,
        vx: Math.sin(spread) * speed,
        vy: -Math.cos(spread) * speed,
        age: 0,
        life: 220 + Math.random() * 260,
        colour: colours[k % 2]!,
        gravity: 0,
      });
    }
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const onWall = debris.length > 0;
    const index = y * this.width + x;
    const inSea = this.terrain !== null && this.terrain[index] !== Terrain.Land;
    const colour = onWall
      ? this.colour(debris[0]!.owner, 'light')
      : inSea
        ? hex(this.art.palette.waterFoam)
        : hex(this.art.palette.uiInk);
    this.bursts.push({ x, y, age: 0, colour, onWall });
    for (const block of debris) {
      this.shorts.push({
        x: block.x,
        y: block.y,
        age: 0,
        seed: Math.random(),
        colour: this.colour(block.owner, 'light'),
      });
      for (let k = 0; k < 10; k++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3;
        this.sparks.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          age: 0,
          life: 350 + Math.random() * 400,
          colour: k % 3 === 0 ? hex(this.art.palette.uiInk) : this.colour(block.owner, 'light'),
          gravity: 9,
        });
      }
    }
  }

  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(block.owner, 'light');
    this.fades.push({ x: block.x, y: block.y, age: 0, colour });
  }

  /**
   * A piece set down: it settles, and sparks run off its outer edges — the neon
   * counterpart of the dust the pixel style kicks up, as brief.
   */
  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
    const colours = [this.colour(owner, 'light'), hex(this.art.palette.uiInk)];
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
          this.sparks.push({
            x: cell.x + 0.5 + dx * 0.5 + (dy === 0 ? 0 : along),
            y: cell.y + 0.5 + dy * 0.5 + (dx === 0 ? 0 : along),
            vx: dx * (0.8 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.6,
            vy: dy * (0.8 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.6,
            age: 0,
            life: 200 + Math.random() * 220,
            colour: colours[k % 2]!,
            gravity: 0,
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const glow = this.effectGlow;
    clearDrawn(g);
    clearDrawn(glow);
    clearDrawn(this.effectCore);
    clearDrawn(this.lateGfx);
    this.seaLife.draw(g, view, this.art, frame.deltaMs, glow);
    this.clock += frame.deltaMs;

    this.flickerAds();
    this.drawPulses(view);
    this.drawRain(view, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(
      g,
      view,
      state,
      hex(this.art.palette.rockMid),
      hex(this.art.palette.emberMid),
      frame.deltaMs,
    );
    drawChoices(g, view, frame.choices, this.art);
    this.lights.begin();
    this.drawTowerLights(state, view, frame);
    this.drawBarrels(state, view, frame);
    this.lights.end();
    this.drawPowerDowns(state, view);
    this.drawHolograms(state, view, frame);
    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawShots(state, view, frame);
    this.drawBursts(view, frame.deltaMs);
    this.drawShorts(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.drawSparks(view, frame.deltaMs);
    if (this.billboard !== null) this.drawBillboard(state, view, this.billboard);
    this.drawPhaseGlitch(state, view, frame);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * As a phase's banner arrives, the board glitches for a moment: a band across it torn
   * into slices pushed sideways, each split into magenta and cyan either side of a white
   * line, jumping to a new place every few frames — the picture losing its sync, as the
   * screen of this city would. Over in `phaseGlitchMs`, and none while motion is reduced.
   */
  private drawPhaseGlitch(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const showing = bannerProgress(state, frame.tickFraction) !== null;
    if (showing && !this.bannerShowing) this.glitchAge = 0;
    this.bannerShowing = showing;
    const span = this.style.phaseGlitchMs;
    if (this.glitchAge >= span) return;
    this.glitchAge += frame.deltaMs;
    if (motionReduced()) return;
    const core = this.effectCore;
    const t = view.tile;
    const fade = Math.max(0, 1 - this.glitchAge / span);
    const jump = Math.floor(this.glitchAge / 45);
    const r = (k: number): number => {
      const v = Math.sin((jump + 1) * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const split = Math.max(2, this.style.splitPx * 2);
    const magenta = hex(this.art.palette.emberMid);
    const cyan = hex(this.art.palette.waterFoam);
    const white = hex(this.art.palette.uiInk);
    const y0 = view.top + (view.height - view.top) * (0.15 + 0.7 * r(0));
    for (let k = 0; k < 6; k++) {
      const y = y0 + (k - 2.5) * t * 0.5 + r(k + 1) * t * 0.3;
      const h = Math.max(2, t * (0.1 + 0.3 * r(k + 7)));
      const w = view.width * (0.25 + 0.6 * r(k + 13));
      const x = (view.width - w) * r(k + 19);
      // The two colours apart across the slice as well as along it, so each edge shows one.
      core.rect(x - split, y - split / 2, w, h);
      core.fill({ color: magenta, alpha: 0.35 * fade });
      core.rect(x + split, y + split / 2, w, h);
      core.fill({ color: cyan, alpha: 0.35 * fade });
      core.rect(x, y + h / 2, w, 1);
      core.fill({ color: white, alpha: 0.5 * fade });
    }
  }

  /** A pulse running along each trace and off its end, then round again. */
  private drawPulses(view: ViewTransform): void {
    const glow = this.effectGlow;
    const colour = hex(this.art.palette.waterFoam);
    const speed = this.style.pulseTilesPerSecond;
    const size = Math.max(1.5, view.tile * 0.14);
    for (const trace of this.traces) {
      // Half the time on the trace, half off it, so the sea is not lit all at once.
      const cycle = trace.length * 2;
      const at = ((this.clock / 1000) * speed + trace.phase * cycle) % cycle;
      if (at > trace.length) continue;
      const head = along(trace, at);
      const tail = along(trace, Math.max(0, at - 1.2));
      const alpha = this.traceAlpha(
        trace.depth[Math.floor((at / trace.length) * (trace.depth.length - 1))]!,
      );
      glow.moveTo(tileX(view, tail.x + 0.5), tileY(view, tail.y + 0.5));
      glow.lineTo(tileX(view, head.x + 0.5), tileY(view, head.y + 0.5));
      glow.stroke({ width: size, color: colour, alpha: 0.5 * alpha });
      this.effectCore.circle(tileX(view, head.x + 0.5), tileY(view, head.y + 0.5), size);
      this.effectCore.fill({ color: colour, alpha });
    }
  }

  /**
   * A soft disc of light, `radius` pixels, as rings fading outward: a stamp drawn once for
   * the tile size, tinted and faded where placed.
   */
  private soft(view: ViewTransform): GraphicsContext {
    const t = view.tile;
    return this.book.get('soft', t, (g) => {
      for (const [r, a] of [
        [1, 0.18],
        [0.75, 0.22],
        [0.5, 0.3],
      ] as const) {
        g.circle(0, 0, t * r);
        g.fill({ color: 0xffffff, alpha: a });
      }
    });
  }

  /**
   * What lights up on a sealed tower: the glyphs of its sign, its reactor ring — turning
   * slowly, breathing in a soft glow, a white-hot inner ring — and the lamps at its masts'
   * tips, blinking in turn. A breach puts them out in a sputter, on and off ever more
   * rarely, as a gun powering down does (`powerDownMs`); sealing again flickers them on.
   * All stamped (`lights`): the dark tower under them is drawn once, with the island.
   */
  private drawTowerLights(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const stamps = this.lights;
    const still = motionReduced();
    const span = this.style.powerDownMs;
    const hair = Math.max(1, t * 0.05);
    const white = hex(this.art.palette.uiInk);
    const soft = this.soft(view);
    for (const castle of state.castles) {
      const sealed = frame.castleSealed[castle.id] === true;
      const known = this.lit.get(castle.id);
      if (known === undefined || known.sealed !== sealed) {
        // A tower seen for the first time has always been as it is.
        this.lit.set(castle.id, { sealed, since: known === undefined ? -span : this.clock });
      }
      const since = this.lit.get(castle.id)!.since;
      const k = (this.clock - since) / span;
      const sputter = !still && k < 1 && Math.sin(this.clock / (18 + 60 * k)) > 0.2 + 0.6 * k;
      if (sealed === sputter) continue;

      const owner = castle.islandId - 1;
      const main = state.players[owner]?.startingCastleId === castle.id;
      const tw = towerOf(view, castle, main, this.castleFace(castle));
      const light = this.colour(owner, 'light');
      const base = this.colour(owner, 'base');
      const { sign, reactor } = tw;
      const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock / 420 + castle.id);

      // The sign: its glyphs in the owner's light, a soft wash of light round the panel.
      const signKey = `sign|${castle.id % 8}|${Math.round(sign.w)}|${Math.round(sign.h)}`;
      const signLit = this.book.get(signKey, t, (g) => {
        g.rect(-sign.w * 0.6, -sign.w * 0.4, sign.w * 2.2, sign.h + sign.w * 0.8);
        g.fill({ color: 0xffffff, alpha: 0.14 });
        g.rect(0, 0, sign.w, sign.h);
        g.fill({ color: 0xffffff, alpha: 0.12 });
        glyphs(g, { x: 0, y: 0, w: sign.w, h: sign.h }, castle.id % 8);
        g.stroke({ width: hair * 1.2, color: 0xffffff });
      });
      stamps.place(signLit, sign.x, sign.y, { tint: light });

      // The reactor: glow, ring with its spokes, and the hot inner ring.
      stamps.place(soft, reactor.cx, reactor.cy, {
        scale: (reactor.r * 2.3) / t,
        tint: base,
        alpha: 0.55 + 0.35 * breath,
      });
      const ring = this.book.get(`reactor|${reactor.r}`, t, (g) => {
        const r = reactor.r;
        g.circle(0, 0, r);
        g.stroke({ width: Math.max(1.5, t * 0.09), color: 0xffffff });
        for (let s = 0; s < 6; s++) {
          const a = (s * Math.PI) / 3;
          g.moveTo(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52);
          g.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        }
        g.stroke({ width: hair, color: 0xffffff, alpha: 0.85 });
      });
      stamps.place(ring, reactor.cx, reactor.cy, {
        tint: light,
        rotation: still ? 0 : this.clock / 1400 + castle.id,
      });
      const hot = this.book.get(`hot|${reactor.r}`, t, (g) => {
        g.circle(0, 0, reactor.r * 0.4);
        g.stroke({ width: Math.max(1, t * 0.07), color: 0xffffff });
      });
      stamps.place(hot, reactor.cx, reactor.cy, { tint: white, alpha: 0.6 + 0.3 * breath });

      // The lamps at the masts' tips, each blinking briefly on its own beat.
      const blink = this.style.mastBlinkMs;
      tw.masts.forEach((m, n) => {
        const phase = (this.clock + castle.id * 389 + n * blink * 0.45) % blink;
        if (!still && phase > blink * 0.22) return;
        stamps.place(soft, m.x, m.top, { scale: 0.22, tint: light, alpha: 0.9 });
        const lamp = this.book.get('lamp', t, (g) => {
          g.circle(0, 0, Math.max(1, t * 0.055));
          g.fill({ color: 0xffffff });
        });
        stamps.place(lamp, m.x, m.top, { tint: white });
      });
    }
    if (this.lit.size > state.castles.length) {
      const live = new Set(state.castles.map((c) => c.id));
      for (const id of this.lit.keys()) if (!live.has(id)) this.lit.delete(id);
    }
  }

  /**
   * Barrels as twin rails from the turret's ring toward the last target, kicking back on
   * firing, a breech block across their foot and the coil's three bands across their end
   * (`Memos`, redrawn only as they turn or kick). The coil charges between shots — flight
   * time is the reload, so the gun's shot's progress is how far — its bands lighting one by
   * one from the breech; stamped, since it changes every frame. Bands across the rails and
   * no glow round them: a soft disc at the muzzle, tried first, was a shot's glowing head
   * on every gun. Silenced, the rails are short and grey and no coil lights.
   */
  private drawBarrels(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const memo = this.gunMemo;
    const glows = this.gunGlow;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const charging = new Map<number, number>();
    for (const shot of state.shots) charging.set(shot.cannonId, shotProgress(shot, now));
    const gap = t * 0.085;
    const rail = Math.max(1.5, t * 0.07);
    const band = this.book.get('coil', t, (g) => {
      g.moveTo(-gap - rail, 0).lineTo(gap + rail, 0);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0xffffff });
    });
    memo.begin();
    glows.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += frame.deltaMs;
      // Still between shots: drawn again only as it turns and kicks.
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.owner},${cannon.active}|${aim.angle}|${aim.firedAgo < RECOIL_MS ? aim.firedAgo : '-'}`;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const length = cannon.active ? 0.95 - 0.3 * kick : 0.55;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2;
      const dx = Math.sin(aim.angle);
      const dy = -Math.cos(aim.angle);
      const ex = cx + dx * length;
      const ey = cy + dy * length;
      // Across the barrel, in pixels, and a point `d` tiles along it.
      const px = -dy;
      const py = dx;
      const along = (d: number): [number, number] => [
        tileX(view, cx + dx * d),
        tileY(view, cy + dy * d),
      ];
      const bands = [length - 0.34, length - 0.21, length - 0.08];
      memo.draw(cannon.id, key, (g) => {
        const [bx, by] = along(0);
        const [mx, my] = along(length);
        for (const s of [-1, 1]) {
          g.moveTo(bx + px * gap * s, by + py * gap * s).lineTo(
            mx + px * gap * s,
            my + py * gap * s,
          );
        }
        g.stroke({
          width: rail,
          color: cannon.active ? this.colour(cannon.owner, 'light') : hex(this.art.palette.rockMid),
          alpha: cannon.active ? 1 : 0.5,
        });
        const block = gap + rail * 1.4;
        g.moveTo(bx - px * block, by - py * block).lineTo(bx + px * block, by + py * block);
        g.stroke({
          width: rail * 2,
          color: cannon.active ? this.colour(cannon.owner, 'base') : hex(this.art.palette.rockDark),
        });
        if (!cannon.active) return;
        // The coil's bands, dark until they charge.
        for (const d of bands) {
          const [ax, ay] = along(d);
          g.moveTo(ax - px * (gap + rail), ay - py * (gap + rail));
          g.lineTo(ax + px * (gap + rail), ay + py * (gap + rail));
        }
        g.stroke({
          width: Math.max(1.5, t * 0.08),
          color: dimmed(this.colour(cannon.owner, 'dark'), 0.7),
        });
      });
      glows.draw(cannon.id, key, (glow) => {
        if (!cannon.active) return;
        glow.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(tileX(view, ex), tileY(view, ey));
        // Square at the ends: round, it was a glowing ball at every muzzle, as a shot is.
        glow.stroke({
          width: (gap + rail) * 2 * 1.8,
          color: this.colour(cannon.owner, 'base'),
          alpha: 0.3,
        });
      });
      if (!cannon.active) continue;
      // Ready but for a shot still in the air; in every other phase, charged.
      const charge = charging.get(cannon.id) ?? 1;
      const light = this.colour(cannon.owner, 'light');
      bands.forEach((d, k) => {
        const level = Math.min(1, Math.max(0, charge * 3 - k));
        if (level <= 0) return;
        const [ax, ay] = along(d);
        this.lights.place(band, ax, ay, { rotation: aim.angle, tint: light, alpha: level });
      });
      if (kick > 0) {
        this.effectCore.circle(tileX(view, ex), tileY(view, ey), t * (0.2 + 0.35 * kick));
        this.effectCore.fill({ color: hex(this.art.palette.uiInk), alpha: 0.8 * kick });
      }
    }
    memo.end();
    glows.end();
    this.aims.prune(state);
  }

  /**
   * A gun that loses or regains power flickers as it goes, on and off ever more rarely
   * as it settles — the breach that silenced it, said without a struck-through mark.
   */
  private drawPowerDowns(state: MatchState, view: ViewTransform): void {
    const core = this.effectCore;
    const span = this.style.powerDownMs;
    for (const cannon of state.cannons) {
      const known = this.power.get(cannon.id);
      if (known === undefined || known.active !== cannon.active) {
        // A gun seen for the first time has always been as it is.
        this.power.set(cannon.id, {
          active: cannon.active,
          since: known === undefined ? -span : this.clock,
        });
        continue;
      }
      const t = (this.clock - known.since) / span;
      if (t >= 1) continue;
      // Lit in bursts that thin out: on while a fast square wave is high.
      if (Math.sin(this.clock / (18 + 60 * t)) < 0.2 + 0.6 * t) continue;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      core.poly(hexagon(cx, cy, turretRadius(view, cannon)));
      core.stroke({
        width: this.style.wallLinePx * 2,
        color: this.colour(cannon.owner, 'light'),
        alpha: 0.9,
      });
    }
    if (this.power.size > state.cannons.length) {
      const live = new Set(state.cannons.map((c) => c.id));
      for (const id of this.power.keys()) if (!live.has(id)) this.power.delete(id);
    }
  }

  /**
   * A sealed castle projects a hologram of its flag, which flickers on as it rises and
   * shimmers while it flies; a breach lowers it in a darker shade, flickering out.
   */
  private drawHolograms(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const glow = this.effectGlow;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) {
        this.projected.delete(castle.id);
        continue;
      }
      if (!this.projected.has(castle.id)) this.projected.set(castle.id, this.clock);
      const lowering = this.flags.lowering(castle.id);
      const on = (this.clock - this.projected.get(castle.id)!) / this.style.hologramFlickerMs;
      let alpha = 0.8 + 0.2 * Math.sin(this.clock / 90 + castle.id * 1.7);
      if (on < 1 && Math.sin(this.clock / 23 + castle.id) > on * 1.6 - 0.6) alpha *= 0.2;
      if (lowering && Math.sin(this.clock / 31 + castle.id) > 0.3) alpha *= 0.25;

      const owner = castle.islandId - 1;
      const colour = this.colour(owner, lowering ? 'dark' : 'base');
      const main = state.players[owner]?.startingCastleId === castle.id;
      // From the reactor, which projects it; the flag stays over the castle's middle.
      const { reactor } = towerOf(view, castle, main, this.castleFace(castle));
      const beamX = tileX(view, castle.x + castle.w / 2);
      const beamFoot = reactor.cy;
      const flagW = view.tile * 1.3;
      const flagH = view.tile * 0.8;
      const lowest = tileY(view, castle.y) - flagH * 0.3;
      const highest = tileY(view, castle.y) - view.tile * 1.1;
      const top = lowest + (highest - lowest) * raised;
      // The beam it is projected along, from the core up to the flag.
      glow.poly([
        reactor.cx - view.tile * 0.08,
        beamFoot,
        reactor.cx + view.tile * 0.08,
        beamFoot,
        beamX + flagW / 2,
        top + flagH,
        beamX - flagW / 2,
        top + flagH,
      ]);
      glow.fill({ color: colour, alpha: 0.12 * alpha });
      const core = this.effectCore;
      core.rect(beamX - flagW / 2, top, flagW, flagH);
      core.fill({ color: colour, alpha: 0.5 * alpha });
      core.stroke({ width: 1, color: this.colour(owner, 'light'), alpha: alpha });
      // Scanlines, drifting up through it.
      const lines = 3;
      for (let k = 0; k < lines; k++) {
        const y = top + ((k / lines + this.clock / 1600) % 1) * flagH;
        core.moveTo(beamX - flagW / 2, y).lineTo(beamX + flagW / 2, y);
      }
      core.stroke({ width: 1, color: this.colour(owner, 'light'), alpha: 0.5 * alpha });
    }
  }

  /** Shots as plasma tracers: a white-hot head in a glow of the firer's colour. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const glow = this.effectGlow;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const t = shotProgress(shot, now);
      const at = (tk: number): { x: number; y: number } => ({
        x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * tk + 0.5),
        y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * tk + 0.5 - shotLift(shot, tk)),
      });
      const lift = shotLift(shot, t);
      const height = Math.min(1, lift / 3);
      const colour = this.colour(shot.owner, 'base');

      // Its point on the ground, so the height still reads without the pixel shadow.
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * t + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * t + 0.5);
      g.circle(gx, gy, view.tile * 0.12 * (1 - 0.5 * height));
      g.fill({ color: colour, alpha: 0.4 - 0.25 * height });

      // The tracer: the last stretch of its arc, in a few straight pieces.
      const distance = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
      const back = distance > 0 ? Math.min(t, 1.6 / distance) : 0;
      const head = at(t);
      glow.moveTo(head.x, head.y);
      for (let k = 1; k <= 4; k++) {
        const p = at(t - (back * k) / 4);
        glow.lineTo(p.x, p.y);
      }
      glow.stroke({
        width: Math.max(2, view.tile * 0.3),
        color: colour,
        alpha: 0.45,
        cap: 'round',
        join: 'round',
      });
      const size = view.tile * (0.16 + 0.08 * height);
      glow.circle(head.x, head.y, size * 2.2);
      glow.fill({ color: colour, alpha: 0.4 });
      const core = this.effectCore;
      core.moveTo(head.x, head.y);
      for (let k = 1; k <= 2; k++) {
        const p = at(t - (back * k) / 4);
        core.lineTo(p.x, p.y);
      }
      core.stroke({
        width: Math.max(1, view.tile * 0.1),
        color: this.colour(shot.owner, 'light'),
        cap: 'round',
      });
      core.circle(head.x, head.y, size);
      core.fill({ color: hex(this.art.palette.uiInk) });

      drawShotTarget(g, view, shot, t, this.art, frame.humanPlayer);
    }
  }

  /** Where a shot comes down: a flash, a ring of light, and a moment of glitch. */
  private drawBursts(view: ViewTransform, deltaMs: number): void {
    const glow = this.effectGlow;
    const span = this.style.glitchMs;
    for (const burst of this.bursts) {
      burst.age += deltaMs;
      const t = burst.age / span;
      if (t >= 1) continue;
      const cx = tileX(view, burst.x + 0.5);
      const cy = tileY(view, burst.y + 0.5);
      glow.circle(cx, cy, view.tile * (0.5 + 0.4 * t) * (burst.onWall ? 1.4 : 1));
      glow.fill({ color: hex(this.art.palette.uiInk), alpha: 0.7 * (1 - t) * (1 - t) });
      const core = this.effectCore;
      core.circle(cx, cy, view.tile * (0.4 + 2 * t));
      core.stroke({ width: Math.max(2, view.tile / 6), color: burst.colour, alpha: 1 - t });
      if (burst.onWall && t < 0.5) {
        // A wall hit splits the light into its colours for a moment, as a lens does.
        const split = this.style.splitPx * (1 - t * 2);
        for (const [dx, colour] of [
          [-split, hex(this.art.palette.emberMid)],
          [split, hex(this.art.palette.waterFoam)],
        ] as const) {
          core.circle(cx + dx, cy, view.tile * (0.4 + 2 * t));
          core.stroke({
            width: Math.max(1, view.tile / 10),
            color: colour,
            alpha: 0.7 * (1 - t * 2),
          });
        }
      }
      // Glitch: bars of colour torn sideways across the point, jumping every few frames.
      const jump = Math.floor(burst.age / 40);
      const colours = [
        burst.colour,
        hex(this.art.palette.waterFoam),
        hex(this.art.palette.emberMid),
      ];
      for (let k = 0; k < 3; k++) {
        const r = Math.sin((jump + 1) * 12.9898 + k * 78.233 + burst.x) * 43758.5453;
        const f = r - Math.floor(r);
        const w = view.tile * (0.8 + 1.8 * f);
        const y = cy + view.tile * (f - 0.5) * 1.4;
        core.rect(cx - w / 2 + view.tile * (f - 0.5), y, w, Math.max(1, view.tile * 0.12));
        core.fill({ color: colours[k]!, alpha: 0.8 * (1 - t) });
      }
    }
    this.bursts = this.bursts.filter((burst) => burst.age < span);
  }

  /** A breach shorting out: arcs jumping across the gap, dying away until it is dark. */
  private drawShorts(view: ViewTransform, deltaMs: number): void {
    const core = this.effectCore;
    const span = this.art.generators.fx.smoulderMs;
    for (const s of this.shorts) {
      s.age += deltaMs;
      const life = 1 - s.age / span;
      if (life <= 0) continue;
      // Ever rarer as it dies.
      const flicker = Math.sin(s.age / 37 + s.seed * 40);
      if (flicker < 1 - 1.6 * life) continue;
      const x0 = tileX(view, s.x);
      const y0 = tileY(view, s.y);
      const jump = Math.floor(s.age / 60);
      const r = (k: number): number => {
        const v = Math.sin((jump + k) * 12.9898 + s.seed * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      core.moveTo(x0 + view.tile * r(1), y0 + view.tile * 0.15);
      core.lineTo(x0 + view.tile * r(2), y0 + view.tile * 0.5);
      core.lineTo(x0 + view.tile * r(3), y0 + view.tile * 0.85);
      core.stroke({ width: Math.max(1, view.tile / 12), color: s.colour, alpha: life });
    }
    this.shorts = this.shorts.filter((s) => s.age < span);
  }

  /** A block the sweep took, its outline flickering out. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const core = this.effectCore;
    const span = this.style.powerDownMs;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const t = fade.age / span;
      if (t >= 1 || Math.sin(fade.age / 25 + fade.x) < t * 1.5 - 0.5) continue;
      core.rect(tileX(view, fade.x) + 1, tileY(view, fade.y) + 1, view.tile - 2, view.tile - 2);
      core.stroke({ width: this.style.wallLinePx, color: fade.colour, alpha: 1 - t });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
  }

  private drawSparks(view: ViewTransform, deltaMs: number): void {
    const core = this.effectCore;
    const dt = deltaMs / 1000;
    for (const spark of this.sparks) {
      spark.age += deltaMs;
      const drag = Math.exp(-3 * dt);
      spark.vx *= drag;
      spark.vy = spark.vy * drag + spark.gravity * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      const t = spark.age / spark.life;
      if (t >= 1) continue;
      const size = Math.max(1.5, view.tile * 0.1);
      core.rect(tileX(view, spark.x) - size / 2, tileY(view, spark.y) - size / 2, size, size);
      core.fill({ color: spark.colour, alpha: 1 - t });
    }
    this.sparks = this.sparks.filter((spark) => spark.age < spark.life);
  }

  /**
   * A holographic billboard over the water in the corner: a projector on a pad, its beam
   * rising to a panel of light where an emblem — a wireframe cube — turns slowly under
   * drifting scanlines. A shot breaking a wall makes it glitch, its colours torn apart for
   * a moment; in overtime a warning flashes in the cube's place. The lines are drawn sharp
   * and their glow under them (`effectCore`, `effectGlow`), as everything bright here is.
   */
  private drawBillboard(state: MatchState, view: ViewTransform, spot: TimerSpot): void {
    const core = this.effectCore;
    const glow = this.effectGlow;
    const s = spot.size * view.tile;
    const still = motionReduced();
    const cyan = hex(this.art.palette.waterFoam);
    const magenta = hex(this.art.palette.emberMid);
    const cx = tileX(view, spot.x);
    const foot = tileY(view, spot.y) + s * 0.42;
    const panel = { x: cx - s * 0.42, y: tileY(view, spot.y) - s * 0.42, w: s * 0.84, h: s * 0.5 };
    const line = Math.max(1, this.style.wallLinePx * 0.75);
    // A wall just broken tears it, as a hit does the board.
    const torn = !still && this.bursts.some((b) => b.onWall && b.age < 260);
    const tear = torn ? (Math.random() - 0.5) * s * 0.08 : 0;

    // The projector's pad on the water, and the beam up to the panel.
    core.rect(cx - s * 0.08, foot - s * 0.03, s * 0.16, s * 0.04);
    core.fill({ color: hex(this.art.palette.rockMid) });
    core.circle(cx, foot - s * 0.04, s * 0.02);
    core.fill({ color: cyan });
    glow.poly([
      cx - s * 0.03,
      foot - s * 0.04,
      cx + s * 0.03,
      foot - s * 0.04,
      panel.x + panel.w * 0.85,
      panel.y + panel.h,
      panel.x + panel.w * 0.15,
      panel.y + panel.h,
    ]);
    glow.fill({ color: cyan, alpha: 0.08 });
    // The panel: a faint pane of light, its frame bracketed at the corners.
    const px = panel.x + tear;
    core.rect(px, panel.y, panel.w, panel.h);
    core.fill({ color: cyan, alpha: 0.07 });
    const arm = s * 0.08;
    for (const [x, y, sx, sy] of [
      [px, panel.y, 1, 1],
      [px + panel.w, panel.y, -1, 1],
      [px, panel.y + panel.h, 1, -1],
      [px + panel.w, panel.y + panel.h, -1, -1],
    ] as const) {
      core
        .moveTo(x + sx * arm, y)
        .lineTo(x, y)
        .lineTo(x, y + sy * arm);
    }
    core.stroke({ width: line, color: cyan, alpha: 0.9 });
    glow.rect(px, panel.y, panel.w, panel.h);
    glow.stroke({ width: line * 4, color: cyan, alpha: 0.12 });
    // Scanlines drifting up through it.
    const lines = 5;
    for (let k = 0; k < lines; k++) {
      const f = still ? k / lines : (k / lines + this.clock / 2400) % 1;
      const y = panel.y + panel.h * (1 - f);
      core.moveTo(px, y).lineTo(px + panel.w, y);
    }
    core.stroke({ width: 1, color: cyan, alpha: 0.18 });

    const mx = px + panel.w / 2;
    const my = panel.y + panel.h / 2;
    const overtime = state.phase === 'build' && state.overtime;
    if (overtime) {
      // A warning, flashing: a triangle with its mark.
      if (still || Math.floor(this.clock / 250) % 2 === 0) {
        const r = panel.h * 0.36;
        core.poly([mx, my - r, mx + r * 1.1, my + r * 0.8, mx - r * 1.1, my + r * 0.8]);
        core.stroke({ width: line * 1.4, color: magenta });
        core.rect(mx - line * 0.7, my - r * 0.35, line * 1.4, r * 0.6);
        core.rect(mx - line * 0.7, my + r * 0.4, line * 1.4, line * 1.4);
        core.fill({ color: magenta });
      }
      return;
    }
    // The emblem: a cube turning about its upright, tipped toward the viewer.
    const turn = (still ? 0 : (this.clock / this.style.billboardTurnMs) * Math.PI * 2) + 0.6;
    // Tipped well over and a little round, so it never stands face on and reads as an 8.
    const tip = 0.62;
    const r = panel.h * 0.27;
    const corners: [number, number][] = [];
    for (const [x, y, z] of [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ] as const) {
      const x1 = x * Math.cos(turn) + z * Math.sin(turn);
      const z1 = -x * Math.sin(turn) + z * Math.cos(turn);
      const y1 = y * Math.cos(tip) - z1 * Math.sin(tip);
      corners.push([mx + x1 * r, my + y1 * r]);
    }
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ] as const;
    const cube = (g: Graphics, dx: number): void => {
      for (const [a, b] of edges) {
        const [ax, ay] = corners[a]!;
        const [bx, by] = corners[b]!;
        g.moveTo(ax + dx, ay).lineTo(bx + dx, by);
      }
    };
    if (torn) {
      // Torn apart: the cube in magenta and cyan, either side of where it was.
      cube(core, -s * 0.03);
      core.stroke({ width: line, color: magenta, alpha: 0.8 });
      cube(core, s * 0.03);
      core.stroke({ width: line, color: cyan, alpha: 0.8 });
      return;
    }
    cube(glow, 0);
    glow.stroke({ width: line * 3, color: cyan, alpha: 0.2 });
    cube(core, 0);
    core.stroke({ width: line, color: hex(this.art.palette.uiInk), alpha: 0.9 });
  }

  // ------------------------------------------------------------------ overlay

  /**
   * Everything a player aims or builds by: the aiming cursor in combat, the piece in
   * hand while building, the gun being placed, the castles to choose from.
   */
  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
    clearDrawn(this.overlayGlow);
    drawOvertimeBorder(g, state, view, this.art, performance.now());
    drawSelectable(g, view, ghost, this.art, performance.now());
    drawBuildHints(g, view, ghost, this.art, performance.now());
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const colour = ghost.valid ? hex(this.art.palette.uiValid) : hex(this.art.palette.uiInvalid);
    if (state.phase === 'build' && ghost.cells.length > 0) {
      this.drawGhostWall(state, view, ghost, humanPlayer);
      return;
    }
    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The gun as its turret's lit hexagon, in the ink that says whether it fits.
      const cx = tileX(view, ghost.tile.x + ghost.footprint.w / 2);
      const cy = tileY(view, ghost.tile.y + ghost.footprint.h / 2);
      const r = turretRadius(view, ghost.footprint);
      g.rect(
        tileX(view, ghost.tile.x),
        tileY(view, ghost.tile.y),
        ghost.footprint.w * view.tile,
        ghost.footprint.h * view.tile,
      );
      g.fill({ color: colour, alpha: 0.18 });
      g.poly(hexagon(cx, cy, r));
      g.stroke({ width: this.style.wallLinePx, color: colour, alpha: 0.9 });
      if (!ghost.valid) {
        // Struck through, as the aiming cursor is when nothing is ready: red alone would
        // vanish on the crimson player's own wall.
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
        g.stroke({ width: this.style.wallLinePx, color: colour, alpha: 0.9 });
      }
      this.overlayGlow.poly(hexagon(cx, cy, r));
      this.overlayGlow.stroke({
        width: view.tile * this.style.glowWidthTiles,
        color: colour,
        alpha: this.style.glowAlpha,
      });
      return;
    }
    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Cyberpunk's scenery: dim nodes on the board's circuit — a pad with a lit point for a
 * tree, a cross for a pine, a lone point for a bush, a hollow diamond for a boulder. Dim,
 * since brightness on this board means structure, and neutral, since colour means an owner.
 */
function drawCyberpunkScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const line = hex(art.palette.rockMid);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    const s = t * 0.16;
    if (item.kind === 'tree') g.rect(cx - s, cy - s, s * 2, s * 2);
    else if (item.kind === 'pine') {
      g.moveTo(cx - s, cy).lineTo(cx + s, cy);
      g.moveTo(cx, cy - s).lineTo(cx, cy + s);
    } else if (item.kind === 'rock') {
      g.poly([cx, cy - s, cx + s, cy, cx, cy + s, cx - s, cy]);
    }
  }
  g.stroke({ width: 1, color: line, alpha: 0.55 });
  for (const item of items) {
    if (item.kind === 'rock' || item.kind === 'pine') continue;
    g.circle(tileX(view, item.x + 0.5), tileY(view, item.y + 0.5), Math.max(1, t * 0.05));
  }
  g.fill({ color: hex(art.palette.rockLight), alpha: 0.4 });
}

/**
 * Hexes, flat-topped, `colour` lines on nothing, `radius` tiles from centre to corner, as a
 * pattern drawn once on a canvas for the tile size (`FillPattern`) and lined up with the
 * board. The canvas holds one period of the tiling, three radii wide and a hex high, its
 * height rounded to whole pixels, which squashes the hexes by a pixel at most.
 */
function hexPattern(view: ViewTransform, colour: string, radius: number): FillPattern {
  const a = Math.max(3, Math.round(view.tile * radius));
  const width = a * 3;
  const height = Math.max(4, Math.round(a * Math.sqrt(3)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Every centre of the tiling near the canvas, so the hexes cut by its edges are whole
    // once the copies meet.
    for (let i = -1; i <= 3; i++) {
      for (let j = -1; j <= 3; j++) {
        if ((i + j) % 2 !== 0) continue;
        const cx = i * 1.5 * a;
        const cy = (j * height) / 2;
        for (let k = 0; k <= 6; k++) {
          const angle = (k * Math.PI) / 3;
          const x = cx + Math.cos(angle) * a;
          const y = cy + (Math.sin(angle) * height) / 2;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
    // A node at every other centre, as a circuit's pads, so it reads as a lit floor and not
    // a net.
    ctx.fillStyle = colour;
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ] as const) {
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
  const pattern = new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
  pattern.setTransform(new Matrix().translate(view.originX, view.originY));
  return pattern;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A server tower's parts, in pixels, for its drawing and for what lights up on it. */
interface Tower {
  podium: Rect;
  face: Rect;
  /** The tiers stepped up on the podium, each with the height of its own face below it. */
  tiers: (Rect & { face: number })[];
  sign: Rect;
  reactor: { cx: number; cy: number; r: number };
  masts: { x: number; foot: number; top: number; bars: number[] }[];
  vents: Rect[];
}

/**
 * Where a castle's parts stand, in units of half its footprint (a tile, for the usual 2x2):
 * the podium inset by 0.12 as the housing was, the sign down its left, the tower to the
 * right of it, the vents in the band before the tower's face. The masts rise off the left
 * and right edges, outside the 1.3 tiles of the hologram flag over the middle.
 */
function towerOf(
  view: ViewTransform,
  castle: { x: number; y: number; w: number; h: number },
  main: boolean,
  faceTiles: number,
): Tower {
  const x = tileX(view, castle.x);
  const y = tileY(view, castle.y);
  const ux = (castle.w * view.tile) / 2;
  const uy = (castle.h * view.tile) / 2;
  const drop = faceTiles * view.tile;
  const at = (a: number, b: number, w: number, h: number): Rect => ({
    x: x + a * ux,
    y: y + b * uy,
    w: w * ux,
    h: h * uy,
  });
  const podium = at(0.12, 0.12, 1.76, 0);
  podium.h = y + castle.h * view.tile - 0.12 * uy - drop - podium.y;
  const face = { x: podium.x, y: podium.y + podium.h, w: podium.w, h: drop };
  const tower = { ...at(0.52, main ? 0.2 : 0.26, 1.2, main ? 0.94 : 0.92), face: drop * 0.6 };
  const tiers = [tower];
  if (main) tiers.push({ ...at(0.64, 0.26, 0.96, 0.72), face: drop * 0.5 });
  const top = tiers[tiers.length - 1]!;
  const sign = at(0.2, 0.22, 0.22, 0);
  sign.h = face.y + face.h * 0.85 - sign.y;
  const ventY = tower.y + tower.h + tower.face + 0.04 * uy;
  const ventH = Math.min(0.13 * uy, face.y - ventY - 0.03 * uy);
  const vents = ventH > 1 ? [at(0.62, 0, 0.32, 0), at(1.3, 0, 0.32, 0)] : [];
  for (const v of vents) {
    v.y = ventY;
    v.h = ventH;
  }
  const masts = [
    { x: sign.x + sign.w / 2, foot: sign.y, top: y - (main ? 0.62 : 0.4) * uy, bars: [0.2] },
    {
      x: x + 1.8 * ux,
      foot: podium.y + 0.06 * uy,
      top: y - (main ? 0.5 : 0.28) * uy,
      bars: [0.25],
    },
  ];
  if (main) masts.push({ x: x + 1.56 * ux, foot: top.y, top: y - 0.12 * uy, bars: [] });
  return {
    podium,
    face,
    tiers,
    sign,
    reactor: {
      cx: top.x + top.w / 2,
      cy: top.y + top.h / 2,
      r: Math.min(ux, uy) * (main ? 0.28 : 0.3),
    },
    masts,
    vents,
  };
}

/**
 * Glyphs down a sign, as paths for the caller to stroke: marks built of a few strokes each,
 * like characters seen too small to read, and none of them a real one. Which, and in what
 * order, follows the castle's number, so each tower has a sign of its own.
 */
function glyphs(g: Graphics, sign: Rect, id: number): void {
  const size = sign.w * 0.62;
  const pad = (sign.w - size) / 2;
  const step = size + sign.w * 0.32;
  const count = Math.max(1, Math.floor((sign.h - pad) / step));
  for (let i = 0; i < count; i++) {
    const shape = GLYPHS[(id * 5 + i * 3 + i * i) % GLYPHS.length]!;
    const left = sign.x + pad;
    const top = sign.y + pad + i * step;
    for (const [ax, ay, bx, by] of shape) {
      g.moveTo(left + ax * size, top + ay * size).lineTo(left + bx * size, top + by * size);
    }
  }
}

/** The glyphs' strokes, from (ax, ay) to (bx, by) in a unit square. */
const GLYPHS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [
    [0, 0, 1, 0],
    [0.5, 0, 0.5, 1],
    [0, 1, 1, 1],
  ],
  [
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [0, 1, 1, 1],
    [0, 0.5, 1, 0.5],
  ],
  [
    [0.5, 0, 0.5, 1],
    [0, 0.4, 1, 0.4],
  ],
  [
    [0, 0, 0, 1],
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [0, 1, 1, 1],
  ],
  [
    [0, 0.2, 1, 0.2],
    [0.35, 0.2, 0, 1],
    [0.65, 0.2, 1, 1],
  ],
  [
    [0, 0, 1, 0],
    [0, 0.5, 1, 0.5],
    [0, 1, 1, 1],
    [0.5, 0, 0.5, 0.5],
  ],
  [
    [0, 0, 0.5, 0.5],
    [1, 0, 0.5, 0.5],
    [0.5, 0.5, 0.5, 1],
  ],
  [
    [0, 0.3, 1, 0.3],
    [0, 0.75, 1, 0.75],
    [0.3, 0, 0.3, 1],
  ],
];

/** A flat-topped hexagon's corners, its points left and right. */
function hexagon(cx: number, cy: number, r: number): number[] {
  const points: number[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    points.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  return points;
}

/** A turret's hexagon, centre to corner, in pixels: inside its square base with room round it. */
function turretRadius(view: ViewTransform, cannon: { w: number; h: number }): number {
  return (Math.min(cannon.w, cannon.h) * view.tile) / 2 - view.tile * 0.2;
}
