import type { AnimeStyleConfig, ArtConfig } from '@bollwerk/config';
import {
  isLoaded,
  Structure,
  type Cannon,
  type Castle,
  type MatchState,
  type Shot,
} from '@bollwerk/sim';
import {
  Container,
  FillPattern,
  Graphics,
  Sprite,
  Text,
  Texture,
  type GraphicsContext,
} from 'pixi.js';

import { t as text } from '../i18n.js';
import { motionReduced } from '../motion.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { clanOf, clanOrder, cutInSpot, hairOf, heroHair, type TileBox } from './anime/clans.js';
import { drawEmblem } from './anime/emblems.js';
import {
  INK,
  drawAura,
  drawFigure,
  drawShot,
  type Clan,
  type GunState,
  type HairColours,
} from './anime/figures.js';
import { cutInSvg, type Hero } from './anime/portraits.js';
import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';
import { climaxLevel, cornerSpot, hurry } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { AnimeSeaLife } from './seaLife.js';
import { ShapeTheme } from './shapeTheme.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import { TerrainStrips, whole, type TerrainPass, type TerrainPlan } from './terrainStrips.js';
import {
  Fireworks,
  FlagHoist,
  GhostMotion,
  GunAims,
  Landings,
  MainCastles,
  RuinSmoke,
  WinnerBanners,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawCannonGhost,
  drawChoices,
  drawDrain,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
  drawSealPreview,
  drawSelectable,
  drawShotTarget,
  hex,
  shotLift,
  shotProgress,
  shotScale,
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

const WHITE = 0xffffff;
const DEAD = 0x9c9aa6;
const DEAD_DARK = 0x67656f;
const GREY_HAIR: HairColours = { base: DEAD, light: 0xc8c6d0, dark: DEAD_DARK };
const SFX_YELLOW = 0xffe14a;
const SPLASH = 0xe8f8ff;

/** How the season ends for its winners: inked stars tumbling out, and a forked banner. */
const FINISH: FinishLook = { spark: 'stars', flag: 'swallowtail' };

/** At most this many sound words on the board at once. */
const WORDS_AT_ONCE = 3;
/** A cut-in waits this long for its picture to be made, then is let go. */
const CUT_IN_WAIT_MS = 900;
/** Its slide in and out, as shares of its time on screen. */
const CUT_IN_SLIDE = 0.12;
/** How far round the event a cut-in looks for open sea, in tiles. */
const CUT_IN_REACH = 14;

interface Aged {
  x: number;
  y: number;
  age: number;
}

interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A thing thrown by a hit: a chunk of wall, a shard of a circle, a puff, a little star. */
interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  kind: 'chunk' | 'shard' | 'puff' | 'star';
  tint: number;
  r: number;
}

interface Word extends Aged {
  text: string;
  tilt: number;
}

/** A figure, a school or a circle to stamp, ordered by where it stands: nearest last. */
interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/** A cut-in asked for: its picture, and the tile it is about. */
interface CutInAsk {
  key: string;
  svg: string;
  x: number;
  y: number;
  since: number;
}

/** A cut-in on screen: its picture, where it stands, and how long it has been there. */
interface CutInShown {
  texture: Texture;
  box: TileBox;
  age: number;
}

/**
 * The Anime look, for either look (ARCHIVE 14w): the match as an anime season on a
 * summer's day. The sea is cel-painted — flat blues, a white line of surf round every coast,
 * glints popping — and the shadows of tall clouds drift over the whole board. **The guns are
 * chibi heroes** of eight clans, a clan to a team, their hair in the owner's colour: charging,
 * an aura of flame growing round them as their shot flies (flight time is the reload); ready,
 * the clan's pose with a glint in the eye; firing, a shout and speed lines; silenced, a sweat
 * drop and "…"; lulled, anime's snot bubble; once their player is out, grey with spiral eyes.
 * Each shoots its clan's own shot. Walls are cel-shaded stone in the owner's colour, sealed
 * ground manga screentone, a castle a school with a clock tower on a magic circle that turns
 * while it is sealed and shatters at a breach. At the big moments — a breach, a Bertha's shell,
 * a player knocked out — a small cut-in of the heroes' faces slides in over open sea, never
 * over anything in play. A mascot lounges on a water tank in the corner; focus lines close in
 * at the climax.
 */
export class AnimeTheme extends ShapeTheme implements Theme {
  readonly id = 'anime' as const;

  private style!: AnimeStyleConfig;
  private readonly seaLife = new AnimeSeaLife();

