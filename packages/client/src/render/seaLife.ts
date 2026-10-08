import type { ArtConfig } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';
import type { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';

import {
  Circling,
  Crossings,
  NO_OCEAN,
  Surfacings,
  behindCorner,
  outerOcean,
  type CornerPiece,
  type OuterOcean,
} from './ocean.js';
import { drawBat } from './spooky.js';
import { hex, tileX, tileY, type ViewTransform } from './theme.js';
import { drawCrest } from './ukiyo.js';
import { GOLD, drawQuaver, drawSwan } from './music.js';
import { FOAM, drawMass, drawReveller } from './wiesn.js';
import { drawFish } from './reef.js';
import { ARC_HALO, drawArc, jag } from './spark.js';
import { INK, PAPER, drawPieEye } from './toon.js';
import { GOLD as YULE_GOLD, NIGHT, SNOW, SNOW_SHADE } from './yule.js';

/**
 * Life on the outer ocean in the styles drawn from shapes (PLAN 11.16 O1), as Medieval and
 * Night have theirs (`pixel/ocean.ts`): out beyond the box round all the land, where no
 * shot flies, so none of it can be taken for one; moved by `ocean.ts`, drawn here in each
 * style's own hand, in neutral colours so nothing passing reads as a player's. None of it
 * while motion is reduced. The land's scenery was what the testers praised.
 */
export interface SeaLife {
  /** The ocean to keep to, measured again whenever the board is laid out. */
  layout(state: MatchState, view: ViewTransform, art: ArtConfig): void;
  /** One frame; `glow` is the additive layer, for a style that has one. */
  draw(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number, glow?: Graphics): void;
}

abstract class OceanDrawn implements SeaLife {
  protected ocean: OuterOcean = NO_OCEAN;
  protected clock = 0;
  /** The style's piece in the corner, if it has one: what passes there goes behind it. */
  corner: CornerPiece | null = null;

  protected behind(x: number, y: number): boolean {
    return behindCorner(this.corner, x, y);
  }

  layout(state: MatchState, view: ViewTransform, _art: ArtConfig): void {
    this.ocean = outerOcean(state, view);
  }

  draw(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number, glow?: Graphics): void {
    if (motionReduced()) return;
    this.clock += deltaMs;
    this.frame(g, view, art, deltaMs, glow);
  }

  protected abstract frame(
    g: Graphics,
    view: ViewTransform,
    art: ArtConfig,
    deltaMs: number,
    glow?: Graphics,
  ): void;
}

/** Points along a hull, `dir` the way it faces: x forward, y down, in tiles. */
function shape(
  view: ViewTransform,
  x: number,
  y: number,
  dir: 1 | -1,
  points: readonly [number, number][],
): number[] {
  return points.flatMap(([px, py]) => [tileX(view, x + dir * px), tileY(view, y + py)]);
}

/** Minimal: a plain boat's silhouette now and then, in the sea's lighter shade. Nothing more. */
export class FlatSeaLife extends OceanDrawn {
  private readonly boats = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.boats.layout(this.ocean, art.flat.boatEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const { boatEveryMs, boatTilesPerSecond } = art.flat;
    this.boats.step(this.ocean, deltaMs, boatEveryMs, boatTilesPerSecond, 1);
    const colour = hex(art.palette.waterShallow);
    for (const b of this.boats.items) {
      if (this.behind(b.x, b.y)) continue;
      g.poly(
        shape(view, b.x, b.y, b.dir, [
          [-0.6, 0.05],
          [0.7, 0.05],
          [0.45, 0.3],
          [-0.45, 0.3],
        ]),
      );
      g.poly(
        shape(view, b.x, b.y, b.dir, [
          [0, -0.75],
          [0, 0],
          [0.45, 0],
        ]),
      );
      g.poly(
        shape(view, b.x, b.y, b.dir, [
          [-0.06, -0.55],
          [-0.06, 0],
          [-0.4, 0],
        ]),
      );
      g.fill({ color: colour, alpha: 0.9 });
    }
  }
}

/** Parchment: an engraved ship under sail, and now and then a sea serpent's coils. */
export class ParchmentSeaLife extends OceanDrawn {
  private readonly ships = new Crossings();
  private readonly serpents = new Surfacings();
  /** The compass rose, which no serpent surfaces on. */
  rose: { x: number; y: number; size: number } | null = null;

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.ships.layout(this.ocean, art.parchment.shipEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const p = art.parchment;
    const ink = hex(art.palette.uiInk);
    const paper = hex(art.palette.grassLight);
    const line = Math.max(1, p.inkWidthPx * 0.75);
    const t = view.tile;

    this.ships.step(this.ocean, deltaMs, p.shipEveryMs, p.shipTilesPerSecond, 1.3);
    for (const s of this.ships.items) {
      const bob = Math.sin(this.clock / 700 + s.x) * 0.04;
      const y = s.y + bob;
      // The hull, a curved belly under a straight deck, inked over the paper.
      g.poly(
        shape(view, s.x, y, s.dir, [
          [-0.8, -0.05],
          [0.95, -0.05],
          [0.6, 0.3],
          [-0.6, 0.3],
        ]),
      );
      g.fill({ color: paper });
      g.stroke({ width: line, color: ink });
      // Two masts, each with a square sail hatched by the engraver.
      for (const [mx, h] of [
        [-0.3, 0.85],
        [0.3, 1.05],
      ] as const) {
        g.moveTo(tileX(view, s.x + s.dir * mx), tileY(view, y - 0.05));
        g.lineTo(tileX(view, s.x + s.dir * mx), tileY(view, y - h - 0.1));
        g.stroke({ width: line, color: ink });
        const sail = shape(view, s.x + s.dir * mx, y, s.dir, [
          [-0.22, -h + 0.05],
          [0.24, -h],
          [0.26, -0.25],
          [-0.2, -0.22],
        ]);
        g.poly(sail);
        g.fill({ color: paper });
        g.stroke({ width: line, color: ink });
        for (let k = 1; k <= 3; k++) {
          const sy = y - h + 0.05 + (k * (h - 0.3)) / 4;
          g.moveTo(tileX(view, s.x + s.dir * (mx - 0.18)), tileY(view, sy));
          g.lineTo(tileX(view, s.x + s.dir * (mx + 0.2)), tileY(view, sy + 0.04));
        }
        g.stroke({ width: Math.max(1, line * 0.5), color: ink, alpha: 0.6 });
      }
      // A pennant at the main mast, and the waves the bow throws.
      g.poly(
        shape(view, s.x + s.dir * 0.3, y, s.dir, [
          [0, -1.15],
          [0.35, -1.08],
          [0, -1.0],
        ]),
      );
      g.fill({ color: ink });
      for (let k = 0; k < 3; k++) {
        const wx = s.x - s.dir * (0.9 + k * 0.45);
        g.moveTo(tileX(view, wx - 0.15), tileY(view, s.y + 0.38));
        g.quadraticCurveTo(
          tileX(view, wx),
          tileY(view, s.y + 0.28),
          tileX(view, wx + 0.15),
          tileY(view, s.y + 0.38),
        );
      }
      g.stroke({ width: Math.max(1, line * 0.6), color: ink, alpha: 0.55 });
    }

    // The serpent: three coils rising out of the water and sinking back as it swims on,
    // each an inked arch with the engraver's second line inside it, the head leading.
    const rose = this.rose;
    this.serpents.step(this.ocean, deltaMs, p.serpentEveryMs, p.serpentMs, (cell) =>
      rose === null
        ? true
        : Math.hypot(cell.x + 0.5 - rose.x, cell.y + 0.5 - rose.y) > rose.size / 2 + 2,
    );
    for (const s of this.serpents.items) {
      const life = s.ageMs / p.serpentMs;
      const rise = Math.sin(Math.PI * Math.min(1, life));
      const x = s.x + s.dir * life * 1.2;
      const water = tileY(view, s.y);
      for (let k = 0; k < 3; k++) {
        const cx = tileX(view, x - s.dir * k * 0.82);
        const r = t * 0.36 * (1 - k * 0.12);
        const h = r * (0.4 + 1.1 * rise) * (1 + 0.15 * Math.sin(this.clock / 300 + k));
        g.moveTo(cx - r, water);
        g.bezierCurveTo(cx - r, water - h * 1.3, cx + r, water - h * 1.3, cx + r, water);
        g.stroke({ width: line * 2.2, color: ink });
        g.moveTo(cx - r * 0.55, water);
        g.bezierCurveTo(
          cx - r * 0.55,
          water - h * 0.8,
          cx + r * 0.55,
          water - h * 0.8,
          cx + r * 0.55,
          water,
        );
        g.stroke({ width: Math.max(1, line * 0.6), color: paper });
      }
      // The head, ahead of the first coil, raised as the coils are.
      const hx = tileX(view, x + s.dir * 0.6);
      const hy = water - t * 0.48 * rise;
      g.ellipse(hx, hy, t * 0.21, t * 0.13);
      g.fill({ color: ink });
      g.moveTo(hx + s.dir * t * 0.19, hy);
      g.lineTo(hx + s.dir * t * 0.4, hy - t * 0.08);
      g.stroke({ width: Math.max(1, line * 0.6), color: ink });
      // Ripples where the coils meet the water.
      g.moveTo(tileX(view, x - s.dir * 2.1), water + t * 0.06);
      g.lineTo(tileX(view, x + s.dir * 0.8), water + t * 0.06);
      g.stroke({ width: Math.max(1, line * 0.5), color: ink, alpha: 0.4 * rise });
    }
  }
}

/** Blueprint: a ship drawn in plan, sailing a dashed course across the sheet. */
export class BlueprintSeaLife extends OceanDrawn {
  private readonly ships = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.ships.layout(this.ocean, art.blueprint.shipEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const b = art.blueprint;
    const ink = hex(art.palette.uiInk);
    const line = b.lineWidthPx;
    const t = view.tile;
    this.ships.step(this.ocean, deltaMs, b.shipEveryMs, b.shipTilesPerSecond, 0.6);
    for (const s of this.ships.items) {
      if (this.behind(s.x, s.y)) continue;
      // The course, dashed across the sheet behind it and faint ahead, as a plotted route.
      const y = tileY(view, s.y);
      const dash = t * 0.35;
      for (
        let x = tileX(view, this.ocean.x0 - 2);
        x < tileX(view, this.ocean.x1 + 3);
        x += dash * 2
      ) {
        const ahead = (x - tileX(view, s.x)) * s.dir > 0;
        g.moveTo(x, y);
        g.lineTo(x + dash, y);
        g.stroke({ width: Math.max(1, line * 0.6), color: ink, alpha: ahead ? 0.18 : 0.45 });
      }
      // The hull in plan: a pointed bow, a square stern, its centreline and two hatches.
      const hull = shape(view, s.x, s.y, s.dir, [
        [-0.85, -0.22],
        [0.45, -0.22],
        [0.95, 0],
        [0.45, 0.22],
        [-0.85, 0.22],
      ]);
      g.poly(hull);
      g.fill({ color: hex(art.palette.waterMid) });
      g.stroke({ width: line, color: ink });
      g.moveTo(tileX(view, s.x - s.dir * 0.85), y);
      g.lineTo(tileX(view, s.x + s.dir * 0.95), y);
      g.stroke({ width: Math.max(1, line * 0.5), color: ink, alpha: 0.6 });
      for (const hx of [-0.45, 0.1]) {
        g.rect(tileX(view, s.x + s.dir * hx) - t * 0.09, y - t * 0.09, t * 0.18, t * 0.18);
        g.stroke({ width: Math.max(1, line * 0.6), color: ink });
      }
      // A dimension line above it, ticked at each end, as plans measure what they draw.
      const dy = tileY(view, s.y - 0.45);
      const ax = tileX(view, s.x - s.dir * 0.85);
      const bx = tileX(view, s.x + s.dir * 0.95);
      g.moveTo(ax, dy);
      g.lineTo(bx, dy);
      g.moveTo(ax, dy - t * 0.08);
      g.lineTo(ax, dy + t * 0.08);
      g.moveTo(bx, dy - t * 0.08);
      g.lineTo(bx, dy + t * 0.08);
      g.stroke({ width: Math.max(1, line * 0.5), color: ink, alpha: 0.55 });
    }
  }
}

/**
 * Cyberpunk: drones circling with blinking lights and a searchlight on the water, and now
 * and then a hover-craft running low with a trail of light. The glow goes on the additive
 * layer, as the style's other light does.
 */
export class CyberpunkSeaLife extends OceanDrawn {
  private readonly drones = new Circling();
  private readonly craft = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.drones.layout(this.ocean, art.cyberpunk.drones, [1.2, 2.6]);
    this.craft.layout(this.ocean, art.cyberpunk.hovercraftEveryMs);
  }

  protected frame(
    g: Graphics,
    view: ViewTransform,
    art: ArtConfig,
    deltaMs: number,
    glow?: Graphics,
  ): void {
    const c = art.cyberpunk;
    const cyan = hex(art.palette.waterFoam);
    const magenta = hex(art.palette.emberMid);
    const body = hex(art.palette.rockMid);
    const light = hex(art.palette.rockLight);
    const t = view.tile;
    const halo = glow ?? g;

    this.drones.step(deltaMs);
    for (const [k, d] of this.drones.items.entries()) {
      const at = Circling.at(d);
      if (this.behind(at.x, at.y)) continue;
      const x = tileX(view, at.x);
      const y = tileY(view, at.y);
      // The searchlight, a pool on the water below and behind.
      halo.ellipse(x, y + t * 0.9, t * 0.55, t * 0.25);
      halo.fill({ color: cyan, alpha: 0.12 });
      // Four rotors on a cross, and the body.
      const arm = t * 0.22;
      g.moveTo(x - arm, y - arm);
      g.lineTo(x + arm, y + arm);
      g.moveTo(x + arm, y - arm);
      g.lineTo(x - arm, y + arm);
      g.stroke({ width: Math.max(1, t * 0.05), color: body });
      for (const [rx, ry] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        g.circle(x + rx * arm, y + ry * arm, t * 0.08);
      }
      g.fill({ color: body });
      g.circle(x, y, t * 0.09);
      g.fill({ color: light });
      // Blinking, each drone out of step with the other.
      if (Math.floor(this.clock / 450 + k) % 2 === 0) {
        g.circle(x, y, t * 0.05);
        g.fill({ color: magenta });
        halo.circle(x, y, t * 0.2);
        halo.fill({ color: magenta, alpha: 0.35 });
      }
    }

    this.craft.step(this.ocean, deltaMs, c.hovercraftEveryMs, c.hovercraftTilesPerSecond, 0.5);
    for (const h of this.craft.items) {
      if (this.behind(h.x, h.y)) continue;
      const y = h.y + Math.sin(this.clock / 260) * 0.03;
      // The trail of light it leaves, fading out behind it.
      for (let k = 1; k <= 8; k++) {
        const tx = tileX(view, h.x - h.dir * (0.6 + k * 0.32));
        halo.rect(tx - t * 0.12, tileY(view, h.y + 0.12), t * 0.24, Math.max(1, t * 0.05));
        halo.fill({ color: cyan, alpha: 0.5 * (1 - k / 9) });
      }
      const hull = shape(view, h.x, y, h.dir, [
        [-0.65, -0.12],
        [0.35, -0.14],
        [0.75, 0.04],
        [0.55, 0.14],
        [-0.65, 0.14],
      ]);
      g.poly(hull);
      g.fill({ color: hex(art.palette.craterMid) });
      g.stroke({ width: Math.max(1, c.wallLinePx * 0.75), color: cyan });
      halo.poly(hull);
      halo.stroke({ width: t * c.glowWidthTiles, color: cyan, alpha: c.glowAlpha * 0.6 });
      // Its cockpit, lit.
      g.poly(
        shape(view, h.x, y, h.dir, [
          [0.05, -0.12],
          [0.35, -0.12],
          [0.2, -0.26],
        ]),
      );
      g.fill({ color: magenta });
    }
  }
}

