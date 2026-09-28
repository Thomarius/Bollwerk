import type { ArtConfig, CyberpunkStyleConfig } from '@rampart/config';
import { Rng, Structure, Terrain, type MatchState, type Shot } from '@rampart/sim';
import { Graphics } from 'pixi.js';

import { seaDepth } from './pixel.js';
import { trace, wallGeometry } from './walls.js';
import {
  FlagHoist,
  GunAims,
  Fireworks,
  Landings,
  ReloadRings,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
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
} from './theme.js';

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

/**
 * The cyberpunk look: the board as a circuit at night, for building and for combat.
 *
 * Brightness means structure and colour means ownership, so the walls are the brightest
 * lines on the board, each in its owner's neon, with land a dark grid and the sea near
 * black, crossed by traces with pulses running along them. A sealed castle has a glowing
 * core and flies a hologram; sealed ground is a lit grid floor; shots are plasma tracers;
 * a breach shorts out in sparks and goes dark; a silenced gun flickers as it powers down.
 *
 * Drawn from shapes, like the flat style, into one Graphics per layer and a second one,
 * blended additively, for the glow: a wider shape under each bright line rather than a
 * bloom filter, which costs frame rate at eight players.
 */
export class CyberpunkTheme implements Theme {
  readonly id = 'cyberpunk' as const;

  private art!: ArtConfig;
  private style!: CyberpunkStyleConfig;
  private readonly seed: number;

  private readonly terrainGfx = new Graphics();
  private readonly territoryGfx = new Graphics();
  private readonly territoryGlow = new Graphics();
  private readonly structureGfx = new Graphics();
  private readonly structureGlow = new Graphics();
  private readonly effectGfx = new Graphics();
  private readonly effectGlow = new Graphics();
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
  /** The player's own guns reloading; see `ReloadRings`. */
  private readonly reloads = new ReloadRings();
  private readonly fireworks = new Fireworks();
  private readonly flags = new FlagHoist();
  private clock = 0;

