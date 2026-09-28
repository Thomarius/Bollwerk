/**
 * The shape of a coast drawn inside its tiles: rounded where the land turns outward,
 * filled in where it turns in, so an island stops reading as a stack of squares.
 *
 * Only drawing. The land a player may build on is the tiles, exactly as before; the
 * rounding is small enough (`coastRadiusPx`) that a corner tile still plainly is land.
 *
 * A land tile is described by which of its neighbours are sea: north, east, south,
 * west in the low bits, then the diagonals — the shore mask the atlas is keyed by.
 */

export const SEA_N = 1;
export const SEA_E = 2;
export const SEA_S = 4;
export const SEA_W = 8;
export const SEA_NW = 16;
export const SEA_NE = 32;
export const SEA_SE = 64;
export const SEA_SW = 128;

/**
 * A tile's four corners, each by the side above or below it (`a`), the side beside it
 * (`b`), and the diagonal between them (`d`) — and how far a pixel is from the corner
 * along each edge: `u` from the side `b` names, `v` from the side `a` names.
 */
const CORNERS = [
  { a: SEA_N, b: SEA_W, d: SEA_NW, u: (x: number) => x, v: (_s: number, y: number) => y },
  {
    a: SEA_N,
    b: SEA_E,
    d: SEA_NE,
    u: (x: number, s: number) => s - x,
    v: (_s: number, y: number) => y,
  },
  {
    a: SEA_S,
    b: SEA_E,
    d: SEA_SE,
    u: (x: number, s: number) => s - x,
    v: (s: number, y: number) => s - y,
  },
  { a: SEA_S, b: SEA_W, d: SEA_SW, u: (x: number) => x, v: (s: number, y: number) => s - y },
] as const;

/**
 * How far the centre of pixel (`x`, `y`) of a land tile `size` pixels across is from
 * the coast, in pixels: negative where the rounding has cut the land back and the sea
 * shows, `Infinity` for a tile with no sea beside it.
 *
 * Where the land turns outward — sea on both sides of a corner — the corner is a
 * quarter circle of `radius`. Where it turns in, the coast bends round the fillet
 * drawn in the neighbouring sea tile (`filletCorners`), so the two meet without a step.
 */
export function coastDistance(
  mask: number,
  x: number,
  y: number,
  size: number,
  radius: number,
): number {
  const px = x + 0.5;
  const py = y + 0.5;
  const straight: Record<number, number> = {
    [SEA_N]: py,
    [SEA_E]: size - px,
    [SEA_S]: size - py,
    [SEA_W]: px,
  };
  const ignored = new Set<number>();
  let best = Number.POSITIVE_INFINITY;

  if (radius > 0) {
    for (const corner of CORNERS) {
      const u = corner.u(px, size);
      const v = corner.v(size, py);
      const seaA = (mask & corner.a) !== 0;
      const seaB = (mask & corner.b) !== 0;
      const seaD = (mask & corner.d) !== 0;
      if (seaA && seaB) {
        // Turning outward: the corner cut back to a quarter circle.
        if (u < radius && v < radius) {
          ignored.add(corner.a).add(corner.b);
          best = Math.min(best, radius - Math.hypot(radius - u, radius - v));
        }
      } else if (seaA && !seaD) {
        // The sea beyond side a has land on two sides of this corner, and is filleted
        // there: its centre lies in that tile, a radius along and a radius out.
        if (u < radius) {
          ignored.add(corner.a);
          best = Math.min(best, Math.hypot(u - radius, v + radius) - radius);
        }
      } else if (seaB && !seaD) {
        if (v < radius) {
          ignored.add(corner.b);
          best = Math.min(best, Math.hypot(u + radius, v - radius) - radius);
        }
      } else if (!seaA && !seaB && seaD) {
        // Sea only at the diagonal: the fillet is in the tile across the corner.
        best = Math.min(best, Math.hypot(u + radius, v + radius) - radius);
      }
    }
  }
  for (const side of [SEA_N, SEA_E, SEA_S, SEA_W]) {
    if ((mask & side) !== 0 && !ignored.has(side)) best = Math.min(best, straight[side] as number);
  }
  return best;
}

/**
 * Which corners of a sea tile are filled in with land, as the diagonal bits of the shore
 * mask: those where the tile above or below, the tile beside, and the tile across the
 * corner are all land. Where only the two across from each other are, the land meets at a
 * point — which the sea passes, since the escape flood is 8-connected — and joining them
 * with a fillet would draw a seal that is not there.
 */
export function filletCorners(landAt: (dx: number, dy: number) => boolean): number {
  let corners = 0;
  if (landAt(0, -1) && landAt(-1, 0) && landAt(-1, -1)) corners |= SEA_NW;
  if (landAt(0, -1) && landAt(1, 0) && landAt(1, -1)) corners |= SEA_NE;
  if (landAt(0, 1) && landAt(1, 0) && landAt(1, 1)) corners |= SEA_SE;
  if (landAt(0, 1) && landAt(-1, 0) && landAt(-1, 1)) corners |= SEA_SW;
  return corners;
}

/**
 * How far the centre of pixel (`x`, `y`) of a sea tile is inside the fillet at `corner`
 * (one of the diagonal bits), in pixels: positive on the land it adds, negative or
 * `-Infinity` on the sea.
 */
export function filletDistance(
  corner: number,
  x: number,
  y: number,
  size: number,
  radius: number,
): number {
  const spec = CORNERS.find((c) => c.d === corner);
  if (spec === undefined || radius <= 0) return Number.NEGATIVE_INFINITY;
  const u = spec.u(x + 0.5, size);
  const v = spec.v(size, y + 0.5);
  if (u >= radius || v >= radius) return Number.NEGATIVE_INFINITY;
  return Math.hypot(radius - u, radius - v) - radius;
}