/** Toy bricks: a boat built of bricks, a rubber duck bobbing along, and a shark's fin. */
export class BricksSeaLife extends OceanDrawn {
  private readonly boats = new Crossings();
  private readonly ducks = new Crossings();
  private readonly sharks = new Surfacings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.boats.layout(this.ocean, art.bricks.boatEveryMs);
    this.ducks.layout(this.ocean, art.bricks.duckEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const b = art.bricks;
    const pal = art.palette;
    const t = view.tile;
    const edge = { width: Math.max(1, t * 0.04), color: hex(pal.shadow), alpha: 0.6 };
    const stud = (x: number, y: number, colour: string): void => {
      g.circle(x, y, t * 0.1);
      g.fill({ color: hex(colour) });
      g.stroke(edge);
    };

    this.boats.step(this.ocean, deltaMs, b.boatEveryMs, b.boatTilesPerSecond, 1.2);
    for (const s of this.boats.items) {
      if (this.behind(s.x, s.y)) continue;
      const y = tileY(view, s.y + Math.sin(this.clock / 500 + s.x) * 0.04);
      const x = tileX(view, s.x);
      // A hull of two bricks, a cabin brick with studs, a mast and a white sail with a flag.
      g.rect(x - t * 0.8, y - t * 0.05, t * 1.6, t * 0.3);
      g.fill({ color: hex(pal.sand) });
      g.stroke(edge);
      g.rect(x - t * 0.6, y + t * 0.25, t * 1.2, t * 0.12);
      g.fill({ color: hex(pal.rockMid) });
      g.stroke(edge);
      g.rect(s.dir === 1 ? x - t * 0.55 : x + t * 0.05, y - t * 0.3, t * 0.5, t * 0.25);
      g.fill({ color: hex(pal.rockLight) });
      g.stroke(edge);
      stud(x - s.dir * t * 0.42, y - t * 0.33, pal.rockLight);
      stud(x - s.dir * t * 0.18, y - t * 0.33, pal.rockLight);
      g.rect(x + s.dir * t * 0.15 - t * 0.03, y - t * 1.0, t * 0.06, t * 0.95);
      g.fill({ color: hex(pal.rockDark) });
      const mast = x + s.dir * t * 0.15;
      g.poly([mast, y - t * 0.95, mast + s.dir * t * 0.5, y - t * 0.15, mast, y - t * 0.15]);
      g.fill({ color: hex(pal.rockLight) });
      g.stroke(edge);
      g.rect(x + s.dir * t * 0.15, y - t * 1.05, s.dir * t * 0.28, t * 0.16);
      g.fill({ color: hex(pal.uiAccent) });
      // Foam off the bow.
      g.circle(x + s.dir * t * 0.85, y + t * 0.25, t * 0.08);
      g.circle(x + s.dir * t * 0.95, y + t * 0.18, t * 0.05);
      g.fill({ color: hex(pal.waterFoam), alpha: 0.8 });
    }

    this.ducks.step(this.ocean, deltaMs, b.duckEveryMs, b.duckTilesPerSecond);
    for (const d of this.ducks.items) {
      if (this.behind(d.x, d.y)) continue;
      const tilt = Math.sin(this.clock / 420) * 0.08;
      const x = tileX(view, d.x);
      const y = tileY(view, d.y + Math.sin(this.clock / 380) * 0.05);
      g.ellipse(x, y, t * 0.32, t * 0.2);
      g.fill({ color: hex(pal.emberMid) });
      g.stroke(edge);
      const hx = x + d.dir * t * (0.18 + tilt);
      g.circle(hx, y - t * 0.24, t * 0.15);
      g.fill({ color: hex(pal.emberMid) });
      g.stroke(edge);
      g.poly([
        hx + d.dir * t * 0.12,
        y - t * 0.27,
        hx + d.dir * t * 0.3,
        y - t * 0.22,
        hx + d.dir * t * 0.12,
        y - t * 0.17,
      ]);
      g.fill({ color: hex(pal.emberCool) });
      g.circle(hx + d.dir * t * 0.05, y - t * 0.28, Math.max(1, t * 0.03));
      g.fill({ color: hex(pal.shadow) });
      g.ellipse(x, y + t * 0.2, t * 0.4, t * 0.06);
      g.fill({ color: hex(pal.waterFoam), alpha: 0.5 });
    }

    // A shark's fin rising, circling and sinking again, its wake a ring of foam.
    this.sharks.step(this.ocean, deltaMs, b.sharkEveryMs, b.sharkMs);
    for (const s of this.sharks.items) {
      if (this.behind(s.x, s.y)) continue;
      const life = s.ageMs / b.sharkMs;
      const rise = Math.min(1, Math.sin(Math.PI * life) * 2.5);
      const angle = s.dir * life * Math.PI * 2;
      const x = tileX(view, s.x + Math.cos(angle) * 0.9);
      const y = tileY(view, s.y + Math.sin(angle) * 0.45);
      const way = Math.sin(angle) * s.dir >= 0 ? -1 : 1;
      const h = t * 0.55 * rise;
      g.poly([x - t * 0.22, y, x + t * 0.22, y, x + way * t * 0.12, y - h]);
      g.fill({ color: hex(pal.rockMid) });
      g.stroke(edge);
      g.ellipse(x, y + t * 0.03, t * 0.38, t * 0.08);
      g.stroke({ width: Math.max(1, t * 0.05), color: hex(pal.waterFoam), alpha: 0.7 * rise });
    }
  }
}

