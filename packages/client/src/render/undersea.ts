import type { ArtConfig, UnderseaStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import { inFinalRound } from '../scores.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { hash } from './noise.js';
import { cornerSpot, pressing } from './corner.js';
import { IslandParts } from './islandParts.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import {
  SHELL,
  drawBubble,
  drawClam,
  drawConch,
  drawFish,
  drawPuffer,
  drawUrchin,
  type PufferMood,
} from './reef.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { UnderseaSeaLife } from './seaLife.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
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
  mixed,
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

/** Something with a place and an age: a column of bubbles, a cloud of silt, a crumble. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A piece set down, settling with a puff of sand. */
interface Settling {
  cells: readonly Cell[];
  age: number;
}

/** A chip of coral knocked off a wall, sinking, in tiles. */
interface Chip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  floor: number;
  colour: number;
  angle: number;
  spin: number;
}

/** A little fish darting away from a hit, in tiles. */
interface Dart {
  x: number;
  y: number;
  angle: number;
  speed: number;
  age: number;
}

/** Where a shot came down on the sand: a dimple, fading over the rounds. */
interface Dimple {
  x: number;
  y: number;
  round: number;
}

/** A speck of marine snow drifting down, in tiles on screen. */
interface Speck {
  x: number;
  y: number;
  speed: number;
  phase: number;
}

/** A raindrop ringing the surface far above, seen from below. */
interface Ring {
  x: number;
  y: number;
  age: number;
}

/** A whale passing over, its shadow crossing the board: in screen pixels. */
interface Whale {
  x: number;
  y: number;
  dir: 1 | -1;
}

const PUFF_MS = 420;
const SPIT_MS = 600;
const SPLASH_MS = 1400;
const SILT_MS = 1500;
const CRUMBLE_MS = 900;
const SETTLE_MS = 600;
const DART_MS = 900;
const RING_MS = 1100;

const WOOD = 0x5c4a36;
const WOOD_LIGHT = 0x7a6448;
const BRASS = 0xb08a4a;
const KELP = 0x6a7a3a;
const SILVER = 0xc9d8e0;
/** The octopus on the wreck: mottled taupe, a colour no player has. */
const OCTOPUS = 0x9a7a66;
const OCTOPUS_PALE = 0xf0e0d0;

/** How Under the sea sends off the winners: bubbles and little fish, a trident for a flag. */
const FINISH: FinishLook = { spark: 'bubbles', flag: 'trident' };

/**
 * The Under the sea look, for either look: the board on the seabed. Each island is a sunlit
 * reef plateau of pale sand, rippled, the light rippling over it; the sea round it is the
 * deep, turquoise at the plateau's edge and darkening to ink, shafts of light slanting down
 * through it and marine snow drifting. Walls are coral in the owner's colour, a brain coral's
 * grooves on every block; castles are shell palaces, a conch standing on its end, and sealed
 * is the giant clam at the door open on a glowing pearl — a breach shuts it. Sealed ground is
 * a meadow of seagrass in the owner's colour. Guns are pufferfish, puffing up round as they
 * fire sea urchins; a silenced one hangs limp. A shipwreck with an octopus on it lies in the
 * corner; as the deep comes up — overtime and the final round — the light dims, anglerfish
 * lures glow at the edges and now and then a whale's shadow passes over.
 */
export class UnderseaTheme implements Theme {
  readonly id = 'undersea' as const;

  private art!: ArtConfig;
  private style!: UnderseaStyleConfig;
  private weather: Weather = 'clear';
  /** Life on the outer deep (`seaLife.ts`). */
  private readonly seaLife = new UnderseaSeaLife();

  private readonly terrainGfx = new Graphics();
  /**
   * The light rippling over the sand: two sets of wavy lines drawn once and only slid, each
   * its own way, through a mask of the land, so they cross as caustics do at no cost a frame.
   */
  private readonly caustics = new Container();
  private readonly causticsAcross = new Graphics();
  private readonly causticsDown = new Graphics();
  private readonly causticMask = new Graphics();
  private causticFrame = { x: 0, y: 0, across: { w: 0, h: 0 }, down: { w: 0, h: 0 } };
  /** Dimples in the sand where shots came down: redrawn when one is added or fades. */
  private readonly dimpleGfx = new Graphics();
  private dimplesDrawn = '';
  /** The wreck and its octopus: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawUnderseaScenery(g, view, items, this.art),
    () => 0xe9d8ab,
  );
  /** Coral, shell palaces and the guns' rocks, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  /** The pufferfish, a stamp each of an owner's fish in its mood, turned to its target. */
  private readonly pufferStamps = new Stamps();
  private readonly book = new StampBook();
  /** The clams, a `Graphics` each, redrawn only while one opens or shuts. */
  private readonly clamMemos = new Memos();
  private readonly effectGfx = new Graphics();
  /** Every small bubble — trails, spit, columns — a stamp of one bubble, scaled and faded. */
  private readonly bubbleStamps = new Stamps();
  /** The urchins in flight, stamps of one urchin a colour, spinning. */
  private readonly urchinStamps = new Stamps();
  /** Everything over the urchins: chips, fish, bubbles, silt, the deep, the finish. */
  private readonly lateGfx = new Graphics();
  /** Marine snow, stamps of one speck. */
  private readonly snowStamps = new Stamps();
  /** A plankton bloom in a foggy match. */
  private readonly bloom = new Discs();
  /** The shafts of light from the surface, over everything. */
  private readonly shaftGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private round = 0;
  private wreck: TimerSpot | null = null;
  private dimples: Dimple[] = [];
  private splashes: Aged[] = [];
  private silts: Aged[] = [];
  private crumbles: Aged[] = [];
  private settling: Settling[] = [];
  private chips: Chip[] = [];
  private darts: Dart[] = [];
  private specks: Speck[] = [];
  private rings: Ring[] = [];
  private whale: Whale | null = null;
  private sinceWhale = 0;
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The clams open on their pearls, raised as a flag is: by sealing, and shut by a breach. */
  private readonly pearls = new FlagHoist();
  private clock = 0;

  constructor(private readonly seed = 1) {}

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.undersea;
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    this.caustics.addChild(this.causticsAcross, this.causticsDown, this.causticMask);
    this.caustics.mask = this.causticMask;
    layers.terrain.addChild(this.terrainGfx, this.caustics, this.dimpleGfx, this.flowGfx);
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.pufferStamps.container,
      this.clamMemos.container,
      this.effectGfx,
      this.bubbleStamps.container,
      this.urchinStamps.container,
      this.lateGfx,
      this.snowStamps.container,
      this.bloom.container,
      this.shaftGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.pufferStamps.destroy();
    this.clamMemos.destroy();
    this.bubbleStamps.destroy();
    this.urchinStamps.destroy();
    this.snowStamps.destroy();
    this.bloom.destroy();
    this.book.destroy();
    release(this.caustics);
    for (const g of [
      this.terrainGfx,
      this.dimpleGfx,
      this.flowGfx,
      this.effectGfx,
      this.lateGfx,
      this.shaftGfx,
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

  /** As the deep comes up: overtime, and the final round. */
  private deep(state: MatchState): boolean {
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

    // The deep runs out past the board to the window's edge, lightest against the plateaus
    // and darkening with every tile from them: measured by a search out from the land.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const w = x1 - x0;
    const h = y1 - y0;
    g.rect(tileX(view, x0), tileY(view, y0), w * t, h * t);
    g.fill({ color: hex(palette.waterDeep) });
    const reach = 6;
    const depth = new Int8Array(w * h).fill(reach);
    const queue: number[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (!land(x, y)) continue;
        const i = (y - y0) * w + (x - x0);
        depth[i] = 0;
        queue.push(i);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const d = depth[i]!;
      if (d + 1 >= reach) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (depth[n]! <= d + 1) continue;
          depth[n] = d + 1;
          queue.push(n);
        }
      }
    }
    const deep = hex(palette.waterDeep);
    const mid = hex(palette.waterMid);
    const shallow = hex(palette.waterShallow);
    const bands = [
      shallow,
      mixed(shallow, mid, 0.5),
      mid,
      mixed(mid, deep, 0.4),
      mixed(mid, deep, 0.75),
    ];
    // Deepest first, each band over the last, in discs, so the drop-off curves round the
    // coast rather than stepping.
    for (let band = bands.length; band >= 1; band--) {
      for (let i = 0; i < depth.length; i++) {
        if (depth[i] !== band) continue;
        const x = (i % w) + x0;
        const y = Math.floor(i / w) + y0;
        g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.78);
      }
      g.fill({ color: bands[band - 1]! });
    }

