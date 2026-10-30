import type { ArtConfig, WildWestStyleConfig } from '@bollwerk/config';
import { Structure, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics, Text, type GraphicsContext } from 'pixi.js';

import { t as text } from '../i18n.js';
import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';
import { climaxLevel, cornerSpot, hurry } from './corner.js';
import { IslandParts } from './islandParts.js';
import { hash } from './noise.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { WildWestSeaLife } from './seaLife.js';
import { ShapeTheme } from './shapeTheme.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
import { TerrainStrips, whole, type TerrainPass, type TerrainPlan } from './terrainStrips.js';
import {
  looksLoaded,
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
import {
  ADOBE,
  CLIFF,
  FLOOR,
  FLOOR_DARK,
  MESA,
  MESA_LIGHT,
  OUTLINE,
  PEBBLE,
  ROCK,
  WOOD_DARK,
  drawBarrel,
  drawBuilding,
  drawDynamite,
  drawHoops,
  drawLid,
  drawLocomotive,
  drawMortar,
  drawPuff,
  drawPumpTail,
  drawPumpTower,
  drawPumpWheel,
  drawTumbleweed,
} from './wildwest/drawings.js';

const DEAD = 0x9a948a;
const DEAD_DARK = 0x6a645a;
const CLAIM = 0xd8a462;
const FURROW = 0xa87440;
const SFX = 0xffe8a0;

/** How the frontier sends off its winners: gold nuggets and sheriff's stars. */
const FINISH: FinishLook = { spark: 'nuggets', flag: 'swallowtail' };

/** At most this many sound words on the board at once. */
const WORDS_AT_ONCE = 3;

interface Crater {
  x: number;
  y: number;
  round: number;
}

interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  kind: 'chip' | 'dust';
  tint: number;
  r: number;
}

interface Word {
  x: number;
  y: number;
  age: number;
  text: string;
  tilt: number;
}

/** A tumbleweed rolling: where, which way, how big; `floor` for one crossing the canyon floor. */
interface Weed {
  x: number;
  y: number;
  dir: 1 | -1;
  r: number;
  floor: boolean;
  phase: number;
}

interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/**
 * The Wild West look, for either look (ARCHIVE 14y): a showdown at high noon among the
 * mesas. **There is no sea**: the islands are mesas, flat tops of dusty ochre whose cliffs of red
 * rock drop to a canyon floor far below, greyer with the distance, the mesas' shadows thrown on
 * it. Walls are adobe whitewashed in the owner's colour; sealed ground a staked claim, furrowed,
 * ribboned in it, gold glinting; castles frontier buildings beside **a windpump whose vanes turn
 * while sealed**, stopping at a breach. **The guns are mortar barrels**, one design for all (the
 * user's), their hoops in the owner's colour: ready, the mortar out and its fuse sparking; firing,
 * a hop and a puff; reloading, the mortar pulled in and the barrel rocking; silenced, the lid
 * nailed shut. Shots are dynamite. Tumbleweeds roll over the open ground and the floor (the
 * user's); a locomotive puffs in the corner; at the climax, high noon's widescreen bars.
 */
export class WildWestTheme extends ShapeTheme implements Theme {
  readonly id = 'wildwest' as const;

  private style!: WildWestStyleConfig;
  private readonly seaLife = new WildWestSeaLife();