/**
 * Stained glass: now and then a fish of coloured glass leaping from the sea and back, and a
 * ship of glass under a leaded sail crossing — every piece held in its lead, as the window is.
 */
export class GlassSeaLife extends OceanDrawn {
  private readonly ships = new Crossings();
  private readonly fish = new Surfacings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.ships.layout(this.ocean, art.glass.shipEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.glass;
    const pal = art.palette;
    const t = view.tile;
    const lead = { width: Math.max(1, t * s.leadTiles), color: hex(pal.shadow) };

    this.ships.step(this.ocean, deltaMs, s.shipEveryMs, s.shipTilesPerSecond, 1.2);
    for (const ship of this.ships.items) {
      if (this.behind(ship.x, ship.y)) continue;
      const x = tileX(view, ship.x);
      const y = tileY(view, ship.y + Math.sin(this.clock / 600 + ship.x) * 0.04);
      g.poly([x - t * 0.7, y, x + t * 0.75, y, x + t * 0.5, y + t * 0.3, x - t * 0.5, y + t * 0.3]);
      g.fill({ color: hex(pal.sand) });
      g.stroke(lead);
      const mast = x - ship.dir * t * 0.05;
      g.poly([mast, y - t * 1.0, mast + ship.dir * t * 0.6, y - t * 0.15, mast, y - t * 0.15]);
      g.fill({ color: hex(pal.uiInk), alpha: 0.9 });
      g.stroke(lead);
      g.poly([mast, y - t * 0.85, mast - ship.dir * t * 0.4, y - t * 0.15, mast, y - t * 0.15]);
      g.fill({ color: hex(pal.emberMid), alpha: 0.9 });
      g.stroke(lead);
    }

    this.fish.step(this.ocean, deltaMs, s.fishEveryMs, s.fishMs);
    for (const f of this.fish.items) {
      if (this.behind(f.x, f.y)) continue;
      const k = f.ageMs / s.fishMs;
      const x = tileX(view, f.x + f.dir * (k - 0.5) * 1.4);
      const y = tileY(view, f.y) - Math.sin(Math.PI * k) * t * 0.9;
      const tilt = f.dir * (k - 0.5) * 1.6;
      const along = (d: number, side: number): [number, number] => [
        x + Math.cos(tilt) * d * f.dir - Math.sin(tilt) * side,
        y + Math.sin(tilt) * d * f.dir + Math.cos(tilt) * side,
      ];
      g.poly([
        ...along(0.32 * t, 0),
        ...along(0, -0.14 * t),
        ...along(-0.22 * t, 0),
        ...along(0, 0.14 * t),
      ]);
      g.fill({ color: hex(pal.emberMid) });
      g.stroke(lead);
      g.poly([...along(-0.22 * t, 0), ...along(-0.4 * t, -0.12 * t), ...along(-0.4 * t, 0.12 * t)]);
      g.fill({ color: hex(pal.emberCool) });
      g.stroke(lead);
      // Rings on the water where it leaves and where it goes back in.
      for (const [at, when] of [
        [-0.7, 0],
        [0.7, 0.85],
      ] as const) {
        const ring = (k - when) / 0.3;
        if (ring <= 0 || ring >= 1) continue;
        g.ellipse(
          tileX(view, f.x + f.dir * at),
          tileY(view, f.y),
          t * 0.35 * ring + 1,
          t * 0.14 * ring + 1,
        );
        g.stroke({ width: 1.5, color: hex(pal.waterFoam), alpha: 0.7 * (1 - ring) });
      }
    }
  }
}

/**
 * Chocolate: a paddle-boat of cream and biscuit crossing now and then, its wheel turning;
 * marshmallows bobbing up and drifting on the current before they sink; and a whirlpool
 * turning under the mouth of a glass pipe that drinks from the river — all in the sweet
 * shop's neutral creams, and none of it on the chocolate fall.
 */
export class ChocolateSeaLife extends OceanDrawn {
  private readonly boats = new Crossings();
  private readonly marshmallows = new Surfacings();
  private whirl: { x: number; y: number } | null = null;
  /** The chocolate fall, which nothing floats over. */
  fall: { x: number; y: number; size: number } | null = null;

  private clear(cell: { x: number; y: number }): boolean {
    const f = this.fall;
    if (f === null) return true;
    const half = f.size / 2 + 1;
    return Math.abs(cell.x + 0.5 - f.x) > half || Math.abs(cell.y + 0.5 - f.y) > half;
  }

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.boats.layout(this.ocean, art.chocolate.boatEveryMs);
    const open = this.ocean.cells.filter((c) => this.clear(c));
    const at = open[Math.floor(Math.random() * open.length)];
    this.whirl = at === undefined ? null : { x: at.x + 0.5, y: at.y + 0.5 };
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.chocolate;
    const pal = art.palette;
    const t = view.tile;
    const cream = hex(pal.rockLight);
    const ink = { width: Math.max(1, t * 0.06), color: hex(pal.shadow), alpha: 0.6 };

    if (this.whirl !== null) {
      const cx = tileX(view, this.whirl.x);
      const cy = tileY(view, this.whirl.y);
      for (let arm = 0; arm < 3; arm++) {
        const a0 = this.clock / 700 + (arm * Math.PI * 2) / 3;
        g.moveTo(cx + Math.cos(a0) * t * 0.9, cy + Math.sin(a0) * t * 0.55);
        for (let k = 1; k <= 12; k++) {
          const f = k / 12;
          const a = a0 + f * Math.PI * 1.5;
          g.lineTo(cx + Math.cos(a) * t * 0.9 * (1 - f), cy + Math.sin(a) * t * 0.55 * (1 - f));
        }
      }
      g.stroke({ width: Math.max(1, t * 0.08), color: hex(pal.waterFoam), alpha: 0.5 });
      // The pipe's mouth over it, glass: a ring with the chocolate rising inside it.
      g.ellipse(cx, cy - t * 0.1, t * 0.34, t * 0.22);
      g.fill({ color: hex(pal.waterShallow), alpha: 0.6 });
      g.ellipse(cx, cy - t * 0.1, t * 0.34, t * 0.22);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: 0xffffff, alpha: 0.55 });
      g.moveTo(cx - t * 0.2, cy - t * 0.22).lineTo(cx - t * 0.05, cy - t * 0.27);
      g.stroke({ width: Math.max(1, t * 0.06), color: 0xffffff, alpha: 0.9, cap: 'round' });
    }

    this.marshmallows.step(this.ocean, deltaMs, s.marshmallowEveryMs, s.marshmallowMs, (c) =>
      this.clear(c),
    );
    for (const m of this.marshmallows.items) {
      const k = m.ageMs / s.marshmallowMs;
      // Bobbing up, drifting with the current, and sinking again at the end.
      const up = Math.min(1, k * 6, (1 - k) * 6);
      const x = tileX(
        view,
        m.x + k * 1.2 * s.currentTilesPerSecond * (s.marshmallowMs / 1000) * 0.3,
      );
      const y = tileY(view, m.y) + Math.sin(this.clock / 500 + m.x) * t * 0.04;
      const r = t * 0.22;
      const h = t * 0.2 * up;
      g.rect(x - r, y - h, r * 2, h);
      g.fill({ color: hex(pal.rockMid) });
      g.ellipse(x, y, r, r * 0.45);
      g.fill({ color: hex(pal.rockMid) });
      g.ellipse(x, y - h, r, r * 0.45);
      g.fill({ color: cream });
      g.stroke(ink);
      g.ellipse(x, y + t * 0.02, r * 1.4, r * 0.6);
      g.stroke({ width: 1, color: hex(pal.waterFoam), alpha: 0.4 * up });
    }

    this.boats.step(this.ocean, deltaMs, s.boatEveryMs, s.boatTilesPerSecond, 1);
    for (const b of this.boats.items) {
      const y = b.y + Math.sin(this.clock / 650 + b.x) * 0.04;
      // The hull, cream over a biscuit keel.
      g.poly(
        shape(view, b.x, y, b.dir, [
          [-0.75, -0.05],
          [0.85, -0.05],
          [0.6, 0.28],
          [-0.6, 0.28],
        ]),
      );
      g.fill({ color: cream });
      g.stroke(ink);
      g.poly(
        shape(view, b.x, y, b.dir, [
          [-0.66, 0.16],
          [0.7, 0.16],
          [0.6, 0.28],
          [-0.6, 0.28],
        ]),
      );
      g.fill({ color: hex(pal.sand) });
      // A striped awning on posts.
      for (let k = 0; k < 4; k++) {
        g.poly(
          shape(view, b.x, y, b.dir, [
            [-0.45 + k * 0.25, -0.5],
            [-0.2 + k * 0.25, -0.5],
            [-0.2 + k * 0.25, -0.38],
            [-0.45 + k * 0.25, -0.38],
          ]),
        );
        g.fill({ color: k % 2 === 0 ? cream : hex(pal.craterMid) });
      }
      for (const px of [-0.4, 0.5]) {
        g.moveTo(tileX(view, b.x + b.dir * px), tileY(view, y - 0.38));
        g.lineTo(tileX(view, b.x + b.dir * px), tileY(view, y - 0.05));
      }
      g.stroke(ink);
      // The paddle-wheel at the stern, turning.
      const wx = tileX(view, b.x - b.dir * 0.8);
      const wy = tileY(view, y + 0.08);
      const wr = t * 0.24;
      g.circle(wx, wy, wr);
      g.fill({ color: hex(pal.craterMid) });
      for (let k = 0; k < 4; k++) {
        const a = (this.clock / 300) * b.dir + (k * Math.PI) / 4;
        g.moveTo(wx - Math.cos(a) * wr, wy - Math.sin(a) * wr);
        g.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: cream });
    }
  }
}