    // The sand: pale, lighter in drifts, grit in it, and rippled by the current — one line
    // across each run of a row, so ripples carry on from tile to tile.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x >> 1, y >> 1, 900) > 0.35) continue;
      g.rect(tileX(view, x), tileY(view, y), t, t);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.5 });
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (!land(x, y) || land(x - 1, y)) continue;
        let end = x;
        while (land(end + 1, y)) end++;
        for (const f of [0.3, 0.75]) {
          for (let u = x; u <= end + 1; u += 0.25) {
            const v = y + f + Math.sin(u * 2.1 + y * 0.9 + f * 3) * 0.08;
            if (u === x) g.moveTo(tileX(view, u), tileY(view, v));
            else g.lineTo(tileX(view, u), tileY(view, v));
          }
        }
      }
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.grassDark), alpha: 0.4 });
    for (const { x, y } of ground) {
      if (hash(x, y, 901) > 0.3) continue;
      g.circle(
        tileX(view, x + hash(x, y, 902)),
        tileY(view, y + hash(x, y, 903)),
        Math.max(0.8, t * 0.04),
      );
    }
    g.fill({ color: 0xffffff, alpha: 0.6 });
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

    // The plateau's edge: wet sand darkening to a rocky lip where it drops into the deep.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({
      width: t * 0.32,
      color: mixed(hex(palette.grassDark), shallow, 0.35),
      alpha: 0.7,
      cap: 'square',
    });
    trace(g, coast);
    g.stroke({ width: Math.max(1.5, t * 0.08), color: hex(palette.rockMid), cap: 'square' });
    trace(g, coast);
    g.stroke({ width: 1, color: this.dark, alpha: 0.6, cap: 'square' });

    this.layCaustics(state, view, ground);

    // The wreck's place, in the corner the compass rose takes in Parchment.
    this.wreck = cornerSpot(state, view);
    this.seaLife.corner = this.wreck;
    this.seaLife.layout(state, view, this.art);
    this.dimplesDrawn = '';
  }

  /**
   * The caustics, laid out for this board: each set of lines repeats every few lines across
   * and every wave or two along, so sliding it by up to one repeat never shows an edge.
   */
  private layCaustics(state: MatchState, view: ViewTransform, ground: readonly Cell[]): void {
    const t = view.tile;
    const W = state.width * t;
    const H = state.height * t;
    const alpha = this.style.causticAlpha;
    const width = Math.max(1, t * 0.07);
    const draw = (
      g: Graphics,
      spacing: number,
      wave: number,
      across: boolean,
    ): { w: number; h: number } => {
      g.clear();
      const repeat = { along: wave * 2, over: spacing * 4 };
      const long = (across ? W : H) + repeat.along * 2;
      const wide = (across ? H : W) + repeat.over * 2;
      for (let k = 0; k * spacing <= wide; k++) {
        const base = k * spacing - repeat.over;
        const phase = (k % 4) * 1.7;
        for (let u = -repeat.along; u <= long; u += wave / 10) {
          const v =
            base +
            Math.sin((u / wave) * Math.PI * 2 + phase) * t * 0.2 +
            Math.sin((u / (wave * 2)) * Math.PI * 2 + phase * 2) * t * 0.12;
          const [px, py] = across ? [u, v] : [v, u];
          if (u === -repeat.along) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
      }
      g.stroke({ width, color: 0xffffff, alpha });
      return across ? { w: repeat.along, h: repeat.over } : { w: repeat.over, h: repeat.along };
    };
    const across = draw(this.causticsAcross, t * 0.95, t * 2.4, true);
    const down = draw(this.causticsDown, t * 1.15, t * 2.9, false);
    this.causticFrame = { x: view.originX, y: view.originY, across, down };
    const m = this.causticMask;
    m.clear();
    for (const { x, y } of ground) m.rect(tileX(view, x), tileY(view, y), t, t);
    m.fill({ color: 0xffffff });
    this.slideCaustics(view);
  }

  /** The caustics slid on by the clock, each set its own way, by less than its repeat. */
  private slideCaustics(view: ViewTransform): void {
    const { x, y, across, down } = this.causticFrame;
    const run = motionReduced()
      ? 0
      : (this.clock / 1000) * this.style.causticTilesPerSecond * view.tile;
    const wrap = (v: number, p: number): number => (p <= 0 ? 0 : -(((v % p) + p) % p));
    this.causticsAcross.position.set(x + wrap(run, across.w), y + wrap(run * 0.4, across.h));
    this.causticsDown.position.set(x + wrap(-run * 0.5, down.w), y + wrap(run * 0.8, down.h));
  }

  /** The dimples in the sand, drawn again only when one comes or fades. */
  private drawDimples(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.dimples = this.dimples.filter((d) => state.round - d.round < rounds);
    const key = `${state.round}|${this.dimples.length}|${view.tile}|${view.originX}|${view.originY}`;
    if (key === this.dimplesDrawn) return;
    this.dimplesDrawn = key;
    const g = this.dimpleGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    for (const d of this.dimples) {
      const fade = 1 - (state.round - d.round) / rounds;
      const cx = tileX(view, d.x + 0.5);
      const cy = tileY(view, d.y + 0.5);
      g.ellipse(cx, cy, t * 0.4, t * 0.32);
      g.fill({ color: hex(palette.craterMid), alpha: 0.35 * fade });
      g.ellipse(cx, cy + t * 0.04, t * 0.26, t * 0.18);
      g.fill({ color: hex(palette.craterDark), alpha: 0.3 * fade });
      // The sand thrown up round it, a lighter rim to the north where the light catches it.
      g.moveTo(cx - t * 0.36, cy - t * 0.1);
      g.quadraticCurveTo(cx, cy - t * 0.46, cx + t * 0.36, cy - t * 0.1);
      g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.grassLight), alpha: 0.7 * fade });
    }
  }

  // ------------------------------------------------------------------ the wreck

  /**
   * The wreck in the corner: a ship's bow rising out of a mound of sand, its stern broken
   * off, portholes along it and its mast snapped; weed hanging from its rail, a bubble now
   * and then from a porthole; and an octopus draped over the bow, its arms swaying, blinking.
   * As the clock presses it blanches, pale and dark by turns, and its arms curl quicker.
   */
  private drawWreck(g: Graphics, view: ViewTransform, spot: TimerSpot, hurry: boolean): void {
    const t = view.tile;
    const s = spot.size * t;
    const ox = tileX(view, spot.x);
    const oy = tileY(view, spot.y);
    const at = (u: number, v: number): [number, number] => [ox + u * s, oy + v * s];
    const still = motionReduced();
    const deck = (u: number): number => 0.02 + (u + 0.38) * (-0.36 / 0.76);
    // The mound it lies in.
    g.ellipse(...at(-0.02, 0.33), s * 0.5, s * 0.1);
    g.fill({ color: hex(this.art.palette.grassMid) });
    g.ellipse(...at(-0.02, 0.33), s * 0.5, s * 0.1);
    g.stroke({ width: 1, color: hex(this.art.palette.grassDark), alpha: 0.6 });
    // The mast, snapped and leaning, behind the hull.
    g.moveTo(...at(-0.05, deck(-0.05))).lineTo(...at(-0.2, -0.36));
    g.moveTo(...at(-0.28, -0.27)).lineTo(...at(-0.1, -0.31));
    g.stroke({ width: Math.max(1.5, s * 0.03), color: WOOD, cap: 'round' });
    // The hull: the stern broken off jagged, the bow rising to its stem.
    const hull = [
      [-0.42, 0.32],
      [-0.4, 0.04],
      [-0.35, 0.08],
      [-0.31, -0.0],
      [-0.27, 0.05],
      [0.2, deck(0.2)],
      [0.38, -0.36],
      [0.36, -0.2],
      [0.3, 0.06],
      [0.22, 0.32],
    ] as const;
    g.poly(hull.flatMap(([u, v]) => at(u, v)));
    g.fill({ color: WOOD });
    for (let k = 1; k <= 3; k++) {
      g.moveTo(...at(-0.39, deck(-0.39) + 0.07 * k)).lineTo(
        ...at(0.31 - 0.04 * k, deck(0.31 - 0.04 * k) + 0.07 * k),
      );
    }
    g.stroke({ width: 1, color: this.dark, alpha: 0.45 });
    g.poly(hull.flatMap(([u, v]) => at(u, v)));
    g.stroke({ width: Math.max(1, s * 0.012), color: this.dark, alpha: 0.85, join: 'round' });
    g.moveTo(...at(-0.27, deck(-0.27))).lineTo(...at(0.38, -0.36));
    g.stroke({ width: Math.max(1.5, s * 0.02), color: WOOD_LIGHT });
    // Portholes, rimmed in brass gone green.
    for (const u of [-0.12, 0.06]) {
      g.circle(...at(u, deck(u) + 0.1), s * 0.035);
      g.fill({ color: 0x0e1e26 });
      g.circle(...at(u, deck(u) + 0.1), s * 0.035);
      g.stroke({ width: Math.max(1, s * 0.01), color: BRASS });
    }
    // Weed hanging from the rail, swaying.
    for (const u of [-0.2, -0.02]) {
      const sway = still ? 0 : Math.sin(this.clock / 700 + u * 9) * s * 0.02;
      g.moveTo(...at(u, deck(u)));
      g.quadraticCurveTo(
        at(u, 0)[0] + sway,
        at(u, deck(u) + 0.1)[1],
        at(u, 0)[0] - sway,
        at(u, deck(u) + 0.2)[1],
      );
    }
    g.stroke({ width: Math.max(1, s * 0.015), color: KELP, alpha: 0.9 });
    // A bubble rising now and then from a porthole.
    if (!still) {
      const p = (this.clock % 3200) / 1600;
      if (p < 1) {
        const [bx, by] = at(0.06, deck(0.06) + 0.1);
        drawBubble(
          g,
          bx + Math.sin(p * 9) * s * 0.02,
          by - p * s * 0.45,
          s * (0.015 + 0.02 * p),
          1 - p * 0.6,
        );
      }
    }
    // The octopus on the bow: its arms over the hull, then its head and eyes.
    const blanch = hurry && !still ? 0.5 + 0.5 * Math.sin(this.clock / 150) : 0;
    const body = mixed(OCTOPUS, OCTOPUS_PALE, blanch * 0.7);
    const pace = hurry ? 220 : 700;
    const arms: [number, number][] = [
      [0.02, 0.0],
      [0.1, 0.12],
      [0.2, 0.2],
      [0.32, 0.12],
      [0.42, -0.08],
      [0.36, -0.42],
    ];
    const head = { u: 0.24, v: -0.3 };
    arms.forEach(([u, v], k) => {
      const sway = still ? 0 : Math.sin(this.clock / pace + k * 1.3) * 0.035;
      const end = at(u + sway, v + sway * 0.5);
      const ctrl = at((head.u + u) / 2 + sway, (head.v + v) / 2 - 0.08);
      g.moveTo(...at(head.u, head.v + 0.05));
      g.quadraticCurveTo(ctrl[0], ctrl[1], end[0], end[1]);
      // The tip curled.
      g.arc(
        end[0] + s * 0.02,
        end[1],
        s * 0.02,
        Math.PI,
        Math.PI * (k % 2 === 0 ? 2.6 : -0.4),
        k % 2 !== 0,
      );
    });
    g.stroke({ width: Math.max(1.5, s * 0.03), color: body, cap: 'round', join: 'round' });
    g.ellipse(...at(head.u, head.v), s * 0.1, s * 0.12);
    g.fill({ color: body });
    g.ellipse(...at(head.u, head.v), s * 0.1, s * 0.12);
    g.stroke({ width: 1, color: this.dark, alpha: 0.5 });
    for (const [u, v] of [
      [-0.04, -0.06],
      [0.03, -0.08],
      [0.0, -0.02],
    ] as const) {
      g.circle(...at(head.u + u, head.v + v), s * 0.012);
    }
    g.fill({ color: mixed(body, 0x3a2a24, 0.4) });
    const blink = !still && this.clock % 4200 < 160;
    for (const side of [-1, 1]) {
      const [ex, ey] = at(head.u + side * 0.045, head.v + 0.06);
      if (blink) {
        g.moveTo(ex - s * 0.02, ey).lineTo(ex + s * 0.02, ey);
        g.stroke({ width: Math.max(1, s * 0.008), color: this.dark });
        continue;
      }
      g.circle(ex, ey, s * 0.024);
      g.fill({ color: 0xfff8e8 });
      g.rect(ex - s * 0.014, ey - s * 0.005, s * 0.028, s * 0.01);
      g.fill({ color: this.dark });
    }
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a meadow of seagrass in the owner's colour: the sand washed in it, blades
   * leaning with the current, an anemone here and there, and its edge drawn in the light.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawMeadow(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawMeadow(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      // The blades, each from its root bending over with the current: two straight strokes,
      // since a curve on every blade made a meadow ten times Office's booked ground.
      const blades = (
        shade: 'dark' | 'light',
        from: number,
        count: number,
        alpha: number,
      ): void => {
        for (const { x, y } of cells) {
          for (let k = from; k < from + count; k++) {
            const u = 0.15 + 0.7 * hash(x, y * 4 + k, 910);
            const tall = 0.4 + 0.35 * hash(x, y * 4 + k, 911);
            const lean = 0.12 + 0.12 * hash(x, y * 4 + k, 912);
            const rx = tileX(view, x + u);
            const ry = tileY(view, y + 0.9);
            g.moveTo(rx, ry)
              .lineTo(rx + lean * t * 0.2, ry - tall * t * 0.6)
              .lineTo(rx + lean * t, ry - tall * t);
          }
        }
        g.stroke({
          width: Math.max(1, t * 0.07),
          color: this.colour(player, shade),
          alpha,
        });
      };
      blades('dark', 0, 2, 0.65);
      blades('light', 2, 1, 0.6);
      // An anemone here and there: a star of tentacles round its mouth.
      for (const { x, y } of cells) {
        if (hash(x, y, 913) > 0.08) continue;
        const cx = tileX(view, x + 0.5);
        const cy = tileY(view, y + 0.5);
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * t * 0.24, cy + Math.sin(a) * t * 0.2);
        }
      }
      g.stroke({
        width: Math.max(1.5, t * 0.09),
        color: this.colour(player, 'light'),
        alpha: 0.9,
      });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({
        width: Math.max(1.5, t * 0.08),
        color: this.colour(player, 'light'),
        alpha: 0.85,
      });
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
      this.drawCoral(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawPalace(g, view, castle);

    // Guns sit in a nest of rock on the shared square; the pufferfish over it is drawn with
    // the effects, turned to its target.
    for (const cannon of state.cannons) {
      cannonBase(
        g,
        view,
        cannon,
        hex(this.art.palette.rockDark),
        this.colour(cannon.owner, 'base'),
      );
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const r = Math.min(cannon.w, cannon.h) * t * 0.4;
        const x = tileX(view, cannon.x + cannon.w / 2) + Math.cos(a) * r;
        const y = tileY(view, cannon.y + cannon.h / 2) + Math.sin(a) * r;
        const s = t * (0.1 + 0.05 * (k % 2));
        g.poly([
          x - s,
          y,
          x - s * 0.4,
          y - s,
          x + s,
          y - s * 0.6,
          x + s * 0.8,
          y + s * 0.7,
          x - s * 0.3,
          y + s,
        ]);
      }
      g.fill({ color: hex(this.art.palette.rockMid) });
    }
  }

  /**
   * Walls as coral: each block a lump of brain coral in the owner's colour, its grooves
   * winding over the top and polyps dotted along them, a crevice between blocks so a shot
   * visibly takes one; its face the coral's rocky foot, pitted; standing to the shared
   * height. A player's who is out (`player` -1) is bleached white.
   */
  private drawCoral(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const dead = player < 0;
    const top = dead ? hex(palette.rockLight) : this.colour(player, 'base');
    const shade = dead ? hex(palette.rockMid) : this.colour(player, 'dark');
    const glint = dead ? 0xffffff : this.colour(player, 'light');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: top });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: shade });
    // Drawn in straight strokes and small squares, never curves or discs: a wall is redrawn
    // at every hit on its island, and curves on every block made it 21 000 vertices at eight
    // players where Office's partitions are 8 000.
    // The face pitted, as old coral rock is.
    const dot = Math.max(1.5, t * 0.09);
    for (const r of wall.faces) {
      for (let k = 0; k < 3; k++) {
        g.rect(
          r.x + r.w * (0.15 + 0.7 * hash(Math.round(r.x), Math.round(r.y) + k, 920)),
          r.y + r.h * (0.3 + 0.4 * hash(Math.round(r.x) + k, Math.round(r.y), 921)),
          dot,
          dot,
        );
      }
    }
    g.fill({ color: this.dark, alpha: 0.35 });
    // Each block's lump catching the light on its upper left.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.poly([
        b.left + t * 0.14,
        b.top + h * 0.4,
        b.left + t * 0.3,
        b.top + h * 0.14,
        b.left + t * 0.62,
        b.top + h * 0.12,
        b.left + t * 0.42,
        b.top + h * 0.3,
      ]);
    }
    g.fill({ color: glint, alpha: dead ? 0.5 : 0.35 });
    // The brain coral's grooves winding across each block, a zigzag of four strokes.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      for (let k = 0; k < 2; k++) {
        const y = b.top + h * (0.36 + 0.34 * k);
        const wob = (0.5 + hash(b.x, b.y * 2 + k, 922) * 0.5) * h * 0.14 * (k === 0 ? 1 : -1);
        g.moveTo(b.left + t * 0.12, y)
          .lineTo(b.left + t * 0.32, y - wob)
          .lineTo(b.left + t * 0.5, y + wob)
          .lineTo(b.left + t * 0.7, y - wob)
          .lineTo(b.left + t * 0.88, y);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: shade, alpha: 0.65 });
    if (!dead) {
      // Polyps dotted along the grooves.
      for (const b of wall.blocks) {
        const h = b.lip - b.top;
        for (let k = 0; k < 3; k++) {
          g.rect(
            b.left + t * (0.22 + 0.28 * k) - dot / 2,
            b.top + h * (0.18 + 0.6 * hash(b.x + k, b.y, 923)) - dot / 2,
            dot,
            dot,
          );
        }
      }
      g.fill({ color: glint, alpha: 0.85 });
    }
    // The crevices between blocks, where the next one grows on.
    for (const b of wall.blocks) {
      if (joins(b.x + 1, b.y))
        g.moveTo(b.left + t, b.top).lineTo(b.left + t, b.lip + (b.faced ? wall.face : 0));
      if (joins(b.x, b.y + 1)) g.moveTo(b.left, b.top + t).lineTo(b.left + t, b.top + t);
    }
    g.stroke({ width: Math.max(1, t * 0.07), color: this.dark, alpha: 0.5 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, this.ink(view) * 0.7), color: this.dark, alpha: 0.8 });
  }

  /** Where a castle's clam sits: before the palace's door, to its right. */
  private clamAt(view: ViewTransform, castle: Castle): { x: number; y: number; w: number } {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    return {
      x: tileX(view, castle.x + castle.w / 2) + W * 0.27,
      y: tileY(view, castle.y + castle.h) - W * 0.1,
      w: W * 0.48,
    };
  }

  /** A castle as a shell palace: the conch standing on its end, a little left of middle. */
  private drawPalace(g: Graphics, view: ViewTransform, castle: Castle): void {
    const owner = castle.islandId - 1;
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    drawConch(
      g,
      tileX(view, castle.x + castle.w / 2) - W * 0.14,
      tileY(view, castle.y + castle.h) - t * 0.06,
      W * 0.92,
      this.colour(owner, 'base'),
      this.colour(owner, 'dark'),
      this.dark,
    );
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    if (!this.land(x, y) && debris.length === 0) {
      this.splashes.push({ x, y, age: 0, owner: -1 });
      return;
    }
    if (debris.length === 0) {
      this.dimples.push({ x, y, round: this.round });
      this.silts.push({ x, y, age: 0, owner: -1 });
      return;
    }
    for (const block of debris) {
      const colour =
        block.owner < 0 ? hex(this.art.palette.rockLight) : this.colour(block.owner, 'base');
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8;
        const v = 1.2 + Math.random() * 1.6;
        this.chips.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          floor: block.y + 0.8 + Math.random() * 0.5,
          colour: k < 5 ? colour : hex(this.art.palette.rockMid),
          angle: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 6,
        });
      }
      // The little fish that lived in it, darting off every way.
      for (let k = 0; k < 5; k++) {
        this.darts.push({
          x: block.x + 0.5,
          y: block.y + 0.4,
          angle: (k / 5) * Math.PI * 2 + Math.random() * 0.8,
          speed: 3 + Math.random() * 2,
          age: 0,
        });
      }
    }
  }

  /** The sweep: a lump left standing alone crumbles to sand. */
  noteCrumble(block: Debris): void {
    this.crumbles.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    this.settling.push({ cells, age: 0 });
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    perf.begin('flow');
    this.slideCaustics(view);
    this.drawDimples(state, view);
    this.flowGfx.clear();
    if (this.wreck !== null) this.drawWreck(this.flowGfx, view, this.wreck, pressing(state));
    perf.end('flow');
    const g = this.effectGfx;
    g.clear();
    this.lateGfx.clear();
    this.shaftGfx.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, 0xdfeef2, null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.bubbleStamps.begin();
    this.drawClams(state, view, frame);
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.drawPuffers(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawSplashes(view, frame.deltaMs);
    this.bubbleStamps.end();
    this.drawSilts(view, frame.deltaMs);
    this.drawChips(view, frame.deltaMs);
    this.drawDarts(view, frame.deltaMs);
    this.drawCrumbles(view, frame.deltaMs);
    this.drawSettling(view, frame.deltaMs);
    this.drawWeather(view, frame.deltaMs);
    this.drawDeep(state, view, frame.deltaMs);
    this.drawShafts(state, view);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * The clams, open as a flag is raised: while a castle is sealed its clam gapes on a pearl
   * glowing, a bubble rising from it now and then; a breach shuts it — so "sealed" is the
   * pearl showing. A clam of a player who is out stays shut, its rim grey.
   */
  private drawClams(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const still = motionReduced();
    const where = viewKey(view);
    this.pearls.update(frame.castleSealed, this.clock, this.art);
    this.clamMemos.begin();
    for (const castle of state.castles) {
      const owner = state.players[castle.islandId - 1];
      const out = owner === undefined || owner.eliminated;
      // In twentieths, so a clam at rest is never drawn again.
      const open = Math.round((this.pearls.raised(castle.id, this.clock, this.art) ?? 0) * 20) / 20;
      const c = this.clamAt(view, castle);
      const rim = out ? hex(this.art.palette.rockMid) : this.colour(castle.islandId - 1, 'base');
      const glow = this.pearls.lowering(castle.id) ? open * 0.5 : open;
      this.clamMemos.draw(castle.id, `${where}|${open}|${glow}|${rim}`, (g) =>
        drawClam(g, c.x, c.y, c.w, open, rim, this.dark, glow),
      );
      if (still || open < 0.9) continue;
      const p = ((this.clock + castle.id * 977) % 2600) / 1300;
      if (p < 1) {
        this.bubble(
          view,
          c.x + Math.sin(p * 8 + castle.id) * c.w * 0.1,
          c.y - c.w * (0.4 + 1.6 * p),
          c.w * (0.06 + 0.05 * p),
          1 - p * 0.7,
        );
      }
    }
    this.clamMemos.end();
  }

  /** A bubble, as a stamp: one drawn for the tile size, scaled to `r` and faded. */
  private bubble(view: ViewTransform, x: number, y: number, r: number, alpha: number): void {
    const t = view.tile;
    const bubble = this.book.get('bubble', t, (k) => drawBubble(k, 0, 0, t * 0.2));
    this.bubbleStamps.place(bubble, x, y, { scale: r / (t * 0.2), alpha: Math.max(0, alpha) });
  }

  /**
   * The pufferfish, turned to their target: swimming in place, bobbing; puffing up round,
   * every spine out, as an urchin leaves, and spitting a few bubbles after it; a silenced one
   * deflated, limp and turned aside, a slow bubble rising from it.
   */
  private drawPuffers(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    this.pufferStamps.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const bob = still ? 0 : Math.sin(this.clock / 500 + cannon.id) * t * 0.04;
      const cy = tileY(view, cannon.y + cannon.h / 2) - t * 0.06 + bob;
      const owner = cannon.owner;
      const puff = cannon.active ? Math.max(0, 1 - aim.firedAgo / PUFF_MS) : 0;
      const mood: PufferMood = !cannon.active ? 'limp' : puff > 0.15 ? 'puffed' : 'calm';
      const angle = cannon.active ? aim.angle : aim.angle + 0.7;
      const fish = this.book.get(`puffer|${owner}|${mood}`, t, (k) =>
        drawPuffer(
          k,
          t,
          this.colour(owner, 'base'),
          this.colour(owner, 'dark'),
          this.colour(owner, 'light'),
          this.dark,
          mood,
        ),
      );
      const scale = mood === 'puffed' ? 0.85 + 0.25 * Math.sin(Math.min(1, puff) * Math.PI) : 1;
      this.pufferStamps.place(fish, cx, cy, { rotation: angle, scale });
      if (cannon.active && aim.firedAgo < SPIT_MS) {
        // Bubbles spat after the urchin, out of the mouth along the aim.
        const p = aim.firedAgo / SPIT_MS;
        for (let n = 0; n < 3; n++) {
          const d = t * (0.5 + p * (0.6 + n * 0.3));
          this.bubble(
            view,
            cx + Math.sin(angle) * d + (n - 1) * t * 0.08,
            cy - Math.cos(angle) * d - p * t * 0.3,
            t * (0.07 + 0.03 * n),
            1 - p,
          );
        }
      }
      if (!cannon.active && !still) {
        const p = ((this.clock + cannon.id * 631) % 2500) / 2500;
        this.bubble(
          view,
          cx + Math.sin(p * 7) * t * 0.06,
          cy - t * (0.3 + 0.9 * p),
          t * 0.07,
          1 - p,
        );
      }
    }
    this.pufferStamps.end();
    this.aims.prune(state);
  }

  /** Shots: sea urchins in the owner's colour, spinning, a trail of bubbles behind them. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const at = (shot: Shot, p: number): { gx: number; gy: number; x: number; y: number } => {
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      return { gx, gy, x: gx, y: gy - shotLift(shot, p) * t };
    };
    this.urchinStamps.begin();
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const here = at(shot, p);
      const high = Math.min(1, shotLift(shot, p) / 3);
      g.ellipse(here.gx, here.gy, t * 0.2, t * 0.07);
      g.fill({ color: 0x000000, alpha: 0.25 - 0.1 * high });
      for (let k = 1; k <= 4; k++) {
        const back = at(shot, Math.max(0, p - k * 0.035));
        this.bubble(view, back.x, back.y, t * (0.1 - k * 0.015), 0.8 - k * 0.15);
      }
      const urchin = this.book.get(`urchin|${shot.owner}`, t, (k) =>
        drawUrchin(k, t * 0.17, this.colour(shot.owner, 'base'), this.colour(shot.owner, 'dark')),
      );
      this.urchinStamps.place(urchin, here.x, here.y, {
        rotation: motionReduced() ? 0 : this.clock / 200 + shot.id,
        scale: 1 + 0.25 * high,
      });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    this.urchinStamps.end();
  }

  /** A shot into the deep: a ring spreading, and a column of bubbles rising from it. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      if (k < 0.4) {
        const q = k / 0.4;
        g.ellipse(x, y, t * (0.2 + 0.6 * q), t * (0.12 + 0.36 * q));
        g.stroke({ width: Math.max(1, t * 0.06), color: 0xdff6ff, alpha: 0.7 * (1 - q) });
      }
      for (let n = 0; n < 6; n++) {
        const start = n * 0.08;
        if (k < start) continue;
        const q = (k - start) / (1 - start);
        const bx = x + Math.sin(q * 8 + n * 2) * t * 0.12 + (n - 2.5) * t * 0.05;
        this.bubble(view, bx, y - q * t * 1.6, t * (0.06 + 0.05 * (n % 3)), 1 - q);
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /** A shot on the sand: a cloud of silt billowing up and settling. */
  private drawSilts(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const colour = hex(this.art.palette.craterMid);
    for (const s of this.silts) {
      s.age += deltaMs;
      const k = s.age / SILT_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + s.x;
        const d = t * (0.15 + 0.45 * Math.sqrt(k));
        g.circle(
          x + Math.cos(a) * d,
          y + Math.sin(a) * d * 0.6 - k * t * 0.3,
          t * (0.2 + 0.25 * k),
        );
      }
      g.fill({ color: colour, alpha: 0.45 * (1 - k) });
    }
    this.silts = this.silts.filter((s) => s.age < SILT_MS);
  }

  /** Coral knocked off a wall, sinking slowly through the water and settling. */
  private drawChips(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    const life = this.art.generators.fx.debrisMs * 1.6;
    for (const c of this.chips) {
      c.age += deltaMs;
      // Water holds them back: they slow fast and sink rather than fall.
      const drag = Math.exp(-3 * dt);
      c.vx *= drag;
      c.vy = c.vy * drag + 2.5 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.spin * dt;
      if (c.y > c.floor && c.vy > 0) {
        c.y = c.floor;
        c.vy = 0;
        c.vx = 0;
        c.spin = 0;
      }
      const alpha = Math.max(0, 1 - c.age / life);
      const x = tileX(view, c.x);
      const y = tileY(view, c.y);
      const r = t * 0.1;
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);
      g.poly([
        x + cos * r,
        y + sin * r,
        x - sin * r * 0.8,
        y + cos * r * 0.8,
        x - cos * r * 0.9,
        y - sin * r * 0.9,
        x + sin * r * 0.6,
        y - cos * r * 0.6,
      ]);
      g.fill({ color: c.colour, alpha });
    }
    this.chips = this.chips.filter((c) => c.age < life);
  }

  /** The fish of a hit wall darting away, scattering and fading. */
  private drawDarts(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const d of this.darts) {
      d.age += deltaMs;
      d.speed *= Math.exp(-1.5 * dt);
      d.x += Math.cos(d.angle) * d.speed * dt;
      d.y += Math.sin(d.angle) * d.speed * dt;
      const alpha = Math.max(0, 1 - d.age / DART_MS);
      drawFish(g, tileX(view, d.x), tileY(view, d.y), t * 0.36, d.angle, SILVER, alpha, this.dark);
    }
    this.darts = this.darts.filter((d) => d.age < DART_MS);
  }

  /** A swept lump crumbling to sand: grains pouring down and spreading where it stood. */
  private drawCrumbles(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const sand = hex(this.art.palette.sand);
    for (const c of this.crumbles) {
      c.age += deltaMs;
      const k = c.age / CRUMBLE_MS;
      if (k >= 1) continue;
      const colour = c.owner < 0 ? hex(this.art.palette.rockLight) : this.colour(c.owner, 'base');
      const shrink = (1 - k) * t * 0.7;
      g.roundRect(
        tileX(view, c.x + 0.5) - shrink / 2,
        tileY(view, c.y + 0.5) - shrink / 2 + k * t * 0.2,
        shrink,
        shrink,
        shrink * 0.3,
      );
      g.fill({ color: colour, alpha: 1 - k });
      for (let n = 0; n < 8; n++) {
        const u = c.x + 0.15 + 0.7 * hash(c.x + n, c.y, 930);
        const fall = k * (0.4 + 0.4 * hash(c.x, c.y + n, 931));
        g.circle(tileX(view, u + (u - c.x - 0.5) * k), tileY(view, c.y + 0.4 + fall), t * 0.05);
      }
      g.fill({ color: sand, alpha: 0.9 * (1 - k) });
    }
    this.crumbles = this.crumbles.filter((c) => c.age < CRUMBLE_MS);
  }

  /** A piece set down settles into the seabed with a puff of sand round it. */
  private drawSettling(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.settling) {
      s.age += deltaMs;
      const k = s.age / SETTLE_MS;
      if (k >= 1) continue;
      for (const { x, y } of s.cells) {
        for (let n = 0; n < 2; n++) {
          const a = hash(x, y * 2 + n, 940) * Math.PI * 2;
          const d = t * (0.35 + 0.4 * k);
          g.circle(
            tileX(view, x + 0.5) + Math.cos(a) * d,
            tileY(view, y + 0.6) + Math.sin(a) * d * 0.5,
            t * (0.1 + 0.12 * k),
          );
        }
      }
      g.fill({ color: hex(this.art.palette.sand), alpha: 0.6 * (1 - k) });
    }
    this.settling = this.settling.filter((s) => s.age < SETTLE_MS);
  }

  /**
   * Marine snow, always, drifting down slowly; thicker in a match whose weather is snow. Rain
   * is the surface far above pocked by it, rings spreading faintly over everything, and fog a
   * bloom of plankton greening the water.
   */
  private drawWeather(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.snowStamps.begin();
    this.bloom.begin(t);
    const count = this.weather === 'snow' ? this.style.snowCount : this.style.marineSnow;
    if (!still) {
      while (this.specks.length < count) {
        this.specks.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          speed: 0.15 + Math.random() * 0.3,
          phase: Math.random() * Math.PI * 2,
        });
      }
      if (this.specks.length > count) this.specks.length = count;
      const speck = this.book.get('speck', t, (k) => {
        k.circle(0, 0, Math.max(1, t * 0.06));
        k.fill({ color: 0xffffff });
      });
      const dt = deltaMs / 1000;
      for (const s of this.specks) {
        s.y += s.speed * dt;
        s.x += Math.sin(this.clock / 1500 + s.phase) * 0.15 * dt;
        if (s.y > rows) {
          s.y -= rows;
          s.x = Math.random() * cols;
        }
        this.snowStamps.place(speck, s.x * t, view.top + s.y * t, {
          alpha: 0.35 + 0.25 * Math.sin(s.phase),
          scale: 0.7 + 0.5 * ((s.phase * 7) % 1),
        });
      }
    }
    if (this.weather === 'rain' && !still) {
      const g = this.lateGfx;
      while (this.rings.length < this.style.rainCount) {
        this.rings.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          age: -Math.random() * RING_MS * 2,
        });
      }
      for (const r of this.rings) {
        r.age += deltaMs;
        const k = r.age / RING_MS;
        // A long frame can carry one past its end before it is dropped below.
        if (k < 0 || k >= 1) continue;
        g.ellipse(r.x * t, view.top + r.y * t, t * (0.15 + 0.7 * k), t * (0.1 + 0.4 * k));
        g.stroke({ width: Math.max(1, t * 0.05), color: 0xe8fbff, alpha: 0.08 * (1 - k) });
      }
      this.rings = this.rings.filter((r) => r.age < RING_MS);
    }
    if (this.weather === 'fog') {
      const { bloomBanks, bloomAlpha } = this.style;
      for (let n = 0; n < bloomBanks; n++) {
        const drift = still ? 0 : this.clock / 70000;
        const fx = (((hash(n, this.seed, 950) + drift * (0.5 + hash(n, 1, 951))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 952);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.4],
          [2.6, 0.5, 2.5],
          [-2.4, 0.6, 2.3],
        ] as const) {
          // Discs one inside another, so the edge of a puff fades rather than ends.
          for (const f of [1, 0.75, 0.5]) {
            this.bloom.disc(x + dx * t, y + dy * t, r * t * f, 0x7fb08a, bloomAlpha / 3);
          }
        }
      }
    }
    this.snowStamps.end();
    this.bloom.end();
  }

  /**
   * The deep coming up — overtime and the final round: the water darkening toward the
   * screen's edges, anglerfish lures glowing and bobbing there in the dark, and now and then
   * the shadow of a whale passing over the whole board.
   */
  private drawDeep(state: MatchState, view: ViewTransform, deltaMs: number): void {
    if (!this.deep(state)) {
      this.whale = null;
      this.sinceWhale = 0;
      return;
    }
    const g = this.lateGfx;
    const t = view.tile;
    const still = motionReduced();
    const top = view.top;
    const W = view.width;
    const H = view.height - top;
    for (let k = 0; k < 7; k++) {
      const d = t * 0.5 * k;
      const band = t * 0.5;
      g.rect(d, top + d, band, H - 2 * d);
      g.rect(W - d - band, top + d, band, H - 2 * d);
      g.rect(d + band, top + d, W - 2 * d - 2 * band, band);
      g.rect(d + band, top + H - d - band, W - 2 * d - 2 * band, band);
      g.fill({ color: 0x020a12, alpha: 0.12 });
    }
    // The lures, each on its stalk over a fish barely seen in the dark.
    const lures = this.style.lures;
    for (let n = 0; n < lures; n++) {
      const side = n % 2 === 0 ? 1 : -1;
      const along = (Math.floor(n / 2) + 0.5) / Math.ceil(lures / 2);
      const bob = still ? 0 : Math.sin(this.clock / 700 + n * 1.7) * t * 0.25;
      const x = side === 1 ? t * 1.6 : W - t * 1.6;
      const y = top + H * (0.15 + 0.7 * along) + bob;
      // The fish under it, lit faintly from above: a gaping jaw, a few teeth.
      const fx = x - side * t * 0.9;
      const fy = y + t * 0.9;
      g.ellipse(fx, fy, t * 1, t * 0.6);
      g.fill({ color: 0x0a1a24, alpha: 0.85 });
      for (let k = 0; k < 3; k++) {
        const tx = fx + side * t * (0.55 + 0.12 * k);
        g.poly([tx - t * 0.04, fy - t * 0.05, tx + t * 0.04, fy - t * 0.05, tx, fy + t * 0.1]);
      }
      g.fill({ color: 0xdfeef2, alpha: 0.7 });
      g.moveTo(fx + side * t * 0.3, fy - t * 0.5).quadraticCurveTo(
        x - side * t * 0.2,
        y - t * 0.3,
        x,
        y,
      );
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x1a3442 });
      const flicker = still ? 1 : 0.75 + 0.25 * Math.sin(this.clock / 230 + n * 3);
      for (const [r, a] of [
        [0.9, 0.08],
        [0.55, 0.12],
        [0.3, 0.2],
      ] as const) {
        g.circle(x, y, t * r);
        g.fill({ color: 0xbff4ff, alpha: a * flicker });
      }
      g.circle(x, y, t * 0.14);
      g.fill({ color: 0xf4feff, alpha: flicker });
    }
    if (still) return;
    this.sinceWhale += deltaMs;
    if (this.whale === null && this.sinceWhale >= this.style.whaleEveryMs) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.whale = {
        x: dir === 1 ? -t * 8 : W + t * 8,
        y: top + H * (0.25 + 0.5 * Math.random()),
        dir,
      };
      this.sinceWhale = 0;
    }
    const whale = this.whale;
    if (whale === null) return;
    whale.x += whale.dir * this.style.whaleTilesPerSecond * t * (deltaMs / 1000);
    if (whale.x < -t * 10 || whale.x > W + t * 10) {
      this.whale = null;
      return;
    }
    // Its shadow: a long body, the head blunt, flippers out, the flukes beating.
    const d = whale.dir;
    const L = t * 7;
    const at = (u: number, v: number): [number, number] => [whale.x + d * u * L, whale.y + v * L];
    const beat = Math.sin(this.clock / 600) * 0.06;
    g.poly([
      ...at(0.5, 0),
      ...at(0.42, -0.1),
      ...at(0.1, -0.14),
      ...at(-0.3, -0.08),
      ...at(-0.5, beat),
      ...at(-0.3, 0.08),
      ...at(0.1, 0.14),
      ...at(0.42, 0.1),
    ]);
    g.poly([
      ...at(-0.46, beat),
      ...at(-0.62, beat - 0.12),
      ...at(-0.56, beat),
      ...at(-0.62, beat + 0.12),
    ]);
    g.poly([...at(0.2, 0.1), ...at(0.05, 0.3), ...at(0.08, 0.1)]);
    g.poly([...at(0.2, -0.1), ...at(0.05, -0.3), ...at(0.08, -0.1)]);
    g.fill({ color: 0x020a12, alpha: 0.16 });
  }

  /**
   * Shafts of light slanting down from the surface, drifting slowly side to side and
   * breathing; dimmed as the deep comes up, and in rain flickering as the surface is broken.
   */
  private drawShafts(state: MatchState, view: ViewTransform): void {
    const g = this.shaftGfx;
    const t = view.tile;
    const still = motionReduced();
    const top = view.top;
    const H = view.height - top;
    const lean = H * 0.35;
    const dim = this.deep(state) ? 0.4 : 1;
    for (let n = 0; n < this.style.shafts; n++) {
      const sway = still ? 0 : Math.sin(this.clock / 9000 + n * 2.3) * t * 2;
      const x = view.width * ((n + 0.3 + 0.4 * hash(n, this.seed, 960)) / this.style.shafts) + sway;
      const w = t * (1.5 + 2 * hash(n, this.seed, 961));
      const breathe = still ? 1 : 0.7 + 0.3 * Math.sin(this.clock / 2300 + n * 1.9);
      const flicker =
        this.weather === 'rain' && !still && hash(n, Math.floor(this.clock / 120), 962) < 0.15
          ? 0.4
          : 1;
      const alpha = this.style.shaftAlpha * breathe * dim * flicker;
      for (const [grow, share] of [
        [1.6, 0.35],
        [1, 0.65],
      ] as const) {
        const half = (w * grow) / 2;
        g.poly([
          x - half,
          top,
          x + half,
          top,
          x + half * 1.6 + lean,
          top + H,
          x - half * 1.6 + lean,
          top + H,
        ]);
        g.fill({ color: 0xeafcff, alpha: alpha * share });
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
      // The piece in hand outlined in a string of bubbles, wobbling; where it does not fit
      // they have burst, a little star of spray in place of every other one — the
      // difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark),
        alpha: ghost.valid ? 0.35 : 0.4,
      });
      const still = motionReduced();
      const edge = outline(cells, inPiece, view);
      const beads = beadsAlong(edge, t / 3);
      beads.forEach(([x, y], n) => {
        const wob = still ? 0 : Math.sin(now / 260 + n * 1.3) * t * 0.04;
        if (ghost.valid) {
          drawBubble(g, x + wob, y - wob, t * (0.1 + 0.03 * (n % 2)), 0.95);
          return;
        }
        if (n % 2 === 1) return;
        const r = t * 0.13;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          g.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4).lineTo(
            x + Math.cos(a) * r,
            y + Math.sin(a) * r,
          );
        }
      });
      if (!ghost.valid) g.stroke({ width: Math.max(1.5, t * 0.07), color: 0xffffff, alpha: 0.95 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The pufferfish's place, a ring of bubbles' light, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.ellipse(x + w / 2, y + h / 2, w / 2 - t * 0.12, h / 2 - t * 0.12);
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

/** Points every `step` along a set of segments, for beads strung round an outline. */
function beadsAlong(segments: readonly Segment[], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segments) {
    const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.round(length / step));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push([s.x1 + (s.x2 - s.x1) * f, s.y1 + (s.y2 - s.y1) * f]);
    }
  }
  return out;
}