  private readonly terrainStrips = new TerrainStrips();
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  private readonly cornerMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawWestScenery(g, view, items),
    () => FLOOR,
  );
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  private readonly weedStamps = new Stamps();
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
  private thrown: Thrown[] = [];
  private words: Word[] = [];
  private weeds: Weed[] = [];
  private nextFloorWeed = 0;
  /** Each windpump's wheel's turn, carried frame to frame so it slows rather than jumps. */
  private readonly wheels = new Map<number, number>();

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.wildwest;
    layers.terrain.addChild(
      this.terrainStrips.container,
      this.craterGfx,
      this.cornerMemos.container,
    );
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.weedStamps.container,
      this.figureStamps.container,
      this.crowns.gfx,
      this.effectGfx,
      this.shadowStamps.container,
      this.shotStamps.container,
      this.burstStamps.container,
      this.lateGfx,
      this.wordLayer,
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
      this.weedStamps,
      this.figureStamps,
      this.shadowStamps,
      this.shotStamps,
      this.burstStamps,
    ]) {
      s.destroy();
    }
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
    this.wordLayer.destroy();
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The canyon floor far below, grey with distance, pebbled; each mesa's shadow thrown on it down
   * and to the right; the cliffs of red rock in bands dropping below every south edge, a sliver
   * down every east one; the mesas' tops dusty ochre, lighter in patches, outlined dark.
   */
  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrainStrips.draw(state, view, () => this.planTerrain(state, view));
  }

  private planTerrain(state: MatchState, view: ViewTransform): TerrainPlan {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    this.weeds = [];
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const cells = (from: number, to: number, keep: (x: number, y: number) => boolean): Cell[] => {
      const out: Cell[] = [];
      for (let y = Math.max(y0, from); y < Math.min(y1, to); y++) {
        for (let x = x0; x < x1; x++) if (keep(x, y)) out.push({ x, y });
      }
      return out;
    };
    const southEdge = (x: number, y: number): boolean => land(x, y) && !land(x, y + 1);
    const eastEdge = (x: number, y: number): boolean => land(x, y) && !land(x + 1, y);
    // A cliff drops CLIFF tiles, or less where another mesa stands close below.
    const drop = (x: number, y: number): number => (land(x, y + 2) ? 0.8 : CLIFF);
    const shadowed = (x: number, y: number): boolean =>
      !land(x, y) && (land(x - 1, y - 1) || land(x, y - 1) || land(x - 1, y));
    const passes: TerrainPass[] = [
      whole((g) => {
        g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
        g.fill({ color: FLOOR });
      }),
      (g, from, to) => {
        for (const { x, y } of cells(from, to, (x, y) => !land(x, y) && hash(x, y, 8201) < 0.45)) {
          g.circle(tileX(view, x + hash(x, y, 8202)), tileY(view, y + hash(x, y, 8203)), t * 0.05);
        }
        g.fill({ color: PEBBLE });
      },
      (g, from, to) => {
        for (const { x, y } of cells(from, to, shadowed)) {
          g.rect(tileX(view, x), tileY(view, y), t, t);
        }
        g.fill({ color: FLOOR_DARK, alpha: 0.5 });
      },
      // The cliffs: bands of red rock below each south edge, cracks down them, a dark foot.
      (g, from, to) => {
        const south = cells(from, to, southEdge);
        const band = 1 / ROCK.length;
        ROCK.forEach((colour, k) => {
          for (const { x, y } of south) {
            const d = drop(x, y);
            g.rect(tileX(view, x), tileY(view, y + 1 + k * band * d), t, band * d * t + 0.5);
          }
          g.fill({ color: colour });
        });
        for (const { x, y } of south) {
          const d = drop(x, y);
          const cx = tileX(view, x + 0.3 + 0.4 * hash(x, y, 8204));
          g.moveTo(cx, tileY(view, y + 1)).lineTo(cx + t * 0.1, tileY(view, y + 1 + d));
        }
        g.stroke({ width: Math.max(1, t * 0.05), color: 0x6a2a14, alpha: 0.55 });
        for (const { x, y } of south) {
          g.rect(tileX(view, x), tileY(view, y + 1 + drop(x, y)) - t * 0.04, t, t * 0.08);
        }
        g.fill({ color: OUTLINE, alpha: 0.7 });
      },
      (g, from, to) => {
        for (const { x, y } of cells(from, to, eastEdge)) {
          g.rect(tileX(view, x + 1), tileY(view, y), t * 0.26, t);
        }
        g.fill({ color: ROCK[2] });
      },
      (g, from, to) => {
        for (const { x, y } of cells(from, to, land)) g.rect(tileX(view, x), tileY(view, y), t, t);
        g.fill({ color: MESA });
      },
      (g, from, to) => {
        for (const { x, y } of cells(
          from,
          to,
          (x, y) => land(x, y) && hash(x >> 1, y >> 1, 8205) < 0.18,
        )) {
          g.rect(tileX(view, x), tileY(view, y), t, t);
        }
        g.fill({ color: MESA_LIGHT, alpha: 0.7 });
      },
      (g, from, to) => {
        trace(g, outline(cells(from, to, land), land, view));
        g.stroke({ width: Math.max(1, t * 0.08), color: OUTLINE });
      },
    ];
    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.cratersDrawn = '';
    return { rows: [y0, y1], passes };
  }

  /** Scorches on the mesas where dynamite went off, fading over the rounds. */
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
      g.ellipse(x, y, t * 0.4, t * 0.26);
      g.fill({ color: hex(palette.craterMid), alpha: 0.7 * fade });
      g.ellipse(x, y, t * 0.2, t * 0.12);
      g.fill({ color: hex(palette.craterDark), alpha: 0.85 * fade });
    }
  }

  /** The locomotive at its water tower in the corner, puffing; whistling when the clock presses. */
  private drawCorner(state: MatchState, view: ViewTransform): void {
    this.cornerMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const hurried = hurry(state, this.art) > 0.5;
      const period = hurried ? this.style.hurriedPuffMs : this.style.puffMs;
      const steps = 12;
      const beat = motionReduced()
        ? 0
        : Math.floor(((this.clock % period) / period) * steps) / steps;
      const key = `${viewKey(view)}|${hurried}|${beat}`;
      this.cornerMemos.draw('locomotive', key, (g) => {
        const s = spot.size * view.tile;
        g.position.set(tileX(view, spot.x), tileY(view, spot.y));
        drawLocomotive(g, s, beat, hurried);
      });
    }
    this.cornerMemos.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as a staked claim: furrowed earth, a ribbon in the owner's colour round it. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawClaim(g, island, view));
  }

  private drawClaim(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      g.fill({ color: CLAIM });
      for (const { x, y } of cells) {
        for (const f of [0.25, 0.75]) {
          g.moveTo(tileX(view, x), tileY(view, y + f)).lineTo(
            tileX(view, x + 1),
            tileY(view, y + f),
          );
        }
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: FURROW });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.12), color: this.colour(player, 'base') });
      // Pegs along the ribbon, here and there.
      for (const s of edge) {
        if (s.x1 === s.x2) continue;
        for (const [px, py] of [
          [s.x1, s.y1],
          [s.x2, s.y2],
        ] as const) {
          if (hash(Math.round(px), Math.round(py), 8210) > 0.5) continue;
          g.circle(px, py, Math.max(1.5, t * 0.09));
        }
      }
      g.fill({ color: WOOD_DARK });
    }
    dimEliminated(g, state, view, OUTLINE);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
    this.weeds = this.weeds.filter((w) => w.floor);
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
      this.drawAdobe(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    for (const cannon of state.cannons) cannonBase(g, view, cannon, null, WOOD_DARK);
  }

  /**
   * Walls as adobe: the tops whitewashed in the owner's light colour, courses of brick drawn
   * faintly across them and here and there a chip of bare brick; the face in their dark shade;
   * outlined dark. A player's who is out, and rubble, the wash gone grey.
   */
  private drawAdobe(
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
      g.rect(b.left + t * 0.12, b.top + t + (b.faced ? wall.face : 0), t, t * 0.18);
    }
    g.fill({ color: OUTLINE, alpha: 0.22 });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD_DARK : this.colour(player, 'dark') });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'light') });
    for (const b of wall.blocks) {
      const off = b.y % 2 === 0 ? 0.2 : 0.8;
      g.moveTo(b.left, b.top + t * 0.5).lineTo(b.left + t, b.top + t * 0.5);
      g.moveTo(b.left + t * 0.5, b.top).lineTo(b.left + t * 0.5, b.top + t * 0.5);
      g.moveTo(b.left + t * off, b.top + t * 0.5).lineTo(b.left + t * off, b.top + t);
    }
    g.stroke({
      width: Math.max(0.6, t * 0.03),
      color: dead ? DEAD_DARK : this.colour(player, 'dark'),
      alpha: 0.55,
    });
    for (const b of wall.blocks) {
      if (hash(b.x, b.y, 8220) > 0.22) continue;
      g.rect(b.left + t * 0.14, b.top + t * 0.56, t * 0.34, t * 0.3);
    }
    g.fill({ color: ADOBE });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.07), color: OUTLINE, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    for (let k = 0; k < 3; k++) this.throw(x + 0.5, y + 0.4, 'dust', 0xf4ecdc);
    if (!this.land(x, y) && debris.length === 0) return;
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      const tint = block.owner > 0 ? this.colour(block.owner - 1, 'light') : DEAD;
      for (let k = 0; k < 5; k++) this.throw(block.x + 0.5, block.y + 0.4, 'chip', tint);
    }
    if (Math.random() < this.style.wordChance && this.words.length < WORDS_AT_ONCE) {
      const all = text('wildwest.words').split('|');
      this.words.push({
        x: x + 0.5,
        y: y - 0.6,
        age: 0,
        text: all[Math.floor(Math.random() * all.length)] ?? 'KA-BLAM!',
        tilt: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  private throw(x: number, y: number, kind: Thrown['kind'], tint: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (kind === 'dust' ? 1.4 : 2.4);
    const v = kind === 'dust' ? 0.6 + Math.random() * 0.5 : 2.5 + Math.random() * 3;
    this.thrown.push({
      x: x + (kind === 'dust' ? (Math.random() - 0.5) * 0.5 : 0),
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: kind === 'dust' ? 800 + Math.random() * 300 : 600 + Math.random() * 350,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      kind,
      tint,
      r: 0.26 + Math.random() * 0.16,
    });
  }

  noteCrumble(block: Debris): void {
    this.throw(block.x + 0.5, block.y + 0.5, 'dust', 0xf4ecdc);
    const tint = block.owner > 0 ? this.colour(block.owner - 1, 'light') : DEAD;
    for (let k = 0; k < 2; k++) this.throw(block.x + 0.5, block.y + 0.5, 'chip', tint);
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    clearDrawn(under);
    clearDrawn(this.effectGfx);
    clearDrawn(this.lateGfx);
    this.drawCraters(state, view);
    this.drawCorner(state, view);
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x8a7a68, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.drawGlints(state, view);
    this.drawWeeds(state, view, frame.deltaMs);
    this.figures = [];
    this.drawTown(state, view, frame);
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
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawNoon(state, view);
    this.drawWords(view, frame.deltaMs);
  }

  /** Gold glinting in the claims now and then: a four-pointed sparkle on sealed ground. */
  private drawGlints(state: MatchState, view: ViewTransform): void {
    const rate = this.style.glintsPerSecond;
    if (motionReduced() || rate <= 0) return;
    const g = this.underGfx;
    const t = view.tile;
    const slot = 1000 / rate;
    const n = Math.floor(this.clock / slot);
    const life = 600;
    for (let k = n - Math.ceil(life / slot); k <= n; k++) {
      const age = this.clock - k * slot;
      if (age < 0 || age > life) continue;
      const x = Math.floor(hash(k, this.seed, 8230) * state.width);
      const y = Math.floor(hash(k, this.seed, 8231) * state.height);
      if (state.territory[y * state.width + x] === 0) continue;
      const s = Math.sin((age / life) * Math.PI) * t * 0.22;
      const cx = tileX(view, x + 0.5);
      const cy = tileY(view, y + 0.5);
      g.poly([
        cx,
        cy - s,
        cx + s * 0.25,
        cy - s * 0.25,
        cx + s,
        cy,
        cx + s * 0.25,
        cy + s * 0.25,
        cx,
        cy + s,
        cx - s * 0.25,
        cy + s * 0.25,
        cx - s,
        cy,
        cx - s * 0.25,
        cy - s * 0.25,
      ]);
    }
    g.fill({ color: 0xfff0a0 });
  }

  /**
   * Tumbleweeds (the user's): a few to each island, rolling with the wind over its open ground —
   * never over walls, sealed ground, buildings or guns, a new one setting out when one is stopped —
   * and now and then one bowling across the canyon floor. Bouncing as they go.
   */
  private drawWeeds(state: MatchState, view: ViewTransform, deltaMs: number): void {
    this.weedStamps.begin();
    const t = view.tile;
    const still = motionReduced();
    const open = (x: number, y: number): boolean => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (!this.land(tx, ty)) return false;
      const i = ty * state.width + tx;
      if (state.structure[i] !== Structure.Empty || state.territory[i] !== 0) return false;
      return !state.castles.some(
        (c) => tx >= c.x - 1 && tx < c.x + c.w + 1 && ty >= c.y - 1 && ty < c.y + c.h + 1,
      );
    };
    const islands = state.players.length;
    const want = this.style.tumbleweedsPerIsland * islands;
    // Set new ones out where open ground is, by a draw from the clock: none a frame at most.
    if (!still && this.weeds.filter((w) => !w.floor).length < want) {
      const k = Math.floor(this.clock / 97);
      const x = hash(k, this.seed, 8240) * state.width;
      const y = hash(k, this.seed, 8241) * state.height;
      if (open(x, y)) {
        this.weeds.push({
          x,
          y,
          dir: hash(k, 0, 8242) < 0.5 ? 1 : -1,
          r: 0.3 + 0.14 * hash(k, 1, 8243),
          floor: false,
          phase: 0,
        });
      }
    }
    if (!still && this.clock >= this.nextFloorWeed) {
      this.nextFloorWeed =
        this.clock + this.style.floorTumbleweedEveryMs * (0.6 + Math.random() * 0.8);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = Math.random() * state.height;
      if (!this.land(dir === 1 ? 0 : state.width - 1, Math.floor(y))) {
        this.weeds.push({
          x: dir === 1 ? -3 : state.width + 3,
          y,
          dir,
          r: 0.42,
          floor: true,
          phase: 0,
        });
      }
    }
    const speed = this.style.tumbleweedTilesPerSecond;
    const weed = this.book.get('weed', t, (g) => drawTumbleweed(g, t, 0.32));
    this.weeds = this.weeds.filter((w) => {
      if (!still) {
        const dx = w.dir * speed * (deltaMs / 1000) * (w.floor ? 1.4 : 1);
        if (!w.floor && !open(w.x + dx + w.dir * w.r, w.y)) return false;
        w.x += dx;
        w.phase += dx / (w.r * 2 * Math.PI);
      }
      if (w.floor && (w.x < -4 || w.x > state.width + 4)) return false;
      if (w.floor && this.land(Math.floor(w.x), Math.floor(w.y))) return false;
      const bounce = Math.abs(Math.sin(w.phase * Math.PI)) * 0.25;
      this.weedStamps.place(weed, tileX(view, w.x), tileY(view, w.y - bounce), {
        rotation: w.phase * Math.PI * 2,
        scale: w.r / 0.32,
      });
      return true;
    });
    this.weedStamps.end();
  }

  /**
   * The town: a frontier building for each castle, by its id — saloon, sheriff's office, bank,
   * store — a windpump beside it whose vanes in the owner's colour turn while sealed and stop at
   * a breach, its tail swinging loose; boarded up and its vanes broken once its player is out.
   */
  private drawTown(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.lit.update(frame.castleSealed, this.clock, this.art);
    const tail = this.book.get('tail', t, (g) => drawPumpTail(g, t));
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      const x = tileX(view, castle.x + castle.w / 2);
      const foot = tileY(view, castle.y + castle.h) - t * 0.1;
      const building = this.book.get(`building|${castle.id % 4}|${out}`, t, (g) =>
        drawBuilding(g, t, castle.id, out),
      );
      this.figures.push({ foot, context: building, x: x + t * 0.25, y: foot });
      const tower = this.book.get(`tower|${level > 0.5}`, t, (g) =>
        drawPumpTower(g, t, level > 0.5),
      );
      const px = x - t * 0.85;
      const py = foot - t * 0.05;
      this.figures.push({ foot: foot - 0.003, context: tower, x: px, y: py });
      const turn =
        (this.wheels.get(castle.id) ?? 0) +
        (still ? 0 : (frame.deltaMs / this.style.pumpTurnMs) * Math.PI * 2 * level);
      this.wheels.set(castle.id, turn);
      const colour = out ? DEAD : this.colour(player, 'base');
      const swing = level > 0.5 || still ? 0 : Math.sin(this.clock / 300 + castle.id) * 0.5;
      this.figures.push({
        foot: foot - 0.002,
        context: tail,
        x: px,
        y: py - t * 1.6,
        options: { rotation: swing, tint: colour },
      });
      const wheel = this.book.get(`wheel|${out}`, t, (g) => drawPumpWheel(g, t, out));
      this.figures.push({
        foot: foot - 0.001,
        context: wheel,
        x: px + t * 0.05,
        y: py - t * 1.6,
        options: { rotation: turn, tint: colour },
      });
    }
  }

  /** The cannon icon: a mortar barrel, ready, its hoops in the player's colour. */
  drawCannonIcon(root: Container, size: number, player: number): void {
    const t = size / 1.6;
    const box = new Container();
    const barrel = new Graphics();
    drawBarrel(barrel, t, false);
    const hoops = new Graphics();
    drawHoops(hoops, t);
    hoops.tint = this.colour(player, 'base');
    const mortar = new Graphics();
    drawMortar(mortar, t, true);
    mortar.position.set(0.05 * t, -0.98 * t);
    mortar.rotation = -0.75;
    box.addChild(mortar, barrel, hoops);
    const b = box.getLocalBounds();
    const scale = Math.min(1, (size * 0.96) / Math.max(b.width, b.height));
    box.scale.set(scale);
    box.position.set(
      size / 2 - (b.x + b.width / 2) * scale,
      size / 2 - (b.y + b.height / 2) * scale,
    );
    root.addChild(box);
  }

  /**
   * The guns: a mortar barrel each, its hoops in the owner's colour. Ready, the mortar out of its
   * top, tilted at the target, its fuse sparking; firing, a hop and a puff of smoke; reloading,
   * the mortar in and the barrel rocking until the shot lands; silenced, the lid nailed shut; out,
   * staved in.
   */
  private drawGuns(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    const hoops = this.book.get('hoops', t, (g) => drawHoops(g, t));
    const lid = this.book.get('lid', t, (g) => drawLid(g, t));
    const puff = this.book.get('puff', t, (g) => drawPuff(g, t));
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += frame.deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const out = state.players[cannon.owner]?.eliminated !== false;
      const asleep = cannon.asleepUntil !== undefined && cannon.asleepUntil > state.tick;
      const silenced = !out && (asleep || !cannon.active);
      const loaded = looksLoaded(cannon);
      const scale = Math.max(1, Math.min(cannon.w, cannon.h) / 2);
      const x = tileX(view, cannon.x + cannon.w / 2);
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.2;
      const firing = !out && !silenced && aim.firedAgo < this.style.hopMs;
      const hop =
        firing && !still ? Math.sin((aim.firedAgo / this.style.hopMs) * Math.PI) * t * 0.15 : 0;
      const reloading = !out && !silenced && !firing && !loaded;
      const rock =
        reloading && !still
          ? Math.sin((this.clock + cannon.id * 97) / (this.style.rockMs / (Math.PI * 2))) * 0.08
          : 0;
      if (!out && !silenced && (loaded || firing)) {
        const mortar = this.book.get(`mortar|${loaded && !firing}`, t, (g) =>
          drawMortar(g, t, loaded && !firing),
        );
        this.figures.push({
          foot: foot - 0.001,
          context: mortar,
          x: x + dir * 0.05 * t * scale,
          y: foot - 0.98 * t * scale - hop,
          options: { rotation: dir === 1 ? -0.75 : Math.PI + 0.75, scale },
        });
      }
      const body = this.book.get(`barrel|${out}`, t, (g) => drawBarrel(g, t, out));
      this.figures.push({
        foot,
        context: body,
        x,
        y: foot - hop,
        options: { rotation: rock, scale },
      });
      if (!out) {
        this.figures.push({
          foot: foot + 0.0005,
          context: hoops,
          x,
          y: foot - hop,
          options: { rotation: rock, scale, tint: this.colour(cannon.owner, 'base') },
        });
      }
      if (silenced)
        this.figures.push({ foot: foot + 0.001, context: lid, x, y: foot, options: { scale } });
      if (firing) {
        const k = aim.firedAgo / this.style.hopMs;
        this.figures.push({
          foot: foot + 0.002,
          context: puff,
          x: x + dir * (0.5 + k * 0.3) * t * scale,
          y: foot - (1.5 + k * 0.3) * t * scale,
          options: { scale: scale * (0.7 + k * 0.6), alpha: 1 - k },
        });
      }
    }
    this.aims.prune(state);
  }

  /** Dynamite: a stick turning end over end along the sim's arc, its fuse fizzing; a shadow. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    const shadow = this.book.get('shadow', t, (g) => {
      g.ellipse(0, 0, t * 0.2, t * 0.07);
      g.fill({ color: 0x000000 });
    });
    const stick = this.book.get('dynamite', t, (g) => drawDynamite(g, t));
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = shot.fromX + (shot.toX - shot.fromX) * p + 0.5;
      const gy = shot.fromY + (shot.toY - shot.fromY) * p + 0.5;
      this.shadowStamps.place(shadow, tileX(view, gx), tileY(view, gy), { alpha: 0.28 });
      this.shotStamps.place(
        stick,
        tileX(view, gx),
        tileY(view, gy - shotLift(shot, p) - 0.5 * (1 - p)),
        {
          rotation: still ? -0.4 : p * 14,
          scale: shotScale(shot, this.art) * 1.4,
        },
      );
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** Adobe chips in the wash's colour, and dust clouds. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const chip = this.book.get('chip', t, (g) => {
      g.rect(-t * 0.1, -t * 0.07, t * 0.2, t * 0.14);
      g.fill({ color: 0xffffff });
      g.stroke({ width: Math.max(1, t * 0.035), color: OUTLINE });
    });
    const dust = this.book.get('dust', t, (g) => {
      g.circle(0, 0, t * 0.5);
      g.fill({ color: 0xffffff });
    });
    const dt = deltaMs / 1000;
    for (const s of this.thrown) {
      s.age += deltaMs;
      if (s.kind === 'dust') {
        s.vx *= Math.exp(-1.2 * dt);
      } else {
        s.vy += 7 * dt;
        s.vx *= Math.exp(-1.5 * dt);
        s.angle += s.spin * dt;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = s.age / s.life;
      if (k >= 1) continue;
      const x = tileX(view, s.x);
      const y = tileY(view, s.y);
      if (s.kind === 'chip') {
        this.burstStamps.place(chip, x, y, {
          rotation: s.angle,
          alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
          tint: s.tint,
        });
      } else {
        this.burstStamps.place(dust, x, y, {
          scale: (s.r / 0.5) * (0.6 + 1.2 * k),
          alpha: 0.8 * (1 - k),
          tint: s.tint,
        });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /** The sound words: wood-type capitals, cream inked dark, popping up and fading. */
  private drawWords(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const life = this.style.wordMs;
    this.words = this.words.filter((w) => (w.age += deltaMs) < life);
    while (this.wordPool.length < this.words.length) {
      const word = new Text({
        text: '',
        style: {
          fontFamily: 'Rockwell, "Courier New", Georgia, serif',
          fontSize: 48,
          fontWeight: '900',
          fill: SFX,
          stroke: { color: OUTLINE, width: 9, join: 'round' },
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
      word.scale.set((t / 48) * pop);
      word.rotation = w.tilt;
      word.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      word.position.set(tileX(view, w.x), tileY(view, w.y) - k * t * 0.4);
    });
  }

  /**
   * The climax (`climaxLevel`): high noon. The screen's top and bottom close in to a western's
   * widescreen bars, below the HUD and over nothing in play's middle; the heat shimmers in bands
   * along them. The bars stand still with motion reduced; the shimmer is not drawn.
   */
  private drawNoon(state: MatchState, view: ViewTransform): void {
    const level = climaxLevel(state, this.art);
    if (level === 0) return;
    const g = this.lateGfx;
    const span = view.height - view.top;
    const bar = span * this.style.barShare * level;
    g.rect(0, view.top, view.width, bar);
    g.rect(0, view.height - bar, view.width, bar);
    g.fill({ color: 0x120c08, alpha: 0.92 });
    if (motionReduced()) return;
    const t = view.tile;
    for (const base of [view.top + bar, view.height - bar]) {
      for (let k = 0; k < 3; k++) {
        const y = base + (base === view.top + bar ? 1 : -1) * (k + 1) * t * 0.35;
        g.moveTo(0, y);
        for (let x = 0; x <= view.width; x += t) {
          g.lineTo(x, y + Math.sin(x / (t * 1.5) + this.clock / 160 + k) * t * 0.08);
        }
      }
    }
    g.stroke({
      width: Math.max(1, t * 0.08),
      color: 0xfff4dc,
      alpha: this.style.shimmerAlpha * level,
    });
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
      // The piece in hand washed in the owner's colour and outlined dark; where it does not fit,
      // dust-grey and shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const shake = ghost.valid ? 0 : Math.sin(now / 30) * t * 0.05;
      for (const { x, y } of cells) g.rect(tileX(view, x) + shake, tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.65 : 0.5,
      });
      const edge = outline(cells, inPiece, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.12), color: OUTLINE, alpha: 0.85 });
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

