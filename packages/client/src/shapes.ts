import { defaultArtConfig, type ArtConfig, type PlayerShape } from '@rampart/config';

import { isTeamed } from './colours.js';

/**
 * A shape per player beside their colour (PLAN 11.15 X6), so eight players — and
 * colour-blind players, for whom the three greens and two reds are hard — can tell
 * islands apart. Off the board only, the user's decision: the roster, the island
 * banners, the "You are here" marker, the lobby's seats and map, and the summary.
 *
 * Paths in a 24-unit box, the one form for both SVG in the HUD and `Path2D` on the
 * lobby's canvas, so the two cannot draw a shape differently. Drawn rather than taken
 * from a font: ▲ and ★ come out in a different font, size and weight on every system.
 */
export const SHAPE_PATHS: Record<PlayerShape, string> = {
  circle: 'M2.5 12a9.5 9.5 0 1 0 19 0a9.5 9.5 0 1 0 -19 0Z',
  // A little inside the box: a square filling it looks larger than the rest.
  square: 'M3.5 3.5h17v17h-17Z',
  triangle: 'M12 2L22.5 21H1.5Z',
  diamond: 'M12 1.5L22.5 12L12 22.5L1.5 12Z',
  star: 'M12 2.1L14.59 9.34L22.27 9.56L16.18 14.26L18.35 21.64L12 17.3L5.65 21.64L7.82 14.26L1.73 9.56L9.41 9.34Z',
  plus: 'M8.5 2h7v6.5H22v7h-6.5V22h-7v-6.5H2v-7h6.5Z',
  hexagon: 'M12 1.5L21.09 6.75V17.25L12 22.5L2.91 17.25V6.75Z',
  invertedTriangle: 'M1.5 3H22.5L12 22Z',
};

/**
 * Each player's shape for this match, by player id: by player in free-for-all, by team
 * in a team match, where teammates share a shape as they share a hue — the user's
 * choice, so a colour-blind player can tell the teams apart. Teams are numbered as
 * `matchPalette` takes them, so Team A has the first shape in the lobby and in play.
 */
export function matchShapes(
  art: Pick<ArtConfig, 'playerShapes'>,
  state: { players: readonly { id: number; team: number }[] },
): PlayerShape[] {
  const shapes = art.playerShapes;
  const teamed = isTeamed(state.players);
  return state.players.map((p) => shapes[(teamed ? p.team : p.id) % shapes.length]!);
}

/** The shapes the HUD draws from; the match's once one is running. */
let active: readonly PlayerShape[] = defaultArtConfig.playerShapes;

/** Makes a match's shapes the ones every HUD shape below is drawn from. */
export function useMatchShapes(shapes: readonly PlayerShape[]): void {
  active = shapes;
}

export function playerShape(player: number): PlayerShape {
  return active[player % active.length] ?? 'circle';
}

/**
 * A shape as inline SVG in a colour, sized by the stylesheet (`.shape`), which also
 * gives it the light rim that keeps a dark colour's form readable on a dark bar.
 */
export function shapeSvg(shape: PlayerShape, colour: string): string {
  return `<svg class="shape" viewBox="0 0 24 24" aria-hidden="true"><path d="${SHAPE_PATHS[shape]}" fill="${colour}"/></svg>`;
}

/** A shape on a canvas, centred on a point, `sizePx` across, with a rim. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: PlayerShape,
  cx: number,
  cy: number,
  sizePx: number,
  fill: string,
  rim: string,
): void {
  const scale = sizePx / 24;
  ctx.save();
  ctx.translate(cx - sizePx / 2, cy - sizePx / 2);
  ctx.scale(scale, scale);
  const path = new Path2D(SHAPE_PATHS[shape]);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = rim;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.restore();
}
