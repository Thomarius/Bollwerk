import type { ArtConfig, GlassStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, FillPattern, Graphics, Sprite, Texture } from 'pixi.js';

import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { Discs, Memos, viewKey } from './stamps.js';
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
  shotProgress,
} from './theme.js';
import { GlassSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { paneOf, paneShade } from './panes.js';
import { hash } from './noise.js';
import { outline, trace, wallGeometry } from './walls.js';
import { cannonBase } from './cannonBase.js';
import { release } from './release.js';

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

/** A shard of glass thrown out by a shot or the sweep, spinning as it falls. */
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
/** How many beats the shimmering panes are shared among. */
const SHIMMER_GROUPS = 6;
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
  /**
   * A few panes of the window shimmering, brightening and fading: drawn once with the
   * terrain, in a handful of groups each on its own beat, and only faded each frame.
   */
  private readonly shimmer = new Container();
  /** The streaks and seed bubbles in the glass, drawn once for the match's seed. */
  private grain: { seed: number; pattern: FillPattern } | null = null;
  private readonly oldGrains: FillPattern[] = [];
  /**
   * The shaft of warm light sweeping the window: a soft gradient drawn once on a canvas,
   * one sprite only moved, added over the land and sealed ground but under the walls, so
   * no wall's colour is touched.
   */
  private readonly light = new Sprite();
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
  /**
   * What sealing changes on a rose window — its gold centre lit, or a petal cracked by a
   * breach — a `Graphics` a castle, redrawn only when that changes (`Memos`).
   */
  private readonly roseMemo = new Memos();
  /** The glow round a lit rose's centre, added. */
  private readonly roseGlow = new Discs();
  /** Castles seen sealed since they were last chosen: unsealed again, they are breached. */
  private readonly wasSealed = new Set<number>();
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
    // Made here, not with the theme, which is also made where there is no page to draw on.
    this.light.texture = lightShaft();
    this.shimmer.blendMode = 'add';
    this.light.blendMode = 'add';
    this.light.anchor.set(0.5);
    this.roseGlow.container.blendMode = 'add';
    layers.terrain.addChild(this.terrainGfx, this.shimmer, this.hourglassGfx);
    layers.territory.addChild(this.territory.container, this.scenery.gfx, this.light);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.seaLife.container,
      this.effectGfx,
      this.roseMemo.container,
      this.roseGlow.container,
      this.gunMemo.container,
      this.lateGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.gunMemo.destroy();
    this.roseMemo.destroy();
    this.roseGlow.destroy();
    this.seaLife.destroy();
    const shaft = this.light.texture;
    this.light.destroy();
    shaft.destroy(true);
    for (const p of [...this.oldGrains, this.grain?.pattern]) p?.texture.destroy(true);
    this.grain = null;
    release(this.shimmer);
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
    options: {
      alpha?: number;
      sheen?: number;
      lead?: number;
      edged?: boolean;
      /** The glass's own grain, laid over the panes before the lead. */
      grain?: FillPattern | null;
      /** Painted on each pane big enough to take it: waves on the sea, veins on the land. */
      paint?: { kind: 'waves' | 'veins'; colour: number; alpha: number };
    } = {},
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
    // The streaks and bubbles of hand-blown glass, a pattern laid over the panes in runs of a
    // row, so a fill is a few vertices a run rather than a shape a bubble.
    if (options.grain) {
      for (const r of rowRuns(cells)) {
        g.rect(tileX(view, r.x), tileY(view, r.y), r.w * t, t);
      }
      g.fill({ fill: options.grain, alpha: this.style.textureAlpha * alpha });
    }
    if (options.paint) this.paint(g, view, byPane, options.paint);
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

  /**
   * The glass painter's strokes, in a pale grisaille: on each sea pane of four tiles or more
   * two short wave crests, on each land pane a leaf's midrib and its veins — set about the
   * pane's middle, kept within its tiles, and turned by the pane's own hash so no two lie
   * alike. Drawn with the terrain, never per frame.
   */
  private paint(
    g: Graphics,
    view: ViewTransform,
    byPane: ReadonlyMap<number, Cell[]>,
    paint: { kind: 'waves' | 'veins'; colour: number; alpha: number },
  ): void {
    const t = view.tile;
    for (const [pane, tiles] of byPane) {
      if (tiles.length < 4) continue;
      let sx = 0;
      let sy = 0;
      for (const c of tiles) {
        sx += c.x + 0.5;
        sy += c.y + 0.5;
      }
      const mx = sx / tiles.length;
      const my = sy / tiles.length;
      // Only where the pane holds its own middle, so a stroke never crosses its lead.
      if (!tiles.some((c) => c.x === Math.floor(mx) && c.y === Math.floor(my))) continue;
      const cx = tileX(view, mx);
      const cy = tileY(view, my);
      const turn = hash(pane, 7, 11);
      if (paint.kind === 'waves') {
        // Two crests, one over the other, each a little run of three humps.
        const span = t * 0.55;
        for (const row of [-0.22, 0.2]) {
          const y = cy + row * t + (turn - 0.5) * t * 0.2;
          const x0 = cx - span + row * t * 0.6;
          g.moveTo(x0, y);
          for (let k = 0; k < 3; k++) {
            const a = x0 + ((2 * span) / 3) * k;
            g.quadraticCurveTo(a + span / 6, y - t * 0.14, a + span / 3, y);
          }
        }
      } else {
        // A leaf's midrib on a slant, and two pairs of veins off it towards its tip.
        const angle = -0.6 + turn * 1.2 - Math.PI / 4;
        const len = t * 0.6;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        g.moveTo(cx - ux * len, cy - uy * len).lineTo(cx + ux * len, cy + uy * len);
        for (const at of [-0.25, 0.25]) {
          const bx = cx + ux * len * at;
          const by = cy + uy * len * at;
          for (const side of [-1, 1]) {
            const va = angle + side * 0.7;
            g.moveTo(bx, by).lineTo(bx + Math.cos(va) * len * 0.45, by + Math.sin(va) * len * 0.45);
          }
        }
      }
    }
    g.stroke({
      width: Math.max(1, t * 0.05),
      color: paint.colour,
      alpha: paint.alpha,
      cap: 'round',
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
    const grain = this.grainFor(state.seed);
    const pale = hex(palette.waterFoam);
    this.glass(g, view, sea, paneAt, hex(palette.waterDeep), hex(palette.waterShallow), {
      sheen: 0.6,
      lead: 0.8,
      grain,
      paint: { kind: 'waves', colour: pale, alpha: this.style.paintAlpha },
    });
    this.glass(g, view, ground, paneAt, hex(palette.grassDark), hex(palette.grassLight), {
      grain,
      paint: {
        kind: 'veins',
        colour: mixed(hex(palette.grassLight), 0xffffff, 0.35),
        alpha: this.style.paintAlpha,
      },
    });
    this.layShimmer(state, view, [...sea, ...ground], paneAt);
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

  /** The grain for this match, drawn for its seed the first time it is asked for. */
  private grainFor(seed: number): FillPattern {
    if (this.grain?.seed !== seed) {
      // An old one is kept to the end, since a part drawn with it may not be drawn again.
      if (this.grain !== null) this.oldGrains.push(this.grain.pattern);
      this.grain = { seed, pattern: glassGrain(seed) };
    }
    return this.grain.pattern;
  }

  /**
   * One pane in `shimmerOneIn`, chosen from the seed, white over its glass in one of a few
   * groups, each faded on its own slow beat in `drawEffects`: a few panes catching the
   * light, here and there, where every pane on its own beat would be a Graphics a pane.
   */
  private layShimmer(
    state: MatchState,
    view: ViewTransform,
    cells: readonly Cell[],
    paneAt: (x: number, y: number) => number,
  ): void {
    const t = view.tile;
    while (this.shimmer.children.length < SHIMMER_GROUPS) this.shimmer.addChild(new Graphics());
    const groups = this.shimmer.children as Graphics[];
    for (const g of groups) g.clear();
    const used = new Set<number>();
    for (const { x, y } of cells) {
      const pane = paneAt(x, y);
      if (hash(pane, state.seed, 21) * this.style.shimmerOneIn >= 1) continue;
      const group = Math.floor(hash(pane, state.seed, 22) * SHIMMER_GROUPS) % SHIMMER_GROUPS;
      (groups[group] as Graphics).rect(tileX(view, x), tileY(view, y), t, t);
      used.add(group);
    }
    for (const n of used) (groups[n] as Graphics).fill({ color: 0xfff6dc });
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
          grain: this.grain?.pattern ?? null,
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

    for (const castle of state.castles) {
      const main = state.players[castle.islandId - 1]?.startingCastleId === castle.id;
      this.drawRose(g, view, castle, main);
    }

    // Guns: a lancet of the owner's glass on the plain square testers need to see the gun's
    // footprint by; silenced, its glass clouds to grey, which reads at eight players' size.
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, this.colour(cannon.owner, 'dark'), hex(palette.shadow));
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.2;
      const w = Math.min(cannon.w, cannon.h) * t * 0.5;
      const h = Math.min(cannon.w, cannon.h) * t * 0.8;
      const spring = foot - h + w * 0.86;
      // Its shadow, then the three panes: two lights below, the pointed head above.
      g.poly(lancet(cx + t * 0.05, foot + t * 0.08, w, h));
      g.fill({ color: 0x000000, alpha: 0.3 });
      const cloud = hex(palette.rockMid);
      const panes = cannon.active
        ? [
            this.colour(cannon.owner, 'base'),
            this.colour(cannon.owner, 'light'),
            mixed(this.colour(cannon.owner, 'light'), 0xffffff, 0.3),
          ]
        : [cloud, mixed(cloud, hex(palette.rockLight), 0.3), mixed(cloud, 0xffffff, 0.15)];
      g.rect(cx - w / 2, spring, w / 2, foot - spring);
      g.fill({ color: panes[0] as number });
      g.rect(cx, spring, w / 2, foot - spring);
      g.fill({ color: panes[1] as number });
      g.poly(lancet(cx, spring, w, h - (foot - spring)));
      g.fill({ color: panes[2] as number });
      if (!cannon.active) {
        // Cloudy: a milky film across the glass, lighter towards the top.
        g.poly(lancet(cx, foot, w, h));
        g.fill({ color: hex(palette.rockLight), alpha: 0.35 });
      } else {
        // The light through it, a sheen down the left light.
        g.rect(cx - w * 0.36, spring + (foot - spring) * 0.12, w * 0.1, (foot - spring) * 0.6);
        g.fill({ color: 0xffffff, alpha: 0.45 });
      }
      g.poly(lancet(cx, foot, w, h));
      g.moveTo(cx - w / 2, spring).lineTo(cx + w / 2, spring);
      g.moveTo(cx, spring).lineTo(cx, foot);
      g.stroke({ width: this.lead(view) * 1.4, color: hex(palette.shadow), join: 'round' });
    }
  }

  /**
   * A castle as a rose window: a ring of stone tracery pierced by small trefoils of pale
   * glass, petals of the owner's glass within it, leaded, round a gold centre left unlit
   * here — it is lit over the window while the castle is sealed (`drawRoses`). A main
   * castle's rose is the grander, more petals and trefoils inside a gilt rim.
   */
  private drawRose(
    g: Graphics,
    view: ViewTransform,
    castle: MatchState['castles'][number],
    main: boolean,
  ): void {
    const { palette } = this.art;
    const owner = castle.islandId - 1;
    const { cx, cy, r } = this.roseAt(view, castle);
    const lead = this.lead(view);
    const shadow = hex(palette.shadow);
    const petals = main ? 12 : 8;
    const inner = r * 0.74;
    g.circle(cx + view.tile * 0.06, cy + view.tile * 0.12, r);
    g.fill({ color: 0x000000, alpha: 0.35 });
    // The tracery: a ring of stone, its trefoils of the owner's palest glass.
    g.circle(cx, cy, r);
    // Stone grey rather than pale, so the trefoils' pale glass shows in it as openings.
    const stone = hex(palette.rockMid);
    g.fill({ color: main ? mixed(stone, hex(palette.uiAccent), 0.35) : stone });
    const lobe = r * 0.085;
    const glassLight = mixed(this.colour(owner, 'light'), 0xffffff, 0.55);
    for (let k = 0; k < petals; k++) {
      const a = ((k + 0.5) / petals) * Math.PI * 2;
      const tx = cx + Math.cos(a) * r * 0.87;
      const ty = cy + Math.sin(a) * r * 0.87;
      // Three lobes round the point, the first pointing out from the rose.
      for (let n = 0; n < 3; n++) {
        const b = a + (n / 3) * Math.PI * 2;
        g.circle(tx + Math.cos(b) * lobe * 0.9, ty + Math.sin(b) * lobe * 0.9, lobe);
      }
    }
    g.fill({ color: glassLight });
    // The petals: wedges of the owner's glass, alternately lit.
    for (let k = 0; k < petals; k++) {
      const a0 = (k / petals) * Math.PI * 2;
      const a1 = ((k + 1) / petals) * Math.PI * 2;
      g.moveTo(cx, cy).arc(cx, cy, inner, a0, a1).lineTo(cx, cy);
      g.fill({ color: this.colour(owner, k % 2 === 0 ? 'base' : 'light') });
    }
    // The cusps where the petals meet the ring, a scallop of stone, and the lead.
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * inner * 0.32, cy + Math.sin(a) * inner * 0.32);
      g.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    }
    g.circle(cx, cy, inner);
    g.circle(cx, cy, inner * 0.6);
    g.stroke({ width: lead, color: shadow });
    g.circle(cx, cy, r);
    g.stroke({ width: lead * (main ? 1.4 : 1.2), color: shadow });
    if (main) {
      g.circle(cx, cy, r + lead * 1.2);
      g.stroke({ width: Math.max(1.5, lead * 1.2), color: hex(palette.uiAccent) });
    }
    // The centre, unlit: dark old gold.
    g.circle(cx, cy, inner * 0.32);
    g.fill({ color: mixed(hex(palette.craterMid), hex(palette.sand), 0.45) });
    g.stroke({ width: lead, color: shadow });
  }

  /** Where a castle's rose stands, and its radius, in screen pixels. */
  private roseAt(
    view: ViewTransform,
    castle: MatchState['castles'][number],
  ): { cx: number; cy: number; r: number } {
    const t = view.tile;
    return {
      cx: tileX(view, castle.x + castle.w / 2),
      cy: tileY(view, castle.y + castle.h / 2) - this.faceFraction() * t * 0.4,
      r: (Math.min(castle.w, castle.h) * t) / 2 - t * 0.08,
    };
  }

  /**
   * Walls as jewels of the owner's glass, standing up as the pixel style's do: each block's
   * top a cabochon — bevelled, lit along its upper and left edges and dark along the others,
   * a glow in its dome and a bright sheen high on it — over a darker face, every block leaded
   * on its own, so a shot visibly takes one. Minimal's flat squares with a corner of light
   * did not say glass (the style review).
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
    // The bevel: an inner band round each top, lit on the side the light comes from.
    const bevel = t * 0.14;
    for (const b of wall.blocks) {
      const x = b.left;
      const y = b.top;
      const h = b.lip - b.top;
      const i = Math.min(bevel, h * 0.3);
      g.poly([x, y, x + t, y, x + t - i, y + i, x + i, y + i, x + i, y + h - i, x, y + h]);
    }
    g.fill({ color: this.colour(player, 'light'), alpha: 0.55 * alpha });
    for (const b of wall.blocks) {
      const x = b.left;
      const y = b.top;
      const h = b.lip - b.top;
      const i = Math.min(bevel, h * 0.3);
      g.poly([
        x + t,
        y,
        x + t,
        y + h,
        x,
        y + h,
        x + i,
        y + h - i,
        x + t - i,
        y + h - i,
        x + t - i,
        y + i,
      ]);
    }
    g.fill({ color: this.colour(player, 'dark'), alpha: 0.7 * alpha });
    // The dome: a glow of lighter glass in the middle, and the sheen of the light on it.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.ellipse(b.left + t * 0.5, b.top + h * 0.5, t * 0.27, h * 0.26);
    }
    g.fill({ color: this.colour(player, 'light'), alpha: 0.4 * alpha });
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.ellipse(b.left + t * 0.4, b.top + h * 0.36, t * 0.13, h * 0.08);
    }
    g.fill({ color: 0xffffff, alpha: 0.65 * alpha });
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
    this.drawRoses(state, view, frame);
    this.moveLight(view);
    this.drawShots(state, view, frame);
    this.drawRipples(view, frame.deltaMs);
    this.drawShards(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * The light through the window: the shaft carried slowly across it, from off one side to
   * off the other and round again, and the shimmering panes faded each on their group's
   * beat. Only moved and faded — nothing here is drawn again.
   */
  private moveLight(view: ViewTransform): void {
    const still = motionReduced();
    const w = view.width;
    const h = view.height;
    const reach = Math.hypot(w, h) * 1.2;
    const phase = still ? 0.4 : (this.clock % this.style.lightSweepMs) / this.style.lightSweepMs;
    const width = w * this.style.lightWidth;
    this.light.position.set(-width + (w + 2 * width) * phase, h / 2);
    this.light.scale.set(width / LIGHT_TEXTURE_PX, reach / 4);
    // Falling from the upper left, as the sun through a south window in the afternoon.
    this.light.rotation = 0.42;
    this.light.alpha = this.style.lightAlpha;
    this.light.tint = hex(this.art.palette.emberHot);
    this.shimmer.children.forEach((g, n) => {
      const beat = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock / (2300 + n * 370) + n * 1.9);
      g.alpha = this.style.shimmerAlpha * beat * beat * beat;
    });
  }

  /**
   * What sealing changes on a rose: sealed — the flag up, as `FlagHoist` says — its gold
   * centre lit, glowing softly on a slow breath; breached, a crack in lead across one petal,
   * the centre dark. A `Graphics` a castle, drawn again only when that changes (`Memos`),
   * and the glow a stamped disc, added.
   */
  private drawRoses(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const { palette } = this.art;
    const memo = this.roseMemo;
    const lead = this.lead(view);
    const still = motionReduced();
    memo.begin();
    this.roseGlow.begin(view.tile);
    for (const castle of state.castles) {
      const sealed = frame.castleSealed[castle.id] === true;
      // A castle chosen afresh — a continue's, or the opening — has not been breached.
      if (state.phase === 'castle_select') this.wasSealed.delete(castle.id);
      if (sealed) this.wasSealed.add(castle.id);
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      const lit = raised !== null && !this.flags.lowering(castle.id);
      const cracked = !sealed && this.wasSealed.has(castle.id);
      if (!lit && !cracked) continue;
      const { cx, cy, r } = this.roseAt(view, castle);
      const inner = r * 0.74;
      const petals = state.players[castle.islandId - 1]?.startingCastleId === castle.id ? 12 : 8;
      memo.draw(castle.id, `${viewKey(view)}|${cx},${cy}|${lit}|${cracked}|${petals}`, (g) => {
        if (lit) {
          g.circle(cx, cy, inner * 0.32);
          g.fill({ color: hex(palette.uiAccent) });
          g.circle(cx, cy, inner * 0.17);
          g.fill({ color: hex(palette.emberHot) });
          g.circle(cx, cy, inner * 0.32);
          g.stroke({ width: lead, color: hex(palette.shadow) });
          g.circle(cx - inner * 0.1, cy - inner * 0.12, inner * 0.06);
          g.fill({ color: 0xffffff, alpha: 0.85 });
          return;
        }
        // The crack: across the petal the castle's own number picks, from the centre's
        // ring out to the tracery, a jag with a branch off it.
        const k = castle.id % petals;
        const a = ((k + 0.5) / petals) * Math.PI * 2;
        const along = (d: number, side: number): [number, number] => [
          cx + Math.cos(a) * d - Math.sin(a) * side,
          cy + Math.sin(a) * d + Math.cos(a) * side,
        ];
        // The broken pane clouds between the crack's arms, under the lead of it.
        g.poly([
          ...along(inner * 0.32, 0),
          ...along(inner * 0.52, inner * 0.08),
          ...along(inner * 0.74, inner * 0.2),
          ...along(inner, inner * 0.06),
          ...along(inner * 0.7, -inner * 0.04),
        ]);
        g.fill({ color: hex(palette.rockLight), alpha: 0.55 });
        g.moveTo(...along(inner * 0.32, 0));
        g.lineTo(...along(inner * 0.52, inner * 0.08));
        g.lineTo(...along(inner * 0.7, -inner * 0.04));
        g.lineTo(...along(r * 0.95, inner * 0.06));
        g.moveTo(...along(inner * 0.52, inner * 0.08));
        g.lineTo(...along(inner * 0.74, inner * 0.2));
        g.stroke({ width: Math.max(1.5, lead * 1.4), color: hex(palette.shadow), join: 'round' });
      });
      if (lit) {
        const breath = still ? 1 : 0.8 + 0.2 * Math.sin(this.clock / 900 + castle.id);
        this.roseGlow.disc(
          cx,
          cy,
          inner * 0.62,
          hex(palette.uiAccent),
          0.32 * breath * (raised ?? 1),
        );
      }
    }
    memo.end();
    this.roseGlow.end();
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

  /**
   * Barrels: a rod of amber glass edged in lead, from the middle of the lancet, turning to
   * its target and kicking on firing, a streak of light along it; silenced, short and
   * clouded grey like its lancet.
   */
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
        const sx = tileX(view, cx);
        const sy = tileY(view, cy);
        g.moveTo(sx, sy).lineTo(ex, ey);
        g.stroke({ width: width + this.lead(view) * 2, color: hex(palette.shadow), cap: 'round' });
        g.moveTo(sx, sy).lineTo(ex, ey);
        g.stroke({
          width,
          color: cannon.active
            ? hex(palette.emberMid)
            : mixed(hex(palette.rockMid), hex(palette.rockLight), 0.3),
          cap: 'round',
        });
        if (cannon.active) {
          // The light along it, a little to one side of its axis.
          const nx = -Math.cos(aim.angle) * width * 0.22;
          const ny = -Math.sin(aim.angle) * width * 0.22;
          g.moveTo(sx + nx + (ex - sx) * 0.2, sy + ny + (ey - sy) * 0.2);
          g.lineTo(sx + nx + (ex - sx) * 0.85, sy + ny + (ey - sy) * 0.85);
          g.stroke({
            width: Math.max(1, width * 0.25),
            color: hex(palette.emberHot),
            cap: 'round',
          });
        }
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
      const p = shotProgress(shot, now);
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
      // The lancet it will be, in outline over its square.
      const { w: fw, h: fh } = ghost.footprint;
      const cx = tileX(view, anchor.x + fw / 2);
      const foot = tileY(view, anchor.y + fh) - t * 0.2;
      const size = Math.min(fw, fh) * t;
      g.rect(tileX(view, anchor.x), tileY(view, anchor.y), fw * t, fh * t);
      g.fill({ color: colour, alpha: 0.18 });
      g.poly(lancet(cx, foot, size * 0.5, size * 0.8));
      g.fill({ color: colour, alpha: 0.3 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        const r = size * 0.36;
        const cy = tileY(view, anchor.y + fh / 2);
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
 * A fleur-de-lis's outline, in units of its size about its middle, y down: the tall middle
 * petal, the two curled out and down either side, the band across, and the foot below.
 */
const FLEUR: readonly (readonly [number, number])[] = (() => {
  const right: [number, number][] = [
    [0.22, -0.62],
    [0.2, -0.3],
    [0.12, -0.1],
    [0.3, -0.38],
    [0.52, -0.66],
    [0.72, -0.52],
    [0.66, -0.26],
    [0.52, -0.3],
    [0.42, -0.1],
    [0.45, -0.1],
    [0.45, 0.08],
    [0.15, 0.08],
    [0.32, 0.44],
    [0.12, 0.4],
  ];
  const left = right.map(([x, y]): [number, number] => [-x, y]).reverse();
  return [[0, -1], ...right, [0, 0.22], ...left];
})();

/**
 * Stained glass's scenery, in glass too: a tree a round pane of green leaded over a brown
 * stem, a pine a leaded triangle, a bush a fleur-de-lis in green glass — one in three gold —
 * and a boulder a grey pane of rough glass.
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
      drawGlassTree(g, cx, cy, t, item.variant, palette, lead);
    } else if (item.kind === 'pine') {
      g.poly([cx, cy - t * 0.4, cx + t * 0.3, cy + t * 0.25, cx - t * 0.3, cy + t * 0.25]);
      g.fill({ color: mixed(hex(palette.grassDark), hex(palette.grassLight), 0.4) });
      g.stroke({ width: lead, color: hex(palette.shadow) });
    } else if (item.kind === 'bush') {
      // A fleur-de-lis, the window's own flower: green glass, one in three gold.
      const flower = item.variant % 3 === 1;
      const u = t * 0.44;
      g.poly(FLEUR.flatMap(([x, y]) => [cx + x * u, cy + y * u]));
      g.fill({
        color: flower
          ? hex(palette.uiAccent)
          : mixed(hex(palette.grassLight), hex(palette.rockLight), 0.25),
      });
      // Leaded finer than the window, and not at all at eight players' tile size, where a
      // pixel of lead round a glyph of six made it a black blot.
      if (t >= 20) {
        g.poly(FLEUR.flatMap(([x, y]) => [cx + x * u, cy + y * u]));
        g.moveTo(cx - u * 0.45, cy - u * 0.1).lineTo(cx + u * 0.45, cy - u * 0.1);
        g.stroke({ width: Math.max(1, lead * 0.6), color: hex(palette.shadow), join: 'round' });
      }
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

/**
 * Where a glass tree's crown is cut into leaf panes, as angles round it from the left of
 * its foot over the top to the right of it (y down, so a half turn is the left): four
 * panes fanning from the foot, as a window's tree is leaded. Three read as a fleur-de-lis
 * beside the bushes, five were too fine to tell apart at eight players.
 */
const TREE_PANE_CUTS = [0.67, 1.08, 1.5, 1.92, 2.33].map((turns) => turns * Math.PI);

/**
 * A tree as a window draws one: a round crown cut into leaf panes fanning from its foot,
 * two greens in turn — one sunlit towards gold, so the crown stands out of the green panes
 * of the land under it — over a short brown trunk. `variant` mirrors it, so a copse is not
 * stamped alike. Leaded only from 20-pixel tiles, as the fleurs-de-lis are: at eight
 * players' size the lead round every pane made the crown a black blot.
 */
function drawGlassTree(
  g: Graphics,
  cx: number,
  cy: number,
  t: number,
  variant: number,
  palette: ArtConfig['palette'],
  lead: number,
): void {
  const r = t * 0.32;
  const oy = cy - t * 0.1;
  // The foot of the fan, on the chord the crown's flattened bottom makes.
  const fy = oy + r * 0.82;
  const trunk = [
    cx - t * 0.07,
    fy,
    cx + t * 0.07,
    fy,
    cx + t * 0.1,
    cy + t * 0.4,
    cx - t * 0.1,
    cy + t * 0.4,
  ];
  g.poly(trunk);
  g.fill({ color: 0x6b4423 });
  const sunlit = mixed(hex(palette.grassLight), hex(palette.uiAccent), 0.35);
  const shaded = mixed(hex(palette.grassLight), hex(palette.grassMid), 0.25);
  const flip = variant % 2 === 0 ? 1 : -1;
  const panes: number[][] = [];
  for (let k = 0; k + 1 < TREE_PANE_CUTS.length; k++) {
    const from = TREE_PANE_CUTS[k]!;
    const to = TREE_PANE_CUTS[k + 1]!;
    const pane = [cx, fy];
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const a = from + ((to - from) * s) / steps;
      pane.push(cx + flip * Math.cos(a) * r, oy + Math.sin(a) * r);
    }
    panes.push(pane);
    g.poly(pane);
    g.fill({ color: k % 2 === 0 ? sunlit : shaded });
  }
  if (t < 20) return;
  const ink = hex(palette.shadow);
  g.poly(trunk);
  g.stroke({ width: Math.max(1, lead * 0.7), color: ink, join: 'round' });
  for (const pane of panes) g.poly(pane);
  g.stroke({ width: Math.max(1, lead * 0.7), color: ink, join: 'round' });
}

/** The width of the light's gradient, in texture pixels. */
const LIGHT_TEXTURE_PX = 128;

/**
 * The shaft of light, across its width: nothing at the edges, rising softly to a warm core,
 * white so the sprite's tint colours it. Drawn once, on a canvas, for every size it is
 * stretched to, since a gradient made of nested shapes shows its steps.
 */
function lightShaft(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = LIGHT_TEXTURE_PX;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const ramp = ctx.createLinearGradient(0, 0, LIGHT_TEXTURE_PX, 0);
    for (let k = 0; k <= 16; k++) {
      const x = k / 16;
      // A raised cosine, flattened at the top: a shaft with a body, soft at both edges.
      const v = Math.min(1, 1.25 * (0.5 - 0.5 * Math.cos(x * Math.PI * 2)));
      ramp.addColorStop(x, `rgba(255,255,255,${v.toFixed(3)})`);
    }
    ctx.fillStyle = ramp;
    ctx.fillRect(0, 0, LIGHT_TEXTURE_PX, 4);
  }
  return Texture.from(canvas);
}

/**
 * Hand-blown glass, as a pattern laid over every pane: long faint streaks where the glass
 * was drawn out, and seed bubbles trapped in it, each a pale rim with a dark fleck — from
 * the match's seed, so it lies the same every time the board is drawn. Drawn once on a
 * canvas and laid in as a fill in screen space (`FillPattern`), as Noir's hatching is: a few
 * vertices a run of tiles, where bubbles drawn as shapes would be thousands.
 */
function glassGrain(seed: number): FillPattern {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  let n = 0;
  const next = (): number => hash(seed, n++, 31);
  if (ctx !== null) {
    ctx.lineCap = 'round';
    // Streaks, drawn across the tile's edge and again a tile over, so the pattern joins.
    for (let k = 0; k < 9; k++) {
      const x = next() * size;
      const y = next() * size;
      const len = size * (0.15 + next() * 0.2);
      const bend = (next() - 0.5) * 16;
      const light = k % 3 !== 0;
      ctx.strokeStyle = light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.8 + next() * 1.2;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.quadraticCurveTo(x + ox + len / 2, y + oy + bend, x + ox + len, y + oy + len * 0.35);
          ctx.stroke();
        }
      }
    }
    // Seed bubbles, a few larger among many small.
    for (let k = 0; k < 34; k++) {
      const x = 3 + next() * (size - 6);
      const y = 3 + next() * (size - 6);
      const r = next() < 0.2 ? 1.8 + next() * 1.2 : 0.7 + next() * 0.8;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(x + r * 0.35, y + r * 0.35, Math.max(0.4, r * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
}

/** Cells joined into runs along their rows, so a fill over them is a rectangle a run. */
function rowRuns(cells: readonly Cell[]): { x: number; y: number; w: number }[] {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  const runs: { x: number; y: number; w: number }[] = [];
  for (const c of sorted) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.y === c.y && last.x + last.w === c.x) last.w++;
    else runs.push({ x: c.x, y: c.y, w: 1 });
  }
  return runs;
}

/**
 * A lancet's outline, `w` wide and `h` tall from its foot at (`cx`, `foot`): straight sides
 * up to an equilateral pointed arch, each side of the arch an arc about the other's foot.
 */
function lancet(cx: number, foot: number, w: number, h: number): number[] {
  const head = w * 0.866;
  const spring = foot - Math.max(0, h - head);
  const points = [cx - w / 2, foot, cx - w / 2, spring];
  const steps = 6;
  for (let k = 1; k <= steps; k++) {
    const a = Math.PI + (k / steps) * (Math.PI / 3);
    points.push(cx + w / 2 + Math.cos(a) * w, spring + Math.sin(a) * w);
  }
  for (let k = 1; k <= steps; k++) {
    const a = (5 * Math.PI) / 3 + (k / steps) * (Math.PI / 3);
    points.push(cx - w / 2 + Math.cos(a) * w, spring + Math.sin(a) * w);
  }
  points.push(cx + w / 2, foot);
  return points;
}
