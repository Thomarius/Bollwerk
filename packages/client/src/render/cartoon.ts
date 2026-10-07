import type { ArtConfig, CartoonStyleConfig } from '@bollwerk/config';
import { Structure, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics, Sprite, Texture } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { climax, cornerSpot, pressing } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { behindCorner } from './ocean.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { CartoonSeaLife } from './seaLife.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  Fireworks,
  GhostMotion,
  GunAims,
  Landings,
  RuinSmoke,
  WinnerBanners,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawChoices,
  drawDrain,
  drawFireReticle,
  drawMainCastles,
  drawOvertimeBorder,
  drawSealGlow,
  drawSealPreview,
  drawSelectable,
  drawShotTarget,
  hex,
  shotLift,
  shotProgress,
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
import { INK, PAPER, drawCloud, drawGlove, drawPieEye, drawStar, inkWidth } from './toon.js';
import { outline, trace, wallGeometry } from './walls.js';
import { ShapeTheme } from './shapeTheme.js';

/** Something with a place and an age: a burst, a splash, a puff. */
interface Aged {
  x: number;
  y: number;
  age: number;
}

/** A puff of cloud, in tiles: dust from a hit or a landing, smoke from a muzzle. */
interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  tint: number;
}

/** Something thrown and tumbling, in tiles: a brick from a hit wall, a star seen. */
interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  owner: number;
}

/** A note rising from a dancing castle, in tiles. */
interface Note {
  x: number;
  y: number;
  age: number;
  kind: number;
}

/** Where a shot came down on the ground: a crater, fading over the rounds. */
interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A raindrop or a snowflake falling, in tiles on screen. */
interface Drop {
  x: number;
  y: number;
  speed: number;
}

/** A scratch running down the film, in screen pixels. */
interface Scratch {
  x: number;
  age: number;
  life: number;
}

/** How a castle feels: dancing while sealed, worried while not, panicking as it is breached. */
type Mood = 'happy' | 'blink' | 'worried' | 'panic' | 'out';
/** How a gun feels: awake and bouncing, firing, blinking, or asleep while silenced. */
type GunMood = 'awake' | 'blink' | 'fire' | 'asleep';

const FIRE_MS = 320;
const BURST_MS = 200;
const SPLASH_MS = 700;
const NOTE_MS = 1800;
const DIZZY_MS = 1100;
/** How long a breached castle panics: the hoist's lowering, 550 ms, was over before it read. */
const PANIC_MS = 2400;
/** How a castle's dance turns: its arms swap every beat. */
const DANCE_SWAY = 0.06;
/** A gun's barrel raised, and drooping while it sleeps, in radians. */
const ELEVATION = 0.6;
const DROOP = -0.12;
/** Where a gun's barrel turns, and how far out its muzzle is from there, in tiles. */
const PIVOT = { x: -0.15, y: -0.5 };
const MUZZLE = 0.78;

const GREY = 0x9a9a9a;
const LIGHT_GREY = 0xd8d8d8;
const SMOKE = 0xbdbdbd;

/** How Cartoon sends off the winners: stars in their colours, and a glove for the flag. */
const FINISH: FinishLook = { spark: 'stars', flag: 'glove' };

/**
 * The Cartoon look, for either look: a 1930s rubber-hose cartoon reel, black ink on paper
 * white under film grain, a flicker and a vignette — and the only colour on the board a
 * player's, flat paint inside the ink, so whatever has colour is someone's. The sea is grey
 * with white wave crests bobbing; the land white, inked round, its shadow on the sea. Walls
 * are cartoon bricks in the owner's colour, each with its shine; sealed ground is a checkered
 * dance floor. Castles live: sealed, one grins and dances, its arms swapping on the beat, a
 * note rising now and then; unsealed it frets; breached it panics, eyes wide and sweating; a
 * player who is out has theirs grey, X-eyed, stars circling. Guns are cannons with faces,
 * bouncing on their wheels, squashing as they fire a black bomb with a fuse sparking in the
 * owner's colour; a silenced one sleeps, its barrel drooping, Zs rising. A hit is a burst,
 * bricks flying, dust and stars. An alarm clock on legs dances in the corner, ringing at the
 * climax. Everything moves on one beat, and in steps — "on twos", as the cartoons did.
 */
export class CartoonTheme extends ShapeTheme implements Theme {
  readonly id = 'cartoon' as const;

  private style!: CartoonStyleConfig;
  private weather: Weather = 'clear';
  private readonly seaLife = new CartoonSeaLife();