/**
 * Halloween: a ghost ship drifting across now and then, pale and see-through, its sails in
 * tatters; a flock of bats crossing, wings beating; and a will-o'-wisp wheeling over the
 * water — neutral greens and greys, nothing of any player's colour.
 */
export class HalloweenSeaLife extends OceanDrawn {
  private readonly ships = new Crossings();
  private readonly bats = new Crossings();
  private readonly wisps = new Circling();
  /** The moon over the sea, which the wisp keeps off. */
  moon: { x: number; y: number; size: number } | null = null;

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.ships.layout(this.ocean, art.halloween.shipEveryMs);
    this.bats.layout(this.ocean, art.halloween.batsEveryMs);
    this.wisps.layout(this.ocean, 1, [1.2, 2]);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.halloween;
    const t = view.tile;
    const pale = 0xc8f5d0;

    this.ships.step(this.ocean, deltaMs, s.shipEveryMs, s.shipTilesPerSecond, 1.3);
    for (const ship of this.ships.items) {
      const y = ship.y + Math.sin(this.clock / 900 + ship.x) * 0.05;
      const fade = 0.55 + 0.15 * Math.sin(this.clock / 400);
      g.poly(
        shape(view, ship.x, y, ship.dir, [
          [-0.85, -0.05],
          [0.95, -0.1],
          [0.65, 0.28],
          [-0.65, 0.28],
        ]),
      );
      g.fill({ color: 0x2a3b35, alpha: fade });
      g.stroke({ width: 1, color: pale, alpha: fade * 0.6 });
      for (const [mx, h] of [
        [-0.3, 0.85],
        [0.3, 1.05],
      ] as const) {
        g.moveTo(tileX(view, ship.x + ship.dir * mx), tileY(view, y - 0.05));
        g.lineTo(tileX(view, ship.x + ship.dir * mx), tileY(view, y - h - 0.1));
        g.stroke({ width: 1, color: pale, alpha: fade });
        // A torn sail: its foot ragged.
        g.poly(
          shape(view, ship.x, y, ship.dir, [
            [mx - 0.22, -h],
            [mx + 0.22, -h],
            [mx + 0.22, -0.35],
            [mx + 0.1, -0.45],
            [mx, -0.3],
            [mx - 0.12, -0.45],
            [mx - 0.22, -0.32],
          ]),
        );
        g.fill({ color: pale, alpha: fade * 0.45 });
      }
    }

    this.bats.step(this.ocean, deltaMs, s.batsEveryMs, s.batsTilesPerSecond, 0.6);
    for (const flock of this.bats.items) {
      for (let k = 0; k < 6; k++) {
        const ox = (k % 3) * 0.6 - 0.6 + (k > 2 ? 0.3 : 0);
        const oy = (k > 2 ? 0.45 : 0) + Math.sin(this.clock / 300 + k) * 0.12;
        drawBat(
          g,
          tileX(view, flock.x - flock.dir * ox),
          tileY(view, flock.y + oy - 0.3),
          t * 0.22,
          Math.sin(this.clock / 65 + k * 1.3),
          0x1a1224,
        );
      }
    }

    this.wisps.step(deltaMs);
    for (const w of this.wisps.items) {
      const at = Circling.at(w);
      const x = tileX(view, at.x);
      const y = tileY(view, at.y) - Math.abs(Math.sin(this.clock / 500)) * t * 0.2;
      g.circle(x, y, t * 0.35);
      g.fill({ color: 0xa6f0a8, alpha: 0.18 });
      g.circle(x, y, t * 0.13);
      g.fill({ color: 0xeaffea, alpha: 0.9 });
    }
  }
}

/**
 * Sakura: a boat under a square sail crossing now and then, a line of cranes flying over,
 * wings beating, and now and then a great wave rolling across, curling and breaking in
 * claws of foam as the prints draw it — wood, sailcloth, white birds and the sea's own
 * blues, nothing of any player's colour.
 */
export class SakuraSeaLife extends OceanDrawn {
  private readonly boats = new Crossings();
  private readonly cranes = new Crossings();
  private readonly waves = new Crossings();
  /** Mount Fuji in the corner: whatever crosses its square is hidden, as if behind it. */
  fuji: { x: number; y: number; size: number } | null = null;

  private hidden(x: number, y: number): boolean {
    const f = this.fuji;
    return f !== null && Math.abs(x - f.x) < f.size / 2 && Math.abs(y - f.y) < f.size / 2;
  }

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.boats.layout(this.ocean, art.sakura.boatEveryMs);
    this.cranes.layout(this.ocean, art.sakura.cranesEveryMs);
    this.waves.layout(this.ocean, art.sakura.waveEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.sakura;
    const t = view.tile;
    const ink = hex(art.palette.shadow);

    this.waves.step(this.ocean, deltaMs, s.waveEveryMs, s.waveTilesPerSecond, 1.5);
    for (const wave of this.waves.items) {
      if (this.hidden(wave.x, wave.y)) continue;
      // It rises and breaks over and over as it rolls on.
      const rise = 0.65 + 0.35 * Math.sin(this.clock / 900 + wave.x);
      drawCrest(
        g,
        tileX(view, wave.x),
        tileY(view, wave.y + 0.4),
        t * 2.6,
        wave.dir,
        rise,
        hex(art.palette.waterMid),
        hex(art.palette.waterFoam),
        ink,
      );
    }

    this.boats.step(this.ocean, deltaMs, s.boatEveryMs, s.boatTilesPerSecond, 1.3);
    for (const boat of this.boats.items) {
      if (this.hidden(boat.x, boat.y)) continue;
      const y = boat.y + Math.sin(this.clock / 700 + boat.x) * 0.05;
      g.poly(
        shape(view, boat.x, y, boat.dir, [
          [-0.8, -0.05],
          [0.9, -0.15],
          [0.6, 0.25],
          [-0.6, 0.25],
        ]),
      );
      g.fill({ color: 0x6b4a2a });
      g.stroke({ width: 1, color: ink, alpha: 0.8 });
      g.moveTo(tileX(view, boat.x), tileY(view, y - 0.05));
      g.lineTo(tileX(view, boat.x), tileY(view, y - 1.15));
      g.stroke({ width: Math.max(1, t * 0.06), color: 0x3a2c22 });
      // The square sail, its battens across it.
      g.poly(
        shape(view, boat.x, y, boat.dir, [
          [-0.38, -1.05],
          [0.38, -1.05],
          [0.42, -0.25],
          [-0.34, -0.25],
        ]),
      );
      g.fill({ color: 0xf1e7cf });
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
      for (const f of [-0.85, -0.65, -0.45]) {
        g.moveTo(tileX(view, boat.x - 0.37 * boat.dir), tileY(view, y + f));
        g.lineTo(tileX(view, boat.x + 0.4 * boat.dir), tileY(view, y + f));
      }
      g.stroke({ width: 1, color: ink, alpha: 0.4 });
    }

    this.cranes.step(this.ocean, deltaMs, s.cranesEveryMs, s.cranesTilesPerSecond, 1);
    for (const flight of this.cranes.items) {
      for (let k = 0; k < 5; k++) {
        if (this.hidden(flight.x - flight.dir * k * 0.7, flight.y - 0.5 + k * 0.28)) continue;
        const x = tileX(view, flight.x - flight.dir * k * 0.7);
        const y = tileY(view, flight.y - 0.5 + k * 0.28);
        const size = t * 0.34;
        const flap = Math.sin(this.clock / 160 + k * 0.9) * size * 0.5;
        for (const side of [-1, 1]) {
          g.poly([
            x,
            y,
            x + side * size * 0.5,
            y - flap * 0.6 - size * 0.1,
            x + side * size,
            y - flap,
            x + side * size * 0.45,
            y + size * 0.12,
          ]);
        }
        g.fill({ color: 0xfbf8f0 });
        for (const side of [-1, 1]) {
          g.moveTo(x + side * size * 0.75, y - flap * 0.85).lineTo(x + side * size, y - flap);
        }
        g.stroke({ width: Math.max(1, size * 0.18), color: ink, cap: 'round' });
        g.moveTo(x, y).lineTo(x + flight.dir * size * 0.6, y - size * 0.05);
        g.stroke({ width: Math.max(1, size * 0.12), color: 0xfbf8f0, cap: 'round' });
      }
    }
  }
}

/**
 * Oktoberfest: a Maß floating across the beer now and then, bobbing; a reveller drifting by
 * asleep on a lilo, his own Maß beside him; and a Weißwurst swimming round in circles —
 * glass, foam, a striped lilo and a sausage, nothing of any player's colour.
 */
export class OktoberfestSeaLife extends OceanDrawn {
  private readonly mugs = new Crossings();
  private readonly lilos = new Crossings();
  private readonly sausages = new Circling();
  /** The Ferris wheel in the corner: whatever crosses its square is hidden behind it. */
  wheel: { x: number; y: number; size: number } | null = null;

  private hidden(x: number, y: number): boolean {
    const f = this.wheel;
    return f !== null && Math.abs(x - f.x) < f.size / 2 && Math.abs(y - f.y) < f.size / 2;
  }

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.mugs.layout(this.ocean, art.oktoberfest.mugEveryMs);
    this.lilos.layout(this.ocean, art.oktoberfest.liloEveryMs);
    this.sausages.layout(this.ocean, 1, [0.8, 1.4]);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.oktoberfest;
    const t = view.tile;
    const ink = hex(art.palette.shadow);

    this.mugs.step(this.ocean, deltaMs, s.mugEveryMs, s.mugTilesPerSecond, 1);
    for (const mug of this.mugs.items) {
      if (this.hidden(mug.x, mug.y)) continue;
      const bob = Math.sin(this.clock / 500 + mug.x) * 0.06;
      g.ellipse(tileX(view, mug.x), tileY(view, mug.y + 0.3), t * 0.5, t * 0.12);
      g.stroke({ width: 1, color: FOAM, alpha: 0.6 });
      drawMass(g, tileX(view, mug.x), tileY(view, mug.y + 0.3 + bob), t * 0.8, 0.9, ink);
    }

    this.lilos.step(this.ocean, deltaMs, s.liloEveryMs, s.liloTilesPerSecond, 0.5);
    for (const lilo of this.lilos.items) {
      if (this.hidden(lilo.x, lilo.y)) continue;
      const y = tileY(view, lilo.y + Math.sin(this.clock / 800 + lilo.x) * 0.04);
      const x = tileX(view, lilo.x);
      g.roundRect(x - t * 0.9, y - t * 0.35, t * 1.8, t * 0.7, t * 0.25);
      g.fill({ color: 0xf6d65a });
      for (let k = -2; k <= 2; k++) {
        g.moveTo(x + k * t * 0.32, y - t * 0.3).lineTo(x + k * t * 0.32, y + t * 0.3);
      }
      g.stroke({ width: Math.max(1, t * 0.08), color: 0xffffff, alpha: 0.8 });
      drawReveller(g, x, y, t * 1.4, ink);
    }

