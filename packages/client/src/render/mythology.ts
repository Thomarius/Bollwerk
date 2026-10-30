import type { ArtConfig, MythologyStyleConfig } from '@bollwerk/config';
import { isLoaded, Structure, type Cannon, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, FillPattern, Graphics, Texture, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';
import { climaxLevel, cornerSpot, hurry } from './corner.js';
import { IslandParts } from './islandParts.js';
import {
  ARM_FIRED,
  ARM_READY,
  CLAY,
  CLAY_DARK,
  CLAY_LIGHT,
  GLAZE,
  PIVOT,
  SLIP_WHITE,
  drawAltarFire,
  drawArm,
  drawBoulder,
  drawFirePot,
  drawFrame,
  drawGod,
  drawShieldFace,
  drawShieldMarks,
  drawSisyphus,
  drawStone,
  drawTemple,
  meanderPath,
  mosaicCanvas,
} from './mythology/drawings.js';
import { hash } from './noise.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { MythologySeaLife } from './seaLife.js';
import { ShapeTheme } from './shapeTheme.js';
import { Memos, StampBook, Stamps, viewKey } from './stamps.js';
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

const DEAD = 0x7a6a5e;
const DEAD_DARK = 0x4a3e36;

/** How the victors are honoured: laurel leaves falling, and a forked banner. */
const FINISH: FinishLook = { spark: 'laurel', flag: 'swallowtail' };

interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A potsherd flying from a hit, a puff of dust, or a drop of spray. */
interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  kind: 'sherd' | 'dust' | 'spray';
  tint: number;
  r: number;
}

interface Figure {
  foot: number;
  context: GraphicsContext;
  x: number;
  y: number;
  options?: { rotation?: number; scale?: number; scaleY?: number; alpha?: number; tint?: number };
}

/**
 * The Mythology look, for either look (ARCHIVE 14x): the board as a black-figure
 * vase. The wine-dark sea is black glaze, waves incised through it to the clay; the islands are
 * the clay itself, ringed in black. **Walls are the meander** in the owner's colour, painted on
 * as slip inside a black key; **sealed ground a mosaic** of tesserae in the owner's colour;
 * castles **temples** whose altar fire burns while sealed. **The guns are onagers**, one design
 * for all (the user's), a shield in the owner's colour on the frame: ready, the arm lying back
 * with a stone in its sling; firing, the arm swinging up against the crossbar; reloading, the arm
 * creaking back down as its shot flies, which is the reload; silenced, the rope slack. A hit
 * cracks the glaze and throws potsherds. Sisyphus pushes his boulder in the corner, and at the
 * climax the gods lean out of the clouds to watch.
 */
export class MythologyTheme extends ShapeTheme implements Theme {
  readonly id = 'mythology' as const;

  private style!: MythologyStyleConfig;
  private readonly seaLife = new MythologySeaLife();

