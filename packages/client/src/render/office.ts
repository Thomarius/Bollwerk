import type { ArtConfig, OfficeStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { inFinalRound } from '../scores.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { hash } from './noise.js';
import { IslandParts } from './islandParts.js';
import { roseSpot } from './corner.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { OfficeSeaLife, drawPlane } from './seaLife.js';
import { Discs, StampBook, Stamps } from './stamps.js';
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
  playerColour,
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
} from './theme.js';
import { outline, trace, wallGeometry, type Segment } from './walls.js';

/** Something with a place and an age: a crashed plane, shreds, a flat-pack unfolding. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A piece set down, unfolding out of its flat-pack. */
interface Unpacking {
  cells: readonly Cell[];
  age: number;
}

/** Paper knocked out of a partition, in tiles: a sheet, a clip, or a bit of the panel. */
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  floor: number;
  colour: number;
  angle: number;
  spin: number;
  kind: 'sheet' | 'clip' | 'panel';
}

/** Where a shot came down on the linoleum: a ring of coffee, fading over the rounds. */
interface Stain {
  x: number;
  y: number;
  round: number;
}

/** A drip from the leaking ceiling, by where it lands and how far through its fall. */
interface Drip {
  x: number;
  y: number;
  age: number;
  life: number;
}

/** A shred of paper drifting down in a "snowy" match, in tiles on screen. */
interface Shred {
  x: number;
  y: number;
  angle: number;
  spin: number;
  speed: number;
}

/** A corner office on a castle's tiles: where its parts stand on screen. */
interface Desk {
  cx: number;
  foot: number;
  W: number;
  /** The desk's top surface. */
  top: number;
  screen: { x: number; y: number; w: number; h: number };
  lamp: { x: number; y: number };
  mug: { x: number; y: number };
  phone: { x: number; y: number };
}

const RECOIL_MS = 220;
const SCAN_MS = 380;
const CRASH_MS = 2600;
const SHRED_MS = 1100;
const UNPACK_MS = 600;
const DRIP_MS = 700;

const STEEL = 0xe6e8ec;
const STEEL_DARK = 0x9a9ea5;
const ALUMINIUM = 0xb9bfc7;
const PAPER = 0xf7f7f2;
const WOOD = 0xb07a4a;
const WOOD_DARK = 0x7a5232;
const SCREEN_OFF = 0x1a1c20;
const SCREEN_ON = 0xd4ecff;
const CARDBOARD = 0xb88a58;
const RED_INK = 0xd03a3a;

/** How Office sends off the winners: sticky notes from the poppers, a necktie for a flag. */
const FINISH: FinishLook = { spark: 'memo', flag: 'necktie' };

/**
 * The Office look, for either look: an open-plan office at war with itself, every
 * department taking it deadly seriously. The sea is the carpet, charcoal tiles laid in
 * alternating directions; the land each department's pale linoleum, edged in aluminium
 * skirting. Walls are cubicle partitions in the owner's colour under an aluminium cap; castles
 * are corner offices, and sealed is the office working — screen on with its chart climbing,
 * lamp lit, the coffee steaming; a breach puts a sad face on the screen. Sealed ground is
 * booked: the owner's carpet tiles inside a border of floor tape. Guns are photocopiers on the
 * five-star base of an office chair, turning to their target and throwing paper planes; a
 * silenced one has "out of order" taped to it. A water cooler stands in the corner, two
 * colleagues gossiping beside it; in the deadline — overtime and the final round — the
 * fluorescent tubes flicker and the phones on every desk ring.
 */
export class OfficeTheme implements Theme {
  readonly id = 'office' as const;

  private art!: ArtConfig;
  private style!: OfficeStyleConfig;
  private weather: Weather = 'clear';
  /** Life on the outer carpet (`seaLife.ts`). */
  private readonly seaLife = new OfficeSeaLife();

  private readonly terrainGfx = new Graphics();
  /** Coffee where shots came down: redrawn when one is added or fades a round. */
  private readonly stainGfx = new Graphics();
  private stainsDrawn = '';
  /** The water cooler and its gossips: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawOfficeScenery(g, view, items, this.art),
    () => 0xd8d8d0,
  );
  /** Partitions, offices and the copiers' bases, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  /** The copiers, a stamp each of an owner's copier, turned to its target (PLAN 11.22). */
  private readonly copierStamps = new Stamps();
  private readonly book = new StampBook();
  private readonly effectGfx = new Graphics();
  /** The paper planes in flight, stamps of one plane a colour, turned along their course. */
  private readonly planeStamps = new Stamps();
  /** Everything over the planes: paper flying, shreds, drips, the tubes, the finish. */
  private readonly lateGfx = new Graphics();
  /** Shredded paper falling in a "snowy" match, stamps of one strip. */
  private readonly shredStamps = new Stamps();
  /** The haze of burnt popcorn in a foggy one. */
  private readonly haze = new Discs();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private round = 0;
  private cooler: TimerSpot | null = null;
  /** Buckets under the leaks, in a rainy match: tiles of open carpet. */
  private buckets: Cell[] = [];
  private stains: Stain[] = [];
  private crashes: Aged[] = [];
  private shreds: Aged[] = [];
  private unpacking: Unpacking[] = [];
  private bits: Bit[] = [];
  private drips: Drip[] = [];
  private falling: Shred[] = [];
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The offices working, raised as a flag is: by sealing, and stopped by a breach. */
  private readonly working = new FlagHoist();
  private clock = 0;

