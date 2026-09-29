import type { ArtConfig, BricksStyleConfig } from '@rampart/config';
import { Structure, Terrain, type MatchState, type Shot } from '@rampart/sim';
import { Graphics } from 'pixi.js';

import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  GunAims,
  Landings,
  ReloadRings,
  RuinSmoke,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawSealPreview,
  drawChoices,
  drawSelectable,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
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
import { outline, trace, wallGeometry } from './walls.js';

/** A brick knocked loose by a shot or the sweep, tumbling as it falls. */
interface Loose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  colour: number;
  /** How long it lasts, in milliseconds. */
  life: number;
  /** The ground it bounces off, a little below where it was knocked from, in tiles. */
  floor: number;
}

/** Rings where a shot came down in the sea. */
interface Splash {
  x: number;
  y: number;
  age: number;
}

/** A piece that has just clicked down: its studs flash. */
interface Click {
  cells: readonly Cell[];
  age: number;
}

/** How long a recoil takes to come home. */
const RECOIL_MS = 160;
/** How long a splash's rings spread. */
const SPLASH_MS = 520;
/** How long the flash off a piece's studs lasts as it clicks down. */
const CLICK_MS = 260;

/**
 * The toy bricks look (PLAN 11.11 W8): the board built of studded plastic bricks on
 * baseplates — green under the land, blue under the sea, whose studs are faint so the sea
 * stays calm behind the game. Walls are bricks in the owner's colour, a stud on every
 * top, standing up to the pixel style's height so a banner's wipe lines up; sealed
 * ground is smooth tiles laid over the studs; castles are brick towers flying a flag;
 * guns are a grey brick mount with a round barrel. Pieces click down, and a hit knocks
 * bricks loose. The player colours are the shared ones: bright and clean already.
 */
export class BricksTheme implements Theme {
  readonly id = 'bricks' as const;

  private art!: ArtConfig;
  private style!: BricksStyleConfig;