  private readonly terrainGfx = new Graphics();
  /** Wave crests on the sea, bobbing on the beat. */
  private readonly waveStamps = new Stamps();
  private waves: (Cell & { up: boolean })[] = [];
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  /** The alarm clock in the corner, redrawn at each step of its dance. */
  private readonly clockMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => {
      this.standing = [...items];
      this.standingStep = -2;
      drawCartoonScenery(g, view, items);
    },
    () => 0x6a6a6a,
  );
  /** Bricks and the guns' bases, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  /** On the ground, under the figures: the seal's flood, smoke, shadows. */
  private readonly underGfx = new Graphics();
  private readonly castleStamps = new Stamps();
  private readonly cannonStamps = new Stamps();
  /** Over the figures: the crown, where a shot will land. */
  private readonly effectGfx = new Graphics();
  private readonly bombStamps = new Stamps();
  /** Puffs, bricks, stars, bursts, notes and Zs. */
  private readonly puffStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  private readonly dropStamps = new Stamps();
  private readonly fog = new Discs();
  /** The film: its vignette, drawn when the window changes, its grain, flicker and scratches. */
  private readonly vignette = new Sprite();
  private vignetteDrawn = '';
  private readonly grainStamps = new Stamps();
  private readonly filmGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  private clock = 0;
  /** Beats gone by, and as last shown: it moves on only at each step of the film. */
  private beats = 0;
  private shownBeats = 0;
  private step = -1;
  private wavesStep = -2;
  /** The scenery standing, as it was last drawn, and the step it was last swayed at. */
  private standing: SceneryItem[] = [];
  private standingStep = -2;
  private readonly standingStamps = new Stamps();
  private grainStep = -2;
  private round = 0;
  private corner: TimerSpot | null = null;
  private craters: Crater[] = [];
  private bursts: Aged[] = [];
  private splashes: Aged[] = [];
  private puffs: Puff[] = [];
  private thrown: Thrown[] = [];
  private dizzy: Aged[] = [];
  private notes: Note[] = [];
  private untilNote = new Map<number, number>();
  /** Whether each castle was sealed last frame, and until when a breached one panics. */
  private wasSealed = new Map<number, boolean>();
  private panicUntil = new Map<number, number>();
  private drops: Drop[] = [];
  private scratches: Scratch[] = [];
  private untilScratch = -1;

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.cartoon;
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    layers.terrain.addChild(
      this.terrainGfx,
      this.waveStamps.container,
      this.craterGfx,
      this.clockMemos.container,
    );
    layers.territory.addChild(
      this.scenery.gfx,
      this.standingStamps.container,
      this.territory.container,
    );
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.castleStamps.container,
      this.cannonStamps.container,
      this.effectGfx,
      this.bombStamps.container,
      this.puffStamps.container,
      this.lateGfx,
      this.dropStamps.container,
      this.fog.container,
      this.vignette,
      this.grainStamps.container,
      this.filmGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.clockMemos.destroy();
    for (const s of [
      this.waveStamps,
      this.standingStamps,
      this.castleStamps,
      this.cannonStamps,
      this.bombStamps,
      this.puffStamps,
      this.dropStamps,
      this.grainStamps,
    ]) {
      s.destroy();
    }
    this.fog.destroy();
    this.book.destroy();
    if (this.vignette.texture !== Texture.EMPTY) this.vignette.texture.destroy(true);
    this.vignette.destroy();
    for (const g of [
      this.terrainGfx,
      this.craterGfx,
      this.underGfx,
      this.effectGfx,
      this.lateGfx,
      this.filmGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  // ------------------------------------------------------------------ the beat

  /**
   * Where the dance is: how high a figure hops, 0 on the beat and 1 between; how squashed
   * it lands, 1 on the beat and gone a fifth of the way on; and which way it leans, swapping
   * every beat. `offset` in beats. Nothing moves with motion reduced.
   */
  private pose(offset = 0): { hop: number; squash: number; side: 1 | -1 } {
    if (motionReduced()) return { hop: 0, squash: 0, side: 1 };
    const b = this.shownBeats + offset;
    const phase = ((b % 1) + 1) % 1;
    return {
      hop: Math.sin(phase * Math.PI),
      squash: phase < 0.2 ? 1 - phase / 0.2 : 0,
      side: Math.floor(b) % 2 === 0 ? 1 : -1,
    };
  }

  /** Moves the clock and the beat on; what is shown moves on only at each step of the film. */
  private advance(state: MatchState, deltaMs: number): void {
    this.clock += deltaMs;
    const beat = pressing(state) ? this.style.hurriedBeatMs : this.style.beatMs;
    this.beats += deltaMs / beat;
    const step = Math.floor(this.clock / (1000 / this.style.framesPerSecond));
    if (step !== this.step) {
      this.step = step;
      this.shownBeats = this.beats;
    }
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

    // The sea, grey out to the window's edge, a lighter band along the coast.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    g.fill({ color: hex(palette.waterMid) });
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    for (let y = -1; y < state.height + 1; y++) {
      for (let x = -1; x < state.width + 1; x++) {
        if (land(x, y) || !near(x, y, 1)) continue;
        g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.85);
      }
    }
    g.fill({ color: hex(palette.waterShallow) });

    // The land: its shadow cast on the sea, then paper white, a tuft of grass here and there.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x + 0.14), tileY(view, y + 0.2), t, t);
    g.fill({ color: INK, alpha: 0.3 });
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 2001) > 0.09) continue;
      const sx = tileX(view, x + 0.3 + hash(x, y, 2002) * 0.4);
      const sy = tileY(view, y + 0.6 + hash(x, y, 2003) * 0.3);
      g.moveTo(sx - t * 0.14, sy - t * 0.12).lineTo(sx - t * 0.07, sy);
      g.moveTo(sx, sy - t * 0.18).lineTo(sx, sy);
      g.moveTo(sx + t * 0.14, sy - t * 0.12).lineTo(sx + t * 0.07, sy);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: 0x7a7a7a, cap: 'round' });
    for (const { x, y } of ground) {
      if (hash(x, y, 2004) > 0.04) continue;
      g.ellipse(
        tileX(view, x + 0.3 + hash(x, y, 2005) * 0.4),
        tileY(view, y + 0.5),
        t * 0.1,
        t * 0.06,
      );
    }
    g.stroke({ width: Math.max(1, t * 0.04), color: 0x7a7a7a });
    // The coast inked round, thick, as everything is.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: inkWidth(t), color: INK, cap: 'round', join: 'round' });

    // The clock's place, in the corner the compass rose takes in Parchment.
    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);

    // Wave crests on open sea, clear of the coast and the clock.
    this.waves = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (hash(x, y, 2010) > 0.06 || near(x, y, 1)) continue;
        if (behindCorner(this.corner, x + 0.5, y + 0.5)) continue;
        this.waves.push({ x, y, up: hash(x, y, 2011) < 0.5 });
      }
    }
    this.wavesStep = -2;
    this.cratersDrawn = '';
  }

  /** The wave crests, bobbing on the beat, half of them up as the other half go down. */
  private drawWaves(view: ViewTransform): void {
    if (this.step === this.wavesStep) return;
    this.wavesStep = this.step;
    const t = view.tile;
    const crest = this.book.get('wave', t, (k) => {
      k.moveTo(-t * 0.34, t * 0.04)
        .quadraticCurveTo(-t * 0.17, -t * 0.14, 0, t * 0.02)
        .quadraticCurveTo(t * 0.12, -t * 0.12, t * 0.2, -t * 0.04)
        .quadraticCurveTo(t * 0.12, -t * 0.02, t * 0.14, t * 0.04);
      k.stroke({ width: Math.max(1, t * 0.07), color: PAPER, cap: 'round', join: 'round' });
    });
    const { hop } = this.pose();
    this.waveStamps.begin();
    for (const w of this.waves) {
      const lift = (w.up ? hop : 1 - hop) * t * 0.07;
      this.waveStamps.place(crest, tileX(view, w.x + 0.5), tileY(view, w.y + 0.5) - lift);
    }
    this.waveStamps.end();
  }

  /**
   * Everything standing on the land, moving on the beat from its foot, neighbours a little out
   * of step, as a cartoon's chorus line: trees lean one way and then the other as the castles'
   * arms swap, their canopies squashing as they land; daisies and grass sway further, light on
   * their stems; toadstools and haystacks bounce, squashing; rocks only breathe. Stamps, placed
   * again only at each step of the film.
   */
  private drawStanding(view: ViewTransform): void {
    if (this.step === this.standingStep) return;
    this.standingStep = this.step;
    const t = view.tile;
    const still = motionReduced();
    this.standingStamps.begin();
    for (const item of this.standing) {
      const look = sceneryLook(item);
      const figure = this.book.get(`scenery|${look}`, t, (k) => drawSceneryFigure(k, t, look));
      const { hop, squash, side } = this.pose(((item.x + item.y) % 2) * 0.12);
      const { lean, give } = SWAY[look];
      this.standingStamps.place(
        figure,
        tileX(view, item.x + 0.5),
        tileY(view, item.y + 0.5) + FOOT[look] * t,
        still
          ? {}
          : {
              rotation: side * lean * (0.3 + 0.7 * hop),
              scale: 1 + give * squash,
              scaleY: 1 - give * 1.2 * squash + give * 0.5 * hop,
            },
      );
    }
    this.standingStamps.end();
  }

  /** Craters where shots came down on the ground, drawn again only when one comes or fades. */
  private drawCraters(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => state.round - c.round < rounds);
    const key = `${state.round}|${this.craters.length}|${viewKey(view)}`;
    if (key === this.cratersDrawn) return;
    this.cratersDrawn = key;
    const g = this.craterGfx;
    g.clear();
    const t = view.tile;
    for (const c of this.craters) {
      const fade = 1 - (state.round - c.round) / rounds;
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.55);
      // A hole, its rim thrown up in a jagged ring.
      const rim: number[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const d = k % 2 === 0 ? 0.42 : 0.3;
        rim.push(x + Math.cos(a) * t * d, y + Math.sin(a) * t * d * 0.6);
      }
      g.poly(rim);
      g.fill({ color: 0x5a5a5a, alpha: 0.6 * fade });
      g.ellipse(x, y, t * 0.22, t * 0.13);
      g.fill({ color: INK, alpha: 0.85 * fade });
    }
  }

  // ------------------------------------------------------------------ the clock

  /**
   * The alarm clock on legs in the corner: a round white body on two bells, a face on its
   * dial, hose arms and legs in white gloves and big shoes, dancing on the beat. At the
   * climax — overtime and the final round — it rings wildly, its hammer hammering, the
   * bells shaking, its mouth wide.
   */
  private drawClock(state: MatchState, view: ViewTransform): void {
    this.clockMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const ringing = climax(state) && !motionReduced();
      const key = `${viewKey(view)}|${this.step}|${ringing}`;
      this.clockMemos.draw('clock', key, (g) => this.drawClockFigure(g, view, spot, ringing));
    }
    this.clockMemos.end();
  }

  private drawClockFigure(g: Graphics, view: ViewTransform, spot: TimerSpot, ring: boolean): void {
    const t = view.tile;
    const s = spot.size * t;
    const { hop, squash, side } = this.pose();
    const shake = ring ? (this.step % 2 === 0 ? 1 : -1) * s * 0.02 : 0;
    const cx = tileX(view, spot.x) + shake;
    const ground = tileY(view, spot.y) + s * 0.44;
    const r = s * 0.24 * (1 + 0.05 * squash);
    const cy = ground - s * 0.3 - r - hop * s * 0.06;
    const ink = Math.max(1.5, s * 0.03);
    // Its shadow on the water.
    g.ellipse(cx, ground, s * 0.3, s * 0.05);
    g.fill({ color: INK, alpha: 0.25 });
    // Legs, one kicked up as the other stands, and shoes.
    for (const leg of [-1, 1] as const) {
      const up = leg === side ? 1 : 0;
      const hipX = cx + leg * r * 0.45;
      const hipY = cy + r * 0.85;
      const footX = cx + leg * s * (0.16 + 0.08 * up);
      const footY = ground - s * 0.03 - up * hop * s * 0.12;
      g.moveTo(hipX, hipY).quadraticCurveTo(hipX + leg * s * 0.1, (hipY + footY) / 2, footX, footY);
      g.stroke({ width: Math.max(2, s * 0.045), color: INK, cap: 'round' });
      g.ellipse(footX + leg * s * 0.05, footY, s * 0.09, s * 0.05);
      g.fill({ color: INK });
      g.ellipse(footX + leg * s * 0.07, footY - s * 0.015, s * 0.03, s * 0.012);
      g.fill({ color: PAPER, alpha: 0.8 });
    }
    // Arms out, swinging with the beat, white gloves on them.
    for (const arm of [-1, 1] as const) {
      const sx = cx + arm * r * 0.92;
      const sy = cy + r * 0.1;
      const lift = arm === side ? -1 : 0.4;
      const hx = sx + arm * s * 0.16;
      const hy = sy + lift * s * 0.12 - (ring ? s * 0.12 : 0);
      g.moveTo(sx, sy).quadraticCurveTo(sx + arm * s * 0.1, sy + s * 0.08, hx, hy);
      g.stroke({ width: Math.max(2, s * 0.04), color: INK, cap: 'round' });
      drawGlove(g, hx, hy, s * 0.06, arm * (Math.PI / 2 + lift * 0.4), 'open');
    }
    // The bells and the hammer between them.
    for (const bell of [-1, 1] as const) {
      const bx = cx + bell * r * 0.62 + (ring ? -shake * bell : 0);
      const by = cy - r * 0.92;
      g.moveTo(bx - s * 0.1, by + s * 0.03).arc(bx, by + s * 0.03, s * 0.1, Math.PI, 0);
      g.closePath();
      g.fill({ color: LIGHT_GREY });
      g.stroke({ width: ink, color: INK, join: 'round' });
      if (ring) {
        // Ringing: three strokes off each bell.
        for (let k = -1; k <= 1; k++) {
          const a = -Math.PI / 2 + bell * (0.7 + k * 0.35);
          g.moveTo(bx + Math.cos(a) * s * 0.14, by + Math.sin(a) * s * 0.14).lineTo(
            bx + Math.cos(a) * s * 0.22,
            by + Math.sin(a) * s * 0.22,
          );
        }
        g.stroke({ width: ink * 0.8, color: INK, cap: 'round' });
      }
    }
    const hammer = ring ? (this.step % 2 === 0 ? 1 : -1) * s * 0.06 : 0;
    g.moveTo(cx, cy - r).lineTo(cx + hammer, cy - r - s * 0.1);
    g.stroke({ width: ink, color: INK, cap: 'round' });
    g.circle(cx + hammer, cy - r - s * 0.1, s * 0.025);
    g.fill({ color: INK });
    // The body and its dial.
    g.circle(cx, cy, r);
    g.fill({ color: PAPER });
    g.stroke({ width: ink * 1.4, color: INK });
    g.circle(cx, cy, r * 0.8);
    g.stroke({ width: ink * 0.6, color: INK });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.circle(cx + Math.cos(a) * r * 0.68, cy + Math.sin(a) * r * 0.68, Math.max(0.8, s * 0.008));
    }
    g.fill({ color: INK });
    // The face on its dial, and the hands for a nose, ticking round a step each beat.
    const eye = r * 0.16;
    drawPieEye(g, cx - r * 0.26, cy - r * 0.22, eye * 0.75, eye * (ring ? 1.4 : 1.15));
    drawPieEye(g, cx + r * 0.26, cy - r * 0.22, eye * 0.75, eye * (ring ? 1.4 : 1.15));
    const tick = Math.floor(this.shownBeats);
    const minute = (tick / 12) * Math.PI * 2;
    g.moveTo(cx, cy).lineTo(cx + Math.sin(minute) * r * 0.5, cy - Math.cos(minute) * r * 0.5);
    g.moveTo(cx, cy).lineTo(
      cx + Math.sin(minute / 12) * r * 0.3,
      cy - Math.cos(minute / 12) * r * 0.3,
    );
    g.stroke({ width: ink, color: INK, cap: 'round' });
    if (ring) {
      g.ellipse(cx, cy + r * 0.42, r * 0.2, r * 0.17);
      g.fill({ color: INK });
    } else {
      g.moveTo(cx - r * 0.3, cy + r * 0.32).quadraticCurveTo(
        cx,
        cy + r * 0.62,
        cx + r * 0.3,
        cy + r * 0.32,
      );
      g.stroke({ width: ink, color: INK, cap: 'round' });
    }
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as a dance floor: the owner's colour and white, checkered, inked round. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawFloor(g, island, view));
  }

  private drawFloor(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      const out = state.players[player]?.eliminated !== false;
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: PAPER });
      for (const { x, y } of cells) {
        if ((x + y) % 2 === 1) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
      }
      g.fill({ color: out ? GREY : this.colour(player, 'base'), alpha: this.style.floorAlpha });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: inkWidth(t) * 0.8, color: INK, cap: 'square' });
    }
    dimEliminated(g, state, view, 0x5a5a5a);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  /** One island's bricks and the guns' bases; the castles and guns are figures, stamped. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      const out = owner === 0 || state.players[owner - 1]?.eliminated !== false;
      this.drawBricks(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, LIGHT_GREY, this.colour(cannon.owner, 'base'), 0.9);
    }
  }

  /**
   * Walls as cartoon bricks in the owner's colour: two courses a block, bonded, the face a
   * shade darker, a white shine on each, all inked round thick. A player's who is out, and
   * rubble, have gone grey. Straight strokes only: a wall is redrawn at every hit.
   */
  private drawBricks(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? LIGHT_GREY : this.colour(player, 'base') });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? GREY : this.colour(player, 'dark') });
    // The mortar: a course line across each top, joints staggered above and below it.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      const mid = b.top + h / 2;
      g.moveTo(b.left, mid).lineTo(b.left + t, mid);
      g.moveTo(b.left + t / 2, b.top).lineTo(b.left + t / 2, mid);
      if ((b.x + b.y) % 2 === 0) g.moveTo(b.left + t * 0.15, mid).lineTo(b.left + t * 0.15, b.lip);
      else g.moveTo(b.left + t * 0.85, mid).lineTo(b.left + t * 0.85, b.lip);
    }
    for (const r of wall.faces) {
      for (const f of [0.33, 0.66]) g.moveTo(r.x + r.w * f, r.y).lineTo(r.x + r.w * f, r.y + r.h);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: INK, alpha: 0.55 });
    // The shine, a corner of white on each brick's upper left.
    for (const b of wall.blocks) {
      const x = b.left + t * 0.12;
      const y = b.top + t * 0.12;
      g.moveTo(x, y + t * 0.16)
        .lineTo(x, y)
        .lineTo(x + t * 0.16, y);
    }
    g.stroke({ width: Math.max(1, t * 0.06), color: PAPER, alpha: dead ? 0.5 : 0.85 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: inkWidth(t), color: INK, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    this.bursts.push({ x, y, age: 0 });
    if (!this.land(x, y) && debris.length === 0) {
      this.splashes.push({ x, y, age: 0 });
      return;
    }
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      this.puff(x + 0.5, y + 0.4, 0.3, 0);
      return;
    }
    for (const block of debris) {
      this.puff(block.x + 0.5, block.y + 0.4, 0.42, 0);
      this.puff(block.x + 0.2, block.y + 0.6, 0.26, -0.5);
      this.puff(block.x + 0.8, block.y + 0.6, 0.26, 0.5);
      for (let k = 0; k < 3; k++) this.throwBrick(block.x + 0.5, block.y + 0.4, block.owner - 1);
      this.dizzy.push({ x: block.x, y: block.y, age: 0 });
    }
  }

  private puff(x: number, y: number, r: number, vx: number, tint = PAPER, life = 650): void {
    this.puffs.push({ x, y, vx, vy: -0.6, r, age: 0, life, tint });
  }

  private throwBrick(x: number, y: number, owner: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const v = 3 + Math.random() * 3;
    this.thrown.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 700,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 14,
      owner,
    });
  }

  /** The sweep: a block left standing alone pops in a puff, a brick tumbling off. */
  noteCrumble(block: Debris): void {
    this.puff(block.x + 0.5, block.y + 0.5, 0.3, 0);
    this.throwBrick(block.x + 0.5, block.y + 0.5, block.owner - 1);
  }

  /** A piece set down lands with a thump: it settles, and dust puffs out from under it. */
  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    const left = Math.min(...cells.map((c) => c.x));
    const right = Math.max(...cells.map((c) => c.x));
    const bottom = Math.max(...cells.map((c) => c.y));
    this.puff(left, bottom + 0.8, 0.2, -0.8, PAPER, 420);
    this.puff(right + 1, bottom + 0.8, 0.2, 0.8, PAPER, 420);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.advance(state, frame.deltaMs);
    const under = this.underGfx;
    under.clear();
    this.effectGfx.clear();
    this.lateGfx.clear();
    perf.begin('flow');
    this.drawCraters(state, view);
    this.drawWaves(view);
    this.drawStanding(view);
    this.drawClock(state, view);
    perf.end('flow');
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x4a4a4a, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.puffStamps.begin();
    this.drawCastles(state, view, frame);
    drawMainCastles(this.effectGfx, view, state, this.art, frame.castleSealed);
    this.drawCannons(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawBursts(view, frame.deltaMs);
    this.drawPuffs(view, frame.deltaMs);
    this.drawThrown(view, frame.deltaMs);
    this.drawDizzy(view, frame.deltaMs);
    this.drawNotes(view, frame.deltaMs);
    this.puffStamps.end();
    this.drawSplashes(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawWeather(view, frame.deltaMs);
    this.drawFilm(view, frame.deltaMs);
  }

  /**
   * The castles, figures stamped from a drawing for each owner and mood: sealed, one dances
   * — hops on the beat, lands squashed, sways, its arms swapping — and a note rises from it
   * now and then; unsealed it frets, breathing; breached it panics, shaking; a player's who
   * is out stands grey and X-eyed, stars circling over it.
   */
  private drawCastles(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.castleStamps.begin();
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const sealed = frame.castleSealed[castle.id] === true;
      const was = this.wasSealed.get(castle.id);
      if (was === true && !sealed) this.panicUntil.set(castle.id, this.clock + PANIC_MS);
      if (sealed) this.panicUntil.delete(castle.id);
      this.wasSealed.set(castle.id, sealed);
      const panic = (this.panicUntil.get(castle.id) ?? 0) > this.clock;
      const blink = !still && (this.step + castle.id * 7) % 41 === 0;
      const mood: Mood = out
        ? 'out'
        : panic
          ? 'panic'
          : sealed
            ? blink
              ? 'blink'
              : 'happy'
            : 'worried';
      const { hop, squash, side } = this.pose();
      const arms = mood === 'happy' || mood === 'blink' ? (side === 1 ? 0 : 1) : 0;
      const figure = this.book.get(`castle|${player}|${mood}|${arms}`, t, (k) =>
        drawCastleFigure(
          k,
          t,
          out ? GREY : this.colour(player, 'base'),
          out ? LIGHT_GREY : this.colour(player, 'light'),
          out ? 0x6a6a6a : this.colour(player, 'dark'),
          mood,
          arms,
        ),
      );
      let x = tileX(view, castle.x + castle.w / 2);
      let y = tileY(view, castle.y + castle.h) - t * 0.04;
      let sx = 1;
      let sy = 1;
      let rotation = 0;
      if (mood === 'happy' || mood === 'blink') {
        y -= hop * t * 0.14;
        sx = 1 + 0.1 * squash - 0.03 * hop;
        sy = 1 - 0.1 * squash + 0.05 * hop;
        rotation = side * DANCE_SWAY * hop;
      } else if (mood === 'panic' && !still) {
        x += (hash(castle.id, this.step, 2020) - 0.5) * t * 0.16;
        y -= hash(castle.id, this.step, 2021) * t * 0.1;
      } else if (mood === 'worried' && !still) {
        sy = 1 + 0.02 * Math.sin((this.shownBeats / 2) * Math.PI);
      }
      this.castleStamps.place(figure, x, y, { scale: sx, scaleY: sy, rotation });
      if (mood === 'out') this.dizzyOver(view, x, y - t * 2.75, castle.id);
      if ((mood === 'happy' || mood === 'blink') && !still) {
        const until =
          (this.untilNote.get(castle.id) ?? Math.random() * this.style.noteEveryMs) - frame.deltaMs;
        if (until <= 0) {
          this.notes.push({
            x: castle.x + castle.w / 2 + (Math.random() - 0.5) * 0.6,
            y: castle.y + castle.h - 2.9,
            age: 0,
            kind: Math.floor(Math.random() * 2),
          });
        }
        this.untilNote.set(
          castle.id,
          until <= 0 ? this.style.noteEveryMs * (0.6 + Math.random() * 0.8) : until,
        );
      }
    }
    this.castleStamps.end();
  }

  /** Stars circling over the head of a castle whose player is out. */
  private dizzyOver(view: ViewTransform, x: number, y: number, id: number): void {
    const t = view.tile;
    const star = this.book.get('star', t, (k) => drawStar(k, 0, 0, t * 0.16, 0, PAPER));
    const turn = motionReduced() ? 0 : (this.step / 12) * Math.PI * 2 * 0.4;
    for (let k = 0; k < 3; k++) {
      const a = turn + (k / 3) * Math.PI * 2 + id;
      this.puffStamps.place(star, x + Math.cos(a) * t * 0.5, y + Math.sin(a) * t * 0.16, {
        tint: LIGHT_GREY,
      });
    }
  }

  /**
   * The guns, cannons with faces stamped for each owner and mood, facing their target: a
   * live one bounces on its wheels to the beat; firing, it squashes back and stretches out,
   * eyes screwed shut, a puff of smoke from its muzzle; a silenced one sleeps, its barrel
   * drooping, Zs rising off it.
   */
  private drawCannons(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const { hop, squash } = this.pose();
    const zed = this.book.get('z', t, (k) => {
      const z = t * 0.14;
      k.moveTo(-z, -z).lineTo(z, -z).lineTo(-z, z).lineTo(z, z);
      k.stroke({ width: Math.max(1.5, t * 0.07), color: INK, join: 'miter', cap: 'round' });
    });
    this.cannonStamps.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      const fresh = aim.firedAgo === 0;
      aim.firedAgo += deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const firing = cannon.active && aim.firedAgo < FIRE_MS;
      const blink = !still && (this.step + cannon.id * 5) % 37 === 0;
      const mood: GunMood = !cannon.active ? 'asleep' : firing ? 'fire' : blink ? 'blink' : 'awake';
      const owner = cannon.owner;
      const figure = this.book.get(`gun|${owner}|${mood}`, t, (k) =>
        drawCannonFigure(k, t, this.colour(owner, 'base'), mood),
      );
      let x = tileX(view, cannon.x + cannon.w / 2);
      let y = tileY(view, cannon.y + cannon.h) - t * 0.3;
      let sx = 1;
      let sy = 1;
      if (firing && !still) {
        // Squashed back by the kick, then stretched out past its size, then settling.
        const q = aim.firedAgo / FIRE_MS;
        const k = q < 0.25 ? q / 0.25 : 1 - (q - 0.25) / 0.75;
        sx = q < 0.25 ? 1 - 0.18 * k : 1 + 0.12 * k;
        sy = q < 0.25 ? 1 + 0.14 * k : 1 - 0.08 * k;
        x -= dir * t * 0.1 * (q < 0.25 ? k : 0);
      } else if (cannon.active) {
        y -= hop * t * 0.08;
        sx = 1 + 0.06 * squash;
        sy = 1 - 0.08 * squash + 0.04 * hop;
      }
      this.cannonStamps.place(figure, x, y, { scale: dir * sx, scaleY: sy });
      if (fresh && cannon.active && !still) {
        const mx = PIVOT.x + Math.cos(ELEVATION) * MUZZLE;
        const my = PIVOT.y - Math.sin(ELEVATION) * MUZZLE;
        this.puff(
          cannon.x + cannon.w / 2 + dir * mx,
          cannon.y + cannon.h - 0.3 + my,
          0.24,
          dir * 1.2,
          SMOKE,
          500,
        );
      }
      if (!cannon.active) {
        // Zs rising off a sleeping gun, one after the other.
        for (let k = 0; k < 2; k++) {
          const q = still ? 0.3 : (this.step / 24 + k / 2 + cannon.id * 0.37) % 1;
          this.puffStamps.place(zed, x + dir * t * (0.3 + q * 0.4), y - t * (1 + q * 1.1), {
            scale: 0.6 + 0.6 * q,
            alpha: 1 - q * q,
          });
        }
      }
    }
    this.cannonStamps.end();
    this.aims.prune(state);
  }

  /**
   * Shots: black bombs, turning as they fly, the fuse sparking a star in the owner's colour,
   * a shadow on the ground below.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    const bomb = this.book.get('bomb', t, (k) => {
      k.moveTo(0, -t * 0.26).quadraticCurveTo(t * 0.1, -t * 0.32, t * 0.05, -t * 0.4);
      k.stroke({ width: Math.max(1, t * 0.05), color: INK, cap: 'round' });
      k.rect(-t * 0.07, -t * 0.27, t * 0.14, t * 0.08);
      k.fill({ color: 0x6a6a6a });
      k.stroke({ width: Math.max(1, t * 0.04), color: INK });
      k.circle(0, 0, t * 0.21);
      k.fill({ color: INK });
      k.ellipse(-t * 0.08, -t * 0.08, t * 0.06, t * 0.04);
      k.fill({ color: PAPER, alpha: 0.85 });
    });
    const spark = this.book.get('spark', t, (k) => drawStar(k, 0, 0, t * 0.12, 0, PAPER));
    this.bombStamps.begin();
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const y = gy - lift * t;
      const high = Math.min(1, lift / 3);
      this.underGfx.ellipse(gx, gy, t * 0.2, t * 0.07);
      this.underGfx.fill({ color: INK, alpha: 0.3 - 0.1 * high });
      const turn = still ? 0 : Math.floor(p * 8) * 0.5 * Math.sign(shot.toX - shot.fromX || 1);
      const scale = 1 + 0.25 * high;
      this.bombStamps.place(bomb, gx, y, { rotation: turn, scale });
      const fx = gx + Math.sin(turn) * t * 0.42 * scale + Math.cos(turn) * t * 0.05 * scale;
      const fy = y - Math.cos(turn) * t * 0.42 * scale + Math.sin(turn) * t * 0.05 * scale;
      this.bombStamps.place(spark, fx, fy, {
        tint: this.colour(shot.owner, 'light'),
        scale: still ? 1 : this.step % 2 === 0 ? 1.15 : 0.75,
        rotation: this.step * 0.6,
      });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
    this.bombStamps.end();
  }

  /** The burst where anything strikes: the one flash at a spot there is, a jagged star. */
  private drawBursts(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const burst = this.book.get('burst', t, (k) => {
      const points: number[] = [];
      for (let n = 0; n < 16; n++) {
        const a = (n / 16) * Math.PI * 2;
        const d = n % 2 === 0 ? t * 0.7 : t * 0.36;
        points.push(Math.cos(a) * d, Math.sin(a) * d);
      }
      k.poly(points);
      k.fill({ color: PAPER });
      k.stroke({ width: inkWidth(t), color: INK, join: 'miter' });
    });
    for (const b of this.bursts) {
      b.age += deltaMs;
      const k = b.age / BURST_MS;
      if (k >= 1) continue;
      this.puffStamps.place(burst, tileX(view, b.x + 0.5), tileY(view, b.y + 0.4), {
        scale: 0.6 + 0.6 * k,
        rotation: b.x + b.y,
        alpha: 1 - k * k,
      });
    }
    this.bursts = this.bursts.filter((b) => b.age < BURST_MS);
  }

  /** Puffs of dust and smoke, swelling, drifting up and fading. */
  private drawPuffs(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const cloud = this.book.get('cloud', t, (k) => drawCloud(k, 0, 0, t * 0.5));
    const dt = deltaMs / 1000;
    for (const p of this.puffs) {
      p.age += deltaMs;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      if (k >= 1) continue;
      this.puffStamps.place(cloud, tileX(view, p.x), tileY(view, p.y), {
        scale: (p.r / 0.5) * (0.7 + 0.6 * k),
        alpha: 1 - k * k,
        tint: p.tint,
      });
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
  }

  /** Bricks thrown from a hit wall, tumbling and falling, in their owner's colour. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const brick = this.book.get('brick', t, (k) => {
      k.rect(-t * 0.16, -t * 0.09, t * 0.32, t * 0.18);
      k.fill({ color: PAPER });
      k.stroke({ width: Math.max(1, t * 0.05), color: INK });
    });
    const dt = deltaMs / 1000;
    for (const b of this.thrown) {
      b.age += deltaMs;
      b.vy += 14 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.spin * dt;
      const k = b.age / b.life;
      if (k >= 1) continue;
      this.puffStamps.place(brick, tileX(view, b.x), tileY(view, b.y), {
        rotation: b.angle,
        alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
        tint: b.owner < 0 ? LIGHT_GREY : this.colour(b.owner, 'base'),
      });
    }
    this.thrown = this.thrown.filter((b) => b.age < b.life);
  }

  /** Stars seen where a wall was hit, circling the hole for a moment. */
  private drawDizzy(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const star = this.book.get('star', t, (k) => drawStar(k, 0, 0, t * 0.16, 0, PAPER));
    for (const d of this.dizzy) {
      d.age += deltaMs;
      const k = d.age / DIZZY_MS;
      if (k >= 1) continue;
      const turn = Math.floor(d.age / 83) * 0.5;
      for (let n = 0; n < 3; n++) {
        const a = turn + (n / 3) * Math.PI * 2;
        this.puffStamps.place(
          star,
          tileX(view, d.x + 0.5) + Math.cos(a) * t * 0.45,
          tileY(view, d.y - 0.1) + Math.sin(a) * t * 0.18,
          { alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3 },
        );
      }
    }
    this.dizzy = this.dizzy.filter((d) => d.age < DIZZY_MS);
  }

  /** Notes rising from the dancing castles, swaying, in steps. */
  private drawNotes(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const notes = [0, 1].map((kind) =>
      this.book.get(`note|${kind}`, t, (k) => drawNote(k, t * 0.3, kind === 1)),
    );
    for (const n of this.notes) {
      n.age += deltaMs;
      const k = Math.floor((n.age / NOTE_MS) * 20) / 20;
      if (k >= 1) continue;
      this.puffStamps.place(
        notes[n.kind]!,
        tileX(view, n.x + Math.sin(k * Math.PI * 3) * 0.25),
        tileY(view, n.y - k * 1.6),
        { alpha: k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4, rotation: Math.sin(k * Math.PI * 3) * 0.25 },
      );
    }
    this.notes = this.notes.filter((n) => n.age < NOTE_MS);
  }

  /** A shot in the sea: a splash thrown up in drops, a ring spreading. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      g.ellipse(x, y, t * (0.25 + 0.6 * k), t * (0.12 + 0.3 * k));
      g.stroke({ width: Math.max(1, t * 0.06), color: PAPER, alpha: 1 - k });
      if (k < 0.7) {
        const q = k / 0.7;
        for (let n = 0; n < 5; n++) {
          const a = -Math.PI * (0.15 + 0.7 * (n / 4));
          const d = t * (0.2 + 0.7 * q);
          const dx = x + Math.cos(a) * d;
          const dy = y + Math.sin(a) * d * 1.2 + q * q * t * 0.8;
          g.circle(dx, dy, t * 0.09 * (1 - q * 0.5));
        }
        g.fill({ color: PAPER, alpha: 1 - q });
        g.stroke({ width: Math.max(1, t * 0.04), color: INK, alpha: 1 - q });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /**
   * The weather from the seed, drawn as the cartoons drew it: rain in short slanting dashes
   * of ink, snow in white flakes inked round, fog in pale banks drifting; overcast and clear
   * leave the sky alone.
   */
  private drawWeather(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.dropStamps.begin();
    this.fog.begin(t);
    const snow = this.weather === 'snow';
    const count = snow ? this.style.snowCount : this.weather === 'rain' ? this.style.rainCount : 0;
    if (!still && count > 0) {
      while (this.drops.length < count) {
        this.drops.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          speed: snow ? 1.2 + Math.random() : 11 + Math.random() * 4,
        });
      }
      const dash = this.book.get('rain', t, (k) => {
        k.moveTo(0, 0).lineTo(-t * 0.12, -t * 0.42);
        k.stroke({ width: Math.max(1, t * 0.05), color: INK, cap: 'round' });
      });
      const flake = this.book.get('flake', t, (k) => {
        k.circle(0, 0, Math.max(1.5, t * 0.08));
        k.fill({ color: PAPER });
        k.stroke({ width: 1, color: INK });
      });
      const dt = deltaMs / 1000;
      for (const d of this.drops) {
        d.y += d.speed * dt;
        d.x += (snow ? Math.sin(this.clock / 900 + d.speed * 5) * 0.3 : d.speed * 0.25) * dt;
        if (d.y > rows) {
          d.y = -1;
          d.x = Math.random() * cols;
        }
        this.dropStamps.place(snow ? flake : dash, d.x * t, view.top + d.y * t, {
          alpha: snow ? 0.95 : 0.55,
        });
      }
    }
    if (this.weather === 'fog') {
      const { fogBanks, fogAlpha } = this.style;
      for (let n = 0; n < fogBanks; n++) {
        const drift = still ? 0 : this.clock / 60000;
        const fx = (((hash(n, this.seed, 2030) + drift * (0.5 + hash(n, 1, 2031))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 2032);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.2],
          [2.5, 0.5, 2.4],
          [-2.3, 0.6, 2.2],
        ] as const) {
          for (const f of [1, 0.75, 0.5])
            this.fog.disc(x + dx * t, y + dy * t, r * t * f, PAPER, fogAlpha / 3);
        }
      }
    }
    this.dropStamps.end();
    this.fog.end();
  }

  /**
   * The film the reel is on: a vignette darkening its corners, drawn only when the window
   * changes; grain and dust specks, new at each step; the light flickering; and now and then
   * a scratch running down it. Only the vignette with motion reduced.
   */
  private drawFilm(view: ViewTransform, deltaMs: number): void {
    const key = `${view.width}|${view.height}|${view.top}`;
    if (key !== this.vignetteDrawn) {
      this.vignetteDrawn = key;
      if (this.vignette.texture === Texture.EMPTY) {
        this.vignette.texture = vignetteTexture(this.style.vignetteAlpha);
      }
      this.vignette.position.set(0, view.top);
      this.vignette.width = view.width;
      this.vignette.height = view.height - view.top;
    }
    const g = this.filmGfx;
    g.clear();
    if (motionReduced()) {
      this.grainStamps.begin();
      this.grainStamps.end();
      return;
    }
    const t = view.tile;
    if (this.step !== this.grainStep) {
      this.grainStep = this.step;
      const speck = this.book.get('speck', t, (k) => {
        k.circle(0, 0, Math.max(1, t * 0.05));
        k.fill({ color: PAPER });
      });
      const h = view.height - view.top;
      this.grainStamps.begin();
      for (let n = 0; n < this.style.grainCount; n++) {
        const r = hash(n, this.step, 2040);
        this.grainStamps.place(
          speck,
          hash(n, this.step, 2041) * view.width,
          view.top + hash(n, this.step, 2042) * h,
          { tint: r < 0.5 ? INK : PAPER, alpha: 0.25 + 0.4 * r, scale: 0.5 + r * 1.2 },
        );
      }
      this.grainStamps.end();
    }
    const flicker = hash(this.step, 7, 2043);
    g.rect(0, view.top, view.width, view.height - view.top);
    g.fill({ color: flicker < 0.5 ? INK : PAPER, alpha: this.style.flickerAlpha * flicker });
    // A hair caught in the gate now and then: a short curl of ink.
    if (hash(this.step, 9, 2044) < 0.04) {
      const hx = hash(this.step, 10, 2045) * view.width;
      const hy = view.top + hash(this.step, 11, 2046) * (view.height - view.top);
      g.moveTo(hx, hy).quadraticCurveTo(hx + t * 0.8, hy - t * 0.6, hx + t * 0.3, hy + t * 0.9);
      g.stroke({ width: 1, color: INK, alpha: 0.5 });
    }
    if (this.untilScratch < 0) this.untilScratch = this.style.scratchEveryMs * Math.random();
    this.untilScratch -= deltaMs;
    if (this.untilScratch <= 0) {
      this.untilScratch = this.style.scratchEveryMs * (0.5 + Math.random());
      this.scratches.push({
        x: Math.random() * view.width,
        age: 0,
        life: 300 + Math.random() * 500,
      });
    }
    for (const s of this.scratches) {
      s.age += deltaMs;
      const x = s.x + (hash(this.step, Math.round(s.x), 2047) - 0.5) * 3;
      g.moveTo(x, view.top).lineTo(x, view.height);
    }
    g.stroke({ width: 1, color: PAPER, alpha: 0.45 });
    this.scratches = this.scratches.filter((s) => s.age < s.life);
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const now = performance.now();
    const still = motionReduced();
    drawOvertimeBorder(g, state, view, this.art, now);
    drawSelectable(g, view, ghost, this.art, now);
    drawBuildHints(g, view, ghost, this.art, now);
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      // The piece in hand, carried in two white gloves, bobbing on the beat; where it does
      // not fit it shakes its head, grey, and a glove wags a finger. The difference is in
      // form, since red is a player's.
      const step = still ? 0 : Math.floor(now / 83);
      const shake = !ghost.valid && !still ? (step % 2 === 0 ? 1 : -1) * t * 0.07 : 0;
      const at = { ...view, originX: view.originX + shake };
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(at, x), tileY(at, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : GREY,
        alpha: ghost.valid ? 0.45 : 0.55,
      });
      trace(g, outline(cells, inPiece, at));
      g.stroke({ width: inkWidth(t), color: INK, cap: 'square' });
      const left = Math.min(...cells.map((c) => c.x));
      const right = Math.max(...cells.map((c) => c.x));
      const top = Math.min(...cells.map((c) => c.y));
      if (ghost.valid) {
        const { hop } = this.pose();
        const rowOf = (x: number): number => {
          const ys = cells.filter((c) => c.x === x).map((c) => c.y);
          return (Math.min(...ys) + Math.max(...ys) + 1) / 2;
        };
        const bob = hop * t * 0.08;
        drawGlove(
          g,
          tileX(at, left) - t * 0.12,
          tileY(at, rowOf(left)) - bob,
          t * 0.26,
          Math.PI / 2,
        );
        drawGlove(
          g,
          tileX(at, right + 1) + t * 0.12,
          tileY(at, rowOf(right)) - bob,
          t * 0.26,
          -Math.PI / 2,
        );
        return;
      }
      const wag = still ? 0 : Math.floor(now / 160) % 2 === 0 ? 0.35 : -0.35;
      drawGlove(
        g,
        tileX(view, (left + right + 1) / 2),
        tileY(view, top) - t * 0.75,
        t * 0.28,
        wag,
        'point',
      );
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The gun's place, inked round, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.roundRect(x + t * 0.08, y + t * 0.08, w - t * 0.16, h - t * 0.16, t * 0.3);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: inkWidth(t), color: INK });
      g.roundRect(x + t * 0.16, y + t * 0.16, w - t * 0.32, h - t * 0.32, t * 0.25);
      g.stroke({ width: Math.max(1.5, t * 0.07), color: colour });
      if (!ghost.valid) {
        g.moveTo(x + t * 0.3, y + h - t * 0.3).lineTo(x + w - t * 0.3, y + t * 0.3);
        g.stroke({ width: inkWidth(t), color: INK, cap: 'round' });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * A castle as a living figure, its foot's middle at the origin, `t` a tile: a keep in the
 * owner's colour, crenellated, inked round, a door at its foot and shoes peeking out under
 * it, hose arms in white gloves, and a face — high, since the crown of a main castle sits on
 * its middle. `happy` grins with a pennant flying, arms swapping by `arms`; `blink` the same
 * with its eyes shut; `worried` frets, brows up, arms hanging; `panic` stares, mouth wide,
 * sweating, arms flung up; `out` is X-eyed, limp.
 */
function drawCastleFigure(
  g: Graphics,
  t: number,
  body: number,
  light: number,
  dark: number,
  mood: Mood,
  arms: 0 | 1,
): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  g.ellipse(0, -u(0.02), u(0.95), u(0.16));
  g.fill({ color: INK, alpha: 0.25 });
  for (const side of [-1, 1]) {
    g.ellipse(side * u(0.42), -u(0.08), u(0.24), u(0.12));
  }
  g.fill({ color: INK });
  // The arms, under the body so they grow out from behind it, and their gloves.
  const reach: [number, number, number][] =
    mood === 'happy' || mood === 'blink'
      ? arms === 0
        ? [
            [-1.12, -2.15, -0.5],
            [1.12, -0.85, 2.4],
          ]
        : [
            [-1.12, -0.85, -2.4],
            [1.12, -2.15, 0.5],
          ]
      : mood === 'panic'
        ? [
            [-1.05, -2.45, -0.35],
            [1.05, -2.45, 0.35],
          ]
        : [
            [-0.98, -0.62, -2.9],
            [0.98, -0.62, 2.9],
          ];
  for (const [hx, hy] of reach) {
    const sx = Math.sign(hx) * 0.6;
    g.moveTo(u(sx), -u(1.3)).quadraticCurveTo(u(hx * 1.05), -u(1.35), u(hx), u(hy));
  }
  g.stroke({ width: u(0.1), color: INK, cap: 'round' });
  for (const [hx, hy, a] of reach) drawGlove(g, u(hx), u(hy), u(0.2), a);
  // The keep, crenellated, its right side shaded.
  const top = -2.45;
  const crenel = -2.22;
  const half = 0.72;
  const keep = [
    -half,
    0,
    -half,
    top,
    -0.42,
    top,
    -0.42,
    crenel,
    -0.15,
    crenel,
    -0.15,
    top,
    0.15,
    top,
    0.15,
    crenel,
    0.42,
    crenel,
    0.42,
    top,
    half,
    top,
    half,
    0,
  ].map(u);
  g.poly(keep);
  g.fill({ color: body });
  g.rect(u(0.42), u(crenel), u(0.3), -u(crenel));
  g.fill({ color: dark, alpha: 0.45 });
  g.moveTo(-u(0.55), -u(0.5)).lineTo(-u(0.55), -u(2.05));
  g.stroke({ width: u(0.07), color: PAPER, alpha: 0.6, cap: 'round' });
  g.poly(keep);
  g.stroke({ width: ink, color: INK, join: 'round' });
  // The door at its foot.
  g.moveTo(-u(0.18), 0)
    .lineTo(-u(0.18), -u(0.3))
    .arc(0, -u(0.3), u(0.18), Math.PI, 0)
    .lineTo(u(0.18), 0)
    .closePath();
  g.fill({ color: INK });
  // The pennant over a castle that dances.
  if (mood === 'happy' || mood === 'blink') {
    g.moveTo(0, u(top)).lineTo(0, u(top - 0.6));
    g.stroke({ width: Math.max(1.5, u(0.06)), color: INK, cap: 'round' });
    g.poly([0, u(top - 0.6), u(0.5), u(top - 0.47), 0, u(top - 0.32)]);
    g.fill({ color: light });
    g.stroke({ width: Math.max(1, ink * 0.7), color: INK, join: 'round' });
  }
  // The face.
  const eyeY = -1.95;
  const line = { width: Math.max(1.5, ink * 0.8), color: INK, cap: 'round' as const };
  if (mood === 'out') {
    for (const ex of [-0.2, 0.2]) {
      g.moveTo(u(ex - 0.1), u(eyeY - 0.1)).lineTo(u(ex + 0.1), u(eyeY + 0.1));
      g.moveTo(u(ex + 0.1), u(eyeY - 0.1)).lineTo(u(ex - 0.1), u(eyeY + 0.1));
    }
    g.moveTo(-u(0.22), -u(1.6))
      .lineTo(-u(0.11), -u(1.66))
      .lineTo(0, -u(1.6))
      .lineTo(u(0.11), -u(1.66))
      .lineTo(u(0.22), -u(1.6));
    g.stroke(line);
    return;
  }
  if (mood === 'blink') {
    for (const ex of [-0.2, 0.2]) {
      g.moveTo(u(ex - 0.12), u(eyeY)).quadraticCurveTo(
        u(ex),
        u(eyeY - 0.14),
        u(ex + 0.12),
        u(eyeY),
      );
    }
    g.stroke(line);
  } else {
    const big = mood === 'panic' ? 1.25 : 1;
    for (const ex of [-0.2, 0.2]) {
      drawPieEye(g, u(ex), u(eyeY), u(0.13 * big), u(0.21 * big), mood === 'panic' ? 0 : ex * 2, 0);
    }
  }
  if (mood === 'worried') {
    g.moveTo(-u(0.34), -u(2.24)).lineTo(-u(0.1), -u(2.33));
    g.moveTo(u(0.34), -u(2.24)).lineTo(u(0.1), -u(2.33));
    g.moveTo(-u(0.18), -u(1.58))
      .quadraticCurveTo(-u(0.09), -u(1.66), 0, -u(1.58))
      .quadraticCurveTo(u(0.09), -u(1.5), u(0.18), -u(1.58));
    g.stroke(line);
  } else if (mood === 'panic') {
    g.ellipse(0, -u(1.55), u(0.13), u(0.15));
    g.fill({ color: INK });
    for (const side of [-1, 1]) {
      const dx = side * u(0.52);
      const dy = -u(2.15);
      g.moveTo(dx, dy - u(0.14)).quadraticCurveTo(dx + u(0.09), dy, dx, dy + u(0.05));
      g.quadraticCurveTo(dx - u(0.09), dy, dx, dy - u(0.14));
    }
    g.fill({ color: PAPER });
    g.stroke({ width: Math.max(1, ink * 0.5), color: INK });
  } else {
    // A grin, open, a tongue in it.
    g.moveTo(-u(0.3), -u(1.68)).quadraticCurveTo(0, -u(1.22), u(0.3), -u(1.68)).closePath();
    g.fill({ color: INK });
    g.ellipse(0, -u(1.5), u(0.11), u(0.05));
    g.fill({ color: GREY });
  }
}