  constructor(private readonly seed = 1) {}

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.office;
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    layers.terrain.addChild(this.terrainGfx, this.stainGfx, this.flowGfx);
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.copierStamps.container,
      this.effectGfx,
      this.planeStamps.container,
      this.lateGfx,
      this.shredStamps.container,
      this.haze.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.copierStamps.destroy();
    this.planeStamps.destroy();
    this.shredStamps.destroy();
    this.haze.destroy();
    this.book.destroy();
    for (const g of [
      this.terrainGfx,
      this.stainGfx,
      this.flowGfx,
      this.effectGfx,
      this.lateGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  private ink(view: ViewTransform): number {
    return Math.max(1, view.tile * 0.07);
  }

  private get dark(): number {
    return hex(this.art.palette.shadow);
  }

  private land(x: number, y: number): boolean {
    return (
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      this.terrain[y * this.width + x] === Terrain.Land
    );
  }

  /** In the deadline: overtime, and the final round. */
  private deadline(state: MatchState): boolean {
    return (state.phase === 'build' && state.overtime) || inFinalRound(state);
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

    // The carpet runs out past the board to the window's edge: tiles of two by two, laid in
    // alternating directions as office carpet is, so it shows a faint checker.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX - (marginX % 2);
    const y0 = -marginY - (marginY % 2);
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    g.fill({ color: hex(palette.waterMid) });
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        if (((x - x0) / 2 + (y - y0) / 2) % 2 === 0) continue;
        g.rect(tileX(view, x), tileY(view, y), t * 2, t * 2);
      }
    }
    g.fill({ color: hex(palette.waterShallow), alpha: 0.45 });
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const across = ((x - x0) / 2 + (y - y0) / 2) % 2 === 0;
        const left = tileX(view, x);
        const top = tileY(view, y);
        for (let k = 1; k <= 3; k++) {
          const f = (k / 4) * t * 2;
          if (across) g.moveTo(left + 1, top + f).lineTo(left + t * 2 - 1, top + f);
          else g.moveTo(left + f, top + 1).lineTo(left + f, top + t * 2 - 1);
        }
      }
    }
    g.stroke({ width: 1, color: hex(palette.waterDeep), alpha: 0.55 });
    // Flecks in the pile, and here and there an old stain nobody owns up to.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y) || hash(x, y, 700) > 0.06) continue;
        g.circle(
          tileX(view, x + hash(x, y, 701)),
          tileY(view, y + hash(x, y, 702)),
          Math.max(0.8, t * 0.05),
        );
      }
    }
    g.fill({ color: hex(palette.waterFoam), alpha: 0.22 });
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (hash(x, y, 703) > 0.004 || !this.openCarpet(x, y)) continue;
        g.ellipse(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.7, t * 0.45);
      }
    }
    g.fill({ color: hex(palette.craterMid), alpha: 0.18 });

    // The linoleum: square tiles, a few lighter, scuffed here and there.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if ((x + y) % 2 === 0) g.rect(tileX(view, x), tileY(view, y), t, t);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.45 });
    for (const { x, y } of ground) {
      g.rect(tileX(view, x), tileY(view, y), t, t);
    }
    g.stroke({ width: 1, color: hex(palette.grassDark), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 710) > 0.12) continue;
      const sx = tileX(view, x + 0.2 + hash(x, y, 711) * 0.5);
      const sy = tileY(view, y + 0.3 + hash(x, y, 712) * 0.4);
      g.moveTo(sx, sy).lineTo(sx + t * 0.25, sy + t * 0.06);
    }
    g.stroke({ width: 1, color: hex(palette.grassDark), alpha: 0.5 });
    // A faint tint of the owner over each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.06 });
    }

    // The aluminium skirting along every coast, and the cable duct just inside it.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.26, color: hex(palette.sand), cap: 'square' });
    trace(g, coast);
    g.stroke({ width: Math.max(1, t * 0.06), color: 0xf4f5f7, alpha: 0.7, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: 1, color: this.dark, alpha: 0.6, cap: 'square' });

    // The water cooler's place, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.cooler = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.cooler = this.cooler;
    this.seaLife.layout(state, view, this.art);

    // Buckets under the leaks, in a rainy match.
    this.buckets = [];
    if (this.weather === 'rain') {
      for (let y = 0; y < state.height && this.buckets.length < 6; y++) {
        for (let x = 0; x < state.width && this.buckets.length < 6; x++) {
          if (!this.openCarpet(x, y) || hash(x, y, this.seed + 720) > 0.012) continue;
          this.buckets.push({ x, y });
        }
      }
      for (const b of this.buckets) this.drawBucket(g, view, b);
    }
    this.stainsDrawn = '';
  }

  /** Carpet with carpet all round it, where a bucket or a stain may stand clear of the coast. */
  private openCarpet(x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (this.land(x + dx, y + dy)) return false;
    }
    return true;
  }

  private drawBucket(g: Graphics, view: ViewTransform, b: Cell): void {
    const t = view.tile;
    const cx = tileX(view, b.x + 0.5);
    const cy = tileY(view, b.y + 0.5);
    g.ellipse(cx + t * 0.06, cy + t * 0.12, t * 0.42, t * 0.36);
    g.fill({ color: 0x000000, alpha: 0.3 });
    // A grey pail: blue would read as the azure player's.
    g.circle(cx, cy, t * 0.4);
    g.fill({ color: STEEL_DARK });
    g.stroke({ width: Math.max(1, t * 0.08), color: 0x5a5d63 });
    g.circle(cx, cy, t * 0.28);
    g.fill({ color: 0xb8c8d4, alpha: 0.8 });
  }

  /** The coffee rings, drawn again only when one comes or fades. */
  private drawStains(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.stains = this.stains.filter((s) => state.round - s.round < rounds);
    const key = `${state.round}|${this.stains.length}|${view.tile}|${view.originX}|${view.originY}`;
    if (key === this.stainsDrawn) return;
    this.stainsDrawn = key;
    const g = this.stainGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    for (const s of this.stains) {
      const fade = 1 - (state.round - s.round) / rounds;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.circle(cx, cy, t * 0.34);
      g.fill({ color: hex(palette.craterMid), alpha: 0.25 * fade });
      g.circle(cx, cy, t * 0.34);
      g.stroke({ width: Math.max(1, t * 0.07), color: hex(palette.craterDark), alpha: 0.6 * fade });
      // A drip run off the side, and a splash.
      const a = hash(s.x, s.y, 730) * Math.PI * 2;
      g.circle(cx + Math.cos(a) * t * 0.5, cy + Math.sin(a) * t * 0.5, t * 0.07);
      g.fill({ color: hex(palette.craterDark), alpha: 0.5 * fade });
    }
  }

  // ------------------------------------------------------------------ the cooler

  /**
   * The water cooler in the corner: a white stand, its bottle upside down on top, a bubble
   * glugging up it now and then; a stack of cups; and two colleagues beside it, one talking
   * and then the other, a balloon of "…" over whoever has the floor.
   */
  private drawCooler(g: Graphics, view: ViewTransform, spot: TimerSpot): void {
    const t = view.tile;
    const s = spot.size * t;
    const cx = tileX(view, spot.x) - s * 0.12;
    const base = tileY(view, spot.y) + s * 0.38;
    const still = motionReduced();
    g.ellipse(cx + s * 0.05, base, s * 0.42, s * 0.07);
    g.fill({ color: 0x000000, alpha: 0.3 });
    // The stand, its tap and drip tray.
    g.roundRect(cx - s * 0.12, base - s * 0.42, s * 0.24, s * 0.42, s * 0.02);
    g.fill({ color: STEEL });
    g.stroke({ width: 1, color: this.dark, alpha: 0.7 });
    g.rect(cx - s * 0.03, base - s * 0.33, s * 0.06, s * 0.04);
    g.fill({ color: 0x3a6aa0 });
    g.rect(cx - s * 0.08, base - s * 0.22, s * 0.16, s * 0.025);
    g.fill({ color: STEEL_DARK });
    // The bottle, upside down: water in it, and the glug.
    const bottom = base - s * 0.42;
    g.roundRect(cx - s * 0.13, bottom - s * 0.34, s * 0.26, s * 0.32, s * 0.08);
    g.fill({ color: 0x9ac4ec, alpha: 0.75 });
    g.stroke({ width: 1, color: 0x3a6aa0, alpha: 0.9 });
    g.rect(cx - s * 0.04, bottom - s * 0.03, s * 0.08, s * 0.04);
    g.fill({ color: 0x3a6aa0 });
    g.rect(cx - s * 0.09, bottom - s * 0.31, s * 0.04, s * 0.22);
    g.fill({ color: 0xffffff, alpha: 0.45 });
    if (!still) {
      const every = this.style.glugEveryMs;
      const p = (this.clock % every) / 700;
      if (p < 1) {
        g.circle(cx + s * 0.02, bottom - s * (0.04 + 0.26 * p), s * (0.025 + 0.03 * p));
        g.fill({ color: 0xffffff, alpha: 0.85 * (1 - p * 0.5) });
      }
    }
    // The cups, stacked beside it.
    g.poly([
      cx + s * 0.13,
      base - s * 0.36,
      cx + s * 0.19,
      base - s * 0.36,
      cx + s * 0.18,
      base - s * 0.2,
      cx + s * 0.14,
      base - s * 0.2,
    ]);
    g.fill({ color: PAPER });
    // The two gossips, a shirt and tie each, and the balloon over whoever is talking.
    const talker = still ? 0 : Math.floor(this.clock / 2600) % 2;
    for (const [k, dx, shirt, tie, skin, hair] of [
      [0, 0.34, 0xf4f5f7, 0x3a6aa0, 0xf2d0b0, 0x5a3a24],
      [1, 0.56, 0xc9d7e6, 0x6a6e76, 0x8a5a3a, 0x16181c],
    ] as const) {
      const x = cx + s * dx;
      const nod = !still && talker === k ? Math.sin(this.clock / 140) * s * 0.008 : 0;
      g.rect(x - s * 0.035, base - s * 0.16, s * 0.025, s * 0.16);
      g.rect(x + s * 0.01, base - s * 0.16, s * 0.025, s * 0.16);
      g.fill({ color: 0x2a2c31 });
      g.roundRect(x - s * 0.06, base - s * 0.4, s * 0.12, s * 0.25, s * 0.03);
      g.fill({ color: shirt });
      g.poly([x - s * 0.012, base - s * 0.37, x + s * 0.012, base - s * 0.37, x, base - s * 0.26]);
      g.fill({ color: tie });
      g.circle(x, base - s * 0.45 + nod, s * 0.055);
      g.fill({ color: skin });
      g.ellipse(x, base - s * 0.49 + nod, s * 0.055, s * 0.025);
      g.fill({ color: hair });
      if (talker !== k) continue;
      // A balloon of dots: whatever they are saying, it is about somebody here.
      const bx = x + (k === 0 ? -s * 0.02 : s * 0.06);
      const by = base - s * 0.66;
      g.roundRect(bx - s * 0.1, by - s * 0.06, s * 0.2, s * 0.11, s * 0.04);
      g.poly([bx - s * 0.02, by + s * 0.05, bx + s * 0.02, by + s * 0.05, bx, by + s * 0.1]);
      g.fill({ color: 0xffffff, alpha: 0.95 });
      const dots = still ? 3 : 1 + (Math.floor(this.clock / 400) % 3);
      for (let d = 0; d < dots; d++) g.circle(bx - s * 0.05 + d * s * 0.05, by, s * 0.012);
      g.fill({ color: this.dark });
    }
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as booked: the owner's carpet tiles over the linoleum, laid in alternating
   * directions as the corridor's are, inside a border of floor tape striped in the owner's
   * colour and white — the facility manager's way of saying whose it is.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawBooked(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawBooked(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      for (const { x, y } of cells) {
        const left = tileX(view, x);
        const top = tileY(view, y);
        const across = (x + y) % 2 === 0;
        for (const f of [0.33, 0.66]) {
          if (across) g.moveTo(left, top + t * f).lineTo(left + t, top + t * f);
          else g.moveTo(left + t * f, top).lineTo(left + t * f, top + t);
        }
      }
      g.stroke({ width: 1, color: this.colour(player, 'dark'), alpha: 0.35 });
      // The tape: white, with the owner's stripes across it.
      const edge = outline(cells, owned, view);
      const inset = edge.map((s) => insetSegment(s, t * 0.1, owned, view));
      trace(g, inset);
      g.stroke({ width: Math.max(2, t * 0.16), color: 0xf4f5f7, alpha: 0.95, cap: 'square' });
      const stripes: Segment[] = [];
      for (const s of inset) stripes.push(...dashes(s, t * 0.22, t * 0.22));
      trace(g, stripes);
      g.stroke({ width: Math.max(2, t * 0.16), color: this.colour(player, 'base'), cap: 'butt' });
    }
    dimEliminated(g, state, view, this.dark);
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
      this.drawPartitions(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawOffice(g, view, castle);

    // Guns stand on the five-star base of an office chair, on the shared square; the copier
    // on it is drawn with the effects, turned to its target.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = Math.min(cannon.w, cannon.h) * t * 0.44;
      cannonBase(
        g,
        view,
        cannon,
        this.colour(cannon.owner, 'dark'),
        this.colour(cannon.owner, 'base'),
      );
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
        g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke({ width: Math.max(1.5, t * 0.12), color: 0x2a2c31, cap: 'round' });
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k / 5) * Math.PI * 2;
        g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(1, t * 0.08));
      }
      g.fill({ color: 0x16181c });
    }
  }

  /**
   * Walls as cubicle partitions: each block a fabric panel in the owner's colour, flecked
   * as office fabric is, a seam between panels so a shot visibly takes one, an aluminium
   * cap along the top and a kick plate at the foot of each face; standing to the shared
   * height. Here and there a memo is pinned on. A player's who is out (`player` -1) has
   * theirs under grey dust sheets: restructured.
   */
  private drawPartitions(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const dead = player < 0;
    const fabric = dead ? hex(palette.rockMid) : this.colour(player, 'base');
    const fabricDark = dead ? hex(palette.rockDark) : this.colour(player, 'dark');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: fabric });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: fabricDark });
    // The weave's flecks.
    for (const b of wall.blocks) {
      for (let k = 0; k < 3; k++) {
        g.rect(
          b.left + t * (0.15 + 0.7 * hash(b.x, b.y * 3 + k, 740)),
          b.top + (b.lip - b.top) * (0.15 + 0.7 * hash(b.x, b.y * 3 + k, 741)),
          Math.max(1, t * 0.06),
          Math.max(1, t * 0.06),
        );
      }
    }
    g.fill({ color: dead ? hex(palette.rockLight) : this.colour(player, 'light'), alpha: 0.4 });
    // The kick plates along the foot of each face.
    for (const r of wall.faces) g.rect(r.x, r.y + r.h * 0.62, r.w, r.h * 0.38);
    g.fill({ color: 0x5a5d63 });
    // The seams between panels, where the next one runs on.
    for (const b of wall.blocks) {
      if (joins(b.x + 1, b.y))
        g.moveTo(b.left + t, b.top).lineTo(b.left + t, b.lip + (b.faced ? wall.face : 0));
      if (joins(b.x, b.y + 1)) g.moveTo(b.left, b.top + t).lineTo(b.left + t, b.top + t);
    }
    g.stroke({ width: Math.max(1, t * 0.08), color: ALUMINIUM, alpha: 0.9 });
    if (dead) {
      // The dust sheets, thrown over and folded.
      for (const b of wall.blocks) {
        g.moveTo(b.left + t * 0.1, b.top + t * 0.2).lineTo(b.left + t * 0.7, b.lip);
        g.moveTo(b.left + t * 0.5, b.top).lineTo(b.left + t * 0.95, b.top + t * 0.6);
      }
      g.stroke({ width: 1, color: hex(palette.rockLight), alpha: 0.7 });
    } else {
      // A memo pinned on here and there.
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 742) > 0.06) continue;
        const mx = b.left + t * 0.3;
        const my = b.top + (b.lip - b.top) * 0.2;
        g.rect(mx, my, t * 0.34, t * 0.38);
      }
      g.fill({ color: PAPER });
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 742) > 0.06) continue;
        g.circle(
          b.left + t * 0.47,
          b.top + (b.lip - b.top) * 0.2 + t * 0.04,
          Math.max(1, t * 0.05),
        );
      }
      g.fill({ color: RED_INK });
    }
    // The aluminium cap round the top, and the ink of the faces.
    trace(g, wall.rim);
    g.stroke({ width: Math.max(1.5, t * 0.12), color: ALUMINIUM, cap: 'square' });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, this.ink(view) * 0.6), color: this.dark, alpha: 0.8 });
  }

  private desk(view: ViewTransform, castle: Castle): Desk {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot = tileY(view, castle.y + castle.h) - t * 0.05;
    const top = foot - W * 0.46;
    return {
      cx,
      foot,
      W,
      top,
      screen: { x: cx - W * 0.38, y: top - W * 0.3, w: W * 0.36, h: W * 0.24 },
      lamp: { x: cx + W * 0.26, y: top - W * 0.36 },
      mug: { x: cx + W * 0.06, y: top },
      phone: { x: cx - W * 0.02, y: top },
    };
  }

  /**
   * A castle as a corner office, seen across the desk: an executive chair in the owner's
   * colour behind it, a monitor and an angled lamp on it, a mug and a phone, a nameplate in
   * the owner's colour on its front. Its screen, lamp and coffee are drawn with the effects.
   */
  private drawOffice(g: Graphics, view: ViewTransform, castle: Castle): void {
    const owner = castle.islandId - 1;
    const k = this.desk(view, castle);
    const { cx, foot, W, top } = k;
    const ink = this.ink(view);
    g.ellipse(cx + W * 0.05, foot, W * 0.52, W * 0.09);
    g.fill({ color: this.dark, alpha: 0.35 });
    // The chair behind the desk: its tall back and headrest.
    g.roundRect(cx - W * 0.03, top - W * 0.5, W * 0.3, W * 0.5, W * 0.06);
    g.fill({ color: this.colour(owner, 'base') });
    g.stroke({ width: ink, color: this.dark, alpha: 0.8 });
    g.roundRect(cx + W * 0.03, top - W * 0.44, W * 0.18, W * 0.3, W * 0.04);
    g.fill({ color: this.colour(owner, 'light'), alpha: 0.5 });
    // The monitor, on its stand.
    const sc = k.screen;
    g.rect(sc.x + sc.w * 0.42, sc.y + sc.h, sc.w * 0.16, top - sc.y - sc.h);
    g.fill({ color: 0x2a2c31 });
    g.roundRect(sc.x - W * 0.025, sc.y - W * 0.025, sc.w + W * 0.05, sc.h + W * 0.05, W * 0.02);
    g.fill({ color: 0x2a2c31 });
    g.rect(sc.x, sc.y, sc.w, sc.h);
    g.fill({ color: SCREEN_OFF });
    // The lamp: its base, the arm, and the head tipped down over the desk.
    const lp = k.lamp;
    g.moveTo(cx + W * 0.36, top)
      .lineTo(cx + W * 0.4, top - W * 0.2)
      .lineTo(lp.x, lp.y);
    g.stroke({ width: Math.max(1, W * 0.025), color: 0x2a2c31, cap: 'round', join: 'round' });
    g.poly([
      lp.x - W * 0.07,
      lp.y + W * 0.05,
      lp.x + W * 0.03,
      lp.y - W * 0.03,
      lp.x + W * 0.07,
      lp.y + W * 0.02,
      lp.x - W * 0.02,
      lp.y + W * 0.09,
    ]);
    g.fill({ color: 0x3a3d44 });
    // The mug and the phone.
    g.rect(k.mug.x - W * 0.035, k.mug.y - W * 0.07, W * 0.07, W * 0.07);
    g.fill({ color: PAPER });
    g.stroke({ width: 1, color: this.dark, alpha: 0.6 });
    g.rect(k.phone.x - W * 0.06, k.phone.y - W * 0.04, W * 0.12, W * 0.04);
    g.fill({ color: 0x16181c });
    // The desk: its top and its front, a nameplate on it, drawer handles either side.
    g.rect(cx - W * 0.47, top, W * 0.94, W * 0.07);
    g.fill({ color: WOOD });
    g.stroke({ width: ink, color: this.dark, alpha: 0.85 });
    g.rect(cx - W * 0.44, top + W * 0.07, W * 0.88, foot - top - W * 0.1);
    g.fill({ color: WOOD_DARK });
    g.stroke({ width: ink, color: this.dark, alpha: 0.85 });
    g.rect(cx - W * 0.14, top + W * 0.14, W * 0.28, W * 0.09);
    g.fill({ color: this.colour(owner, 'base') });
    g.rect(cx - W * 0.09, top + W * 0.175, W * 0.18, W * 0.02);
    g.fill({ color: 0xffffff, alpha: 0.8 });
    for (const f of [-0.33, 0.33]) g.rect(cx + W * f - W * 0.04, top + W * 0.2, W * 0.08, W * 0.02);
    g.fill({ color: ALUMINIUM });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const onCarpet =
      this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (onCarpet) {
      this.crashes.push({ x, y, age: 0, owner: -1 });
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.stains.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      // Paper everywhere: sheets fluttering out, a clip or two, a bit of the panel.
      for (let k = 0; k < 7; k++) {
        const kind = k < 4 ? 'sheet' : k < 6 ? 'clip' : 'panel';
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const v = 1.4 + Math.random() * 1.8;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * (kind === 'sheet' ? 2 : 1.3),
          floor: block.y + 0.85 + Math.random() * 0.4,
          colour:
            kind === 'panel'
              ? block.owner < 0
                ? hex(this.art.palette.rockMid)
                : this.colour(block.owner, 'base')
              : kind === 'clip'
                ? 0xc9ccd1
                : PAPER,
          angle: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * (kind === 'sheet' ? 5 : 12),
          kind,
        });
      }
    }
  }

  /** The sweep: a panel left standing alone goes through the shredder. */
  noteCrumble(block: Debris): void {
    this.shreds.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    this.unpacking.push({ cells, age: 0 });
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    perf.begin('flow');
    this.drawStains(state, view);
    this.flowGfx.clear();
    if (this.cooler !== null) this.drawCooler(this.flowGfx, view, this.cooler);
    perf.end('flow');
    const g = this.effectGfx;
    g.clear();
    this.lateGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, 0xc9ccd1, null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawWorking(state, view, frame);
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.drawCopiers(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawCrashes(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawShreds(view, frame.deltaMs);
    this.drawUnpacking(view, frame.deltaMs);
    this.drawWeather(state, view, frame.deltaMs);
    this.drawTubes(state, view);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * The offices working, raised as a flag is: while a castle is sealed its screen is on with
   * a chart climbing, the lamp lights the desk and the coffee steams; a breach brings a sad
   * face to the screen as it goes dark — so "sealed" is the office working. In the deadline
   * every desk's phone rings.
   */
  private drawWorking(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const still = motionReduced();
    const ringing = this.deadline(state);
    this.working.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const k = this.desk(view, castle);
      const owner = state.players[castle.islandId - 1];
      if (ringing && owner !== undefined && !owner.eliminated) this.drawRinging(g, k, still);
      const lit = this.working.raised(castle.id, this.clock, this.art);
      if (lit === null) continue;
      const sc = k.screen;
      if (this.working.lowering(castle.id)) {
        // The screen gone grey, a sad face on it, fading as it goes dark.
        g.rect(sc.x, sc.y, sc.w, sc.h);
        g.fill({ color: 0x8a8e96, alpha: lit });
        const fx = sc.x + sc.w / 2;
        const fy = sc.y + sc.h / 2;
        g.circle(fx - sc.w * 0.15, fy - sc.h * 0.12, Math.max(0.8, sc.h * 0.07));
        g.circle(fx + sc.w * 0.15, fy - sc.h * 0.12, Math.max(0.8, sc.h * 0.07));
        g.fill({ color: SCREEN_OFF, alpha: lit });
        const mouth = sc.w * 0.18;
        g.moveTo(
          fx + Math.cos(Math.PI * 1.15) * mouth,
          fy + sc.h * 0.32 + Math.sin(Math.PI * 1.15) * mouth,
        );
        g.arc(fx, fy + sc.h * 0.32, mouth, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke({ width: Math.max(1, sc.h * 0.08), color: SCREEN_OFF, alpha: lit });
        continue;
      }
      // The lamp's light falling on the desk.
      g.poly([
        k.lamp.x - k.W * 0.05,
        k.lamp.y + k.W * 0.07,
        k.lamp.x + k.W * 0.04,
        k.lamp.y + k.W * 0.05,
        k.lamp.x + k.W * 0.12,
        k.top + k.W * 0.02,
        k.lamp.x - k.W * 0.2,
        k.top + k.W * 0.02,
      ]);
      g.fill({ color: 0xfff4c0, alpha: 0.35 * lit });
      // The screen on, a bar chart climbing on it and an arrow going up.
      g.rect(sc.x, sc.y, sc.w, sc.h);
      g.fill({ color: SCREEN_ON, alpha: lit });
      const run = still ? 0.6 : (this.clock / 1600 + castle.id * 0.37) % 1;
      for (let b = 0; b < 4; b++) {
        const h = sc.h * (0.2 + 0.15 * b) * (0.6 + 0.4 * Math.min(1, run * 4 - b * 0.6));
        g.rect(sc.x + sc.w * (0.12 + b * 0.2), sc.y + sc.h * 0.9 - h, sc.w * 0.13, h);
      }
      g.fill({ color: 0x3aa860, alpha: lit });
      g.moveTo(sc.x + sc.w * 0.12, sc.y + sc.h * 0.7).lineTo(sc.x + sc.w * 0.85, sc.y + sc.h * 0.2);
      g.stroke({ width: Math.max(1, sc.h * 0.07), color: RED_INK, alpha: lit, cap: 'round' });
      // The coffee steaming.
      if (still || lit < 0.9) continue;
      for (let n = 0; n < 2; n++) {
        const p = (this.clock / 1400 + n * 0.5 + castle.id * 0.21) % 1;
        const sx = k.mug.x + (n - 0.5) * k.W * 0.03 + Math.sin(p * 6 + n) * k.W * 0.02;
        const sy = k.mug.y - k.W * (0.08 + 0.18 * p);
        g.circle(sx, sy, k.W * (0.012 + 0.02 * p));
      }
      g.fill({ color: 0xffffff, alpha: 0.45 });
    }
  }

  /** The phone on a desk, ringing: the receiver jumping, and a "!" over it. */
  private drawRinging(g: Graphics, k: Desk, still: boolean): void {
    const jump = still ? 0 : Math.abs(Math.sin(this.clock / 45)) * k.W * 0.03;
    const x = k.phone.x;
    const y = k.phone.y - k.W * 0.05 - jump;
    g.roundRect(x - k.W * 0.07, y - k.W * 0.025, k.W * 0.14, k.W * 0.03, k.W * 0.015);
    g.fill({ color: 0x16181c });
    if (!still && Math.floor(this.clock / 300) % 2 === 1) return;
    const ex = x + k.W * 0.12;
    const ey = y - k.W * 0.18;
    g.rect(ex - k.W * 0.02, ey, k.W * 0.04, k.W * 0.1);
    g.circle(ex, ey + k.W * 0.14, k.W * 0.022);
    g.fill({ color: 0xffffff });
    g.rect(ex - k.W * 0.02, ey, k.W * 0.04, k.W * 0.1);
    g.stroke({ width: 1, color: this.dark, alpha: 0.8 });
  }

  /**
   * The copiers: grey, a band of the owner's colour along the side, the lid with its glass,
   * the control panel's little screen, and the output tray toward the target with a sheet
   * in it. They turn on their swivel bases to fire, kick back and flash the scan light as a
   * plane leaves. A silenced one turns aside with "out of order" taped on.
   */
  private drawCopiers(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    this.copierStamps.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2) - t * 0.08;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const angle = cannon.active ? aim.angle : Math.PI * 0.8;
      const back = kick * t * 0.12;
      const x = cx - Math.sin(angle) * back;
      const y = cy + Math.cos(angle) * back;
      const owner = cannon.owner;
      const copier = this.book.get(`copier|${owner}|${cannon.active}`, t, (k) =>
        this.copierShape(k, t, owner, cannon.active),
      );
      this.copierStamps.place(copier, x, y, { rotation: angle });
      if (cannon.active && aim.firedAgo < SCAN_MS) {
        const flash = this.book.get('scan', t, (k) => {
          k.rect(-t * 0.5, -t * 0.08, t * 1, t * 0.16);
          k.fill({ color: 0xd8ffe0 });
        });
        const p = aim.firedAgo / SCAN_MS;
        const along = (p - 0.5) * t * 0.7;
        this.copierStamps.place(flash, x + Math.sin(angle) * along, y - Math.cos(angle) * along, {
          rotation: angle,
          alpha: 0.85 * (1 - p),
        });
      }
    }
    this.copierStamps.end();
    this.aims.prune(state);
  }

  /** One copier, centred, its tray pointing up, for the stamp book. */
  private copierShape(k: Graphics, t: number, owner: number, active: boolean): void {
    const w = t * 1.2;
    const h = t * 1.05;
    // A shadow, the body, and the owner's band down one side.
    k.roundRect(-w / 2 + t * 0.06, -h / 2 + t * 0.08, w, h, t * 0.1);
    k.fill({ color: 0x000000, alpha: 0.3 });
    k.roundRect(-w / 2, -h / 2, w, h, t * 0.1);
    k.fill({ color: STEEL });
    k.stroke({ width: Math.max(1, t * 0.06), color: this.dark, alpha: 0.85 });
    k.rect(-w / 2 + t * 0.04, -h / 2 + t * 0.15, t * 0.14, h - t * 0.3);
    k.fill({ color: this.colour(owner, 'base') });
    // The lid over the glass, and the control panel with its little screen and a button.
    k.roundRect(-w / 2 + t * 0.24, -h / 2 + t * 0.32, w - t * 0.34, h - t * 0.44, t * 0.05);
    k.fill({ color: 0xc9ccd1 });
    k.stroke({ width: 1, color: STEEL_DARK });
    k.rect(w / 2 - t * 0.44, h / 2 - t * 0.2, t * 0.22, t * 0.1);
    k.fill({ color: active ? 0x8fd4a0 : 0x5a5d63 });
    k.circle(w / 2 - t * 0.14, h / 2 - t * 0.15, t * 0.05);
    k.fill({ color: active ? 0x3aa860 : RED_INK });
    // The output tray, and a sheet waiting in it.
    k.rect(-w * 0.3, -h / 2 - t * 0.2, w * 0.6, t * 0.24);
    k.fill({ color: 0xc9ccd1 });
    k.stroke({ width: 1, color: STEEL_DARK });
    k.rect(-w * 0.22, -h / 2 - t * 0.16, w * 0.44, t * 0.18);
    k.fill({ color: PAPER });
    if (active) return;
    // Out of order: a sheet taped on across the lid, crossed out in red.
    k.rect(-t * 0.26, -t * 0.2, t * 0.52, t * 0.42);
    k.fill({ color: PAPER });
    k.stroke({ width: 1, color: STEEL_DARK });
    k.rect(-t * 0.34, -t * 0.24, t * 0.14, t * 0.06);
    k.rect(t * 0.2, t * 0.16, t * 0.14, t * 0.06);
    k.fill({ color: 0xe8dfa0, alpha: 0.9 });
    k.moveTo(-t * 0.18, -t * 0.12).lineTo(t * 0.18, t * 0.14);
    k.moveTo(t * 0.18, -t * 0.12).lineTo(-t * 0.18, t * 0.14);
    k.stroke({ width: Math.max(1, t * 0.07), color: RED_INK, cap: 'round' });
  }

  /** Shots: paper planes in the owner's colour, nose along their course, a shadow below. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const at = (shot: Shot, p: number): { gx: number; gy: number; x: number; y: number } => {
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      return { gx, gy, x: gx, y: gy - shotLift(shot, p) * t };
    };
    this.planeStamps.begin();
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const here = at(shot, p);
      const ahead = at(shot, Math.min(1, p + 0.02));
      const behind = at(shot, Math.max(0, p - 0.02));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
      const high = Math.min(1, shotLift(shot, p) / 3);
      g.ellipse(here.gx, here.gy, t * 0.24, t * 0.08);
      g.fill({ color: 0x000000, alpha: 0.25 - 0.1 * high });
      const size = t * (0.85 + 0.25 * high);
      const plane = this.book.get(`plane|${shot.owner}`, t, (k) =>
        drawPlane(k, 0, 0, t * 0.85, 0, this.colour(shot.owner, 'base'), this.dark),
      );
      const wobble = motionReduced() ? 0 : Math.sin(this.clock / 120 + shot.id) * 0.08;
      this.planeStamps.place(plane, here.x, here.y, {
        rotation: angle + wobble,
        scale: size / (t * 0.85),
      });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    this.planeStamps.end();
  }

  /** A plane come down on the carpet: crumpled, nose first, lying there a while. */
  private drawCrashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const c of this.crashes) {
      c.age += deltaMs;
      const k = c.age / CRASH_MS;
      if (k >= 1) continue;
      const alpha = Math.min(1, (1 - k) / 0.3);
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.5);
      const bounce = k < 0.12 ? Math.sin((k / 0.12) * Math.PI) * t * 0.25 : 0;
      drawPlane(
        g,
        x,
        y - bounce,
        t * 0.6,
        hash(c.x, c.y, 750) * Math.PI * 2,
        PAPER,
        this.dark,
        alpha,
      );
      g.moveTo(x - t * 0.1, y - t * 0.08)
        .lineTo(x + t * 0.05, y + t * 0.02)
        .lineTo(x - t * 0.02, y + t * 0.1);
      g.stroke({ width: 1, color: this.dark, alpha: 0.5 * alpha });
    }
    this.crashes = this.crashes.filter((c) => c.age < CRASH_MS);
  }

  /** Paper knocked out of a partition: sheets fluttering down, clips and a bit of panel. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      const sheet = b.kind === 'sheet';
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // A sheet drifts down slowly, swaying; the rest fall and bounce.
      b.vy += (sheet ? 2.2 : 7) * dt;
      if (sheet) {
        b.vx *= Math.exp(-2.5 * dt);
        b.vy = Math.min(b.vy, 0.8);
        b.x += Math.sin(b.age / 180 + b.angle) * 0.6 * dt;
      }
      b.angle += b.spin * dt;
      if (b.y > b.floor && b.vy > 0) {
        b.y = b.floor;
        b.vy *= sheet ? 0 : -0.3;
        b.vx *= sheet ? 0 : 0.5;
        b.spin = 0;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const at = (u: number, v: number): [number, number] => [x + c * u - s * v, y + s * u + c * v];
      if (sheet) {
        const w = t * 0.22;
        const h = t * 0.3 * (0.4 + 0.6 * Math.abs(Math.cos(b.age / 200 + b.angle)));
        g.poly([...at(-w, -h), ...at(w, -h), ...at(w, h), ...at(-w, h)]);
        g.fill({ color: b.colour, alpha });
        g.stroke({ width: 1, color: STEEL_DARK, alpha: 0.7 * alpha });
      } else if (b.kind === 'clip') {
        const l = t * 0.14;
        g.poly([...at(-l, -l * 0.4), ...at(l, -l * 0.4), ...at(l, l * 0.4), ...at(-l, l * 0.4)]);
        g.stroke({ width: 1, color: b.colour, alpha });
      } else {
        g.poly([
          ...at(-t * 0.2, -t * 0.12),
          ...at(t * 0.2, -t * 0.12),
          ...at(t * 0.2, t * 0.12),
          ...at(-t * 0.2, t * 0.12),
        ]);
        g.fill({ color: b.colour, alpha });
        g.moveTo(...at(-t * 0.2, -t * 0.12)).lineTo(...at(t * 0.2, -t * 0.12));
        g.stroke({ width: Math.max(1, t * 0.06), color: ALUMINIUM, alpha });
      }
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** A swept panel through the shredder: strips of it curling down and away. */
  private drawShreds(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.shreds) {
      s.age += deltaMs;
      const k = s.age / SHRED_MS;
      if (k >= 1) continue;
      const colour = s.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(s.owner, 'base');
      for (let n = 0; n < 6; n++) {
        const x = tileX(view, s.x + 0.12 + n * 0.15);
        const fall = k * t * (0.6 + 0.25 * hash(s.x + n, s.y, 760));
        const y = tileY(view, s.y + 0.1) + fall;
        const curl = Math.sin(k * 6 + n) * t * 0.08;
        g.moveTo(x, y).quadraticCurveTo(
          x + curl,
          y + t * 0.35,
          x - curl,
          y + t * 0.75 * (1 - k * 0.5),
        );
      }
      g.stroke({ width: Math.max(1, t * 0.09), color: colour, alpha: 1 - k });
    }
    this.shreds = this.shreds.filter((s) => s.age < SHRED_MS);
  }

  /** A piece set down unfolds out of its flat-pack: a cardboard square opening out, dust off it. */
  private drawUnpacking(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const u of this.unpacking) {
      u.age += deltaMs;
      const k = u.age / UNPACK_MS;
      if (k >= 1) continue;
      const grow = 0.55 + 0.6 * k;
      for (const { x, y } of u.cells) {
        const cx = tileX(view, x + 0.5);
        const cy = tileY(view, y + 0.5);
        g.rect(cx - (t * grow) / 2, cy - (t * grow) / 2, t * grow, t * grow);
      }
      g.stroke({ width: Math.max(1, t * 0.08), color: CARDBOARD, alpha: 1 - k });
      for (const { x, y } of u.cells) {
        for (let n = 0; n < 2; n++) {
          const a = hash(x, y * 2 + n, 770) * Math.PI * 2;
          const d = t * (0.4 + 0.5 * k);
          g.circle(
            tileX(view, x + 0.5) + Math.cos(a) * d,
            tileY(view, y + 0.5) + Math.sin(a) * d * 0.6,
            t * 0.06,
          );
        }
      }
      g.fill({ color: 0xd8d8d0, alpha: 0.7 * (1 - k) });
    }
    this.unpacking = this.unpacking.filter((u) => u.age < UNPACK_MS);
  }

  /**
   * The weather from the seed, as an office has it: "snow" is shredded paper drifting down
   * from the vents, "rain" the ceiling leaking — drips falling, a good share of them into
   * the buckets put out under the worst — and "fog" the haze of somebody's burnt popcorn.
   */
  private drawWeather(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.shredStamps.begin();
    this.haze.begin(t);
    if (this.weather === 'snow' && !still) {
      while (this.falling.length < this.style.snowCount) {
        this.falling.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          angle: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 3,
          speed: 0.5 + Math.random() * 0.6,
        });
      }
      const strip = this.book.get('shred', t, (k) => {
        k.rect(-t * 0.03, -t * 0.16, t * 0.06, t * 0.32);
        k.fill({ color: PAPER });
      });
      const dt = deltaMs / 1000;
      for (const f of this.falling) {
        f.y += f.speed * dt;
        f.x += Math.sin(this.clock / 900 + f.angle * 3) * 0.3 * dt;
        f.angle += f.spin * dt;
        if (f.y > rows) {
          f.y -= rows;
          f.x = Math.random() * cols;
        }
        this.shredStamps.place(strip, f.x * t, view.top + f.y * t, {
          rotation: f.angle,
          alpha: 0.85,
        });
      }
    }
    if (this.weather === 'rain' && !still) {
      const g = this.lateGfx;
      while (this.drips.length < this.style.rainCount) {
        const bucket =
          this.buckets.length > 0 && Math.random() < 0.3
            ? this.buckets[Math.floor(Math.random() * this.buckets.length)]
            : undefined;
        this.drips.push({
          x: bucket !== undefined ? bucket.x + 0.5 : Math.random() * state.width,
          y: bucket !== undefined ? bucket.y + 0.5 : Math.random() * state.height,
          age: -Math.random() * DRIP_MS * 4,
          life: DRIP_MS,
        });
      }
      for (const d of this.drips) {
        d.age += deltaMs;
        if (d.age < 0) continue;
        const x = tileX(view, d.x);
        const y = tileY(view, d.y);
        const k = d.age / d.life;
        if (k < 0.7) {
          const fall = (1 - k / 0.7) * t * 2.5;
          g.moveTo(x, y - fall - t * 0.25).lineTo(x, y - fall);
        }
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: 0x9ac4ec, alpha: 0.75 });
      for (const d of this.drips) {
        const k = d.age / d.life;
        if (k < 0.7 || k >= 1) continue;
        const q = (k - 0.7) / 0.3;
        g.ellipse(tileX(view, d.x), tileY(view, d.y), t * (0.1 + 0.3 * q), t * (0.05 + 0.15 * q));
      }
      g.stroke({ width: 1, color: 0x9ac4ec, alpha: 0.6 });
      this.drips = this.drips.filter((d) => d.age < d.life);
    }
    if (this.weather === 'fog') {
      const { hazeBanks, hazeAlpha } = this.style;
      for (let n = 0; n < hazeBanks; n++) {
        const drift = still ? 0 : this.clock / 60000;
        const fx = (((hash(n, this.seed, 780) + drift * (0.5 + hash(n, 1, 781))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 782);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.2],
          [2.4, 0.6, 2.4],
          [-2.2, 0.5, 2.2],
        ] as const) {
          this.haze.disc(x + dx * t, y + dy * t, r * t, 0xc8b89a, hazeAlpha);
        }
      }
    }
    this.shredStamps.end();
    this.haze.end();
  }

  /** In the deadline the fluorescent tubes at the screen's edges flicker, as they do at five. */
  private drawTubes(state: MatchState, view: ViewTransform): void {
    if (!this.deadline(state)) return;
    const g = this.lateGfx;
    const t = view.tile;
    const still = motionReduced();
    const top = view.top;
    const h = view.height - top;
    const tubes = Math.max(2, Math.floor(h / (t * 8)));
    for (let side = 0; side < 2; side++) {
      for (let n = 0; n < tubes; n++) {
        const blink = still
          ? 1
          : hash(n + side * 31, Math.floor(this.clock / 90), 790) < 0.12
            ? 0.25
            : 1;
        const x = side === 0 ? t * 0.4 : view.width - t * 1;
        const y = top + (h * (n + 0.5)) / tubes - t * 2;
        g.roundRect(x - t * 0.5, y - t * 0.5, t * 1.6, t * 5, t * 0.5);
        g.fill({ color: 0xe8f4ff, alpha: this.style.flickerAlpha * 0.6 * blink });
        g.roundRect(x, y, t * 0.6, t * 4, t * 0.3);
        g.fill({ color: 0xf4fbff, alpha: Math.min(1, this.style.flickerAlpha * 3) * blink });
      }
    }
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
      // The piece in hand as a selection, marching ants round it; where it does not fit, a
      // "not allowed" sign over it — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark),
        alpha: ghost.valid ? 0.35 : 0.3,
      });
      const edge = outline(cells, inPiece, view);
      trace(g, edge);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0xffffff, alpha: 0.95 });
      const period = t * 0.5;
      const march = motionReduced() ? 0 : ((now / 30) % period) - period;
      const ants: Segment[] = [];
      for (const s of edge) ants.push(...dashes(s, period / 2, period / 2, march));
      trace(g, ants);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: this.dark });
      if (!ghost.valid) {
        let sx = 0;
        let sy = 0;
        for (const c of cells) {
          sx += c.x + 0.5;
          sy += c.y + 0.5;
        }
        const cx = tileX(view, sx / cells.length);
        const cy = tileY(view, sy / cells.length);
        const r = t * 0.55;
        g.circle(cx, cy, r);
        g.fill({ color: 0xffffff, alpha: 0.8 });
        g.circle(cx, cy, r);
        g.moveTo(cx - r * 0.7, cy - r * 0.7).lineTo(cx + r * 0.7, cy + r * 0.7);
        g.stroke({ width: Math.max(1.5, t * 0.14), color: hex(palette.uiInvalid) });
      }
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The copier's footprint, a dashed selection, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.roundRect(x + t * 0.15, y + t * 0.15, w - t * 0.3, h - t * 0.3, t * 0.15);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(x + t * 0.3, y + h - t * 0.3).lineTo(x + w - t * 0.3, y + t * 0.3);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/** A segment moved `by` into the region it bounds, so the tape lies just inside the edge. */
function insetSegment(
  s: Segment,
  by: number,
  inside: (x: number, y: number) => boolean,
  view: ViewTransform,
): Segment {
  const mx = (s.x1 + s.x2) / 2;
  const my = (s.y1 + s.y2) / 2;
  const horizontal = s.y1 === s.y2;
  const probe = (dx: number, dy: number): boolean =>
    inside(
      Math.floor((mx + dx - view.originX) / view.tile),
      Math.floor((my + dy - view.originY) / view.tile),
    );
  if (horizontal) {
    const down = probe(0, 1) ? by : -by;
    return { x1: s.x1, y1: s.y1 + down, x2: s.x2, y2: s.y2 + down };
  }
  const right = probe(1, 0) ? by : -by;
  return { x1: s.x1 + right, y1: s.y1, x2: s.x2 + right, y2: s.y2 };
}

