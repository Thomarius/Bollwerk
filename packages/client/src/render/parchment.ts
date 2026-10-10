import type { ArtConfig, ParchmentStyleConfig } from '@bollwerk/config';
import { Rng, Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

import { timerSpot } from '../timerSpot.js';

import { ParchmentSeaLife } from './seaLife.js';
import { seaDepth } from './ocean.js';
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
  MainCastles,
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
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { hatch, outline, trace, wallGeometry, type Segment } from './walls.js';
import { cannonBase } from './cannonBase.js';
import { roseSpot } from './corner.js';
import { along, loops, rounded, wavered, type Point } from './inkline.js';
import { clearDrawn } from './clearDrawn.js';

/** An ink stain where a shot came down on land, fading over the rounds after. */
interface Stain {
  x: number;
  y: number;
  round: number;
  seed: number;
}

/** A drop of ink or a chip of stone, in tile coordinates. */
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colour: number;
  gravity: number;
}

/** Ink rings on the water where a shot went in. */
interface Ripple {
  x: number;
  y: number;
  age: number;
}

/** A block the sweep took, fading from the paper. */
interface Fade {
  x: number;
  y: number;
  age: number;
  colour: number;
}

const RECOIL_MS = 160;
const RIPPLE_MS = 700;
/** Canvas pixels per tile in the paper's grain: fine enough to read as paper. */
const GRAIN_PX = 6;