/**
 * A gun as a cannon with a face, facing right, its foot's middle at the origin: a fat barrel
 * in the owner's colour raised on a carriage, its muzzle for a mouth, eyes on its side, a
 * spoked wheel in front. `awake` frowns, determined; `blink` shuts its eyes; `fire` screws
 * them shut; `asleep` droops, eyes closed.
 */
function drawCannonFigure(g: Graphics, t: number, body: number, mood: GunMood): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  g.ellipse(0, 0, u(0.72), u(0.14));
  g.fill({ color: INK, alpha: 0.25 });
  g.poly([-u(0.55), 0, u(0.35), 0, u(0.15), -u(0.45), -u(0.35), -u(0.52)]);
  g.fill({ color: LIGHT_GREY });
  g.stroke({ width: ink * 0.8, color: INK, join: 'round' });
  // Turned first and then moved: Pixi's turn turns whatever move came before it too.
  g.save();
  g.rotateTransform(-(mood === 'asleep' ? DROOP : ELEVATION));
  g.translateTransform(u(PIVOT.x), u(PIVOT.y));
  const barrel = (): void => {
    g.circle(-u(0.3), 0, u(0.3));
    g.poly([-u(0.3), -u(0.3), u(0.62), -u(0.22), u(0.62), u(0.22), -u(0.3), u(0.3)]);
    g.roundRect(u(0.56), -u(0.28), u(0.2), u(0.56), u(0.06));
  };
  barrel();
  g.stroke({ width: ink * 2, color: INK, join: 'round' });
  barrel();
  g.fill({ color: body });
  g.moveTo(-u(0.42), -u(0.17)).lineTo(u(0.48), -u(0.13));
  g.stroke({ width: u(0.06), color: PAPER, alpha: 0.6, cap: 'round' });
  g.moveTo(u(0.56), -u(0.24)).lineTo(u(0.56), u(0.24));
  g.stroke({ width: Math.max(1, ink * 0.6), color: INK });
  g.ellipse(u(MUZZLE - 0.02), 0, u(0.06), u(0.19));
  g.fill({ color: INK });
  // The face along its side.
  const line = { width: Math.max(1.5, ink * 0.75), color: INK, cap: 'round' as const };
  const eyes = [-0.2, 0.06];
  if (mood === 'awake') {
    for (const ex of eyes) drawPieEye(g, u(ex), -u(0.02), u(0.08), u(0.12), 1, 0);
    g.moveTo(u(eyes[0]! - 0.1), -u(0.2)).lineTo(u(eyes[0]! + 0.08), -u(0.15));
    g.moveTo(u(eyes[1]! - 0.08), -u(0.15)).lineTo(u(eyes[1]! + 0.1), -u(0.2));
    g.stroke(line);
  } else if (mood === 'fire') {
    g.moveTo(u(eyes[0]! - 0.08), -u(0.1))
      .lineTo(u(eyes[0]! + 0.06), -u(0.02))
      .lineTo(u(eyes[0]! - 0.08), u(0.06));
    g.moveTo(u(eyes[1]! + 0.08), -u(0.1))
      .lineTo(u(eyes[1]! - 0.06), -u(0.02))
      .lineTo(u(eyes[1]! + 0.08), u(0.06));
    g.stroke(line);
  } else if (mood === 'blink') {
    for (const ex of eyes) g.moveTo(u(ex - 0.08), -u(0.02)).lineTo(u(ex + 0.08), -u(0.02));
    g.stroke(line);
  } else {
    for (const ex of eyes) {
      g.moveTo(u(ex - 0.08), -u(0.03)).quadraticCurveTo(u(ex), u(0.05), u(ex + 0.08), -u(0.03));
    }
    g.stroke(line);
  }
  g.restore();
  // The wheel, in front.
  const wx = u(0.02);
  const wy = -u(0.26);
  g.circle(wx, wy, u(0.27));
  g.fill({ color: PAPER });
  g.stroke({ width: ink, color: INK });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + 0.4;
    g.moveTo(wx - Math.cos(a) * u(0.24), wy - Math.sin(a) * u(0.24)).lineTo(
      wx + Math.cos(a) * u(0.24),
      wy + Math.sin(a) * u(0.24),
    );
  }
  g.stroke({ width: Math.max(1, ink * 0.5), color: INK });
  g.circle(wx, wy, u(0.06));
  g.fill({ color: INK });
}