/**
 * Under the sea's scenery, none like coral, a pufferfish or an urchin: a tree is kelp, its
 * fronds rising from a holdfast with a float at every blade; a pine a cluster of tube
 * sponges; a bush a starfish, or a pair of scallop shells; a boulder a rock crusted with
 * barnacles, a pale anemone on a stone, or — one in three — an anchor, or a bottle with a
 * message in it, half in the sand.
 */
function drawUnderseaScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const ink = hex(art.palette.shadow);
  const kelps = [0x6a7a3a, 0x7d7a36, 0x5a6c34];
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // Kelp: fronds rising from a holdfast, waving over to one side, a float on each.
      const colour = kelps[item.variant % kelps.length]!;
      g.ellipse(cx + t * 0.15, cy + t * 0.38, t * 0.3, t * 0.07);
      g.fill({ color: ink, alpha: 0.25 });
      for (let k = 0; k < 3; k++) {
        const fx = cx + (k - 1) * t * 0.12;
        const lean = (k - 1) * t * 0.12 + t * 0.12;
        g.moveTo(fx, cy + t * 0.38);
        g.bezierCurveTo(
          fx - t * 0.15,
          cy + t * 0.05,
          fx + lean + t * 0.12,
          cy - t * 0.15,
          fx + lean,
          cy - t * (0.45 + 0.1 * k),
        );
      }
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour, cap: 'round' });
      for (let k = 0; k < 3; k++) {
        g.circle(cx + (k - 1) * t * 0.14 + t * 0.06, cy - t * (0.05 + 0.12 * k), t * 0.06);
      }
      g.fill({ color: 0x9a9a4a });
      g.circle(cx, cy + t * 0.38, t * 0.09);
      g.fill({ color: 0x4a4a2a });
    } else if (item.kind === 'pine') {
      // Tube sponges: three tubes of different heights, each open at its top.
      g.ellipse(cx + t * 0.08, cy + t * 0.36, t * 0.34, t * 0.08);
      g.fill({ color: ink, alpha: 0.25 });
      for (const [dx, h, w] of [
        [-0.17, 0.55, 0.15],
        [0.02, 0.75, 0.17],
        [0.2, 0.45, 0.14],
      ] as const) {
        g.roundRect(cx + (dx - w / 2) * t, cy + (0.38 - h) * t, w * t, h * t, w * t * 0.4);
      }
      g.fill({ color: 0xb8a888 });
      g.stroke({ width: 1, color: ink, alpha: 0.45 });
      for (const [dx, h, w] of [
        [-0.17, 0.55, 0.15],
        [0.02, 0.75, 0.17],
        [0.2, 0.45, 0.14],
      ] as const) {
        g.ellipse(cx + dx * t, cy + (0.4 - h) * t, w * t * 0.35, t * 0.04);
      }
      g.fill({ color: 0x4a3e30 });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        // A starfish lying on the sand, its arms a little curled.
        const turn = item.variant * 0.7;
        const points: number[] = [];
        for (let k = 0; k < 10; k++) {
          const a = turn + (k / 10) * Math.PI * 2 - Math.PI / 2;
          const r = t * (k % 2 === 0 ? 0.36 : 0.14);
          points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.poly(points);
        g.fill({ color: 0xd4a88a });
        g.stroke({ width: 1, color: 0x8a5a44, alpha: 0.7, join: 'round' });
        for (let k = 0; k < 5; k++) {
          const a = turn + (k / 5) * Math.PI * 2 - Math.PI / 2;
          g.circle(cx + Math.cos(a) * t * 0.18, cy + Math.sin(a) * t * 0.18, t * 0.03);
        }
        g.fill({ color: 0xf6e8d8 });
      } else {
        // Two scallop shells, fluted, one tipped over the other.
        for (const [dx, dy, r] of [
          [-0.12, 0.08, 0.2],
          [0.14, -0.02, 0.17],
        ] as const) {
          const x = cx + dx * t;
          const y = cy + dy * t;
          g.moveTo(x, y + r * t * 0.6);
          g.arc(x, y, r * t, Math.PI * 1.1, Math.PI * 1.9);
          g.closePath();
          g.fill({ color: SHELL });
          g.stroke({ width: 1, color: 0xa08068, alpha: 0.8 });
          for (let k = 0; k < 4; k++) {
            const a = Math.PI * (1.2 + 0.18 * k);
            g.moveTo(x, y + r * t * 0.6).lineTo(x + Math.cos(a) * r * t, y + Math.sin(a) * r * t);
          }
          g.stroke({ width: 1, color: 0xc9a98e, alpha: 0.9 });
        }
      }
    } else if (item.variant % 3 === 0) {
      if (Math.floor(item.variant / 3) % 2 === 0) {
        // An anchor, lying on its side half in the sand, a ring at its head.
        g.moveTo(cx - t * 0.32, cy).lineTo(cx + t * 0.25, cy);
        g.moveTo(cx - t * 0.12, cy - t * 0.12).lineTo(cx - t * 0.12, cy + t * 0.12);
        g.stroke({ width: Math.max(1.5, t * 0.08), color: 0x5a5e62, cap: 'round' });
        g.moveTo(cx + t * 0.25, cy - t * 0.28);
        g.quadraticCurveTo(cx + t * 0.42, cy, cx + t * 0.25, cy + t * 0.28);
        g.stroke({ width: Math.max(1.5, t * 0.08), color: 0x5a5e62, cap: 'round' });
        g.circle(cx - t * 0.38, cy, t * 0.07);
        g.stroke({ width: Math.max(1, t * 0.05), color: 0x5a5e62 });
        g.ellipse(cx + t * 0.05, cy + t * 0.14, t * 0.32, t * 0.07);
        g.fill({ color: hex(art.palette.grassMid), alpha: 0.9 });
      } else {
        // A bottle half in the sand, a message rolled up inside.
        const a = -0.5;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const at = (u: number, v: number): [number, number] => [
          cx + (c * u - s * v) * t,
          cy + (s * u + c * v) * t,
        ];
        g.poly([
          ...at(-0.3, -0.12),
          ...at(0.12, -0.12),
          ...at(0.3, -0.05),
          ...at(0.3, 0.05),
          ...at(0.12, 0.12),
          ...at(-0.3, 0.12),
        ]);
        g.fill({ color: 0x8fb8a8, alpha: 0.75 });
        g.stroke({ width: 1, color: 0x3a5a50, alpha: 0.8 });
        g.poly([...at(-0.2, -0.05), ...at(0.05, -0.05), ...at(0.05, 0.05), ...at(-0.2, 0.05)]);
        g.fill({ color: 0xf0e2bc });
        g.poly([...at(0.3, -0.04), ...at(0.38, -0.04), ...at(0.38, 0.04), ...at(0.3, 0.04)]);
        g.fill({ color: 0x8a6a48 });
      }
    } else if (item.variant % 3 === 1) {
      // A rock crusted with barnacles.
      g.ellipse(cx + t * 0.05, cy + t * 0.3, t * 0.36, t * 0.08);
      g.fill({ color: ink, alpha: 0.25 });
      g.poly([
        cx - t * 0.34,
        cy + t * 0.28,
        cx - t * 0.26,
        cy - t * 0.08,
        cx + t * 0.02,
        cy - t * 0.24,
        cx + t * 0.3,
        cy - t * 0.06,
        cx + t * 0.34,
        cy + t * 0.28,
      ]);
      g.fill({ color: hex(art.palette.rockMid) });
      g.stroke({ width: 1, color: ink, alpha: 0.5, join: 'round' });
      for (const [dx, dy] of [
        [-0.15, 0.05],
        [0.05, -0.08],
        [0.18, 0.1],
        [-0.05, 0.15],
      ] as const) {
        g.circle(cx + dx * t, cy + dy * t, t * 0.05);
      }
      g.fill({ color: 0xe8ece8 });
    } else {
      // A pale anemone on a stone, its tentacles out.
      g.ellipse(cx, cy + t * 0.2, t * 0.3, t * 0.14);
      g.fill({ color: hex(art.palette.rockMid) });
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (1.05 + (k / 8) * 0.9);
        g.moveTo(cx, cy + t * 0.05).lineTo(
          cx + Math.cos(a) * t * 0.3,
          cy + t * 0.05 + Math.sin(a) * t * 0.3,
        );
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: 0xf0eadf, cap: 'round' });
      g.ellipse(cx, cy + t * 0.06, t * 0.12, t * 0.05);
      g.fill({ color: 0xe0d0c0 });
    }
  }
}