    this.sausages.step(deltaMs);
    for (const w of this.sausages.items) {
      const at = Circling.at(w);
      if (this.hidden(at.x, at.y)) continue;
      // A Weißwurst, its ends twisted, nose in the direction it swims, a wake behind it.
      const heading = w.angle + (w.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      const c = Math.cos(heading);
      const sn = Math.sin(heading) * 0.6;
      const x = tileX(view, at.x);
      const y = tileY(view, at.y);
      g.moveTo(x - c * t * 0.9, y - sn * t * 0.9).lineTo(x - c * t * 0.4, y - sn * t * 0.4);
      g.stroke({ width: Math.max(1, t * 0.08), color: FOAM, alpha: 0.6, cap: 'round' });
      g.moveTo(x - c * t * 0.35, y - sn * t * 0.35).lineTo(x + c * t * 0.35, y + sn * t * 0.35);
      g.stroke({ width: Math.max(3, t * 0.26), color: 0xf2ece0, cap: 'round' });
      for (const e of [-0.48, 0.48]) g.circle(x + c * t * e, y + sn * t * e, Math.max(1, t * 0.05));
      g.fill({ color: 0xc9b48a });
    }
  }
}

/**
 * Office: robot vacuums wandering in circles on the outer carpet, a little light blinking on
 * each; a paper plane gliding across now and then, somebody's stray; and now and then a
 * colleague racing past on an office chair, spinning, arms out — grey, white and black,
 * nothing of any player's colour.
 */
export class OfficeSeaLife extends OceanDrawn {
  private readonly vacuums = new Circling();
  private readonly gliders = new Crossings();
  private readonly chairs = new Crossings();
  /** The water cooler in the corner: whatever crosses its square is hidden behind it. */
  cooler: { x: number; y: number; size: number } | null = null;

  private hidden(x: number, y: number): boolean {
    const f = this.cooler;
    return f !== null && Math.abs(x - f.x) < f.size / 2 && Math.abs(y - f.y) < f.size / 2;
  }

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.vacuums.layout(this.ocean, art.office.vacuums, [1.2, 2.4]);
    this.gliders.layout(this.ocean, art.office.gliderEveryMs);
    this.chairs.layout(this.ocean, art.office.chairEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.office;
    const t = view.tile;
    const ink = hex(art.palette.shadow);

    this.vacuums.step(deltaMs);
    for (const v of this.vacuums.items) {
      const at = Circling.at(v);
      if (this.hidden(at.x, at.y)) continue;
      const x = tileX(view, at.x);
      const y = tileY(view, at.y);
      const heading = v.angle + (v.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.circle(x + t * 0.05, y + t * 0.08, t * 0.42);
      g.fill({ color: 0x000000, alpha: 0.3 });
      g.circle(x, y, t * 0.42);
      g.fill({ color: 0x24262b });
      g.stroke({ width: Math.max(1, t * 0.06), color: 0x6a6e76 });
      g.circle(x, y, t * 0.18);
      g.fill({ color: 0x3a3d44 });
      // Its bumper at the front, and the little light, blinking. Moved to first: an arc
      // carries on from wherever the last path left off, across the screen.
      g.moveTo(x + Math.cos(heading - 0.9) * t * 0.4, y + Math.sin(heading - 0.9) * t * 0.4);
      g.arc(x, y, t * 0.4, heading - 0.9, heading + 0.9);
      g.stroke({ width: Math.max(1, t * 0.08), color: 0x9a9ea5 });
      if (Math.floor(this.clock / 600 + v.cx) % 2 === 0) {
        g.circle(x + Math.cos(heading) * t * 0.25, y + Math.sin(heading) * t * 0.25, t * 0.05);
        g.fill({ color: 0x7af08a });
      }
    }

    this.gliders.step(this.ocean, deltaMs, s.gliderEveryMs, s.gliderTilesPerSecond, 0.5);
    for (const plane of this.gliders.items) {
      if (this.hidden(plane.x, plane.y)) continue;
      const y = plane.y + Math.sin(this.clock / 420 + plane.x) * 0.2;
      g.ellipse(tileX(view, plane.x), tileY(view, plane.y + 0.45), t * 0.35, t * 0.08);
      g.fill({ color: 0x000000, alpha: 0.2 });
      drawPlane(
        g,
        tileX(view, plane.x),
        tileY(view, y),
        t * 0.9,
        plane.dir === 1 ? 0 : Math.PI,
        0xf4f5f7,
        ink,
      );
    }

    this.chairs.step(this.ocean, deltaMs, s.chairEveryMs, s.chairTilesPerSecond, 0.8);
    for (const chair of this.chairs.items) {
      if (this.hidden(chair.x, chair.y)) continue;
      const x = tileX(view, chair.x);
      const y = tileY(view, chair.y);
      const spin = this.clock / 160;
      // The five-star base, its castors, and the seat with somebody on it, arms out.
      for (let k = 0; k < 5; k++) {
        const a = spin * 0.3 + (k / 5) * Math.PI * 2;
        g.moveTo(x, y).lineTo(x + Math.cos(a) * t * 0.45, y + Math.sin(a) * t * 0.45);
      }
      g.stroke({ width: Math.max(1.5, t * 0.08), color: 0x2a2c31, cap: 'round' });
      g.circle(x, y, t * 0.3);
      g.fill({ color: 0x3a3d44 });
      const c = Math.cos(spin);
      const sn = Math.sin(spin);
      g.moveTo(x - c * t * 0.55, y - sn * t * 0.55).lineTo(x + c * t * 0.55, y + sn * t * 0.55);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: 0xf4f5f7, cap: 'round' });
      for (const e of [-0.58, 0.58]) g.circle(x + c * t * e, y + sn * t * e, t * 0.07);
      g.fill({ color: 0xf2d0b0 });
      g.circle(x, y, t * 0.17);
      g.fill({ color: 0x5a3a24 });
      // Wind in their wake.
      for (let k = 1; k <= 2; k++) {
        const wx = x - chair.dir * t * (0.6 + k * 0.35);
        g.moveTo(wx, y - t * 0.15 * k).lineTo(wx - chair.dir * t * 0.4, y - t * 0.15 * k);
      }
      g.stroke({ width: 1, color: 0xc9ccd1, alpha: 0.6 });
    }
  }
}

/**
 * A paper plane seen from above, nose along `angle` (0 to the right), `size` from nose to
 * tail: the two wings either side of the fold, the far one shaded. Shared by Office's
 * shots, its sea life and its guns.
 */
export function drawPlane(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  angle: number,
  colour: number,
  ink: number,
  alpha = 1,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number): [number, number] => [
    x + (c * u - s * v) * size,
    y + (s * u + c * v) * size,
  ];
  g.poly([...at(0.5, 0), ...at(-0.5, -0.32), ...at(-0.32, 0)]);
  g.fill({ color: colour, alpha });
  g.poly([...at(0.5, 0), ...at(-0.32, 0), ...at(-0.5, 0.32)]);
  g.fill({ color: colour, alpha });
  g.poly([...at(0.5, 0), ...at(-0.5, 0.32), ...at(-0.32, 0)]);
  g.fill({ color: 0x000000, alpha: 0.18 * alpha });
  g.moveTo(...at(0.5, 0)).lineTo(...at(-0.32, 0));
  g.poly([...at(0.5, 0), ...at(-0.5, -0.32), ...at(-0.32, 0), ...at(-0.5, 0.32)]);
  g.stroke({ width: Math.max(1, size * 0.05), color: ink, alpha: 0.6 * alpha, join: 'round' });
}

/**
 * Opera: swans gliding in slow circles, as on the lake of the ballet; a gondola crossing now
 * and then, its gondolier singing a serenade, notes trailing behind him; and now and then the
 * Flying Dutchman's ship, dark, riding high — white birds, black lacquer and gold, nothing of
 * any player's colour.
 */
export class OperaSeaLife extends OceanDrawn {
  private readonly swans = new Circling();
  private readonly gondolas = new Crossings();
  private readonly ships = new Crossings();
  /** The conductor in the corner: whatever crosses his square is hidden behind him. */
  conductor: { x: number; y: number; size: number } | null = null;

