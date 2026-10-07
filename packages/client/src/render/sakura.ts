import type { ArtConfig, SakuraStyleConfig } from '@bollwerk/config';
import { Structure, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { hash } from './noise.js';
import { climax, roseSpot } from './corner.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import { SakuraSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { IslandParts } from './islandParts.js';
import { SceneryLayer } from './sceneryLayer.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
  GunAims,
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
  type FinishLook,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
  mixed,
} from './theme.js';
import { MAPLE, PETALS, drawCloudCurl, drawCrest, drawMapleLeaf, drawPetal } from './ukiyo.js';
import { outline, trace, wallGeometry, type Segment } from './walls.js';
import { cannonBase } from './cannonBase.js';
import { ShapeTheme } from './shapeTheme.js';

/** Something with a place and an age: a cloud thrown up, a ring on the sea, a block pressed. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A crest curling up on the open sea and breaking, in tiles. */
interface Crest {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  dir: 1 | -1;
}

/** A band of mist drifting across a foggy match, in tiles. */
interface MistBand {
  x: number;
  y: number;
  w: number;
  speed: number;
}

/** A roof tile, a fleck of plaster, a drop of spray, a petal: thrown up and falling, in tiles. */
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
  kind: 'tile' | 'drop' | 'petal';
  angle: number;
}

/** Where a shot came down on open ground: a splash of ink, fading. */
interface Blot {
  x: number;
  y: number;
  round: number;
}

/** A piece just set down, pressed as a block is onto the print. */
interface Pressed {
  cells: readonly Cell[];
  age: number;
}

/** Something drifting down over the whole screen — a petal, a leaf, a flake, a streak of rain. */
interface Drift {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  colour: number;
  size: number;
}

/** A keep on a castle's tiles: where its parts stand on screen. */
interface Keep {
  cx: number;
  foot: number;
  W: number;
  /** The carp streamer's pole, beside the keep. */
  poleX: number;
  poleTop: number;
}

const RECOIL_MS = 180;
const RING_MS = 900;
const PRESS_MS = 460;
const FADE_MS = 500;
const SMOKE_MS = 700;

/** Lacquer, bronze, gold and the cloth thrown over a silenced gun. */
const LACQUER = 0x1d1a1f;
const BRONZE = 0xa9783a;
const BRONZE_DARK = 0x5a3c1c;
const GOLD = 0xd9b24a;
const CLOTH = 0x5a6478;
/** The paper white the clouds and the pressing are drawn in. */
const PAPER = 0xf6f1e3;
const MOSS = 0x5f7a3a;

/** How Sakura sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'blossom', flag: 'nobori' };

/**
 * The lines of raked gravel round the inside of a region, `per` to a tile: one ring for
 * every tile in from its edge, each following the edge and turning its corners, so the
 * gravel is raked round anything left out of the region as round a stone.
 */