/**
 * The vignette: clear in the middle, darkening to `alpha` at the corners, drawn once on a
 * small canvas and stretched over the window. A Pixi radial gradient lost its stops' alpha
 * and darkened the whole screen, and rings of stroked rectangles showed their bands.
 */
function vignetteTexture(alpha: number): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.72);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(0.62, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
  }
  return Texture.from(canvas);
}

/** A note in ink, its head at the origin, `h` tall: a crotchet, or two quavers beamed. */
function drawNote(g: Graphics, h: number, beamed: boolean): void {
  const heads = beamed ? [0, h * 0.55] : [0];
  for (const x of heads) {
    g.ellipse(x, 0, h * 0.2, h * 0.14);
    g.fill({ color: INK });
    g.moveTo(x + h * 0.17, 0).lineTo(x + h * 0.17, -h);
  }
  if (beamed) g.moveTo(h * 0.17, -h).lineTo(h * 0.72, -h * 0.9);
  else g.moveTo(h * 0.17, -h).quadraticCurveTo(h * 0.45, -h * 0.7, h * 0.35, -h * 0.4);
  g.stroke({ width: Math.max(1.5, h * 0.12), color: INK, cap: 'round' });
}

/** What a piece of scenery is drawn as. */
type SceneryLook = 'tree' | 'face' | 'toadstool' | 'daisy' | 'grass' | 'haystack' | 'rock';

