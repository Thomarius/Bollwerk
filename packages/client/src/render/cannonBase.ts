import type { Cannon } from '@bollwerk/sim';
import type { Graphics } from 'pixi.js';

import { tileX, tileY, type ViewTransform } from './theme.js';

/** How far the base stands in from the footprint's edge, in tiles: a hair, so neighbours part. */
const INSET = 0.08;

/**
 * A plain square under a round gun, filling its footprint. Test players found round guns
 * hard to read while building, where the square ones were clear: a building player is
 * judging what a 2x2 gun takes up, and a circle hides its corners. Simple on purpose — the
 * gun on it is the style's; the base only says where the gun stands and whose it is.
 * `fill` null leaves it an outline, for a style drawn in lines.
 */
export function cannonBase(
  g: Graphics,
  view: ViewTransform,
  cannon: Cannon,
  fill: number | null,
  edge: number,
  fillAlpha = 0.65,
): void {
  const t = view.tile;
  g.rect(
    tileX(view, cannon.x + INSET),
    tileY(view, cannon.y + INSET),
    (cannon.w - 2 * INSET) * t,
    (cannon.h - 2 * INSET) * t,
  );
  if (fill !== null) g.fill({ color: fill, alpha: fillAlpha });
  g.stroke({ width: Math.max(1, t * 0.06), color: edge });
}
