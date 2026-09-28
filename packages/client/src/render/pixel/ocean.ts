import type { ArtConfig } from '@rampart/config';
import { Terrain, type MatchState } from '@rampart/sim';
import type { Graphics } from 'pixi.js';

import { hex, tileX, tileY, type Cell, type ViewTransform } from '../theme.js';

/**
 * The ocean out beyond the islands, where the pixel style keeps its sea life: tiles on
 * screen, clear of the HUD bar, and outside the box round all the land by a tile. Shots
 * fly only between islands, so nothing drawn out here can be taken for one — which is
 * why the channels between the islands, however wide, are left alone.
 */
export interface OuterOcean {
  /** Rows of open water right across the screen, which a boat can cross. */
  rows: number[];
  /** The first and last columns on screen. */
  x0: number;
  x1: number;
  cells: Cell[];
}

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
  return { rows, x0, x1, cells };
}

interface Boat {
  x: number;
  y: number;
  dir: 1 | -1;
}
interface Gull {
  cx: number;
  cy: number;
  radius: number;
  angle: number;
  speed: number;
}
interface Fish {
  x: number;
  y: number;
  dir: 1 | -1;
  age: number;
}

const FISH_MS = 650;

/**
 * Boats under sail crossing now and then, gulls wheeling, fish jumping — all out on the
 * outer ocean (`outerOcean`), in the pixel style's own pixels. Cosmetic, so an ordinary
 * random source; drawn not at all when motion is reduced.
 */
export class OceanLife {
  private ocean: OuterOcean = { rows: [], x0: 0, x1: -1, cells: [] };
  private boats: Boat[] = [];
  private gulls: Gull[] = [];
  private fish: Fish[] = [];
  private untilBoat = 0;
  private untilFish = 0;

  /** Rows of open water right across the screen, clear of the land. */
  rows(): number[] {
    return this.ocean.rows;
  }

  /** The ocean to keep to, measured again whenever the board is laid out. */
  layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    this.ocean = outerOcean(state, view);
    this.boats = this.boats.filter((b) => this.ocean.rows.includes(Math.round(b.y)));
    this.gulls = [];
    const cells = this.ocean.cells;
    for (let k = 0; k < art.pixel.gulls && cells.length > 0; k++) {
      const at = cells[Math.floor(Math.random() * cells.length)] as Cell;
      this.gulls.push({
        cx: at.x + 0.5,
        cy: at.y + 0.5,
        radius: 1 + Math.random() * 1.5,
        angle: Math.random() * Math.PI * 2,
        speed: (0.35 + Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1),
      });
    }
    if (this.untilBoat === 0) this.untilBoat = art.pixel.boatEveryMs * Math.random();
  }

  draw(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const { palette } = art;
    const px = Math.max(1, Math.round(view.tile / art.tileSizePx));
    const dt = deltaMs / 1000;
    const { rows, x0, x1, cells } = this.ocean;

    // A boat now and then, crossing a row of open water from one side to the other.
    this.untilBoat -= deltaMs;
    if (this.untilBoat <= 0 && rows.length > 0 && this.boats.length === 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = rows[Math.floor(Math.random() * rows.length)] as number;
      this.boats.push({ x: dir === 1 ? x0 - 2 : x1 + 2, y: y + 0.5, dir });
      this.untilBoat = art.pixel.boatEveryMs * (0.6 + Math.random() * 0.8);
    }
    for (const boat of this.boats) {
      boat.x += boat.dir * art.pixel.boatTilesPerSecond * dt;
      const bx = Math.round(tileX(view, boat.x));
      const by = Math.round(tileY(view, boat.y) + Math.sin(boat.x * 3) * px * 0.5);
      // The wake, fading behind.
      for (let k = 1; k <= 4; k++) {
        g.rect(bx - boat.dir * (4 + k * 3) * px, by + (k % 2) * px, px * 2, px);
        g.fill({ color: hex(palette.waterFoam), alpha: 0.5 - k * 0.1 });
      }
      // Hull, deck, mast and a white sail.
      g.rect(bx - 5 * px, by, 10 * px, 2 * px);
      g.rect(bx - 4 * px, by + 2 * px, 8 * px, px);
      g.fill({ color: hex(palette.craterMid) });
      g.rect(bx - 4 * px, by, 8 * px, px);
      g.fill({ color: hex(palette.sand) });
      g.rect(bx, by - 8 * px, px, 8 * px);
      g.fill({ color: hex(palette.craterDark) });
      for (let row = 0; row < 6; row++) {
        const w = 1 + Math.floor(row * 0.7);
        g.rect(boat.dir === 1 ? bx + px : bx - w * px, by - (7 - row) * px, w * px, px);
      }
      g.fill({ color: hex(palette.uiInk) });
    }
    this.boats = this.boats.filter((b) => b.x > x0 - 4 && b.x < x1 + 4);

    // Gulls wheeling, their shadows on the water below them.
    const flap = Math.floor(performance.now() / 180) % 2 === 0;
    for (const gull of this.gulls) {
      gull.angle += gull.speed * dt;
      const gx = Math.round(tileX(view, gull.cx + Math.cos(gull.angle) * gull.radius));
      const gy = Math.round(tileY(view, gull.cy + Math.sin(gull.angle) * gull.radius * 0.6));
      const wing = (colour: number, oy: number, alpha: number): void => {
        g.rect(gx - px, gy + oy, px, px);
        g.rect(gx + px, gy + oy, px, px);
        g.rect(gx - 2 * px, gy + oy - (flap ? px : 0), px, px);
        g.rect(gx + 2 * px, gy + oy - (flap ? px : 0), px, px);
        g.rect(gx, gy + oy + px, px, px);
        g.fill({ color: colour, alpha });
      };
      wing(hex(palette.shadow), view.tile * 0.8, 0.25);
      wing(hex(palette.uiInk), 0, 0.95);
    }

    // A fish jumping: an arc of silver, and a ring where it goes in.
    this.untilFish -= deltaMs;
    if (this.untilFish <= 0 && cells.length > 0) {
      const at = cells[Math.floor(Math.random() * cells.length)] as Cell;
      this.fish.push({ x: at.x + 0.3, y: at.y + 0.5, dir: Math.random() < 0.5 ? 1 : -1, age: 0 });
      this.untilFish = art.pixel.fishEveryMs * (0.5 + Math.random());
    }
    for (const fish of this.fish) {
      fish.age += deltaMs;
      const t = Math.min(1, fish.age / FISH_MS);
      const fx = Math.round(tileX(view, fish.x + fish.dir * t * 0.7));
      const fy = Math.round(tileY(view, fish.y) - Math.sin(Math.PI * t) * view.tile * 0.45);
      if (t < 1) {
        g.rect(fx - px, fy, px * 2, px);
        g.fill({ color: hex(palette.rockLight) });
      }
      for (const [at, lag] of [
        [fish.x, 0],
        [fish.x + fish.dir * 0.7, 0.9],
      ] as const) {
        const ring = (fish.age / FISH_MS - lag) / 0.8;
        if (ring <= 0 || ring >= 1) continue;
        g.ellipse(
          tileX(view, at),
          tileY(view, fish.y),
          view.tile * 0.35 * ring + px,
          view.tile * 0.15 * ring + px,
        );
        g.stroke({ width: px, color: hex(palette.waterFoam), alpha: 0.7 * (1 - ring) });
      }
    }
    this.fish = this.fish.filter((fish) => fish.age < FISH_MS * 2);
  }
}
