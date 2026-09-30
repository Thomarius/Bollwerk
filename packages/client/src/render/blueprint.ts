import type { ArtConfig, BlueprintStyleConfig } from '@rampart/config';
import { Structure, Terrain, type MatchState, type Shot } from '@rampart/sim';
import { Graphics } from 'pixi.js';

import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  GunAims,
  Landings,
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
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
} from './theme.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { dashed, hatch, outline, trace, wallGeometry, type Segment } from './walls.js';

/** A mark where a shot landed: rings for a moment, and on a wall a demolition cross. */
interface Mark {
  x: number;
  y: number;
  age: number;
  onWall: boolean;
  inSea: boolean;
}

/** A line fragment thrown up by a destroyed block, in tile coordinates. */
interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  colour: number;
}

/** A block the sweep took, its outline dashing away. */
interface Fade {
  x: number;
  y: number;
  age: number;
  colour: number;
}

/** How long a recoil takes to come home. */
const RECOIL_MS = 160;
/** How long an impact's rings spread. */
const RING_MS = 420;

/**
 * The blueprint look: the board as an architect's plan, drawn in ink on blue paper.
 *
 * Clean and calm, which is what building needs, and offered for combat too. A drafting
 * grid runs over the whole sheet; the sea is hatched as a plan marks water, and the coast
 * is a bold contour. Walls are drawn as walls are on a plan — an outline hatched inside —
 * and stand up as the pixel style's do, to the same height. Castles are floor-plan
 * symbols filled in while sealed; guns are survey marks; sealed ground is cross-hatched
 * inside a dashed boundary. The piece in hand is dashed, as proposed construction is.
 * Player colours are the shared hues washed toward white, so they read on blue.
 */
export class BlueprintTheme implements Theme {
  readonly id = 'blueprint' as const;

  private art!: ArtConfig;
  private style!: BlueprintStyleConfig;

