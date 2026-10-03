import type { ArtConfig } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';
import type { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';

import { Circling, Crossings, NO_OCEAN, Surfacings, outerOcean, type OuterOcean } from './ocean.js';
import { drawBat } from './spooky.js';
import { hex, tileX, tileY, type ViewTransform } from './theme.js';

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
