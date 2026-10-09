import type { ArtConfig, NoirStyleConfig } from '@bollwerk/config';
import { Structure, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, FillPattern, Graphics, Text, Texture, type GraphicsContext } from 'pixi.js';

import { t as text } from '../i18n.js';
import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { climax, cornerSpot } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { NoirSeaLife } from './seaLife.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  Fireworks,
  FlagHoist,
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
import { outline, trace, wallGeometry } from './walls.js';
import { ShapeTheme } from './shapeTheme.js';

/** Ink, and the paper white of a lit face. */
export const NOIR_INK = 0x0a0a0d;
export const NOIR_PAPER = 0xf0eee8;
/** Lamplight: a warm white, the nearest thing to a colour the city has that is no player's. */
const LAMP = 0xf6eedc;
const STONE_LIT = 0x9a9aa0;
const FACADE = 0x1e1e24;
const FACADE_LIT = 0x4a4a52;
const DEAD = 0x55555b;

/** Something with a place and an age: a blast, a splash, a crater. */
interface Aged {
  x: number;
  y: number;
  age: number;
}

/** A crater on the ground, fading over the rounds. */
interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A thing thrown: a brick in the owner's colour, or a puff of smoke rising. */
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
  smoke: boolean;
  r: number;
}

/** A word of a comic's sound, popped onto the board at a big moment. */
interface Word {
  x: number;
  y: number;
  age: number;
  text: string;
  tilt: number;
}

/** A raindrop, in tiles on screen. */
interface Drop {
  x: number;
  y: number;
  speed: number;
  len: number;
}

/** A figure to stamp, by where it stands: `foot` orders them, nearest last. */
interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/** How a gun stands: watching with its searchlight, firing, or dark while silenced. */
type Mood = 'ready' | 'fire' | 'dark';
/** How a speakeasy stands: lit, dark, or closed down with its player out. */
type Club = 'lit' | 'dark' | 'closed';

const FIRE_MS = 260;
const BLAST_MS = 380;
const SPLASH_MS = 650;
/** At most this many sound words on the board at once. */
const WORDS_AT_ONCE = 6;

/** How Noir sends off the winners: ink drops in their colours, and a necktie for a flag. */
const FINISH: FinishLook = { spark: 'blot', flag: 'necktie' };

/**
 * A repeating pattern drawn once on a small canvas: hatching, cross-hatching, cobbles. Laid
 * into shapes as a fill (`FillPattern`), in screen space so it runs on unbroken from shape to
 * shape — a handful of vertices a shape, where hatching drawn stroke by stroke would be
 * thousands, the very cost of a style's terrain drawn whole (ARCHIVE 12zm).
 */
function pattern(size: number, draw: (ctx: CanvasRenderingContext2D) => void): FillPattern {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) draw(ctx);
  return new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
}

/** Diagonal hatching, `colour` lines on nothing, `cross` both ways. */
function hatching(colour: string, cross: boolean): FillPattern {
  return pattern(16, (ctx) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const o of [-16, 0, 16]) {
      ctx.moveTo(o, 16);
      ctx.lineTo(o + 16, 0);
      if (cross) {
        ctx.moveTo(o, 0);
        ctx.lineTo(o + 16, 16);
      }
    }
    ctx.stroke();
  });
}

/** Cobbles: rounded stones inked round, in rows set off by half a stone. */
function cobbles(): FillPattern {
  return pattern(32, (ctx) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 1.2;
    for (let row = 0; row < 4; row++) {
      const shift = row % 2 === 0 ? 0 : 4;
      for (let col = -1; col < 4; col++) {
        ctx.beginPath();
        ctx.roundRect(col * 8 + shift + 0.8, row * 8 + 0.8, 6.4, 6.4, 2.4);
        ctx.stroke();
      }
    }
  });
}

/**
 * The Noir look, for either look: a 1940s crime city at night drawn as a hard-boiled graphic
 * novel — the war over walls a turf war between gangs. Cel-shaded, two hard tones and a thick
 * ink line, the shadows hatched; black, white and grey, and the only colour the players', as
 * neon. **The light carries the meaning**: sealed ground is turf in a street lamp's light,
 * the owner's colour faint in it, hatching and dark everywhere else; a breach makes the lamp
 * and the club's sign sputter out; a silenced gun stands in the dark, hatched over; a player
 * who is out has their island blacked out, the club closed. Walls are brick in the owner's
 * colour, castles speakeasies under a neon sign, guns rooftop guns with searchlights. A hit
 * is a cel-shaded blast — a big one lettered with a sound word — bricks flying, smoke curling. Rain, fog or a dry night with the drains steaming; the final
 * round a thunderstorm. A detective under a lamp stands in the corner.
 */
export class NoirTheme extends ShapeTheme implements Theme {
  readonly id = 'noir' as const;

  private style!: NoirStyleConfig;
  private weather: Weather = 'rain';
  private readonly seaLife = new NoirSeaLife();

  private hatch: FillPattern | null = null;
  private crossHatch: FillPattern | null = null;
  private seaHatch: FillPattern | null = null;
  private cobble: FillPattern | null = null;