export function rakeLines(
  cells: readonly Cell[],
  inside: (x: number, y: number) => boolean,
  view: ViewTransform,
  per: number,
): Segment[] {
  // How far in each tile is, counted from the tiles on the edge.
  const key = (x: number, y: number): string => `${x},${y}`;
  const depth = new Map<string, number>();
  const queue: Cell[] = [];
  const sides = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const;
  for (const c of cells) {
    if (sides.some(([dx, dy]) => !inside(c.x + dx, c.y + dy))) {
      depth.set(key(c.x, c.y), 0);
      queue.push(c);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    const d = depth.get(key(c.x, c.y))!;
    for (const [dx, dy] of sides) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!inside(nx, ny) || depth.has(key(nx, ny))) continue;
      depth.set(key(nx, ny), d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  const out: Segment[] = [];
  for (const c of cells) {
    const d = depth.get(key(c.x, c.y));
    if (d === undefined) continue;
    // The ring this tile is on: the region of tiles at least this far in.
    const ring = (x: number, y: number): boolean => (depth.get(key(x, y)) ?? -1) >= d;
    for (const [nx, ny] of sides) {
      if (ring(c.x + nx, c.y + ny)) continue;
      // Along the side, and across it.
      const ax = -ny;
      const ay = nx;
      for (let j = 0; j < per; j++) {
        const s = (j + 0.5) / per;
        // Each end: cut short at a corner the region turns outward, carried on where the
        // side runs straight on, and carried past where it turns inward.
        const reach = (e: 1 | -1): number => {
          if (!ring(c.x + e * ax, c.y + e * ay)) return -s;
          if (!ring(c.x + e * ax + nx, c.y + e * ay + ny)) return 0;
          return s;
        };
        const bx = c.x + 0.5 + nx * (0.5 - s);
        const by = c.y + 0.5 + ny * (0.5 - s);
        const lo = 0.5 + reach(-1);
        const hi = 0.5 + reach(1);
        out.push({
          x1: tileX(view, bx - ax * lo),
          y1: tileY(view, by - ay * lo),
          x2: tileX(view, bx + ax * hi),
          y2: tileY(view, by + ay * hi),
        });
      }
    }
  }
  return out;
}

/**
 * The Sakura look, for either look: an Edo castle town by the sea as a woodblock print —
 * flat colour in bold outline, colour fading across the sea as a printer wipes the block.
 * The sea is Prussian blue under the fish-scale pattern of waves, crests curling and
 * breaking on it in claws of foam; the land pale green; Mount Fuji stands in the corner
 * Parchment gives its compass rose, its foot in a band of mist. Walls are white plaster on
 * a stone footing under a tiled cap in the owner's colour; castles are keeps with tiered
 * roofs in it, and sealed is a carp streamer hoisted beside the keep, swimming in the wind,
 * hanging limp as it comes down. Sealed ground is gravel raked round its edge and round the
 * keeps as round stones. Guns are bronze on lacquer stands, a cloth thrown over a silenced
 * one; shots trail a brush stroke; a hit on a wall throws roof tiles and a curled cloud; the
 * sweep scatters blocks into petals. Cherry petals drift over everything, and in overtime
 * and the final round the season turns, and they fall as maple leaves.
 */
export class SakuraTheme extends ShapeTheme implements Theme {
  readonly id = 'sakura' as const;

  private style!: SakuraStyleConfig;
  /** Life on the outer sea (`seaLife.ts`). */
  private readonly seaLife = new SakuraSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The crests on the sea and the blots of ink: redrawn each frame. */
  /** Ink where shots came down on open ground: drawn again when one comes or fades. */
  private readonly flowGfx = new Graphics();
  private blotsDrawn = '';
  /**
   * The crests, stamps drawn once a size, a direction and a forty-eighth of their rise, and
   * faded (PLAN 11.22): curled anew each frame they were 30 000 vertices at eight players.
   */
  private readonly crestStamps = new Stamps();
  private readonly book = new StampBook();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawSakuraScenery(g, view, items, this.art),
    () => PAPER,
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /** The guns' barrels, a `Graphics` a gun redrawn only as it turns or kicks (`Memos`). */
  private readonly gunMemo = new Memos();
  /** What lies over the guns: shots, splashes, the finish. */
  private readonly lateGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private round = 0;
  /** Open sea a crest may rise on: well away from any coast. */
  private seaCells: Cell[] = [];
  private crests: Crest[] = [];
  private mist: MistBand[] = [];
  /** Where the mist drifts, in tiles: the board and its margins. */
  private span = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private fuji: TimerSpot | null = null;
  private blots: Blot[] = [];
  private puffs: Aged[] = [];
  private rings: Aged[] = [];
  private fading: Aged[] = [];
  private bits: Bit[] = [];
  private pressed: Pressed[] = [];
  private drifts: Drift[] = [];
  /** Whether the season has turned, for the drifting petals to turn with it. */
  private autumn = false;
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The carp streamers, hoisted as a flag is: by sealing, and lowered by a breach. */
  private readonly carp = new FlagHoist();
  private weather: Weather = 'clear';
  private clock = 0;

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.sakura;
    // Medieval's weather, drawn from the seed: fog is the prints' bands of mist, rain
    // Hiroshige's slanting streaks, snow lies on the roofs.
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    layers.terrain.addChild(this.terrainGfx, this.flowGfx, this.crestStamps.container);
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(this.effectGfx, this.gunMemo.container, this.lateGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.crestStamps.destroy();
    this.book.destroy();
    this.gunMemo.destroy();
    this.lateGfx.destroy();
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [this.terrainGfx, this.flowGfx, this.effectGfx, this.overlayGfx]) {
      g.destroy();
    }
  }

  private get sumi(): number {
    return hex(this.art.palette.shadow);
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

    // The sea runs out past the board to the window's edge, paling toward the land as a
    // printer's wiped colour does, in overlapping rounds so it curves with the coast.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    this.span = { x0, x1: x0 + w, y0, y1: y0 + h };
    const depth = new Int8Array(w * h).fill(-1);
    const queue: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!land(x + x0, y + y0)) continue;
        depth[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const d = depth[i]!;
      if (d >= 5) continue;
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
    const bands = [
      hex(palette.waterShallow),
      mixed(hex(palette.waterShallow), hex(palette.waterMid), 0.5),
      hex(palette.waterMid),
      mixed(hex(palette.waterMid), hex(palette.waterDeep), 0.5),
      hex(palette.waterDeep),
    ];
    g.rect(tileX(view, x0), tileY(view, y0), w * t, h * t);
    g.fill({ color: bands[4]! });
    for (let band = 3; band >= 0; band--) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (depth[y * w + x] !== band + 1) continue;
          g.circle(tileX(view, x + x0 + 0.5), tileY(view, y + y0 + 0.5), t * 0.8);
        }
      }
      g.fill({ color: bands[band]! });
    }
    const deep = (x: number, y: number): boolean => {
      const lx = Math.floor(x) - x0;
      const ly = Math.floor(y) - y0;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return true;
      const d = depth[ly * w + lx]!;
      return d < 0 || d >= 3;
    };
    // The waves' fish-scale pattern (seigaiha) over the deeper water: rows of arcs, each
    // row half a scale across from the last, so every arc shows whole.
    const R = 1;
    for (let row = 0; y0 + row * R <= y0 + h; row++) {
      const sy = y0 + row * R;
      const shift = row % 2 === 0 ? 0 : R;
      for (let sx = x0 + shift; sx <= x0 + w; sx += R * 2) {
        if (!deep(sx, sy)) continue;
        for (const k of [1, 0.68, 0.36]) {
          const cx = tileX(view, sx);
          const cy = tileY(view, sy);
          g.moveTo(cx - R * k * t, cy);
          g.arc(cx, cy, R * k * t, Math.PI, Math.PI * 2);
        }
      }
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.waterFoam), alpha: 0.13 });
    this.seaCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = depth[y * w + x]!;
        if (d < 0 || d >= 3) this.seaCells.push({ x: x + x0, y: y + y0 });
      }
    }

    // The land: flat pale green as a print lays it, lighter rounds, tufts in a few strokes.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 1) < 0.2) g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.75);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 2) > 0.25) continue;
      const px = tileX(view, x) + t * (0.2 + 0.6 * hash(x, y, 3));
      const py = tileY(view, y) + t * (0.3 + 0.5 * hash(x, y, 4));
      g.moveTo(px - t * 0.12, py - t * 0.14).quadraticCurveTo(px - t * 0.04, py - t * 0.02, px, py);
      g.moveTo(px, py).lineTo(px + t * 0.02, py - t * 0.2);
      g.moveTo(px, py).quadraticCurveTo(px + t * 0.06, py - t * 0.04, px + t * 0.13, py - t * 0.12);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.grassDark), cap: 'round' });
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

    // The shore: a line of white surf out on the water, then a beach of pale sand.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.75, color: hex(palette.waterFoam), alpha: 0.4, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: t * 0.4, color: hex(palette.sand), cap: 'square' });

    // Mount Fuji, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.fuji = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.fuji = this.fuji;
    if (this.fuji !== null) this.drawFuji(g, view, this.fuji);
    this.seaLife.layout(state, view, this.art);
    this.crests = [];
    this.layoutMist();
  }

  /**
   * Mount Fuji as the prints show it: a blue cone with long hollow flanks, a flat top under
   * snow running down in streaks, and a band of mist across its foot.
   */
  private drawFuji(g: Graphics, view: ViewTransform, spot: TimerSpot): void {
    const t = view.tile;
    const size = spot.size * t;
    const cx = tileX(view, spot.x);
    const base = tileY(view, spot.y) + size * 0.3;
    const half = size * 0.46;
    const height = size * 0.58;
    const top = base - height;
    const crest = half * 0.14;
    // One flank, from the foot to the top, sampled so the snow can follow it.
    const flank: [number, number][] = [];
    for (let n = 0; n <= 16; n++) {
      const u = n / 16;
      const c = [half * 0.38, base - height * 0.3] as const;
      const fx = (1 - u) * (1 - u) * half + 2 * u * (1 - u) * c[0] + u * u * crest;
      const fy = (1 - u) * (1 - u) * base + 2 * u * (1 - u) * c[1] + u * u * top;
      flank.push([fx, fy]);
    }
    const left = flank.map(([fx, fy]) => [cx - fx, fy] as const);
    const rightFlank = [...flank].reverse().map(([fx, fy]) => [cx + fx, fy] as const);
    g.poly([...left.flat(), ...rightFlank.flat()]);
    g.fill({ color: 0x2f4f86 });
    // A lighter face on the side the light comes from.
    g.poly([cx - crest * 0.4, top, ...left.slice(4).reverse().flat(), cx - half * 0.2, base]);
    g.fill({ color: 0x4a6ea6, alpha: 0.55 });
    // The flanks in ink, not the foot, which the mist hides.
    g.moveTo(left[0]![0], left[0]![1]);
    for (const [x, y] of [...left.slice(1), ...rightFlank]) g.lineTo(x, y);
    g.stroke({ width: Math.max(1, t * 0.08), color: this.sumi, alpha: 0.8, join: 'round' });
    // The snow, down a third of the mountain, running down the gullies in a few long streaks.
    const snowLine = top + height * 0.3;
    const upper = flank.filter(([, fy]) => fy <= snowLine);
    const sl = upper.map(([fx, fy]) => [cx - fx, fy] as const);
    const sr = [...upper].reverse().map(([fx, fy]) => [cx + fx, fy] as const);
    const edge: number[] = [];
    const from = sr[sr.length - 1]![0];
    const to = sl[0]![0];
    const streaks = 4;
    for (let k = 1; k < streaks * 2; k++) {
      const x = from + ((to - from) * k) / (streaks * 2);
      const dip = k % 2 === 1 ? height * (0.12 + 0.12 * hash(k, 3, 90)) : -height * 0.02;
      edge.push(x, snowLine + dip);
    }
    g.poly([...sl.flat(), ...sr.flat(), ...edge]);
    g.fill({ color: PAPER });
    g.stroke({ width: Math.max(1, t * 0.05), color: this.sumi, alpha: 0.45, join: 'round' });
    // A band of mist across its foot, its ends rounded, a thinner one staggered under it.
    for (const [dy, wk, hk, dx, alpha] of [
      [-0.16, 1.15, 0.13, -0.12, 0.7],
      [-0.01, 0.75, 0.09, 0.25, 0.55],
    ] as const) {
      g.roundRect(
        cx - half * wk + half * dx,
        base + height * dy,
        half * wk * 2,
        height * hk,
        height * hk * 0.5,
      );
      g.fill({ color: PAPER, alpha });
    }
  }

  private layoutMist(): void {
    const { x0, x1, y0, y1 } = this.span;
    const count = this.weather === 'fog' ? this.style.mistBands : 0;
    this.mist = [];
    for (let k = 0; k < count; k++) {
      this.mist.push({
        x: x0 + (x1 - x0) * hash(k, this.seed, 320),
        y: y0 + 2 + (y1 - y0 - 4) * hash(k, this.seed, 321),
        w: 7 + 8 * hash(k, this.seed, 322),
        speed: 0.18 * (0.6 + 0.8 * hash(k, this.seed, 323)),
      });
    }
  }

  // ------------------------------------------------------------------ the sea, moving

  /** Each frame, under everything: crests curling on the sea, and the blots of ink. */
  private drawFlow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const { palette } = this.art;
    const still = motionReduced();
    this.drawBlots(state, view);

    // Crests rising on the open sea, curling over, breaking in claws of foam and settling.
    const target = Math.min(70, Math.floor(this.seaCells.length / this.style.crestTiles));
    while (this.crests.length < target && this.seaCells.length > 0) {
      this.crests.push(this.newCrest(still ? 0.6 : Math.random()));
    }
    const body = mixed(hex(palette.waterMid), hex(palette.waterShallow), 0.6);
    const stamps = this.crestStamps;
    stamps.begin();
    for (let i = 0; i < this.crests.length; i++) {
      const c = this.crests[i]!;
      if (!still) c.age += deltaMs;
      if (c.age >= c.life) {
        this.crests[i] = this.newCrest(0);
        continue;
      }
      const k = c.age / c.life;
      const rise = Math.round(Math.sin(Math.min(1, k / 0.8) * Math.PI * 0.5) * 48) / 48;
      const fade = Math.min(1, (1 - k) / 0.25);
      if (rise <= 0.02 || fade <= 0) continue;
      // Drawn a tenth of a tile apart in size and scaled the rest of the way; mirrored for
      // a crest breaking the other way.
      const size = Math.round(c.size * 10) / 10;
      const crest = this.book.get(`crest|${size}|${rise}`, t, (g) =>
        drawCrest(g, 0, 0, t * size, 1, rise, body, hex(palette.waterFoam), hex(palette.waterDeep)),
      );
      const scale = c.size / size;
      stamps.place(crest, tileX(view, c.x), tileY(view, c.y), {
        scale: scale * c.dir,
        scaleY: scale,
        alpha: 0.85 * fade,
      });
    }
    stamps.end();
  }

  /** Where shots came down on open ground: a splash of ink, fading over the rounds after. */
  private drawBlots(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.blots = this.blots.filter((b) => state.round - b.round < rounds);
    const last = this.blots.at(-1);
    const key = `${state.round}|${this.blots.length}|${last?.x},${last?.y}|${viewKey(view)}`;
    if (key === this.blotsDrawn) return;
    this.blotsDrawn = key;
    const g = this.flowGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    for (const b of this.blots) {
      const fade = 1 - (state.round - b.round) / rounds;
      const cx = tileX(view, b.x + 0.5);
      const cy = tileY(view, b.y + 0.5);
      g.circle(cx, cy, t * 0.34);
      for (let k = 0; k < 4; k++) {
        const a = hash(b.x + k, b.y, 330) * Math.PI * 2;
        const d = t * (0.38 + 0.12 * hash(b.x, b.y + k, 331));
        g.circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, t * (0.05 + 0.05 * hash(k, b.x, 332)));
      }
      g.fill({ color: hex(palette.craterDark), alpha: 0.6 * fade });
    }
  }

  private newCrest(age: number): Crest {
    const at = this.seaCells[Math.floor(Math.random() * this.seaCells.length)]!;
    const life = this.style.crestMs * (0.7 + Math.random() * 0.6);
    return {
      x: at.x + Math.random(),
      y: at.y + Math.random(),
      age: age * life,
      life,
      size: 0.8 + Math.random() * 0.6,
      dir: Math.random() < 0.5 ? 1 : -1,
    };
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a raked gravel garden: pale gravel tinted with the owner's colour, raked
   * in lines that follow its edge, and round the keeps as round the stones of a garden;
   * edged in the owner's colour.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const keeps = new Uint8Array(state.width * state.height);
    for (const c of state.castles) {
      for (let dy = 0; dy < c.h; dy++) {
        for (let dx = 0; dx < c.w; dx++) keeps[(c.y + dy) * state.width + c.x + dx] = 1;
      }
    }
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
      g.fill({
        color: mixed(0xeae3d0, this.colour(player, 'base'), 0.3),
        alpha: this.style.territoryAlpha,
      });
      const raked = cells.filter(({ x, y }) => keeps[y * state.width + x] === 0);
      const gravel = (x: number, y: number): boolean =>
        owned(x, y) && keeps[y * state.width + x] === 0;
      trace(g, rakeLines(raked, gravel, view, this.style.rakeLines));
      g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(player, 'dark'), alpha: 0.4 });
      trace(g, outline(cells, owned, view));
      g.stroke({ width: Math.max(1.5, t * 0.09), color: this.colour(player, 'base'), alpha: 0.9 });
    }
    dimEliminated(g, state, view, this.sumi);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  /** One island's structures, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
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
      this.drawWall(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawKeep(g, view, castle);

    // Guns: a black lacquered stand, rimmed in gold and banded in the owner's colour, its
    // bronze barrel turned with the effects.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = Math.min(cannon.w, cannon.h) * t * 0.36;
      cannonBase(
        g,
        view,
        cannon,
        this.colour(cannon.owner, 'dark'),
        this.colour(cannon.owner, 'base'),
      );
      g.ellipse(cx + t * 0.08, cy + r * 0.9, r * 1.05, r * 0.3);
      g.fill({ color: this.sumi, alpha: 0.3 });
      g.roundRect(cx - r, cy - r * 0.75, r * 2, r * 1.5, r * 0.3);
      g.fill({ color: LACQUER });
      g.stroke({ width: Math.max(1, t * 0.05), color: GOLD, alpha: 0.85 });
      g.rect(cx - r, cy + r * 0.1, r * 2, r * 0.32);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      g.circle(cx, cy - r * 0.1, r * 0.3);
      g.fill({ color: BRONZE_DARK });
    }
  }

  /**
   * Walls as a Japanese castle's: a tiled cap in the owner's colour, a seam at every block
   * so a shot visibly takes one; under it a face of white plaster on a footing of fitted
   * stone, standing to the shared height; outlined in ink. A player's who is out (`player`
   * -1) is weathered grey, its caps faded and moss creeping over them.
   */
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
    const dead = player < 0;
    const cap = dead ? hex(palette.rockMid) : this.colour(player, 'base');
    const capLight = dead ? hex(palette.rockLight) : this.colour(player, 'light');
    const capDark = dead ? hex(palette.rockDark) : this.colour(player, 'dark');
    const plaster = dead
      ? mixed(hex(palette.rockLight), hex(palette.rockMid), 0.5)
      : hex(palette.rockLight);
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    // In a snowy match the caps lie under snow, their colour showing through.
    const snowy = this.weather === 'snow';
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: snowy ? mixed(cap, 0xffffff, 0.5) : cap, alpha });
    // The rows of round tiles running down each cap, lit along their crowns.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      for (const f of [0.25, 0.5, 0.75]) {
        g.moveTo(b.left + t * f, b.top + h * 0.12).lineTo(b.left + t * f, b.lip - h * 0.12);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: capLight, alpha: 0.5 * alpha });
    // The seam between blocks.
    for (const b of wall.blocks) g.rect(b.left, b.top, t, b.lip - b.top);
    g.stroke({ width: 1, color: capDark, alpha: 0.7 * alpha });
    // The faces: plaster under the eave's shadow, on a footing of stone.
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      g.rect(b.left, b.lip, t, wall.face * 0.55);
    }
    g.fill({ color: plaster, alpha });
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      g.rect(b.left, b.lip + wall.face * 0.55, t, wall.face * 0.45);
    }
    g.fill({ color: hex(palette.rockMid), alpha });
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      g.rect(b.left, b.lip, t, Math.max(1, wall.face * 0.14));
    }
    g.fill({ color: this.sumi, alpha: 0.35 * alpha });
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      const y = b.lip + wall.face * 0.55;
      const off = hash(b.x, b.y, 340) * 0.4;
      for (const f of [0.15 + off, 0.55 + off]) {
        g.moveTo(b.left + t * f, y).lineTo(b.left + t * f, b.lip + wall.face);
      }
      g.moveTo(b.left, y).lineTo(b.left + t, y);
    }
    g.stroke({ width: 1, color: hex(palette.rockDark), alpha: 0.8 * alpha });
    if (dead && alpha === 1) {
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 341) > 0.45) continue;
        const h = b.lip - b.top;
        for (let k = 0; k < 3; k++) {
          g.circle(
            b.left + t * (0.2 + 0.6 * hash(b.x + k, b.y, 342)),
            b.top + h * (0.2 + 0.6 * hash(b.x, b.y + k, 343)),
            t * (0.08 + 0.06 * hash(k, b.x, 344)),
          );
        }
      }
      g.fill({ color: MOSS, alpha: 0.85 });
    }
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: this.ink(view), color: this.sumi, alpha: 0.85 * alpha });
  }

  private keep(view: ViewTransform, castle: Castle): Keep {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot = tileY(view, castle.y + castle.h) - t * 0.05;
    return { cx, foot, W, poleX: cx + W * 0.47, poleTop: foot - W * 1.3 };
  }

  /**
   * A castle as a keep (tenshu): a base of fitted stone flaring at its foot, two storeys of
   * white plaster, each under a roof in the owner's colour whose eaves turn up at the ends,
   * a small gable on the lower roof and gold ornaments on the ridge; beside it the pole the
   * carp streamer flies from while it is sealed.
   */
  private drawKeep(g: Graphics, view: ViewTransform, castle: Castle): void {
    const { palette } = this.art;
    const t = view.tile;
    const owner = castle.islandId - 1;
    const k = this.keep(view, castle);
    const { cx, foot, W } = k;
    const ink = this.ink(view);
    const roof = this.colour(owner, 'base');
    const roofDark = this.colour(owner, 'dark');
    g.ellipse(cx + t * 0.1, foot, W * 0.55, t * 0.2);
    g.fill({ color: this.sumi, alpha: 0.3 });
    // The pole, behind the keep.
    g.moveTo(k.poleX, foot).lineTo(k.poleX, k.poleTop);
    g.stroke({ width: Math.max(1.5, t * 0.07), color: 0x3a2c22, cap: 'round' });
    g.circle(k.poleX, k.poleTop, Math.max(1.5, t * 0.09));
    g.fill({ color: GOLD });
    // The stone base, its sides curving out toward the foot.
    const baseTop = foot - W * 0.22;
    g.moveTo(cx - W * 0.46, foot);
    g.quadraticCurveTo(cx - W * 0.37, foot - W * 0.06, cx - W * 0.36, baseTop);
    g.lineTo(cx + W * 0.36, baseTop);
    g.quadraticCurveTo(cx + W * 0.37, foot - W * 0.06, cx + W * 0.46, foot);
    g.closePath();
    g.fill({ color: hex(palette.rockMid) });
    g.stroke({ width: ink, color: this.sumi, alpha: 0.85, join: 'round' });
    for (const f of [0.35, 0.7]) {
      const y = foot - W * 0.22 * f;
      const half = W * (0.46 - 0.1 * f);
      g.moveTo(cx - half, y).lineTo(cx + half, y);
    }
    g.stroke({ width: 1, color: hex(palette.rockDark), alpha: 0.8 });
    // The lower storey, its roof, the upper storey and its roof.
    const body1 = baseTop - W * 0.2;
    const roof1 = W * 0.13;
    const body2 = body1 - roof1 * 0.6 - W * 0.13;
    const roof2 = W * 0.16;
    g.rect(cx - W * 0.31, body1, W * 0.62, baseTop - body1);
    g.rect(cx - W * 0.2, body2, W * 0.4, body1 - roof1 * 0.6 - body2 + 1);
    g.fill({ color: hex(palette.rockLight) });
    g.stroke({ width: ink, color: this.sumi, alpha: 0.85 });
    for (const dx of [-0.18, 0, 0.18])
      g.rect(cx + W * dx - W * 0.035, body1 + W * 0.07, W * 0.07, W * 0.06);
    for (const dx of [-0.08, 0.08])
      g.rect(cx + W * dx - W * 0.03, body2 + W * 0.05, W * 0.06, W * 0.05);
    g.fill({ color: this.sumi, alpha: 0.85 });
    this.roof(g, cx, body1, W * 0.44, roof1, roof, roofDark, ink);
    // The gable on the lower roof's front.
    g.poly([
      cx - W * 0.1,
      body1 - roof1 * 0.15,
      cx + W * 0.1,
      body1 - roof1 * 0.15,
      cx,
      body1 - roof1 * 0.95,
    ]);
    g.fill({ color: hex(palette.rockLight) });
    g.stroke({ width: Math.max(1, ink * 0.8), color: this.sumi, alpha: 0.8, join: 'round' });
    this.roof(g, cx, body2, W * 0.34, roof2, roof, roofDark, ink);
    // Gold ornaments at either end of the ridge.
    for (const s of [-1, 1]) {
      g.moveTo(cx + s * W * 0.12, body2 - roof2);
      g.quadraticCurveTo(
        cx + s * W * 0.17,
        body2 - roof2 * 1.2,
        cx + s * W * 0.15,
        body2 - roof2 * 1.55,
      );
    }
    g.stroke({ width: Math.max(1.5, t * 0.08), color: GOLD, cap: 'round' });
    if (this.weather === 'snow') {
      for (const [half, y, h] of [
        [W * 0.34, body2, roof2],
        [W * 0.44, body1, roof1],
      ] as const) {
        g.rect(cx - half * 0.38, y - h, half * 0.76, h * 0.35);
      }
      g.fill({ color: 0xffffff, alpha: 0.85 });
    }
  }

  /** A roof whose eaves turn up at the ends, from `y` up `h`, `half` wide at its tips. */
  private roof(
    g: Graphics,
    cx: number,
    y: number,
    half: number,
    h: number,
    colour: number,
    dark: number,
    ink: number,
  ): void {
    g.moveTo(cx - half, y - h * 0.35);
    g.quadraticCurveTo(cx - half * 0.8, y + h * 0.08, cx - half * 0.55, y);
    g.lineTo(cx + half * 0.55, y);
    g.quadraticCurveTo(cx + half * 0.8, y + h * 0.08, cx + half, y - h * 0.35);
    g.quadraticCurveTo(cx + half * 0.6, y - h * 0.45, cx + half * 0.38, y - h);
    g.lineTo(cx - half * 0.38, y - h);
    g.quadraticCurveTo(cx - half * 0.6, y - h * 0.45, cx - half, y - h * 0.35);
    g.closePath();
    g.fill({ color: colour });
    g.stroke({ width: ink, color: this.sumi, alpha: 0.85, join: 'round' });
    g.moveTo(cx - half * 0.55, y - h * 0.12).lineTo(cx + half * 0.55, y - h * 0.12);
    g.stroke({ width: Math.max(1, ink), color: dark, alpha: 0.8 });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const atSea = this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (atSea) {
      // Spray thrown up in claws and a ring spreading on the water.
      this.rings.push({ x, y, age: 0, owner: -1 });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
        this.bits.push({
          x: x + 0.5,
          y: y + 0.5,
          vx: Math.cos(a) * 1.2,
          vy: -2.8 - Math.random(),
          age: 0,
          life: 600,
          floor: y + 0.5 + Math.sin(a) * 0.3,
          size: 0.08 + Math.random() * 0.06,
          colour: hex(this.art.palette.waterFoam),
          kind: 'drop',
          angle: 0,
        });
      }
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.blots.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      // A curled cloud thrown up, and the roof tiles and plaster broken off.
      this.puffs.push({ x: block.x + 0.5, y: block.y + 0.4, age: 0, owner: block.owner });
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const v = 1.4 + Math.random() * 1.6;
        const tile = k % 3 !== 2;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * 1.3,
          floor: block.y + 0.85 + Math.random() * 0.3,
          size: 0.07 + Math.random() * 0.07,
          colour: tile
            ? block.owner < 0
              ? hex(this.art.palette.rockMid)
              : this.colour(block.owner, 'base')
            : hex(this.art.palette.rockLight),
          kind: 'tile',
          angle: Math.random() * Math.PI,
        });
      }
    }
  }

  /** The sweep: a block left alone fades, and scatters into petals. */
  noteCrumble(block: Debris): void {
    this.fading.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
    for (let k = 0; k < 6; k++) {
      this.bits.push({
        x: block.x + Math.random(),
        y: block.y + Math.random() * 0.6,
        vx: 0.4 + Math.random() * 0.8,
        vy: -1 - Math.random() * 0.8,
        age: 0,
        life: 1500,
        floor: block.y + 1.6 + Math.random(),
        size: 0.1 + Math.random() * 0.05,
        colour: PETALS[k % PETALS.length]!,
        kind: 'petal',
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    this.pressed.push({ cells, age: 0 });
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
    this.lateGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.drawPressed(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawFading(view, frame.deltaMs);
    this.ruins.draw(g, view, state, PAPER, null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.drawCarp(state, view, frame);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawMist(view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawRings(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawPuffs(view, frame.deltaMs);
    this.drawDrifts(state, view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A piece set down: pressed onto the print, the paper showing white and fading, a curl of cloud. */
  private drawPressed(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const p of this.pressed) {
      p.age += deltaMs;
      const k = Math.min(1, p.age / PRESS_MS);
      for (const c of p.cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
      g.fill({ color: PAPER, alpha: 0.55 * (1 - k) });
      const first = p.cells[0];
      if (first !== undefined) {
        drawCloudCurl(
          g,
          tileX(view, first.x + 0.5),
          tileY(view, first.y + 0.2) - k * t * 0.4,
          t * (0.18 + 0.12 * k),
          PAPER,
          this.sumi,
          0.8 * (1 - k),
        );
      }
    }
    this.pressed = this.pressed.filter((p) => p.age < PRESS_MS);
  }

  /** The sweep's blocks fading where they stood, as their petals scatter. */
  private drawFading(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const f of this.fading) {
      f.age += deltaMs;
      const k = Math.min(1, f.age / FADE_MS);
      g.rect(tileX(view, f.x) + t * 0.05, tileY(view, f.y) + t * 0.05, t * 0.9, t * 0.9);
      g.fill({
        color: f.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(f.owner, 'base'),
        alpha: 1 - k,
      });
    }
    this.fading = this.fading.filter((f) => f.age < FADE_MS);
  }

  /**
   * The carp streamers: while a castle is sealed a carp in the owner's colour is hoisted up
   * the pole beside its keep and swims out on the wind, its body rippling; a breach brings
   * it down hanging limp, so "sealed" is the carp flying.
   */
  private drawCarp(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const still = motionReduced();
    this.carp.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const up = this.carp.raised(castle.id, this.clock, this.art);
      if (up === null) continue;
      const owner = castle.islandId - 1;
      const k = this.keep(view, castle);
      const mouthY = k.foot - (k.foot - (k.poleTop + t * 0.2)) * up;
      const limp = this.carp.lowering(castle.id);
      const sway = still ? 0 : Math.sin(this.clock / 700 + castle.id) * 0.12;
      const angle = limp ? Math.PI / 2 - 0.15 : sway;
      drawCarpStreamer(
        g,
        k.poleX,
        mouthY,
        k.W * 0.78,
        angle,
        this.colour(owner, 'base'),
        this.colour(owner, 'light'),
        this.sumi,
        still || limp ? 0 : this.clock,
      );
    }
  }

  /**
   * The barrels: bronze, turned to the target, kicking back as they fire with a curl of
   * smoke from the muzzle. A silenced gun's barrel droops and a cloth is thrown over it.
   */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const memo = this.gunMemo;
    memo.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      // Still between shots: drawn again only as it turns and kicks.
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.w},${cannon.h},${cannon.owner},${cannon.active}|${aim.angle}|${aim.firedAgo < Math.max(RECOIL_MS, SMOKE_MS) ? aim.firedAgo : '-'}`;
      memo.draw(cannon.id, key, (g) => {
        const r = Math.min(cannon.w, cannon.h) * t * 0.36;
        const cx = tileX(view, cannon.x + cannon.w / 2);
        const cy = tileY(view, cannon.y + cannon.h / 2) - r * 0.1;
        const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
        const length = cannon.active ? t * (0.95 - 0.3 * kick) : t * 0.6;
        const dx = cannon.active ? Math.sin(aim.angle) : 0.35;
        const dy = cannon.active ? -Math.cos(aim.angle) : 0.75;
        const ex = cx + dx * length;
        const ey = cy + dy * length * 0.8;
        g.moveTo(cx, cy).lineTo(ex, ey);
        g.stroke({ width: Math.max(3, t * 0.3), color: this.sumi, cap: 'round' });
        g.moveTo(cx, cy).lineTo(ex, ey);
        g.stroke({ width: Math.max(2, t * 0.22), color: BRONZE, cap: 'round' });
        g.circle(ex, ey, Math.max(1.5, t * 0.13));
        g.fill({ color: BRONZE_DARK });
        if (!cannon.active) {
          // The cloth thrown over it, falling in folds.
          g.moveTo(cx - r * 0.9, cy + r * 0.55);
          g.quadraticCurveTo(cx - r * 0.7, cy - r * 0.6, cx, cy - r * 0.55);
          g.quadraticCurveTo(cx + r * 0.7, cy - r * 0.6, cx + r * 0.9, cy + r * 0.55);
          g.lineTo(cx + r * 0.45, cy + r * 0.4);
          g.lineTo(cx, cy + r * 0.6);
          g.lineTo(cx - r * 0.45, cy + r * 0.4);
          g.closePath();
          g.fill({ color: CLOTH });
          g.stroke({ width: Math.max(1, t * 0.05), color: this.sumi, alpha: 0.8, join: 'round' });
          g.moveTo(cx - r * 0.3, cy - r * 0.4).lineTo(cx - r * 0.4, cy + r * 0.4);
          g.moveTo(cx + r * 0.3, cy - r * 0.4).lineTo(cx + r * 0.4, cy + r * 0.4);
          g.stroke({ width: 1, color: this.sumi, alpha: 0.4 });
          return;
        }
        if (aim.firedAgo < SMOKE_MS) {
          const k = aim.firedAgo / SMOKE_MS;
          drawCloudCurl(
            g,
            ex + dx * t * 0.4 * k,
            ey + dy * t * 0.4 * k - k * t * 0.2,
            t * (0.16 + 0.18 * k),
            PAPER,
            this.sumi,
            0.85 * (1 - k),
          );
        }
      });
    }
    memo.end();
    this.aims.prune(state);
  }

  /** Bands of mist drifting across a foggy match, as the prints lay them over a view. */
  private drawMist(view: ViewTransform, deltaMs: number): void {
    if (this.mist.length === 0) return;
    const g = this.lateGfx;
    const t = view.tile;
    const still = motionReduced();
    const { x0, x1 } = this.span;
    for (const m of this.mist) {
      if (!still) m.x += m.speed * (deltaMs / 1000);
      if (m.x - m.w > x1) m.x = x0 - m.w;
      g.roundRect(tileX(view, m.x - m.w / 2), tileY(view, m.y), m.w * t, t * 1.1, t * 0.55);
    }
    g.fill({ color: PAPER, alpha: this.style.mistAlpha });
    for (const m of this.mist) {
      g.roundRect(
        tileX(view, m.x - m.w * 0.35),
        tileY(view, m.y + 0.2),
        m.w * 0.7 * t,
        t * 0.7,
        t * 0.35,
      );
    }
    g.fill({ color: PAPER, alpha: this.style.mistAlpha });
  }

  /**
   * Shots: a glowing ball in the owner's colour, white at its heart, trailing a single
   * brush stroke that tapers to a point behind it.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const at = (q: number): { x: number; y: number; lift: number } => {
        const p = Math.min(1, Math.max(0, q));
        const lift = shotLift(shot, p);
        return {
          x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5),
          y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5 - lift),
          lift,
        };
      };
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const here = at(p);
      const high = Math.min(1, here.lift / 3);
      g.ellipse(
        tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5),
        tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5),
        t * 0.22,
        t * 0.1,
      );
      g.fill({ color: 0x000000, alpha: 0.2 - 0.1 * high });
      const r = t * (0.18 + 0.07 * high);
      // The stroke behind it, wide at the ball and tapering away.
      const step = span <= 0 ? 0 : 1.2 / span;
      const spine: { x: number; y: number }[] = [];
      for (let k = 0; k <= 8; k++) spine.push(at(p - step * k));
      const upper: number[] = [];
      const lower: number[] = [];
      for (let k = 0; k < spine.length; k++) {
        const a = spine[Math.max(0, k - 1)]!;
        const b = spine[Math.min(spine.length - 1, k + 1)]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        const w = r * 0.85 * (1 - k / (spine.length - 1));
        upper.push(spine[k]!.x + nx * w, spine[k]!.y + ny * w);
        lower.unshift(spine[k]!.x - nx * w, spine[k]!.y - ny * w);
      }
      if (step > 0) {
        g.poly([...upper, ...lower]);
        g.fill({ color: this.colour(shot.owner, 'base'), alpha: 0.6 });
      }
      g.circle(here.x, here.y, r * 1.7);
      g.fill({ color: this.colour(shot.owner, 'light'), alpha: 0.3 });
      g.circle(here.x, here.y, r);
      g.fill({ color: this.colour(shot.owner, 'light') });
      g.stroke({ width: Math.max(1, t * 0.04), color: this.sumi, alpha: 0.7 });
      g.circle(here.x, here.y, r * 0.45);
      g.fill({ color: 0xffffff, alpha: 0.9 });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  private drawRings(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.rings) {
      s.age += deltaMs;
      const k = s.age / RING_MS;
      if (k >= 1) continue;
      g.ellipse(
        tileX(view, s.x + 0.5),
        tileY(view, s.y + 0.5),
        t * (0.3 + 0.9 * k),
        t * (0.18 + 0.5 * k),
      );
      g.stroke({
        width: Math.max(1.5, t * 0.08),
        color: hex(this.art.palette.waterFoam),
        alpha: 0.6 * (1 - k),
      });
    }
    this.rings = this.rings.filter((s) => s.age < RING_MS);
  }

  /** Roof tiles bouncing once, spray falling back into the sea, petals fluttering down. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += (b.kind === 'petal' ? 1.6 : 7) * dt;
      if (b.kind === 'petal') {
        b.vy = Math.min(b.vy, 0.9);
        b.angle += dt * 4;
      }
      if (b.y > b.floor && b.vy > 0) {
        if (b.kind === 'drop') {
          b.age = b.life;
          continue;
        }
        b.y = b.floor;
        b.vy *= b.kind === 'petal' ? 0 : -0.3;
        b.vx *= 0.5;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const s = b.size * t;
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      if (b.kind === 'drop') {
        g.circle(x, y, s);
        g.fill({ color: b.colour, alpha });
      } else if (b.kind === 'petal') {
        drawPetal(g, x, y, s, b.angle, b.colour, alpha);
      } else {
        // A curved roof tile: a short arc of the owner's colour.
        g.moveTo(x - s, y).quadraticCurveTo(x, y - s * 1.2, x + s, y);
        g.stroke({ width: Math.max(1.5, s * 0.8), color: b.colour, alpha, cap: 'round' });
      }
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** The curled cloud a hit throws up from a wall: rising, swelling and fading as it goes. */
  private drawPuffs(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const span = this.style.puffMs;
    for (const p of this.puffs) {
      p.age += deltaMs;
      const k = p.age / span;
      if (k >= 1) continue;
      const alpha = Math.min(1, k / 0.1) * Math.min(1, (1 - k) / 0.5);
      drawCloudCurl(
        g,
        tileX(view, p.x),
        tileY(view, p.y) - k * t * 1.1,
        t * (0.25 + 0.2 * k),
        PAPER,
        this.sumi,
        0.9 * alpha,
      );
    }
    this.puffs = this.puffs.filter((p) => p.age < span);
  }

  /**
   * What drifts over the whole screen: cherry petals on the wind; maple leaves once the
   * season turns, in overtime and the final round; snow in a snowy match; in rain,
   * Hiroshige's slanting streaks with a few petals still. None under reduced motion.
   */
  private drawDrifts(state: MatchState, view: ViewTransform, deltaMs: number): void {
    if (motionReduced()) return;
    const g = this.lateGfx;
    const t = view.tile;
    const autumn = climax(state);
    if (autumn !== this.autumn) {
      this.autumn = autumn;
      for (const d of this.drifts) d.colour = this.driftColour();
    }
    const snow = this.weather === 'snow';
    const rain = this.weather === 'rain';
    const count = snow
      ? this.style.snowCount
      : rain
        ? this.style.rainCount + Math.floor(this.style.petalCount / 3)
        : this.style.petalCount;
    const fall = this.style.petalTilesPerSecond;
    while (this.drifts.length < count) {
      const streak = rain && this.drifts.length < this.style.rainCount;
      this.drifts.push({
        x: Math.random() * view.width,
        y: view.top + Math.random() * (view.height - view.top),
        vx: streak ? -t * 2 : t * (0.5 + Math.random() * 0.6),
        vy: streak ? t * (14 + Math.random() * 6) : t * fall * (0.7 + Math.random() * 0.6),
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3,
        colour: streak ? 0xdfe6ee : snow ? 0xffffff : this.driftColour(),
        size: streak ? 0 : t * (snow ? 0.08 + Math.random() * 0.06 : 0.14 + Math.random() * 0.06),
      });
    }
    const dt = deltaMs / 1000;
    for (const [k, d] of this.drifts.entries()) {
      d.x += (d.vx + (d.size > 0 ? Math.sin(this.clock / 800 + k) * t * 0.5 : 0)) * dt;
      d.y += d.vy * dt;
      d.angle += d.spin * dt;
      if (d.y > view.height || d.x > view.width + t || d.x < -t * 3) {
        d.y = view.top;
        d.x = Math.random() * (view.width + t * 4) - t * 2;
      }
    }
    // The rain's streaks first, in one stroke, since every petal's fill ends a path.
    if (rain) {
      for (const d of this.drifts) {
        if (d.size === 0) g.moveTo(d.x, d.y).lineTo(d.x + d.vx * 0.07, d.y + d.vy * 0.07);
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: 0xdfe6ee, alpha: 0.5 });
    }
    for (const d of this.drifts) {
      if (d.size === 0) continue;
      if (snow) {
        g.circle(d.x, d.y, d.size);
        g.fill({ color: d.colour, alpha: 0.9 });
      } else if (this.autumn) {
        drawMapleLeaf(g, d.x, d.y, d.size * 1.7, d.angle, d.colour, 0.95);
      } else {
        drawPetal(g, d.x, d.y, d.size, d.angle, d.colour, 0.9);
      }
    }
  }

  private driftColour(): number {
    const set = this.autumn ? MAPLE : PETALS;
    return set[Math.floor(Math.random() * set.length)]!;
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
      // The piece in hand outlined in one brush stroke and faintly washed; where it does not
      // fit, the stroke breaks up dry and frayed — the difference in form, since red is a
      // player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const edge = outline(cells, inPiece, view);
      if (ghost.valid) {
        for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
        g.fill({ color: this.colour(humanPlayer, 'light'), alpha: 0.35 });
        trace(g, edge);
        g.stroke({ width: Math.max(2, t * 0.14), color: this.sumi, alpha: 0.85, cap: 'round' });
        trace(g, edge);
        g.stroke({ width: Math.max(1, t * 0.04), color: PAPER, alpha: 0.6, cap: 'round' });
        return;
      }
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: hex(palette.rockDark), alpha: 0.25 });
      // Dry brush: each side in broken dabs, a few bristles' lines beside them.
      for (const [n, s] of edge.entries()) {
        for (let k = 0; k < 3; k++) {
          const a = k / 3 + 0.05 * hash(n, k, 350);
          const b = a + 0.22 + 0.06 * hash(n, k, 351);
          for (const off of [-1, 0, 1]) {
            const ox = (s.y1 === s.y2 ? 0 : 1) * off * t * 0.05;
            const oy = (s.y1 === s.y2 ? 1 : 0) * off * t * 0.05;
            const shrink = off === 0 ? 0 : 0.05;
            g.moveTo(
              s.x1 + (s.x2 - s.x1) * (a + shrink) + ox,
              s.y1 + (s.y2 - s.y1) * (a + shrink) + oy,
            );
            g.lineTo(
              s.x1 + (s.x2 - s.x1) * (b - shrink) + ox,
              s.y1 + (s.y2 - s.y1) * (b - shrink) + oy,
            );
          }
        }
      }
      g.stroke({
        width: Math.max(1, t * 0.05),
        color: hex(palette.uiInvalid),
        alpha: 0.95,
        cap: 'round',
      });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // An empty stand's outline, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.36;
      g.roundRect(cx - r, cy - r * 0.75, r * 2, r * 1.5, r * 0.3);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(cx - r, cy + r * 0.75).lineTo(cx + r, cy - r * 0.75);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * A carp streamer (koinobori) flying from (x, y) at its mouth: a fish of cloth in `colour`,
 * open at the mouth and tapering to a forked tail, scales marked in its light shade, an eye
 * by the mouth. `angle` is the way the wind carries it, 0 out to the right; `clock` ripples
 * the body, 0 holds it still.
 */
function drawCarpStreamer(
  g: Graphics,
  x: number,
  y: number,
  length: number,
  angle: number,
  colour: number,
  light: number,
  ink: number,
  clock: number,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const steps = 10;
  const girth = length * 0.15;
  const spine: [number, number][] = [];
  for (let n = 0; n <= steps; n++) {
    const u = n / steps;
    const wave = clock === 0 ? 0 : Math.sin(clock / 220 - u * 5) * length * 0.07 * u;
    spine.push([x + c * u * length - s * wave, y + s * u * length + c * wave]);
  }
  // Full at the mouth, swelling a little, narrowing to the tail.
  const widthAt = (u: number): number => girth * (u < 0.3 ? 0.85 + u * 0.5 : 1 - (u - 0.3) * 0.9);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let n = 0; n <= steps - 2; n++) {
    const u = n / steps;
    const [px, py] = spine[n]!;
    const w = widthAt(u);
    upper.push(px - s * w, py + c * w);
    lower.unshift(px + s * w, py - c * w);
  }
  // The forked tail.
  const [tx, ty] = spine[steps]!;
  const [nx, ny] = spine[steps - 2]!;
  const fork = girth * 0.9;
  g.poly([
    ...upper,
    tx - s * fork,
    ty + c * fork,
    nx + c * girth * 0.4,
    ny + s * girth * 0.4,
    tx + s * fork,
    ty - c * fork,
    ...lower,
  ]);
  g.fill({ color: colour });
  g.stroke({ width: Math.max(1, length * 0.03), color: ink, alpha: 0.8, join: 'round' });
  // Scales: rows of small arcs down the body.
  for (let n = 2; n <= steps - 3; n++) {
    const [px, py] = spine[n]!;
    for (const side of [-0.45, 0.45]) {
      const w = widthAt(n / steps) * side;
      const sx = px - s * w;
      const sy = py + c * w;
      g.moveTo(sx + s * girth * 0.22, sy - c * girth * 0.22);
      g.arc(sx, sy, girth * 0.22, angle - Math.PI / 2, angle + Math.PI / 2);
    }
  }
  g.stroke({ width: Math.max(1, length * 0.025), color: light, alpha: 0.9 });
  // The mouth's ring and the eye.
  const [mx, my] = spine[0]!;
  g.moveTo(mx - s * girth * 0.85, my + c * girth * 0.85).lineTo(
    mx + s * girth * 0.85,
    my - c * girth * 0.85,
  );
  g.stroke({ width: Math.max(1.5, length * 0.05), color: light });
  const [ex, ey] = spine[1]!;
  g.circle(ex - s * girth * 0.35, ey + c * girth * 0.35, girth * 0.32);
  g.fill({ color: 0xffffff });
  g.circle(ex - s * girth * 0.35, ey + c * girth * 0.35, girth * 0.16);
  g.fill({ color: ink });
}

/**
 * Sakura's scenery, none like a wall, a gun or a shot: a tree a cherry in blossom, a pine a
 * gnarled pine in layered pads, a bush a clump of bamboo, a boulder a garden rock — one in
 * three a stone lantern instead. Nothing red, which would read as the crimson player.
 */
function drawSakuraScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  const ink = hex(palette.shadow);
  const line = Math.max(1, t * 0.05);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.ellipse(cx + t * 0.1, cy + t * 0.38, t * 0.32, t * 0.09);
      g.fill({ color: ink, alpha: 0.25 });
      g.moveTo(cx, cy + t * 0.38).quadraticCurveTo(
        cx - t * 0.08,
        cy + t * 0.1,
        cx + t * 0.04,
        cy - t * 0.05,
      );
      g.stroke({ width: Math.max(1.5, t * 0.1), color: 0x4a3328, cap: 'round' });
      for (const [dx, dy, r, k] of [
        [-0.18, -0.12, 0.24, 2],
        [0.16, -0.16, 0.22, 1],
        [0, -0.3, 0.24, 1],
        [0.02, -0.08, 0.2, 0],
      ] as const) {
        g.circle(cx + t * dx, cy + t * dy, t * r);
        g.fill({ color: PETALS[k] });
      }
      g.circle(cx - t * 0.08, cy - t * 0.2, t * 0.3);
      g.stroke({ width: 1, color: 0xd88aa2, alpha: 0.4 });
    } else if (item.kind === 'pine') {
      // A gnarled pine: a leaning trunk, its needles in flat dark pads.
      const flip = item.variant % 2 === 0 ? 1 : -1;
      g.moveTo(cx - flip * t * 0.05, cy + t * 0.38).quadraticCurveTo(
        cx + flip * t * 0.2,
        cy + t * 0.05,
        cx - flip * t * 0.05,
        cy - t * 0.2,
      );
      g.stroke({ width: Math.max(1.5, t * 0.09), color: 0x4a3328, cap: 'round' });
      for (const [dx, dy, w] of [
        [-0.12, -0.28, 0.24],
        [0.14, -0.08, 0.2],
        [-0.16, 0.08, 0.18],
      ] as const) {
        g.ellipse(cx + flip * t * dx, cy + t * dy, t * w, t * w * 0.42);
      }
      g.fill({ color: 0x2f5a3a });
      g.stroke({ width: line, color: ink, alpha: 0.5 });
    } else if (item.kind === 'bush') {
      // Bamboo: three stalks with joints, a few leaves at their tops.
      for (const [dx, h] of [
        [-0.14, 0.62],
        [0, 0.78],
        [0.14, 0.55],
      ] as const) {
        g.moveTo(cx + t * dx, cy + t * 0.35).lineTo(cx + t * dx, cy + t * (0.35 - h));
      }
      g.stroke({ width: Math.max(1.5, t * 0.07), color: 0x6f9a45, cap: 'round' });
      for (const [dx, h] of [
        [-0.14, 0.62],
        [0, 0.78],
        [0.14, 0.55],
      ] as const) {
        for (const f of [0.35, 0.7]) {
          g.moveTo(cx + t * (dx - 0.04), cy + t * (0.35 - h * f)).lineTo(
            cx + t * (dx + 0.04),
            cy + t * (0.35 - h * f),
          );
        }
        g.moveTo(cx + t * dx, cy + t * (0.35 - h)).lineTo(cx + t * (dx + 0.16), cy + t * (0.3 - h));
        g.moveTo(cx + t * dx, cy + t * (0.4 - h)).lineTo(cx + t * (dx - 0.15), cy + t * (0.36 - h));
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x3f6a2a, cap: 'round' });
    } else if (item.variant % 3 === 0) {
      // A stone lantern: a foot, a post, the light box under a roof with a knob.
      const s = t * 0.42;
      g.rect(cx - s * 0.32, cy + s * 0.55, s * 0.64, s * 0.18);
      g.rect(cx - s * 0.1, cy + s * 0.05, s * 0.2, s * 0.5);
      g.rect(cx - s * 0.24, cy - s * 0.3, s * 0.48, s * 0.35);
      g.fill({ color: hex(palette.rockMid) });
      g.stroke({ width: line, color: ink, alpha: 0.7 });
      g.rect(cx - s * 0.08, cy - s * 0.22, s * 0.16, s * 0.18);
      g.fill({ color: ink, alpha: 0.7 });
      g.poly([
        cx - s * 0.45,
        cy - s * 0.3,
        cx + s * 0.45,
        cy - s * 0.3,
        cx + s * 0.18,
        cy - s * 0.55,
        cx - s * 0.18,
        cy - s * 0.55,
      ]);
      g.fill({ color: hex(palette.rockDark) });
      g.stroke({ width: line, color: ink, alpha: 0.7, join: 'round' });
      g.circle(cx, cy - s * 0.62, s * 0.08);
      g.fill({ color: hex(palette.rockDark) });
    } else {
      // A garden rock: low, pale and angular, moss at its foot.
      const w = t * 0.36;
      g.ellipse(cx + t * 0.04, cy + t * 0.2, w * 1.1, t * 0.08);
      g.fill({ color: MOSS, alpha: 0.7 });
      g.poly([
        cx - w,
        cy + t * 0.18,
        cx - w * 0.6,
        cy - t * 0.12,
        cx - w * 0.05,
        cy - t * 0.2,
        cx + w * 0.7,
        cy - t * 0.05,
        cx + w,
        cy + t * 0.18,
      ]);
      g.fill({ color: hex(palette.rockLight) });
      g.stroke({ width: line, color: ink, alpha: 0.7, join: 'round' });
      g.moveTo(cx - w * 0.3, cy - t * 0.12).lineTo(cx - w * 0.1, cy + t * 0.15);
      g.stroke({ width: 1, color: hex(palette.rockMid), alpha: 0.9 });
    }
  }
}