  private hidden(x: number, y: number): boolean {
    const f = this.conductor;
    return f !== null && Math.abs(x - f.x) < f.size / 2 && Math.abs(y - f.y) < f.size / 2;
  }

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.swans.layout(this.ocean, art.opera.swans, [1, 2]);
    this.gondolas.layout(this.ocean, art.opera.gondolaEveryMs);
    this.ships.layout(this.ocean, art.opera.shipEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.opera;
    const t = view.tile;

    this.swans.step(deltaMs);
    for (const w of this.swans.items) {
      const at = Circling.at(w);
      if (this.hidden(at.x, at.y)) continue;
      const dir = Math.cos(w.angle) * Math.sign(w.speed) < 0 ? 1 : -1;
      drawSwan(g, tileX(view, at.x), tileY(view, at.y), t * 0.7, dir);
    }

    this.gondolas.step(this.ocean, deltaMs, s.gondolaEveryMs, s.gondolaTilesPerSecond, 1.2);
    for (const gondola of this.gondolas.items) {
      if (this.hidden(gondola.x, gondola.y)) continue;
      const y = gondola.y + Math.sin(this.clock / 700 + gondola.x) * 0.04;
      // The long black hull, its prow curling up.
      g.poly(
        shape(view, gondola.x, y, gondola.dir, [
          [-1, -0.05],
          [-0.7, 0.18],
          [0.7, 0.18],
          [1.05, -0.25],
          [1.1, -0.35],
          [0.85, -0.05],
        ]),
      );
      g.fill({ color: 0x111018 });
      // The gondolier at the stern: striped shirt, straw hat, his oar.
      const gx = tileX(view, gondola.x - gondola.dir * 0.6);
      const gy = tileY(view, y - 0.1);
      g.moveTo(gx, gy).lineTo(gx + gondola.dir * t * 0.5, gy + t * 0.5);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x6a4a2a });
      g.rect(gx - t * 0.09, gy - t * 0.45, t * 0.18, t * 0.35);
      g.fill({ color: 0xffffff });
      for (const f of [0.12, 0.24])
        g.rect(gx - t * 0.09, gy - t * 0.45 + t * f, t * 0.18, t * 0.05);
      g.fill({ color: 0x1f3a6a });
      g.circle(gx, gy - t * 0.55, t * 0.09);
      g.fill({ color: 0xf2d0b0 });
      g.ellipse(gx, gy - t * 0.62, t * 0.16, t * 0.04);
      g.fill({ color: 0xe8cf7a });
      // His serenade, trailing behind.
      for (let k = 0; k < 2; k++) {
        const p = (((this.clock / 1600 + k * 0.5) % 1) + 1) % 1;
        drawQuaver(
          g,
          gx - gondola.dir * t * (0.3 + p * 1.2),
          gy - t * (0.7 + p * 0.6),
          t * 0.4,
          GOLD,
          1 - p,
          k,
        );
      }
    }

    this.ships.step(this.ocean, deltaMs, s.shipEveryMs, s.shipTilesPerSecond, 1.6);
    for (const ship of this.ships.items) {
      if (this.hidden(ship.x, ship.y)) continue;
      const y = ship.y + Math.sin(this.clock / 500 + ship.x) * 0.1;
      g.poly(
        shape(view, ship.x, y, ship.dir, [
          [-1, -0.15],
          [1.1, -0.25],
          [0.8, 0.3],
          [-0.8, 0.3],
        ]),
      );
      g.fill({ color: 0x1c1418 });
      g.stroke({ width: 1, color: 0x5a4a52 });
      for (const [mx, h] of [
        [-0.35, 1.2],
        [0.35, 1.45],
      ] as const) {
        g.moveTo(tileX(view, ship.x + ship.dir * mx), tileY(view, y - 0.15));
        g.lineTo(tileX(view, ship.x + ship.dir * mx), tileY(view, y - h - 0.1));
        g.stroke({ width: 1, color: 0x3a2a30 });
        g.poly(
          shape(view, ship.x, y, ship.dir, [
            [mx - 0.28, -h],
            [mx + 0.3, -h + 0.05],
            [mx + 0.34, -0.4],
            [mx - 0.25, -0.35],
          ]),
        );
        g.fill({ color: 0x3e2e34, alpha: 0.9 });
      }
      g.circle(tileX(view, ship.x - ship.dir * 0.9), tileY(view, y - 0.3), t * 0.08);
      g.fill({ color: 0xfff0b0 });
    }
  }
}

/**
 * Under the sea: schools of silver fish wheeling over the outer deep, turning as one;
 * jellyfish drifting in slow circles, their bells pulsing; and now and then a sea turtle or a
 * manta ray gliding across — silver, white and slate, nothing of any player's colour.
 */
export class UnderseaSeaLife extends OceanDrawn {
  private readonly schools = new Circling();
  private readonly jellies = new Circling();
  private readonly turtles = new Crossings();
  private readonly mantas = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.schools.layout(this.ocean, art.undersea.fishSchools, [1.6, 2.8]);
    this.jellies.layout(this.ocean, art.undersea.jellyfish, [0.6, 1.4]);
    this.turtles.layout(this.ocean, art.undersea.turtleEveryMs);
    this.mantas.layout(this.ocean, art.undersea.mantaEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.undersea;
    const t = view.tile;

    this.schools.step(deltaMs);
    this.schools.items.forEach((school, n) => {
      const heading = school.angle + (school.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (let k = 0; k < 9; k++) {
        // Each fish keeps its place in the school, a little out of step with the rest.
        const u = ((k % 3) - 1) * 0.45 + Math.sin(this.clock / 400 + k) * 0.06;
        const v = (Math.floor(k / 3) - 1) * 0.4 + ((k % 3) - 1) * 0.12;
        const at = Circling.at({ ...school, angle: school.angle - v * 0.25 });
        const x = at.x + Math.cos(heading + Math.PI / 2) * u * 0.6;
        const y = at.y + Math.sin(heading + Math.PI / 2) * u * 0.6;
        if (this.behind(x, y)) continue;
        const flick = Math.sin(this.clock / 90 + k + n) * 0.12;
        drawFish(
          g,
          tileX(view, x),
          tileY(view, y),
          t * 0.42,
          Math.atan2(Math.sin(heading) * 0.6, Math.cos(heading)) + flick,
          k % 4 === 0 ? 0xdfeaf0 : 0xa9bcc8,
          0.85,
        );
      }
    });

    this.jellies.step(deltaMs * 0.3);
    this.jellies.items.forEach((jelly, n) => {
      const at = Circling.at(jelly);
      if (this.behind(at.x, at.y)) return;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock / 500 + n * 2);
      const x = tileX(view, at.x);
      const y = tileY(view, at.y);
      const w = t * (0.38 + 0.08 * pulse);
      const h = t * (0.36 - 0.06 * pulse);
      // The tentacles trailing, swaying, then the bell over them.
      for (let k = 0; k < 5; k++) {
        const fx = x + (k - 2) * w * 0.35;
        const sway = Math.sin(this.clock / 300 + k + n) * t * 0.08;
        g.moveTo(fx, y).quadraticCurveTo(
          fx + sway,
          y + t * 0.4,
          fx - sway,
          y + t * (0.7 + 0.1 * (k % 2)),
        );
      }
      g.stroke({ width: Math.max(1, t * 0.04), color: 0xe8dcf4, alpha: 0.55 });
      g.moveTo(x - w, y);
      g.arc(x, y, w, Math.PI, 0);
      g.quadraticCurveTo(x, y - h * 0.1 + h * 0.4, x - w, y);
      g.fill({ color: 0xf2eaff, alpha: 0.4 });
      g.moveTo(x - w, y);
      g.arc(x, y, w, Math.PI, 0);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0xffffff, alpha: 0.7 });
    });

    this.turtles.step(this.ocean, deltaMs, s.turtleEveryMs, s.turtleTilesPerSecond, 0.6);
    for (const turtle of this.turtles.items) {
      if (this.behind(turtle.x, turtle.y)) continue;
      const x = tileX(view, turtle.x);
      const y = tileY(view, turtle.y);
      const dir = turtle.dir;
      const stroke = Math.sin(this.clock / 380);
      // Flippers rowing, the head out front, the shell over all.
      for (const side of [-1, 1]) {
        const reach = side * stroke * t * 0.12;
        g.ellipse(x + dir * t * 0.25 + reach, y + side * t * 0.42, t * 0.24, t * 0.09);
        g.ellipse(x - dir * t * 0.32 - reach * 0.5, y + side * t * 0.28, t * 0.12, t * 0.07);
      }
      g.circle(x + dir * t * 0.62, y, t * 0.14);
      g.fill({ color: 0x8a9a7e });
      g.ellipse(x, y, t * 0.5, t * 0.38);
      g.fill({ color: 0x5f6e58 });
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x2f3a2c });
      for (const [u, v] of [
        [0, 0],
        [-0.25, -0.17],
        [0.25, -0.17],
        [-0.25, 0.17],
        [0.25, 0.17],
      ] as const) {
        g.circle(x + u * t, y + v * t, t * 0.1);
      }
      g.stroke({ width: 1, color: 0x2f3a2c, alpha: 0.7 });
    }

    this.mantas.step(this.ocean, deltaMs, s.mantaEveryMs, s.mantaTilesPerSecond, 1);
    for (const manta of this.mantas.items) {
      if (this.behind(manta.x, manta.y)) continue;
      const x = tileX(view, manta.x);
      const y = tileY(view, manta.y);
      const dir = manta.dir;
      const flap = Math.sin(this.clock / 520) * t * 0.25;
      // Seen from above: the wings swept back in curves, their tips flapping slowly, the two
      // horns of its head forward and the tail a whip behind.
      const u = (f: number): number => x + dir * t * f;
      g.moveTo(u(-0.5), y).lineTo(u(-1.7), y + flap * 0.3);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x2a3a48 });
      g.moveTo(u(0.5), y);
      for (const side of [-1, 1]) {
        const tip = y + side * (t * 1.1 + flap);
        g.quadraticCurveTo(u(0.45), y + side * t * 0.5, u(-0.05), tip);
        g.quadraticCurveTo(u(-0.1), y + side * t * 0.45, u(-0.5), y);
        if (side === -1) g.moveTo(u(0.5), y);
      }
      g.fill({ color: 0x2a3a48, alpha: 0.9 });
      g.ellipse(u(0.05), y, t * 0.42, t * 0.22);
      g.fill({ color: 0x41556a, alpha: 0.8 });
      for (const side of [-1, 1]) {
        g.moveTo(u(0.45), y + side * t * 0.1).quadraticCurveTo(
          u(0.7),
          y + side * t * 0.12,
          u(0.68),
          y + side * t * 0.02,
        );
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: 0x2a3a48, cap: 'round' });
    }
  }
}

/** How long an electric eel takes to leap out of the sea and back in. */
const EEL_MS = 1500;

/**
 * Electric: electric eels leaping from the outer sea, crackling as they arc out and as they
 * strike the water again; now and then a ship crossing, St. Elmo's fire burning pale on its
 * masts; and a gull blown across by the storm, tumbling — slate, grey and white, the arcs the
 * storm's white, nothing of any player's colour.
 */