/**
 * The frontier's scenery, none of it a barrel (the guns are): a tree a saguaro; a pine a wagon
 * wheel leaning on a hitching post; a bush a water trough or a stack of crates; a rock a cow's
 * skull on the dust, or a boulder.
 */
function drawWestScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.05);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // A saguaro, its trunk and two arms.
      const u = t * 0.9;
      g.roundRect(cx - u * 0.09, cy + t * 0.38 - u * 0.8, u * 0.18, u * 0.8, u * 0.09);
      g.roundRect(cx - u * 0.32, cy + t * 0.38 - u * 0.6, u * 0.13, u * 0.3, u * 0.065);
      g.rect(cx - u * 0.3, cy + t * 0.38 - u * 0.36, u * 0.24, u * 0.1);
      g.roundRect(cx + u * 0.19, cy + t * 0.38 - u * 0.66, u * 0.13, u * 0.34, u * 0.065);
      g.rect(cx + u * 0.06, cy + t * 0.38 - u * 0.44, u * 0.24, u * 0.1);
      g.fill({ color: 0x5a8a4a });
      g.roundRect(cx - u * 0.09, cy + t * 0.38 - u * 0.8, u * 0.18, u * 0.8, u * 0.09);
      g.stroke({ width: ink * 0.7, color: OUTLINE });
    } else if (item.kind === 'pine') {
      // A hitching post, a wagon wheel leaning on it.
      g.rect(cx - t * 0.32, cy - t * 0.1, t * 0.64, t * 0.07);
      g.rect(cx - t * 0.28, cy - t * 0.1, t * 0.06, t * 0.42);
      g.rect(cx + t * 0.22, cy - t * 0.1, t * 0.06, t * 0.42);
      g.fill({ color: 0x8a5a32 });
      g.circle(cx + t * 0.05, cy + t * 0.12, t * 0.2);
      g.stroke({ width: Math.max(1, t * 0.05), color: WOOD_DARK });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI;
        g.moveTo(cx + t * 0.05 - Math.cos(a) * t * 0.2, cy + t * 0.12 - Math.sin(a) * t * 0.2);
        g.lineTo(cx + t * 0.05 + Math.cos(a) * t * 0.2, cy + t * 0.12 + Math.sin(a) * t * 0.2);
      }
      g.stroke({ width: Math.max(0.8, t * 0.03), color: WOOD_DARK });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        g.rect(cx - t * 0.34, cy - t * 0.05, t * 0.68, t * 0.28);
        g.fill({ color: 0x9a6a3e });
        g.stroke({ width: ink, color: OUTLINE });
        g.rect(cx - t * 0.3, cy - t * 0.02, t * 0.6, t * 0.06);
        g.fill({ color: 0x6ab0d8 });
      } else {
        for (const [ox, oy] of [
          [-0.18, 0.05],
          [0.16, 0.05],
          [0, -0.24],
        ] as const) {
          g.rect(cx + (ox - 0.15) * t, cy + (oy - 0.12) * t, t * 0.3, t * 0.26);
        }
        g.fill({ color: 0xb88a56 });
        g.stroke({ width: ink * 0.8, color: OUTLINE });
      }
    } else if (item.variant % 3 === 0) {
      // A cow's skull: a white skull, its horns curving out.
      g.moveTo(cx - t * 0.32, cy - t * 0.14).quadraticCurveTo(
        cx - t * 0.2,
        cy - t * 0.02,
        cx - t * 0.08,
        cy - t * 0.06,
      );
      g.moveTo(cx + t * 0.32, cy - t * 0.14).quadraticCurveTo(
        cx + t * 0.2,
        cy - t * 0.02,
        cx + t * 0.08,
        cy - t * 0.06,
      );
      g.stroke({ width: Math.max(1, t * 0.06), color: 0xf2ead8, cap: 'round' });
      g.poly([
        cx - t * 0.1,
        cy - t * 0.1,
        cx + t * 0.1,
        cy - t * 0.1,
        cx + t * 0.06,
        cy + t * 0.18,
        cx - t * 0.06,
        cy + t * 0.18,
      ]);
      g.fill({ color: 0xf2ead8 });
      g.stroke({ width: ink * 0.7, color: OUTLINE, join: 'round' });
      g.circle(cx - t * 0.04, cy - t * 0.02, t * 0.025);
      g.circle(cx + t * 0.04, cy - t * 0.02, t * 0.025);
      g.fill({ color: OUTLINE });
    } else {
      g.ellipse(cx, cy + t * 0.22, t * 0.3, t * 0.08);
      g.fill({ color: 0x000000, alpha: 0.18 });
      g.poly([
        cx - t * 0.28,
        cy + t * 0.2,
        cx - t * 0.2,
        cy - t * 0.12,
        cx + t * 0.06,
        cy - t * 0.22,
        cx + t * 0.28,
        cy - t * 0.02,
        cx + t * 0.3,
        cy + t * 0.2,
      ]);
      g.fill({ color: 0xb4502c });
      g.stroke({ width: ink, color: OUTLINE, join: 'round' });
    }
  }
}