/**
 * A segment as dashes on one lattice: `on` drawn, `off` left, starting `phase` along, so
 * dashes on neighbouring segments line up and, moved by the clock, march.
 */
function dashes(s: Segment, on: number, off: number, phase = 0): Segment[] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const period = on + off;
  // Measured from the screen's lattice, so the pattern runs on across tiles.
  const origin = (Math.abs(dx) > 0 ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2)) + phase;
  const startAt = ((-origin % period) + period) % period;
  const out: Segment[] = [];
  const forward = (Math.abs(dx) > 0 ? dx : dy) > 0;
  for (let a = startAt - period; a < length; a += period) {
    const from = Math.max(0, a);
    const to = Math.min(length, a + on);
    if (to <= from) continue;
    const f0 = forward ? from : length - to;
    const f1 = forward ? to : length - from;
    out.push({
      x1: s.x1 + (dx * f0) / length,
      y1: s.y1 + (dy * f0) / length,
      x2: s.x1 + (dx * f1) / length,
      y2: s.y1 + (dy * f1) / length,
    });
  }
  return out;
}

/**
 * Office's scenery, none like a partition, a copier or a plane: a tree a potted ficus; a
 * pine a desk with its computer and chair, so a copse of them is an open-plan cluster; a
 * bush a snake plant, or a cactus on a little filing cabinet; a boulder an abandoned swivel
 * chair seen from the side, a stack of archive boxes, or — one in three — a printer with a
 * sheet jammed in it, its red light on.
 */
function drawOfficeScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const ink = hex(art.palette.shadow);
  const greens = [0x3a7a3c, 0x4f9a48, 0x2f6a34];
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // A ficus in a grey pot, its leaves in clumps.
      g.ellipse(cx + t * 0.05, cy + t * 0.4, t * 0.3, t * 0.07);
      g.fill({ color: ink, alpha: 0.3 });
      g.poly([
        cx - t * 0.18,
        cy + t * 0.12,
        cx + t * 0.18,
        cy + t * 0.12,
        cx + t * 0.13,
        cy + t * 0.4,
        cx - t * 0.13,
        cy + t * 0.4,
      ]);
      g.fill({ color: 0x6a6e76 });
      g.moveTo(cx, cy + t * 0.12).lineTo(cx, cy - t * 0.1);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x5a3a24 });
      for (const [dx, dy, r] of [
        [0, -0.25, 0.22],
        [-0.17, -0.1, 0.17],
        [0.17, -0.12, 0.17],
        [0.02, -0.42, 0.14],
      ] as const) {
        g.circle(cx + dx * t, cy + dy * t, r * t);
      }
      g.fill({ color: greens[item.variant % greens.length]! });
      g.circle(cx - t * 0.06, cy - t * 0.3, t * 0.07);
      g.fill({ color: 0xffffff, alpha: 0.2 });
    } else if (item.kind === 'pine') {
      // A desk of the open plan: its top, a computer on it, the chair pushed back.
      g.circle(cx + t * 0.02, cy + t * 0.3, t * 0.15);
      g.fill({ color: 0x3a3d44 });
      g.rect(cx - t * 0.42, cy - t * 0.12, t * 0.84, t * 0.3);
      g.fill({ color: 0xd8c8a8 });
      g.stroke({ width: 1, color: ink, alpha: 0.6 });
      g.rect(cx - t * 0.2, cy - t * 0.38, t * 0.32, t * 0.22);
      g.fill({ color: SCREEN_OFF });
      g.rect(cx - t * 0.06, cy - t * 0.16, t * 0.04, t * 0.06);
      g.fill({ color: 0x2a2c31 });
      g.rect(cx - t * 0.25, cy + t * 0.02, t * 0.34, t * 0.07);
      g.fill({ color: 0xe6e8ec });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        // A snake plant: tall pointed leaves out of a white pot.
        g.rect(cx - t * 0.14, cy + t * 0.12, t * 0.28, t * 0.26);
        g.fill({ color: 0xf4f5f7 });
        g.stroke({ width: 1, color: ink, alpha: 0.5 });
        for (const [dx, h] of [
          [-0.09, 0.5],
          [0, 0.62],
          [0.09, 0.46],
        ] as const) {
          g.poly([
            cx + (dx - 0.04) * t,
            cy + t * 0.12,
            cx + (dx + 0.04) * t,
            cy + t * 0.12,
            cx + dx * t,
            cy + t * (0.12 - h),
          ]);
        }
        g.fill({ color: 0x3a7a3c });
      } else {
        // A cactus on a little grey filing cabinet.
        g.rect(cx - t * 0.2, cy - t * 0.02, t * 0.4, t * 0.4);
        g.fill({ color: 0x8a8e96 });
        g.stroke({ width: 1, color: ink, alpha: 0.6 });
        g.moveTo(cx - t * 0.2, cy + t * 0.18).lineTo(cx + t * 0.2, cy + t * 0.18);
        g.stroke({ width: 1, color: ink, alpha: 0.5 });
        g.rect(cx - t * 0.05, cy + t * 0.07, t * 0.1, t * 0.03);
        g.rect(cx - t * 0.05, cy + t * 0.27, t * 0.1, t * 0.03);
        g.fill({ color: ALUMINIUM });
        g.rect(cx - t * 0.09, cy - t * 0.12, t * 0.18, t * 0.1);
        g.fill({ color: 0xa06a40 });
        g.roundRect(cx - t * 0.05, cy - t * 0.4, t * 0.1, t * 0.3, t * 0.05);
        g.roundRect(cx + t * 0.04, cy - t * 0.3, t * 0.08, t * 0.05, t * 0.02);
        g.roundRect(cx + t * 0.08, cy - t * 0.38, t * 0.05, t * 0.12, t * 0.025);
        g.fill({ color: 0x4f9a48 });
      }
    } else if (item.variant % 3 === 0) {
      // A printer, a sheet jammed half out of it, its red light on.
      g.rect(cx - t * 0.3, cy - t * 0.12, t * 0.6, t * 0.4);
      g.fill({ color: 0xd8d0bc });
      g.stroke({ width: 1, color: ink, alpha: 0.6 });
      g.rect(cx - t * 0.22, cy - t * 0.16, t * 0.44, t * 0.06);
      g.fill({ color: 0x8a8e96 });
      g.poly([
        cx - t * 0.15,
        cy - t * 0.12,
        cx + t * 0.1,
        cy - t * 0.12,
        cx + t * 0.2,
        cy - t * 0.42,
        cx - t * 0.02,
        cy - t * 0.36,
        cx - t * 0.1,
        cy - t * 0.44,
      ]);
      g.fill({ color: PAPER });
      g.stroke({ width: 1, color: STEEL_DARK });
      g.circle(cx + t * 0.2, cy + t * 0.08, t * 0.05);
      g.fill({ color: RED_INK });
    } else if (item.variant % 3 === 1) {
      // A swivel chair left out, seen from the side: castors, the post, seat and back.
      g.moveTo(cx - t * 0.22, cy + t * 0.38).lineTo(cx + t * 0.22, cy + t * 0.38);
      g.moveTo(cx, cy + t * 0.38).lineTo(cx, cy + t * 0.1);
      g.stroke({ width: Math.max(1, t * 0.06), color: 0x2a2c31, cap: 'round' });
      g.roundRect(cx - t * 0.2, cy + t * 0.02, t * 0.4, t * 0.1, t * 0.04);
      g.roundRect(cx + t * 0.12, cy - t * 0.38, t * 0.1, t * 0.42, t * 0.04);
      g.fill({ color: 0x3a3d44 });
    } else {
      // Archive boxes, stacked, a label on each.
      for (const [dx, dy] of [
        [-0.18, 0.1],
        [0.16, 0.1],
        [0, -0.18],
      ] as const) {
        g.rect(cx + (dx - 0.16) * t, cy + (dy - 0.13) * t, t * 0.32, t * 0.26);
      }
      g.fill({ color: CARDBOARD });
      g.stroke({ width: 1, color: 0x6a4a2a, alpha: 0.8 });
      for (const [dx, dy] of [
        [-0.18, 0.1],
        [0.16, 0.1],
        [0, -0.18],
      ] as const) {
        g.rect(cx + (dx - 0.08) * t, cy + (dy - 0.05) * t, t * 0.16, t * 0.08);
      }
      g.fill({ color: PAPER });
    }
  }
}
