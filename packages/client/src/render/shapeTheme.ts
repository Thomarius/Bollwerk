import type { ArtConfig } from '@bollwerk/config';
import { Terrain } from '@bollwerk/sim';

import { playerColour, type ViewTransform } from './theme.js';

/**
 * What the styles drawn from shapes since Chocolate share, word for word: the board's land
 * as last laid out, a player's colour in a shade, how tall a wall's face stands, and the
 * width of an inked line. Each style sets `art` as it starts and the terrain as it lays the
 * board out; the drawing is all its own.
 */
export abstract class ShapeTheme {
  protected art!: ArtConfig;
  protected terrain: Uint8Array | null = null;
  protected width = 0;
  protected height = 0;

  protected land(x: number, y: number): boolean {
    return (
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      this.terrain[y * this.width + x] === Terrain.Land
    );
  }

  protected colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  protected faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  protected ink(view: ViewTransform): number {
    return Math.max(1, view.tile * 0.07);
  }
}
