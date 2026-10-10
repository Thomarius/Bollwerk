import type { ArtConfig, FlatStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import type { TimerSpot } from '../timerSpot.js';

import { cornerSpot, pressing } from './corner.js';
import { IslandParts } from './islandParts.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
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
  MainCastles,
  drawShotTarget,
  hex,
  playerColour,
  tileX,
  tileY,
  type EffectFrame,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
  shotLift,
  type Cell,
  type Debris,
  shotProgress,
} from './theme.js';
import { FlatSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { clearDrawn } from './clearDrawn.js';

interface Impact {
  x: number;
  y: number;
  age: number;
}

const IMPACT_MS = 320;

/** A swept block fading out where it stood. */
interface Crumble {
  x: number;
  y: number;
  colour: number;
  age: number;
}

/**
 * The minimal style: flat colour, hard edges, no textures and no atlas.
 *
 * It began as placeholder art and is kept as a real option. Besides being a style in
 * its own right, it is the fallback if texture generation fails or is slow, and it is
 * far easier to debug against — an enclosure or territory bug is obvious in flat colour
 * and easy to miss under texture.
 *
 * Everything is drawn into one Graphics per layer, with shapes batched by colour: at
 * 80x80 a full repaint is a few thousand rectangles and happens only when the grid
 * actually changes.
 */
export class FlatTheme implements Theme {
  readonly id = 'flat' as const;

  private art!: ArtConfig;
  /** Life on the outer ocean (`seaLife.ts`). */
  private readonly seaLife = new FlatSeaLife();
  private style!: FlatStyleConfig;

  private readonly terrainGfx = new Graphics();
  /** The buoy in the corner (PLAN 11.24), redrawn each frame as it bobs and blinks. */
  private readonly buoyGfx = new Graphics();
  private buoy: TimerSpot | null = null;
  /** Where the light is in its blink, in blinks, so a change of pace does not jump it. */
  private blinks = 0;
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  /** Trees, bushes and boulders on open land; see `scenery.ts`. */
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawFlatScenery(g, view, items, this.art),
    () => hex(this.art.palette.grassLight),
  );
  /** Walls, houses and guns, an island to a `Graphics`, redrawn where they change. */
  private readonly structures = new IslandParts();
  private readonly effectGfx = new Graphics();
  /** The main castles' crowns, over the flags, redrawn only when one changes. */
  private readonly crowns = new MainCastles();
  /** What lies over the crowns: shots, impacts, crumbles. */
  private readonly aboveCrownsGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private impacts: Impact[] = [];
  private crumbles: Crumble[] = [];
  private readonly landings = new Landings();
  private readonly fireworks = new Fireworks();
  private readonly winnerBanners = new WinnerBanners();
  private readonly flags = new FlagHoist();
  /** Milliseconds of drawing, for the flags. */
  private clock = 0;

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.flat;
    layers.terrain.addChild(this.terrainGfx, this.buoyGfx);
    layers.territory.addChild(this.scenery.gfx, this.territory.container);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(this.effectGfx, this.crowns.gfx, this.aboveCrownsGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.buoyGfx,
      this.effectGfx,
      this.crowns.gfx,
      this.aboveCrownsGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  /** The flat style stays plain: it is the one to debug against. */
  noteShot(): void {}

  noteImpact(x: number, y: number): void {
    this.impacts.push({ x, y, age: 0 });
  }

  noteCrumble(block: Debris): void {
    const colour =
      block.owner < 0
        ? hex(this.art.palette.rockDark)
        : playerColour(this.art, block.owner, 'light');
    this.crumbles.push({ x: block.x, y: block.y, colour, age: 0 });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.buoy = cornerSpot(state, view);
    this.seaLife.corner = this.buoy;
    this.seaLife.layout(state, view, this.art);
    this.scenery.refresh(state, view, this.art, true);
    const g = this.terrainGfx;
    clearDrawn(g);
    // Tinted per island, which is the only thing that makes ownership readable
    // before anything has been built.
    for (let player = 0; player < state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player + 1) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
        any = true;
      }
      if (any) {
        g.fill({ color: playerColour(this.art, player, 'dark'), alpha: this.style.landAlpha });
      }
    }
  }

  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  /** One island's sealed ground, for `IslandParts`: the board holds that island's alone. */
  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
    for (let player = 0; player < state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
        any = true;
      }
      if (any) {
        g.fill({
          color: playerColour(this.art, player, 'light'),
          alpha: this.style.territoryAlpha,
        });
      }
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  /** One island's structures, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const inset = view.tile >= 6 ? this.style.structureInsetPx : 0;
    const size = view.tile - inset * 2;

    // Walls first, batched per owner. Owner 0 is neutral rubble left by an
    // eliminated player.
    for (let player = 0; player <= state.players.length; player++) {
      let any = false;
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== player) continue;
        const x = i % state.width;
        g.rect(tileX(view, x) + inset, tileY(view, (i - x) / state.width) + inset, size, size);
        any = true;
      }
      if (any) {
        g.fill({
          color:
            player === 0
              ? hex(this.art.palette.rockDark)
              : playerColour(this.art, player - 1, 'light'),
        });
      }
    }

    // Castles and cannons are drawn per entity rather than per tile, so each can
    // carry a mark that tells it apart from a plain block at a glance.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * view.tile;
      const h = castle.h * view.tile;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      g.fill({ color: playerColour(this.art, owner, 'base') });

      const core = Math.floor(Math.min(w, h) * this.style.castleCoreScale);
      g.rect(x + (w - core) / 2, y + (h - core) / 2, core, core);
      g.fill({ color: playerColour(this.art, owner, 'dark') });
    }

    for (const cannon of state.cannons) {
      const x = tileX(view, cannon.x);
      const y = tileY(view, cannon.y);
      const w = cannon.w * view.tile;
      const h = cannon.h * view.tile;
      g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      g.fill({ color: playerColour(this.art, cannon.owner, 'dark') });

      g.circle(x + w / 2, y + h / 2, Math.max(1, Math.min(w, h) * this.style.cannonBoreScale));
      g.fill({ color: playerColour(this.art, cannon.owner, 'light') });

      // An inert cannon reads as struck through: it survives, but it cannot fire.
      if (!cannon.active) {
        g.moveTo(x + inset, y + inset);
        g.lineTo(x + w - inset, y + h - inset);
        g.stroke({ width: this.style.outlineWidthPx, color: hex(this.art.palette.uiInvalid) });
      }
    }
  }

  /**
   * A signal buoy in the corner, as plain as the rest of the style: a white cone banded in
   * grey, a little cage on top with its light in the accent's gold, bobbing on the swell
   * and blinking — quicker while the clock presses (PLAN 11.24). Lit and still when motion
   * is reduced.
   */
  private drawBuoy(state: MatchState, view: ViewTransform, spot: TimerSpot, deltaMs: number): void {
    const g = this.buoyGfx;
    // A third larger than the square it is given, which a cone this slender does not fill.
    const s = spot.size * view.tile * 1.35;
    const still = motionReduced();
    const blinkMs = pressing(state) ? this.style.buoyHurriedBlinkMs : this.style.buoyBlinkMs;
    if (!still) this.blinks += Math.max(0, deltaMs) / blinkMs;
    const swell = still ? 0 : Math.sin((this.clock / this.style.buoyBobMs) * Math.PI * 2);
    const cx = tileX(view, spot.x);
    const water = tileY(view, spot.y) + s * 0.18;
    const y = water + swell * s * 0.025;
    const lit = still || this.blinks % 1 < 0.35;
    const sea = hex(this.art.palette.waterShallow);
    const white = hex(this.art.palette.uiInk);
    const grey = hex(this.art.palette.rockMid);
    const gold = hex(this.art.palette.uiAccent);

    // Rings on the water round it, spreading as it bobs.
    for (let k = 0; k < 2; k++) {
      const p = still ? 0.5 : (this.clock / this.style.buoyBobMs + k * 0.5) % 1;
      g.ellipse(cx, water + s * 0.04, s * (0.22 + 0.2 * p), s * (0.05 + 0.04 * p));
      g.stroke({ width: Math.max(1, s * 0.012), color: sea, alpha: 0.7 * (1 - p) });
    }
    // The float, and the cone on it, its band in grey.
    g.ellipse(cx, y + s * 0.03, s * 0.2, s * 0.05);
    g.fill({ color: grey });
    g.poly([
      cx - s * 0.15,
      y,
      cx + s * 0.15,
      y,
      cx + s * 0.06,
      y - s * 0.36,
      cx - s * 0.06,
      y - s * 0.36,
    ]);
    g.fill({ color: white });
    g.poly([
      cx - s * 0.113,
      y - s * 0.12,
      cx + s * 0.113,
      y - s * 0.12,
      cx + s * 0.09,
      y - s * 0.2,
      cx - s * 0.09,
      y - s * 0.2,
    ]);
    g.fill({ color: grey });
    // The cage, and the light in it.
    const top = y - s * 0.36;
    g.rect(cx - s * 0.05, top - s * 0.14, s * 0.1, s * 0.14);
    g.stroke({ width: Math.max(1, s * 0.015), color: grey });
    g.rect(cx - s * 0.07, top - s * 0.16, s * 0.14, s * 0.025);
    g.fill({ color: grey });
    if (lit) {
      g.circle(cx, top - s * 0.07, s * 0.12);
      g.fill({ color: gold, alpha: 0.25 });
    }
    g.circle(cx, top - s * 0.07, s * 0.035);
    g.fill({ color: lit ? gold : grey });
  }

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    clearDrawn(this.buoyGfx);
    if (this.buoy !== null) this.drawBuoy(state, view, this.buoy, frame.deltaMs);
    const g = this.effectGfx;
    clearDrawn(g);
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    const now = state.tick + frame.tickFraction;
    this.clock += frame.deltaMs;

    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, hex(this.art.palette.rockLight), null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.winnerBanners.draw(g, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
    this.drawFlags(state, view, frame);

    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawAboveCrowns(state, view, frame, now);
  }

  /** Shots, impacts and crumbles, over the crowns. */
  private drawAboveCrowns(
    state: MatchState,
    view: ViewTransform,
    frame: EffectFrame,
    now: number,
  ): void {
    const g = this.aboveCrownsGfx;
    clearDrawn(g);
    for (const shot of state.shots) {
      const t = shotProgress(shot, now);
      const x = shot.fromX + (shot.toX - shot.fromX) * t;
      const y = shot.fromY + (shot.toY - shot.fromY) * t;
      // A parabolic lift sells the lob. The shot still lands exactly on impactTick.
      const lift = shotLift(shot, t);
      const colour = playerColour(this.art, shot.owner, 'light');

      g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5 - lift), Math.max(2, view.tile * 0.35));
      g.fill({ color: colour });

      // Where it will come down, for the watching player's own shots only.
      drawShotTarget(g, view, shot, t, this.art, frame.humanPlayer);
    }

    for (const impact of this.impacts) {
      impact.age += frame.deltaMs;
      const t = impact.age / IMPACT_MS;
      if (t >= 1) continue;
      g.circle(
        tileX(view, impact.x + 0.5),
        tileY(view, impact.y + 0.5),
        view.tile * (0.4 + t * 2.2),
      );
      g.stroke({
        width: this.style.outlineWidthPx,
        color: hex(this.art.palette.emberHot),
        alpha: 1 - t,
      });
    }
    this.impacts = this.impacts.filter((impact) => impact.age < IMPACT_MS);

    // A swept block shrinks into its tile and fades: plain, like the rest of the style,
    // but enough to see what the banner took.
    const crumbleMs = this.style.crumbleMs;
    for (const crumble of this.crumbles) {
      crumble.age += frame.deltaMs;
      const t = crumble.age / crumbleMs;
      if (t >= 1) continue;
      const size = view.tile * (1 - t * 0.6);
      const offset = (view.tile - size) / 2;
      g.rect(tileX(view, crumble.x) + offset, tileY(view, crumble.y) + offset, size, size);
      g.fill({ color: crumble.colour, alpha: 1 - t });
    }
    this.crumbles = this.crumbles.filter((crumble) => crumble.age < crumbleMs);
  }

  /**
   * A pennant on a plain pole over every sealed castle, hoisted as it is sealed: the
   * flat style's share of the moment, kept as simple as the rest of it.
   */
  private drawFlags(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const pole = tileX(view, castle.x + castle.w / 2);
      const top = tileY(view, castle.y) - view.tile;
      const foot = tileY(view, castle.y + castle.h / 2);
      const width = Math.max(2, Math.round(view.tile / 8));
      g.rect(pole - width / 2, top, width, foot - top);
      g.fill({ color: hex(this.art.palette.uiInk) });
      const height = view.tile * 0.7;
      const y = foot - height - raised * (foot - top - height);
      g.poly([
        pole + width / 2,
        y,
        pole + width / 2 + view.tile,
        y + height / 2,
        pole + width / 2,
        y + height,
      ]);
      g.fill({ color: playerColour(this.art, castle.islandId - 1, 'base') });
    }
  }

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
    drawOvertimeBorder(g, state, view, this.art, performance.now());

    drawSelectable(g, view, ghost, this.art, performance.now());

    drawBuildHints(g, view, ghost, this.art, performance.now());
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);

    if (!ghost.tile) return;
    const colour = ghost.valid ? hex(this.art.palette.uiValid) : hex(this.art.palette.uiInvalid);

    if (state.phase === 'build' && ghost.cells.length > 0) {
      for (const [ox, oy] of ghost.cells) {
        g.rect(
          tileX(view, ghost.tile.x + ox),
          tileY(view, ghost.tile.y + oy),
          view.tile,
          view.tile,
        );
      }
      g.fill({ color: colour, alpha: 0.55 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      g.rect(
        tileX(view, ghost.tile.x),
        tileY(view, ghost.tile.y),
        ghost.footprint.w * view.tile,
        ghost.footprint.h * view.tile,
      );
      g.fill({ color: colour, alpha: 0.5 });
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Minimal's scenery: a faint dot where each thing stands, larger for a tree, so the land
 * is not bare and nothing on it competes with the walls.
 */
function drawFlatScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  for (const item of items) {
    const r = item.kind === 'tree' || item.kind === 'pine' ? 0.17 : 0.11;
    g.circle(tileX(view, item.x + 0.5), tileY(view, item.y + 0.5), view.tile * r);
  }
  g.fill({ color: hex(art.palette.shadow), alpha: 0.2 });
}