  private readonly terrainStrips = new TerrainStrips();
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  private readonly cornerMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawAnimeScenery(g, view, items),
    () => WHITE,
  );
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  private readonly glintStamps = new Stamps();
  private readonly cloudStamps = new Stamps();
  private readonly circleStamps = new Stamps();
  private readonly figureStamps = new Stamps();
  private figures: Figure[] = [];
  private readonly crowns = new MainCastles();
  private readonly effectGfx = new Graphics();
  private readonly shadowStamps = new Stamps();
  private readonly shotStamps = new Stamps();
  private readonly burstStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  private readonly wordLayer = new Container();
  private readonly wordPool: Text[] = [];
  private readonly cutInLayer = new Container();
  private readonly cutInSprite = new Sprite();
  private readonly glow = new Discs();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly lit = new FlagHoist();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  /** Screentone patterns by player, drawn for one tile size. */
  private tones = new Map<number, FillPattern>();
  private toneTile = 0;

  private clock = 0;
  private round = 0;
  private corner: TimerSpot | null = null;
  private state: MatchState | null = null;
  private craters: Crater[] = [];
  private thrown: Thrown[] = [];
  private splashes: Aged[] = [];
  private words: Word[] = [];
  private readonly sealed = new Map<number, boolean>();
  private readonly out = new Map<number, boolean>();
  /** Shots in flight by the tile they are headed for, to know whose shot struck where. */
  private readonly shotsAt = new Map<string, Shot>();
  /** Who last struck each player's walls: the attacker in a cut-in at their breach. */
  private readonly lastHitBy = new Map<number, number>();
  private readonly cutTextures = new Map<string, Texture | null>();
  private cutAsk: CutInAsk | null = null;
  private cutShown: CutInShown | null = null;
  private lastCutIn = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.anime;
    this.glow.container.blendMode = 'add';
    this.cutInLayer.addChild(this.cutInSprite);
    this.cutInSprite.visible = false;
    layers.terrain.addChild(
      this.terrainStrips.container,
      this.craterGfx,
      this.cornerMemos.container,
    );
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.glintStamps.container,
      this.cloudStamps.container,
      this.circleStamps.container,
      this.glow.container,
      this.figureStamps.container,
      this.crowns.gfx,
      this.effectGfx,
      this.shadowStamps.container,
      this.shotStamps.container,
      this.burstStamps.container,
      this.lateGfx,
      this.wordLayer,
      this.cutInLayer,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  /** The clans of the players, which the cannon icon shows: drawn again when they are known. */
  iconKey(): string {
    return this.state === null ? '' : this.state.players.map((_, p) => this.clan(p)).join(',');
  }

  destroy(): void {
    this.destroyed = true;
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.cornerMemos.destroy();
    for (const s of [
      this.glintStamps,
      this.cloudStamps,
      this.circleStamps,
      this.figureStamps,
      this.shadowStamps,
      this.shotStamps,
      this.burstStamps,
    ]) {
      s.destroy();
    }
    this.glow.destroy();
    this.book.destroy();
    release(this.terrainStrips.container);
    for (const g of [
      this.craterGfx,
      this.underGfx,
      this.crowns.gfx,
      this.effectGfx,
      this.lateGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
    for (const w of this.wordPool) w.destroy();
    this.cutInSprite.destroy();
    this.wordLayer.destroy();
    this.cutInLayer.destroy();
    for (const texture of this.cutTextures.values()) texture?.destroy(true);
    this.cutTextures.clear();
    this.dropTones();
  }

  private clan(player: number): Clan {
    const state = this.state;
    if (state === null) return clanOrder(this.seed)[player % 8] ?? 'karate';
    return clanOf(state, player);
  }

  private hair(player: number): HairColours {
    if (player < 0) return GREY_HAIR;
    return {
      base: this.colour(player, 'base'),
      light: this.colour(player, 'light'),
      dark: this.colour(player, 'dark'),
    };
  }

  private hero(player: number): Hero {
    const clan = this.clan(player);
    return { clan, style: heroHair(clan, player, this.seed), hair: this.hair(player) };
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The sea in flat cel blues, lighter in a band along every coast, a white line of surf at the
   * shore; the land a sandy rim round bright summer grass, inked round in a darker green.
   */
  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.state = state;
    this.terrainStrips.draw(state, view, () => this.planTerrain(state, view));
  }

  private planTerrain(state: MatchState, view: ViewTransform): TerrainPlan {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    const rim = (x: number, y: number): boolean => {
      if (!land(x, y)) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (!land(x + dx, y + dy)) return true;
      }
      return false;
    };
    const grass = (x: number, y: number): boolean => land(x, y) && !rim(x, y);
    const shallow = (x: number, y: number): boolean => !land(x, y) && near(x, y, 2);
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const cells = (from: number, to: number, keep: (x: number, y: number) => boolean): Cell[] => {
      const out: Cell[] = [];
      for (let y = Math.max(-3, from); y < Math.min(state.height + 3, to); y++) {
        for (let x = -3; x < state.width + 3; x++) if (keep(x, y)) out.push({ x, y });
      }
      return out;
    };
    const fill = (g: Graphics, list: readonly Cell[]): void => {
      for (const { x, y } of list) g.rect(tileX(view, x), tileY(view, y), t, t);
    };
    const passes: TerrainPass[] = [
      whole((g) => {
        g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
        g.fill({ color: hex(palette.waterMid) });
      }),
      (g, from, to) => {
        fill(g, cells(from, to, shallow));
        g.fill({ color: hex(palette.waterShallow) });
      },
      // The band's edge, a crisp line where cel paint would stop.
      (g, from, to) => {
        trace(
          g,
          outline(cells(from, to, shallow), (x, y) => shallow(x, y) || land(x, y), view),
        );
        g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.waterDeep), alpha: 0.5 });
      },
      (g, from, to) => {
        fill(g, cells(from, to, rim));
        g.fill({ color: hex(palette.sand) });
      },
      (g, from, to) => {
        fill(g, cells(from, to, grass));
        g.fill({ color: hex(palette.grassMid) });
      },
      // Lit patches in the grass, as a background painter dabs them: a few to an island.
      (g, from, to) => {
        fill(
          g,
          cells(from, to, (x, y) => grass(x, y) && hash(x >> 1, y >> 1, 7801) < 0.18),
        );
        g.fill({ color: hex(palette.grassLight) });
      },
      // The grass's edge inked, and the surf a white line along the shore.
      (g, from, to) => {
        trace(g, outline(cells(from, to, grass), grass, view));
        g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.grassDark) });
      },
      (g, from, to) => {
        trace(g, outline(cells(from, to, land), land, view));
        g.stroke({ width: Math.max(1.5, t * 0.12), color: hex(palette.waterFoam), alpha: 0.95 });
      },
    ];
    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.cratersDrawn = '';
    return { rows: [y0, y1], passes };
  }

  /** Scorches where shots came down, fading over the rounds. */
  private drawCraters(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => state.round - c.round < rounds);
    const key = `${state.round}|${this.craters.length}|${viewKey(view)}`;
    if (key === this.cratersDrawn) return;
    this.cratersDrawn = key;
    const g = this.craterGfx;
    clearDrawn(g);
    const t = view.tile;
    const { palette } = this.art;
    for (const c of this.craters) {
      const fade = 1 - (state.round - c.round) / rounds;
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.5);
      g.ellipse(x, y, t * 0.38, t * 0.26);
      g.fill({ color: hex(palette.craterMid), alpha: 0.85 * fade });
      g.ellipse(x + t * 0.04, y + t * 0.04, t * 0.22, t * 0.13);
      g.fill({ color: hex(palette.craterDark), alpha: 0.9 * fade });
    }
  }

  // ------------------------------------------------------------------ the mascot

  /**
   * The corner: a rooftop water tank with a round white mascot lounging on it, eyes content,
   * tail swaying; when the clock presses, startled — eyes wide, a "!", a sweat drop, fur up.
   */
  private drawCorner(state: MatchState, view: ViewTransform): void {
    this.cornerMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const hurried = hurry(state, this.art) > 0.5;
      const step = motionReduced() ? 0 : Math.floor(this.clock / 125) % 16;
      const key = `${viewKey(view)}|${hurried}|${step}`;
      this.cornerMemos.draw('mascot', key, (g) => drawMascot(g, view, spot, step, hurried));
    }
    this.cornerMemos.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as screentone: manga's dots in the owner's colour, edged in it. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.tonesFor(view.tile, state.players.length);
    this.territory.draw(state, view, (g, island) => this.drawTone(g, island, view));
  }

  private dropTones(): void {
    for (const p of this.tones.values()) p.texture.destroy(true);
    this.tones.clear();
  }

  private tonesFor(tile: number, players: number): void {
    if (tile === this.toneTile && this.tones.size >= players) return;
    this.dropTones();
    this.toneTile = tile;
    for (let p = 0; p < players; p++) this.tones.set(p, tonePattern(tile, this.colour(p, 'base')));
  }

  private drawTone(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      // The grass lifted towards white under the tone, as a printed page is.
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: WHITE, alpha: 0.5 });
      const tone = this.tones.get(player);
      if (tone !== undefined) {
        for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
        g.fill({ fill: tone, alpha: this.style.toneAlpha });
      }
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: this.colour(player, 'base'), alpha: 0.8 });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.04), color: INK, alpha: 0.6 });
    }
    dimEliminated(g, state, view, INK);
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
      this.drawStone(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    for (const cannon of state.cannons) cannonBase(g, view, cannon, null, WHITE);
  }

  /**
   * Walls as cel-shaded stone in the owner's colour: the top flat, a white rim of light along
   * its upper edge, the face in the dark shade cut into blocks, a hard shadow beneath, inked
   * round. A player's who is out, and rubble, grey.
   */
  private drawStone(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const b of wall.blocks) {
      if (joins(b.x, b.y + 1)) continue;
      g.rect(b.left + t * 0.12, b.top + t + (b.faced ? wall.face : 0), t, t * 0.2);
    }
    g.fill({ color: hex(this.art.palette.shadow), alpha: 0.3 });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'base') });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, Math.max(1, r.h * 0.2));
    g.fill({ color: WHITE, alpha: dead ? 0.2 : 0.45 });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD_DARK : this.colour(player, 'dark') });
    // The face cut into blocks, a joint every tile.
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      g.moveTo(b.left + t * (b.x % 2 === 0 ? 0.5 : 0), b.top + t);
      g.lineTo(b.left + t * (b.x % 2 === 0 ? 0.5 : 0), b.top + t + wall.face);
    }
    g.stroke({ width: Math.max(1, t * 0.04), color: INK, alpha: 0.45 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.07), color: INK, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
    this.shotsAt.set(`${shot.toX},${shot.toY}`, shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const key = `${x},${y}`;
    const shot = this.shotsAt.get(key);
    this.shotsAt.delete(key);
    const state = this.state;
    for (const block of debris) {
      if (shot !== undefined && block.owner > 0) this.lastHitBy.set(block.owner - 1, shot.owner);
    }
    if (
      shot !== undefined &&
      state !== null &&
      (shot.kind === 'bertha' || shot.kind === 'biggest')
    ) {
      const island = state.islandId[y * state.width + x] ?? 0;
      if (island > 0 && island - 1 !== shot.owner) this.askCutIn(shot.owner, island - 1, x, y);
    }
    if (!this.land(x, y) && debris.length === 0) {
      this.splashes.push({ x, y, age: 0 });
      return;
    }
    this.puffs(x + 0.5, y + 0.4, 3);
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      for (let k = 0; k < 5; k++) {
        this.throwChunk(block.x + 0.5, block.y + 0.4, block.owner - 1);
      }
    }
    if (Math.random() < this.style.wordChance) this.letter(x + 0.5, y);
  }

  /** A sound word lettered over a hit, now and then. */
  private letter(x: number, y: number): void {
    if (this.words.length >= WORDS_AT_ONCE) return;
    const all = text('anime.words').split('|');
    this.words.push({
      x,
      y: y - 0.6,
      age: 0,
      text: all[Math.floor(Math.random() * all.length)] ?? 'DOKAN!',
      tilt: (Math.random() - 0.5) * 0.5,
    });
  }

  private puffs(x: number, y: number, count: number): void {
    for (let k = 0; k < count; k++) {
      this.thrown.push({
        x: x + (Math.random() - 0.5) * 0.5,
        y,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -0.5 - Math.random() * 0.4,
        age: 0,
        life: 650 + Math.random() * 300,
        angle: 0,
        spin: 0,
        kind: 'puff',
        tint: WHITE,
        r: 0.24 + Math.random() * 0.14,
      });
    }
    // Little stars spinning out of the dust, as a cartoon hit's.
    for (let k = 0; k < 2; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.thrown.push({
        x,
        y: y - 0.2,
        vx: Math.cos(a) * 1.8,
        vy: Math.sin(a) * 1.8,
        age: 0,
        life: 600,
        angle: Math.random() * 6,
        spin: (Math.random() - 0.5) * 10,
        kind: 'star',
        tint: SFX_YELLOW,
        r: 0,
      });
    }
  }

  private throwChunk(x: number, y: number, owner: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const v = 2.5 + Math.random() * 3;
    this.thrown.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 650 + Math.random() * 350,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      kind: 'chunk',
      tint: owner < 0 ? DEAD : this.colour(owner, 'base'),
      r: 0,
    });
  }

  /** The sweep: a lone block of wall knocked over in a puff. */
  noteCrumble(block: Debris): void {
    this.puffs(block.x + 0.5, block.y + 0.5, 1);
    for (let k = 0; k < 2; k++) this.throwChunk(block.x + 0.5, block.y + 0.5, block.owner - 1);
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.state = state;
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    clearDrawn(under);
    clearDrawn(this.effectGfx);
    clearDrawn(this.lateGfx);
    this.glow.begin(view.tile);
    this.drawCraters(state, view);
    this.drawCorner(state, view);
    this.noteBreaches(state, frame);
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x8a8c9a, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.drawGlints(state, view);
    this.drawClouds(state, view);
    this.figures = [];
    this.circleStamps.begin();
    this.drawSchools(state, view, frame);
    this.circleStamps.end();
    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawGuns(state, view, frame);
    this.figures.sort((a, b) => a.foot - b.foot);
    this.figureStamps.begin();
    for (const f of this.figures) this.figureStamps.place(f.context, f.x, f.y, f.options);
    this.figureStamps.end();
    this.shadowStamps.begin();
    this.shotStamps.begin();
    this.drawShots(state, view, frame);
    this.shotStamps.end();
    this.shadowStamps.end();
    this.burstStamps.begin();
    this.drawThrown(view, frame.deltaMs);
    this.burstStamps.end();
    this.drawSplashes(view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawClimax(state, view);
    this.drawWords(view, frame.deltaMs);
    this.drawCutIn(state, view, frame);
    this.glow.end();
  }

  /**
   * A castle's seal broken in combat shatters its circle and asks for a cut-in, the attacker
   * shouting and its owner shocked; a player knocked out asks for one too.
   */
  private noteBreaches(state: MatchState, frame: EffectFrame): void {
    for (const castle of state.castles) {
      const now = frame.castleSealed[castle.id] === true;
      const was = this.sealed.get(castle.id);
      this.sealed.set(castle.id, now);
      const player = castle.islandId - 1;
      if (was !== true || now || state.phase !== 'combat') continue;
      if (state.players[player]?.eliminated !== false) continue;
      this.shatter(castle, player);
      const attacker = this.lastHitBy.get(player);
      if (attacker !== undefined) {
        this.askCutIn(attacker, player, castle.x + castle.w / 2, castle.y + castle.h / 2);
      }
    }
    for (const [p, player] of state.players.entries()) {
      const was = this.out.get(p);
      this.out.set(p, player.eliminated);
      if (was !== false || !player.eliminated) continue;
      const castle = state.castles.find((c) => c.islandId === p + 1);
      if (castle === undefined) continue;
      this.askCutIn(this.lastHitBy.get(p) ?? -1, p, castle.x + castle.w / 2, castle.y);
    }
  }

  /** The magic circle breaking: shards of it flying out in its owner's colour. */
  private shatter(castle: Castle, player: number): void {
    if (motionReduced()) return;
    const cx = castle.x + castle.w / 2;
    const cy = castle.y + castle.h / 2;
    const r = circleRadius(castle);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + Math.random() * 0.3;
      const v = 2 + Math.random() * 2.5;
      this.thrown.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 1.5,
        age: 0,
        life: this.style.shatterMs * (0.7 + Math.random() * 0.3),
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 14,
        kind: 'shard',
        tint: this.colour(player, 'light'),
        r: 0,
      });
    }
  }

  /** Sunlight glinting on the sea: four-pointed sparkles popping on open water now and then. */
  private drawGlints(state: MatchState, view: ViewTransform): void {
    this.glintStamps.begin();
    const rate = this.style.glintsPerSecond;
    if (!motionReduced() && rate > 0) {
      const t = view.tile;
      const glint = this.book.get('glint', t, (g) => drawSparkle(g, t * 0.3, WHITE));
      const slot = 1000 / rate;
      const n = Math.floor(this.clock / slot);
      const life = 700;
      for (let k = n - Math.ceil(life / slot); k <= n; k++) {
        const age = this.clock - k * slot;
        if (age < 0 || age > life) continue;
        const x = Math.floor(hash(k, this.seed, 7810) * (state.width + 8)) - 4;
        const y = Math.floor(hash(k, this.seed, 7811) * (state.height + 6)) - 3;
        if (this.land(x, y)) continue;
        const s = Math.sin((age / life) * Math.PI);
        this.glintStamps.place(glint, tileX(view, x + 0.5), tileY(view, y + 0.5), {
          scale: 0.4 + 0.8 * s,
          alpha: s,
          rotation: (age / life) * 0.6,
        });
      }
    }
    this.glintStamps.end();
  }

  /** The shadows of tall summer clouds drifting over the whole board, the guns standing in them. */
  private drawClouds(state: MatchState, view: ViewTransform): void {
    this.cloudStamps.begin();
    const { cloudShadows, cloudTilesPerSecond, cloudAlpha } = this.style;
    const t = view.tile;
    const cloud = this.book.get('cloud', t, (g) => drawCloudShadow(g, t));
    const span = state.width + 24;
    const drift = motionReduced() ? 0 : (this.clock / 1000) * cloudTilesPerSecond;
    for (let k = 0; k < cloudShadows; k++) {
      const x =
        ((hash(k, this.seed, 7820) * span + drift * (0.8 + 0.4 * hash(k, 0, 7821))) % span) - 12;
      const y = hash(k, this.seed, 7822) * state.height;
      this.cloudStamps.place(cloud, tileX(view, x), tileY(view, y), {
        alpha: cloudAlpha,
        scale: 0.8 + 0.5 * hash(k, this.seed, 7823),
        tint: hex(this.art.palette.shadow),
      });
    }
    this.cloudStamps.end();
  }

  /**
   * The schools on their magic circles: the circle turning under each while it is sealed, its
   * clan's emblems round it, glowing faintly; gone while it is open; the school greyed once its
   * player is out.
   */
  private drawSchools(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.lit.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      const cx = tileX(view, castle.x + castle.w / 2);
      const cy = tileY(view, castle.y + castle.h / 2);
      if (level > 0) {
        const clan = this.clan(player);
        const r = circleRadius(castle);
        const circle = this.book.get(`circle|${clan}`, t, (g) => drawMagicCircle(g, t, r, clan));
        const turn = still
          ? 0
          : ((this.clock + castle.id * 1700) / this.style.circleTurnMs) * Math.PI * 2;
        this.circleStamps.place(circle, cx, cy, {
          rotation: turn,
          scale: 0.7 + 0.3 * level,
          alpha: level,
          tint: this.colour(player, 'light'),
        });
        this.glow.disc(cx, cy, r * t, this.colour(player, 'light'), 0.12 * level);
      }
      const school = this.book.get(`school|${out ? -1 : player}`, t, (g) =>
        drawSchool(g, t, out ? DEAD : this.colour(player, 'base'), out),
      );
      const foot = tileY(view, castle.y + castle.h) - t * 0.1;
      this.figures.push({ foot, context: school, x: cx, y: foot });
    }
  }

  /** The cannon icon: the player's clan's hero, ready, facing right. */
  drawCannonIcon(root: Container, size: number, player: number): void {
    const clan = this.clan(player);
    const t = size / 2.3;
    const fig = new Graphics();
    drawFigure(fig, t, {
      clan,
      hairstyle: heroHair(clan, player, this.seed),
      hair: this.hair(player),
      state: 'ready',
    });
    const box = new Container();
    box.addChild(fig);
    const b = box.getLocalBounds();
    const scale = Math.min(1, (size * 0.96) / Math.max(b.width, b.height));
    box.scale.set(scale);
    box.position.set(
      size / 2 - (b.x + b.width / 2) * scale,
      size / 2 - (b.y + b.height / 2) * scale,
    );
    root.addChild(box);
  }

  /** A gun's state as its figure shows it, and how far its charge has come. */
  private gunState(
    state: MatchState,
    cannon: Cannon,
    firedAgo: number,
    flying: ReadonlyMap<number, Shot>,
    now: number,
  ): { look: GunState; charge: number } {
    if (state.players[cannon.owner]?.eliminated !== false) return { look: 'out', charge: 0 };
    if (cannon.asleepUntil !== undefined && cannon.asleepUntil > state.tick) {
      return { look: 'lulled', charge: 0 };
    }
    if (!cannon.active) return { look: 'inert', charge: 0 };
    if (firedAgo < this.style.fireMs) return { look: 'fire', charge: 0 };
    if (isLoaded(cannon)) return { look: 'ready', charge: 1 };
    const shot = flying.get(cannon.shotIds[0] ?? -1);
    return { look: 'charge', charge: shot === undefined ? 0.5 : shotProgress(shot, now) };
  }

  /**
   * The guns: a chibi hero each, of its owner's clan, facing its target, breathing; the aura a
   * stamp of its own, grown with the charge so it needs no drawing again.
   */
  private drawGuns(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    const now = state.tick + frame.tickFraction;
    const flying = new Map(state.shots.map((s) => [s.id, s]));
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += frame.deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const { look, charge } = this.gunState(state, cannon, aim.firedAgo, flying, now);
      const owner = look === 'out' ? -1 : cannon.owner;
      const clan = this.clan(cannon.owner);
      const hairstyle = hairOf(clan, cannon.id, this.seed);
      const hair = this.hair(owner);
      const scale = Math.max(1, Math.min(cannon.w, cannon.h) / 2);
      const x = tileX(view, cannon.x + cannon.w / 2);
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.12;
      const bob =
        still || (look !== 'ready' && look !== 'charge')
          ? 0
          : Math.sin(((this.clock + cannon.id * 370) / this.style.breatheMs) * Math.PI * 2);
      if (look === 'ready' || look === 'charge') {
        const full = look === 'ready';
        const aura = this.book.get(`aura|${owner}|${full}`, t, (g) => drawAura(g, t, hair, full));
        const k = full ? 1 : 0.25 + 0.75 * charge;
        this.figures.push({
          foot: foot - 0.002,
          context: aura,
          x,
          y: foot,
          options: { scale: dir * scale * (0.6 + 0.4 * k), scaleY: scale * k },
        });
      }
      const figure = this.book.get(`fig|${clan}|${hairstyle}|${look}|${owner}`, t, (g) =>
        drawFigure(g, t, { clan, hairstyle, hair, state: look, aura: false }),
      );
      this.figures.push({
        foot,
        context: figure,
        x,
        y: foot - bob * t * 0.02,
        options: { scale: dir * scale, scaleY: scale * (1 + bob * 0.015) },
      });
    }
    this.aims.prune(state);
  }

  /**
   * Shots: each clan's own, along the sim's arc, turned along its flight and never upside down;
   * a shadow on the ground beneath.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const shadow = this.book.get('shadow', t, (g) => {
      g.ellipse(0, 0, t * 0.2, t * 0.07);
      g.fill({ color: 0x000000 });
    });
    const live = new Set<string>();
    for (const shot of state.shots) {
      live.add(`${shot.toX},${shot.toY}`);
      const p = shotProgress(shot, now);
      const at = (q: number): [number, number, number] => {
        const gx = shot.fromX + (shot.toX - shot.fromX) * q + 0.5;
        const gy = shot.fromY + (shot.toY - shot.fromY) * q + 0.5;
        return [gx, gy - shotLift(shot, q) - 0.6 * (1 - q), gy];
      };
      const [bx, by, ground] = at(p);
      const [nx, ny] = at(Math.min(1, p + 0.02));
      this.shadowStamps.place(shadow, tileX(view, bx), tileY(view, ground), { alpha: 0.25 });
      const clan = this.clan(shot.owner);
      const context = this.book.get(`shot|${clan}`, t, (g) => drawShot(g, t, clan));
      const vx = nx - bx;
      const vy = ny - by;
      const left = vx < 0;
      const rotation = left ? Math.atan2(-vy, -vx) : Math.atan2(vy, vx);
      // A teacup or a heart is kept upright; what flies point first is turned along its path.
      const turned = clan !== 'maid' && clan !== 'idol' && clan !== 'karate';
      // Half again as big as drawn: a teacup or a paper plane at its true size was a speck.
      const grow = shotScale(shot, this.art) * 1.5;
      this.shotStamps.place(context, tileX(view, bx), tileY(view, by), {
        rotation: turned ? rotation : 0,
        scale: (left ? -1 : 1) * grow,
        scaleY: grow,
      });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
    // Forget shots that struck nothing noted, so the map keeps to those in flight.
    if (this.shotsAt.size > live.size + 16) {
      for (const key of this.shotsAt.keys()) if (!live.has(key)) this.shotsAt.delete(key);
    }
  }

  /** Chunks of wall, shards of a circle, puffs of dust and little stars, flying and fading. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const chunk = this.book.get('chunk', t, (g) => {
      g.rect(-t * 0.11, -t * 0.08, t * 0.22, t * 0.16);
      g.fill({ color: WHITE });
      g.stroke({ width: Math.max(1, t * 0.035), color: INK });
    });
    const shard = this.book.get('shard', t, (g) => {
      g.poly([-t * 0.16, -t * 0.06, t * 0.18, 0, -t * 0.1, t * 0.08]);
      g.fill({ color: WHITE });
    });
    const puff = this.book.get('puff', t, (g) => {
      g.circle(0, 0, t * 0.5);
      g.fill({ color: WHITE });
      g.stroke({ width: Math.max(1, t * 0.05), color: INK, alpha: 0.5 });
    });
    const star = this.book.get('star', t, (g) => drawSparkle(g, t * 0.16, WHITE));
    const dt = deltaMs / 1000;
    for (const s of this.thrown) {
      s.age += deltaMs;
      if (s.kind === 'puff') {
        s.vx *= Math.exp(-1.2 * dt);
      } else {
        s.vy += (s.kind === 'shard' ? 4 : 7) * dt;
        s.vx *= Math.exp(-1.5 * dt);
        s.angle += s.spin * dt;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = s.age / s.life;
      if (k >= 1) continue;
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const x = tileX(view, s.x);
      const y = tileY(view, s.y);
      if (s.kind === 'puff') {
        this.burstStamps.place(puff, x, y, {
          scale: (s.r / 0.5) * (0.6 + 1.1 * k),
          alpha: 0.85 * (1 - k),
        });
      } else {
        const context = s.kind === 'chunk' ? chunk : s.kind === 'shard' ? shard : star;
        this.burstStamps.place(context, x, y, { rotation: s.angle, alpha: fade, tint: s.tint });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /** A shot into the sea: a ring of white spreading, and a crown of drops. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const life = 650;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / life;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      g.ellipse(x, y, t * (0.2 + 0.5 * k), t * (0.1 + 0.25 * k));
      g.stroke({ width: Math.max(1, t * 0.08), color: SPLASH, alpha: 1 - k });
      for (let n = 0; n < 5; n++) {
        const a = Math.PI + (n / 4) * Math.PI;
        const up = Math.sin(k * Math.PI) * t * 0.5;
        g.circle(x + Math.cos(a) * t * 0.3 * (0.5 + k), y - up * (0.6 + 0.4 * (n % 2)), t * 0.06);
      }
      g.fill({ color: SPLASH, alpha: 1 - k });
    }
    this.splashes = this.splashes.filter((s) => s.age < life);
  }

  /** The sound words, popping up big and fading: yellow, inked thick, tilted, in italics. */
  private drawWords(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const life = this.style.wordMs;
    this.words = this.words.filter((w) => (w.age += deltaMs) < life);
    while (this.wordPool.length < this.words.length) {
      const word = new Text({
        text: '',
        style: {
          fontFamily: '"Arial Black", Impact, "Helvetica Neue", sans-serif',
          fontSize: 48,
          fontWeight: '900',
          fontStyle: 'italic',
          fill: SFX_YELLOW,
          stroke: { color: INK, width: 9, join: 'round' },
          letterSpacing: 1,
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
      word.scale.set(((t * 1.0) / 48) * pop);
      word.rotation = w.tilt;
      word.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      word.position.set(tileX(view, w.x), tileY(view, w.y) - k * t * 0.4);
    });
  }

  // ------------------------------------------------------------------ cut-ins

  /**
   * Asks for a cut-in of `attacker` (none if negative) against `victim`, about the tile
   * (`x`, `y`): dropped if one is showing or has just been, kept until its picture is made.
   */
  private askCutIn(attacker: number, victim: number, x: number, y: number): void {
    if (this.cutShown !== null || this.cutAsk !== null) return;
    if (this.clock - this.lastCutIn < this.style.cutInCooldownMs) return;
    const a = attacker >= 0 && attacker !== victim ? this.hero(attacker) : null;
    const v = this.hero(victim);
    const key = `${a === null ? '-' : `${a.clan}${a.style}${a.hair.base}`}|${v.clan}${v.style}${v.hair.base}`;
    this.cutAsk = { key, svg: cutInSvg(a, v), x, y, since: this.clock };
  }

  /** The picture for a cut-in, made from its SVG once and kept; null until it is ready. */
  private cutTexture(key: string, svg: string): Texture | null {
    if (this.cutTextures.has(key)) return this.cutTextures.get(key) ?? null;
    this.cutTextures.set(key, null);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    void img
      .decode()
      .then(() => {
        if (this.destroyed) return;
        this.cutTextures.set(key, Texture.from(img));
      })
      .catch(() => this.cutTextures.delete(key));
    return null;
  }

  /**
   * The cut-in on screen, if any: a panel slid in from the side over open sea, held, slid out.
   * With motion reduced it fades in and out where it stands.
   */
  private drawCutIn(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const ask = this.cutAsk;
    if (ask !== null && this.cutShown === null) {
      const texture = this.cutTexture(ask.key, ask.svg);
      if (texture !== null) {
        this.cutAsk = null;
        const w = Math.round(this.style.cutInTiles);
        const h = Math.round((w * 200) / 360);
        const box = cutInSpot(state, ask.x, ask.y, w, h, {
          clear: this.style.cutInClearTiles,
          viewer: frame.humanPlayer,
          bounds: this.onScreen(state, view),
          avoid: this.keepClear(state),
          reach: CUT_IN_REACH,
        });
        if (box !== null) {
          this.cutShown = { texture, box, age: 0 };
          this.lastCutIn = this.clock;
        }
      } else if (this.clock - ask.since > CUT_IN_WAIT_MS) {
        this.cutAsk = null;
      }
    }
    const shown = this.cutShown;
    const sprite = this.cutInSprite;
    if (shown === null) {
      sprite.visible = false;
      return;
    }
    shown.age += frame.deltaMs;
    const k = shown.age / this.style.cutInMs;
    if (k >= 1) {
      this.cutShown = null;
      sprite.visible = false;
      return;
    }
    const inK = Math.min(1, k / CUT_IN_SLIDE);
    const outK = Math.max(0, (k - (1 - CUT_IN_SLIDE)) / CUT_IN_SLIDE);
    const ease = (v: number): number => 1 - (1 - v) ** 3;
    const still = motionReduced();
    const width = shown.box.w * t;
    const slide = still ? 0 : (1 - ease(inK)) * -width * 0.5 + ease(outK) * width * 0.5;
    sprite.texture = shown.texture;
    sprite.visible = true;
    sprite.width = width;
    sprite.height = shown.box.h * t;
    sprite.position.set(tileX(view, shown.box.x) + slide, tileY(view, shown.box.y));
    sprite.alpha = Math.min(inK * 2, 1 - outK);
  }

  /** The tiles on screen, below the HUD's bar. */
  private onScreen(state: MatchState, view: ViewTransform): TileBox {
    const t = view.tile;
    const x = Math.ceil(-view.originX / t);
    const y = Math.ceil((view.top - view.originY) / t);
    const x1 = Math.floor((view.width - view.originX) / t);
    const y1 = Math.floor((view.height - view.originY) / t);
    return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, Math.min(y1, state.height + 40) - y) };
  }

  /** What a cut-in must not cover beyond the board: the big timer and the corner's mascot. */
  private keepClear(state: MatchState): TileBox[] {
    const boxes: TileBox[] = [];
    for (const spot of [timerSpot(state), this.corner]) {
      if (spot === null) continue;
      boxes.push({
        x: Math.floor(spot.x - spot.size / 2),
        y: Math.floor(spot.y - spot.size / 2),
        w: Math.ceil(spot.size) + 1,
        h: Math.ceil(spot.size) + 1,
      });
    }
    return boxes;
  }

  // ------------------------------------------------------------------ the climax

  /**
   * The climax (`climaxLevel`): the light turning to a warm summer sunset, and focus lines
   * closing in from the edges of the screen, anime's sign that everything is at stake — the
   * middle of the board left clear. The lines stand still with motion reduced.
   */
  private drawClimax(state: MatchState, view: ViewTransform): void {
    const level = climaxLevel(state, this.art);
    if (level === 0) return;
    const g = this.lateGfx;
    const { focusLines, sunsetAlpha } = this.style;
    g.rect(0, view.top, view.width, view.height - view.top);
    g.fill({ color: 0xff7a50, alpha: sunsetAlpha * level });
    const cx = view.width / 2;
    const cy = (view.top + view.height) / 2;
    // From the corners and edges in, stopping well short of the islands: the final round lasts
    // a whole round, and lines over the board hid its shots (the first look).
    const far = Math.hypot(view.width, view.height) * 0.6;
    const inner = Math.hypot(view.width, view.height - view.top) * 0.33;
    const beat = motionReduced() ? 0 : Math.floor(this.clock / 90);
    for (let k = 0; k < focusLines; k++) {
      const a = ((k + hash(k, beat, 7830) * 0.6) / focusLines) * Math.PI * 2;
      const r0 = inner * (1 + 0.35 * hash(k, beat, 7831));
      const w = 0.012 + 0.018 * hash(k, beat, 7832);
      g.poly([
        cx + Math.cos(a) * r0,
        cy + Math.sin(a) * r0,
        cx + Math.cos(a - w) * far,
        cy + Math.sin(a - w) * far,
        cx + Math.cos(a + w) * far,
        cy + Math.sin(a + w) * far,
      ]);
    }
    g.fill({ color: WHITE, alpha: 0.4 * level });
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
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
      // The piece in hand, cel-painted in the owner's colour and inked; where it does not fit,
      // grey and shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const shake = ghost.valid ? 0 : Math.sin(now / 30) * t * 0.05;
      for (const { x, y } of cells) g.rect(tileX(view, x) + shake, tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.6 : 0.45,
      });
      const edge = outline(cells, inPiece, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: INK, alpha: 0.8 });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.05), color: WHITE, alpha: ghost.valid ? 0.9 : 0.5 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      drawCannonGhost(g, view, ghost, colour, Math.max(1.5, t * 0.1));
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/** The magic circle's radius round a castle, in tiles. */
function circleRadius(castle: Castle): number {
  return Math.max(castle.w, castle.h) * 0.5 + 0.9;
}