/** A number from 0 to 1 for a tile, the same every time: for the unevenness of a wash. */
function jitter(x: number, y: number, salt: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/** How this style sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'blot', flag: 'swallowtail' };

/**
 * The parchment look: an old hand-drawn map, in ink and watercolour on sepia paper.
 *
 * The paper has grain, stains and darkened edges; the coast is a bold ink line with the
 * engraver's contours rippling out from it, and wave strokes on the open sea; a compass
 * rose sits in the sea's bottom-right corner. Walls are inked stone standing up as
 * the pixel style's do, their faces cross-hatched, casting a shadow on the paper. Sealed
 * ground is a watercolour wash inside a dotted border, and a sealed castle bears a wax
 * seal in its owner's colour, pressed on as it seals and cracking when it is breached.
 * Shots are ink dots on a dotted course, and leave ink stains where they land.
 *
 * The one light style: every colour it draws with is ink dark enough to read on paper,
 * which is why its palette's ink stands where others' light is.
 */
export class ParchmentTheme implements Theme {
  readonly id = 'parchment' as const;

  private art!: ArtConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new ParchmentSeaLife();
  private style!: ParchmentStyleConfig;
  private readonly seed: number;

  private readonly terrainGfx = new Graphics();
  private readonly roseGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawParchmentScenery(g, view, items, this.art),
    () => hex(this.art.palette.rockMid),
  );
  /**
   * Ink stains, over the paper but under the walls, as the pixel style's scorch marks
   * are: a block rebuilt on a stain covers it. Drawn in the effects layer, above the
   * walls, a stain showed through the wall rebuilt over it for rounds after.
   */
  private readonly stainGfx = new Graphics();
  /** The stains as last drawn: they change at a hit and a round, not every frame (PLAN 11.22). */
  private stainsDrawn = '';
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** What lies over the guns: the wax seals, under the crowns. */
  private readonly lateGfx = new Graphics();
  /** The main castles' crowns: the shared mark, drawn again only as one changes. */
  private readonly crowns = new MainCastles();
  /**
   * What lies over the crowns: shots, splashes, the finish — drawn after them into
   * `lateGfx` before the crowns became a `Graphics` of their own.
   */
  private readonly aboveCrownsGfx = new Graphics();
  private readonly overlayGfx = new Graphics();
  private grain: Sprite | null = null;
  private grainKey = '';
  /** Each island's name in script across its land, under the paper's grain. */
  private readonly nameLayer = new Container();
  private readonly names: Text[] = [];

  private terrain: Uint8Array | null = null;
  private width = 0;
  private round = 0;
  private stains: Stain[] = [];
  private drops: Drop[] = [];
  private ripples: Ripple[] = [];
  private fades: Fade[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  private readonly flags = new FlagHoist();
  private clock = 0;
  private layers!: ThemeLayers;

  constructor(seed = 1) {
    this.seed = seed;
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.parchment;
    this.layers = layers;
    layers.terrain.addChild(this.terrainGfx, this.roseGfx, this.nameLayer);
    layers.territory.addChild(this.scenery.gfx, this.territory.container, this.stainGfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.effectGfx,
      this.gunMemo.container,
      this.lateGfx,
      this.crowns.gfx,
      this.aboveCrownsGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.gunMemo.destroy();
    this.lateGfx.destroy();
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.roseGfx,
      this.stainGfx,
      this.effectGfx,
      this.crowns.gfx,
      this.aboveCrownsGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
    this.grain?.texture.destroy(true);
    this.grain?.destroy();
    for (const name of this.names) name.destroy();
    this.nameLayer.destroy();
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  /** Paper as the owner's ink tints it: a wall's top, a castle's roof. */
  private paper(player: number, amount: number): number {
    return mixed(hex(this.art.palette.grassLight), this.colour(player, 'light'), amount);
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.seaLife.layout(state, view, this.art);
    this.scenery.refresh(state, view, this.art, true);
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    clearDrawn(g);
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    const deepest = Math.max(4, ...this.style.contourTiles) + 1;
    const depth = seaDepth(state, marginX, marginY, deepest);
    const depthAt = (x: number, y: number): number =>
      x < -marginX || y < -marginY || x >= w - marginX || y >= h - marginY
        ? deepest
        : (depth[(y + marginY) * w + (x + marginX)] as number);

    // A point on the screen to its tile, for the loops' sense of which side is which.
    const tileOf = (px: number, py: number): { x: number; y: number } => ({
      x: Math.floor((px - tileX(view, 0)) / t),
      y: Math.floor((py - tileY(view, 0)) / t),
    });
    // A pen's waver along a coast: slow, so a line bends rather than shivers.
    const s0 = (this.seed % 97) * 0.37;
    const wobble = (px: number, py: number): number =>
      Math.sin((px * 0.29) / t + (py * 0.13) / t + s0) * 0.6 +
      Math.sin((px * 0.07) / t - (py * 0.21) / t + s0 * 2) * 0.4;
    const waver = this.style.coastWaverTiles * t;
    const inked = (segments: Segment[], inside: (x: number, y: number) => boolean): Point[][] =>
      loops(segments, (px, py) => {
        const c = tileOf(px, py);
        return inside(c.x, c.y);
      }).map((loop) => wavered(rounded(loop, 2), waver, wobble));
    const shape = (loop: readonly Point[]): number[] => loop.flatMap((p) => [p.x, p.y]);

    // Paler water in the shallows, as a map colours its coasts: a band round every coast,
    // its edge drawn by hand as the coast is, and under the land, so where the drawn coast
    // rounds a corner off a tile the shallows show there and not the open sea.
    const shallow = (x: number, y: number): boolean => land(x, y) || depthAt(x, y) <= 1.5;
    const band: Cell[] = [];
    for (let y = -marginY; y < h - marginY; y++) {
      for (let x = -marginX; x < w - marginX; x++) if (shallow(x, y)) band.push({ x, y });
    }
    for (const loop of inked(outline(band, shallow, view), shallow)) g.poly(shape(loop), true);
    g.fill({ color: hex(palette.waterShallow), alpha: 0.6 });

    // Rhumb lines from the compass rose across the sea, as a portolan chart's, under the
    // land so they run on only over the water.
    const spot = this.roseSpotFor(state, view);
    if (spot !== null) {
      const cx = tileX(view, spot.x);
      const cy = tileY(view, spot.y);
      const reach = Math.hypot(w, h) * t;
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        g.moveTo(cx, cy).lineTo(cx + Math.sin(angle) * reach, cy - Math.cos(angle) * reach);
      }
      g.stroke({ width: 1, color: hex(palette.rockDark), alpha: this.style.rhumbAlpha });
    }

    // The engraver's contours, rippling out from every coast, drawn by hand as the coast is.
    this.style.contourTiles.forEach((k, n) => {
      const lines: Segment[] = [];
      for (let y = -marginY; y < h - marginY; y++) {
        for (let x = -marginX; x < w - marginX; x++) {
          if (land(x, y)) continue;
          const here = depthAt(x, y) < k;
          if (!here) continue;
          const left = tileX(view, x);
          const top = tileY(view, y);
          if (!land(x + 1, y) && depthAt(x + 1, y) >= k) {
            lines.push({ x1: left + t, y1: top, x2: left + t, y2: top + t });
          }
          if (!land(x - 1, y) && depthAt(x - 1, y) >= k) {
            lines.push({ x1: left, y1: top, x2: left, y2: top + t });
          }
          if (!land(x, y + 1) && depthAt(x, y + 1) >= k) {
            lines.push({ x1: left, y1: top + t, x2: left + t, y2: top + t });
          }
          if (!land(x, y - 1) && depthAt(x, y - 1) >= k) {
            lines.push({ x1: left, y1: top, x2: left + t, y2: top });
          }
        }
      }
      for (const loop of inked(lines, (x, y) => land(x, y) || depthAt(x, y) < k)) {
        g.poly(shape(loop), true);
      }
      g.stroke({ width: 1, color: hex(palette.waterFoam), alpha: 0.45 - n * 0.15 });
    });

    // Wave strokes on the open sea, seeded so a map always has the same.
    const rng = new Rng(this.seed ^ 0x2f1);
    const open: Cell[] = [];
    for (let y = -marginY; y < h - marginY; y++) {
      for (let x = -marginX; x < w - marginX; x++) {
        if (!land(x, y) && depthAt(x, y) >= deepest - 1) open.push({ x, y });
      }
    }
    const waves = Math.round(open.length * this.style.wavesPerSeaTile);
    for (let k = 0; k < waves && open.length > 0; k++) {
      const cell = open[rng.nextInt(open.length)]!;
      const cx = tileX(view, cell.x + rng.nextFloat());
      const cy = tileY(view, cell.y + rng.nextFloat());
      const r = t * 0.3;
      g.moveTo(cx - r * 2, cy);
      g.quadraticCurveTo(cx - r * 1.5, cy - r, cx - r, cy);
      g.quadraticCurveTo(cx - r * 0.5, cy + r * 0.6, cx, cy);
      g.quadraticCurveTo(cx + r * 0.5, cy - r, cx + r, cy);
    }
    g.stroke({ width: 1, color: hex(palette.waterFoam), alpha: 0.5 });

    // Land as lighter paper inside a coast drawn by hand — the tile grid's staircase
    // rounded off and wavering as a pen follows a shore — washed faintly in the colour of
    // whose island it is, the coast inked bold and stippled along its sea side.
    const coasts: Point[][] = [];
    for (let island = 0; island <= state.players.length; island++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== island) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const mine = (x: number, y: number): boolean =>
        land(x, y) && state.islandId[y * state.width + x] === island;
      const drawn = inked(outline(cells, mine, view), mine);
      for (const loop of drawn) g.poly(shape(loop), true);
      g.fill({ color: hex(palette.grassMid) });
      if (island > 0) {
        for (const loop of drawn) g.poly(shape(loop), true);
        g.fill({ color: this.colour(island - 1, 'base'), alpha: 0.07 });
      }
      coasts.push(...drawn);
    }
    for (const loop of coasts) g.poly(shape(loop), true);
    g.stroke({ width: this.style.inkWidthPx * 1.6, color: hex(palette.rockDark), join: 'round' });
    // The stipple: dots just off the coast on its sea side, a second fainter row beyond,
    // as an engraver shaded the shallows. Loops run with the land on their left.
    const dot = Math.max(1, t * 0.07);
    for (const loop of coasts) {
      along(loop, this.style.stippleTiles * t).forEach((p, n) => {
        const off = t * (0.2 + jitter(p.x, p.y, 7) * 0.08);
        g.rect(p.x - p.dy * off - dot / 2, p.y + p.dx * off - dot / 2, dot, dot);
        if (n % 2 === 1) return;
        const far = t * (0.42 + jitter(p.x, p.y, 8) * 0.1);
        g.rect(p.x - p.dy * far - dot / 2, p.y + p.dx * far - dot / 2, dot, dot);
      });
    }
    g.fill({ color: hex(palette.rockDark), alpha: 0.5 });

    this.drawRose(view, spot);
    this.letterNames(state, view);
    this.layGrain(view, marginX, marginY, w, h);
  }

  /** Where the compass rose stands, in the sea's corner clear of the big timer, if anywhere. */
  private roseSpotFor(state: MatchState, view: ViewTransform): ReturnType<typeof roseSpot> {
    const right = Math.floor((view.width - view.originX) / view.tile) - state.width;
    const bottom = Math.floor((view.height - view.originY) / view.tile) - state.height;
    return roseSpot(state, right, bottom, timerSpot(state));
  }

  /**
   * Each island's name lettered in script across the foot of its land, as a chart names
   * its coasts: drawn from the style's list in an order the match seed shuffles, set
   * under the paper's grain so it reads as printed with the map.
   */
  private letterNames(state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const pool = new Rng(this.seed ^ 0x5a1).shuffle([...this.style.islandNames]);
    const islands = state.players.length;
    while (this.names.length < islands) {
      const name = new Text({
        text: '',
        style: {
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
          fontSize: 32,
          fill: hex(this.art.palette.rockDark),
          letterSpacing: 2,
        },
      });
      name.anchor.set(0.5);
      this.names.push(name);
      this.nameLayer.addChild(name);
    }
    this.names.forEach((name, n) => {
      name.visible = n < islands;
      if (n >= islands) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < state.islandId.length; i++) {
        if (state.islandId[i] !== n + 1 || state.terrain[i] !== Terrain.Land) continue;
        const x = i % state.width;
        const y = (i - x) / state.width;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
      if (maxY < 0) {
        name.visible = false;
        return;
      }
      const text = pool[n % pool.length] as string;
      if (name.text !== text) name.text = text;
      name.scale.set(Math.max(t * 0.72, 11) / 32);
      name.alpha = this.style.nameAlpha;
      name.x = tileX(view, (minX + maxX) / 2);
      name.y = tileY(view, maxY - 1.7);
    });
  }

  /** A compass rose in a corner of the sea, clear of the big timer (`roseSpot`). */
  private drawRose(view: ViewTransform, spot: ReturnType<typeof roseSpot>): void {
    const g = this.roseGfx;
    clearDrawn(g);
    this.seaLife.rose = spot;
    if (spot === null) return;
    const ink = hex(this.art.palette.rockDark);
    const cx = tileX(view, spot.x);
    const cy = tileY(view, spot.y);
    const r = (spot.size * view.tile) / 2 - view.tile * 0.2;
    g.circle(cx, cy, r * 0.62);
    g.stroke({ width: 1, color: ink, alpha: 0.3 });
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2;
      const long = k % 2 === 0;
      const reach = r * (long ? 1 : 0.6);
      const side = r * 0.12;
      const tip = { x: cx + Math.sin(angle) * reach, y: cy - Math.cos(angle) * reach };
      const l = {
        x: cx + Math.sin(angle - Math.PI / 2) * side,
        y: cy - Math.cos(angle - Math.PI / 2) * side,
      };
      const rr = {
        x: cx + Math.sin(angle + Math.PI / 2) * side,
        y: cy - Math.cos(angle + Math.PI / 2) * side,
      };
      // Each point in two halves, one inked and one left as paper, as roses are drawn.
      g.poly([cx, cy, tip.x, tip.y, l.x, l.y]);
      g.fill({ color: ink, alpha: long ? 0.3 : 0.2 });
      g.poly([cx, cy, tip.x, tip.y, rr.x, rr.y]);
      g.stroke({ width: 1, color: ink, alpha: long ? 0.3 : 0.2 });
    }
  }

  /**
   * The paper's grain over the whole sheet: flecks, a few stains, and edges darkened as
   * old paper is. Generated once for the area drawn, from the match seed.
   */
  private layGrain(
    view: ViewTransform,
    marginX: number,
    marginY: number,
    w: number,
    h: number,
  ): void {
    const key = `${w},${h}`;
    if (key !== this.grainKey) {
      this.grainKey = key;
      this.grain?.texture.destroy(true);
      this.grain?.destroy();
      const canvas = document.createElement('canvas');
      canvas.width = w * GRAIN_PX;
      canvas.height = h * GRAIN_PX;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const rng = new Rng(this.seed ^ 0x9a7);
        const ink = this.art.palette.shadow;
        ctx.fillStyle = ink;
        for (let k = 0; k < canvas.width * canvas.height * 0.06; k++) {
          ctx.globalAlpha = 0.05 + rng.nextFloat() * 0.12;
          ctx.fillRect(rng.nextInt(canvas.width), rng.nextInt(canvas.height), 1, 1);
        }
        for (let k = 0; k < 6; k++) {
          const x = rng.nextFloat() * canvas.width;
          const y = rng.nextFloat() * canvas.height;
          const r = (2 + rng.nextFloat() * 5) * GRAIN_PX;
          const stain = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
          stain.addColorStop(0, 'rgba(90, 60, 20, 0.12)');
          stain.addColorStop(0.85, 'rgba(90, 60, 20, 0.06)');
          stain.addColorStop(1, 'rgba(90, 60, 20, 0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = stain;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        const edge = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          Math.min(canvas.width, canvas.height) * 0.35,
          canvas.width / 2,
          canvas.height / 2,
          Math.hypot(canvas.width, canvas.height) / 2,
        );
        edge.addColorStop(0, 'rgba(60, 35, 10, 0)');
        edge.addColorStop(1, 'rgba(60, 35, 10, 0.45)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.grain = new Sprite(Texture.from(canvas));
      this.layers.terrain.addChild(this.grain);
    }
    if (this.grain === null) return;
    this.grain.x = tileX(view, -marginX);
    this.grain.y = tileY(view, -marginY);
    this.grain.width = w * view.tile;
    this.grain.height = h * view.tile;
    this.grain.alpha = this.style.grainAlpha * 2;
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a watercolour wash in the owner's colour, uneven as a brush leaves
   * it and pooling darker along its edge, inside a dotted border.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const wash = this.style.washAlpha;
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const inside = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      const colour = this.colour(player, 'base');
      // Three passes of the brush, each missing a different few tiles.
      for (let pass = 0; pass < 3; pass++) {
        for (const c of cells) {
          if (jitter(c.x, c.y, pass) < 0.25) continue;
          g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
        }
        g.fill({ color: colour, alpha: wash / 2.2 });
      }
      const border = outline(cells, inside, view);
      // The pigment pooled along the edge, a band just inside it.
      for (const s of border) {
        const vertical = s.x1 === s.x2;
        const band = t * 0.18;
        if (vertical) {
          const inward = inside(
            Math.floor((s.x1 - view.originX) / t),
            Math.floor((s.y1 - view.originY) / t),
          );
          g.rect(inward ? s.x1 : s.x1 - band, s.y1, band, t);
        } else {
          const inward = inside(
            Math.floor((s.x1 - view.originX) / t),
            Math.floor((s.y1 - view.originY) / t),
          );
          g.rect(s.x1, inward ? s.y1 : s.y1 - band, t, band);
        }
      }
      g.fill({ color: colour, alpha: wash * 0.6 });
      // The border, dotted in the owner's ink.
      const dark = this.colour(player, 'dark');
      for (const s of border) {
        const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        for (let d = t * 0.12; d < length; d += t * 0.25) {
          g.circle(s.x1 + ((s.x2 - s.x1) * d) / length, s.y1 + ((s.y2 - s.y1) * d) / length, 0.9);
        }
      }
      g.fill({ color: dark, alpha: 0.8 });
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

    // Shadows first, cast onto the paper south of what stands, as the light falls from
    // the north in the pixel style.
    const shade = t * 0.3;
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] === 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      if (wallOf(x, y + 1) >= 0) continue;
      g.rect(tileX(view, x) + t * 0.12, tileY(view, y + 1), t, shade);
    }
    for (const castle of state.castles) {
      g.rect(
        tileX(view, castle.x) + t * 0.12,
        tileY(view, castle.y + castle.h) - t * 0.12,
        castle.w * t,
        shade,
      );
    }
    for (const cannon of state.cannons) {
      g.ellipse(
        tileX(view, cannon.x + cannon.w / 2 + 0.12),
        tileY(view, cannon.y + cannon.h / 2 + 0.2),
        (cannon.w * t) / 2 - t * 0.2,
        (cannon.h * t) / 2 - t * 0.25,
      );
    }
    g.fill({ color: hex(palette.shadow), alpha: this.style.shadowAlpha });

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

    // An eliminated player's rubble: loose stones sketched on the paper, no face.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      for (let k = 0; k < 3; k++) {
        const px = tileX(view, x + 0.2 + jitter(x, y, k) * 0.6);
        const py = tileY(view, y + 0.2 + jitter(x, y, k + 5) * 0.6);
        g.rect(px - t * 0.12, py - t * 0.1, t * 0.24, t * 0.2);
      }
    }
    g.fill({ color: hex(palette.rockLight), alpha: 0.6 });
    g.stroke({ width: 1, color: hex(palette.rockMid) });

    // Castles as an old chart draws a town, in elevation: two round towers with conical
    // roofs either side of a crenellated curtain and its gate, shaded in hatching; a
    // player's main castle a walled town, a keep with its spire rising behind the curtain.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const main = state.players[owner]?.startingCastleId === castle.id;
      this.drawCastle(g, view, castle, owner, main);
    }

    // Guns stand on their square; the gun itself, carriage, wheels and barrel, turns with
    // its aim, so it is drawn with the barrel (`drawGuns`).
    for (const cannon of state.cannons) {
      cannonBase(
        g,
        view,
        cannon,
        this.paper(cannon.owner, 0.3),
        this.colour(cannon.owner, 'dark'),
        cannon.active ? 0.8 : 0.35,
      );
    }
  }

  /** One castle as a chart's vignette, its towers and curtain in the owner's colours. */
  private drawCastle(
    g: Graphics,
    view: ViewTransform,
    castle: { x: number; y: number; w: number; h: number },
    owner: number,
    main: boolean,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const ink = this.style.inkWidthPx;
    const x = tileX(view, castle.x);
    const y = tileY(view, castle.y);
    const w = castle.w * t;
    const h = castle.h * t;
    const dark = this.colour(owner, 'dark');
    const stone = this.paper(owner, 0.3);
    const roof = mixed(this.colour(owner, 'base'), hex(palette.rockDark), 0.15);
    const hatchInk = { width: 1, color: hex(palette.rockDark), alpha: 0.4 };
    const ground = y + h - t * 0.14;
    /** A conical roof over a tower from `left` to `right`, its tip `rise` above `eave`. */
    const cone = (left: number, right: number, eave: number, rise: number): void => {
      g.poly([left - w * 0.03, eave, (left + right) / 2, eave - rise, right + w * 0.03, eave]);
      g.fill({ color: roof });
      g.stroke({ width: ink, color: dark, join: 'round' });
      // Its shaded side, hatched.
      trace(
        g,
        hatch(
          { x: (left + right) / 2, y: eave - rise * 0.6, w: (right - left) / 2, h: rise * 0.6 },
          t * 0.12,
          '/',
        ),
      );
      g.stroke(hatchInk);
    };

    if (main) {
      // The keep behind the curtain, tall, with a spire and its pennant.
      const kl = x + w * 0.37;
      const kr = x + w * 0.63;
      const eave = y + h * 0.3;
      g.rect(kl, eave, kr - kl, ground - eave);
      g.fill({ color: stone });
      g.stroke({ width: ink, color: dark });
      g.rect(x + w * 0.47, eave + h * 0.1, w * 0.06, h * 0.1);
      g.fill({ color: hex(palette.rockDark) });
      cone(kl, kr, eave, h * 0.32);
      this.pennant(g, (kl + kr) / 2, eave - h * 0.32, t, owner, dark);
    }

    // The curtain between the towers, crenellated, its gate arched in the middle.
    const cl = x + w * 0.18;
    const cr = x + w * 0.82;
    const top = ground - h * (main ? 0.36 : 0.42);
    g.rect(cl, top, cr - cl, ground - top);
    g.fill({ color: stone });
    trace(
      g,
      hatch(
        { x: cl, y: top + (ground - top) * 0.55, w: cr - cl, h: (ground - top) * 0.45 },
        t * 0.14,
        '\\',
      ),
    );
    g.stroke(hatchInk);
    g.rect(cl, top, cr - cl, ground - top);
    g.stroke({ width: ink, color: dark });
    const merlons = 4;
    const mw = (cr - cl) / (merlons * 2 - 1);
    for (let k = 0; k < merlons; k++) g.rect(cl + k * 2 * mw, top - t * 0.12, mw, t * 0.12);
    g.fill({ color: stone });
    g.stroke({ width: 1, color: dark });
    const gw = w * 0.16;
    const gx = x + w / 2 - gw / 2;
    const gTop = ground - (ground - top) * 0.62;
    g.moveTo(gx, ground).lineTo(gx, gTop + gw / 2);
    g.arc(gx + gw / 2, gTop + gw / 2, gw / 2, Math.PI, 0);
    g.lineTo(gx + gw, ground).closePath();
    g.fill({ color: hex(palette.rockDark) });

    // The two round towers, a slit in each, conical roofs; a pennant on the first.
    const tw = w * 0.24;
    const eave = ground - h * (main ? 0.5 : 0.58);
    for (const left of [x + w * 0.06, x + w * 0.94 - tw]) {
      g.rect(left, eave, tw, ground - eave);
      g.fill({ color: stone });
      trace(
        g,
        hatch({ x: left + tw * 0.55, y: eave, w: tw * 0.45, h: ground - eave }, t * 0.12, '/'),
      );
      g.stroke(hatchInk);
      g.rect(left, eave, tw, ground - eave);
      g.stroke({ width: ink, color: dark });
      g.rect(left + tw * 0.42, eave + (ground - eave) * 0.3, tw * 0.16, (ground - eave) * 0.22);
      g.fill({ color: hex(palette.rockDark) });
      cone(left, left + tw, eave, h * 0.26);
    }
    if (!main) this.pennant(g, x + w * 0.06 + tw / 2, eave - h * 0.26, t, owner, dark);
    // The ground line the town stands on.
    g.moveTo(x + w * 0.02, ground).lineTo(x + w * 0.98, ground);
    g.stroke({ width: ink, color: dark });
  }

  /** A swallowtail pennant on a short staff, flying east from `x, top`. */
  private pennant(
    g: Graphics,
    x: number,
    top: number,
    t: number,
    owner: number,
    dark: number,
  ): void {
    const staff = t * 0.28;
    g.moveTo(x, top).lineTo(x, top - staff);
    g.stroke({ width: 1, color: dark });
    const fy = top - staff;
    g.poly([
      x,
      fy,
      x + t * 0.36,
      fy + t * 0.03,
      x + t * 0.26,
      fy + t * 0.08,
      x + t * 0.36,
      fy + t * 0.14,
      x,
      fy + t * 0.13,
    ]);
    g.fill({ color: this.colour(owner, 'base') });
    g.stroke({ width: 1, color: dark, join: 'round' });
  }

  /** Inked stone: tops in paper tinted by the owner, blocks outlined, faces cross-hatched. */
  private drawWall(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
    alpha = 1,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    const dark = this.colour(player, 'dark');
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.paper(player, 0.45), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: mixed(this.colour(player, 'base'), hex(palette.rockDark), 0.2), alpha });
    trace(g, [
      ...wall.faces.flatMap((r) => hatch(r, t * 0.16, '/')),
      ...wall.faces.flatMap((r) => hatch(r, t * 0.16, '\\')),
    ]);
    g.stroke({ width: 1, color: hex(palette.rockDark), alpha: 0.4 * alpha });
    // The stones coursed as a mason lays them: a bed joint across each block, the joints
    // above and below it staggered from block to block, fainter than the wall's outline.
    // Each block's own square outline read as floor tiles, not stone.
    for (const block of wall.blocks) {
      const r = { x: block.left, y: block.top, w: t, h: block.lip - block.top };
      const mid = r.y + r.h / 2;
      const off = (block.x + block.y) % 2 === 0 ? 0.3 : 0.7;
      g.moveTo(r.x, mid).lineTo(r.x + r.w, mid);
      g.moveTo(r.x + r.w * off, r.y).lineTo(r.x + r.w * off, mid);
      g.moveTo(r.x + r.w * (1 - off), mid).lineTo(r.x + r.w * (1 - off), r.y + r.h);
    }
    g.stroke({ width: 1, color: dark, alpha: 0.4 * alpha });
    trace(g, [...wall.faceEdges, ...wall.rim]);
    g.stroke({ width: this.style.inkWidthPx, color: dark, alpha });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    const angle = this.aims.fire(shot);
    // A puff of ink wash from the muzzle, in place of smoke.
    const reach = 0.95;
    const mx = shot.fromX + 0.5 + Math.sin(angle) * reach;
    const my = shot.fromY + 0.5 - Math.cos(angle) * reach;
    for (let k = 0; k < 4; k++) {
      const spread = angle + (Math.random() - 0.5) * 0.9;
      this.drops.push({
        x: mx,
        y: my,
        vx: Math.sin(spread) * (0.6 + Math.random()),
        vy: -Math.cos(spread) * (0.6 + Math.random()),
        age: 0,
        life: 500 + Math.random() * 300,
        colour: hex(this.art.palette.rockMid),
        gravity: 0,
      });
    }
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea =
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      this.terrain[y * this.width + x] !== Terrain.Land;
    if (inSea) {
      this.ripples.push({ x, y, age: 0 });
      return;
    }
    this.stains = this.stains.filter((s) => s.x !== x || s.y !== y);
    this.stains.push({ x, y, round: this.round, seed: Math.random() * 100 });
    const ink = hex(this.art.palette.rockDark);
    for (let k = 0; k < 8; k++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      this.drops.push({
        x: x + 0.5,
        y: y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        age: 0,
        life: 350 + Math.random() * 300,
        colour: ink,
        gravity: 7,
      });
    }
    for (const block of debris) {
      for (let k = 0; k < this.art.generators.fx.debrisPerTile; k++) {
        this.drops.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: (Math.random() - 0.5) * 4,
          vy: -2 - Math.random() * 2.5,
          age: 0,
          life: this.art.generators.fx.debrisMs,
          colour: this.paper(block.owner, 0.6),
          gravity: 9,
        });
      }
    }
  }

  noteCrumble(block: Debris): void {
    const colour = block.owner < 0 ? hex(this.art.palette.rockMid) : this.paper(block.owner, 0.45);
    this.fades.push({ x: block.x, y: block.y, age: 0, colour });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    clearDrawn(g);
    clearDrawn(this.lateGfx);
    clearDrawn(this.aboveCrownsGfx);
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    this.clock += frame.deltaMs;
    if (state.round !== this.round) {
      this.round = state.round;
      const rounds = this.art.generators.fx.craterRounds;
      this.stains = this.stains.filter((s) => this.round - s.round < rounds);
    }
    this.drawStains(view);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockMid), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawRipples(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawSeals(state, view, frame);
    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawShots(state, view, frame);
    this.drawDrops(view, frame.deltaMs);
    this.winnerBanners.draw(
      this.aboveCrownsGfx,
      view,
      state,
      this.art,
      frame.celebrate,
      frame.deltaMs,
    );
    this.fireworks.draw(this.aboveCrownsGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** Ink splashed where shots came down on land, fading over the rounds after. */
  private drawStains(view: ViewTransform): void {
    const last = this.stains.at(-1);
    const key = `${this.round}|${this.stains.length}|${last?.seed}|${view.tile}|${view.originX}|${view.originY}`;
    if (key === this.stainsDrawn) return;
    this.stainsDrawn = key;
    const g = this.stainGfx;
    clearDrawn(g);
    const t = view.tile;
    const rounds = this.art.generators.fx.craterRounds;
    for (const stain of this.stains) {
      const alpha = 0.7 * (1 - (this.round - stain.round) / rounds);
      const cx = tileX(view, stain.x + 0.5);
      const cy = tileY(view, stain.y + 0.5);
      g.circle(cx, cy, t * 0.26);
      // Splashes thrown out from the blot, tapering, as ink flicked from a pen.
      for (let k = 0; k < 4; k++) {
        const angle = jitter(stain.seed, k, 4) * Math.PI * 2;
        const reach = t * (0.45 + jitter(stain.seed, k, 5) * 0.25);
        const side = t * 0.07;
        g.poly([
          cx + Math.cos(angle + Math.PI / 2) * side,
          cy + Math.sin(angle + Math.PI / 2) * side,
          cx + Math.cos(angle) * reach,
          cy + Math.sin(angle) * reach,
          cx + Math.cos(angle - Math.PI / 2) * side,
          cy + Math.sin(angle - Math.PI / 2) * side,
        ]);
      }
      for (let k = 0; k < 7; k++) {
        const angle = jitter(stain.seed, k, 1) * Math.PI * 2;
        const d = t * (0.3 + jitter(stain.seed, k, 2) * 0.3);
        g.circle(
          cx + Math.cos(angle) * d,
          cy + Math.sin(angle) * d,
          t * (0.04 + jitter(stain.seed, k, 3) * 0.08),
        );
      }
      g.fill({ color: hex(this.art.palette.craterDark), alpha });
    }
  }

  /** Rings of ink spreading on the water where a shot went in. */
  private drawRipples(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    for (const ripple of this.ripples) {
      ripple.age += deltaMs;
      const cx = tileX(view, ripple.x + 0.5);
      const cy = tileY(view, ripple.y + 0.5);
      for (const lag of [0, 0.3]) {
        const k = ripple.age / RIPPLE_MS - lag;
        if (k <= 0 || k >= 1) continue;
        g.ellipse(cx, cy, view.tile * (0.2 + 0.9 * k), view.tile * (0.12 + 0.55 * k));
        g.stroke({ width: 1.2, color: hex(this.art.palette.waterFoam), alpha: 1 - k });
      }
    }
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE_MS * 1.3);
  }

  /** A block the sweep took, fading off the paper. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.flat.crumbleMs;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const k = fade.age / span;
      if (k >= 1) continue;
      g.rect(tileX(view, fade.x), tileY(view, fade.y), view.tile, view.tile);
      g.fill({ color: fade.colour, alpha: 1 - k });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
  }

  /**
   * Guns as an engraver draws a cannon from above: a bronze barrel in the owner's ink,
   * swelling at the breech, banded, flared at the muzzle, a knob behind; on a wooden
   * carriage whose trail runs back from it, two spoked wheels at its sides. All of it
   * turns with the aim, so it is redrawn only as it turns or kicks (`Memos`). A silenced
   * gun is the same drawing faded, struck through with one stroke of the pen.
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
        const u = Math.min(cannon.w, cannon.h) * t * 0.5;
        const cx = tileX(view, cannon.x + cannon.w / 2);
        const cy = tileY(view, cannon.y + cannon.h / 2);
        const sin = Math.sin(aim.angle);
        const cos = Math.cos(aim.angle);
        /** Along the barrel `a` and across it `s`, in units of half the gun, to the screen. */
        const p = (a: number, s: number): [number, number] => [
          cx + (sin * a + cos * s) * u,
          cy + (-cos * a + sin * s) * u,
        ];
        const poly = (points: [number, number][]): void => {
          g.poly(points.flat());
        };
        const alpha = cannon.active ? 1 : 0.45;
        const ink = cannon.active ? this.colour(cannon.owner, 'dark') : hex(palette.rockMid);
        const wood = cannon.active ? this.paper(cannon.owner, 0.25) : hex(palette.grassDark);
        const line = { width: 1, color: ink, alpha, join: 'round' as const };

        // The carriage's trail, back from the axle, hatched as wood is.
        poly([p(0.15, -0.26), p(0.15, 0.26), p(-0.85, 0.14), p(-0.85, -0.14)]);
        g.fill({ color: wood, alpha });
        g.stroke(line);
        for (const a of [-0.2, -0.45, -0.7]) {
          g.moveTo(...p(a, -0.2 + (0.15 - a) * 0.06)).lineTo(...p(a, 0.2 - (0.15 - a) * 0.06));
        }
        g.stroke({ ...line, alpha: alpha * 0.5 });
        // The wheels either side, seen from above: their rims, and a spoke or two showing.
        for (const side of [-1, 1]) {
          const rim: [number, number][] = [];
          for (let k = 0; k < 10; k++) {
            const r = (k / 10) * Math.PI * 2;
            rim.push(p(0.05 + Math.cos(r) * 0.36, side * (0.42 + Math.sin(r) * 0.09)));
          }
          poly(rim);
          g.fill({ color: wood, alpha });
          g.stroke(line);
          for (const a of [-0.2, 0.05, 0.3])
            g.moveTo(...p(a, side * 0.35)).lineTo(...p(a, side * 0.49));
          g.stroke({ ...line, alpha: alpha * 0.7 });
        }
        // The barrel, kicked back by a shot: breech, chase, the flare of the muzzle.
        const back = -0.25 * kick;
        const b = (a: number, s: number): [number, number] => p(a + back, s);
        poly([
          b(-0.5, -0.22),
          b(0.2, -0.17),
          b(0.9, -0.13),
          b(0.98, -0.18),
          b(1.04, -0.18),
          b(1.04, 0.18),
          b(0.98, 0.18),
          b(0.9, 0.13),
          b(0.2, 0.17),
          b(-0.5, 0.22),
        ]);
        g.fill({
          color: cannon.active ? this.colour(cannon.owner, 'base') : hex(palette.rockLight),
          alpha,
        });
        g.stroke(line);
        // Its bands, and the shading along one flank.
        for (const a of [-0.3, 0.2, 0.86]) g.moveTo(...b(a, -0.2)).lineTo(...b(a, 0.2));
        g.moveTo(...b(-0.45, 0.12)).lineTo(...b(0.85, 0.08));
        g.stroke({ ...line, alpha: alpha * 0.7 });
        // The cascabel, the knob at the breech.
        g.circle(...b(-0.6, 0), u * 0.09);
        g.fill({ color: ink, alpha });
        if (cannon.active) return;
        // Silenced: struck through with one stroke of the pen.
        g.moveTo(...p(0.7, -0.7)).lineTo(...p(-0.7, 0.7));
        g.stroke({
          width: Math.max(1.5, t * 0.08),
          color: hex(palette.rockDark),
          alpha: 0.7,
          cap: 'round',
        });
      });
    }
    memo.end();
    this.aims.prune(state);
  }

  /**
   * A wax seal in the owner's colour on every sealed castle: pressed on as it seals,
   * from large and faint down onto the roof, and cracked in two and falling away when
   * a breach unseals it. Timed by the flag hoist the other styles fly their flags by.
   */
  private drawSeals(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      // Pressed on the vignette's lower right, over a tower's foot, where it hides
      // neither the gate nor a main castle's keep.
      const cx = tileX(view, castle.x + castle.w * 0.78);
      const cy = tileY(view, castle.y + castle.h * 0.66);
      const breaking = this.flags.lowering(castle.id);
      const base = t * 0.38;
      const r = breaking ? base : base * (1 + 1.2 * (1 - raised) * (1 - raised));
      const alpha = breaking ? raised : Math.min(1, raised * 2);
      const apart = breaking ? (1 - raised) * t * 0.3 : 0;
      const wax = this.colour(owner, 'base');
      const rim = this.colour(owner, 'dark');
      for (const side of breaking ? [-1, 1] : [0]) {
        const ox = cx + side * apart;
        const oy = cy + (breaking ? (1 - raised) * t * 0.2 : 0);
        const from = side === 1 ? -Math.PI / 2 : side === -1 ? Math.PI / 2 : 0;
        const to = side === 0 ? Math.PI * 2 : from + Math.PI;
        // The blob of wax, lumpy at its edge where it spread under the stamp.
        g.moveTo(ox, oy);
        g.arc(ox, oy, r, from, to);
        g.closePath();
        g.fill({ color: wax, alpha });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + castle.id;
          if (side !== 0 && Math.sign(Math.sin(a)) !== side) continue;
          g.circle(ox + Math.sin(a) * r * 0.8, oy - Math.cos(a) * r * 0.8, r * 0.32);
        }
        g.fill({ color: wax, alpha });
        // From the arc's own start: a move to the centre drew a spoke to the rim.
        g.moveTo(ox + Math.cos(from) * r * 0.62, oy + Math.sin(from) * r * 0.62);
        g.arc(ox, oy, r * 0.62, from, to);
        g.stroke({ width: 1.2, color: rim, alpha: alpha * 0.9 });
      }
      if (!breaking) {
        // The impression in the wax: a small star.
        const s = r * 0.32;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          g.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s);
          g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        }
        g.stroke({ width: 1.2, color: rim, alpha });
      }
    }
  }

  /** Shots as ink dots on a dotted course, like a route marked on a map. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.aboveCrownsGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const at = (tk: number): { x: number; y: number } => ({
        x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * tk + 0.5),
        y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * tk + 0.5 - shotLift(shot, tk)),
      });
      const ink = this.colour(shot.owner, 'dark');
      const distance = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
      const step = distance > 0 ? 0.4 / distance : 1;
      for (let k = 1; k <= 7; k++) {
        const tk = p - step * k;
        if (tk <= 0) break;
        const d = at(tk);
        g.circle(d.x, d.y, Math.max(0.8, t * 0.05));
      }
      g.fill({ color: ink, alpha: 0.6 });
      const height = Math.min(1, shotLift(shot, p) / 3);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      g.circle(gx, gy, t * 0.14 * (1 - 0.4 * height));
      g.fill({ color: hex(this.art.palette.shadow), alpha: 0.25 - 0.1 * height });
      const head = at(p);
      g.circle(head.x, head.y, t * (0.15 + 0.07 * height));
      g.fill({ color: ink });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** Drops of ink and chips of stone flying, and gun smoke drifting as washes of ink. */
  private drawDrops(view: ViewTransform, deltaMs: number): void {
    const g = this.aboveCrownsGfx;
    const dt = deltaMs / 1000;
    for (const d of this.drops) {
      d.age += deltaMs;
      const drag = Math.exp(-2.5 * dt);
      d.vx *= drag;
      d.vy = d.vy * drag + d.gravity * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const k = d.age / d.life;
      if (k >= 1) continue;
      const size =
        d.gravity === 0 ? view.tile * (0.12 + 0.25 * k) : Math.max(1.2, view.tile * 0.08);
      g.circle(tileX(view, d.x), tileY(view, d.y), size);
      g.fill({ color: d.colour, alpha: (d.gravity === 0 ? 0.35 : 0.9) * (1 - k) });
    }
    this.drops = this.drops.filter((d) => d.age < d.life);
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
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
      const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
      const inside = (x: number, y: number): boolean => inPiece.has(`${x},${y}`);
      if (ghost.valid) {
        // The wall it would make, joined to the player's own, faces and all.
        const standing = (x: number, y: number): boolean =>
          x >= 0 &&
          y >= 0 &&
          x < state.width &&
          y < state.height &&
          state.structure[y * state.width + x] === Structure.Wall &&
          state.owner[y * state.width + x] === humanPlayer + 1;
        this.drawWall(g, view, cells, (x, y) => inside(x, y) || standing(x, y), humanPlayer, 0.8);
      } else {
        // Hollow where it does not fit, so it differs in form, not only in hue.
        for (const c of cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
        g.fill({ color: hex(palette.uiInvalid), alpha: 0.12 });
      }
      trace(g, outline(cells, inside, view));
      g.stroke(
        ghost.valid
          ? { width: 1, color: hex(palette.uiValid), alpha: 0.9 }
          : { width: 2, color: hex(palette.uiInvalid) },
      );
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = (Math.min(ghost.footprint.w, ghost.footprint.h) * t) / 2 - t * 0.22;
      g.circle(cx, cy, r);
      g.fill({ color: colour, alpha: 0.15 });
      g.stroke({ width: 2, color: colour });
      if (!ghost.valid) {
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
        g.stroke({ width: 2, color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Parchment's scenery as an old map draws it: little inked trees with a wash in their
 * crowns, pines as inked spires, bushes as a pair of humps and boulders as a hummock with
 * its shaded side hatched — all in the pale ink of the land, not the dark ink of walls.
 */
function drawParchmentScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const ink = hex(art.palette.rockDark);
  const wash = hex(art.palette.rockLight);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5 + ((item.variant % 3) - 1) * 0.06);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.moveTo(cx, cy + t * 0.1).lineTo(cx, cy + t * 0.36);
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
      g.circle(cx, cy - t * 0.04, t * 0.24);
      g.fill({ color: wash, alpha: 0.5 });
      g.stroke({ width: 1, color: ink, alpha: 0.75 });
      // The shaded side, hatched.
      for (let k = 0; k < 3; k++) {
        const x = cx + t * (0.04 + k * 0.06);
        g.moveTo(x, cy - t * 0.1 + k * t * 0.02).lineTo(x + t * 0.06, cy + t * 0.08);
      }
      g.stroke({ width: 1, color: ink, alpha: 0.45 });
    } else if (item.kind === 'pine') {
      g.poly([cx, cy - t * 0.34, cx + t * 0.18, cy + t * 0.22, cx - t * 0.18, cy + t * 0.22]);
      g.fill({ color: wash, alpha: 0.5 });
      g.stroke({ width: 1, color: ink, alpha: 0.75 });
      g.moveTo(cx, cy + t * 0.22).lineTo(cx, cy + t * 0.36);
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
    } else if (item.kind === 'bush') {
      for (const [dx, r] of [
        [-0.1, 0.13],
        [0.1, 0.11],
      ] as const) {
        const x = cx + dx * t;
        const y = cy + t * 0.12;
        g.moveTo(x - r * t, y);
        g.arc(x, y, r * t, Math.PI, 0);
      }
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
    } else {
      const y = cy + t * 0.18;
      g.moveTo(cx - t * 0.22, y);
      g.quadraticCurveTo(cx - t * 0.05, cy - t * 0.28, cx + t * 0.22, y);
      g.stroke({ width: 1, color: ink, alpha: 0.75 });
      for (let k = 0; k < 3; k++) {
        const x = cx + t * (0.04 + k * 0.05);
        g.moveTo(x, y - t * (0.14 - k * 0.04)).lineTo(x + t * 0.03, y);
      }
      g.stroke({ width: 1, color: ink, alpha: 0.45 });
    }
  }
}