  private readonly terrainGfx = new Graphics();
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  private readonly cornerMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawNoirScenery(g, view, items, this.hatch),
    () => 0x8a8a90,
  );
  /** Brick walls and the guns' bases, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  /** The searchlights' beams, under everything that stands. */
  private readonly beams = new Stamps();
  /** The clubs, their lamps and the guns, in one: placed nearest last. */
  private readonly figureStamps = new Stamps();
  private figures: Figure[] = [];
  private readonly effectGfx = new Graphics();
  private readonly shellStamps = new Stamps();
  private readonly blastStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  /** The neon's and the lamps' halos, added. */
  private readonly glow = new Discs();
  private readonly rainStamps = new Stamps();
  private readonly mist = new Discs();
  /** Sound words, lettered; a few kept and lettered again, never made one a hit. */
  private readonly wordLayer = new Container();
  private readonly wordPool: Text[] = [];
  /** Over all: the final round's lightning. */
  private readonly flashGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly lit = new FlagHoist();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  private clock = 0;
  private round = 0;
  private corner: TimerSpot | null = null;
  private craters: Crater[] = [];
  private blasts: Aged[] = [];
  private splashes: Aged[] = [];
  private thrown: Thrown[] = [];
  private words: Word[] = [];
  private drops: Drop[] = [];
  /** The lightning: when the next strike comes, and how long the one under way has lit. */
  private nextStrike = 0;
  private strike = -1;
  /** Clubs going dark this frame, for their sound word: by castle id, as last seen. */
  private readonly sputtering = new Set<number>();

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.noir;
    // Rain is the city's weather: fog in a foggy match, a dry night with steam in a clear one.
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    this.hatch = hatching('rgba(0,0,0,1)', false);
    this.crossHatch = hatching('rgba(0,0,0,1)', true);
    this.seaHatch = hatching('rgba(255,255,255,1)', false);
    this.cobble = cobbles();
    this.glow.container.blendMode = 'add';
    this.beams.container.blendMode = 'add';
    layers.terrain.addChild(this.terrainGfx, this.craterGfx, this.cornerMemos.container);
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.beams.container,
      this.figureStamps.container,
      this.effectGfx,
      this.shellStamps.container,
      this.blastStamps.container,
      this.lateGfx,
      this.glow.container,
      this.rainStamps.container,
      this.mist.container,
      this.wordLayer,
      this.flashGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.cornerMemos.destroy();
    for (const s of [
      this.beams,
      this.figureStamps,
      this.shellStamps,
      this.blastStamps,
      this.rainStamps,
    ]) {
      s.destroy();
    }
    this.glow.destroy();
    this.mist.destroy();
    this.book.destroy();
    for (const word of this.wordPool) word.destroy(true);
    this.wordLayer.destroy();
    for (const g of [
      this.terrainGfx,
      this.craterGfx,
      this.underGfx,
      this.effectGfx,
      this.lateGfx,
      this.flashGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
    for (const p of [this.hatch, this.crossHatch, this.seaHatch, this.cobble]) {
      p?.texture.destroy(true);
    }
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The black harbour, its swell hatched faintly in light, foam inked along the quays and the
   * city's lamps broken in it; the streets wet cobbles, and every stone of them out of the
   * light hatched over. The quays a kerb of pale stone, bollards along them.
   */
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

    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const sea = (): void => {
      g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    };
    sea();
    g.fill({ color: hex(palette.waterDeep) });
    if (this.seaHatch !== null) {
      sea();
      g.fill({ fill: this.seaHatch, alpha: 0.05 });
    }
    const near = (x: number, y: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    // The water along the quays, a shade lighter.
    for (let y = -1; y <= state.height; y++) {
      for (let x = -1; x <= state.width; x++) {
        if (!land(x, y) && near(x, y)) g.rect(tileX(view, x), tileY(view, y), t, t);
      }
    }
    g.fill({ color: hex(palette.waterMid) });
    // The city's lamps broken in the water: short pale streaks, one under another.
    for (let y = -1; y <= state.height; y++) {
      for (let x = -1; x <= state.width; x++) {
        if (land(x, y) || !near(x, y) || hash(x, y, 7100) > 0.12) continue;
        const sx = tileX(view, x + 0.2 + 0.6 * hash(x, y, 7101));
        const sy = tileY(view, y + 0.15);
        for (let k = 0; k < 4; k++) {
          const w = t * (0.32 - k * 0.06);
          g.rect(sx - w / 2, sy + k * t * 0.2, w, Math.max(1, t * 0.05));
        }
      }
    }
    g.fill({ color: LAMP, alpha: 0.28 });
    // Foam inked along the quays in short strokes.
    for (let y = -1; y <= state.height; y++) {
      for (let x = -1; x <= state.width; x++) {
        if (land(x, y) || hash(x, y, 7102) > 0.5) continue;
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          if (!land(x + dx, y + dy)) continue;
          const cx = tileX(view, x + 0.5 + dx * 0.3);
          const cy = tileY(view, y + 0.5 + dy * 0.3);
          const r = t * 0.22;
          if (dx === 0) g.moveTo(cx - r, cy).lineTo(cx + r, cy);
          else g.moveTo(cx, cy - r).lineTo(cx, cy + r);
        }
      }
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.waterFoam), alpha: 0.55 });

    // The streets: cobbles, wet, and out of the light hatched over.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    const paveAll = (): void => {
      for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    };
    paveAll();
    g.fill({ color: hex(palette.grassMid) });
    if (this.cobble !== null) {
      paveAll();
      g.fill({ fill: this.cobble, alpha: 0.55 });
    }
    // Puddles, catching a little light.
    for (const { x, y } of ground) {
      if (hash(x, y, 7103) > 0.05) continue;
      g.ellipse(tileX(view, x + 0.5), tileY(view, y + 0.55), t * 0.42, t * 0.16);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.18 });
    if (this.hatch !== null) {
      paveAll();
      g.fill({ fill: this.hatch, alpha: this.style.hatchAlpha });
    }
    // The quays: a kerb of pale stone, inked, its shadow hatched on the water below it.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.2, color: STONE_LIT, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: Math.max(1.5, t * 0.08), color: NOIR_INK, cap: 'square' });
    for (const { x, y } of ground) {
      if (land(x, y + 1) || hash(x, y, 7104) > 0.18) continue;
      g.circle(tileX(view, x + 0.5), tileY(view, y + 0.82), t * 0.09);
    }
    g.fill({ color: NOIR_INK });

    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.cratersDrawn = '';
  }

  /** Craters where shells came down, scorched and cracked; drawn again only when one comes or fades. */
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
      const y = tileY(view, c.y + 0.5);
      g.ellipse(x, y, t * 0.4, t * 0.28);
      g.fill({ color: NOIR_INK, alpha: 0.8 * fade });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + hash(c.x, c.y, 7110 + k);
        g.moveTo(x + Math.cos(a) * t * 0.3, y + Math.sin(a) * t * 0.2);
        g.lineTo(x + Math.cos(a) * t * 0.62, y + Math.sin(a) * t * 0.42);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: NOIR_INK, alpha: 0.8 * fade });
    }
  }

  // ------------------------------------------------------------------ the detective

  /**
   * The detective in the corner: a lamp post on the quay, its light a hard cone on the wet
   * stones, and under it a man in a trench coat and hat in silhouette, leaning on the post,
   * collar up against the rain, now and then turning his head — faster at the climax.
   */
  private drawCorner(state: MatchState, view: ViewTransform): void {
    this.cornerMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const t = view.tile;
      const s = spot.size * t;
      const cx = tileX(view, spot.x);
      const cy = tileY(view, spot.y);
      const still = motionReduced();
      const every = climax(state) ? 1400 : 4200;
      const looking = still ? 0 : Math.floor(this.clock / every) % 2;
      this.cornerMemos.draw('detective', `${viewKey(view)}|${looking}`, (g) =>
        drawDetective(g, cx, cy, s, looking === 1),
      );
      this.glow.disc(cx - s * 0.2, cy - s * 0.42, s * 0.16, LAMP, this.style.glowAlpha * 0.7);
    }
    this.cornerMemos.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as turf in a street lamp's light: lit cobbles, the owner's colour faint in it. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawTurf(g, island, view));
  }

  /**
   * The light on sealed ground: the cobbles lit pale, no hatching on them, washed in the
   * owner's colour, edged hard where the light ends, as a lamp's pool is in the rain.
   */
  private drawTurf(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      const pave = (): void => {
        for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      };
      pave();
      g.fill({ color: hex(this.art.palette.grassLight) });
      if (this.cobble !== null) {
        pave();
        g.fill({ fill: this.cobble, alpha: 0.3 });
      }
      pave();
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.floorAlpha });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: NOIR_INK, alpha: 0.6 });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.06), color: this.colour(player, 'light') });
    }
    dimEliminated(g, state, view, NOIR_INK);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

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
      cannonBase(g, view, cannon, 0x2a2a30, this.colour(cannon.owner, 'base'), 0.85);
    }
  }

  /**
   * Walls as brick, cel-shaded: the top in the owner's colour coursed in thin ink, the face in
   * their dark shade hatched over, a hard shadow cast below it and hatched across, the whole
   * inked thick. A player's who is out, and rubble, grey. Straight strokes and pattern fills
   * only: a wall is redrawn at every hit on its island.
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
    // The shadow it casts, away from the light, hatched.
    for (const b of wall.blocks) {
      if (joins(b.x, b.y + 1)) continue;
      g.rect(b.left + t * 0.12, b.top + t + (b.faced ? wall.face : 0) - t * 0.02, t, t * 0.28);
    }
    if (this.crossHatch !== null) g.fill({ fill: this.crossHatch, alpha: 0.6 });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'base') });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? 0x3a3a40 : this.colour(player, 'dark') });
    if (this.hatch !== null) {
      for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
      g.fill({ fill: this.hatch, alpha: 0.45 });
    }
    // The courses on the tops, each block two bricks a row, set off row by row.
    for (const b of wall.blocks) {
      const mid = (b.top + b.lip) / 2;
      g.moveTo(b.left, mid).lineTo(b.left + t, mid);
      const off = b.y % 2 === 0 ? 0.5 : 0.25;
      g.moveTo(b.left + t * off, b.top).lineTo(b.left + t * off, mid);
      g.moveTo(b.left + t * (off + 0.5 > 1 ? off - 0.5 : off + 0.5), mid).lineTo(
        b.left + t * (off + 0.5 > 1 ? off - 0.5 : off + 0.5),
        b.lip,
      );
    }
    g.stroke({ width: Math.max(1, t * 0.035), color: NOIR_INK, alpha: 0.55 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1.5, t * 0.09), color: NOIR_INK, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    this.blasts.push({ x, y, age: 0 });
    if (!this.land(x, y) && debris.length === 0) {
      this.splashes.push({ x, y, age: 0 });
      return;
    }
    this.smoke(x + 0.5, y + 0.4, 3);
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      for (let k = 0; k < 6; k++) this.throwBrick(block.x + 0.5, block.y + 0.4, block.owner - 1);
    }
    // A heavy hit now and then: a sound word.
    if (Math.random() < this.style.wordChance) this.bigMoment(x + 0.5, y);
  }

  /**
   * A big moment at a spot: a sound word lettered over it. It once also flashed the screen
   * white for an impact frame, speed lines bursting from the hit, which the testers found too
   * much at every few hits (2026-10-09): the words, which they liked, come oftener instead.
   */
  private bigMoment(x: number, y: number): void {
    if (this.words.length >= WORDS_AT_ONCE) return;
    const all = text('noir.words').split('|');
    this.words.push({
      x,
      y: y - 0.6,
      age: 0,
      text: all[Math.floor(Math.random() * all.length)] ?? 'BLAM!',
      tilt: (Math.random() - 0.5) * 0.4,
    });
  }

  private smoke(x: number, y: number, count: number): void {
    for (let k = 0; k < count; k++) {
      this.thrown.push({
        x: x + (Math.random() - 0.5) * 0.4,
        y,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.6 - Math.random() * 0.5,
        age: 0,
        life: 1100 + Math.random() * 500,
        angle: 0,
        spin: 0,
        owner: -1,
        smoke: true,
        r: 0.28 + Math.random() * 0.2,
      });
    }
  }

  private throwBrick(x: number, y: number, owner: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const v = 2.5 + Math.random() * 3.5;
    this.thrown.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 700 + Math.random() * 400,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 14,
      owner,
      smoke: false,
      r: 0,
    });
  }

  /** The sweep: a lone stretch of brick knocked down in a puff of smoke. */
  noteCrumble(block: Debris): void {
    this.smoke(block.x + 0.5, block.y + 0.5, 1);
    for (let k = 0; k < 2; k++) this.throwBrick(block.x + 0.5, block.y + 0.5, block.owner - 1);
  }

  /** A piece set down: grit puffing out from under it. */
  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    under.clear();
    this.effectGfx.clear();
    this.lateGfx.clear();
    this.flashGfx.clear();
    this.glow.begin(view.tile);
    perf.begin('flow');
    this.drawCraters(state, view);
    this.drawCorner(state, view);
    perf.end('flow');
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x6a6a70, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.figures = [];
    this.beams.begin();
    this.drawClubs(state, view, frame);
    drawMainCastles(this.effectGfx, view, state, this.art, frame.castleSealed);
    this.drawGuns(state, view, frame.deltaMs);
    this.beams.end();
    this.figures.sort((a, b) => a.foot - b.foot);
    this.figureStamps.begin();
    for (const f of this.figures) this.figureStamps.place(f.context, f.x, f.y, f.options);
    this.figureStamps.end();
    this.drawShells(state, view, frame);
    this.blastStamps.begin();
    this.drawBlasts(view, frame.deltaMs);
    this.drawThrown(view, frame.deltaMs);
    this.blastStamps.end();
    this.drawSplashes(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawWeather(state, view, frame.deltaMs);
    this.drawWords(view, frame.deltaMs);
    this.drawFlashes(state, view, frame.deltaMs);
    this.glow.end();
  }

  /**
   * The speakeasies, each with its street lamp — lit while sealed, as a flag is raised: the
   * sign glowing in the owner's colour, the door and windows lit, the lamp's halo on; a breach
   * sputters them out, sign and lamp on and off by turns as they fade, and letters a sound
   * word over the club. A player's who is out has theirs closed: dark, a plank across the door,
   * its lamp broken.
   */
  private drawClubs(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    const flicker = Math.floor(this.clock / this.style.flickerMs);
    this.lit.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      let level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      const going = !out && this.lit.lowering(castle.id);
      if (going && !this.sputtering.has(castle.id)) {
        this.sputtering.add(castle.id);
        this.bigMoment(castle.x + castle.w / 2, castle.y);
      } else if (!going) this.sputtering.delete(castle.id);
      if (going && !still && hash(castle.id, flicker, 7120) < 0.5) level = 0;
      const club: Club = out ? 'closed' : level > 0.5 ? 'lit' : 'dark';
      const figure = this.book.get(`club|${out ? -1 : player}|${club}`, t, (k) =>
        drawClub(
          k,
          t,
          out ? DEAD : this.colour(player, 'base'),
          out ? DEAD : this.colour(player, 'dark'),
          club,
          this.hatch,
        ),
      );
      const x = tileX(view, castle.x + castle.w / 2);
      const y = tileY(view, castle.y + castle.h) - t * 0.04;
      this.figures.push({ foot: y, context: figure, x, y });
      // The neon's halo over the door, in the owner's colour.
      if (level > 0) {
        this.glow.disc(
          x,
          y - t * 1.55,
          t * 0.9,
          this.colour(player, 'light'),
          this.style.glowAlpha * level,
        );
      }
      // The street lamp at the club's corner, its head's halo, and the pool of light at its foot.
      const lx = tileX(view, castle.x) + t * 0.1;
      const lamp = this.book.get(`lamp|${out ? 'broken' : level > 0 ? 'on' : 'off'}`, t, (k) =>
        drawLamp(k, t, out ? 'broken' : level > 0 ? 'on' : 'off'),
      );
      this.figures.push({ foot: y + t * 0.01, context: lamp, x: lx, y });
      if (level > 0) {
        this.glow.disc(lx, y - t * 1.9, t * 0.35, LAMP, this.style.glowAlpha * level);
        this.glow.disc(lx + t * 0.3, y, t * 1.1, LAMP, this.style.glowAlpha * 0.25 * level);
      }
    }
  }

  /**
   * The guns, rooftop guns behind a shield in the owner's colour, facing their target: a live
   * one's searchlight sweeping the night; firing, it kicks back in a white muzzle flash that
   * lights what is round it; a silenced one stands in the dark, hatched over, its barrel down.
   */
  private drawGuns(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const beam = this.book.get('beam', t, (k) => {
      k.poly([0, 0, t * 4.5, -t * 0.7, t * 4.5, t * 0.7]);
      k.fill({ color: LAMP, alpha: 0.16 });
    });
    const flash = this.book.get('muzzle', t, (k) => {
      const points: number[] = [];
      for (let n = 0; n < 16; n++) {
        const a = (n / 16) * Math.PI * 2;
        const r = t * (n % 2 === 0 ? 0.55 : 0.22);
        points.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      k.poly(points);
      k.fill({ color: 0xffffff });
      k.stroke({ width: Math.max(1, t * 0.05), color: NOIR_INK });
    });
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const firing = cannon.active && aim.firedAgo < FIRE_MS;
      const mood: Mood = !cannon.active ? 'dark' : firing ? 'fire' : 'ready';
      const figure = this.book.get(`gun|${cannon.owner}|${mood}`, t, (k) =>
        drawGun(k, t, this.colour(cannon.owner, 'base'), mood, this.crossHatch),
      );
      const kick =
        firing && !still ? -dir * t * 0.12 * Math.sin((aim.firedAgo / FIRE_MS) * Math.PI) : 0;
      const x = tileX(view, cannon.x + cannon.w / 2) + kick;
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.2;
      this.figures.push({ foot, context: figure, x, y: foot, options: { scale: dir, scaleY: 1 } });
      if (mood === 'dark') continue;
      // The searchlight, from the lamp on the shield, sweeping slowly to and fro.
      const sweep = still
        ? 0
        : Math.sin((this.clock / this.style.searchlightSweepMs) * Math.PI * 2 + cannon.id) * 0.7;
      const from = { x: x + dir * t * 0.15, y: foot - t * 0.95 };
      this.beams.place(beam, from.x, from.y, {
        rotation: (dir > 0 ? -0.5 : Math.PI + 0.5) + sweep,
      });
      if (firing) {
        const q = aim.firedAgo / FIRE_MS;
        const mx = x + dir * t * 0.95;
        const my = foot - t * 0.62;
        this.figures.push({
          foot: foot + 0.01,
          context: flash,
          x: mx,
          y: my,
          options: { scale: 1.2 - 0.5 * q, alpha: 1 - q, rotation: q },
        });
        this.glow.disc(mx, my, t * 0.9, 0xffffff, 0.3 * (1 - q));
      }
    }
    this.aims.prune(state);
  }

  /** Shells: dark, a glint along their back, speed lines behind them, a shadow under. */
  private drawShells(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const shell = this.book.get('shell', t, (k) => {
      k.ellipse(0, 0, t * 0.2, t * 0.14);
      k.fill({ color: 0x2a2a30 });
      k.ellipse(-t * 0.04, -t * 0.05, t * 0.1, t * 0.04);
      k.fill({ color: NOIR_PAPER, alpha: 0.85 });
      k.ellipse(0, 0, t * 0.2, t * 0.14);
      k.stroke({ width: Math.max(1, t * 0.05), color: NOIR_INK });
    });
    const g = this.effectGfx;
    this.shellStamps.begin();
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const at = (q: number): [number, number] => [
        tileX(view, shot.fromX + (shot.toX - shot.fromX) * q + 0.5),
        tileY(view, shot.fromY + (shot.toY - shot.fromY) * q + 0.5) - shotLift(shot, q) * t,
      ];
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      this.underGfx.ellipse(gx, gy, t * 0.2, t * 0.07);
      this.underGfx.fill({ color: NOIR_INK, alpha: 0.4 });
      const [x, y] = at(p);
      const [bx, by] = at(Math.max(0, p - 0.06));
      const len = Math.hypot(x - bx, y - by) || 1;
      const ux = (x - bx) / len;
      const uy = (y - by) / len;
      // Three speed lines trailing it, the middle one longest.
      for (const [side, back] of [
        [-0.13, 0.7],
        [0, 1.1],
        [0.13, 0.7],
      ] as const) {
        const sx = x - ux * t * 0.3 - uy * t * side;
        const sy = y - uy * t * 0.3 + ux * t * side;
        g.moveTo(sx, sy).lineTo(sx - ux * t * back, sy - uy * t * back);
      }
      g.stroke({ width: Math.max(1, t * 0.045), color: NOIR_PAPER, alpha: 0.85 });
      this.shellStamps.place(shell, x, y, { rotation: Math.atan2(uy, ux) });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
    this.shellStamps.end();
  }

  /** A blast where a shell strikes, cel-shaded in three hard tones of white and grey, inked. */
  private drawBlasts(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const tones: readonly [number, number, number][] = [
      [0.75, 0x8a8a90, 0],
      [0.55, 0xd8d8d8, 1],
      [0.32, 0xffffff, 2],
    ];
    const blast = this.book.get('blast', t, (k) => {
      for (const [r, colour, n] of tones) {
        const points: number[] = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + n * 0.3;
          const d = t * r * (i % 2 === 0 ? 1 : 0.62);
          points.push(Math.cos(a) * d, Math.sin(a) * d);
        }
        k.poly(points);
        k.fill({ color: colour });
        if (n === 0) k.stroke({ width: Math.max(1, t * 0.07), color: NOIR_INK, join: 'round' });
      }
    });
    for (const b of this.blasts) {
      b.age += deltaMs;
      const k = b.age / BLAST_MS;
      if (k >= 1) continue;
      const grow = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) * 0.4;
      this.blastStamps.place(blast, tileX(view, b.x + 0.5), tileY(view, b.y + 0.4), {
        scale: 0.5 + 0.8 * grow,
        alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
        rotation: k * 0.4,
      });
      if (k < 0.3)
        this.glow.disc(
          tileX(view, b.x + 0.5),
          tileY(view, b.y + 0.4),
          t * 0.8,
          0xffffff,
          0.25 * (1 - k / 0.3),
        );
    }
    this.blasts = this.blasts.filter((b) => b.age < BLAST_MS);
  }

  /** Bricks flying in the owner's colour, inked; smoke curling up in outlined puffs. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const brick = this.book.get('brick', t, (k) => {
      k.rect(-t * 0.13, -t * 0.07, t * 0.26, t * 0.14);
      k.fill({ color: 0xffffff });
      k.stroke({ width: Math.max(1, t * 0.04), color: NOIR_INK });
    });
    const puff = this.book.get('smoke', t, (k) => {
      k.circle(0, 0, t * 0.5);
      k.fill({ color: 0x9a9aa0 });
      k.circle(-t * 0.12, -t * 0.14, t * 0.24);
      k.fill({ color: 0xc8c8cc });
      k.circle(0, 0, t * 0.5);
      k.stroke({ width: Math.max(1, t * 0.06), color: NOIR_INK });
    });
    const dt = deltaMs / 1000;
    for (const s of this.thrown) {
      s.age += deltaMs;
      if (s.smoke) {
        s.vx *= Math.exp(-0.8 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      } else {
        s.vy += 7 * dt;
        s.vx *= Math.exp(-1.5 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.angle += s.spin * dt;
      }
      const k = s.age / s.life;
      if (k >= 1) continue;
      if (s.smoke) {
        this.blastStamps.place(puff, tileX(view, s.x), tileY(view, s.y), {
          scale: (s.r / 0.5) * (0.6 + 0.9 * k),
          alpha: 0.9 * (1 - k),
        });
      } else {
        this.blastStamps.place(brick, tileX(view, s.x), tileY(view, s.y), {
          rotation: s.angle,
          alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
          tint: s.owner < 0 ? DEAD : this.colour(s.owner, 'base'),
        });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /** A shell in the harbour: a ring spreading on the black water, white spray thrown up. */
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
      g.stroke({ width: Math.max(1, t * 0.05), color: NOIR_PAPER, alpha: 0.8 * (1 - k) });
      if (k < 0.6) {
        const q = k / 0.6;
        for (let n = 0; n < 5; n++) {
          const a = -Math.PI * (0.15 + 0.7 * (n / 4));
          g.rect(
            x + Math.cos(a) * t * (0.2 + 0.6 * q),
            y + Math.sin(a) * t * (0.2 + 0.7 * q) + q * q * t * 0.7,
            t * 0.07,
            t * 0.14,
          );
        }
        g.fill({ color: NOIR_PAPER, alpha: 1 - q });
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /**
   * The weather: rain in slanting ink strokes, falling pale through the light; heavier in the
   * final round's storm. A foggy match has banks of fog and no rain; a clear one is a dry
   * night, the drains steaming. None of it moves with motion reduced.
   */
  private drawWeather(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.rainStamps.begin();
    this.mist.begin(t);
    const storm = climax(state);
    const rain = storm || (this.weather !== 'fog' && this.weather !== 'clear');
    const count = !rain ? 0 : storm ? this.style.stormRainCount : this.style.rainCount;
    if (!still) {
      while (this.drops.length < count) {
        this.drops.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          speed: 9 + Math.random() * 5,
          len: 0.5 + Math.random() * 0.5,
        });
      }
      if (this.drops.length > count) this.drops.length = count;
      const drop = this.book.get('drop', t, (k) => {
        k.moveTo(0, -t * 0.5).lineTo(0, t * 0.5);
        k.stroke({ width: Math.max(1, t * 0.035), color: 0xc8c8d0 });
      });
      const dt = deltaMs / 1000;
      const slant = storm ? 0.32 : 0.18;
      for (const d of this.drops) {
        d.y += d.speed * dt;
        d.x += d.speed * slant * dt;
        if (d.y > rows) {
          d.y = -1;
          d.x = Math.random() * cols;
        }
        if (d.x > cols + 1) d.x -= cols + 2;
        this.rainStamps.place(drop, d.x * t, view.top + d.y * t, {
          rotation: -slant,
          scaleY: d.len,
          alpha: 0.45,
        });
      }
    }
    if (this.weather === 'fog' && !storm) {
      const { mistBanks, mistAlpha } = this.style;
      for (let n = 0; n < mistBanks; n++) {
        const drift = still ? 0 : this.clock / 60000;
        const fx = (((hash(n, this.seed, 7130) + drift * (0.5 + hash(n, 1, 7131))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 7132);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.2],
          [2.5, 0.5, 2.4],
          [-2.3, 0.6, 2.2],
        ] as const) {
          for (const f of [1, 0.75, 0.5]) {
            this.mist.disc(x + dx * t, y + dy * t, r * t * f, 0xb8b8c0, mistAlpha / 3);
          }
        }
      }
    }
    if (this.weather === 'clear' && !storm && !still && this.terrain !== null) {
      // Steam from the drains: grates in the street, a plume rising and thinning from each.
      for (let n = 0; n < this.style.steamVents; n++) {
        const i = Math.floor(hash(n, this.seed, 7133) * this.terrain.length);
        const x = i % this.width;
        const y = (i - x) / this.width;
        if (!this.land(x, y)) continue;
        for (let k = 0; k < 4; k++) {
          const rise = (((this.clock / 2600 + k / 4 + hash(n, k, 7134)) % 1) + 1) % 1;
          this.mist.disc(
            tileX(view, x + 0.5 + Math.sin(this.clock / 700 + k) * 0.15),
            tileY(view, y + 0.5 - rise * 1.6),
            t * (0.25 + rise * 0.5),
            0xd8d8dc,
            0.18 * (1 - rise),
          );
        }
      }
    }
    this.rainStamps.end();
    this.mist.end();
  }

  /** The sound words, popping up big over a moment and fading: white, inked thick, tilted. */
  private drawWords(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const life = this.style.wordMs;
    this.words = this.words.filter((w) => (w.age += deltaMs) < life);
    while (this.wordPool.length < this.words.length) {
      const word = new Text({
        text: '',
        style: {
          fontFamily: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
          fontSize: 48,
          fontWeight: '900',
          fill: 0xffffff,
          stroke: { color: NOIR_INK, width: 8, join: 'round' },
          letterSpacing: 2,
        },
      });
      word.anchor.set(0.5);
      this.wordPool.push(word);
      this.wordLayer.addChild(word);
    }
    this.wordPool.forEach((word, n) => {
      const w = this.words[n];
      word.visible = w !== undefined;
      if (w === undefined) return;
      if (word.text !== w.text) word.text = w.text;
      const k = w.age / life;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : k < 0.25 ? 1.2 - ((k - 0.15) / 0.1) * 0.2 : 1;
      word.scale.set(((t * 1.1) / 48) * pop);
      word.rotation = w.tilt;
      word.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      word.position.set(tileX(view, w.x), tileY(view, w.y) - k * t * 0.4);
    });
  }

  /**
   * Over everything, briefly: the final round's lightning, the whole scene white for a blink,
   * struck twice. Not with motion reduced: it is a flash.
   */
  private drawFlashes(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.flashGfx;
    if (motionReduced()) return;
    if (!climax(state)) {
      this.strike = -1;
      return;
    }
    if (this.nextStrike === 0)
      this.nextStrike = this.clock + this.style.lightningEveryMs * Math.random();
    if (this.strike < 0 && this.clock >= this.nextStrike) this.strike = 0;
    if (this.strike >= 0) {
      this.strike += deltaMs;
      // Struck twice: a long blink, a dark beat, a short one.
      const lit =
        this.strike < 90 ? 1 - this.strike / 180 : this.strike > 160 && this.strike < 220 ? 0.4 : 0;
      if (lit > 0) {
        g.rect(0, 0, view.width, view.height);
        g.fill({ color: 0xffffff, alpha: 0.5 * lit });
      }
      if (this.strike > 260) {
        this.strike = -1;
        this.nextStrike = this.clock + this.style.lightningEveryMs * (0.5 + Math.random());
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
      // The piece in hand, chalked out in the owner's colour and inked round; where it does not
      // fit, grey, its edge jagged and shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.5 : 0.45,
      });
      const edge = outline(cells, inPiece, view);
      if (ghost.valid) {
        trace(g, edge);
        g.stroke({ width: Math.max(2, t * 0.14), color: NOIR_INK });
        edge.forEach((s, n) => {
          if (n % 2 === 1) return;
          g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
        });
        g.stroke({ width: Math.max(1, t * 0.06), color: NOIR_PAPER });
        return;
      }
      const shake = Math.sin(now / 30) * t * 0.05;
      for (const s of edge) {
        const mx = (s.x1 + s.x2) / 2 + shake;
        const my = (s.y1 + s.y2) / 2 - shake;
        g.moveTo(s.x1, s.y1).lineTo(mx + (s.y2 - s.y1) * 0.15, my - (s.x2 - s.x1) * 0.15);
        g.lineTo(s.x2, s.y2);
      }
      g.stroke({ width: Math.max(2, t * 0.1), color: NOIR_PAPER, alpha: 0.9 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The gun's place, chalked on the street, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.rect(x + t * 0.1, y + t * 0.1, w - t * 0.2, h - t * 0.2);
      g.fill({ color: colour, alpha: 0.25 });
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

/**
 * A speakeasy, its foot's middle at the origin, `t` a tile: a brick front, lit on its left and
 * hatched on its right, a cornice inked along its top, two windows and a door, and over the
 * door a neon sign — a bar and a zigzag of tube in the owner's colour. Lit: the sign bright, a
 * white core along its tube, the windows and the door lit warm. Dark: the sign a dead tube, the
 * windows black. Closed: grey, the door boarded across, a sign hanging crooked from one nail.
 */
function drawClub(
  g: Graphics,
  t: number,
  colour: number,
  dark: number,
  club: Club,
  hatch: FillPattern | null,
): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.06));
  g.rect(-u(0.8), -u(0.06), u(1.75), u(0.14));
  g.fill({ color: NOIR_INK, alpha: 0.5 });
  // The front, and its side in shadow.
  g.rect(-u(0.78), -u(1.7), u(1.2), u(1.7));
  g.fill({ color: club === 'closed' ? 0x3a3a40 : FACADE_LIT });
  g.rect(u(0.42), -u(1.7), u(0.36), u(1.7));
  g.fill({ color: FACADE });
  if (hatch !== null) {
    g.rect(u(0.42), -u(1.7), u(0.36), u(1.7));
    g.fill({ fill: hatch, alpha: 0.6 });
  }
  g.rect(-u(0.86), -u(1.84), u(1.72), u(0.16));
  g.fill({ color: FACADE });
  // Windows and the door.
  const lit = club === 'lit';
  for (const wx of [-0.62, 0.12]) g.rect(u(wx), -u(1.08), u(0.24), u(0.3));
  g.fill({ color: lit ? LAMP : NOIR_INK });
  g.rect(-u(0.2), -u(0.6), u(0.3), u(0.6));
  g.fill({ color: lit ? LAMP : 0x101014 });
  if (lit) {
    // Light thrown out of the door onto the street.
    g.poly([-u(0.2), 0, u(0.1), 0, u(0.32), u(0.3), -u(0.42), u(0.3)]);
    g.fill({ color: LAMP, alpha: 0.35 });
  }
  g.rect(-u(0.78), -u(1.7), u(1.56), u(1.7));
  g.rect(-u(0.86), -u(1.84), u(1.72), u(0.16));
  g.stroke({ width: ink, color: NOIR_INK });
  for (const wx of [-0.62, 0.12]) g.rect(u(wx), -u(1.08), u(0.24), u(0.3));
  g.rect(-u(0.2), -u(0.6), u(0.3), u(0.6));
  g.stroke({ width: Math.max(1, ink * 0.7), color: NOIR_INK });
  if (club === 'dark') {
    // A faint rim of the night's light round the dark club, just outside its ink, so it can
    // be found on the dark cobbles — the town's one way to say where a castle stands unlit.
    const o = 0.06;
    g.poly([
      -u(0.78 + o),
      u(o),
      -u(0.78 + o),
      -u(1.68 - o),
      -u(0.86 + o),
      -u(1.68 - o),
      -u(0.86 + o),
      -u(1.84 + o),
      u(0.86 + o),
      -u(1.84 + o),
      u(0.86 + o),
      -u(1.68 - o),
      u(0.78 + o),
      -u(1.68 - o),
      u(0.78 + o),
      u(o),
    ]);
    g.stroke({ width: Math.max(1, ink * 0.8), color: NOIR_PAPER, alpha: 0.5, join: 'miter' });
  }
  if (club === 'closed') {
    // Boarded across, and a plank of a sign hanging from one nail.
    g.moveTo(-u(0.26), -u(0.48)).lineTo(u(0.16), -u(0.2));
    g.moveTo(-u(0.26), -u(0.2)).lineTo(u(0.16), -u(0.46));
    g.stroke({ width: Math.max(1.5, u(0.07)), color: 0x6a6a70 });
    g.poly([-u(0.4), -u(1.5), u(0.32), -u(1.62), u(0.36), -u(1.36), -u(0.36), -u(1.24)]);
    g.fill({ color: 0x8a8a90 });
    g.stroke({ width: ink, color: NOIR_INK });
    for (let k = 0; k < 4; k++) {
      g.rect(-u(0.24) + u(k * 0.15), -u(1.46) + u(k * -0.02), u(0.08), u(0.1));
    }
    g.fill({ color: NOIR_INK });
    return;
  }
  // The neon over the door: a bar and a zigzag of tube.
  const tube = [
    [-u(0.5), -u(1.38)],
    [-u(0.28), -u(1.52)],
    [-u(0.06), -u(1.38)],
    [u(0.16), -u(1.52)],
    [u(0.38), -u(1.38)],
  ];
  g.moveTo(-u(0.55), -u(1.24)).lineTo(u(0.43), -u(1.24));
  g.moveTo(tube[0]![0]!, tube[0]![1]!);
  for (const [x, y] of tube.slice(1)) g.lineTo(x!, y!);
  g.stroke({ width: Math.max(2, u(0.1)), color: lit ? colour : dark, cap: 'round', join: 'round' });
  if (lit) {
    g.moveTo(-u(0.55), -u(1.24)).lineTo(u(0.43), -u(1.24));
    g.moveTo(tube[0]![0]!, tube[0]![1]!);
    for (const [x, y] of tube.slice(1)) g.lineTo(x!, y!);
    g.stroke({ width: Math.max(1, u(0.035)), color: 0xffffff, cap: 'round', join: 'round' });
  }
}