  private readonly terrainStrips = new TerrainStrips();
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  private readonly cornerMemos = new Memos();
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawMythScenery(g, view, items),
    () => CLAY_LIGHT,
  );
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  private readonly figureStamps = new Stamps();
  private figures: Figure[] = [];
  private readonly crowns = new MainCastles();
  private readonly effectGfx = new Graphics();
  private readonly shadowStamps = new Stamps();
  private readonly shotStamps = new Stamps();
  private readonly burstStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  private readonly godStamps = new Stamps();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly lit = new FlagHoist();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  /** Mosaic patterns by player, for one tile size. */
  private mosaics = new Map<number, FillPattern>();
  private mosaicTile = 0;

  private clock = 0;
  private round = 0;
  private corner: TimerSpot | null = null;
  private craters: Crater[] = [];
  private thrown: Thrown[] = [];
  private readonly sealed = new Map<number, boolean>();

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.mythology;
    layers.terrain.addChild(
      this.terrainStrips.container,
      this.craterGfx,
      this.cornerMemos.container,
    );
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.figureStamps.container,
      this.crowns.gfx,
      this.effectGfx,
      this.shadowStamps.container,
      this.shotStamps.container,
      this.burstStamps.container,
      this.lateGfx,
      this.godStamps.container,
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
      this.figureStamps,
      this.shadowStamps,
      this.shotStamps,
      this.burstStamps,
      this.godStamps,
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
    this.dropMosaics();
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The wine-dark sea in black glaze, waves incised through it here and there, a line incised
   * round each island a little out from its shore; the islands the clay, lighter where the slip
   * was thin, ringed in black.
   */
  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrainStrips.draw(state, view, () => this.planTerrain(state, view));
  }

  private planTerrain(state: MatchState, view: ViewTransform): TerrainPlan {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);
    const shore = (x: number, y: number): boolean => {
      if (land(x, y)) return true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
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
    const share = this.style.waveShare;
    const passes: TerrainPass[] = [
      whole((g) => {
        g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
        g.fill({ color: GLAZE });
      }),
      // Waves scratched through the black: a crest here and there, never by the shore.
      (g, from, to) => {
        for (const { x, y } of cells(
          from,
          to,
          (x, y) => !shore(x, y) && hash(x, y, 8101) < share,
        )) {
          const ox = hash(x, y, 8102) * 0.4;
          const cx = tileX(view, x + 0.1 + ox);
          const cy = tileY(view, y + 0.65);
          g.moveTo(cx, cy).quadraticCurveTo(cx + t * 0.25, cy - t * 0.32, cx + t * 0.5, cy);
          g.quadraticCurveTo(cx + t * 0.38, cy - t * 0.12, cx + t * 0.3, cy - t * 0.05);
        }
        g.stroke({ width: Math.max(0.8, t * 0.045), color: CLAY_DARK, alpha: 0.85 });
      },
      // The incised line round each island, a little out to sea.
      (g, from, to) => {
        trace(g, outline(cells(from, to, shore), shore, view));
        g.stroke({ width: Math.max(0.8, t * 0.05), color: CLAY_DARK });
      },
      (g, from, to) => {
        for (const { x, y } of cells(from, to, land)) {
          g.rect(tileX(view, x), tileY(view, y), t, t);
        }
        g.fill({ color: CLAY });
      },
      (g, from, to) => {
        for (const { x, y } of cells(
          from,
          to,
          (x, y) => land(x, y) && hash(x >> 1, y >> 1, 8103) < 0.16,
        )) {
          g.rect(tileX(view, x), tileY(view, y), t, t);
        }
        g.fill({ color: CLAY_LIGHT, alpha: 0.5 });
      },
      (g, from, to) => {
        trace(g, outline(cells(from, to, land), land, view));
        g.stroke({ width: Math.max(1.5, t * 0.12), color: GLAZE });
      },
    ];
    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.cratersDrawn = '';
    return { rows: [y0, y1], passes };
  }

  /** Where shots came down the glaze has cracked: black cracks branching, fading over rounds. */
  private drawCraters(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => state.round - c.round < rounds);
    const key = `${state.round}|${this.craters.length}|${viewKey(view)}`;
    if (key === this.cratersDrawn) return;
    this.cratersDrawn = key;
    const g = this.craterGfx;
    clearDrawn(g);
    const t = view.tile;
    for (const c of this.craters) {
      const fade = 1 - (state.round - c.round) / rounds;
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.5);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + hash(c.x, c.y, 8110 + k) * 1.2;
        const r = t * (0.3 + 0.2 * hash(c.x, c.y, 8120 + k));
        const bend = a + 0.5 * (hash(c.x, c.y, 8130 + k) - 0.5);
        g.moveTo(x, y).lineTo(x + Math.cos(bend) * r * 0.5, y + Math.sin(bend) * r * 0.5);
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: GLAZE, alpha: 0.85 * fade });
      g.circle(x, y, t * 0.08);
      g.fill({ color: GLAZE, alpha: 0.85 * fade });
    }
  }

  // ------------------------------------------------------------------ Sisyphus

  /**
   * The corner: Sisyphus pushing his boulder up his hill; at the top it rolls back down, he
   * watches it go and trudges after it. Quicker when the clock presses (`hurry`).
   */
  private drawCorner(state: MatchState, view: ViewTransform): void {
    this.cornerMemos.begin();
    const spot = this.corner;
    if (spot !== null) {
      const hurried = hurry(state, this.art) > 0.5;
      const period = hurried ? this.style.sisyphusHurriedMs : this.style.sisyphusMs;
      const frames = 48;
      const phase = motionReduced() ? 0.4 : (this.clock % period) / period;
      const step = Math.floor(phase * frames);
      const key = `${viewKey(view)}|${step}`;
      this.cornerMemos.draw('sisyphus', key, (g) => drawHill(g, view, spot, step / frames));
    }
    this.cornerMemos.end();
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as a mosaic floor, edged in the owner's colour and the glaze. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.mosaicsFor(view.tile, state.players.length);
    this.territory.draw(state, view, (g, island) => this.drawMosaic(g, island, view));
  }

  private dropMosaics(): void {
    for (const p of this.mosaics.values()) p.texture.destroy(true);
    this.mosaics.clear();
  }

  private mosaicsFor(tile: number, players: number): void {
    if (tile === this.mosaicTile && this.mosaics.size >= players) return;
    this.dropMosaics();
    this.mosaicTile = tile;
    const cell = Math.max(3, Math.round(tile * 0.25));
    for (let p = 0; p < players; p++) {
      const canvas = mosaicCanvas(cell, this.colour(p, 'base'));
      this.mosaics.set(p, new FillPattern({ texture: Texture.from(canvas), repetition: 'repeat' }));
    }
  }

  private drawMosaic(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      const mosaic = this.mosaics.get(player);
      if (mosaic !== undefined) {
        for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
        g.fill({ fill: mosaic });
      }
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.12), color: this.colour(player, 'base') });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.05), color: GLAZE });
    }
    dimEliminated(g, state, view, GLAZE);
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
      this.drawMeander(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
    for (const cannon of state.cannons) cannonBase(g, view, cannon, null, CLAY_DARK);
  }

  /**
   * Walls as the meander: each block's top painted in the owner's colour, a Greek key in the
   * glaze across it whose ends meet its neighbours', so a run of wall is one running band; the
   * face below in their dark shade, all ringed in black. A player's who is out, and rubble, the
   * clay darkened.
   */
  private drawMeander(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD_DARK : this.colour(player, 'dark') });
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: dead ? DEAD : this.colour(player, 'base') });
    for (const b of wall.blocks) {
      g.poly(meanderPath(b.left + t * 0.1, b.top + t * 0.1, t * 0.8), false);
    }
    g.stroke({ width: Math.max(1, t * 0.08), color: GLAZE, join: 'miter' });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.08), color: GLAZE, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    if (!this.land(x, y) && debris.length === 0) {
      for (let k = 0; k < 6; k++) this.throw(x + 0.5, y + 0.5, 'spray', SLIP_WHITE);
      return;
    }
    for (let k = 0; k < 3; k++) this.throw(x + 0.5, y + 0.4, 'dust', CLAY_LIGHT);
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      const tint = block.owner > 0 ? this.colour(block.owner - 1, 'base') : DEAD;
      for (let k = 0; k < 5; k++) this.throw(block.x + 0.5, block.y + 0.4, 'sherd', tint);
    }
  }

  private throw(x: number, y: number, kind: Thrown['kind'], tint: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (kind === 'dust' ? 1.2 : 2.4);
    const v = kind === 'dust' ? 0.6 + Math.random() * 0.4 : 2.5 + Math.random() * 3;
    this.thrown.push({
      x: x + (kind === 'dust' ? (Math.random() - 0.5) * 0.4 : 0),
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: kind === 'dust' ? 700 + Math.random() * 300 : 550 + Math.random() * 350,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 12,
      kind,
      tint,
      r: 0.2 + Math.random() * 0.14,
    });
  }

  noteCrumble(block: Debris): void {
    this.throw(block.x + 0.5, block.y + 0.5, 'dust', CLAY_LIGHT);
    const tint = block.owner > 0 ? this.colour(block.owner - 1, 'base') : DEAD;
    for (let k = 0; k < 2; k++) this.throw(block.x + 0.5, block.y + 0.5, 'sherd', tint);
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
    this.noteBreaches(state, frame);
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x5a4232, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.figures = [];
    this.drawTemples(state, view, frame);
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
    this.drawGods(state, view);
  }

  /** A sealed castle breached: its altar fire goes out in a puff of smoke. */
  private noteBreaches(state: MatchState, frame: EffectFrame): void {
    for (const castle of state.castles) {
      const now = frame.castleSealed[castle.id] === true;
      const was = this.sealed.get(castle.id);
      this.sealed.set(castle.id, now);
      if (was !== true || now || motionReduced()) continue;
      const x = castle.x + castle.w / 2 + 0.97;
      const y = castle.y + castle.h - 0.6;
      for (let k = 0; k < 4; k++) this.throw(x, y, 'dust', 0x8a7a6e);
    }
  }

  /** The temples, their altar fires burning while sealed, flickering, gone at a breach. */
  private drawTemples(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.lit.update(frame.castleSealed, this.clock, this.art);
    const fire = this.book.get('fire', t, (g) => drawAltarFire(g, t));
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const level = out ? 0 : (this.lit.raised(castle.id, this.clock, this.art) ?? 0);
      const x = tileX(view, castle.x + castle.w / 2);
      const foot = tileY(view, castle.y + castle.h) - t * 0.1;
      const temple = this.book.get(`temple|${out ? -1 : player}`, t, (g) =>
        drawTemple(g, t, out ? DEAD : this.colour(player, 'base'), out),
      );
      this.figures.push({ foot, context: temple, x, y: foot });
      if (level <= 0) continue;
      const flicker = still
        ? 1
        : 0.85 + 0.15 * Math.sin((this.clock + castle.id * 211) / (this.style.flickerMs / Math.PI));
      this.figures.push({
        foot: foot + 0.001,
        context: fire,
        x: x + t * 0.97,
        y: foot - t * 0.38,
        options: { scale: level, scaleY: level * flicker },
      });
    }
  }

  /** The cannon icon: an onager, loaded, facing right, its shield in the player's colour. */
  drawCannonIcon(root: Container, size: number, player: number): void {
    const t = size / 2.3;
    const box = new Container();
    const frame = new Graphics();
    drawFrame(frame, t, false);
    const arm = new Graphics();
    drawArm(arm, t, true);
    arm.position.set(PIVOT.x * t, PIVOT.y * t);
    arm.rotation = ARM_READY;
    const face = new Graphics();
    drawShieldFace(face, t);
    face.tint = this.colour(player, 'base');
    face.position.set(0.02 * t, -0.3 * t);
    const marks = new Graphics();
    drawShieldMarks(marks, t, 0);
    marks.position.set(0.02 * t, -0.3 * t);
    box.addChild(frame, arm, face, marks);
    const b = box.getLocalBounds();
    const scale = Math.min(1, (size * 0.96) / Math.max(b.width, b.height));
    box.scale.set(scale);
    box.position.set(
      size / 2 - (b.x + b.width / 2) * scale,
      size / 2 - (b.y + b.height / 2) * scale,
    );
    // On a disc of clay, ringed in black: the engine is black, and lost on a dark board.
    const disc = new Graphics();
    disc.circle(size / 2, size / 2, size * 0.48);
    disc.fill({ color: CLAY });
    disc.stroke({ width: Math.max(1, size * 0.04), color: GLAZE });
    root.addChild(disc, box);
  }

  /** The arm's angle for a gun: lying back loaded, swinging up, creaking back as it reloads. */
  private armOf(
    state: MatchState,
    cannon: Cannon,
    firedAgo: number,
    flying: ReadonlyMap<number, Shot>,
    now: number,
  ): { angle: number; stone: boolean } {
    const out = state.players[cannon.owner]?.eliminated !== false;
    const asleep = cannon.asleepUntil !== undefined && cannon.asleepUntil > state.tick;
    if (out || asleep || !cannon.active) return { angle: ARM_FIRED + 0.15, stone: false };
    const loaded = isLoaded(cannon);
    const swing = this.style.swingMs;
    if (firedAgo < swing) {
      const k = firedAgo / swing;
      return { angle: ARM_READY + (ARM_FIRED - ARM_READY) * k * k, stone: false };
    }
    if (loaded) return { angle: ARM_READY, stone: true };
    const shot = flying.get(cannon.shotIds[0] ?? -1);
    const k = shot === undefined ? 0.5 : shotProgress(shot, now);
    return { angle: ARM_FIRED + (ARM_READY - ARM_FIRED) * k, stone: false };
  }

  /**
   * The guns: an onager each, mirrored to face its target (turned it would stand on its end: it
   * is drawn in profile, as the painters drew), its arm a stamp turned about its pivot, its
   * shield on the frame in the owner's colour, a blazon on it by the gun's id.
   */
  private drawGuns(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const flying = new Map(state.shots.map((s) => [s.id, s]));
    const face = this.book.get('shield', t, (g) => drawShieldFace(g, t));
    const fallen = this.book.get('fallen', t, (g) => {
      g.ellipse(0, 0, t * 0.26, t * 0.08);
      g.fill({ color: GLAZE });
    });
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += frame.deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const out = state.players[cannon.owner]?.eliminated !== false;
      const scale = Math.max(1, Math.min(cannon.w, cannon.h) / 2);
      const x = tileX(view, cannon.x + cannon.w / 2);
      const foot = tileY(view, cannon.y + cannon.h) - t * 0.18;
      const { angle, stone } = this.armOf(state, cannon, aim.firedAgo, flying, now);
      const body = this.book.get(`frame|${out}`, t, (g) => drawFrame(g, t, out));
      this.figures.push({
        foot,
        context: body,
        x,
        y: foot,
        options: { scale: dir * scale, scaleY: scale },
      });
      const arm = this.book.get(`arm|${stone}`, t, (g) => drawArm(g, t, stone));
      this.figures.push({
        foot: foot + 0.0005,
        context: arm,
        x: x + dir * PIVOT.x * t * scale,
        y: foot + PIVOT.y * t * scale,
        options: { rotation: dir === 1 ? angle : Math.PI - angle, scale },
      });
      const sx = x + dir * 0.02 * t * scale;
      if (out) {
        this.figures.push({ foot: foot + 0.001, context: fallen, x: sx, y: foot - t * 0.08 });
        continue;
      }
      const blazon = Math.floor(hash(cannon.id, this.seed, 8140) * 4);
      const marks = this.book.get(`marks|${blazon}`, t, (g) => drawShieldMarks(g, t, blazon));
      const sy = foot - 0.3 * t * scale;
      this.figures.push({
        foot: foot + 0.001,
        context: face,
        x: sx,
        y: sy,
        options: { scale, tint: this.colour(cannon.owner, 'base') },
      });
      this.figures.push({
        foot: foot + 0.0015,
        context: marks,
        x: sx,
        y: sy,
        options: { scale: dir * scale, scaleY: scale },
      });
    }
    this.aims.prune(state);
  }

  /** Shots: stones tumbling along the sim's arc, the Berthas' pots of burning oil; shadows. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    const shadow = this.book.get('shadow', t, (g) => {
      g.ellipse(0, 0, t * 0.18, t * 0.06);
      g.fill({ color: 0x000000 });
    });
    const stone = this.book.get('stone', t, (g) => drawStone(g, t, 0, 0, 0.16));
    const pot = this.book.get('pot', t, (g) => drawFirePot(g, t));
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = shot.fromX + (shot.toX - shot.fromX) * p + 0.5;
      const gy = shot.fromY + (shot.toY - shot.fromY) * p + 0.5;
      const lift = shotLift(shot, p);
      this.shadowStamps.place(shadow, tileX(view, gx), tileY(view, gy), { alpha: 0.3 });
      const heavy = shot.kind === 'bertha' || shot.kind === 'biggest';
      this.shotStamps.place(
        heavy ? pot : stone,
        tileX(view, gx),
        tileY(view, gy - lift - 0.4 * (1 - p)),
        {
          rotation: still || heavy ? 0 : p * 9,
          scale: shotScale(shot, this.art) * 1.2,
        },
      );
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** Potsherds in the owner's colour edged in black, dust of the clay, white spray. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const sherd = this.book.get('sherd', t, (g) => {
      g.poly([-t * 0.14, -t * 0.08, t * 0.15, -t * 0.03, t * 0.04, t * 0.1, -t * 0.1, t * 0.06]);
      g.fill({ color: 0xffffff });
      g.stroke({ width: Math.max(1, t * 0.04), color: GLAZE, join: 'round' });
    });
    const puff = this.book.get('puff', t, (g) => {
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
      if (s.kind === 'sherd') {
        this.burstStamps.place(sherd, x, y, {
          rotation: s.angle,
          alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
          tint: s.tint,
        });
      } else {
        const size = s.kind === 'spray' ? 0.18 : (s.r / 0.5) * (0.6 + 1.1 * k);
        this.burstStamps.place(puff, x, y, {
          scale: size,
          alpha: (s.kind === 'spray' ? 0.9 : 0.7) * (1 - k),
          tint: s.tint,
        });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /**
   * The climax (`climaxLevel`): the gods leaning out of their clouds at the screen's edges to
   * watch, Zeus and Hera on the left, Athena and Poseidon on the right facing in, coming in as
   * the climax does and nodding — over nothing in play.
   */
  private drawGods(state: MatchState, view: ViewTransform): void {
    this.godStamps.begin();
    const level = climaxLevel(state, this.art);
    if (level > 0) {
      // At least a twentieth of the screen's height a head, so the gods are seen at eight players.
      const u = Math.max(view.tile * this.style.godTiles, (view.height - view.top) * 0.05);
      const still = motionReduced();
      const span = view.height - view.top;
      const places = [
        { which: 0, side: -1, y: view.top + span * 0.22 },
        { which: 1, side: -1, y: view.top + span * 0.72 },
        { which: 2, side: 1, y: view.top + span * 0.26 },
        { which: 3, side: 1, y: view.top + span * 0.76 },
      ];
      for (const { which, side, y } of places) {
        const god = this.book.get(`god|${which}`, view.tile, (g) => drawGod(g, u, which));
        // Leaning in from beyond the edge as the climax comes in, the cloud's end on screen.
        const inset = u * (2.4 * level - 1.4);
        const x = side < 0 ? inset : view.width - inset;
        const nod = still ? 0 : Math.sin((this.clock + which * 900) / 700) * 0.05;
        this.godStamps.place(god, x, y, {
          scale: -side,
          scaleY: 1,
          rotation: nod * -side,
          alpha: Math.min(1, level * 1.5),
        });
      }
    }
    this.godStamps.end();
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
      // The piece in hand painted as slip in the owner's colour, ringed in the glaze; where it
      // does not fit, the clay's dark and shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      const shake = ghost.valid ? 0 : Math.sin(now / 30) * t * 0.05;
      for (const { x, y } of cells) g.rect(tileX(view, x) + shake, tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.6 : 0.5,
      });
      const edge = outline(cells, inPiece, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: GLAZE, alpha: 0.85 });
      trace(g, edge);
      g.stroke({ width: Math.max(1, t * 0.04), color: CLAY_LIGHT, alpha: ghost.valid ? 0.9 : 0.5 });
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
 * Sisyphus's hill in the corner, the square's middle at the corner's spot: a slope of the clay's
 * dark shade ringed in black, and on it Sisyphus and his boulder at `phase` of their round — up to
 * three quarters pushing it up, then the boulder rolling back alone while he watches from the
 * top, then he trudging down after it.
 */