/** A screentone: staggered dots in `colour` on nothing, laid into shapes in screen space. */
function tonePattern(tile: number, colour: number): FillPattern {
  const s = Math.max(4, Math.round(tile * 0.32));
  const canvas = document.createElement('canvas');
  canvas.width = s * 2;
  canvas.height = s * 2;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
    const r = Math.max(0.9, s * 0.27);
    for (const [x, y] of [
      [s / 2, s / 2],
      [s * 1.5, s * 1.5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' });
}

/** A four-pointed sparkle, `r` from its middle to a point. */
function drawSparkle(g: Graphics, r: number, colour: number): void {
  const k = r * 0.26;
  g.poly([0, -r, k, -k, r, 0, k, k, 0, r, -k, k, -r, 0, -k, -k]);
  g.fill({ color: colour });
}

/**
 * A tall cloud's shadow on the ground, drawn in white: one bumpy outline, not lobes laid over
 * each other, whose overlaps darkened where a stamp's alpha meets itself.
 */
function drawCloudShadow(g: Graphics, t: number): void {
  const pts: number[] = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Scalloped, a cumulus's lobes round its edge.
    const bump = 1 + 0.14 * Math.abs(Math.sin(a * 4.5)) + 0.06 * Math.sin(a * 2 + 1);
    pts.push(Math.cos(a) * 4.6 * bump * t, Math.sin(a) * 2.3 * bump * t);
  }
  g.poly(pts);
  g.fill({ color: WHITE });
}

/**
 * A magic circle, its middle at the origin, `r` tiles across from it, drawn in white for its
 * tint: two rings with runes between them, a hexagram inside, and the clan's emblem at the four
 * quarters of the band.
 */
function drawMagicCircle(g: Graphics, t: number, r: number, clan: Clan): void {
  const R = r * t;
  const w = Math.max(1, t * 0.06);
  g.circle(0, 0, R);
  g.stroke({ width: w * 1.4, color: WHITE });
  g.circle(0, 0, R * 0.78);
  g.stroke({ width: w, color: WHITE });
  // Runes round the band: short ticks and dots, not any script.
  for (let k = 0; k < 28; k++) {
    if (k % 7 === 0) continue;
    const a = (k / 28) * Math.PI * 2;
    const m = R * 0.89;
    if (k % 2 === 0) {
      g.moveTo(Math.cos(a) * (m - R * 0.05), Math.sin(a) * (m - R * 0.05));
      g.lineTo(Math.cos(a) * (m + R * 0.05), Math.sin(a) * (m + R * 0.05));
    } else {
      g.circle(Math.cos(a) * m, Math.sin(a) * m, w * 0.6);
    }
  }
  g.stroke({ width: w, color: WHITE });
  for (const turn of [0, Math.PI / 3]) {
    const pts: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = turn - Math.PI / 2 + (k / 3) * Math.PI * 2;
      pts.push(Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76);
    }
    g.poly(pts);
    g.stroke({ width: w, color: WHITE, join: 'round' });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    drawEmblem(g, clan, Math.cos(a) * R * 0.89, Math.sin(a) * R * 0.89, R * 0.09);
  }
}

/**
 * A school, its foot's middle at the origin: a white building under a roof in the owner's
 * colour, rows of windows, a clock tower in the middle with its face. Greyed and its clock
 * stopped once its player is out.
 */
function drawSchool(g: Graphics, t: number, roof: number, out: boolean): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.05));
  const wall = out ? 0xc8c6d0 : 0xfbfaf4;
  const glass = out ? 0x8a8a96 : 0x8fd0ff;
  g.ellipse(u(0.1), -u(0.02), u(1.3), u(0.16));
  g.fill({ color: 0x000000, alpha: 0.22 });
  // The two wings.
  g.rect(-u(1.15), -u(0.85), u(2.3), u(0.85));
  g.fill({ color: wall });
  g.stroke({ width: ink, color: INK });
  g.rect(-u(1.15), -u(0.2), u(2.3), u(0.2));
  g.fill({ color: 0x000000, alpha: 0.08 });
  g.rect(-u(1.22), -u(0.98), u(2.44), u(0.16));
  g.fill({ color: roof });
  g.stroke({ width: ink, color: INK });
  for (const row of [-0.7, -0.42]) {
    for (let k = 0; k < 6; k++) {
      const x = -1.02 + k * 0.38 + (k >= 3 ? 0.08 : 0);
      if (k === 2 || k === 3) continue;
      g.rect(u(x), u(row), u(0.24), u(0.17));
    }
  }
  g.fill({ color: glass });
  // The tower, its clock, its roof.
  g.rect(-u(0.32), -u(1.62), u(0.64), u(1.62));
  g.fill({ color: wall });
  g.stroke({ width: ink, color: INK });
  g.rect(-u(0.14), -u(0.36), u(0.28), u(0.36));
  g.fill({ color: 0x6a4a3a });
  g.poly([-u(0.42), -u(1.6), u(0.42), -u(1.6), 0, -u(2.0)]);
  g.fill({ color: roof });
  g.stroke({ width: ink, color: INK, join: 'round' });
  g.circle(0, -u(1.22), u(0.2));
  g.fill({ color: WHITE });
  g.stroke({ width: ink, color: INK });
  g.moveTo(0, -u(1.22)).lineTo(0, -u(1.36));
  g.moveTo(0, -u(1.22)).lineTo(u(out ? -0.08 : 0.1), -u(1.22));
  g.stroke({ width: ink, color: INK, cap: 'round' });
}

