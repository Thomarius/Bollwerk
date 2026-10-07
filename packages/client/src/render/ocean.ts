import { Terrain, type MatchState } from '@bollwerk/sim';

import type { Cell, ViewTransform } from './theme.js';

/**
 * The ocean out beyond the islands, where every style keeps its sea life (PLAN §7):
 * tiles on screen, clear of the HUD bar, and outside the box round all the land by a
 * tile. Shots fly only between islands, so nothing drawn out here can be taken for one —
 * which is why the channels between the islands, however wide, are left alone.
 */
export interface OuterOcean {
  /** Rows of open water right across the screen, which a boat can cross. */
  rows: number[];
  /** The first and last columns on screen, and the first row not under the HUD. */
  x0: number;
  x1: number;
  y0: number;
  cells: Cell[];
}

export const NO_OCEAN: OuterOcean = { rows: [], x0: 0, x1: -1, y0: 0, cells: [] };

export function outerOcean(state: MatchState, view: ViewTransform): OuterOcean {
  let bx0 = state.width;
  let by0 = state.height;
  let bx1 = -1;
  let by1 = -1;
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] !== Terrain.Land) continue;
    const x = i % state.width;
    const y = (i - x) / state.width;
    bx0 = Math.min(bx0, x);
    bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y);
    by1 = Math.max(by1, y);
  }
  const t = view.tile;
  const x0 = Math.ceil(-view.originX / t);
  const x1 = Math.floor((view.width - view.originX) / t) - 1;
  const y0 = Math.ceil((view.top - view.originY) / t);
  const y1 = Math.floor((view.height - view.originY) / t) - 1;
  const outside = (x: number, y: number): boolean =>
    x < bx0 - 1 || x > bx1 + 1 || y < by0 - 1 || y > by1 + 1;
  const rows: number[] = [];
  const cells: Cell[] = [];
  for (let y = y0; y <= y1; y++) {
    if (y < by0 - 1 || y > by1 + 1) rows.push(y);
    for (let x = x0; x <= x1; x++) if (outside(x, y)) cells.push({ x, y });
  }
  return { rows, x0, x1, y0, cells };
}

/*
 * How sea life moves, shared by every style, which only draws it: things crossing a row
 * of the outer ocean now and then (boats, ships, a hover-craft, a duck), things circling
 * over it (gulls, drones), and things surfacing for a while and going under (fish, a sea
 * serpent, a shark's fin). Cosmetic, so an ordinary random source; a style draws none of
 * it while motion is reduced.
 */

/** Something crossing a row, from off one side of the screen to off the other. */
export interface Crosser {
  /** Tiles, the centre; `y` is the middle of its row. */
  x: number;
  y: number;
  dir: 1 | -1;
}

/** One at a time, now and then: every `everyMs` on average once the last has gone. */
export class Crossings {
  items: Crosser[] = [];
  private until = -1;

  /** Keeps to rows still open after the board is laid out again. */
  layout(ocean: OuterOcean, everyMs: number): void {
    this.items = this.items.filter((c) => ocean.rows.includes(Math.floor(c.y)));
    // The first comes at a random point of the first wait, not all at once as a match opens.
    if (this.until < 0) this.until = everyMs * Math.random();
  }

  /**
   * `headroomTiles` keeps something tall — a ship's masts — off the rows whose top it
   * would put under the HUD bar.
   */
  step(
    ocean: OuterOcean,
    deltaMs: number,
    everyMs: number,
    tilesPerSecond: number,
    headroomTiles = 0,
  ): void {
    this.until -= deltaMs;
    // The rows are sifted only when something is due to set out, not every frame.
    const due = this.until <= 0 && this.items.length === 0;
    const rows = due ? ocean.rows.filter((r) => r - headroomTiles >= ocean.y0) : [];
    if (due && rows.length > 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const row = rows[Math.floor(Math.random() * rows.length)] as number;
      this.items.push({ x: dir === 1 ? ocean.x0 - 2 : ocean.x1 + 2, y: row + 0.5, dir });
      this.until = everyMs * (0.6 + Math.random() * 0.8);
    }
    for (const c of this.items) c.x += c.dir * tilesPerSecond * (deltaMs / 1000);
    this.items = this.items.filter((c) => c.x > ocean.x0 - 4 && c.x < ocean.x1 + 4);
  }
}

/** Something wheeling round a point over the outer ocean, for as long as the match. */
export interface Circler {
  cx: number;
  cy: number;
  radius: number;
  angle: number;
  /** Radians a second; the sign is the way round. */
  speed: number;
}

export class Circling {
  items: Circler[] = [];

  /** Placed afresh whenever the board is laid out, since the ocean may have moved. */
  layout(ocean: OuterOcean, count: number, radius: [number, number] = [1, 2.5]): void {
    this.items = [];
    for (let k = 0; k < count && ocean.cells.length > 0; k++) {
      const at = ocean.cells[Math.floor(Math.random() * ocean.cells.length)] as Cell;
      this.items.push({
        cx: at.x + 0.5,
        cy: at.y + 0.5,
        radius: radius[0] + Math.random() * (radius[1] - radius[0]),
        angle: Math.random() * Math.PI * 2,
        speed: (0.35 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1),
      });
    }
  }

  step(deltaMs: number): void {
    for (const c of this.items) c.angle += c.speed * (deltaMs / 1000);
  }

  /** Where one is now, in tiles: flattened, as a circle seen from above at an angle. */
  static at(c: Circler): { x: number; y: number } {
    return { x: c.cx + Math.cos(c.angle) * c.radius, y: c.cy + Math.sin(c.angle) * c.radius * 0.6 };
  }
}

/** Something surfacing at a spot for `lifeMs`, then gone. */
export interface Surfacing {
  x: number;
  y: number;
  dir: 1 | -1;
  ageMs: number;
}

export class Surfacings {
  items: Surfacing[] = [];
  private until = -1;

  /** `allowed` keeps it off what a style already draws on the sea, such as a compass rose. */
  step(
    ocean: OuterOcean,
    deltaMs: number,
    everyMs: number,
    lifeMs: number,
    allowed: (cell: Cell) => boolean = () => true,
  ): void {
    if (this.until < 0) this.until = everyMs * Math.random();
    this.until -= deltaMs;
    // The whole outer ocean is sifted only when something is due to surface, not every frame.
    const cells = this.until <= 0 ? ocean.cells.filter(allowed) : [];
    if (cells.length > 0) {
      const at = cells[Math.floor(Math.random() * cells.length)] as Cell;
      this.items.push({
        x: at.x + 0.5,
        y: at.y + 0.5,
        dir: Math.random() < 0.5 ? 1 : -1,
        ageMs: 0,
      });
      this.until = everyMs * (0.5 + Math.random());
    }
    for (const s of this.items) s.ageMs += deltaMs;
    this.items = this.items.filter((s) => s.ageMs < lifeMs);
  }
}

/** The piece a style stands in the sea's corner (`roseSpot`): its square, in tiles. */
export interface CornerPiece {
  x: number;
  y: number;
  size: number;
}

/** Whether a point lies in the corner piece's square, so whatever passes is behind it. */
export function behindCorner(corner: CornerPiece | null, x: number, y: number): boolean {
  return (
    corner !== null &&
    Math.abs(x - corner.x) < corner.size / 2 &&
    Math.abs(y - corner.y) < corner.size / 2
  );
}
