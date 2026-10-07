import type { ArtConfig, HalloweenStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { inFinalRound } from '../scores.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { hash } from './noise.js';
import { roseSpot } from './corner.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import { HalloweenSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { IslandParts } from './islandParts.js';
import { SceneryLayer } from './sceneryLayer.js';
import { drawBat, drawGhost } from './spooky.js';
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
  mixed,
} from './theme.js';
import { outline, trace, wallGeometry } from './walls.js';
import { cannonBase } from './cannonBase.js';

/** Something with a place and an age: a ghost set free, a ring on the bog, a sinking block. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A bubble rising in the bog, swelling until it pops. */
interface Bubble {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

/** A bank of ground fog drifting across the board, in tiles. */
interface FogBank {
  x: number;
  y: number;
  r: number;
  speed: number;
}

/** Rubble, a drop of slime, a falling leaf: thrown up and falling, in tiles. */
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
  /** Drops splash and are gone when they land; rubble bounces. */
  drop: boolean;
}

/** Where a shot came down on open ground: a scorch, its embers glowing, fading. */
interface Scorch {
  x: number;
  y: number;
  round: number;
}

/** A piece just set down, materialising out of the mist. */
interface Materialising {
  cells: readonly Cell[];
  age: number;
}

/** A leaf falling over the board on a snowy match, in screen pixels. */
interface Leaf {
  x: number;
  y: number;
  vy: number;
  angle: number;
  colour: number;
}

/** A haunted house on a castle's two tiles: where its parts stand on screen. */
interface House {
  cx: number;
  foot: number;
  /** The body's top, where the roof starts, and its half-width. */
  eaves: number;
  half: number;
  apex: number;
  /** The windows' centres and size, the porch pumpkin's centre and radius. */
  windowY: number;
  windowDx: number;
  window: number;
  pumpkinX: number;
  pumpkinY: number;
  pumpkin: number;
  chimneyX: number;
  chimneyTop: number;
}

const RECOIL_MS = 180;
const RING_MS = 900;
const SINK_MS = 900;
const MATERIALISE_MS = 520;
const SPLASH_MS = 600;

/** Autumn for the leaves that fall instead of snow. */
const LEAVES = [0xff9a1f, 0xc2410c, 0xe0b040, 0x8a3a1a] as const;

/** How Halloween sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'spirits', flag: 'tattered' };

/**
 * The Halloween look, for either look: a haunted land round a bog — cute-spooky, more ghosts
 * and pumpkins than bones. The sea is a bog of murky green, bubbling, lighter near the shore;
 * the land dusky purple dead grass strewn with autumn leaves, edged in mud and roots; ground
 * fog drifts over everything, and a full moon hangs in the corner Parchment gives its compass
 * rose, bats wheeling across it. Walls are crypt stone whose mortar glows with spirit-light in
 * the owner's colour, a cobweb here and there. Castles are crooked haunted houses, and sealed
 * is the jack-o'-lantern on the porch lit, the windows glowing and smoke from the chimney.
 * Guns are cauldrons of the owner's potion, aimed by the ladle, bubbling while live and cold
 * when silenced; shots are spectral fireballs. A hit on a wall sets a little ghost free;
 * the sweep sinks blocks into the ground like graves; a piece in hand is a spectral wall that
 * materialises as it goes down. Sealed ground is tinted and warded by candles round its edge.
 * In the witching hour — overtime and the final round — eyes open in the dark at the edges.
 */
export class HalloweenTheme implements Theme {
  readonly id = 'halloween' as const;

  private art!: ArtConfig;
  private style!: HalloweenStyleConfig;
  /** Life on the outer sea (`seaLife.ts`). */
  private readonly seaLife = new HalloweenSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The bog's bubbles, the bats round the moon and the scorches: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  /** The scorches, drawn again only when one comes or fades a round further. */
  private readonly scorchGfx = new Graphics();
  private scorchesDrawn = '';
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawHalloweenScenery(g, view, items, this.art),
    () => hex(this.art.palette.rockLight),
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
  private height = 0;
  private round = 0;
  /** Bog tiles a bubble may rise from: not against a coast. */
  private bogCells: Cell[] = [];
  private bubbles: Bubble[] = [];
  private fog: FogBank[] = [];
  /**
   * The bog's bubbles, stamps of a ring drawn once a half pixel of radius, and the fog banks,
   * a stamp a bank drawn once and only moved (PLAN 11.22): 240 rings and the banks' ellipses
   * drawn anew each frame were 15 000 vertices at eight players.
   */
  private readonly bubbleStamps = new Stamps();
  private readonly fogStamps = new Stamps();
  private readonly book = new StampBook();
  /** Where the fog drifts, in tiles: the board and its margins. */
  private fogSpan = { x0: 0, x1: 0, y0: 0, y1: 0 };
  private moon: TimerSpot | null = null;
  /** The candles warding sealed ground, kept from the territory drawn, for their flames. */
  private candles: { x: number; y: number }[] = [];
  private scorches: Scorch[] = [];
  private ghosts: Aged[] = [];
  private rings: Aged[] = [];
  private sinks: Aged[] = [];
  private bits: Bit[] = [];
  private materialising: Materialising[] = [];
  private leaves: Leaf[] = [];
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The jack-o'-lanterns are lit as a flag is hoisted: by sealing, put out by a breach. */
  private readonly lanterns = new FlagHoist();
  private weather: Weather = 'clear';
  private clock = 0;

  constructor(private readonly seed = 1) {}

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.halloween;
    // Medieval's weather, drawn from the seed: fog thickens the fog, snow falls as leaves.
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    layers.terrain.addChild(
      this.terrainGfx,
      this.scorchGfx,
      this.flowGfx,
      this.bubbleStamps.container,
    );
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.effectGfx,
      this.gunMemo.container,
      this.fogStamps.container,
      this.lateGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.bubbleStamps.destroy();
    this.fogStamps.destroy();
    this.book.destroy();
    this.gunMemo.destroy();
    this.lateGfx.destroy();
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.scorchGfx,
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

