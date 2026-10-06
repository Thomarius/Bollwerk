import type { ArtConfig } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';
import type { Graphics } from 'pixi.js';

import {
  Circling,
  Crossings,
  NO_OCEAN,
  Surfacings,
  behindCorner,
  outerOcean,
  type CornerPiece,
  type OuterOcean,
} from '../ocean.js';
import { hex, tileX, tileY, type ViewTransform } from '../theme.js';

const FISH_MS = 650;

/**
 * Boats under sail crossing now and then, gulls wheeling, fish jumping — all out on the
 * outer ocean (`outerOcean`), moved as every style's sea life is (`../ocean.ts`) and drawn
 * in the pixel style's own pixels; not at all when motion is reduced.
 */
export class OceanLife {
  private ocean: OuterOcean = NO_OCEAN;
  private readonly boats = new Crossings();
  private readonly gulls = new Circling();
  private readonly fish = new Surfacings();
  /** The windmill or the fishing boat in the corner: what passes there goes behind it. */
  corner: CornerPiece | null = null;

  /** Rows of open water right across the screen, clear of the land. */
  rows(): number[] {
    return this.ocean.rows;
  }

  /** The ocean to keep to, measured again whenever the board is laid out. */
  layout(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    this.ocean = outerOcean(state, view);
    this.boats.layout(this.ocean, art.pixel.boatEveryMs);
    this.gulls.layout(this.ocean, art.pixel.gulls);
  }

  draw(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const { palette } = art;
    const px = Math.max(1, Math.round(view.tile / art.tileSizePx));

    // A boat now and then, crossing a row of open water from one side to the other.
    this.boats.step(this.ocean, deltaMs, art.pixel.boatEveryMs, art.pixel.boatTilesPerSecond, 1);
    for (const boat of this.boats.items) {
      if (behindCorner(this.corner, boat.x, boat.y)) continue;
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

    // Gulls wheeling, their shadows on the water below them.
    const flap = Math.floor(performance.now() / 180) % 2 === 0;
    this.gulls.step(deltaMs);
    for (const gull of this.gulls.items) {
      const at = Circling.at(gull);
      if (behindCorner(this.corner, at.x, at.y)) continue;
      const gx = Math.round(tileX(view, at.x));
      const gy = Math.round(tileY(view, at.y));
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
    this.fish.step(this.ocean, deltaMs, art.pixel.fishEveryMs, FISH_MS * 2);
    for (const fish of this.fish.items) {
      if (behindCorner(this.corner, fish.x, fish.y)) continue;
      const t = Math.min(1, fish.ageMs / FISH_MS);
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
        const ring = (fish.ageMs / FISH_MS - lag) / 0.8;
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
  }
}