/** A street lamp, its foot at the origin: on, its glass white; off, dark; broken, bent and smashed. */
function drawLamp(g: Graphics, t: number, state: 'on' | 'off' | 'broken'): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.05));
  const lean = state === 'broken' ? 0.22 : 0;
  g.moveTo(0, 0).lineTo(u(lean), -u(1.8));
  g.stroke({ width: Math.max(1.5, u(0.08)), color: NOIR_INK });
  g.poly([
    u(lean) - u(0.14),
    -u(1.8),
    u(lean) + u(0.14),
    -u(1.8),
    u(lean) + u(0.08),
    -u(2.0),
    u(lean) - u(0.08),
    -u(2.0),
  ]);
  g.fill({ color: state === 'on' ? 0xffffff : state === 'off' ? 0x2a2a30 : 0x1a1a1e });
  g.stroke({ width: ink, color: NOIR_INK });
  if (state === 'broken') {
    for (let k = 0; k < 3; k++) {
      g.moveTo(u(0.1 + k * 0.12), -u(0.05)).lineTo(u(0.16 + k * 0.12), -u(0.12));
    }
    g.stroke({ width: ink, color: 0x8a8a90 });
  }
}

/**
 * A rooftop gun facing right, its foot at the origin: a sandbagged emplacement, a shield in the
 * owner's colour lit on its top and hatched on its face, a barrel and a searchlight on top.
 * Firing, the barrel is run back; dark, it is hatched over and its barrel hangs.
 */
