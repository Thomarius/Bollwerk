import type { ArtConfig, GlassStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { Memos, viewKey } from './stamps.js';
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
  mixed,
} from './theme.js';
import { GlassSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { paneOf, paneShade } from './panes.js';
import { outline, trace, wallGeometry } from './walls.js';
import { cannonBase } from './cannonBase.js';

/** A shard of glass thrown out by a shot or the sweep, spinning as it falls. */
/** How long the hourglass takes to turn over as a phase begins. */
const TURN_MS = 700;

/** The phases the hourglass measures, and the rules' length of each. */
const PHASE_MS: Partial<
  Record<string, 'castleSelectMs' | 'cannonPlaceMs' | 'combatMs' | 'buildMs'>
> = {
  castle_select: 'castleSelectMs',
  cannon_place: 'cannonPlaceMs',
  combat: 'combatMs',
  build: 'buildMs',
};

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  colour: number;
  life: number;
  floor: number;
  size: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

/** A piece just set in its lead: a glint runs across it. */
interface Glint {
  cells: readonly Cell[];
  age: number;
}

const RECOIL_MS = 160;
const RIPPLE_MS = 520;
const GLINT_MS = 340;

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'shard', flag: 'leaded' };

/**
 * The stained glass look (PLAN 11.18 Y7): the board as a church window. Land and sea cut
 * into irregular panes of a few tiles each (`panes.ts`) — one a tile read as a mosaic —
 * each a little lighter or darker than its neighbours, held in dark lead: deep blue glass
 * for the sea, green for the land, a heavier came along every coast; and light falling
 * through, a sheen across each pane's upper corner. Sealed ground is lit
 * brighter, panes in the owner's colour; walls are blocks of the owner's glass leaded
 * one by one, so a shot visibly takes one, standing to the pixel style's height so a
 * banner's wipe lines up; castles are rose windows; a hit throws shards. The player colours
 * are the shared ones, jewel-bright already.
 */
export class GlassTheme implements Theme {
  readonly id = 'glass' as const;