/** Each look's foot below its tile's middle, in tiles: where it stands and moves from. */
const FOOT: Record<SceneryLook, number> = {
  tree: 0.42,
  face: 0.42,
  toadstool: 0.35,
  daisy: 0.4,
  grass: 0.3,
  haystack: 0.3,
  rock: 0.27,
};

/** How far each look leans on the beat, in radians, and how much it squashes as it lands. */
const SWAY: Record<SceneryLook, { lean: number; give: number }> = {
  tree: { lean: 0.1, give: 0.06 },
  face: { lean: 0.1, give: 0.06 },
  toadstool: { lean: 0.05, give: 0.1 },
  daisy: { lean: 0.2, give: 0.04 },
  grass: { lean: 0.16, give: 0.03 },
  haystack: { lean: 0, give: 0.09 },
  rock: { lean: 0, give: 0.04 },
};

/**
 * Cartoon's scenery, none square like a wall nor round and black like a bomb: a tree is a
 * puffy canopy on a bendy trunk, one in four with a face; a pine a toadstool; a bush a daisy
 * with a face or a tuft of grass; a boulder a grey rock, or one in three a haystack.
 */
function sceneryLook(item: SceneryItem): SceneryLook {
  if (item.kind === 'tree') return item.variant === 0 ? 'face' : 'tree';
  if (item.kind === 'pine') return 'toadstool';
  if (item.kind === 'bush') return item.variant % 2 === 0 ? 'daisy' : 'grass';
  return item.variant % 3 === 0 ? 'haystack' : 'rock';
}