  private readonly terrainGfx = new Graphics();
  private readonly territoryGfx = new Graphics();
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land, built of bricks; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawBrickScenery(g, view, items, this.art),
    () => hex(this.art.palette.grassLight),
  );
  private readonly structureGfx = new Graphics();
  private readonly effectGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private loose: Loose[] = [];
  private splashes: Splash[] = [];
  private clicks: Click[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  private readonly reloads = new ReloadRings();
  private readonly fireworks = new Fireworks();
  private readonly flags = new FlagHoist();
  private clock = 0;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.bricks;
    layers.terrain.addChild(this.terrainGfx);
    layers.territory.addChild(this.territoryGfx, this.scenery.gfx);
    layers.structures.addChild(this.structureGfx);
    layers.effects.addChild(this.effectGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
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

  /** A stud: a round boss with its lit rim to the north-west and its shade to the south. */
  private stud(g: Graphics, cx: number, cy: number, t: number, colour: number, alpha = 1): void {
    const r = (t * this.style.studScale) / 2;
    g.circle(cx, cy + r * 0.25, r);
    g.fill({ color: 0x000000, alpha: 0.22 * alpha });
    g.circle(cx, cy, r);
    g.fill({ color: colour, alpha });
    g.moveTo(cx - r * 0.7, cy - r * 0.1);
    g.arc(cx, cy, r * 0.7, Math.PI, Math.PI * 1.5);
    g.stroke({ width: Math.max(1, t * 0.05), color: 0xffffff, alpha: 0.55 * alpha });
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

    // The sea's baseplate runs out past the board to the window's edge.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    g.rect(
      tileX(view, -marginX),
      tileY(view, -marginY),
      (state.width + 2 * marginX) * t,
      (state.height + 2 * marginY) * t,
    );
    g.fill({ color: hex(palette.waterMid) });
    // Faint studs on the sea: every other tile, so it reads as a baseplate and stays calm.
    const r = (t * this.style.studScale) / 2;
    for (let y = -marginY; y < state.height + marginY; y++) {
      for (let x = -marginX; x < state.width + marginX; x++) {
        if (land(x, y) || (x + y) % 2 !== 0) continue;
        g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), r);
      }
    }
    g.fill({ color: hex(palette.waterShallow), alpha: this.style.seaStudAlpha * 2 });

    // The land's plate, raised: a darker edge where it drops to the sea on its south.
    const cells: Cell[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      cells.push({ x, y: (i - x) / state.width });
      g.rect(tileX(view, x), tileY(view, (i - x) / state.width), t, t);
    }
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of cells) {
      if (land(x, y + 1)) continue;
      g.rect(tileX(view, x), tileY(view, y + 1), t, t * 0.22);
    }
    g.fill({ color: hex(palette.grassDark) });
    // A faint tint of the owner on each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of cells) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.06 });
    }
    // The land's studs, every tile.
    for (const { x, y } of cells) {
      g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), r);
    }
    g.fill({ color: hex(palette.grassLight), alpha: this.style.landStudAlpha });
    trace(g, outline(cells, land, view));
    g.stroke({ width: 1, color: hex(palette.grassDark) });
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as smooth tiles laid over the studs, in the owner's colour. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.territoryGfx;
    g.clear();
    const t = view.tile;
    const gap = Math.max(1, t * 0.06);
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      for (const { x, y } of cells) {
        g.rect(tileX(view, x) + gap / 2, tileY(view, y) + gap / 2, t - gap, t - gap);
      }
      g.fill({ color: this.colour(player, 'light'), alpha: this.style.territoryAlpha });
      // Each tile's sheen along its lit edge.
      for (const { x, y } of cells) {
        const px = tileX(view, x) + gap;
        const py = tileY(view, y) + gap;
        g.moveTo(px, py + t * 0.5)
          .lineTo(px, py)
          .lineTo(px + t * 0.5, py);
      }
      g.stroke({ width: 1, color: 0xffffff, alpha: this.style.sheenAlpha * 0.6 });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.structureGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
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
      this.drawBricks(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's wall: grey bricks lying loose, askew, no studs up.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const jitter = ((x * 7 + y * 13) % 5) / 5;
      g.rect(tileX(view, x + 0.1 + jitter * 0.1), tileY(view, y + 0.3), t * 0.7, t * 0.45);
    }
    g.fill({ color: hex(palette.rockMid) });

    // Castles: a tower of bricks, a smaller keep standing on it, studs on both.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * t;
      const h = castle.h * t;
      const face = this.faceFraction() * t * 1.4;
      const inset = t * 0.08;
      // The tower: top and face.
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2 - face);
      g.fill({ color: this.colour(owner, 'base') });
      g.rect(x + inset, y + h - inset - face, w - inset * 2, face);
      g.fill({ color: this.colour(owner, 'dark') });
      // Brick courses across the face.
      for (let k = 1; k < 3; k++) {
        const cy = y + h - inset - face + (face * k) / 3;
        g.moveTo(x + inset, cy).lineTo(x + w - inset, cy);
      }
      g.stroke({ width: 1, color: 0x000000, alpha: 0.25 });
      // The keep on top.
      const kx = x + w * 0.25;
      const ky = y + inset;
      const kw = w * 0.5;
      const kh = h * 0.42;
      g.rect(kx, ky, kw, kh);
      g.fill({ color: this.colour(owner, 'light') });
      g.rect(kx, ky + kh, kw, face * 0.6);
      g.fill({ color: this.colour(owner, 'base') });
      for (let sy = 0; sy < castle.h; sy++) {
        for (let sx = 0; sx < castle.w; sx++) {
          const cx = x + (sx + 0.5) * t;
          const cy = y + (sy + 0.5) * t - face * 0.5;
          const onKeep = cx > kx && cx < kx + kw && cy > ky && cy < ky + kh;
          this.stud(
            g,
            cx,
            onKeep ? cy - t * 0.12 : cy,
            t,
            this.colour(owner, onKeep ? 'light' : 'base'),
          );
        }
      }
    }

    // Guns: a grey brick mount with a stud at each corner; the barrel is an effect.
    for (const cannon of state.cannons) {
      const x = tileX(view, cannon.x);
      const y = tileY(view, cannon.y);
      const w = cannon.w * t;
      const h = cannon.h * t;
      const inset = t * 0.18;
      const face = this.faceFraction() * t;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2 - face);
      g.fill({ color: hex(cannon.active ? palette.rockMid : palette.rockDark) });
      g.rect(x + inset, y + h - inset - face, w - inset * 2, face);
      g.fill({ color: hex(palette.rockDark) });
      // A band in the owner's colour, so whose gun it is reads at a glance.
      g.rect(x + inset, y + h - inset - face, w - inset * 2, Math.max(1, face * 0.35));
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      for (const [sx, sy] of [
        [0.3, 0.3],
        [cannon.w - 0.3, 0.3],
        [0.3, cannon.h - 0.3],
        [cannon.w - 0.3, cannon.h - 0.3],
      ] as const) {
        this.stud(g, x + sx * t, y + sy * t - face * 0.4, t * 0.7, hex(palette.rockLight));
      }
    }
  }

  /**
   * Bricks in the owner's colour, standing up as the pixel style's walls do: a top with a
   * stud and a lit edge, a darker front face, and the seams between bricks.
   */
  private drawBricks(
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
    g.fill({ color: this.colour(player, 'base'), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.colour(player, 'dark'), alpha });
    // Seams: every brick is its own, so a shot visibly takes one.
    for (const b of wall.blocks) {
      g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
    }
    g.stroke({ width: 1, color: 0x000000, alpha: 0.28 * alpha });
    // The plastic's sheen along each top's lit edges.
    for (const b of wall.blocks) {
      g.moveTo(b.left + 1, b.lip - 1)
        .lineTo(b.left + 1, b.top + 1)
        .lineTo(b.left + t - 1, b.top + 1);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: this.style.sheenAlpha * alpha });
    for (const b of wall.blocks) {
      // In the lighter shade, so every brick visibly carries its stud.
      this.stud(
        g,
        b.left + t / 2,
        b.top + (b.lip - b.top) / 2,
        t,
        this.colour(player, 'light'),
        alpha,
      );
    }
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
    if (inSea) this.splashes.push({ x, y, age: 0 });
    // A hit knocks the brick apart: its halves and a stud or two fly off and bounce away.
    for (const block of debris) {
      for (let k = 0; k < 5; k++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const speed = 2 + Math.random() * 2.5;
        this.loose.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          spin: Math.random() * Math.PI,
          age: 0,
          colour: this.colour(block.owner, k === 0 ? 'light' : 'base'),
          life: this.art.generators.fx.debrisMs,
          floor: block.y + 0.9,
        });
      }
    }
  }

  /** The sweep: a loose brick pops up off the wall and falls away. */
  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0 ? hex(this.art.palette.rockMid) : this.colour(block.owner, 'base');
    this.loose.push({
      x: block.x + 0.5,
      y: block.y + 0.5,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -3,
      spin: 0,
      age: 0,
      colour,
      life: this.art.flat.crumbleMs,
      floor: block.y + 0.9,
    });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
    this.clicks.push({ cells, age: 0 });
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();
    this.clock += frame.deltaMs;
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.drawClicks(view, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.reloads.draw(
      g,
      view,
      state,
      this.art,
      frame.humanPlayer,
      frame.tickFraction,
      frame.deltaMs,
    );
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawFlags(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawSplashes(view, frame.deltaMs);
    this.drawLoose(view, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** A piece clicking down: a flash off its studs, as plastic snapping home catches light. */
  private drawClicks(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const r = (t * this.style.studScale) / 2;
    for (const click of this.clicks) {
      click.age += deltaMs;
      const k = click.age / CLICK_MS;
      if (k >= 1) continue;
      for (const c of click.cells) {
        g.circle(tileX(view, c.x + 0.5), tileY(view, c.y + 0.35), r * (1 + 0.8 * k));
      }
      g.stroke({ width: Math.max(1, t * 0.08), color: 0xffffff, alpha: 0.8 * (1 - k) });
    }
    this.clicks = this.clicks.filter((c) => c.age < CLICK_MS);
  }

  /** Barrels: a round barrel from the mount, a lighter muzzle ring, kicking back on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const { palette } = this.art;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const length = cannon.active ? 1.0 - 0.28 * kick : 0.45;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2 - this.faceFraction() * 0.5;
      const ex = tileX(view, cx + Math.sin(aim.angle) * length);
      const ey = tileY(view, cy - Math.cos(aim.angle) * length);
      const width = Math.max(3, t * 0.36);
      g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
      g.stroke({
        width,
        color: hex(cannon.active ? palette.rockDark : palette.craterDark),
        cap: 'round',
      });
      g.circle(ex, ey, width * 0.55);
      g.fill({ color: hex(cannon.active ? palette.rockLight : palette.rockMid) });
      g.circle(tileX(view, cx), tileY(view, cy), width * 0.7);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
    }
    this.aims.prune(state);
  }

  /** A square flag on a pole over each sealed castle, hoisted as it is sealed. */
  private drawFlags(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const pole = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - t * 1.1;
      const foot = tileY(view, castle.y + 0.3);
      g.moveTo(pole, foot).lineTo(pole, top);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: hex(this.art.palette.rockLight) });
      g.circle(pole, top, Math.max(1.5, t * 0.1));
      g.fill({ color: hex(this.art.palette.rockLight) });
      const height = t * 0.5;
      const y = foot - height - raised * (foot - top - height);
      g.rect(pole, y, t * 0.7, height);
      g.fill({ color: this.colour(owner, this.flags.lowering(castle.id) ? 'dark' : 'light') });
    }
  }

  /** Shots: a round brick lobbed, growing toward the top of its arc over a shadow. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / 3);
      g.ellipse(gx, gy, t * (0.28 - 0.12 * high), t * (0.14 - 0.06 * high));
      g.fill({ color: 0x000000, alpha: 0.3 - 0.15 * high });
      const hy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5 - lift);
      const r = t * (0.26 + 0.12 * high);
      g.circle(gx, hy, r);
      g.fill({ color: this.colour(shot.owner, 'base') });
      g.stroke({ width: 1, color: this.colour(shot.owner, 'dark') });
      this.stud(g, gx, hy - r * 0.15, r * 1.9, this.colour(shot.owner, 'light'));
      drawShotTarget(g, view, state, shot, p, this.art, frame.humanPlayer);
    }
  }

  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const cx = tileX(view, s.x + 0.5);
      const cy = tileY(view, s.y + 0.5);
      g.circle(cx, cy, t * (0.25 + 1.2 * k));
      g.circle(cx, cy, t * (0.1 + 0.6 * k));
      g.stroke({ width: 2, color: hex(this.art.palette.waterFoam), alpha: 1 - k });
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /** Loose bricks: small blocks tumbling, bouncing once off the ground, then gone. */
  private drawLoose(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.loose) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 12 * dt;
      b.spin += dt * 7;
      if (b.y > b.floor && b.vy > 0) {
        b.y = b.floor;
        b.vy *= -0.35;
        b.vx *= 0.6;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      const w = t * 0.34;
      const h = t * 0.22;
      const c = Math.cos(b.spin);
      const s = Math.sin(b.spin);
      const corner = (dx: number, dy: number): [number, number] => [
        x + dx * c - dy * s,
        y + dx * s + dy * c,
      ];
      g.poly([
        ...corner(-w / 2, -h / 2),
        ...corner(w / 2, -h / 2),
        ...corner(w / 2, h / 2),
        ...corner(-w / 2, h / 2),
      ]);
      g.fill({ color: b.colour, alpha });
    }
    this.loose = this.loose.filter((b) => b.age < b.life);
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
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      if (ghost.valid) {
        // The piece in hand as the bricks it will be, a little see-through.
        const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
        this.drawBricks(g, view, cells, (x, y) => inPiece.has(`${x},${y}`), humanPlayer, 0.7);
        return;
      }
      // Where it does not fit: hollow, a red outline and a cross in each cell — a red
      // brick would be the crimson player's own colour, so the difference is in form.
      trace(
        g,
        outline(cells, (x, y) => cells.some((c) => c.x === x && c.y === y), view),
      );
      for (const { x, y } of cells) {
        const px = tileX(view, x);
        const py = tileY(view, y);
        g.moveTo(px + t * 0.25, py + t * 0.25).lineTo(px + t * 0.75, py + t * 0.75);
        g.moveTo(px + t * 0.25, py + t * 0.75).lineTo(px + t * 0.75, py + t * 0.25);
      }
      g.stroke({ width: Math.max(1.5, t * 0.1), color: hex(palette.uiInvalid) });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      const inset = t * 0.18;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      g.fill({ color: colour, alpha: 0.25 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        // Struck through: red alone would vanish on the crimson player's own bricks.
        g.moveTo(x + inset, y + h - inset).lineTo(x + w - inset, y + inset);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Toy bricks' scenery, built of bricks too: a tree a brown stud trunk under stacked round
 * plates of green, a pine a stepped cone of plates, a bush a round green plate — or, one
 * in two, a flower, a round plate of red or yellow — and a boulder a grey sloped brick.
 */
function drawBrickScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const { palette } = art;
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      g.rect(cx - t * 0.08, cy, t * 0.16, t * 0.3);
      g.fill({ color: 0x7a4a22 });
      for (const [dy, r] of [
        [0.02, 0.36],
        [-0.16, 0.26],
      ] as const) {
        g.circle(cx, cy + dy * t + t * 0.05, r * t);
        g.fill({ color: 0x000000, alpha: 0.2 });
        g.circle(cx, cy + dy * t, r * t);
        g.fill({ color: hex(palette.grassLight) });
      }
      g.circle(cx - t * 0.07, cy - t * 0.22, t * 0.06);
      g.fill({ color: 0xffffff, alpha: 0.5 });
    } else if (item.kind === 'pine') {
      for (const [dy, half] of [
        [0.15, 0.34],
        [-0.05, 0.25],
        [-0.25, 0.15],
      ] as const) {
        g.rect(cx - half * t, cy + dy * t, half * 2 * t, t * 0.18);
        g.fill({ color: hex(palette.grassDark) });
        g.rect(cx - half * t, cy + dy * t, half * 2 * t, t * 0.05);
        g.fill({ color: hex(palette.grassLight), alpha: 0.7 });
      }
    } else if (item.kind === 'bush') {
      const flower = item.variant % 2 === 1;
      const colour = flower
        ? item.variant % 4 === 1
          ? 0xe8403a
          : 0xffd23c
        : hex(palette.grassLight);
      g.circle(cx, cy + t * 0.04, t * 0.2);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.circle(cx, cy, t * 0.2);
      g.fill({ color: colour });
      g.circle(cx - t * 0.05, cy - t * 0.05, t * 0.06);
      g.fill({ color: 0xffffff, alpha: 0.55 });
    } else {
      // A sloped brick: its studs on the high side, the slope falling away to the south.
      g.rect(cx - t * 0.32, cy - t * 0.2, t * 0.64, t * 0.2);
      g.fill({ color: hex(palette.rockMid) });
      g.poly([
        cx - t * 0.32,
        cy,
        cx + t * 0.32,
        cy,
        cx + t * 0.32,
        cy + t * 0.26,
        cx - t * 0.32,
        cy + t * 0.26,
      ]);
      g.fill({ color: hex(palette.rockDark) });
      for (const dx of [-0.14, 0.14]) {
        g.circle(cx + dx * t, cy - t * 0.12, t * 0.08);
      }
      g.fill({ color: hex(palette.rockLight) });
    }
  }
}