  private readonly terrainGfx = new Graphics();
  private readonly territoryGfx = new Graphics();
  private readonly ghostMotion = new GhostMotion();
  /**
   * An eraser's smudge where a block was shot away, for the rest of the round, under the
   * walls so a block drawn in again covers it; and pencil strokes over a piece just laid,
   * sketched and then inked over.
   */
  private readonly smudgeGfx = new Graphics();
  private smudges: { x: number; y: number; round: number }[] = [];
  private pencils: { cells: readonly Cell[]; age: number }[] = [];
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawBlueprintScenery(g, view, items, this.art),
    () => hex(this.art.palette.rockLight),
  );
  private readonly structureGfx = new Graphics();
  private readonly effectGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private marks: Mark[] = [];
  private fragments: Fragment[] = [];
  private fades: Fade[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks();
  private readonly flags = new FlagHoist();
  private clock = 0;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.blueprint;
    layers.terrain.addChild(this.terrainGfx);
    layers.territory.addChild(this.scenery.gfx, this.territoryGfx, this.smudgeGfx);
    layers.structures.addChild(this.structureGfx);
    layers.effects.addChild(this.effectGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.smudgeGfx.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.territoryGfx,
      this.structureGfx,
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

  /** Height of a castle's front face, in tiles: the pixel keep's, in proportion. */
  private castleFace(castle: { h: number }): number {
    const { frontFacePx } = this.art.generators.wall;
    return (castle.h * (frontFacePx + 2)) / (this.art.tileSizePx * 3);
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art, true);
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    // The sheet runs out past the board to the window's edge.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;

    // Water, hatched as a plan marks it.
    const sea: Segment[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y)) continue;
        sea.push(...hatch({ x: tileX(view, x), y: tileY(view, y), w: t, h: t }, t * 0.5, '/'));
      }
    }
    trace(g, sea);
    g.stroke({ width: 1, color: hex(palette.waterShallow), alpha: this.style.seaHatchAlpha * 2 });

    // Land as clean paper, tinted just enough to say whose island it is.
    for (let player = 0; player <= state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
        any = true;
      }
      if (!any) continue;
      g.fill({ color: hex(palette.grassMid) });
      if (player === 0) continue;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
      }
      g.fill({ color: this.colour(player - 1, 'dark'), alpha: 0.12 });
    }

    // The drafting grid over the whole sheet, heavier every few tiles.
    const every = this.style.gridMajorEvery;
    for (const major of [false, true]) {
      for (let x = x0; x <= x1; x++) {
        if ((x % every === 0) !== major) continue;
        g.moveTo(tileX(view, x), tileY(view, y0)).lineTo(tileX(view, x), tileY(view, y1));
      }
      for (let y = y0; y <= y1; y++) {
        if ((y % every === 0) !== major) continue;
        g.moveTo(tileX(view, x0), tileY(view, y)).lineTo(tileX(view, x1), tileY(view, y));
      }
      g.stroke({
        width: 1,
        color: hex(palette.grassLight),
        alpha: this.style.gridAlpha * (major ? 2 : 1),
      });
    }

    // The coast as a bold contour.
    const coast: Cell[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      coast.push({ x, y: (i - x) / state.width });
    }
    trace(g, outline(coast, land, view));
    g.stroke({ width: this.style.lineWidthPx, color: hex(palette.rockLight) });
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground cross-hatched in the owner's ink, inside a dashed boundary. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.territoryGfx;
    g.clear();
    const t = view.tile;
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const lines: Segment[] = [];
      for (const { x, y } of cells) {
        const rect = { x: tileX(view, x), y: tileY(view, y), w: t, h: t };
        lines.push(...hatch(rect, t * 0.5, '/'), ...hatch(rect, t * 0.5, '\\'));
      }
      trace(g, lines);
      g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      const inside = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      trace(
        g,
        outline(cells, inside, view).flatMap((s) => dashed(s, t * 0.3, t * 0.2)),
      );
      g.stroke({ width: 1.5, color: this.colour(player, 'light') });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  /** The eraser's smudges and the pencil's strokes; see `smudgeGfx`. */
  private drawDraftsmanship(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const sm = this.smudgeGfx;
    sm.clear();
    for (const s of this.smudges) if (s.round < 0) s.round = state.round;
    this.smudges = this.smudges.filter((s) => s.round === state.round);
    for (const s of this.smudges) {
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      sm.ellipse(cx, cy, t * 0.55, t * 0.38);
      sm.fill({ color: hex(this.art.palette.rockLight), alpha: 0.07 });
      sm.ellipse(cx + t * 0.1, cy - t * 0.05, t * 0.4, t * 0.24);
      sm.fill({ color: hex(this.art.palette.rockLight), alpha: 0.07 });
    }
    const g = this.effectGfx;
    const span = 700;
    for (const p of this.pencils) {
      p.age += deltaMs;
      const k = p.age / span;
      if (k >= 1) continue;
      for (const c of p.cells) {
        const x = tileX(view, c.x);
        const y = tileY(view, c.y);
        g.moveTo(x + t * 0.1, y + t * 0.85).lineTo(x + t * 0.95, y + t * 0.2);
        g.moveTo(x - t * 0.05, y + t * 0.1).lineTo(x + t * 1.05, y + t * 0.05);
      }
      g.stroke({ width: 1, color: hex(this.art.palette.rockLight), alpha: 0.6 * (1 - k) });
    }
    this.pencils = this.pencils.filter((p) => p.age < span);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.structureGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const line = this.style.lineWidthPx;
    const wallOf = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;

    for (let owner = 1; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      this.drawWall(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's rubble: demolished, drawn dashed, lying flat.
    const rubble: Cell[] = [];
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      rubble.push({ x, y: (i - x) / state.width });
    }
    trace(
      g,
      outline(rubble, (x, y) => wallOf(x, y) === 0, view).flatMap((s) =>
        dashed(s, t * 0.2, t * 0.15),
      ),
    );
    g.stroke({ width: 1, color: hex(palette.rockDark) });

    // Castles: a keep in plan, with round towers at its corners, over a front face.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * t;
      const h = castle.h * t;
      const inset = t * 0.15;
      const drop = this.castleFace(castle) * t;
      const lip = y + h - inset - drop;
      g.rect(x + inset, lip, w - inset * 2, drop);
      g.fill({ color: this.colour(owner, 'dark'), alpha: 0.7 });
      g.stroke({ width: 1, color: this.colour(owner, 'base') });
      g.rect(x + inset, y + inset, w - inset * 2, lip - y - inset);
      g.fill({ color: hex(palette.grassMid) });
      g.stroke({ width: line, color: this.colour(owner, 'light') });
      for (const [cx, cy] of [
        [x + inset, y + inset],
        [x + w - inset, y + inset],
        [x + inset, lip],
        [x + w - inset, lip],
      ] as const) {
        g.circle(cx, cy, t * 0.22);
      }
      g.fill({ color: hex(palette.grassMid) });
      g.stroke({ width: line * 0.75, color: this.colour(owner, 'light') });
    }

    // Guns: survey marks — a ring with its crosshair running out past it.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = (Math.min(cannon.w, cannon.h) * t) / 2 - t * 0.2;
      if (!cannon.active) {
        // Silenced: a dashed ring and no crosshair, as a mark struck from the plan. In the
        // owner's ink at full weight: a hairline of dark rock all but vanished on the sheet.
        for (let k = 0; k < 12; k += 2) {
          // Each dash begins a path of its own: a bare arc would join it by a line to
          // wherever the last path ended, which drew a stroke across the board.
          const a = (k / 12) * Math.PI * 2;
          g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          g.arc(cx, cy, r, a, ((k + 1) / 12) * Math.PI * 2);
          g.stroke({ width: line, color: this.colour(cannon.owner, 'light'), alpha: 0.85 });
        }
        continue;
      }
      g.circle(cx, cy, r);
      g.fill({ color: hex(palette.grassMid) });
      g.stroke({ width: line, color: this.colour(cannon.owner, 'light') });
      const reach = r + t * 0.25;
      g.moveTo(cx - reach, cy).lineTo(cx + reach, cy);
      g.moveTo(cx, cy - reach).lineTo(cx, cy + reach);
      g.stroke({ width: 1, color: this.colour(cannon.owner, 'base'), alpha: 0.8 });
    }
  }

  /**
   * Wall in the owner's ink, standing up: tops outlined and hatched inside, as walls are
   * on a plan, over front faces of the pixel style's height.
   */
  private drawWall(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
    alpha = 1,
  ): void {
    const t = view.tile;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha: 0.45 * alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha: 0.85 * alpha });

    trace(
      g,
      wall.tops.flatMap((r) => hatch(r, t * this.style.hatchTiles, '\\')),
    );
    g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: 0.75 * alpha });
    trace(g, [...wall.faceEdges, ...wall.strips]);
    g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: 0.7 * alpha });
    trace(g, wall.rim);
    g.stroke({ width: this.style.lineWidthPx, color: this.colour(player, 'light'), alpha });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea =
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      this.terrain[y * this.width + x] !== Terrain.Land;
    this.marks.push({ x, y, age: 0, onWall: debris.length > 0, inSea });
    for (const block of debris) this.smudges.push({ x: block.x, y: block.y, round: -1 });
    for (const block of debris) {
      for (let k = 0; k < 6; k++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 2;
        this.fragments.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          spin: Math.random() * Math.PI,
          age: 0,
          colour: this.colour(block.owner, 'light'),
        });
      }
    }
  }

  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockDark) : this.colour(block.owner, 'light');
    this.fades.push({ x: block.x, y: block.y, age: 0, colour });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.pencils.push({ cells, age: 0 });
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();
    this.clock += frame.deltaMs;
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.drawDraftsmanship(state, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockMid), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawKeeps(state, view, frame);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawPennants(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawMarks(view, frame.deltaMs);
    this.drawFragments(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A sealed keep's plan is filled in, solid; a breached one is left in outline. */
  private drawKeeps(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const castle of state.castles) {
      if (!(frame.castleSealed[castle.id] ?? false)) continue;
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * t;
      const h = castle.h * t;
      const inset = t * 0.45;
      const drop = this.castleFace(castle) * t;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset - drop - t * 0.15 - inset);
      g.fill({ color: this.colour(owner, 'base'), alpha: 0.85 });
    }
  }

  /** Barrels as a line from the mount with an arrowhead, kicking back on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const length = cannon.active ? 1.05 - 0.3 * kick : 0.5;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2;
      const sx = Math.sin(aim.angle);
      const sy = -Math.cos(aim.angle);
      const ex = tileX(view, cx + sx * length);
      const ey = tileY(view, cy + sy * length);
      const colour = cannon.active
        ? this.colour(cannon.owner, 'light')
        : hex(this.art.palette.rockDark);
      g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
      if (cannon.active) {
        // The arrowhead, as a direction is marked on a drawing.
        const head = t * 0.3;
        for (const side of [-1, 1]) {
          const a = aim.angle + Math.PI + side * 0.45;
          g.moveTo(ex, ey).lineTo(ex + Math.sin(a) * head, ey - Math.cos(a) * head);
        }
      }
      g.stroke({ width: Math.max(1.5, t * 0.12), color: colour });
    }
    this.aims.prune(state);
  }

  /** A pennant on a pole over each sealed keep, hoisted as it is sealed. */
  private drawPennants(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const pole = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - t * 1.1;
      const foot = tileY(view, castle.y + castle.h / 2 - 0.2);
      g.moveTo(pole, foot).lineTo(pole, top);
      g.stroke({ width: 1, color: hex(this.art.palette.rockLight) });
      const height = t * 0.55;
      const y = foot - height - raised * (foot - top - height);
      g.poly([pole, y, pole + t * 0.8, y + height / 2, pole, y + height]);
      if (this.flags.lowering(castle.id)) {
        g.stroke({ width: 1, color: this.colour(owner, 'light') });
      } else {
        g.fill({ color: this.colour(owner, 'light') });
      }
    }
  }

  /**
   * Shots as a projectile symbol — a ring with a cross — riding a dashed trajectory
   * from the gun, with a small cross on the ground below.
   */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const at = (tk: number): { x: number; y: number } => ({
        x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * tk + 0.5),
        y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * tk + 0.5 - shotLift(shot, tk)),
      });
      const colour = this.colour(shot.owner, 'light');
      // The trajectory behind it, in short dashes.
      const steps = 14;
      for (let k = 0; k < steps; k += 2) {
        const a = at((p * k) / steps);
        const b = at((p * (k + 1)) / steps);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 1, color: colour, alpha: 0.45 });
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const s = t * 0.12;
      g.moveTo(gx - s, gy - s).lineTo(gx + s, gy + s);
      g.moveTo(gx - s, gy + s).lineTo(gx + s, gy - s);
      g.stroke({ width: 1, color: colour, alpha: 0.5 });
      const head = at(p);
      const r = t * (0.2 + 0.08 * Math.min(1, shotLift(shot, p) / 3));
      g.circle(head.x, head.y, r);
      g.fill({ color: hex(this.art.palette.shadow) });
      g.stroke({ width: 1.5, color: colour });
      g.moveTo(head.x - r, head.y).lineTo(head.x + r, head.y);
      g.moveTo(head.x, head.y - r).lineTo(head.x, head.y + r);
      g.stroke({ width: 1, color: colour });
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /**
   * Where a shot came down: rings spreading from it, and where it took a wall a cross
   * marking the block demolished, fading as the breach is left to smoulder.
   */
  private drawMarks(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const linger = this.art.generators.fx.smoulderMs;
    for (const mark of this.marks) {
      mark.age += deltaMs;
      const cx = tileX(view, mark.x + 0.5);
      const cy = tileY(view, mark.y + 0.5);
      const ring = mark.age / RING_MS;
      if (ring < 1) {
        const colour = hex(mark.inSea ? this.art.palette.waterFoam : this.art.palette.uiInk);
        g.circle(cx, cy, t * (0.3 + 1.4 * ring));
        g.stroke({ width: 1.5, color: colour, alpha: 1 - ring });
        if (mark.inSea) {
          g.circle(cx, cy, t * (0.15 + 0.8 * ring));
          g.stroke({ width: 1, color: colour, alpha: 1 - ring });
        }
      }
      if (!mark.onWall) continue;
      const life = 1 - mark.age / linger;
      if (life <= 0) continue;
      const s = t * 0.35;
      g.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s);
      g.moveTo(cx - s, cy + s).lineTo(cx + s, cy - s);
      g.stroke({ width: 1.5, color: hex(this.art.palette.uiInvalid), alpha: life });
    }
    this.marks = this.marks.filter((m) => m.age < (m.onWall ? Math.max(linger, RING_MS) : RING_MS));
  }

  /** Pieces of line thrown up by a destroyed block, tumbling as they fall. */
  private drawFragments(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const life = this.art.generators.fx.debrisMs;
    const dt = deltaMs / 1000;
    const half = view.tile * 0.12;
    for (const f of this.fragments) {
      f.age += deltaMs;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 9 * dt;
      f.spin += dt * 8;
      const x = tileX(view, f.x);
      const y = tileY(view, f.y);
      g.moveTo(x - Math.cos(f.spin) * half, y - Math.sin(f.spin) * half);
      g.lineTo(x + Math.cos(f.spin) * half, y + Math.sin(f.spin) * half);
      g.stroke({ width: 1.5, color: f.colour, alpha: Math.max(0, 1 - f.age / life) });
    }
    this.fragments = this.fragments.filter((f) => f.age < life);
  }

  /** A block the sweep took, its outline breaking into dashes and fading. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.flat.crumbleMs;
    const t = view.tile;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const k = fade.age / span;
      if (k >= 1) continue;
      const cell = [{ x: fade.x, y: fade.y }];
      const gap = t * 0.1 + t * 0.4 * k;
      trace(
        g,
        outline(cell, () => false, view).flatMap((s) => dashed(s, t * 0.25, gap)),
      );
      g.stroke({ width: 1.5, color: fade.colour, alpha: 1 - k });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    drawOvertimeBorder(g, state, view, this.art, performance.now());
    drawSelectable(g, view, ghost, this.art, performance.now());
    drawBuildHints(g, view, ghost, this.art, performance.now());
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      // Proposed construction, drawn dashed as a plan draws it: hatched in the player's
      // ink where it fits, and crossed out in red where it does not.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
      const inside = (x: number, y: number): boolean => inPiece.has(`${x},${y}`);
      const colour = ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.uiInvalid);
      const fill: Segment[] = [];
      for (const { x, y } of cells) {
        const rect = { x: tileX(view, x), y: tileY(view, y), w: t, h: t };
        if (ghost.valid) fill.push(...hatch(rect, t * this.style.hatchTiles, '\\'));
        else {
          fill.push({ x1: rect.x, y1: rect.y, x2: rect.x + t, y2: rect.y + t });
          fill.push({ x1: rect.x, y1: rect.y + t, x2: rect.x + t, y2: rect.y });
        }
      }
      trace(g, fill);
      g.stroke({ width: 1, color: colour, alpha: 0.7 });
      trace(
        g,
        outline(cells, inside, view).flatMap((s) => dashed(s, t * 0.3, t * 0.15)),
      );
      g.stroke({ width: this.style.lineWidthPx, color: colour });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = (Math.min(ghost.footprint.w, ghost.footprint.h) * t) / 2 - t * 0.2;
      for (let k = 0; k < 16; k += 2) {
        const a = (k / 16) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.arc(cx, cy, r, a, ((k + 1) / 16) * Math.PI * 2);
        g.stroke({ width: this.style.lineWidthPx, color: colour });
      }
      const reach = r + t * 0.25;
      g.moveTo(cx - reach, cy).lineTo(cx + reach, cy);
      g.moveTo(cx, cy - reach).lineTo(cx, cy + reach);
      if (!ghost.valid) {
        // Struck through: red alone would vanish on the crimson player's own ink.
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
      }
      g.stroke({ width: 1.5, color: colour });
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Blueprint's scenery as a plan draws it: a tree its canopy's scalloped edge, a
 * pine a circle with its needles ticked round it, a bush a small circle, a boulder an
 * outline with a line of hatching. Thin and pale, beneath the walls' weight.
 */
function drawBlueprintScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // A canopy's scalloped edge, as landscape plans draw trees: a plain circle with a
      // cross was a gun's survey mark in small.
      const r = t * (0.3 + (item.variant % 2) * 0.04);
      const points: number[] = [];
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        const bump = r * (0.84 + 0.16 * Math.abs(Math.sin(a * 3.5)));
        points.push(cx + Math.cos(a) * bump, cy + Math.sin(a) * bump);
      }
      g.poly(points);
      g.circle(cx, cy, Math.max(1, t * 0.03));
    } else if (item.kind === 'pine') {
      const r = t * 0.24;
      g.circle(cx, cy, r);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.lineTo(cx + Math.cos(a) * (r + t * 0.1), cy + Math.sin(a) * (r + t * 0.1));
      }
    } else if (item.kind === 'bush') {
      g.circle(cx - t * 0.1, cy, t * 0.14);
      g.circle(cx + t * 0.12, cy + t * 0.04, t * 0.12);
    } else {
      const r = t * 0.2;
      g.poly([
        cx - r,
        cy + r * 0.5,
        cx - r * 0.5,
        cy - r * 0.7,
        cx + r * 0.6,
        cy - r * 0.6,
        cx + r,
        cy + r * 0.4,
        cx + r * 0.1,
        cy + r * 0.8,
      ]);
      g.moveTo(cx - r * 0.3, cy + r * 0.5).lineTo(cx + r * 0.4, cy - r * 0.2);
    }
  }
  g.stroke({ width: 1, color: hex(art.palette.rockMid), alpha: 0.7 });
}
