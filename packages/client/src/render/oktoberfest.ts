import type { ArtConfig, OktoberfestStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { inFinalRound } from '../scores.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { hash } from './chocolate.js';
import { roseSpot } from './parchment.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import { OktoberfestSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { IslandParts } from './islandParts.js';
import { SceneryLayer } from './sceneryLayer.js';
import { StampBook, Stamps } from './stamps.js';
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
import { outline, trace, wallGeometry } from './walls.js';
import {
  FOAM,
  ICING,
  LAGER,
  drawGingerHeart,
  drawMass,
  drawNote,
  drawPretzel,
  drawReveller,
} from './wiesn.js';
import { cannonBase } from './cannonBase.js';

/** Something with a place and an age: a ring on the beer, a burst of foam, a coin, a clink. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A bubble rising through the beer, in tiles, until it pops at the top. */
interface Bubble {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

/** A bottle, a crown cap, a drop of beer: thrown up and falling, in tiles. */
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
  kind: 'bottle' | 'cap' | 'drop';
  angle: number;
  spin: number;
}

/** Where a shot came down on open ground: a puddle of spilt beer, drying. */
interface Puddle {
  x: number;
  y: number;
  round: number;
}

/** A note of the band's, rising from a tent and swaying, in tiles. */
interface Note {
  x: number;
  y: number;
  age: number;
}

/** A flake or a streak of rain over the whole screen, in pixels. */
interface Drift {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

/** A beer tent on a castle's tiles: where its parts stand on screen. */
interface Tent {
  cx: number;
  foot: number;
  W: number;
  eaves: number;
  apex: number;
  half: number;
}

const RECOIL_MS = 200;
const RING_MS = 900;
const FOAM_MS = 650;
const CLINK_MS = 420;
const FADE_MS = 450;
const NOTE_MS = 2400;

/** Wood for drays, benches and kegs; brass for the taps; gold for crown caps. */
const WOOD = 0x8a5a30;
const WOOD_DARK = 0x5a3a1c;
const KEG = 0xa8692e;
const BRASS = 0xd9b24a;
const CAP = 0xd9b24a;
const BOTTLES = [0x3c7a3a, 0x6b3a14] as const;
/** The tent's canvas, between the stripes in the owner's colour. */
const CANVAS = 0xfbf5e6;

/** How Oktoberfest sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'pretzel', flag: 'rauten' };

/** A colour between two, `t` of the way from the first. */
function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  const m = (s: number): number => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/**
 * The Oktoberfest look, for either look: the fair on islands in a sea of beer, and a
 * friendly joke at the expense of the Wiesn. The sea is lager, golden in the shallows and
 * amber out deep, bubbles rising through it, a head of foam round every coast; a Ferris
 * wheel turns in the corner Parchment gives its compass rose. Walls are stacked beer crates
 * in the owner's colour, crown caps showing — a player who is out is left with grey empties.
 * Castles are beer tents striped in the owner's colour, and sealed is the giant Maß on the
 * roof filled to the brim, foam and all; a breach drinks it dry. Sealed ground is the
 * Bavarian lozenges in white and the owner's colour. Guns are kegs on a dray, and they fire
 * pretzels; a silenced keg tips over and drips. A hit on a wall throws bottles and foam; the
 * sweep returns a crate for its deposit, a coin flipping up where it stood. In overtime and
 * the final round the band plays, notes rising from every sealed tent. Scenery is chestnut
 * trees, beer-garden tables, gingerbread hearts, a dropped Maß and now and then a reveller
 * asleep in the grass.
 */
export class OktoberfestTheme implements Theme {
  readonly id = 'oktoberfest' as const;

  private art!: ArtConfig;
  private style!: OktoberfestStyleConfig;
  /** Life on the outer sea (`seaLife.ts`). */
  private readonly seaLife = new OktoberfestSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The bubbles, the puddles and the Ferris wheel: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  /** The puddles, drawn again only when one comes or dries a round further. */
  private readonly puddleGfx = new Graphics();
  private puddlesDrawn = '';
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawWiesnScenery(g, view, items, this.art),
    () => FOAM,
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  /** What lies under the kegs: the sea's life, the glow of a seal, the smoke of ruins. */
  private readonly effectGfx = new Graphics();
  /**
   * The Maß on every tent, drawn again only as one fills or empties (PLAN 11.22): the same
   * picture sixty times a second was a Maß's worth of vertices on every tent, every frame.
   */
  private readonly mugGfx = new Graphics();
  private mugsDrawn = '';
  /** The kegs, a stamp a colour drawn once and turned to the target (`stamps.ts`). */
  private readonly kegStamps = new Stamps();
  /** Everything over the kegs: shots' shadows and crumbs, splashes, the band, the finish. */
  private readonly lateGfx = new Graphics();
  /**
   * The pretzels in flight, stamps drawn once and spun: stroked anew each frame with round
   * joins they were three quarters of the effects' vertices, 70 000 at eight players.
   */
  private readonly pretzelStamps = new Stamps();
  private readonly book = new StampBook();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private round = 0;
  /** Beer a bubble may rise in: not against a coast, where the foam is. */
  private beerCells: Cell[] = [];
  private bubbles: Bubble[] = [];
  private wheel: TimerSpot | null = null;
  private puddles: Puddle[] = [];
  private rings: Aged[] = [];
  private foams: Aged[] = [];
  private coins: Aged[] = [];
  private fading: Aged[] = [];
  private clinks: Aged[] = [];
  private bits: Bit[] = [];
  private notes: Note[] = [];
  private sinceNote = new Map<number, number>();
  private drifts: Drift[] = [];
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The tents' Maß, filled as a flag is hoisted: by sealing, and drunk dry by a breach. */
  private readonly mugs = new FlagHoist();
  private weather: Weather = 'clear';
  private clock = 0;

  constructor(private readonly seed = 1) {}

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.oktoberfest;
    // Medieval's weather, drawn from the seed: it rains at the Wiesn, of course, and now and
    // then it snows; fog is left to the morning after.
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    layers.terrain.addChild(this.terrainGfx, this.puddleGfx, this.flowGfx);
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.effectGfx,
      this.mugGfx,
      this.kegStamps.container,
      this.lateGfx,
      this.pretzelStamps.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.kegStamps.destroy();
    this.pretzelStamps.destroy();
    this.book.destroy();
    this.mugGfx.destroy();
    this.lateGfx.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.puddleGfx,
      this.flowGfx,
      this.effectGfx,
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

  private get brown(): number {
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

    // The beer runs out past the board to the window's edge: golden in the shallows,
    // amber where it is deep, in overlapping rounds so it curves with the coast.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
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
      mix(hex(palette.waterShallow), hex(palette.waterMid), 0.5),
      hex(palette.waterMid),
      mix(hex(palette.waterMid), hex(palette.waterDeep), 0.5),
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
    // Light catching the beer here and there, as through a glass held up.
    this.beerCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = depth[y * w + x]!;
        if (d === 0) continue;
        if (d < 0 || d >= 2) this.beerCells.push({ x: x + x0, y: y + y0 });
        if (hash(x + x0, y + y0, 400) > 0.05) continue;
        g.ellipse(
          tileX(view, x + x0 + hash(x, y, 401)),
          tileY(view, y + y0 + hash(x, y, 402)),
          t * 0.3,
          t * 0.06,
        );
      }
    }
    g.fill({ color: 0xfff1b0, alpha: 0.25 });

    // The Theresienwiese: meadow trodden lighter in patches, tufts left standing, and the
    // odd scrap of confetti from the parade.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 1) < 0.22) g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.7);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 2) > 0.3) continue;
      const px = tileX(view, x) + t * (0.2 + 0.6 * hash(x, y, 3));
      const py = tileY(view, y) + t * (0.3 + 0.5 * hash(x, y, 4));
      g.moveTo(px - t * 0.1, py - t * 0.12).lineTo(px, py);
      g.lineTo(px + t * 0.1, py - t * 0.14);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.grassDark), cap: 'round' });
    for (const [k, colour] of ICING.entries()) {
      for (const { x, y } of ground) {
        if (hash(x, y, 410 + k) > 0.025) continue;
        const px = tileX(view, x) + t * (0.15 + 0.7 * hash(x, y, 420 + k));
        const py = tileY(view, y) + t * (0.15 + 0.7 * hash(x, y, 430 + k));
        g.rect(px, py, t * 0.08, t * 0.05);
      }
      g.fill({ color: colour, alpha: 0.85 });
    }
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

    // The head of foam round every coast, bubbled along its edge.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.8, color: FOAM, cap: 'square' });
    for (const s of coast) {
      const key = Math.round(s.x1 * 7 + s.y1 * 13);
      for (const f of [0.25, 0.75]) {
        const px = s.x1 + (s.x2 - s.x1) * f;
        const py = s.y1 + (s.y2 - s.y1) * f;
        const out = s.x1 === s.x2 ? (hash(key, 440) - 0.5) * t * 0.5 : 0;
        const down = s.y1 === s.y2 ? (hash(key, 441) - 0.5) * t * 0.5 : 0;
        g.circle(px + out, py + down, t * (0.18 + 0.14 * hash(key, f * 10, 442)));
      }
    }
    g.fill({ color: FOAM });
    trace(g, coast);
    g.stroke({ width: Math.max(1, t * 0.06), color: 0xe8d8b8, alpha: 0.8, cap: 'square' });

    // The Ferris wheel's place, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.wheel = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.wheel = this.wheel;
    this.seaLife.layout(state, view, this.art);
    this.bubbles = [];
  }

  // ------------------------------------------------------------------ the beer, moving

  /** Each frame, under everything: bubbles rising, puddles drying, the Ferris wheel turning. */
  private drawFlow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.flowGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const still = motionReduced();

    // Spilt beer where a shot came down on open ground, drying over the rounds after.
    // Still from one round to the next, so they have a `Graphics` of their own.
    const rounds = this.art.generators.fx.craterRounds;
    this.puddles = this.puddles.filter((p) => state.round - p.round < rounds);
    const key = `${state.round}|${this.puddles.length}|${t}|${view.originX}|${view.originY}`;
    if (key !== this.puddlesDrawn) {
      this.puddlesDrawn = key;
      const pg = this.puddleGfx;
      pg.clear();
      for (const p of this.puddles) {
        const fade = 1 - (state.round - p.round) / rounds;
        const cx = tileX(view, p.x + 0.5);
        const cy = tileY(view, p.y + 0.5);
        pg.ellipse(cx, cy, t * 0.42, t * 0.3);
        pg.circle(cx + t * 0.3, cy + t * 0.12, t * 0.14);
        pg.fill({ color: hex(palette.craterMid), alpha: 0.55 * fade });
        pg.circle(cx - t * 0.1, cy - t * 0.06, t * 0.08);
        pg.fill({ color: FOAM, alpha: 0.6 * fade });
      }
    }

    // Bubbles rising through the beer in streams, swelling a little, popping.
    const target = Math.min(260, Math.floor(this.beerCells.length / this.style.bubbleTiles));
    while (this.bubbles.length < target && this.beerCells.length > 0) {
      this.bubbles.push(this.newBubble(still ? 0.5 : Math.random()));
    }
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i]!;
      if (!still) b.age += deltaMs;
      if (b.age >= b.life) {
        this.bubbles[i] = this.newBubble(0);
        continue;
      }
      const k = b.age / b.life;
      const x = tileX(view, b.x + Math.sin(k * 9 + b.y) * 0.05);
      const y = tileY(view, b.y - k * 0.9);
      g.circle(x, y, t * b.size * (0.6 + 0.4 * k));
    }
    g.fill({ color: 0xfff8e0, alpha: 0.65 });

    if (this.wheel !== null) this.drawWheel(g, view, this.wheel, still);
  }

  private newBubble(age: number): Bubble {
    const at = this.beerCells[Math.floor(Math.random() * this.beerCells.length)]!;
    const life = 1400 + Math.random() * 1800;
    return {
      x: at.x + Math.random(),
      y: at.y + Math.random(),
      age: age * life,
      life,
      size: 0.07 + Math.random() * 0.07,
    };
  }

  /**
   * The Ferris wheel, standing in the beer on its two legs: a lit rim on its spokes, turning
   * slowly, its gondolas hanging level whatever the turn.
   */
  private drawWheel(g: Graphics, view: ViewTransform, spot: TimerSpot, still: boolean): void {
    const t = view.tile;
    const size = spot.size * t;
    const cx = tileX(view, spot.x);
    const hubY = tileY(view, spot.y) - size * 0.06;
    const R = size * 0.36;
    const foot = hubY + size * 0.44;
    const steel = 0x8c919b;
    const turn = still ? 0 : (this.clock / this.style.wheelTurnMs) * Math.PI * 2;
    g.ellipse(cx, foot, size * 0.34, size * 0.06);
    g.fill({ color: FOAM, alpha: 0.7 });
    for (const s of [-1, 1]) g.moveTo(cx, hubY).lineTo(cx + s * size * 0.26, foot);
    g.stroke({ width: Math.max(2, t * 0.14), color: 0x5c626c, cap: 'round' });
    const spokes = 12;
    for (let k = 0; k < spokes; k++) {
      const a = turn + (k / spokes) * Math.PI * 2;
      g.moveTo(cx, hubY).lineTo(cx + Math.cos(a) * R, hubY + Math.sin(a) * R);
    }
    g.stroke({ width: 1, color: steel });
    g.circle(cx, hubY, R);
    g.circle(cx, hubY, R * 0.82);
    g.stroke({ width: Math.max(1.5, t * 0.08), color: steel });
    // Lights round the rim, chasing.
    for (let k = 0; k < 24; k++) {
      const a = turn + (k / 24) * Math.PI * 2;
      const on = still || Math.floor(this.clock / 250 + k) % 3 !== 0;
      if (!on) continue;
      g.circle(cx + Math.cos(a) * R, hubY + Math.sin(a) * R, Math.max(1, t * 0.06));
    }
    g.fill({ color: 0xfff2b0 });
    // The gondolas, hanging from the rim.
    const gondolas = [0xfbf5e6, 0xbfe3f2, 0xf9d77e, 0xc9e8b8, 0xf3c3c3, 0xd9c9ef];
    for (let k = 0; k < 8; k++) {
      const a = turn + (k / 8) * Math.PI * 2;
      const gx = cx + Math.cos(a) * R;
      const gy = hubY + Math.sin(a) * R;
      g.moveTo(gx, gy).lineTo(gx, gy + t * 0.2);
      g.stroke({ width: 1, color: 0x5c626c });
      g.roundRect(gx - t * 0.22, gy + t * 0.18, t * 0.44, t * 0.3, t * 0.08);
      g.fill({ color: gondolas[k % gondolas.length]! });
      g.stroke({ width: 1, color: this.brown, alpha: 0.6 });
    }
    g.circle(cx, hubY, Math.max(2, t * 0.12));
    g.fill({ color: BRASS });
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground in the Bavarian lozenges: white, with the owner's colour in diamonds
   * standing on the board's lattice, so neighbouring tiles make one pattern; edged in the
   * owner's colour.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      g.fill({ color: 0xffffff, alpha: 0.85 });
      // Each tile's top and bottom quarters, cut on its diagonals: with the tiles above and
      // below they make the diamonds in the owner's colour, the white ones between.
      for (const { x, y } of cells) {
        const l = tileX(view, x);
        const top = tileY(view, y);
        const cx = l + t / 2;
        const cy = top + t / 2;
        g.poly([l, top, l + t, top, cx, cy]);
        g.poly([l, top + t, l + t, top + t, cx, cy]);
      }
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      trace(g, outline(cells, owned, view));
      g.stroke({ width: Math.max(1.5, t * 0.1), color: this.colour(player, 'base'), alpha: 0.95 });
    }
    dimEliminated(g, state, view, this.brown);
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
      this.drawCrates(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawTent(g, view, castle);

    // Guns: a brewer's dray of planks on four wheels, banded in the owner's colour; the keg
    // on it is drawn with the effects, turned to its target.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = Math.min(cannon.w, cannon.h) * t * 0.38;
      cannonBase(
        g,
        view,
        cannon,
        this.colour(cannon.owner, 'dark'),
        this.colour(cannon.owner, 'base'),
      );
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        g.circle(cx + sx * r * 0.85, cy + sy * r * 0.62, r * 0.2);
      }
      g.fill({ color: WOOD_DARK });
      g.roundRect(cx - r, cy - r * 0.62, r * 2, r * 1.24, r * 0.12);
      g.fill({ color: WOOD });
      g.stroke({ width: Math.max(1, t * 0.05), color: this.brown, alpha: 0.85 });
      for (const f of [-0.3, 0.3]) g.moveTo(cx - r, cy + r * f).lineTo(cx + r, cy + r * f);
      g.stroke({ width: 1, color: WOOD_DARK, alpha: 0.8 });
      g.rect(cx - r, cy + r * 0.38, r * 2, r * 0.24);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
    }
  }

  /**
   * Walls of beer crates, stacked: each block a crate in the owner's colour with four crown
   * caps showing, a seam round every crate so a shot visibly takes one, its side with a
   * handle slot, standing to the shared height. A player's who is out (`player` -1) is left
   * with grey crates of empties, their bottles open.
   */
  private drawCrates(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const dead = player < 0;
    const crate = dead ? hex(palette.rockMid) : this.colour(player, 'base');
    const crateDark = dead ? hex(palette.rockDark) : this.colour(player, 'dark');
    const crateLight = dead ? hex(palette.rockLight) : this.colour(player, 'light');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: crate });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: crateDark });
    // Each crate's rim, lit along its top edge.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.rect(b.left + t * 0.08, b.top + h * 0.08, t * 0.84, h * 0.84);
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: crateLight, alpha: 0.55 });
    // The bottles in it: crown caps, or the open necks of empties.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      for (const fx of [0.32, 0.68]) {
        for (const fy of [0.32, 0.68]) g.circle(b.left + t * fx, b.top + h * fy, t * 0.12);
      }
    }
    g.fill({ color: dead ? 0x2a2a2a : CAP });
    if (!dead) {
      for (const b of wall.blocks) {
        const h = b.lip - b.top;
        for (const fx of [0.32, 0.68]) {
          for (const fy of [0.32, 0.68]) g.circle(b.left + t * fx, b.top + h * fy, t * 0.12);
        }
      }
      g.stroke({ width: 1, color: 0x8a6a1a, alpha: 0.9 });
    }
    // The handle slot in each crate's side.
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      g.roundRect(
        b.left + t * 0.3,
        b.lip + wall.face * 0.3,
        t * 0.4,
        wall.face * 0.38,
        wall.face * 0.15,
      );
    }
    g.fill({ color: this.brown, alpha: 0.7 });
    // The seam between crates, and the outline.
    for (const b of wall.blocks)
      g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
    g.stroke({ width: 1, color: crateDark, alpha: 0.9 });
    // Snow lying on the crates in a snowy match.
    if (this.weather === 'snow') {
      for (const b of wall.blocks) {
        if (joins(b.x, b.y - 1)) continue;
        g.rect(b.left, b.top, t, (b.lip - b.top) * 0.25);
      }
      g.fill({ color: 0xffffff, alpha: 0.85 });
    }
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: this.ink(view), color: this.brown, alpha: 0.85 });
  }

  private tent(view: ViewTransform, castle: Castle): Tent {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot = tileY(view, castle.y + castle.h) - t * 0.05;
    const eaves = foot - W * 0.36;
    return { cx, foot, W, eaves, apex: eaves - W * 0.3, half: W * 0.48 };
  }

  /**
   * A castle as a beer tent: a canvas front with its doors open on the dark inside, a sign
   * over them, and a gabled roof striped in the owner's colour and white, a scalloped valance
   * under its eaves. The Maß on the ridge is drawn with the effects, since it fills.
   */
  private drawTent(g: Graphics, view: ViewTransform, castle: Castle): void {
    const t = view.tile;
    const owner = castle.islandId - 1;
    const k = this.tent(view, castle);
    const { cx, foot, W, eaves, apex, half } = k;
    const ink = this.ink(view);
    const stripe = this.colour(owner, 'base');
    g.ellipse(cx + t * 0.1, foot, half * 1.1, t * 0.2);
    g.fill({ color: this.brown, alpha: 0.3 });
    // The front.
    g.rect(cx - half * 0.9, eaves, half * 1.8, foot - eaves);
    g.fill({ color: CANVAS });
    g.stroke({ width: ink, color: this.brown, alpha: 0.85 });
    g.roundRect(cx - W * 0.13, foot - W * 0.24, W * 0.26, W * 0.24, W * 0.1);
    g.fill({ color: 0x3a2414 });
    g.rect(cx - W * 0.17, eaves + W * 0.03, W * 0.34, W * 0.07);
    g.fill({ color: WOOD });
    g.stroke({ width: 1, color: this.brown, alpha: 0.8 });
    // The roof, in stripes from the ridge down to the eaves.
    const strips = 8;
    const yTop = (x: number): number => apex + ((eaves - apex) * Math.abs(x - cx)) / half;
    for (let n = 0; n < strips; n++) {
      const xa = cx - half + (half * 2 * n) / strips;
      const xb = cx - half + (half * 2 * (n + 1)) / strips;
      const crossesRidge = xa < cx && xb > cx;
      const points = [xa, eaves, xb, eaves, xb, yTop(xb)];
      if (crossesRidge) points.push(cx, apex);
      points.push(xa, yTop(xa));
      g.poly(points);
      g.fill({ color: n % 2 === 0 ? stripe : CANVAS });
    }
    g.poly([cx - half, eaves, cx + half, eaves, cx, apex]);
    g.stroke({ width: ink, color: this.brown, alpha: 0.85, join: 'round' });
    // The valance: scallops in the owner's colour hanging under the eaves.
    const scallops = 6;
    for (let n = 0; n < scallops; n++) {
      const x = cx - half * 0.9 + (half * 1.8 * (n + 0.5)) / scallops;
      g.moveTo(x - (half * 0.9) / scallops, eaves);
      g.arc(x, eaves, (half * 0.9) / scallops, Math.PI, 0, true);
    }
    g.fill({ color: stripe });
    // A pennant at the ridge.
    g.moveTo(cx, apex).lineTo(cx, apex - W * 0.12);
    g.stroke({ width: Math.max(1, t * 0.05), color: this.brown });
    if (this.weather === 'snow') {
      g.poly([
        cx - half * 0.35,
        yTop(cx - half * 0.35),
        cx,
        apex,
        cx + half * 0.35,
        yTop(cx + half * 0.35),
      ]);
      g.fill({ color: 0xffffff, alpha: 0.85 });
    }
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const atSea = this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (atSea) {
      // A splash of beer and a ring of foam spreading on it.
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
          colour: k % 2 === 0 ? FOAM : LAGER,
          kind: 'drop',
          angle: 0,
          spin: 0,
        });
      }
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.puddles.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      // The crate bursts: foam, bottles flying, caps scattering.
      this.foams.push({ x: block.x + 0.5, y: block.y + 0.4, age: 0, owner: block.owner });
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const v = 1.4 + Math.random() * 1.8;
        const bottle = k < 4;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * 1.4,
          floor: block.y + 0.85 + Math.random() * 0.3,
          size: bottle ? 0.13 : 0.06,
          colour: bottle ? BOTTLES[k % 2]! : CAP,
          kind: bottle ? 'bottle' : 'cap',
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 14,
        });
      }
    }
  }

  /** The sweep: a crate left alone goes back for its deposit, a coin flipping up. */
  noteCrumble(block: Debris): void {
    this.fading.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
    this.coins.push({ x: block.x + 0.5, y: block.y + 0.5, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    // Crates set down clink: a glint off a bottle or two.
    for (const [k, c] of cells.entries()) {
      if (k % 2 !== 0) continue;
      this.clinks.push({ x: c.x + 0.3 + Math.random() * 0.4, y: c.y + 0.3, age: 0, owner: -1 });
    }
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
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawFading(view, frame.deltaMs);
    this.ruins.draw(g, view, state, 0xd8d0c0, null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawMugs(state, view, frame);
    // Over the kegs rather than under, which nobody can see: a crown is on a tent, a keg
    // on a dray.
    drawMainCastles(this.lateGfx, view, state, this.art, frame.castleSealed);
    this.drawKegs(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawRings(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawFoams(view, frame.deltaMs);
    this.drawCoins(view, frame.deltaMs);
    this.drawClinks(view, frame.deltaMs);
    this.drawBand(state, view, frame);
    this.drawDrifts(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** The sweep's crates fading where they stood, as they go back for the deposit. */
  private drawFading(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const f of this.fading) {
      f.age += deltaMs;
      const k = Math.min(1, f.age / FADE_MS);
      g.rect(
        tileX(view, f.x) + t * 0.05,
        tileY(view, f.y) + t * 0.05 - k * t * 0.3,
        t * 0.9,
        t * 0.9,
      );
      g.fill({
        color: f.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(f.owner, 'base'),
        alpha: 1 - k,
      });
    }
    this.fading = this.fading.filter((f) => f.age < FADE_MS);
  }

  /**
   * The giant Maß on every tent's ridge, filled as a flag is hoisted: while the castle is
   * sealed it is full to the brim with a head of foam, and a breach drinks it dry — so
   * "sealed" is a full Maß, and nobody needs telling what a breach costs.
   */
  private drawMugs(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.mugGfx;
    this.mugs.update(frame.castleSealed, this.clock, this.art);
    const fills = state.castles.map((castle) => ({
      castle,
      fill: this.mugs.raised(castle.id, this.clock, this.art) ?? 0,
    }));
    const key = `${view.tile}|${view.originX}|${view.originY}|${fills.map((m) => `${m.castle.id}:${m.castle.x},${m.castle.y}:${m.fill}`).join(' ')}`;
    if (key === this.mugsDrawn) return;
    this.mugsDrawn = key;
    g.clear();
    for (const { castle, fill } of fills) {
      const k = this.tent(view, castle);
      drawMass(g, k.cx, k.apex + k.W * 0.06, k.W * 0.52, fill, this.brown);
    }
  }

  /**
   * The kegs: lying on their drays, turned to the target, the brass tap their muzzle,
   * kicking back as they fire a pretzel with a puff of foam. A silenced keg rolls onto its
   * side, its hoops dull, dripping into a puddle.
   */
  private drawKegs(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const stamps = this.kegStamps;
    stamps.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const r = Math.min(cannon.w, cannon.h) * t * 0.38;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2) - r * 0.15;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const angle = cannon.active ? aim.angle : Math.PI * 0.5 + 0.35;
      const dx = Math.sin(angle);
      const dy = -Math.cos(angle) * 0.8;
      const front = r * (0.75 - 0.25 * kick);
      // Across the keg.
      const nx = -dy;
      const ny = dx;
      const along = (u: number, v: number): [number, number] => [
        cx + dx * u + nx * v,
        cy + dy * u + ny * v,
      ];
      // The keg at rest, turned and foreshortened: `along` is a turn and a uniform scale,
      // since its two axes are square and of one length, and the kick only slides it back.
      const keg = this.book.get(`keg|${cannon.owner}|${cannon.active}|${r}`, t, (k) =>
        this.drawKeg(k, view, r, cannon.owner, cannon.active),
      );
      const slide = -0.25 * kick * r;
      stamps.place(keg, cx + dx * slide, cy + dy * slide, {
        rotation: Math.atan2(dy, dx),
        scale: Math.hypot(dx, dy),
      });
      const [tx, ty] = along(front + r * 0.12, 0);
      if (!cannon.active) {
        // Dripping into a puddle under the tap: the last of it.
        g.ellipse(tx + t * 0.1, ty + t * 0.25, t * 0.25, t * 0.1);
        g.fill({ color: LAGER, alpha: 0.7 });
        if (!motionReduced()) {
          const p = (this.clock / 900 + cannon.id * 0.3) % 1;
          g.circle(tx, ty + t * 0.22 * p, Math.max(1, t * 0.05));
          g.fill({ color: LAGER });
        }
        continue;
      }
      if (aim.firedAgo < 600) {
        const k = aim.firedAgo / 600;
        for (let n = 0; n < 4; n++) {
          const d = r * (0.3 + 0.9 * k + n * 0.12);
          g.circle(
            tx + dx * d + (n - 1.5) * t * 0.06,
            ty + dy * d - k * t * 0.15,
            t * 0.12 * (1 - k * 0.4),
          );
        }
        g.fill({ color: FOAM, alpha: 0.85 * (1 - k) });
      }
    }
    stamps.end();
    this.aims.prune(state);
  }

  /** A keg at rest lying along x, its middle at the origin: the stamp `drawKegs` turns. */
  private drawKeg(
    g: Graphics,
    view: ViewTransform,
    r: number,
    owner: number,
    active: boolean,
  ): void {
    const t = view.tile;
    const back = r * 0.55;
    const front = r * 0.75;
    const half = r * 0.48;
    const mid = (front - back) / 2;
    g.poly([
      -back,
      -half * 0.82,
      mid,
      -half,
      front,
      -half * 0.82,
      front,
      half * 0.82,
      mid,
      half,
      -back,
      half * 0.82,
    ]);
    g.fill({ color: active ? KEG : mix(KEG, 0x808080, 0.4) });
    g.stroke({ width: Math.max(1, t * 0.05), color: this.brown, alpha: 0.85, join: 'round' });
    for (const f of [0.18, 0.82]) {
      const u = -back + (front + back) * f;
      g.moveTo(u, -half * 0.92).lineTo(u, half * 0.92);
    }
    g.stroke({
      width: Math.max(1.5, t * 0.09),
      color: this.colour(owner, active ? 'base' : 'dark'),
    });
    // The brass tap at its front.
    g.circle(front + r * 0.12, 0, Math.max(1.5, r * 0.16));
    g.fill({ color: BRASS });
    g.stroke({ width: 1, color: this.brown, alpha: 0.7 });
  }

  /** Shots: pretzels, spinning as they fly, a ring of the owner's colour round each. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const stamps = this.pretzelStamps;
    stamps.begin();
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
        t * 0.24,
        t * 0.1,
      );
      g.fill({ color: 0x000000, alpha: 0.2 - 0.1 * high });
      // Crumbs of the owner's colour behind it, so whose pretzel it is reads in flight.
      const step = span <= 0 ? 0 : 1.6 / span;
      for (let k = 3; k >= 1; k--) {
        const b = at(p - step * k);
        g.circle(b.x, b.y, t * (0.11 - 0.02 * k));
      }
      g.fill({ color: this.colour(shot.owner, 'light'), alpha: 0.7 });
      const size = t * (0.3 + 0.1 * high);
      g.circle(here.x, here.y, size * 1.05);
      g.fill({ color: this.colour(shot.owner, 'base'), alpha: 0.45 });
      // Drawn for a few heights between low and high, and scaled the rest of the way.
      const tier = Math.round(high * 4) / 4;
      const drawn = t * (0.3 + 0.1 * tier);
      const pretzel = this.book.get(`pretzel|${tier}`, t, (k) => drawPretzel(k, 0, 0, drawn, 0));
      stamps.place(pretzel, here.x, here.y, {
        rotation: motionReduced() ? 0 : this.clock / 110 + shot.id,
        scale: size / drawn,
      });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    stamps.end();
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
      g.stroke({ width: Math.max(2, t * 0.12), color: FOAM, alpha: 0.75 * (1 - k) });
    }
    this.rings = this.rings.filter((s) => s.age < RING_MS);
  }

  /** Bottles tumbling and bouncing, caps scattering, beer splashing back down. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 7 * dt;
      b.angle += b.spin * dt;
      if (b.y > b.floor && b.vy > 0) {
        if (b.kind === 'drop') {
          b.age = b.life;
          continue;
        }
        b.y = b.floor;
        b.vy *= -0.3;
        b.vx *= 0.5;
        b.spin *= 0.5;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const s = b.size * t;
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      if (b.kind === 'bottle') {
        // A bottle: a body and a neck, turning end over end.
        const c = Math.cos(b.angle);
        const sn = Math.sin(b.angle);
        g.moveTo(x - c * s, y - sn * s).lineTo(x + c * s * 0.4, y + sn * s * 0.4);
        g.stroke({ width: Math.max(2, s * 0.8), color: b.colour, alpha, cap: 'round' });
        g.moveTo(x + c * s * 0.4, y + sn * s * 0.4).lineTo(x + c * s * 1.1, y + sn * s * 1.1);
        g.stroke({ width: Math.max(1, s * 0.35), color: b.colour, alpha, cap: 'round' });
      } else {
        g.circle(x, y, s);
        g.fill({ color: b.colour, alpha });
      }
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** The foam a burst crate throws up: a head of white rounds, swelling and falling away. */
  private drawFoams(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const f of this.foams) {
      f.age += deltaMs;
      const k = f.age / FOAM_MS;
      if (k >= 1) continue;
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + f.x;
        const d = t * (0.15 + 0.35 * k);
        g.circle(
          tileX(view, f.x) + Math.cos(a) * d,
          tileY(view, f.y) + Math.sin(a) * d * 0.7 - k * t * 0.3,
          t * (0.2 + 0.1 * k) * (1 - k * 0.5),
        );
      }
      g.fill({ color: FOAM, alpha: 0.9 * (1 - k) });
    }
    this.foams = this.foams.filter((f) => f.age < FOAM_MS);
  }

  /** The deposit on a swept crate: a gold coin flipping as it rises, fading. */
  private drawCoins(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const span = this.style.coinMs;
    for (const c of this.coins) {
      c.age += deltaMs;
      const k = c.age / span;
      if (k >= 1) continue;
      const flip = Math.abs(Math.cos(k * Math.PI * 4));
      const x = tileX(view, c.x);
      const y = tileY(view, c.y) - Math.sin(k * Math.PI * 0.5) * t * 1.2;
      const alpha = Math.min(1, (1 - k) / 0.4);
      g.ellipse(x, y, t * 0.22 * Math.max(0.15, flip), t * 0.22);
      g.fill({ color: 0xf2c94c, alpha });
      g.stroke({ width: 1, color: 0x9a7a1a, alpha });
    }
    this.coins = this.coins.filter((c) => c.age < span);
  }

  /** A glint off a bottle where a crate was set down: a four-pointed star, flashing. */
  private drawClinks(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const c of this.clinks) {
      c.age += deltaMs;
      const k = c.age / CLINK_MS;
      if (k >= 1) continue;
      const r = t * 0.3 * Math.sin(k * Math.PI);
      const x = tileX(view, c.x);
      const y = tileY(view, c.y);
      g.poly([
        x,
        y - r,
        x + r * 0.25,
        y - r * 0.25,
        x + r,
        y,
        x + r * 0.25,
        y + r * 0.25,
        x,
        y + r,
        x - r * 0.25,
        y + r * 0.25,
        x - r,
        y,
        x - r * 0.25,
        y - r * 0.25,
      ]);
      g.fill({ color: 0xffffff, alpha: 0.95 });
    }
    this.clinks = this.clinks.filter((c) => c.age < CLINK_MS);
  }

  /**
   * In overtime and the final round the band strikes up: notes rise from every sealed tent,
   * swaying as they go — "Ein Prosit", one last time.
   */
  private drawBand(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.lateGfx;
    const t = view.tile;
    const playing = (state.phase === 'build' && state.overtime) || inFinalRound(state);
    if (playing && !motionReduced()) {
      for (const castle of state.castles) {
        if (frame.castleSealed[castle.id] !== true) continue;
        const since = (this.sinceNote.get(castle.id) ?? castle.id * 137) + frame.deltaMs;
        if (since < this.style.noteEveryMs) {
          this.sinceNote.set(castle.id, since);
          continue;
        }
        this.sinceNote.set(castle.id, 0);
        this.notes.push({
          x: castle.x + castle.w / 2 + (Math.random() - 0.5) * 0.8,
          y: castle.y + castle.h * 0.4,
          age: 0,
        });
      }
    }
    for (const n of this.notes) {
      n.age += frame.deltaMs;
      const k = n.age / NOTE_MS;
      if (k >= 1) continue;
      const alpha = Math.min(1, k / 0.1) * Math.min(1, (1 - k) / 0.4);
      drawNote(
        g,
        tileX(view, n.x) + Math.sin(k * Math.PI * 3 + n.x) * t * 0.35,
        tileY(view, n.y) - k * t * 2.2,
        t * 0.65,
        this.brown,
        alpha,
      );
    }
    this.notes = this.notes.filter((n) => n.age < NOTE_MS);
  }

  /** Rain in a rainy match, as there usually is at the Wiesn; snow in a snowy one. */
  private drawDrifts(view: ViewTransform, deltaMs: number): void {
    const rain = this.weather === 'rain';
    const snow = this.weather === 'snow';
    if ((!rain && !snow) || motionReduced()) return;
    const g = this.lateGfx;
    const t = view.tile;
    const count = rain ? this.style.rainCount : this.style.snowCount;
    while (this.drifts.length < count) {
      this.drifts.push({
        x: Math.random() * view.width,
        y: view.top + Math.random() * (view.height - view.top),
        vx: rain ? -t * 1.5 : t * 0.3,
        vy: rain ? t * (14 + Math.random() * 6) : t * (0.8 + Math.random() * 0.6),
        size: rain ? 0 : t * (0.08 + Math.random() * 0.06),
      });
    }
    const dt = deltaMs / 1000;
    for (const [k, d] of this.drifts.entries()) {
      d.x += (d.vx + (snow ? Math.sin(this.clock / 800 + k) * t * 0.4 : 0)) * dt;
      d.y += d.vy * dt;
      if (d.y > view.height || d.x < -t * 3 || d.x > view.width + t * 3) {
        d.y = view.top;
        d.x = Math.random() * (view.width + t * 4) - t * 2;
      }
      if (rain) g.moveTo(d.x, d.y).lineTo(d.x + d.vx * 0.07, d.y + d.vy * 0.07);
      else g.circle(d.x, d.y, d.size);
    }
    if (rain) g.stroke({ width: Math.max(1, t * 0.06), color: 0xe6ecf2, alpha: 0.5 });
    else g.fill({ color: 0xffffff, alpha: 0.9 });
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
      // The piece in hand as empty crates waiting to be filled; where it does not fit, the
      // crates are crossed out — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark),
        alpha: ghost.valid ? 0.4 : 0.3,
      });
      for (const { x, y } of cells) {
        for (const fx of [0.32, 0.68]) {
          for (const fy of [0.32, 0.68])
            g.circle(tileX(view, x + fx), tileY(view, y + fy), t * 0.11);
        }
      }
      g.stroke({ width: 1, color: ghost.valid ? FOAM : hex(palette.rockLight), alpha: 0.8 });
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.stroke({ width: 1, color: this.brown, alpha: 0.5 });
      trace(g, outline(cells, inPiece, view));
      g.stroke({
        width: Math.max(1.5, t * 0.1),
        color: ghost.valid ? FOAM : hex(palette.uiInvalid),
        alpha: 0.95,
      });
      if (!ghost.valid) {
        for (const { x, y } of cells) {
          const px = tileX(view, x);
          const py = tileY(view, y);
          g.moveTo(px + t * 0.2, py + t * 0.2).lineTo(px + t * 0.8, py + t * 0.8);
          g.moveTo(px + t * 0.8, py + t * 0.2).lineTo(px + t * 0.2, py + t * 0.8);
        }
        g.stroke({ width: Math.max(1.5, t * 0.08), color: hex(palette.uiInvalid), cap: 'round' });
      }
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // An empty dray's outline, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.38;
      g.roundRect(cx - r, cy - r * 0.62, r * 2, r * 1.24, r * 0.12);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(cx - r, cy + r * 0.62).lineTo(cx + r, cy - r * 0.62);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Oktoberfest's scenery, none like a crate, a keg or a pretzel — pretzels fly, so none lie
 * about: a tree a chestnut of the beer gardens, its flowers in candles; a pine a beer-garden
 * table with its benches, so a copse of them is a beer garden; a bush a gingerbread heart
 * dropped on its ribbon; a boulder a Maß knocked over — one in three a reveller asleep in the
 * grass instead.
 */
function drawWiesnScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const ink = hex(art.palette.shadow);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.ellipse(cx + t * 0.1, cy + t * 0.38, t * 0.34, t * 0.1);
      g.fill({ color: ink, alpha: 0.25 });
      g.rect(cx - t * 0.05, cy, t * 0.1, t * 0.38);
      g.fill({ color: 0x5a3a22 });
      for (const [dx, dy, r] of [
        [-0.17, -0.08, 0.24],
        [0.17, -0.1, 0.24],
        [0, -0.28, 0.26],
        [0, -0.02, 0.22],
      ] as const) {
        g.circle(cx + t * dx, cy + t * dy, t * r);
      }
      g.fill({ color: 0x2f6a2c });
      for (const [dx, dy] of [
        [-0.2, -0.18],
        [0.12, -0.3],
        [0.22, -0.04],
        [-0.04, -0.06],
      ] as const) {
        g.ellipse(cx + t * dx, cy + t * dy, t * 0.035, t * 0.07);
      }
      g.fill({ color: 0xfff6f0 });
    } else if (item.kind === 'pine') {
      // A beer-garden table seen from above, a bench either side, a Maß or two on it.
      g.rect(cx - t * 0.38, cy - t * 0.32, t * 0.76, t * 0.1);
      g.rect(cx - t * 0.38, cy + t * 0.22, t * 0.76, t * 0.1);
      g.fill({ color: WOOD_DARK });
      g.rect(cx - t * 0.42, cy - t * 0.16, t * 0.84, t * 0.32);
      g.fill({ color: WOOD });
      g.stroke({ width: 1, color: ink, alpha: 0.6 });
      for (const dx of item.variant % 2 === 0 ? [-0.2, 0.15] : [0.05]) {
        g.circle(cx + t * dx, cy, t * 0.08);
        g.fill({ color: FOAM });
        g.stroke({ width: 1, color: 0xc9b48a });
      }
    } else if (item.kind === 'bush') {
      drawGingerHeart(g, cx, cy + t * 0.05, t * 0.48, ICING[1 + (item.variant % 3)]!, 1, 0xd8303a);
    } else if (item.variant % 3 === 0) {
      drawReveller(g, cx, cy, t * 0.95, ink);
      // His snoring, rising.
      g.moveTo(cx - t * 0.35, cy - t * 0.25).lineTo(cx - t * 0.25, cy - t * 0.25);
      g.lineTo(cx - t * 0.35, cy - t * 0.15).lineTo(cx - t * 0.25, cy - t * 0.15);
      g.moveTo(cx - t * 0.2, cy - t * 0.45).lineTo(cx - t * 0.1, cy - t * 0.45);
      g.lineTo(cx - t * 0.2, cy - t * 0.35).lineTo(cx - t * 0.1, cy - t * 0.35);
      g.stroke({ width: Math.max(1, t * 0.04), color: 0xffffff, alpha: 0.9 });
    } else {
      // A Maß knocked over in the grass, the last of it run out in a puddle.
      g.ellipse(cx + t * 0.12, cy + t * 0.12, t * 0.3, t * 0.12);
      g.fill({ color: LAGER, alpha: 0.6 });
      g.roundRect(cx - t * 0.3, cy - t * 0.12, t * 0.42, t * 0.26, t * 0.04);
      g.fill({ color: 0xdff1f5, alpha: 0.85 });
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
      g.roundRect(cx - t * 0.22, cy + t * 0.12, t * 0.22, t * 0.14, t * 0.05);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0xdff1f5 });
    }
  }
}