/**
 * The mascot on its water tank, the square's middle at the corner's spot: a tank on four legs,
 * a ladder; on it a round white creature with pointed ears and a curling tail. Content, its eyes
 * `^^` and its tail swaying with `step`; startled, eyes wide, a "!" and a sweat drop, fur up.
 */
function drawMascot(
  g: Graphics,
  view: ViewTransform,
  spot: TimerSpot,
  step: number,
  startled: boolean,
): void {
  const t = view.tile;
  const s = spot.size * t;
  const cx = tileX(view, spot.x);
  const cy = tileY(view, spot.y);
  const ink = Math.max(1, s * 0.018);
  const u = (v: number): number => v * s;
  // The tank's legs and its ladder, then the tank.
  for (const lx of [-0.3, -0.1, 0.1, 0.3]) {
    g.rect(cx + u(lx) - u(0.02), cy + u(0.05), u(0.04), u(0.38));
  }
  g.fill({ color: 0x6a6e86 });
  g.ellipse(cx, cy + u(0.44), u(0.42), u(0.05));
  g.fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(cx - u(0.38), cy - u(0.18), u(0.76), u(0.3), u(0.05));
  g.fill({ color: 0xd2d6e8 });
  g.stroke({ width: ink, color: INK });
  g.ellipse(cx, cy - u(0.18), u(0.38), u(0.07));
  g.fill({ color: 0xeef0f8 });
  g.stroke({ width: ink, color: INK });
  for (const bx of [-0.2, 0.2]) {
    g.moveTo(cx + u(bx), cy - u(0.11)).lineTo(cx + u(bx), cy + u(0.12));
  }
  g.stroke({ width: ink, color: 0x9a9eb6 });
  // The mascot: its tail, its body, its ears.
  const jump = startled ? u(0.08) : 0;
  const bx = cx + u(0.02);
  const by = cy - u(0.32) - jump;
  const sway = startled ? 0 : Math.sin((step / 16) * Math.PI * 2) * 0.12;
  g.moveTo(bx - u(0.16), by + u(0.08));
  g.quadraticCurveTo(
    bx - u(0.4),
    by + u(0.02),
    bx - u(0.34 + sway),
    by - u(startled ? 0.32 : 0.18),
  );
  g.stroke({ width: Math.max(2, u(startled ? 0.07 : 0.05)), color: INK, cap: 'round' });
  g.moveTo(bx - u(0.16), by + u(0.08));
  g.quadraticCurveTo(
    bx - u(0.4),
    by + u(0.02),
    bx - u(0.34 + sway),
    by - u(startled ? 0.32 : 0.18),
  );
  g.stroke({ width: Math.max(1, u(startled ? 0.045 : 0.03)), color: WHITE, cap: 'round' });
  for (const ex of [-1, 1]) {
    g.poly([
      bx + ex * u(0.06),
      by - u(0.12),
      bx + ex * u(0.16),
      by - u(0.26),
      bx + ex * u(0.17),
      by - u(0.06),
    ]);
  }
  g.fill({ color: WHITE });
  g.stroke({ width: ink, color: INK, join: 'round' });
  g.ellipse(bx, by, u(0.2), u(0.15));
  g.fill({ color: WHITE });
  g.stroke({ width: ink, color: INK });
  // Its face.
  if (startled) {
    for (const ex of [-0.07, 0.07]) {
      g.circle(bx + u(ex), by - u(0.01), u(0.04));
      g.fill({ color: WHITE });
      g.stroke({ width: ink, color: INK });
      g.circle(bx + u(ex), by - u(0.01), u(0.012));
      g.fill({ color: INK });
    }
    g.ellipse(bx, by + u(0.07), u(0.025), u(0.03));
    g.fill({ color: 0x6a2a36 });
    // The "!" and the sweat drop.
    g.roundRect(bx + u(0.22), by - u(0.36), u(0.05), u(0.16), u(0.02));
    g.circle(bx + u(0.245), by - u(0.15), u(0.026));
    g.fill({ color: 0xff4f7a });
    g.moveTo(bx - u(0.25), by - u(0.2))
      .quadraticCurveTo(bx - u(0.3), by - u(0.1), bx - u(0.25), by - u(0.08))
      .quadraticCurveTo(bx - u(0.2), by - u(0.1), bx - u(0.25), by - u(0.2));
    g.fill({ color: 0x8fd0ff });
  } else {
    for (const ex of [-0.07, 0.07]) {
      g.moveTo(bx + u(ex - 0.035), by + u(0.0)).quadraticCurveTo(
        bx + u(ex),
        by - u(0.05),
        bx + u(ex + 0.035),
        by + u(0.0),
      );
    }
    g.stroke({ width: ink, color: INK, cap: 'round' });
    g.ellipse(bx - u(0.12), by + u(0.05), u(0.035), u(0.018));
    g.ellipse(bx + u(0.12), by + u(0.05), u(0.035), u(0.018));
    g.fill({ color: 0xff8a9a });
  }
}