  constructor(seed = 1) {
    this.seed = seed;
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.cyberpunk;
    for (const glow of [
      this.territoryGlow,
      this.structureGlow,
      this.effectGlow,
      this.overlayGlow,
    ]) {
      glow.blendMode = 'add';
    }
    layers.terrain.addChild(this.terrainGfx);
    layers.territory.addChild(this.territoryGfx, this.territoryGlow);
    layers.structures.addChild(this.structureGlow, this.structureGfx);
    layers.effects.addChild(this.effectGfx, this.effectGlow);
    layers.overlay.addChild(this.overlayGlow, this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    for (const g of [
      this.terrainGfx,
      this.territoryGfx,
      this.territoryGlow,
      this.structureGfx,
      this.structureGlow,
      this.effectGfx,
      this.effectGlow,
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
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    g.clear();
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
    const g = this.territoryGfx;
    const glow = this.territoryGlow;
    g.clear();
    glow.clear();
    for (let player = 0; player < state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        const y = (i - x) / state.width;
        g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
        const left = tileX(view, x);
        const top = tileY(view, y);
        glow
          .moveTo(left, top + view.tile)
          .lineTo(left, top)
          .lineTo(left + view.tile, top);
        any = true;
      }
      if (!any) continue;
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      glow.stroke({ width: 1, color: this.colour(player, 'base'), alpha: this.style.gridAlpha });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    const g = this.structureGfx;
    const glow = this.structureGlow;
    g.clear();
    glow.clear();
    const { palette } = this.art;
    const line = this.style.wallLinePx;
    const glowWidth = Math.max(line * 2, view.tile * this.style.glowWidthTiles);
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

    // Castles: a dark housing with a lit rim over a front face, as tall as the pixel
    // keep's. The core, which pulses, is an effect.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * view.tile;
      const h = castle.h * view.tile;
      const inset = view.tile * 0.12;
      const drop = this.castleFace(castle) * view.tile;
      const lip = y + h - inset - drop;
      g.rect(x + inset, lip, w - inset * 2, drop);
      g.fill({ color: dimmed(this.colour(owner, 'dark'), 0.55) });
      g.stroke({ width: 1, color: this.colour(owner, 'base'), alpha: 0.6 });
      g.moveTo(x + inset, lip + drop / 2).lineTo(x + w - inset, lip + drop / 2);
      g.stroke({ width: 1, color: this.colour(owner, 'base'), alpha: 0.5 });
      g.rect(x + inset, y + inset, w - inset * 2, lip - y - inset);
      g.fill({ color: mixed(this.colour(owner, 'dark'), this.colour(owner, 'base'), 0.3) });
      g.stroke({ width: line, color: this.colour(owner, 'light') });
      // Corner brackets, which is what makes it read as a component rather than a block.
      const arm = Math.min(w, h) * 0.28;
      for (const [cx, cy, sx, sy] of [
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, lip + inset, 1, -1],
        [x + w, lip + inset, -1, -1],
      ] as const) {
        g.moveTo(cx + sx * arm, cy)
          .lineTo(cx, cy)
          .lineTo(cx, cy + sy * arm);
      }
      g.stroke({ width: line, color: this.colour(owner, 'base') });
      glow.rect(x + inset, y + inset, w - inset * 2, lip - y - inset);
      glow.stroke({
        width: glowWidth,
        color: this.colour(owner, 'base'),
        alpha: this.style.glowAlpha,
      });
      glow.rect(x + inset, y + h - inset, w - inset * 2, view.tile * 0.3);
      glow.fill({ color: this.colour(owner, 'base'), alpha: 0.1 });
    }

    // Guns: a ring on a mount that stands a little off the ground, its side showing
    // below it. The barrel turns, so it is drawn with the effects.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = (Math.min(cannon.w, cannon.h) * view.tile) / 2 - view.tile * 0.15;
      const side = (view.tile * this.art.generators.wall.frontFacePx * 0.6) / this.art.tileSizePx;
      g.circle(cx, cy + side, r);
      g.fill({
        color: cannon.active
          ? dimmed(this.colour(cannon.owner, 'dark'), 0.5)
          : hex(palette.grassDark),
      });
      g.stroke({
        width: 1,
        color: cannon.active ? this.colour(cannon.owner, 'base') : hex(palette.rockDark),
        alpha: 0.6,
      });
      g.circle(cx, cy, r);
      g.fill({ color: cannon.active ? this.colour(cannon.owner, 'dark') : hex(palette.grassMid) });
      g.stroke({
        width: line,
        color: cannon.active ? this.colour(cannon.owner, 'light') : hex(palette.rockMid),
        alpha: cannon.active ? 1 : 0.6,
      });
      if (!cannon.active) continue;
      glow.circle(cx, cy, r);
      glow.stroke({
        width: glowWidth * 0.8,
        color: this.colour(cannon.owner, 'base'),
        alpha: this.style.glowAlpha,
      });
    }
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
    g.clear();
    glow.clear();
    this.clock += frame.deltaMs;

    this.drawPulses(view);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.reloads.draw(
      g,
      view,
      state,
      this.art,
      frame.humanPlayer,
      frame.tickFraction,
      frame.deltaMs,
    );
    this.drawCores(state, view, frame);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawPowerDowns(state, view);
    this.drawHolograms(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawBursts(view, frame.deltaMs);
    this.drawShorts(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.drawSparks(view, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
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
      glow.circle(tileX(view, head.x + 0.5), tileY(view, head.y + 0.5), size);
      glow.fill({ color: colour, alpha });
    }
  }

  /** A castle's core glows, brighter and breathing while it is sealed. */
  private drawCores(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const glow = this.effectGlow;
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const sealed = frame.castleSealed[castle.id] ?? false;
      const cx = tileX(view, castle.x + castle.w / 2);
      const cy = tileY(view, castle.y + (castle.h - this.castleFace(castle)) / 2);
      const breath = 0.5 + 0.5 * Math.sin(this.clock / 420 + castle.id);
      const r = view.tile * (sealed ? 0.34 + 0.06 * breath : 0.26);
      glow.circle(cx, cy, r * 2.1);
      glow.fill({ color: this.colour(owner, 'base'), alpha: sealed ? 0.25 + 0.15 * breath : 0.1 });
      glow.circle(cx, cy, r);
      glow.fill({
        color: this.colour(owner, sealed ? 'light' : 'base'),
        alpha: sealed ? 0.9 : 0.35,
      });
      if (!sealed) continue;
      glow.circle(cx, cy, r * 0.45);
      glow.fill({ color: hex(this.art.palette.uiInk), alpha: 0.9 });
    }
  }

  /** Barrels as lit rails from the mount toward the last target, kicking back on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const glow = this.effectGlow;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const length = cannon.active ? 0.95 - 0.3 * kick : 0.55;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2;
      const ex = cx + Math.sin(aim.angle) * length;
      const ey = cy - Math.cos(aim.angle) * length;
      const width = Math.max(2, view.tile * 0.2);
      g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(tileX(view, ex), tileY(view, ey));
      g.stroke({
        width,
        color: cannon.active ? this.colour(cannon.owner, 'light') : hex(this.art.palette.rockMid),
        alpha: cannon.active ? 1 : 0.5,
        cap: 'round',
      });
      if (!cannon.active) continue;
      glow.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(tileX(view, ex), tileY(view, ey));
      glow.stroke({
        width: width * 2.4,
        color: this.colour(cannon.owner, 'base'),
        alpha: 0.35,
        cap: 'round',
      });
      if (kick > 0) {
        glow.circle(tileX(view, ex), tileY(view, ey), view.tile * (0.2 + 0.35 * kick));
        glow.fill({ color: hex(this.art.palette.uiInk), alpha: 0.8 * kick });
      }
    }
    this.aims.prune(state);
  }

  /**
   * A gun that loses or regains power flickers as it goes, on and off ever more rarely
   * as it settles — the breach that silenced it, said without a struck-through mark.
   */
  private drawPowerDowns(state: MatchState, view: ViewTransform): void {
    const glow = this.effectGlow;
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
      const r = (Math.min(cannon.w, cannon.h) * view.tile) / 2 - view.tile * 0.15;
      glow.circle(cx, cy, r);
      glow.stroke({
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
      const beamX = tileX(view, castle.x + castle.w / 2);
      const beamFoot = tileY(view, castle.y + (castle.h - this.castleFace(castle)) / 2);
      const flagW = view.tile * 1.3;
      const flagH = view.tile * 0.8;
      const lowest = tileY(view, castle.y) - flagH * 0.3;
      const highest = tileY(view, castle.y) - view.tile * 1.1;
      const top = lowest + (highest - lowest) * raised;
      // The beam it is projected along, from the core up to the flag.
      glow.poly([
        beamX - view.tile * 0.08,
        beamFoot,
        beamX + view.tile * 0.08,
        beamFoot,
        beamX + flagW / 2,
        top + flagH,
        beamX - flagW / 2,
        top + flagH,
      ]);
      glow.fill({ color: colour, alpha: 0.12 * alpha });
      glow.rect(beamX - flagW / 2, top, flagW, flagH);
      glow.fill({ color: colour, alpha: 0.5 * alpha });
      glow.stroke({ width: 1, color: this.colour(owner, 'light'), alpha: alpha });
      // Scanlines, drifting up through it.
      const lines = 3;
      for (let k = 0; k < lines; k++) {
        const y = top + ((k / lines + this.clock / 1600) % 1) * flagH;
        glow.moveTo(beamX - flagW / 2, y).lineTo(beamX + flagW / 2, y);
      }
      glow.stroke({ width: 1, color: this.colour(owner, 'light'), alpha: 0.5 * alpha });
    }
  }

  /** Shots as plasma tracers: a white-hot head in a glow of the firer's colour. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const glow = this.effectGlow;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
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
      glow.moveTo(head.x, head.y);
      for (let k = 1; k <= 2; k++) {
        const p = at(t - (back * k) / 4);
        glow.lineTo(p.x, p.y);
      }
      glow.stroke({
        width: Math.max(1, view.tile * 0.1),
        color: this.colour(shot.owner, 'light'),
        cap: 'round',
      });
      const size = view.tile * (0.16 + 0.08 * height);
      glow.circle(head.x, head.y, size * 2.2);
      glow.fill({ color: colour, alpha: 0.4 });
      glow.circle(head.x, head.y, size);
      glow.fill({ color: hex(this.art.palette.uiInk) });

      drawShotTarget(g, view, state, shot, t, this.art, frame.humanPlayer);
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
      glow.circle(cx, cy, view.tile * (0.4 + 2 * t));
      glow.stroke({ width: Math.max(2, view.tile / 6), color: burst.colour, alpha: 1 - t });
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
        glow.rect(cx - w / 2 + view.tile * (f - 0.5), y, w, Math.max(1, view.tile * 0.12));
        glow.fill({ color: colours[k]!, alpha: 0.8 * (1 - t) });
      }
    }
    this.bursts = this.bursts.filter((burst) => burst.age < span);
  }

  /** A breach shorting out: arcs jumping across the gap, dying away until it is dark. */
  private drawShorts(view: ViewTransform, deltaMs: number): void {
    const glow = this.effectGlow;
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
      glow.moveTo(x0 + view.tile * r(1), y0 + view.tile * 0.15);
      glow.lineTo(x0 + view.tile * r(2), y0 + view.tile * 0.5);
      glow.lineTo(x0 + view.tile * r(3), y0 + view.tile * 0.85);
      glow.stroke({ width: Math.max(1, view.tile / 12), color: s.colour, alpha: life });
    }
    this.shorts = this.shorts.filter((s) => s.age < span);
  }

  /** A block the sweep took, its outline flickering out. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const glow = this.effectGlow;
    const span = this.style.powerDownMs;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const t = fade.age / span;
      if (t >= 1 || Math.sin(fade.age / 25 + fade.x) < t * 1.5 - 0.5) continue;
      glow.rect(tileX(view, fade.x) + 1, tileY(view, fade.y) + 1, view.tile - 2, view.tile - 2);
      glow.stroke({ width: this.style.wallLinePx, color: fade.colour, alpha: 1 - t });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
  }

  private drawSparks(view: ViewTransform, deltaMs: number): void {
    const glow = this.effectGlow;
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
      glow.rect(tileX(view, spark.x) - size / 2, tileY(view, spark.y) - size / 2, size, size);
      glow.fill({ color: spark.colour, alpha: 1 - t });
    }
    this.sparks = this.sparks.filter((spark) => spark.age < spark.life);
  }

  // ------------------------------------------------------------------ overlay

  /**
   * Everything a player aims or builds by: the aiming cursor in combat, the piece in
   * hand while building, the gun being placed, the castles to choose from.
   */
  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    this.overlayGlow.clear();
    drawOvertimeBorder(g, state, view, this.art, performance.now());
    for (const castle of ghost.selectable) {
      g.rect(
        tileX(view, castle.x),
        tileY(view, castle.y),
        castle.w * view.tile,
        castle.h * view.tile,
      );
      g.stroke({ width: 2, color: hex(this.art.palette.uiAccent) });
    }
    drawBuildHints(g, view, ghost, this.art, performance.now());
    if (!ghost.tile) return;
    const colour = ghost.valid ? hex(this.art.palette.uiValid) : hex(this.art.palette.uiInvalid);
    if (state.phase === 'build' && ghost.cells.length > 0) {
      this.drawGhostWall(state, view, ghost, humanPlayer);
      return;
    }
    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The gun as its lit ring, in the ink that says whether it fits.
      const cx = tileX(view, ghost.tile.x + ghost.footprint.w / 2);
      const cy = tileY(view, ghost.tile.y + ghost.footprint.h / 2);
      const r = (Math.min(ghost.footprint.w, ghost.footprint.h) * view.tile) / 2 - view.tile * 0.15;
      g.rect(
        tileX(view, ghost.tile.x),
        tileY(view, ghost.tile.y),
        ghost.footprint.w * view.tile,
        ghost.footprint.h * view.tile,
      );
      g.fill({ color: colour, alpha: 0.18 });
      g.circle(cx, cy, r);
      g.stroke({ width: this.style.wallLinePx, color: colour, alpha: 0.9 });
      if (!ghost.valid) {
        // Struck through, as the aiming cursor is when nothing is ready: red alone would
        // vanish on the crimson player's own wall.
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
        g.stroke({ width: this.style.wallLinePx, color: colour, alpha: 0.9 });
      }
      this.overlayGlow.circle(cx, cy, r);
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