function drawHill(g: Graphics, view: ViewTransform, spot: TimerSpot, phase: number): void {
  const t = view.tile;
  const s = spot.size * t;
  const cx = tileX(view, spot.x);
  const cy = tileY(view, spot.y);
  // A cup's tondo: a disc of clay ringed in black glaze and a band of the clay, so the black
  // figures are seen — on the black sea they were not (the first look).
  g.circle(cx, cy, s * 0.5);
  g.fill({ color: GLAZE });
  g.circle(cx, cy, s * 0.46);
  g.stroke({ width: Math.max(1, t * 0.06), color: CLAY });
  g.circle(cx, cy, s * 0.42);
  g.fill({ color: CLAY });
  const foot = { x: cx - s * 0.36, y: cy + s * 0.26 };
  const top = { x: cx + s * 0.22, y: cy - s * 0.06 };
  g.poly([foot.x, foot.y, top.x, top.y, top.x + s * 0.12, top.y, top.x + s * 0.12, foot.y]);
  g.fill({ color: CLAY_DARK });
  g.moveTo(foot.x, foot.y)
    .lineTo(top.x, top.y)
    .lineTo(top.x + s * 0.12, top.y);
  g.stroke({ width: Math.max(1, t * 0.08), color: GLAZE });
  const along = (k: number): { x: number; y: number } => ({
    x: foot.x + (top.x - foot.x) * k,
    y: foot.y + (top.y - foot.y) * k,
  });
  const u = s * 0.28;
  const r = u * 0.36;
  let man: number;
  let boulder: number;
  let pose: 'push' | 'stand' | 'walk';
  if (phase < 0.75) {
    man = (phase / 0.75) * 0.82;
    boulder = man + 0.2;
    pose = 'push';
  } else if (phase < 0.88) {
    man = 0.82;
    boulder = 1.02 - ((phase - 0.75) / 0.13) * 1.02;
    pose = 'stand';
  } else {
    man = 0.82 * (1 - (phase - 0.88) / 0.12);
    boulder = -0.05;
    pose = 'walk';
  }
  const b = along(Math.max(-0.05, Math.min(1.02, boulder)));
  drawBoulder(g, u, phase * 40, b.x, b.y - r);
  const m = along(man);
  drawSisyphus(g, u, (phase * 12) % 1, pose, m.x, m.y, pose === 'walk' ? -1 : 1);
}