/**
 * The scenery of a summer's day, in neutral colours so none of it is a player's: a tree a round
 * cel-shaded one; a pine a wooden utility pole with its crossbar; a bush a white vending
 * machine; a rock a grey one with a rim of light.
 */
function drawAnimeScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.05);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.ellipse(cx + t * 0.05, cy + t * 0.38, t * 0.36, t * 0.1);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.rect(cx - t * 0.05, cy, t * 0.1, t * 0.38);
      g.fill({ color: 0x8a5a32 });
      g.circle(cx, cy - t * 0.12, t * 0.36);
      g.fill({ color: 0x3c9a3e });
      g.stroke({ width: ink, color: INK });
      g.circle(cx - t * 0.1, cy - t * 0.22, t * 0.2);
      g.fill({ color: 0x5cbc4c });
      g.circle(cx - t * 0.14, cy - t * 0.28, t * 0.07);
      g.fill({ color: 0x9ae27a });
    } else if (item.kind === 'pine') {
      g.rect(cx - t * 0.04, cy - t * 0.48, t * 0.08, t * 0.86);
      g.fill({ color: 0x8a6a4a });
      g.stroke({ width: Math.max(1, ink * 0.7), color: INK });
      g.rect(cx - t * 0.3, cy - t * 0.38, t * 0.6, t * 0.06);
      g.fill({ color: 0x6a5a4a });
      for (const ix of [-0.24, 0.24]) g.circle(cx + ix * t, cy - t * 0.41, t * 0.035);
      g.fill({ color: 0xeef0f8 });
    } else if (item.kind === 'bush') {
      // A vending machine: white, a pale blue panel of drinks, a slot.
      g.rect(cx - t * 0.22, cy - t * 0.42, t * 0.44, t * 0.8);
      g.fill({ color: 0xf4f6fb });
      g.stroke({ width: ink, color: INK });
      g.rect(cx - t * 0.16, cy - t * 0.34, t * 0.32, t * 0.36);
      g.fill({ color: 0x9ad8ff });
      for (let k = 0; k < 3; k++)
        g.rect(cx - t * 0.13 + k * t * 0.1, cy - t * 0.3, t * 0.06, t * 0.12);
      g.fill({ color: 0xfff1a8 });
      g.rect(cx - t * 0.12, cy + t * 0.12, t * 0.24, t * 0.08);
      g.fill({ color: 0x2b1d2e });
    } else {
      g.ellipse(cx, cy + t * 0.28, t * 0.34, t * 0.08);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.poly([
        cx - t * 0.32,
        cy + t * 0.26,
        cx - t * 0.24,
        cy - t * 0.12,
        cx + t * 0.04,
        cy - t * 0.26,
        cx + t * 0.3,
        cy - t * 0.06,
        cx + t * 0.34,
        cy + t * 0.26,
      ]);
      g.fill({ color: 0x9a9eb6 });
      g.stroke({ width: ink, color: INK, join: 'round' });
      g.moveTo(cx - t * 0.2, cy - t * 0.08).lineTo(cx + t * 0.02, cy - t * 0.2);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0xeef0f8, cap: 'round' });
    }
  }
}