export class ElectricSeaLife extends OceanDrawn {
  private readonly eels = new Surfacings();
  private readonly ships = new Crossings();
  private readonly gulls = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.ships.layout(this.ocean, art.electric.shipEveryMs);
    this.gulls.layout(this.ocean, art.electric.gullEveryMs);
  }

  protected frame(
    g: Graphics,
    view: ViewTransform,
    art: ArtConfig,
    deltaMs: number,
    glow?: Graphics,
  ): void {
    const s = art.electric;
    const t = view.tile;
    const halo = glow ?? null;

    this.eels.step(this.ocean, deltaMs, s.eelEveryMs, EEL_MS, (c) => !this.behind(c.x, c.y));
    for (const eel of this.eels.items) {
      const k = eel.ageMs / EEL_MS;
      // Its body along a leap: out of the water, over, and back in a tile and a half on.
      const at = (f: number): [number, number] => {
        const u = Math.min(1, Math.max(0, f));
        return [
          tileX(view, eel.x + eel.dir * (u - 0.5) * 1.6),
          tileY(view, eel.y) - Math.sin(u * Math.PI) * t * 1.1,
        ];
      };
      const body: number[] = [];
      for (let n = 0; n <= 6; n++) {
        const f = k * 1.3 - n * 0.06;
        if (f < 0 || f > 1) continue;
        const [x, y] = at(f);
        body.push(x, y + Math.sin(n * 1.4 + k * 12) * t * 0.05);
      }
      if (body.length >= 4) {
        g.moveTo(body[0]!, body[1]!);
        for (let i = 2; i < body.length; i += 2) g.lineTo(body[i]!, body[i + 1]!);
        g.stroke({ width: Math.max(2, t * 0.16), color: 0x3a4a3e, cap: 'round', join: 'round' });
        g.circle(body[0]!, body[1]!, Math.max(1.5, t * 0.1));
        g.fill({ color: 0x4a5a4c });
        // Crackling along it while it is out of the water.
        if (k < 0.8)
          drawArc(
            g,
            halo,
            jag(body[0]!, body[1]!, body[body.length - 2]!, body[body.length - 1]!, 4, t * 0.15),
            ARC_HALO,
            Math.max(1, t * 0.04),
            0.8,
          );
      }
      for (const [f, from] of [
        [0, 0],
        [1, 0.7],
      ] as const) {
        if (k < from || k > from + 0.3) continue;
        // The splash, out and in, with a ring of sparks off the water.
        const q = (k - from) / 0.3;
        const [x] = at(f);
        const y = tileY(view, eel.y);
        g.ellipse(x, y, t * (0.2 + 0.5 * q), t * (0.1 + 0.25 * q));
        g.stroke({ width: Math.max(1, t * 0.05), color: 0xdfe8f4, alpha: 0.7 * (1 - q) });
        if (from > 0) {
          for (let n = 0; n < 4; n++) {
            const a = -Math.PI * (0.15 + 0.7 * (n / 3));
            const r = t * (0.3 + 0.5 * q);
            drawArc(
              g,
              halo,
              jag(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, 3, t * 0.1),
              ARC_HALO,
              Math.max(1, t * 0.035),
              1 - q,
            );
          }
        }
      }
    }

    this.ships.step(this.ocean, deltaMs, s.shipEveryMs, s.shipTilesPerSecond, 1.6);
    for (const ship of this.ships.items) {
      if (this.behind(ship.x, ship.y)) continue;
      const roll = Math.sin(this.clock / 700) * 0.06;
      const hull = [
        [-0.9, 0.05],
        [0.95, 0.05],
        [0.7, 0.35],
        [-0.75, 0.35],
      ] as const;
      g.poly(
        hull.flatMap(([u, v]) => [
          tileX(view, ship.x + ship.dir * u),
          tileY(view, ship.y + v + u * roll),
        ]),
      );
      g.fill({ color: 0x1e2430 });
      g.stroke({ width: 1, color: 0x5a6270 });
      for (const [u, h] of [
        [-0.35, 1.2],
        [0.3, 1.45],
      ] as const) {
        const mx = tileX(view, ship.x + ship.dir * u);
        const foot = tileY(view, ship.y + u * roll);
        const top = foot - h * t;
        g.moveTo(mx, foot).lineTo(mx, top);
        g.moveTo(mx - t * 0.35, top + t * 0.35).lineTo(mx + t * 0.35, top + t * 0.35);
        g.stroke({ width: Math.max(1, t * 0.05), color: 0x3a4250 });
        // St. Elmo's fire at the masthead, a pale flame flickering.
        const flicker = 0.6 + 0.4 * Math.sin(this.clock / 90 + u * 7);
        g.circle(mx, top - t * 0.05, t * 0.18 * flicker);
        g.fill({ color: 0xcfe0ff, alpha: 0.35 });
        g.circle(mx, top - t * 0.05, t * 0.07);
        g.fill({ color: 0xf4f8ff, alpha: 0.9 });
        if (halo !== null) {
          halo.circle(mx, top - t * 0.05, t * 0.45);
          halo.fill({ color: ARC_HALO, alpha: 0.12 * flicker });
        }
      }
    }

    this.gulls.step(this.ocean, deltaMs, s.gullEveryMs, s.gullTilesPerSecond, 0.5);
    for (const gull of this.gulls.items) {
      if (this.behind(gull.x, gull.y)) continue;
      const x = tileX(view, gull.x);
      const y = tileY(view, gull.y) + Math.sin(this.clock / 160) * t * 0.3;
      const tilt = Math.sin(this.clock / 230) * 0.5;
      const flap = Math.sin(this.clock / 70) * t * 0.2;
      const c = Math.cos(tilt);
      const sn = Math.sin(tilt);
      const at = (u: number, v: number): [number, number] => [
        x + (c * u - sn * v) * t,
        y + (sn * u + c * v) * t,
      ];
      g.moveTo(...at(-0.5, -flap / t))
        .lineTo(...at(-0.2, 0))
        .lineTo(...at(0, 0.08))
        .lineTo(...at(0.2, 0))
        .lineTo(...at(0.5, -flap / t));
      g.stroke({ width: Math.max(1.5, t * 0.07), color: 0xe8ecf0, join: 'round' });
    }
  }
}

/** How long a fish takes to hop out of the sea and back in, and a whale to surface and spout. */
const HOP_MS = 1100;
const WHALE_MS = 4200;

/**
 * Cartoon: a fish hopping out of the outer sea in an arc, grinning; now and then a whale's
 * back surfacing to blow a fountain, and a rowing boat crossing, its oars pulling on twos —
 * white and grey, inked round, nothing of any player's colour. Everything moves in steps of
 * the film, as the board does.
 */
export class CartoonSeaLife extends OceanDrawn {
  private readonly fish = new Surfacings();
  private readonly whales = new Surfacings();
  private readonly boats = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.boats.layout(this.ocean, art.cartoon.boatEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.cartoon;
    const t = view.tile;
    const ink = Math.max(1.5, t * 0.08);
    const stepMs = 1000 / s.framesPerSecond;
    const stepped = (ms: number): number => Math.floor(ms / stepMs) * stepMs;
    const allowed = (c: { x: number; y: number }): boolean => !this.behind(c.x, c.y);

    this.fish.step(this.ocean, deltaMs, s.fishEveryMs, HOP_MS, allowed);
    for (const f of this.fish.items) {
      const k = stepped(f.ageMs) / HOP_MS;
      const x = tileX(view, f.x + f.dir * (k - 0.5) * 1.6);
      const y = tileY(view, f.y) - Math.sin(k * Math.PI) * t * 1.2;
      const angle = Math.atan2(-Math.cos(k * Math.PI) * 1.2, f.dir * 1.6) * 0.8;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const at = (u: number, v: number): [number, number] => [
        x + (c * u * f.dir - sn * v) * t,
        y + (sn * u * f.dir + c * v) * t,
      ];
      if (k > 0.08 && k < 0.92) {
        g.ellipse(...at(0, 0), t * 0.3, t * 0.17);
        g.poly([...at(-0.25, 0), ...at(-0.48, -0.16), ...at(-0.48, 0.16)]);
        g.fill({ color: PAPER });
        g.ellipse(...at(0, 0), t * 0.3, t * 0.17);
        g.poly([...at(-0.25, 0), ...at(-0.48, -0.16), ...at(-0.48, 0.16)]);
        g.stroke({ width: ink, color: INK, join: 'round' });
        drawPieEye(g, ...at(0.14, -0.03), t * 0.05, t * 0.07, f.dir, 0);
      }
      for (const from of [0, 0.85]) {
        if (k < from || k > from + 0.15) continue;
        const q = (k - from) / 0.15;
        const [sx] = at(0, 0);
        g.ellipse(sx, tileY(view, f.y), t * (0.2 + 0.4 * q), t * (0.08 + 0.15 * q));
        g.stroke({ width: Math.max(1, t * 0.05), color: PAPER, alpha: 1 - q });
      }
    }

    this.whales.step(
      this.ocean,
      deltaMs,
      s.whaleEveryMs,
      WHALE_MS,
      (c) => allowed(c) && !this.behind(c.x + 1, c.y) && !this.behind(c.x - 1, c.y),
    );
    for (const w of this.whales.items) {
      const k = stepped(w.ageMs) / WHALE_MS;
      const rise = Math.min(1, k / 0.15, (1 - k) / 0.15);
      const x = tileX(view, w.x);
      const y = tileY(view, w.y);
      const h = t * 0.6 * rise;
      // Its back, a grey hump with a smiling eye, the sea cutting across its foot.
      g.moveTo(x - t * 1.1, y).quadraticCurveTo(x - t * 0.2, y - h * 1.6, x + t * 1.1, y);
      g.closePath();
      g.fill({ color: 0x6a6a6a });
      g.stroke({ width: ink, color: INK, join: 'round' });
      if (rise > 0.6) {
        drawPieEye(g, x + w.dir * t * 0.55, y - h * 0.45, t * 0.06, t * 0.09, w.dir, 0);
        // The spout: a fountain of drops, rising and falling, white.
        const spout = Math.sin(((k - 0.2) / 0.6) * Math.PI);
        if (k > 0.2 && k < 0.8) {
          const sx = x - w.dir * t * 0.1;
          const top = y - h * 0.8 - spout * t * 1.4;
          g.moveTo(sx, y - h * 0.8).lineTo(sx, top);
          g.stroke({ width: Math.max(2, t * 0.12), color: PAPER, cap: 'round' });
          for (const side of [-1, 1]) {
            for (let n = 1; n <= 3; n++) {
              g.circle(sx + side * n * t * 0.18, top + n * n * t * 0.06, t * 0.08);
            }
          }
          g.fill({ color: PAPER });
          g.stroke({ width: 1, color: INK, alpha: 0.8 });
        }
      }
      g.moveTo(x - t * 1.3, y).lineTo(x + t * 1.3, y);
      g.stroke({ width: Math.max(1, t * 0.06), color: PAPER, alpha: 0.9, cap: 'round' });
    }

    this.boats.step(this.ocean, deltaMs, s.boatEveryMs, s.boatTilesPerSecond, 1);
    for (const boat of this.boats.items) {
      if (this.behind(boat.x, boat.y)) continue;
      const pull = Math.floor(this.clock / (stepMs * 3)) % 2;
      const x = tileX(view, boat.x);
      const y = tileY(view, boat.y);
      // The oars, back and forward by turns.
      for (const side of [-1, 1]) {
        const reach = pull === 0 ? 0.35 : -0.25;
        g.moveTo(x, y - t * 0.15).lineTo(x + boat.dir * reach * t, y + side * t * 0.05 + t * 0.15);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: INK, cap: 'round' });
      g.poly([
        x - t * 0.6,
        y - t * 0.15,
        x + t * 0.6,
        y - t * 0.15,
        x + t * 0.42,
        y + t * 0.12,
        x - t * 0.42,
        y + t * 0.12,
      ]);
      g.fill({ color: PAPER });
      g.stroke({ width: ink, color: INK, join: 'round' });
      // The rower: a round head in a boater, looking ahead.
      g.circle(x, y - t * 0.38, t * 0.17);
      g.fill({ color: PAPER });
      g.stroke({ width: ink * 0.8, color: INK });
      g.rect(x - t * 0.22, y - t * 0.58, t * 0.44, t * 0.05);
      g.rect(x - t * 0.13, y - t * 0.7, t * 0.26, t * 0.12);
      g.fill({ color: INK });
      g.circle(x + boat.dir * t * 0.07, y - t * 0.4, Math.max(1, t * 0.035));
      g.fill({ color: INK });
    }
  }
}