/** A piece of scenery, its foot at the origin so it moves from there. */
function drawSceneryFigure(g: Graphics, t: number, look: SceneryLook): void {
  const ink = Math.max(1, t * 0.06);
  const cx = 0;
  const cy = -FOOT[look] * t;
  if (look === 'tree' || look === 'face') {
    g.moveTo(-t * 0.06, 0)
      .quadraticCurveTo(-t * 0.12, cy + t * 0.1, -t * 0.02, cy - t * 0.1)
      .lineTo(t * 0.06, cy - t * 0.1)
      .quadraticCurveTo(0, cy + t * 0.1, t * 0.08, 0)
      .closePath();
    g.fill({ color: 0x5a5a5a });
    g.stroke({ width: ink, color: INK, join: 'round' });
    drawCloud(g, 0, cy - t * 0.25, t * 0.24, 0xeeeeee, 1, ink);
    if (look === 'tree') return;
    drawPieEye(g, -t * 0.08, cy - t * 0.3, t * 0.045, t * 0.07, 0, 0);
    drawPieEye(g, t * 0.08, cy - t * 0.3, t * 0.045, t * 0.07, 0, 0);
    g.moveTo(-t * 0.08, cy - t * 0.17).quadraticCurveTo(0, cy - t * 0.1, t * 0.08, cy - t * 0.17);
    g.stroke({ width: Math.max(1, ink * 0.8), color: INK, cap: 'round' });
  } else if (look === 'toadstool') {
    // A white stem, a grey cap with white spots.
    g.rect(cx - t * 0.07, cy - t * 0.05, t * 0.14, t * 0.4);
    g.fill({ color: PAPER });
    g.stroke({ width: ink, color: INK });
    g.moveTo(cx - t * 0.32, cy - t * 0.02)
      .quadraticCurveTo(cx - t * 0.3, cy - t * 0.42, cx, cy - t * 0.42)
      .quadraticCurveTo(cx + t * 0.3, cy - t * 0.42, cx + t * 0.32, cy - t * 0.02)
      .closePath();
    g.fill({ color: 0xb4b4b4 });
    g.stroke({ width: ink, color: INK, join: 'round' });
    for (const [dx, dy] of [
      [-0.14, -0.18],
      [0.1, -0.28],
      [0.18, -0.1],
    ] as const) {
      g.circle(cx + dx * t, cy + dy * t, t * 0.05);
    }
    g.fill({ color: PAPER });
  } else if (look === 'daisy') {
    // A daisy with a face, on a stem.
    g.moveTo(cx, cy + t * 0.4).quadraticCurveTo(cx + t * 0.08, cy + t * 0.15, cx, cy - t * 0.05);
    g.stroke({ width: ink, color: INK });
    const petals = (): void => {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        g.ellipse(
          cx + Math.cos(a) * t * 0.14,
          cy - t * 0.12 + Math.sin(a) * t * 0.14,
          t * 0.08,
          t * 0.08,
        );
      }
    };
    petals();
    g.stroke({ width: ink, color: INK });
    petals();
    g.fill({ color: PAPER });
    g.circle(cx, cy - t * 0.12, t * 0.1);
    g.fill({ color: 0xc8c8c8 });
    g.stroke({ width: Math.max(1, ink * 0.7), color: INK });
    g.circle(cx - t * 0.035, cy - t * 0.14, Math.max(0.8, t * 0.018));
    g.circle(cx + t * 0.035, cy - t * 0.14, Math.max(0.8, t * 0.018));
    g.fill({ color: INK });
  } else if (look === 'grass') {
    // A tuft of long grass.
    for (const [dx, lean] of [
      [-0.15, -0.12],
      [-0.05, -0.04],
      [0.05, 0.05],
      [0.15, 0.14],
    ] as const) {
      g.moveTo(cx + dx * t, cy + t * 0.3).quadraticCurveTo(
        cx + (dx + lean * 0.3) * t,
        cy,
        cx + (dx + lean) * t,
        cy - t * 0.25,
      );
    }
    g.stroke({ width: ink, color: INK, cap: 'round' });
  } else if (look === 'haystack') {
    // A haystack, straw sticking out of it.
    g.moveTo(cx - t * 0.36, cy + t * 0.3)
      .quadraticCurveTo(cx - t * 0.32, cy - t * 0.38, cx, cy - t * 0.38)
      .quadraticCurveTo(cx + t * 0.32, cy - t * 0.38, cx + t * 0.36, cy + t * 0.3)
      .closePath();
    g.fill({ color: 0xdedede });
    g.stroke({ width: ink, color: INK, join: 'round' });
    for (const [x1, y1, x2, y2] of [
      [-0.2, 0.1, -0.1, -0.1],
      [0.05, 0.15, 0.12, -0.12],
      [-0.05, -0.15, 0.02, -0.3],
      [0.2, 0.05, 0.26, -0.1],
    ] as const) {
      g.moveTo(cx + x1 * t, cy + y1 * t).lineTo(cx + x2 * t, cy + y2 * t);
    }
    g.stroke({ width: Math.max(1, ink * 0.6), color: 0x6a6a6a, cap: 'round' });
  } else {
    // A rock, lumpy, a crack across it.
    g.moveTo(cx - t * 0.32, cy + t * 0.26)
      .quadraticCurveTo(cx - t * 0.36, cy - t * 0.1, cx - t * 0.12, cy - t * 0.2)
      .quadraticCurveTo(cx + t * 0.15, cy - t * 0.3, cx + t * 0.3, cy - t * 0.02)
      .quadraticCurveTo(cx + t * 0.36, cy + t * 0.2, cx + t * 0.28, cy + t * 0.26)
      .closePath();
    g.fill({ color: 0xc4c4c4 });
    g.stroke({ width: ink, color: INK, join: 'round' });
    g.moveTo(cx - t * 0.05, cy - t * 0.18)
      .lineTo(cx + t * 0.02, cy - t * 0.02)
      .lineTo(cx - t * 0.03, cy + t * 0.08);
    g.stroke({ width: Math.max(1, ink * 0.6), color: INK });
  }
}

/**
 * The scenery's shadows, which stay put while what casts them moves (`drawStanding`): under the
 * trees, the toadstools, the haystacks and the rocks.
 */
function drawCartoonScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  for (const item of items) {
    const look = sceneryLook(item);
    if (look === 'daisy' || look === 'grass') continue;
    const wide = look === 'toadstool' ? 0.22 : look === 'tree' || look === 'face' ? 0.3 : 0.34;
    g.ellipse(
      tileX(view, item.x + 0.5) + t * 0.06,
      tileY(view, item.y + 0.5) + FOOT[look] * t,
      t * wide,
      t * 0.07,
    );
  }
  g.fill({ color: INK, alpha: 0.25 });
}