function drawGun(
  g: Graphics,
  t: number,
  colour: number,
  mood: Mood,
  crossHatch: FillPattern | null,
): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.055));
  g.ellipse(0, u(0.05), u(0.8), u(0.18));
  g.fill({ color: NOIR_INK, alpha: 0.45 });
  // Sandbags, two rows.
  for (const [row, n] of [
    [0, 4],
    [1, 3],
  ] as const) {
    for (let k = 0; k < n; k++) {
      g.roundRect(u(-0.72 + row * 0.18 + k * 0.38), u(-0.2 - row * 0.2), u(0.36), u(0.2), u(0.08));
    }
  }
  g.fill({ color: 0x8a8a84 });
  g.stroke({ width: Math.max(1, ink * 0.8), color: NOIR_INK });
  // The barrel.
  const run = mood === 'fire' ? -0.18 : 0;
  const droop = mood === 'dark' ? 0.3 : 0;
  g.poly([
    u(0.0 + run),
    -u(0.68),
    u(0.95 + run),
    -u(0.66 - droop),
    u(0.95 + run),
    -u(0.54 - droop),
    u(0.0 + run),
    -u(0.52),
  ]);
  g.fill({ color: 0x2a2a30 });
  g.stroke({ width: ink, color: NOIR_INK });
  // The shield: in the owner's colour, or, silenced, grey with only a band of it along its top
  // — the owner still told, but a gun dark in build no longer passing for one merely idle.
  const dark = mood === 'dark';
  g.poly([-u(0.42), -u(0.4), u(0.32), -u(0.4), u(0.22), -u(0.92), -u(0.32), -u(0.92)]);
  g.fill({ color: dark ? 0x48484e : colour });
  if (dark) {
    g.poly([-u(0.32), -u(0.92), u(0.22), -u(0.92), u(0.2), -u(0.8), -u(0.34), -u(0.8)]);
    g.fill({ color: colour });
  }
  g.poly([u(0.32), -u(0.4), u(0.22), -u(0.92), u(0.02), -u(0.92), u(0.1), -u(0.4)]);
  g.fill({ color: 0x000000, alpha: 0.35 });
  g.poly([-u(0.42), -u(0.4), u(0.32), -u(0.4), u(0.22), -u(0.92), -u(0.32), -u(0.92)]);
  g.stroke({ width: ink, color: NOIR_INK, join: 'round' });
  // The searchlight on top.
  g.rect(-u(0.08), -u(1.08), u(0.3), u(0.18));
  g.fill({ color: dark ? 0x2a2a30 : 0xd8d8d8 });
  g.stroke({ width: ink, color: NOIR_INK });
  if (dark && crossHatch !== null) {
    g.rect(-u(0.8), -u(1.15), u(1.8), u(1.2));
    g.fill({ fill: crossHatch, alpha: 0.8 });
  }
}