/**
 * Christmas: now and then Santa's sleigh flies across the outer sea, high, four reindeer before
 * it and a trail of gold sparkles behind; and ice floes drift by, a seal or a polar bear on
 * each, rocking. Browns, snow and gold — the sleigh's driver in a wine darker than any
 * player's red.
 */
export class ChristmasSeaLife extends OceanDrawn {
  private readonly sleighs = new Crossings();
  private readonly floes = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.sleighs.layout(this.ocean, art.christmas.sleighEveryMs);
    this.floes.layout(this.ocean, art.christmas.floeEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const s = art.christmas;
    const t = view.tile;
    const ink = Math.max(1, t * 0.05);

    this.floes.step(this.ocean, deltaMs, s.floeEveryMs, s.floeTilesPerSecond);
    for (const floe of this.floes.items) {
      if (this.behind(floe.x, floe.y)) continue;
      const x = tileX(view, floe.x);
      const y = tileY(view, floe.y);
      const rock = Math.sin(this.clock / 900 + floe.y) * t * 0.04;
      const shape = [
        -0.9, 0.1, -0.6, -0.25, 0.1, -0.32, 0.8, -0.15, 0.95, 0.15, 0.3, 0.3, -0.5, 0.28,
      ];
      g.poly(shape.map((v, k) => (k % 2 === 0 ? x + v * t : y + v * t + rock)));
      g.fill({ color: SNOW });
      g.stroke({ width: ink, color: SNOW_SHADE });
      g.ellipse(x, y + t * 0.3 + rock, t * 0.9, t * 0.08);
      g.fill({ color: SNOW_SHADE, alpha: 0.5 });
      if (Math.floor(floe.y) % 2 === 0) {
        // A seal, lying on it, its head up.
        g.ellipse(x - floe.dir * t * 0.05, y - t * 0.1 + rock, t * 0.36, t * 0.13);
        g.circle(x + floe.dir * t * 0.3, y - t * 0.24 + rock, t * 0.11);
        g.fill({ color: 0x7a8494 });
        g.circle(x + floe.dir * t * 0.34, y - t * 0.26 + rock, Math.max(1, t * 0.025));
        g.fill({ color: NIGHT });
      } else {
        // A polar bear, sitting up, looking out to sea.
        g.ellipse(x, y - t * 0.25 + rock, t * 0.24, t * 0.28);
        g.circle(x + floe.dir * t * 0.14, y - t * 0.58 + rock, t * 0.15);
        g.circle(x + floe.dir * t * 0.06, y - t * 0.7 + rock, t * 0.05);
        g.circle(x + floe.dir * t * 0.22, y - t * 0.7 + rock, t * 0.05);
        g.fill({ color: 0xf2ead8 });
        g.circle(x + floe.dir * t * 0.27, y - t * 0.56 + rock, Math.max(1, t * 0.03));
        g.fill({ color: NIGHT });
      }
    }

    this.sleighs.step(this.ocean, deltaMs, s.sleighEveryMs, s.sleighTilesPerSecond, 2);
    for (const sleigh of this.sleighs.items) {
      const d = sleigh.dir;
      const bob = Math.sin(this.clock / 260) * t * 0.12;
      const x = tileX(view, sleigh.x);
      const y = tileY(view, sleigh.y) - t * 1.2 + bob;
      // The trail of sparkles behind it.
      for (let k = 1; k <= 8; k++) {
        const tx = x - d * t * (0.9 + k * 0.45);
        const ty = y + t * 0.1 + Math.sin(this.clock / 200 + k) * t * 0.1;
        g.circle(tx, ty, Math.max(1, t * (0.09 - k * 0.008)));
      }
      g.fill({ color: YULE_GOLD, alpha: 0.8 });
      if (this.behind(sleigh.x, sleigh.y)) continue;
      // The reindeer, two pairs, legs galloping, harnessed to the sleigh.
      for (let k = 0; k < 2; k++) {
        const rx = x + d * t * (1.0 + k * 0.85);
        const ry = y - t * 0.05 + Math.sin(this.clock / 140 + k) * t * 0.05;
        const leg = Math.sin(this.clock / 90 + k * 2) * t * 0.12;
        g.moveTo(rx - d * t * 0.2, ry + t * 0.08).lineTo(rx - d * t * 0.2 - leg, ry + t * 0.3);
        g.moveTo(rx + d * t * 0.2, ry + t * 0.08).lineTo(rx + d * t * 0.2 + leg, ry + t * 0.3);
        g.moveTo(rx + d * t * 0.32, ry - t * 0.22).lineTo(rx + d * t * 0.25, ry - t * 0.42);
        g.moveTo(rx + d * t * 0.27, ry - t * 0.34).lineTo(rx + d * t * 0.16, ry - t * 0.4);
        g.stroke({ width: Math.max(1, t * 0.05), color: 0x5a3a22, cap: 'round' });
        g.ellipse(rx, ry, t * 0.3, t * 0.12);
        g.circle(rx + d * t * 0.34, ry - t * 0.16, t * 0.09);
        g.fill({ color: 0x8a6240 });
      }
      g.moveTo(x + d * t * 0.45, y).lineTo(x + d * t * 1.7, y);
      g.stroke({ width: 1, color: YULE_GOLD });
      // The sleigh: its body curling up at the front, gold runners, a sack and its driver.
      g.circle(x - d * t * 0.25, y - t * 0.3, t * 0.22);
      g.fill({ color: 0xc8b088 });
      g.circle(x + d * t * 0.12, y - t * 0.38, t * 0.13);
      g.fill({ color: 0x5a1820 });
      g.circle(x + d * t * 0.14, y - t * 0.55, t * 0.08);
      g.fill({ color: SNOW });
      g.poly([
        x - d * t * 0.55,
        y - t * 0.25,
        x + d * t * 0.35,
        y - t * 0.2,
        x + d * t * 0.5,
        y - t * 0.38,
        x + d * t * 0.4,
        y + t * 0.05,
        x - d * t * 0.5,
        y + t * 0.05,
      ]);
      g.fill({ color: 0x4a2414 });
      g.stroke({ width: ink, color: YULE_GOLD, join: 'round' });
      g.moveTo(x - d * t * 0.6, y + t * 0.16)
        .lineTo(x + d * t * 0.45, y + t * 0.16)
        .quadraticCurveTo(x + d * t * 0.62, y + t * 0.12, x + d * t * 0.55, y - t * 0.02);
      g.stroke({ width: Math.max(1, t * 0.05), color: YULE_GOLD, cap: 'round' });
    }
  }
}

/**
 * Noir: now and then a harbour tug crosses the outer sea in the dark, a black hull low in the
 * water, its wheelhouse window lit, smoke curling from its funnel and a wake of pale foam.
 */
export class NoirSeaLife extends OceanDrawn {
  private readonly tugs = new Crossings();

  override layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    super.layout(state, view, art);
    this.tugs.layout(this.ocean, art.noir.boatEveryMs);
  }

  protected frame(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const { boatEveryMs, boatTilesPerSecond } = art.noir;
    const t = view.tile;
    const ink = Math.max(1, t * 0.05);
    this.tugs.step(this.ocean, deltaMs, boatEveryMs, boatTilesPerSecond, 1);
    for (const tug of this.tugs.items) {
      if (this.behind(tug.x, tug.y)) continue;
      const d = tug.dir;
      const x = tileX(view, tug.x);
      const y = tileY(view, tug.y);
      const bob = Math.sin(this.clock / 700 + tug.y) * t * 0.03;
      // The wake, pale behind it.
      for (let k = 1; k <= 4; k++) {
        g.moveTo(x - d * t * (0.7 + k * 0.4), y + t * 0.18 - k * t * 0.04);
        g.lineTo(x - d * t * (0.9 + k * 0.4), y + t * 0.24 + k * t * 0.04);
      }
      g.stroke({ width: Math.max(1, t * 0.04), color: 0xd6d6d6, alpha: 0.5 });
      g.poly(
        shape(view, tug.x, tug.y + bob / t, d, [
          [-0.8, 0],
          [0.9, -0.05],
          [0.7, 0.28],
          [-0.65, 0.28],
        ]),
      );
      g.fill({ color: 0x141418 });
      g.stroke({ width: ink, color: 0x050506 });
      g.poly(
        shape(view, tug.x, tug.y + bob / t, d, [
          [-0.35, 0],
          [0.25, 0],
          [0.25, -0.42],
          [-0.35, -0.42],
        ]),
      );
      g.fill({ color: 0x2a2a30 });
      g.stroke({ width: ink, color: 0x050506 });
      g.rect(x + d * t * 0.02 - t * 0.09, y - t * 0.33 + bob, t * 0.18, t * 0.12);
      g.fill({ color: 0xf6eedc });
      g.rect(x - d * t * 0.55 - t * 0.07, y - t * 0.6 + bob, t * 0.14, t * 0.4);
      g.fill({ color: 0x1a1a1e });
      // Smoke from the funnel, rising and drifting back.
      for (let k = 0; k < 4; k++) {
        const rise = (((this.clock / 1800 + k / 4) % 1) + 1) % 1;
        g.circle(
          x - d * t * (0.55 + rise * 0.6),
          y - t * (0.7 + rise * 0.9) + bob,
          t * (0.1 + rise * 0.18),
        );
        g.fill({ color: 0x8a8a90, alpha: 0.5 * (1 - rise) });
      }
    }
  }
}