/**
 * The scenery as the painters drew it, black on the clay: a tree an olive, its leaves incised; a
 * pine a cypress; a bush an amphora; a rock a broken column or a herm.
 */
function drawMythScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.moveTo(cx, cy + t * 0.38).quadraticCurveTo(
        cx - t * 0.1,
        cy + t * 0.1,
        cx + t * 0.02,
        cy - t * 0.05,
      );
      g.stroke({ width: Math.max(1.5, t * 0.1), color: GLAZE });
      g.ellipse(cx, cy - t * 0.2, t * 0.36, t * 0.24);
      g.fill({ color: GLAZE });
      for (let k = 0; k < 5; k++) {
        const lx = cx - t * 0.24 + k * t * 0.12;
        g.moveTo(lx, cy - t * 0.2).lineTo(lx + t * 0.06, cy - t * 0.3);
      }
      g.stroke({ width: Math.max(0.8, t * 0.035), color: CLAY });
    } else if (item.kind === 'pine') {
      g.moveTo(cx, cy - t * 0.5)
        .quadraticCurveTo(cx + t * 0.2, cy, cx + t * 0.1, cy + t * 0.3)
        .lineTo(cx - t * 0.1, cy + t * 0.3)
        .quadraticCurveTo(cx - t * 0.2, cy, cx, cy - t * 0.5);
      g.fill({ color: GLAZE });
      g.rect(cx - t * 0.03, cy + t * 0.3, t * 0.06, t * 0.1);
      g.fill({ color: GLAZE });
    } else if (item.kind === 'bush') {
      // An amphora: a belly, a neck, two handles, a foot; a band incised.
      g.ellipse(cx, cy + t * 0.05, t * 0.18, t * 0.24);
      g.rect(cx - t * 0.06, cy - t * 0.32, t * 0.12, t * 0.16);
      g.poly([cx - t * 0.05, cy + t * 0.26, cx + t * 0.05, cy + t * 0.26, cx, cy + t * 0.4]);
      g.fill({ color: GLAZE });
      for (const s of [-1, 1]) {
        g.moveTo(cx + s * t * 0.06, cy - t * 0.26).quadraticCurveTo(
          cx + s * t * 0.2,
          cy - t * 0.26,
          cx + s * t * 0.14,
          cy - t * 0.1,
        );
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: GLAZE });
      g.moveTo(cx - t * 0.15, cy).lineTo(cx + t * 0.15, cy);
      g.stroke({ width: Math.max(0.8, t * 0.035), color: CLAY });
    } else if (item.variant % 2 === 0) {
      // A broken column: a drum standing, its fluting incised, another fallen beside it.
      g.rect(cx - t * 0.14, cy - t * 0.3, t * 0.28, t * 0.6);
      g.roundRect(cx + t * 0.12, cy + t * 0.18, t * 0.34, t * 0.16, t * 0.06);
      g.fill({ color: GLAZE });
      for (const fx of [-0.06, 0.06])
        g.moveTo(cx + fx * t, cy - t * 0.26).lineTo(cx + fx * t, cy + t * 0.26);
      g.stroke({ width: Math.max(0.8, t * 0.03), color: CLAY });
    } else {
      // A herm: a square pillar, a bearded head on it.
      g.rect(cx - t * 0.1, cy - t * 0.12, t * 0.2, t * 0.5);
      g.circle(cx, cy - t * 0.24, t * 0.13);
      g.poly([
        cx + t * 0.04,
        cy - t * 0.2,
        cx + t * 0.16,
        cy - t * 0.08,
        cx + t * 0.02,
        cy - t * 0.1,
      ]);
      g.fill({ color: GLAZE });
    }
  }
}