/**
 * The detective, the corner's middle at (cx, cy), `s` its square: a lamp post, its hard cone of
 * light on the wet stones, and a man in silhouette leaning on it — trench coat belted, collar
 * up, a fedora pulled low — looking out to sea or over his shoulder.
 */
function drawDetective(g: Graphics, cx: number, cy: number, s: number, over: boolean): void {
  const ink = Math.max(1, s * 0.012);
  const foot = cy + s * 0.36;
  const px = cx - s * 0.2;
  // The pavement under the lamp, and its cone of light.
  g.ellipse(cx, foot + s * 0.02, s * 0.42, s * 0.07);
  g.fill({ color: 0x2a2a30 });
  g.poly([
    px - s * 0.06,
    cy - s * 0.38,
    px + s * 0.06,
    cy - s * 0.38,
    px + s * 0.34,
    foot,
    px - s * 0.3,
    foot,
  ]);
  g.fill({ color: LAMP, alpha: 0.16 });
  g.ellipse(px + s * 0.02, foot, s * 0.32, s * 0.05);
  g.fill({ color: LAMP, alpha: 0.28 });
  // The post and its lamp.
  g.rect(px - s * 0.015, cy - s * 0.38, s * 0.03, foot - (cy - s * 0.38));
  g.fill({ color: NOIR_INK });
  g.poly([
    px - s * 0.06,
    cy - s * 0.38,
    px + s * 0.06,
    cy - s * 0.38,
    px + s * 0.035,
    cy - s * 0.46,
    px - s * 0.035,
    cy - s * 0.46,
  ]);
  g.fill({ color: 0xffffff });
  g.stroke({ width: ink, color: NOIR_INK });
  // The man: coat, collar, hat.
  const mx = cx + s * 0.06;
  g.poly([
    mx - s * 0.1,
    foot,
    mx + s * 0.11,
    foot,
    mx + s * 0.08,
    cy - s * 0.12,
    mx - s * 0.08,
    cy - s * 0.12,
  ]);
  g.fill({ color: 0x18181c });
  g.rect(mx - s * 0.085, cy + s * 0.08, s * 0.17, s * 0.025);
  g.fill({ color: 0x3a3a42 });
  g.poly([
    mx - s * 0.09,
    cy - s * 0.1,
    mx - s * 0.04,
    cy - s * 0.2,
    mx + s * 0.05,
    cy - s * 0.2,
    mx + s * 0.1,
    cy - s * 0.1,
  ]);
  g.fill({ color: 0x24242a });
  const turn = over ? -1 : 1;
  g.circle(mx + turn * s * 0.01, cy - s * 0.22, s * 0.045);
  g.fill({ color: 0x18181c });
  g.ellipse(mx + turn * s * 0.01, cy - s * 0.255, s * 0.085, s * 0.018);
  g.rect(mx + turn * s * 0.01 - s * 0.045, cy - s * 0.31, s * 0.09, s * 0.055);
  g.fill({ color: 0x101012 });
  // Lit on one edge from the lamp, a hard rim of light.
  g.moveTo(mx - s * 0.08, cy - s * 0.12).lineTo(mx - s * 0.1, foot);
  g.stroke({ width: Math.max(1, ink * 1.4), color: LAMP, alpha: 0.7 });
}