  private art!: ArtConfig;
  private style!: GlassStyleConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new GlassSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The hourglass in the corner (PLAN 11.24), drawn about its middle so it can turn over. */
  private readonly hourglassGfx = new Graphics();
  private hourglass: TimerSpot | null = null;
  /** The phase it last measured, and how far through turning it over for a new one. */
  private glassPhase = '';
  private turning = TURN_MS;
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawGlassScenery(g, view, items, this.art, this.style),
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
  private shards: Shard[] = [];
  private ripples: Ripple[] = [];
  private glints: Glint[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private readonly flags = new FlagHoist();
  private clock = 0;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.glass;
    layers.terrain.addChild(this.terrainGfx, this.hourglassGfx);
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(this.effectGfx, this.gunMemo.container, this.lateGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.gunMemo.destroy();
    this.lateGfx.destroy();
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [this.terrainGfx, this.hourglassGfx, this.effectGfx, this.overlayGfx]) {
      g.destroy();
    }
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  private lead(view: ViewTransform): number {
    return Math.max(1, view.tile * this.style.leadTiles);
  }

  /**
   * Glass cut into panes over these cells: each tile filled in its pane's shade between a
   * dark and a light glass, a sheen across the upper corner of each pane's first tile, and
   * lead wherever two neighbouring tiles lie in different panes — or where the cells end,
   * when `edged`.
   */
  private glass(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    paneAt: (x: number, y: number) => number,
    dark: number,
    light: number,
    options: { alpha?: number; sheen?: number; lead?: number; edged?: boolean } = {},
  ): void {
    const t = view.tile;
    const alpha = options.alpha ?? 1;
    const inside = new Set(cells.map((c) => `${c.x},${c.y}`));
    const has = (x: number, y: number): boolean => inside.has(`${x},${y}`);
    // Filled pane by pane, so each takes one shade.
    const byPane = new Map<number, Cell[]>();
    for (const c of cells) {
      const pane = paneAt(c.x, c.y);
      const list = byPane.get(pane);
      if (list === undefined) byPane.set(pane, [c]);
      else list.push(c);
    }
    for (const [pane, tiles] of byPane) {
      for (const { x, y } of tiles) g.rect(tileX(view, x), tileY(view, y), t, t);
      const shade = 0.25 + this.style.paneVariance * (paneShade(pane) - 0.5);
      g.fill({ color: mixed(dark, light, shade), alpha });
    }
    // The light through each pane: a sheen in the corner of its first tile, row by row.
    for (const tiles of byPane.values()) {
      const first = tiles.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
      const px = tileX(view, first.x);
      const py = tileY(view, first.y);
      g.poly([
        px + t * 0.14,
        py + t * 0.14,
        px + t * 0.85,
        py + t * 0.14,
        px + t * 0.14,
        py + t * 0.85,
      ]);
    }
    g.fill({ color: 0xffffff, alpha: this.style.sheenAlpha * (options.sheen ?? 1) });
    // The lead: along every edge between two panes, and round the cells when edged.
    for (const { x, y } of cells) {
      const here = paneAt(x, y);
      const px = tileX(view, x);
      const py = tileY(view, y);
      const right = has(x + 1, y);
      const below = has(x, y + 1);
      if ((right && paneAt(x + 1, y) !== here) || (!right && options.edged)) {
        g.moveTo(px + t, py).lineTo(px + t, py + t);
      }
      if ((below && paneAt(x, y + 1) !== here) || (!below && options.edged)) {
        g.moveTo(px, py + t).lineTo(px + t, py + t);
      }
      if (options.edged && !has(x - 1, y)) g.moveTo(px, py).lineTo(px, py + t);
      if (options.edged && !has(x, y - 1)) g.moveTo(px, py).lineTo(px + t, py);
    }
    g.stroke({
      width: this.lead(view),
      color: hex(this.art.palette.shadow),
      alpha: options.lead ?? 1,
    });
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.hourglass = cornerSpot(state, view);
    this.seaLife.corner = this.hourglass;
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
    const size = this.style.paneTiles;
    const paneAt = (x: number, y: number): number => paneOf(x, y, land(x, y), size);

    // The sea's glass runs out past the board to the window's edge.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const sea: Cell[] = [];
    const ground: Cell[] = [];
    for (let y = -marginY; y < state.height + marginY; y++) {
      for (let x = -marginX; x < state.width + marginX; x++) {
        if (land(x, y)) ground.push({ x, y });
        else sea.push({ x, y });
      }
    }
    this.glass(g, view, sea, paneAt, hex(palette.waterDeep), hex(palette.waterShallow), {
      sheen: 0.6,
      lead: 0.8,
    });
    this.glass(g, view, ground, paneAt, hex(palette.grassDark), hex(palette.grassLight));
    // A faint tint of the owner over each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.08 });
    }
    // The heavier came along every coast, which holds the land's glass to the sea's.
    trace(g, outline(ground, land, view));
    g.stroke({ width: this.lead(view) * this.style.coastLead, color: hex(palette.shadow) });
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground lit brighter: the same panes as the land beneath, in the owner's colour,
   * the light strong through them, leaded round where the ground ends.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const size = this.style.paneTiles;
    const paneAt = (x: number, y: number): number => paneOf(x, y, true, size);
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      this.glass(
        g,
        view,
        cells,
        paneAt,
        this.colour(player, 'base'),
        this.colour(player, 'light'),
        {
          alpha: this.style.territoryAlpha,
          sheen: 1.6,
          edged: true,
        },
      );
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
      this.drawGlassWall(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's wall: grey glass, cracked, its lead askew.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const px = tileX(view, x);
      const py = tileY(view, y);
      g.poly([
        px + t * 0.1,
        py + t * 0.3,
        px + t * 0.8,
        py + t * 0.2,
        px + t * 0.9,
        py + t * 0.8,
        px + t * 0.2,
        py + t * 0.85,
      ]);
      g.fill({ color: hex(palette.rockMid), alpha: 0.85 });
      g.stroke({ width: this.lead(view), color: hex(palette.shadow) });
      g.moveTo(px + t * 0.2, py + t * 0.3).lineTo(px + t * 0.7, py + t * 0.75);
      g.stroke({ width: 1, color: hex(palette.shadow) });
    }

    // Castles: a rose window — petals of the owner's glass round a gold centre, leaded.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const cx = tileX(view, castle.x + castle.w / 2);
      const cy = tileY(view, castle.y + castle.h / 2) - this.faceFraction() * t * 0.4;
      const r = (Math.min(castle.w, castle.h) * t) / 2 - t * 0.08;
      g.circle(cx + t * 0.06, cy + t * 0.12, r);
      g.fill({ color: 0x000000, alpha: 0.35 });
      const petals = 8;
      for (let k = 0; k < petals; k++) {
        const a0 = (k / petals) * Math.PI * 2;
        const a1 = ((k + 1) / petals) * Math.PI * 2;
        g.moveTo(cx, cy).arc(cx, cy, r, a0, a1).lineTo(cx, cy);
        g.fill({ color: this.colour(owner, k % 2 === 0 ? 'base' : 'light') });
      }
      for (let k = 0; k < petals; k++) {
        const a = (k / petals) * Math.PI * 2;
        g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.circle(cx, cy, r);
      g.circle(cx, cy, r * 0.55);
      g.stroke({ width: this.lead(view), color: hex(palette.shadow) });
      g.circle(cx, cy, r * 0.28);
      g.fill({ color: hex(palette.uiAccent) });
      g.stroke({ width: this.lead(view), color: hex(palette.shadow) });
      g.circle(cx - r * 0.35, cy - r * 0.4, r * 0.14);
      g.fill({ color: 0xffffff, alpha: 0.45 });
    }

    // Guns: a round mount of grey glass in its lead, ringed in the owner's colour.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2) - this.faceFraction() * t * 0.4;
      const r = Math.min(cannon.w, cannon.h) * t * 0.36;
      cannonBase(g, view, cannon, this.colour(cannon.owner, 'dark'), hex(palette.shadow));
      g.circle(cx + t * 0.05, cy + t * 0.1, r);
      g.fill({ color: 0x000000, alpha: 0.3 });
      g.circle(cx, cy, r);
      g.fill({ color: hex(cannon.active ? palette.rockMid : palette.rockDark) });
      g.circle(cx, cy, r * 0.72);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      g.circle(cx, cy, r);
      g.circle(cx, cy, r * 0.72);
      g.stroke({ width: this.lead(view), color: hex(palette.shadow) });
    }
  }

  /**
   * Walls as blocks of the owner's glass, standing up as the pixel style's do: a top lit
   * through, a darker face, every block leaded on its own.
   */
  private drawGlassWall(
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
    // The light through each block's top.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.poly([
        b.left + t * 0.14,
        b.top + h * 0.16,
        b.left + t * 0.6,
        b.top + h * 0.16,
        b.left + t * 0.14,
        b.top + h * 0.62,
      ]);
    }
    g.fill({ color: 0xffffff, alpha: this.style.sheenAlpha * 1.6 * alpha });
    // The lead round each block, top and face, so a shot visibly takes one.
    for (const b of wall.blocks) {
      g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
      if (b.faced) g.moveTo(b.left, b.lip).lineTo(b.left + t, b.lip);
    }
    g.stroke({ width: this.lead(view), color: hex(this.art.palette.shadow), alpha });
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
    if (inSea) this.ripples.push({ x, y, age: 0 });
    // A hit breaks the block: shards of its glass fly and fall, glinting.
    for (const block of debris) this.shatter(block, this.style.shardsPerBlock, 2.6);
  }

  private shatter(block: Debris, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const v = speed * (0.6 + Math.random() * 0.8);
      const shade = k % 3 === 0 ? 'light' : 'base';
      this.shards.push({
        x: block.x + 0.5,
        y: block.y + 0.5,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        spin: Math.random() * Math.PI,
        age: 0,
        colour: block.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(block.owner, shade),
        life: this.art.generators.fx.debrisMs,
        floor: block.y + 0.9,
        size: 0.18 + Math.random() * 0.16,
      });
    }
  }

  /** The sweep: a block lifts out of its lead and breaks as it falls. */
  noteCrumble(block: Debris): void {
    this.shatter(block, 3, 1.4);
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    this.glints.push({ cells, age: 0 });
  }

  /**
   * An hourglass of leaded glass in the corner: two bulbs, each cut into panes in their
   * lead, between dark plates on posts; its sand running down with the phase's clock, and
   * the glass turned over as each new phase begins. Between phases the sand lies run out.
   */
  private drawHourglass(
    state: MatchState,
    view: ViewTransform,
    spot: TimerSpot,
    deltaMs: number,
  ): void {
    const g = this.hourglassGfx;
    const { palette } = this.art;
    const still = motionReduced();
    const s = spot.size * view.tile;
    const timed = PHASE_MS[state.phase];
    if (timed !== undefined && state.phase !== this.glassPhase) {
      // Turned over as a timed phase begins — not the first seen, which simply stands.
      this.turning = this.glassPhase === '' || still ? TURN_MS : 0;
    }
    this.glassPhase = state.phase;
    this.turning += Math.max(0, deltaMs);
    const turn = Math.min(1, this.turning / TURN_MS);

    // How much sand has run: the phase's time spent, from the rules' length of it.
    let run = 1;
    if (timed !== undefined && turn >= 1 && !(state.phase === 'build' && state.overtime)) {
      const total = (state.ruleset.phases[timed] * state.ruleset.tickRateHz) / 1000;
      const left = Math.max(0, state.phaseEndTick - state.tick);
      run = total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 1;
    }

    g.position.set(tileX(view, spot.x), tileY(view, spot.y) + s * 0.04);
    // Over and over, ending upright: drawn run out while it turns, which upside down is
    // the new phase's sand all in the top.
    g.rotation = turn < 1 ? Math.PI * (1 - (1 - turn) * (1 - turn)) : 0;
    if (turn < 1) run = 1;

    const h = s * 0.4;
    const w = s * 0.24;
    const neck = s * 0.03;
    const plate = s * 0.05;
    const lead = Math.max(1, this.lead(view));
    const leadColour = hex(palette.craterDark);
    const glass = hex(palette.rockLight);
    const sand = hex(palette.sand);
    // A bulb's outline from the plate (y = edge) to the neck (y = 0), `dir` up or down.
    const bulb = (dir: 1 | -1): number[] => [
      -w,
      dir * h,
      w,
      dir * h,
      w * 0.9,
      dir * h * 0.55,
      neck,
      dir * h * 0.08,
      neck,
      0,
      -neck,
      0,
      -neck,
      dir * h * 0.08,
      -w * 0.9,
      dir * h * 0.55,
    ];
    // The posts behind the glass, and the plates.
    g.rect(-w * 1.25, -h - plate * 0.5, s * 0.03, h * 2 + plate);
    g.rect(w * 1.25 - s * 0.03, -h - plate * 0.5, s * 0.03, h * 2 + plate);
    g.fill({ color: hex(palette.rockDark) });
    // The glass, faint, so the sea shows through it.
    for (const dir of [-1, 1] as const) {
      g.poly(bulb(dir));
      g.fill({ color: glass, alpha: 0.28 });
    }
    // The sand: what is left in the top, level across the bulb; what has run in the
    // bottom, a heap; and the thread of it falling between, while it runs.
    const left = 1 - run;
    if (left > 0.01) {
      const top = -h * 0.08 - (h * 0.92 - h * 0.08) * left;
      const widthAt = (y: number): number => neck + (w * 0.9 - neck) * Math.min(1, -y / (h * 0.55));
      g.poly([
        -widthAt(top),
        top,
        widthAt(top),
        top,
        neck,
        -h * 0.08,
        neck,
        0,
        -neck,
        0,
        -neck,
        -h * 0.08,
      ]);
      g.fill({ color: sand });
    }
    if (run > 0.01) {
      const heap = h * 0.92 * run;
      const base = h * 0.96;
      g.poly([
        -w * 0.9,
        base,
        w * 0.9,
        base,
        w * 0.9 * (1 - run * 0.3),
        base - heap * 0.6,
        0,
        base - heap,
        -w * 0.9 * (1 - run * 0.3),
        base - heap * 0.6,
      ]);
      g.fill({ color: sand });
    }
    if (left > 0.01 && run < 1 && turn >= 1 && !still) {
      g.rect(-Math.max(0.5, neck * 0.35), 0, Math.max(1, neck * 0.7), h * 0.96 - h * 0.92 * run);
      g.fill({ color: sand, alpha: 0.9 });
    }
    // The lead: round each bulb, and across it where its panes meet.
    for (const dir of [-1, 1] as const) {
      g.poly(bulb(dir));
      g.moveTo(-w * 0.9, dir * h * 0.55).lineTo(w * 0.9, dir * h * 0.55);
      g.moveTo(0, dir * h * 0.55).lineTo(0, dir * h);
    }
    g.stroke({ width: lead, color: leadColour, join: 'round' });
    // The light through the glass: a sheen down each bulb's left.
    for (const dir of [-1, 1] as const) {
      g.moveTo(-w * 0.7, dir * h * 0.85).lineTo(-w * 0.6, dir * h * 0.6);
    }
    g.stroke({ width: Math.max(1, s * 0.015), color: 0xffffff, alpha: this.style.sheenAlpha });
    // The plates, top and bottom, dark wood edged in lead.
    for (const y of [-h - plate, h]) {
      g.roundRect(-w * 1.35, y, w * 2.7, plate, plate * 0.3);
      g.fill({ color: hex(palette.craterMid) });
      g.stroke({ width: lead, color: leadColour });
    }
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    this.hourglassGfx.clear();
    if (this.hourglass !== null) {
      this.drawHourglass(state, view, this.hourglass, frame.deltaMs);
    }
    const g = this.effectGfx;
    g.clear();
    this.lateGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    this.clock += frame.deltaMs;
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.drawGlints(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawFlags(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawRipples(view, frame.deltaMs);
    this.drawShards(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A piece set in its lead: a glint of light runs across its panes. */
  private drawGlints(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const glint of this.glints) {
      glint.age += deltaMs;
      const k = glint.age / GLINT_MS;
      if (k >= 1) continue;
      for (const c of glint.cells) {
        const x = tileX(view, c.x);
        const y = tileY(view, c.y);
        const d = t * (-0.2 + 1.4 * k);
        g.moveTo(x + d, y).lineTo(x, y + d);
      }
      g.stroke({ width: Math.max(2, t * 0.14), color: 0xffffff, alpha: 0.7 * (1 - k) });
    }
    this.glints = this.glints.filter((glint) => glint.age < GLINT_MS);
  }

  /** Barrels: a dark bar of glass from the mount, turning to its target, kicking on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
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
        const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
        const length = cannon.active ? 1.0 - 0.28 * kick : 0.45;
        const cx = cannon.x + cannon.w / 2;
        const cy = cannon.y + cannon.h / 2 - this.faceFraction() * 0.4;
        const ex = tileX(view, cx + Math.sin(aim.angle) * length);
        const ey = tileY(view, cy - Math.cos(aim.angle) * length);
        const width = Math.max(3, t * 0.3);
        g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
        g.stroke({ width: width + this.lead(view) * 2, color: hex(palette.shadow), cap: 'round' });
        g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
        g.stroke({
          width,
          color: hex(cannon.active ? palette.rockLight : palette.rockMid),
          cap: 'round',
        });
      });
    }
    memo.end();
    this.aims.prune(state);
  }

  /** A pennant of the owner's glass over each sealed castle, hoisted as it is sealed. */
  private drawFlags(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const pole = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - t * 1.1;
      const foot = tileY(view, castle.y + 0.3);
      g.moveTo(pole, foot).lineTo(pole, top);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: hex(this.art.palette.shadow) });
      const height = t * 0.5;
      const y = foot - height - raised * (foot - top - height);
      g.poly([pole, y, pole + t * 0.75, y + height / 2, pole, y + height]);
      g.fill({ color: this.colour(owner, this.flags.lowering(castle.id) ? 'dark' : 'light') });
      g.stroke({ width: this.lead(view), color: hex(this.art.palette.shadow) });
    }
  }

  /** Shots: a bead of the owner's glass, lit from within, over its shadow. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / 3);
      g.ellipse(gx, gy, t * (0.28 - 0.12 * high), t * (0.14 - 0.06 * high));
      g.fill({ color: 0x000000, alpha: 0.3 - 0.15 * high });
      const hy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5 - lift);
      const r = t * (0.24 + 0.12 * high);
      g.circle(gx, hy, r * 1.6);
      g.fill({ color: this.colour(shot.owner, 'light'), alpha: 0.25 });
      g.circle(gx, hy, r);
      g.fill({ color: this.colour(shot.owner, 'base') });
      g.stroke({ width: this.lead(view), color: hex(this.art.palette.shadow) });
      g.circle(gx - r * 0.3, hy - r * 0.3, r * 0.3);
      g.fill({ color: 0xffffff, alpha: 0.8 });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  private drawRipples(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.ripples) {
      s.age += deltaMs;
      const k = s.age / RIPPLE_MS;
      if (k >= 1) continue;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.circle(cx, cy, t * (0.25 + 1.2 * k));
      g.circle(cx, cy, t * (0.1 + 0.6 * k));
      g.stroke({ width: 2, color: hex(this.art.palette.waterFoam), alpha: 1 - k });
    }
    this.ripples = this.ripples.filter((s) => s.age < RIPPLE_MS);
  }

  /** Shards: thin triangles of glass spinning as they fall, glinting, bouncing once. */
  private drawShards(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const s of this.shards) {
      s.age += deltaMs;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 12 * dt;
      s.spin += dt * 9;
      if (s.y > s.floor && s.vy > 0) {
        s.y = s.floor;
        s.vy *= -0.3;
        s.vx *= 0.55;
      }
      const alpha = Math.max(0, 1 - s.age / s.life);
      const x = tileX(view, s.x);
      const y = tileY(view, s.y);
      const r = s.size * t;
      const point = (a: number, d: number): [number, number] => [
        x + Math.cos(s.spin + a) * d,
        y + Math.sin(s.spin + a) * d,
      ];
      g.poly([...point(0, r), ...point(2.3, r * 0.6), ...point(4.1, r * 0.8)]);
      g.fill({ color: s.colour, alpha: alpha * 0.9 });
      g.stroke({ width: 1, color: 0xffffff, alpha: alpha * 0.6 });
    }
    this.shards = this.shards.filter((s) => s.age < s.life);
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
        // The piece in hand as the glass it will be, a little see-through.
        const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
        this.drawGlassWall(g, view, cells, (x, y) => inPiece.has(`${x},${y}`), humanPlayer, 0.7);
        return;
      }
      // Where it does not fit: an empty lead frame and a cross in each pane — red glass
      // would be the crimson player's own, so the difference is in form.
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
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.36;
      g.circle(cx, cy, r);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
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
 * Stained glass's scenery, in glass too: a tree a round pane of green leaded over a brown
 * stem, a pine a leaded triangle, a bush a small green roundel — one in three a flower, a
 * roundel of gold — and a boulder a grey pane of rough glass.
 */
function drawGlassScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
  style: GlassStyleConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  const lead = Math.max(1, t * style.leadTiles);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.rect(cx - t * 0.06, cy, t * 0.12, t * 0.32);
      g.fill({ color: 0x6b4423 });
      g.circle(cx, cy - t * 0.05, t * 0.32);
      g.fill({ color: hex(palette.grassLight) });
      g.moveTo(cx - t * 0.32, cy - t * 0.05).lineTo(cx + t * 0.32, cy - t * 0.05);
      g.circle(cx, cy - t * 0.05, t * 0.32);
      g.stroke({ width: lead, color: hex(palette.shadow) });
    } else if (item.kind === 'pine') {
      g.poly([cx, cy - t * 0.4, cx + t * 0.3, cy + t * 0.25, cx - t * 0.3, cy + t * 0.25]);
      g.fill({ color: mixed(hex(palette.grassDark), hex(palette.grassLight), 0.4) });
      g.stroke({ width: lead, color: hex(palette.shadow) });
    } else if (item.kind === 'bush') {
      const flower = item.variant % 3 === 1;
      g.circle(cx, cy, t * 0.18);
      g.fill({ color: flower ? hex(palette.uiAccent) : hex(palette.grassLight) });
      g.stroke({ width: lead, color: hex(palette.shadow) });
    } else {
      g.poly([
        cx - t * 0.3,
        cy + t * 0.2,
        cx - t * 0.15,
        cy - t * 0.2,
        cx + t * 0.25,
        cy - t * 0.15,
        cx + t * 0.3,
        cy + t * 0.2,
      ]);
      g.fill({ color: hex(palette.rockMid) });
      g.stroke({ width: lead, color: hex(palette.shadow) });
    }
  }
}