    // The bog runs out past the board to the window's edge, lighter near the land, its
    // shallows in overlapping rounds so they curve with the coast.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    this.fogSpan = { x0, x1: x0 + w, y0, y1: y0 + h };
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
      if (d >= 4) continue;
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
      mixed(hex(palette.waterShallow), hex(palette.waterMid), 0.55),
      hex(palette.waterMid),
      mixed(hex(palette.waterMid), hex(palette.waterDeep), 0.6),
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
    // Scum on the bog: pale green flecks here and there.
    this.bogCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = depth[y * w + x]!;
        if (d === 0) continue;
        if (d < 0 || d >= 2) this.bogCells.push({ x: x + x0, y: y + y0 });
        if (hash(x + x0, y + y0, 200) > 0.12) continue;
        g.ellipse(
          tileX(view, x + x0 + hash(x, y, 201)),
          tileY(view, y + y0 + hash(x, y, 202)),
          t * 0.18,
          t * 0.07,
        );
      }
    }
    g.fill({ color: hex(palette.waterFoam), alpha: 0.12 });

    // The land: dusky dead grass, lighter patches, dark tufts, autumn leaves strewn.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 1) < 0.22) g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.7);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.28 });
    for (const { x, y } of ground) {
      if (hash(x, y, 2) > 0.4) continue;
      const px = tileX(view, x) + t * (0.2 + 0.6 * hash(x, y, 3));
      const py = tileY(view, y) + t * (0.3 + 0.5 * hash(x, y, 4));
      g.moveTo(px - t * 0.14, py - t * 0.12).lineTo(px, py);
      g.lineTo(px + t * 0.12, py - t * 0.18);
      g.moveTo(px, py).lineTo(px + t * 0.03, py - t * 0.22);
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.grassDark), cap: 'round' });
    for (const [k, colour] of LEAVES.entries()) {
      for (const { x, y } of ground) {
        if (hash(x, y, 10 + k) > 0.06) continue;
        const px = tileX(view, x) + t * (0.15 + 0.7 * hash(x, y, 20 + k));
        const py = tileY(view, y) + t * (0.15 + 0.7 * hash(x, y, 30 + k));
        g.ellipse(px, py, t * 0.11, t * 0.06);
      }
      g.fill({ color: colour, alpha: 0.75 });
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

    // The shore: a band of mud, darker where the bog laps it, roots poking out of it.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.6, color: hex(palette.shadow), alpha: 0.3, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: t * 0.4, color: hex(palette.sand), cap: 'square' });
    for (const s of coast) {
      const key = Math.round(s.x1 * 7 + s.y1 * 13);
      if (hash(key, 211) > 0.35) continue;
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      const vertical = s.x1 === s.x2;
      const out = (hash(key, 212) - 0.5) * t * 0.5;
      g.moveTo(mx, my).quadraticCurveTo(
        mx + (vertical ? out : t * 0.15),
        my + (vertical ? t * 0.15 : out),
        mx + (vertical ? out * 1.4 : t * 0.3),
        my + (vertical ? t * 0.3 : out * 1.4),
      );
    }
    g.stroke({ width: Math.max(1, t * 0.07), color: hex(palette.craterMid), cap: 'round' });

    // The moon, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.moon = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.moon = this.moon;
    if (this.moon !== null) this.drawMoon(g, view, this.moon);
    this.seaLife.layout(state, view, this.art);
    this.bubbles = [];
    this.layoutFog();
  }

  /** A full moon, its glow spread over the bog round it, its seas darker on its face. */
  private drawMoon(g: Graphics, view: ViewTransform, moon: TimerSpot): void {
    const t = view.tile;
    const cx = tileX(view, moon.x);
    const cy = tileY(view, moon.y);
    const r = (moon.size * t) / 2 - t * 0.6;
    for (const [k, alpha] of [
      [1.9, 0.06],
      [1.5, 0.08],
      [1.2, 0.12],
    ] as const) {
      g.circle(cx, cy, r * k);
      g.fill({ color: 0xf3ecc8, alpha });
    }
    g.circle(cx, cy, r);
    g.fill({ color: 0xf6efcf });
    for (const [dx, dy, s] of [
      [-0.3, -0.2, 0.22],
      [0.25, 0.1, 0.16],
      [-0.05, 0.35, 0.12],
      [0.35, -0.35, 0.09],
    ] as const) {
      g.circle(cx + r * dx, cy + r * dy, r * s);
    }
    g.fill({ color: 0xc9c09a, alpha: 0.45 });
  }

  private layoutFog(): void {
    const { x0, x1, y0, y1 } = this.fogSpan;
    const count = this.style.fogBanks * (this.weather === 'fog' ? 2 : 1);
    this.fog = [];
    for (let k = 0; k < count; k++) {
      this.fog.push({
        x: x0 + (x1 - x0) * hash(k, this.seed, 220),
        y: y0 + (y1 - y0) * hash(k, this.seed, 221),
        r: 2.5 + 3 * hash(k, this.seed, 222),
        speed: this.style.fogTilesPerSecond * (0.6 + 0.8 * hash(k, this.seed, 223)),
      });
    }
  }

  // ------------------------------------------------------------------ the bog, moving

  /** Each frame, under everything: the bog's bubbles, bats round the moon, the scorches. */
  private drawFlow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.flowGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const still = motionReduced();

    // Scorches on open ground, embers glowing in them, fading over the rounds after.
    // The scorch is still from one round to the next, so it has a `Graphics` of its own;
    // only the embers glowing in it are drawn every frame.
    const rounds = this.art.generators.fx.craterRounds;
    this.scorches = this.scorches.filter((s) => state.round - s.round < rounds);
    const key = `${state.round}|${this.scorches.length}|${t}|${view.originX}|${view.originY}`;
    if (key !== this.scorchesDrawn) {
      this.scorchesDrawn = key;
      const sg = this.scorchGfx;
      sg.clear();
      for (const s of this.scorches) {
        const fade = 1 - (state.round - s.round) / rounds;
        sg.circle(tileX(view, s.x + 0.5), tileY(view, s.y + 0.5), t * 0.42);
        sg.fill({ color: hex(palette.craterDark), alpha: 0.75 * fade });
      }
    }
    for (const s of this.scorches) {
      const fade = 1 - (state.round - s.round) / rounds;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      for (let k = 0; k < 4; k++) {
        const glow = still ? 0.6 : 0.4 + 0.4 * Math.sin(this.clock / 300 + k * 2 + s.x);
        g.circle(
          cx + t * (hash(s.x + k, s.y, 230) - 0.5) * 0.5,
          cy + t * (hash(s.x, s.y + k, 231) - 0.5) * 0.5,
          t * 0.06,
        );
        g.fill({ color: hex(palette.emberMid), alpha: glow * fade });
      }
    }

    // Bubbles rising in the bog, swelling, then popping in a ring.
    const target = Math.min(240, Math.floor(this.bogCells.length / this.style.bubbleTiles));
    while (this.bubbles.length < target && this.bogCells.length > 0) {
      this.bubbles.push(this.newBubble(still ? 0.5 : Math.random()));
    }
    const rings = this.bubbleStamps;
    rings.begin();
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i]!;
      if (!still) b.age += deltaMs;
      if (b.age >= b.life) {
        this.bubbles[i] = this.newBubble(0);
        continue;
      }
      const k = b.age / b.life;
      const radius = t * b.size * (k < 0.85 ? 0.3 + 0.7 * (k / 0.85) : 1 + (k - 0.85) * 6);
      const alpha = k < 0.85 ? 0.35 : 0.4 * (1 - (k - 0.85) / 0.15);
      // A ring a half pixel of radius, so its line stays one pixel wide as it swells.
      const r = Math.max(0.5, Math.round(radius * 2) / 2);
      const ring = this.book.get(`ring|${r}`, t, (q) => {
        q.circle(0, 0, r);
        q.stroke({ width: 1, color: hex(palette.waterFoam) });
      });
      rings.place(ring, tileX(view, b.x), tileY(view, b.y), { alpha });
    }
    rings.end();

    // Bats wheeling across the moon.
    if (this.moon !== null && !still) {
      const cx = tileX(view, this.moon.x);
      const cy = tileY(view, this.moon.y);
      const r = (this.moon.size * t) / 2;
      for (let k = 0; k < 3; k++) {
        const a = this.clock / (1400 + k * 300) + k * 2.1;
        drawBat(
          g,
          cx + Math.cos(a) * r * (0.5 + 0.15 * k),
          cy + Math.sin(a) * r * 0.35 - t * 0.2 * k,
          t * 0.28,
          Math.sin(this.clock / 70 + k),
          hex(palette.shadow),
        );
      }
    }
  }

  private newBubble(age: number): Bubble {
    const at = this.bogCells[Math.floor(Math.random() * this.bogCells.length)]!;
    const life = 1600 + Math.random() * 2600;
    return {
      x: at.x + Math.random(),
      y: at.y + Math.random(),
      age: age * life,
      life,
      size: 0.08 + Math.random() * 0.12,
    };
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground tinted in the owner's colour and warded: small candles stand along its
   * edge, every other tile, their flames drawn with the effects so they flicker.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    this.candles = [];
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
      // The ward's line just inside the edge, faint in the owner's light.
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.08), color: this.colour(player, 'light'), alpha: 0.55 });
      for (const { x, y } of cells) {
        if ((x + y) % 2 !== 0) continue;
        const sides: [boolean, number, number][] = [
          [!owned(x, y - 1), 0.5, 0.22],
          [!owned(x, y + 1), 0.5, 0.78],
          [!owned(x - 1, y), 0.22, 0.5],
          [!owned(x + 1, y), 0.78, 0.5],
        ];
        const side = sides.find(([open]) => open);
        if (side === undefined) continue;
        this.candles.push({ x: x + side[1], y: y + side[2] });
      }
    }
    for (const c of this.candles) {
      g.roundRect(
        tileX(view, c.x) - t * 0.06,
        tileY(view, c.y) - t * 0.1,
        t * 0.12,
        t * 0.22,
        t * 0.03,
      );
    }
    g.fill({ color: hex(this.art.palette.rockLight) });
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
      this.drawCrypt(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawHouse(g, view, castle);

    // Guns: a witch's cauldron on three legs, brimming with potion in the owner's colour,
    // dull and still when silenced.
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
      g.ellipse(cx + t * 0.08, cy + r * 0.85, r * 0.95, r * 0.3);
      g.fill({ color: hex(palette.shadow), alpha: 0.35 });
      for (const lx of [-0.55, 0, 0.55]) {
        g.moveTo(cx + r * lx, cy + r * 0.5).lineTo(cx + r * lx * 1.2, cy + r * 0.9);
      }
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0x1a1420, cap: 'round' });
      g.ellipse(cx, cy + r * 0.15, r, r * 0.72);
      g.fill({ color: 0x241c2c });
      g.ellipse(cx - r * 0.45, cy + r * 0.05, r * 0.18, r * 0.3);
      g.fill({ color: 0xffffff, alpha: 0.12 });
      g.ellipse(cx, cy - r * 0.25, r * 0.98, r * 0.36);
      g.fill({ color: 0x3a3244 });
      g.ellipse(cx, cy - r * 0.25, r * 0.8, r * 0.26);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      if (cannon.active) {
        g.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.22, r * 0.07);
        g.fill({ color: this.colour(cannon.owner, 'light'), alpha: 0.8 });
      }
    }
  }

  /**
   * Walls of crypt stone: each block cut stone with a cast of the owner's colour, the
   * mortar between them glowing with spirit-light in it, standing up to the shared height,
   * a cobweb in a corner here and there. A player's who is out (`player` -1) is plain grey
   * stone, its light gone out and its webs thick.
   */
  private drawCrypt(
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
    const stone = dead
      ? hex(palette.rockMid)
      : mixed(hex(palette.rockMid), this.colour(player, 'base'), 0.4);
    const stoneDark = dead
      ? hex(palette.rockDark)
      : mixed(hex(palette.rockDark), this.colour(player, 'dark'), 0.4);
    const spirit = dead ? hex(palette.rockDark) : this.colour(player, 'light');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: stone, alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: stoneDark, alpha });
    // Each block's face cut a little proud, lit along its upper edge.
    for (const b of wall.blocks) {
      const inset = t * 0.14;
      g.rect(b.left + inset, b.top + inset, t - inset * 2, Math.max(1, (b.lip - b.top) * 0.18));
    }
    g.fill({ color: hex(palette.rockLight), alpha: 0.22 * alpha });
    // A crack across one block in a few.
    for (const b of wall.blocks) {
      if (hash(b.x, b.y, 240) > 0.18) continue;
      const h = b.lip - b.top;
      g.moveTo(b.left + t * 0.25, b.top + h * 0.3)
        .lineTo(b.left + t * 0.45, b.top + h * 0.55)
        .lineTo(b.left + t * 0.4, b.top + h * 0.8);
    }
    g.stroke({ width: Math.max(1, t * 0.04), color: hex(palette.shadow), alpha: 0.6 * alpha });
    // The mortar, glowing: a soft halo, then the bright seam, round every block and across
    // the faces.
    const seams = (): void => {
      for (const b of wall.blocks)
        g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
      trace(g, wall.strips);
    };
    if (!dead) {
      seams();
      g.stroke({ width: t * 0.18, color: spirit, alpha: 0.22 * alpha });
    }
    seams();
    g.stroke({ width: Math.max(1, t * 0.05), color: spirit, alpha: 0.9 * alpha });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.8 * alpha });
    // Cobwebs in the upper left corner of a block, a few spokes and threads across them.
    const share = dead ? 0.5 : this.style.cobwebShare;
    if (alpha === 1) {
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 241) > share) continue;
        const s = t * 0.45;
        const ox = b.left;
        const oy = b.top;
        for (const a of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
          g.moveTo(ox, oy).lineTo(ox + Math.cos(a) * s, oy + Math.sin(a) * s);
        }
        for (const f of [0.45, 0.8]) {
          g.moveTo(ox + s * f, oy);
          for (const a of [Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
            g.lineTo(ox + Math.cos(a) * s * f, oy + Math.sin(a) * s * f);
          }
        }
      }
      g.stroke({ width: 1, color: 0xf4f0ff, alpha: 0.55 });
    }
  }

  private house(view: ViewTransform, castle: Castle): House {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot = tileY(view, castle.y + castle.h) - t * 0.06;
    const eaves = foot - W * 0.48;
    return {
      cx,
      foot,
      eaves,
      half: W * 0.34,
      apex: eaves - W * 0.42,
      windowY: eaves + W * 0.14,
      windowDx: W * 0.15,
      window: W * 0.11,
      pumpkinX: cx + W * 0.36,
      pumpkinY: foot - W * 0.08,
      pumpkin: W * 0.12,
      chimneyX: cx + W * 0.17,
      chimneyTop: eaves - W * 0.36,
    };
  }

  /**
   * A castle as a crooked haunted house: a leaning body of dark boards, a steep roof in the
   * owner's colour with a chimney, two windows and a door, a jack-o'-lantern on the porch.
   * Its light — the lantern, the windows, the chimney's smoke — says whether it is sealed,
   * and is drawn with the effects.
   */
  private drawHouse(g: Graphics, view: ViewTransform, castle: Castle): void {
    const { palette } = this.art;
    const t = view.tile;
    const owner = castle.islandId - 1;
    const h = this.house(view, castle);
    const lean = t * 0.08;
    g.ellipse(h.cx + t * 0.1, h.foot, h.half * 1.35, t * 0.2);
    g.fill({ color: hex(palette.shadow), alpha: 0.35 });
    // The chimney, behind the roof.
    g.rect(h.chimneyX - t * 0.08, h.chimneyTop, t * 0.16, h.eaves - h.chimneyTop);
    g.fill({ color: 0x3a2e3c });
    // The body, leaning a little, its boards dark.
    g.poly([
      h.cx - h.half,
      h.foot,
      h.cx + h.half,
      h.foot,
      h.cx + h.half + lean,
      h.eaves,
      h.cx - h.half + lean,
      h.eaves,
    ]);
    g.fill({ color: 0x3b3046 });
    g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.8 });
    for (let k = 1; k < 4; k++) {
      const y = h.eaves + ((h.foot - h.eaves) * k) / 4;
      g.moveTo(h.cx - h.half + lean * (1 - k / 4), y).lineTo(h.cx + h.half + lean * (1 - k / 4), y);
    }
    g.stroke({ width: 1, color: hex(palette.shadow), alpha: 0.5 });
    // The roof, steep and crooked, in the owner's colour.
    g.poly([
      h.cx - h.half * 1.3 + lean,
      h.eaves,
      h.cx + h.half * 1.25 + lean,
      h.eaves,
      h.cx + lean * 2.5,
      h.apex,
    ]);
    g.fill({ color: this.colour(owner, 'base') });
    g.stroke({ width: this.ink(view), color: hex(palette.shadow), alpha: 0.85, join: 'round' });
    g.moveTo(h.cx - h.half * 0.6 + lean, h.eaves - (h.eaves - h.apex) * 0.45).lineTo(
      h.cx + h.half * 0.55 + lean,
      h.eaves - (h.eaves - h.apex) * 0.45,
    );
    g.stroke({ width: 1, color: this.colour(owner, 'dark'), alpha: 0.8 });
    // Windows and door, dark until the house is sealed.
    for (const s of [-1, 1]) {
      g.rect(
        h.cx + s * h.windowDx - h.window / 2 + lean * 0.5,
        h.windowY - h.window / 2,
        h.window,
        h.window,
      );
    }
    g.roundRect(h.cx - t * 0.12, h.foot - t * 0.38, t * 0.24, t * 0.38, t * 0.1);
    g.fill({ color: 0x140e1a });
    // The porch pumpkin, its face cut, unlit.
    g.ellipse(h.pumpkinX, h.pumpkinY, h.pumpkin * 1.2, h.pumpkin);
    g.fill({ color: 0xe8781a });
    g.ellipse(h.pumpkinX, h.pumpkinY, h.pumpkin * 0.45, h.pumpkin);
    g.stroke({ width: 1, color: 0xa04a0e, alpha: 0.8 });
    g.rect(h.pumpkinX - t * 0.025, h.pumpkinY - h.pumpkin * 1.35, t * 0.05, h.pumpkin * 0.4);
    g.fill({ color: 0x4a7a2a });
    this.pumpkinFace(g, h, 0x3a1a08, 1);
  }

  /** The cut face of the porch pumpkin: two eyes and a grin, in `colour`. */
  private pumpkinFace(g: Graphics, h: House, colour: number, alpha: number): void {
    const p = h.pumpkin;
    for (const s of [-1, 1]) {
      g.poly([
        h.pumpkinX + s * p * 0.5,
        h.pumpkinY - p * 0.15,
        h.pumpkinX + s * p * 0.2,
        h.pumpkinY - p * 0.15,
        h.pumpkinX + s * p * 0.35,
        h.pumpkinY - p * 0.5,
      ]);
    }
    g.poly([
      h.pumpkinX - p * 0.6,
      h.pumpkinY + p * 0.15,
      h.pumpkinX + p * 0.6,
      h.pumpkinY + p * 0.15,
      h.pumpkinX + p * 0.3,
      h.pumpkinY + p * 0.55,
      h.pumpkinX - p * 0.3,
      h.pumpkinY + p * 0.55,
    ]);
    g.fill({ color: colour, alpha });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inBog = this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (inBog) {
      // A splash of slime and a ring spreading on the bog.
      this.rings.push({ x, y, age: 0, owner: -1 });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
        this.bits.push({
          x: x + 0.5,
          y: y + 0.5,
          vx: Math.cos(a) * 1.1,
          vy: -2.6 - Math.random(),
          age: 0,
          life: SPLASH_MS,
          floor: y + 0.5 + Math.sin(a) * 0.3,
          size: 0.08 + Math.random() * 0.06,
          colour: hex(this.art.palette.waterFoam),
          drop: true,
        });
      }
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.scorches.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      // A ghost set free from the crypt, and the stone broken into rubble.
      this.ghosts.push({ x: block.x + 0.5, y: block.y + 0.5, age: 0, owner: block.owner });
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const v = 1.4 + Math.random() * 1.6;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * 1.3,
          floor: block.y + 0.85 + Math.random() * 0.3,
          size: 0.07 + Math.random() * 0.08,
          colour: hex(k % 2 === 0 ? this.art.palette.rockMid : this.art.palette.rockDark),
          drop: false,
        });
      }
    }
  }

  /** The sweep: a block left alone sinks into the ground like a grave. */
  noteCrumble(block: Debris): void {
    this.sinks.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    this.materialising.push({ cells, age: 0 });
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
    this.drawCandles(view);
    this.drawMaterialising(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawSinks(view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawLanterns(state, view, frame);
    this.drawCauldrons(state, view, frame.deltaMs);
    this.drawFog(view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawRings(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawGhosts(view, frame.deltaMs);
    this.drawLeaves(view, frame.deltaMs);
    this.drawWitchingHour(state, view);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** The ward's candle flames, flickering, each with a little warm light round it. */
  private drawCandles(view: ViewTransform): void {
    if (this.candles.length === 0) return;
    const g = this.effectGfx;
    const t = view.tile;
    const still = motionReduced();
    for (const [k, c] of this.candles.entries()) {
      const flick = still ? 1 : 0.8 + 0.2 * Math.sin(this.clock / 90 + k * 1.7);
      g.circle(tileX(view, c.x), tileY(view, c.y) - t * 0.16, t * 0.2 * flick);
    }
    g.fill({ color: hex(this.art.palette.emberMid), alpha: 0.18 });
    for (const [k, c] of this.candles.entries()) {
      const flick = still ? 1 : 0.8 + 0.2 * Math.sin(this.clock / 90 + k * 1.7);
      const x = tileX(view, c.x);
      const y = tileY(view, c.y) - t * 0.12;
      g.poly([x - t * 0.04, y, x + t * 0.04, y, x, y - t * 0.14 * flick]);
    }
    g.fill({ color: hex(this.art.palette.emberHot) });
  }

  /** A piece set down: mist puffs round it as it turns from spectral to solid stone. */
  private drawMaterialising(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const m of this.materialising) {
      m.age += deltaMs;
      const k = Math.min(1, m.age / MATERIALISE_MS);
      for (const c of m.cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
      g.fill({ color: 0xf4f0ff, alpha: 0.6 * (1 - k) });
      for (const c of m.cells) {
        for (let n = 0; n < 2; n++) {
          const a = hash(c.x, c.y, 250 + n) * Math.PI * 2;
          const d = t * (0.3 + 0.5 * k);
          g.circle(
            tileX(view, c.x + 0.5) + Math.cos(a) * d,
            tileY(view, c.y + 0.5) + Math.sin(a) * d,
            t * (0.15 + 0.2 * k),
          );
        }
      }
      g.fill({ color: 0xd8d0f0, alpha: 0.35 * (1 - k) });
    }
    this.materialising = this.materialising.filter((m) => m.age < MATERIALISE_MS);
  }

  /** The sweep's blocks sinking into the ground, the earth heaped where they went. */
  private drawSinks(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const s of this.sinks) {
      s.age += deltaMs;
      const k = Math.min(1, s.age / SINK_MS);
      const left = tileX(view, s.x);
      const top = tileY(view, s.y);
      const height = t * (1 - k);
      if (height > 0) {
        g.rect(left + t * 0.05, top + t * k, t * 0.9, height);
        g.fill({
          color:
            s.owner < 0
              ? hex(this.art.palette.rockMid)
              : mixed(hex(this.art.palette.rockMid), this.colour(s.owner, 'base'), 0.4),
        });
      }
      g.ellipse(left + t / 2, top + t * 0.95, t * (0.3 + 0.2 * k), t * (0.08 + 0.08 * k));
      g.fill({ color: hex(this.art.palette.sand), alpha: 1 - k * 0.5 });
    }
    this.sinks = this.sinks.filter((s) => s.age < SINK_MS);
  }

  /**
   * The houses' light: while sealed the porch jack-o'-lantern grins lit, the windows glow in
   * the owner's light and smoke curls from the chimney. Lit by sealing and put out by a
   * breach, as a flag is hoisted and lowered, so "sealed" is the house lit up.
   */
  private drawLanterns(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const still = motionReduced();
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.lanterns.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const lit = this.lanterns.raised(castle.id, this.clock, this.art);
      if (lit === null) continue;
      const owner = castle.islandId - 1;
      const h = this.house(view, castle);
      const flick = still ? 1 : 0.85 + 0.15 * Math.sin(this.clock / 110 + castle.id);
      const lean = t * 0.08;
      for (const s of [-1, 1]) {
        g.rect(
          h.cx + s * h.windowDx - h.window / 2 + lean * 0.5,
          h.windowY - h.window / 2,
          h.window,
          h.window,
        );
      }
      g.fill({ color: this.colour(owner, 'light'), alpha: lit });
      g.circle(h.pumpkinX, h.pumpkinY, h.pumpkin * 2.2 * flick);
      g.fill({ color: hex(this.art.palette.emberMid), alpha: 0.25 * lit });
      this.pumpkinFace(g, h, hex(this.art.palette.emberHot), lit * flick);
      if (still) continue;
      for (let k = 0; k < 3; k++) {
        const p = (((this.clock / 1600 + k / 3 + castle.id * 0.13) % 1) + 1) % 1;
        g.circle(
          h.chimneyX + Math.sin(p * 4 + k) * t * 0.12,
          h.chimneyTop - p * t * 0.9,
          t * (0.08 + 0.12 * p),
        );
        g.fill({ color: 0x9a88b8, alpha: 0.4 * (1 - p) * lit });
      }
    }
  }

  /**
   * The cauldrons: a ladle sticking out of each, turned to its target, kicking back as the
   * cauldron fires with a splash of potion; a live one bubbling. A silenced one's ladle
   * hangs limp over the rim.
   */
  private drawCauldrons(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const memo = this.gunMemo;
    memo.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      // Still between shots: drawn again only as it turns and kicks.
      const key = `${viewKey(view)}|${cannon.x},${cannon.y},${cannon.w},${cannon.h},${cannon.owner},${cannon.active}|${aim.angle}|${aim.firedAgo < Math.max(RECOIL_MS, 600) ? aim.firedAgo : '-'}`;
      memo.draw(cannon.id, key, (g) => {
        const r = Math.min(cannon.w, cannon.h) * t * 0.38;
        const cx = tileX(view, cannon.x + cannon.w / 2);
        const cy = tileY(view, cannon.y + cannon.h / 2) - r * 0.25;
        const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
        const length = cannon.active ? t * (0.95 - 0.3 * kick) : t * 0.55;
        const dx = Math.sin(aim.angle);
        const dy = cannon.active ? -Math.cos(aim.angle) : 0.6;
        const ex = cx + dx * length;
        const ey = cy + dy * length * 0.8;
        g.moveTo(cx, cy).lineTo(ex, ey);
        g.stroke({ width: Math.max(2, t * 0.12), color: 0x6b4a2a, cap: 'round' });
        g.circle(ex, ey, t * 0.1);
        g.fill({ color: 0x6b4a2a });
        if (!cannon.active) return;
        if (aim.firedAgo < 600) {
          const k = aim.firedAgo / 600;
          for (let n = 0; n < 4; n++) {
            const d = t * (0.2 + 0.6 * k + n * 0.1);
            g.circle(
              cx + dx * d + (n - 1.5) * t * 0.08,
              cy - Math.cos(aim.angle) * d,
              t * 0.09 * (1 - k * 0.5),
            );
          }
          g.fill({ color: this.colour(cannon.owner, 'base'), alpha: 0.7 * (1 - k) });
        }
      });
      // The brew bubbling, every frame: over the ladle, as it was drawn after it.
      if (!cannon.active || still) continue;
      const r = Math.min(cannon.w, cannon.h) * t * 0.38;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2) - r * 0.25;
      const g = this.lateGfx;
      for (let k = 0; k < 2; k++) {
        const p = (((this.clock / 700 + k * 0.5 + cannon.id * 0.21) % 1) + 1) % 1;
        g.circle(cx + (k - 0.5) * r * 0.6, cy - p * t * 0.35, t * 0.06 * (1 + p));
      }
      g.stroke({ width: 1, color: this.colour(cannon.owner, 'light'), alpha: 0.8 });
    }
    memo.end();
    this.aims.prune(state);
  }

  /** Ground fog drifting across the board in soft banks, thicker in a foggy match. */
  private drawFog(view: ViewTransform, deltaMs: number): void {
    const stamps = this.fogStamps;
    stamps.begin();
    if (this.fog.length === 0) {
      stamps.end();
      return;
    }
    const t = view.tile;
    const still = motionReduced();
    const { x0, x1 } = this.fogSpan;
    const alpha = this.style.fogAlpha * (this.weather === 'fog' ? 1.6 : 1);
    for (const f of this.fog) {
      if (!still) f.x += f.speed * (deltaMs / 1000);
      if (f.x - f.r > x1) f.x = x0 - f.r;
      const bank = this.book.get(`fog|${f.r}`, t, (g) => {
        for (let k = 0; k < 4; k++) {
          g.ellipse(
            (k - 1.5) * f.r * 0.45 * t,
            Math.sin(k * 1.7) * f.r * 0.12 * t,
            f.r * t * 0.55,
            f.r * t * 0.22,
          );
        }
        g.fill({ color: 0xd8d0f0, alpha });
      });
      stamps.place(bank, tileX(view, f.x), tileY(view, f.y));
    }
    stamps.end();
  }

  /** Shots: a spectral fireball of the owner's colour, white at its heart, trailing wisps. */
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
      // The wisps it trails, fading behind it.
      const step = span <= 0 ? 0 : 1.5 / span;
      for (let k = 4; k >= 1; k--) {
        const back = at(p - step * k);
        g.circle(back.x, back.y, t * (0.22 - 0.035 * k));
        g.fill({ color: this.colour(shot.owner, 'light'), alpha: 0.35 - 0.07 * k });
      }
      const r = t * (0.2 + 0.08 * high);
      g.circle(here.x, here.y, r * 1.9);
      g.fill({ color: this.colour(shot.owner, 'base'), alpha: 0.3 });
      g.circle(here.x, here.y, r);
      g.fill({ color: this.colour(shot.owner, 'light') });
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

  /** Rubble bouncing once, slime splashing back into the bog. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 7 * dt;
      if (b.y > b.floor && b.vy > 0) {
        if (b.drop) {
          b.age = b.life;
          continue;
        }
        b.y = b.floor;
        b.vy *= -0.3;
        b.vx *= 0.5;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const s = b.size * t;
      if (b.drop) g.circle(tileX(view, b.x), tileY(view, b.y), s);
      else g.rect(tileX(view, b.x) - s, tileY(view, b.y) - s, s * 2, s * 1.6);
      g.fill({ color: b.colour, alpha });
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** The ghosts a shot sets free from a wall: rising, swaying, fading as they go. */
  private drawGhosts(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const span = this.style.ghostMs;
    for (const ghost of this.ghosts) {
      ghost.age += deltaMs;
      const k = ghost.age / span;
      if (k >= 1) continue;
      const alpha = Math.min(1, k / 0.15) * Math.min(1, (1 - k) / 0.4);
      const x = tileX(view, ghost.x) + Math.sin(k * Math.PI * 3) * t * 0.25;
      const y = tileY(view, ghost.y) - k * t * 1.8;
      drawGhost(
        g,
        x,
        y,
        t * 0.42,
        alpha,
        ghost.owner < 0 ? 0xf4f0ff : this.colour(ghost.owner, 'light'),
      );
    }
    this.ghosts = this.ghosts.filter((ghost) => ghost.age < span);
  }

  /** On a snowy match, autumn leaves drift down over the board instead of snow. */
  private drawLeaves(view: ViewTransform, deltaMs: number): void {
    if (this.weather !== 'snow' || motionReduced()) return;
    const g = this.lateGfx;
    const t = view.tile;
    while (this.leaves.length < this.style.leafCount) {
      this.leaves.push({
        x: Math.random() * view.width,
        y: view.top + Math.random() * (view.height - view.top),
        vy: t * (0.8 + Math.random() * 0.8),
        angle: Math.random() * Math.PI,
        colour: LEAVES[Math.floor(Math.random() * LEAVES.length)]!,
      });
    }
    const dt = deltaMs / 1000;
    for (const leaf of this.leaves) {
      leaf.y += leaf.vy * dt;
      leaf.x += Math.sin(this.clock / 700 + leaf.angle * 3) * t * 0.6 * dt;
      leaf.angle += dt * 1.5;
      if (leaf.y > view.height) {
        leaf.y = view.top;
        leaf.x = Math.random() * view.width;
      }
      const c = Math.cos(leaf.angle);
      const s = Math.sin(leaf.angle);
      const l = t * 0.16;
      const w = t * 0.07;
      g.poly([
        leaf.x + c * l,
        leaf.y + s * l,
        leaf.x - s * w,
        leaf.y + c * w,
        leaf.x - c * l,
        leaf.y - s * l,
        leaf.x + s * w,
        leaf.y - c * w,
      ]);
      g.fill({ color: leaf.colour, alpha: 0.9 });
    }
  }

  /**
   * The witching hour — overtime and the final round: pairs of eyes open in the dark at the
   * screen's edges, glow, blink and close again. The shared border and dusk carry the
   * meaning; this is the mood.
   */
  private drawWitchingHour(state: MatchState, view: ViewTransform): void {
    const hot = (state.phase === 'build' && state.overtime) || inFinalRound(state);
    if (!hot) return;
    const g = this.lateGfx;
    const t = view.tile;
    const still = motionReduced();
    const pairs = this.style.eyePairs;
    for (let k = 0; k < pairs; k++) {
      // Round the edges of the screen: left, right and bottom, clear of the HUD bar.
      const side = k % 3;
      const along = hash(k, 260);
      const inset = t * (0.8 + 0.8 * hash(k, 261));
      const x =
        side === 0 ? inset : side === 1 ? view.width - inset : view.width * (0.08 + 0.84 * along);
      const y =
        side === 2
          ? view.height - inset
          : view.top + t * 2 + (view.height - view.top - t * 3) * along;
      const period = 3200 + 2600 * hash(k, 262);
      const phase = still ? 0.3 : (((this.clock / period + hash(k, 263)) % 1) + 1) % 1;
      if (phase > 0.7) continue;
      // Opening, open, blinking once, closing.
      const open =
        Math.min(1, phase / 0.08, (0.7 - phase) / 0.08) * (Math.abs(phase - 0.4) < 0.02 ? 0.1 : 1);
      const size = t * (0.22 + 0.1 * hash(k, 264));
      for (const s of [-1, 1]) {
        g.ellipse(x + s * size * 1.4, y, size * 1.6, size * 1.2 * open);
        g.fill({ color: hex(this.art.palette.emberMid), alpha: 0.18 });
        g.ellipse(x + s * size * 1.4, y, size, size * 0.7 * open);
        g.fill({ color: 0xffe066 });
        g.ellipse(x + s * size * 1.4, y, size * 0.25, size * 0.6 * open);
        g.fill({ color: 0x120d1a });
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
      // The piece in hand as a spectral wall, see-through, its outline wavering; where it
      // does not fit, a cracked outline — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const fill = ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: fill, alpha: ghost.valid ? 0.35 : 0.3 });
      const waver = motionReduced() ? 0 : Math.sin(now / 160) * t * 0.04;
      for (const s of outline(cells, inPiece, view)) {
        g.moveTo(s.x1 + waver, s.y1 - waver).lineTo(s.x2 + waver, s.y2 - waver);
      }
      g.stroke({
        width: Math.max(1.5, t * 0.09),
        color: ghost.valid ? 0xf4f0ff : hex(palette.uiInvalid),
        alpha: 0.9,
      });
      if (!ghost.valid) {
        for (const { x, y } of cells) {
          const px = tileX(view, x);
          const py = tileY(view, y);
          g.moveTo(px + t * 0.2, py + t * 0.15).lineTo(px + t * 0.45, py + t * 0.45);
          g.lineTo(px + t * 0.35, py + t * 0.6).lineTo(px + t * 0.75, py + t * 0.88);
        }
        g.stroke({ width: Math.max(1.5, t * 0.09), color: hex(palette.uiInvalid), join: 'round' });
      }
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // An empty cauldron's outline, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.38;
      g.ellipse(cx, cy + r * 0.15, r, r * 0.72);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      g.ellipse(cx, cy - r * 0.25, r * 0.98, r * 0.36);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: colour });
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
 * Halloween's scenery, none like a wall, a cauldron or a fireball: a tree a twisted dead one,
 * a pine a pumpkin, a bush a toadstool, a boulder a rounded headstone — one in four a skull
 * lying in the grass instead.
 */
function drawHalloweenScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  const ink = Math.max(1, t * 0.06);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.ellipse(cx + t * 0.1, cy + t * 0.38, t * 0.25, t * 0.08);
      g.fill({ color: hex(palette.shadow), alpha: 0.3 });
      const trunk = Math.max(1.5, t * 0.1);
      const flip = item.variant % 2 === 0 ? 1 : -1;
      g.moveTo(cx, cy + t * 0.38).quadraticCurveTo(
        cx - flip * t * 0.1,
        cy,
        cx + flip * t * 0.05,
        cy - t * 0.25,
      );
      g.stroke({ width: trunk, color: 0x2e2228, cap: 'round' });
      g.moveTo(cx - flip * t * 0.04, cy + t * 0.05).lineTo(cx - flip * t * 0.32, cy - t * 0.15);
      g.lineTo(cx - flip * t * 0.38, cy - t * 0.32);
      g.moveTo(cx + flip * t * 0.02, cy - t * 0.1).lineTo(cx + flip * t * 0.3, cy - t * 0.3);
      g.moveTo(cx + flip * t * 0.05, cy - t * 0.25).lineTo(cx + flip * t * 0.12, cy - t * 0.42);
      g.stroke({ width: trunk * 0.55, color: 0x2e2228, cap: 'round' });
    } else if (item.kind === 'pine') {
      // A pumpkin, ribbed, its stem curling — never lit: only a sealed house's grins.
      const r = t * 0.24;
      g.ellipse(cx + t * 0.06, cy + r * 0.9, r * 1.1, r * 0.3);
      g.fill({ color: hex(palette.shadow), alpha: 0.3 });
      g.ellipse(cx, cy, r * 1.15, r);
      g.fill({ color: 0xe8781a });
      g.ellipse(cx, cy, r * 0.45, r);
      g.ellipse(cx, cy, r * 0.85, r);
      g.stroke({ width: Math.max(1, t * 0.04), color: 0xa04a0e, alpha: 0.8 });
      g.moveTo(cx, cy - r * 0.9).quadraticCurveTo(
        cx + r * 0.1,
        cy - r * 1.4,
        cx + r * 0.35,
        cy - r * 1.3,
      );
      g.stroke({ width: Math.max(1.5, t * 0.07), color: 0x4a7a2a, cap: 'round' });
    } else if (item.kind === 'bush') {
      // A toadstool: a pale stalk under a cap, red with white spots or purple.
      const red = item.variant % 2 === 0;
      g.rect(cx - t * 0.05, cy - t * 0.02, t * 0.1, t * 0.22);
      g.fill({ color: 0xece4d8 });
      g.moveTo(cx - t * 0.22, cy)
        .arc(cx, cy, t * 0.22, Math.PI, 0)
        .closePath();
      g.fill({ color: red ? 0xc8283c : 0x7a4aa8 });
      if (red) {
        for (const [dx, dy] of [
          [-0.1, -0.08],
          [0.06, -0.14],
          [0.12, -0.05],
        ] as const) {
          g.circle(cx + t * dx, cy + t * dy, t * 0.035);
        }
        g.fill({ color: 0xffffff });
      }
    } else if (item.variant % 4 === 0) {
      // A skull lying in the grass, small and more silly than grim.
      const r = t * 0.17;
      g.circle(cx, cy - r * 0.2, r);
      g.roundRect(cx - r * 0.6, cy + r * 0.4, r * 1.2, r * 0.55, r * 0.15);
      g.fill({ color: 0xe8e2d4 });
      for (const s of [-1, 1]) g.circle(cx + s * r * 0.38, cy - r * 0.2, r * 0.26);
      g.fill({ color: 0x2a1e2a });
      g.moveTo(cx - r * 0.3, cy + r * 0.62).lineTo(cx + r * 0.3, cy + r * 0.62);
      g.stroke({ width: 1, color: 0x2a1e2a });
    } else {
      // A headstone, rounded and grey, small beside a wall block.
      const w = t * 0.36;
      const h = t * 0.42;
      g.ellipse(cx + t * 0.06, cy + h * 0.55, w * 0.7, t * 0.07);
      g.fill({ color: hex(palette.shadow), alpha: 0.3 });
      g.moveTo(cx - w / 2, cy + h / 2).lineTo(cx - w / 2, cy - h * 0.15);
      g.arc(cx, cy - h * 0.15, w / 2, Math.PI, 0);
      g.lineTo(cx + w / 2, cy + h / 2).closePath();
      g.fill({ color: hex(palette.rockMid) });
      g.stroke({ width: ink, color: hex(palette.rockDark) });
      g.moveTo(cx - w * 0.22, cy - h * 0.05).lineTo(cx + w * 0.22, cy - h * 0.05);
      g.moveTo(cx - w * 0.22, cy + h * 0.12).lineTo(cx + w * 0.15, cy + h * 0.12);
      g.stroke({ width: 1, color: hex(palette.rockDark) });
    }
  }
}