/**
 * Noir's scenery, out of the light, none of it lit — a lamp burning is a sealed club's: a tree
 * is a dead lamp post; a pine a water tower on its legs; a bush stacked crates, or a bin with
 * a cat on it; a rock a parked 1940s car, or one in three a fire hydrant.
 */
function drawNoirScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  hatch: FillPattern | null,
): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.05);
  const shadows: (() => void)[] = [];
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.moveTo(cx, cy + t * 0.4).lineTo(cx, cy - t * 0.45);
      g.stroke({ width: Math.max(1.5, t * 0.07), color: NOIR_INK });
      g.poly([
        cx - t * 0.1,
        cy - t * 0.45,
        cx + t * 0.1,
        cy - t * 0.45,
        cx + t * 0.06,
        cy - t * 0.58,
        cx - t * 0.06,
        cy - t * 0.58,
      ]);
      g.fill({ color: 0x2a2a30 });
      g.stroke({ width: ink, color: NOIR_INK });
    } else if (item.kind === 'pine') {
      // A water tower: a barrel on four legs, a conical cap.
      for (const lx of [-0.24, -0.08, 0.08, 0.24]) {
        g.moveTo(cx + lx * t, cy + t * 0.4).lineTo(cx + lx * 0.7 * t, cy - t * 0.05);
      }
      g.stroke({ width: Math.max(1, t * 0.04), color: NOIR_INK });
      g.rect(cx - t * 0.26, cy - t * 0.5, t * 0.52, t * 0.46);
      g.fill({ color: 0x5a5a60 });
      g.rect(cx + t * 0.06, cy - t * 0.5, t * 0.2, t * 0.46);
      g.fill({ color: 0x2a2a30 });
      g.poly([cx - t * 0.3, cy - t * 0.5, cx, cy - t * 0.72, cx + t * 0.3, cy - t * 0.5]);
      g.fill({ color: 0x3a3a40 });
      g.rect(cx - t * 0.26, cy - t * 0.5, t * 0.52, t * 0.46);
      g.stroke({ width: ink, color: NOIR_INK });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        // Crates, two stacked, their sides in shadow.
        for (const [ox, oy, w] of [
          [-0.3, 0.0, 0.38],
          [0.02, 0.05, 0.32],
          [-0.18, -0.34, 0.32],
        ] as const) {
          g.rect(cx + ox * t, cy + oy * t - t * 0.05, w * t, w * t);
        }
        g.fill({ color: 0x6a6660 });
        for (const [ox, oy, w] of [
          [-0.3, 0.0, 0.38],
          [0.02, 0.05, 0.32],
          [-0.18, -0.34, 0.32],
        ] as const) {
          const x = cx + ox * t;
          const y = cy + oy * t - t * 0.05;
          g.rect(x, y, w * t, w * t);
          g.moveTo(x, y).lineTo(x + w * t, y + w * t);
        }
        g.stroke({ width: ink, color: NOIR_INK });
      } else {
        // A bin, its lid askew, a cat sitting on it.
        g.rect(cx - t * 0.18, cy - t * 0.1, t * 0.36, t * 0.42);
        g.fill({ color: 0x5a5a60 });
        g.stroke({ width: ink, color: NOIR_INK });
        g.poly([
          cx - t * 0.24,
          cy - t * 0.12,
          cx + t * 0.2,
          cy - t * 0.2,
          cx + t * 0.22,
          cy - t * 0.14,
          cx - t * 0.22,
          cy - t * 0.06,
        ]);
        g.fill({ color: 0x3a3a40 });
        g.ellipse(cx - t * 0.02, cy - t * 0.28, t * 0.1, t * 0.12);
        g.circle(cx + t * 0.04, cy - t * 0.42, t * 0.07);
        g.poly([cx, cy - t * 0.47, cx + t * 0.02, cy - t * 0.56, cx + t * 0.05, cy - t * 0.48]);
        g.poly([
          cx + t * 0.06,
          cy - t * 0.48,
          cx + t * 0.09,
          cy - t * 0.56,
          cx + t * 0.11,
          cy - t * 0.46,
        ]);
        g.fill({ color: NOIR_INK });
        g.moveTo(cx - t * 0.1, cy - t * 0.2).quadraticCurveTo(
          cx - t * 0.3,
          cy - t * 0.2,
          cx - t * 0.26,
          cy - t * 0.36,
        );
        g.stroke({ width: Math.max(1, t * 0.04), color: NOIR_INK, cap: 'round' });
      }
    } else if (item.variant % 3 === 0) {
      // A fire hydrant.
      g.rect(cx - t * 0.1, cy - t * 0.2, t * 0.2, t * 0.4);
      g.rect(cx - t * 0.16, cy - t * 0.08, t * 0.32, t * 0.08);
      g.fill({ color: 0x8a8a90 });
      g.circle(cx, cy - t * 0.22, t * 0.1);
      g.fill({ color: 0x6a6a70 });
      g.rect(cx - t * 0.1, cy - t * 0.2, t * 0.2, t * 0.4);
      g.stroke({ width: ink, color: NOIR_INK });
    } else {
      // A parked car of the forties: long bonnet, round wings, a dark glasshouse.
      shadows.push(() => g.rect(cx - t * 0.42, cy + t * 0.22, t * 0.9, t * 0.12));
      g.roundRect(cx - t * 0.45, cy - t * 0.05, t * 0.9, t * 0.28, t * 0.1);
      g.fill({ color: 0x3a3a40 });
      g.roundRect(cx - t * 0.22, cy - t * 0.26, t * 0.42, t * 0.24, t * 0.1);
      g.fill({ color: 0x2a2a30 });
      g.rect(cx - t * 0.16, cy - t * 0.21, t * 0.3, t * 0.12);
      g.fill({ color: 0x8a8a96 });
      g.roundRect(cx - t * 0.45, cy - t * 0.05, t * 0.9, t * 0.28, t * 0.1);
      g.roundRect(cx - t * 0.22, cy - t * 0.26, t * 0.42, t * 0.24, t * 0.1);
      g.stroke({ width: ink, color: NOIR_INK });
      for (const wx of [-0.26, 0.26]) g.circle(cx + wx * t, cy + t * 0.22, t * 0.09);
      g.fill({ color: NOIR_INK });
    }
  }
  if (hatch !== null && shadows.length > 0) {
    for (const s of shadows) s();
    g.fill({ fill: hatch, alpha: 0.7 });
  }
}
