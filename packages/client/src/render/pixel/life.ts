import { Structure, type MatchState } from '@bollwerk/sim';

/**
 * Where the pixel style's life on the board goes, as pure functions of the board so they
 * can be tested by picture: Night's braziers on the outer corners of sealed rings, and the
 * corner of a gun's square its pile of balls lies in.
 */

/** An outer corner of a sealed ring: the wall block, and the way the corner points out. */
export interface RingCorner {
  index: number;
  x: number;
  y: number;
  dx: -1 | 1;
  dy: -1 | 1;
  /** Whose ring, as the board stores it: the player's index plus one. */
  owner: number;
}

/**
 * Every outer corner of every sealed ring: a wall block with the ring running on from it
 * along both sides, its owner's sealed ground in the angle between them — or behind a
 * thicker wall there — and nothing built or held outside it. In board order.
 */
export function ringCorners(state: MatchState): RingCorner[] {
  const { width: w, height: h } = state;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  const wall = (i: number): boolean => i >= 0 && state.structure[i] === Structure.Wall;
  const held = (i: number, owner: number): boolean =>
    i >= 0 && (state.territory[i] as number) === owner;
  const corners: RingCorner[] = [];
  for (let i = 0; i < state.structure.length; i++) {
    if (state.structure[i] !== Structure.Wall) continue;
    const owner = state.owner[i] as number;
    if (owner === 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const outA = at(x + dx, y);
      const outB = at(x, y + dy);
      if (wall(outA) || wall(outB) || held(outA, owner) || held(outB, owner)) continue;
      if (!wall(at(x - dx, y)) || !wall(at(x, y - dy))) continue;
      const inner = at(x - dx, y - dy);
      const sealed = held(inner, owner) || (wall(inner) && held(at(x - 2 * dx, y - 2 * dy), owner));
      if (sealed) corners.push({ index: i, x, y, dx, dy, owner });
    }
  }
  return corners;
}

/**
 * At most `most` of `items`, spread as far apart as they go: the first, then each time the
 * one farthest from all those chosen, stopping once the farthest is nearer than `minGap`.
 */
export function spreadOut<T extends { x: number; y: number }>(
  items: readonly T[],
  most: number,
  minGap: number,
): T[] {
  const first = items[0];
  if (first === undefined || most <= 0) return [];
  const chosen: T[] = [first];
  while (chosen.length < Math.min(most, items.length)) {
    let best: T | null = null;
    let bestGap = -1;
    for (const item of items) {
      const gap = Math.min(...chosen.map((o) => Math.hypot(o.x - item.x, o.y - item.y)));
      if (gap > bestGap) {
        bestGap = gap;
        best = item;
      }
    }
    if (best === null || bestGap < minGap) break;
    chosen.push(best);
  }
  return chosen;
}

/**
 * The corners of a gun's square, as fractions across it: south-east, south-west, north-west,
 * north-east.
 */
export const PILE_CORNERS = [
  [1, 1],
  [0, 1],
  [0, 0],
  [1, 0],
] as const;

/**
 * Which of `PILE_CORNERS` lies opposite a gun's sandbags facing `outward` (eight ways, 0 east,
 * clockwise as the screen runs): the diagonal straight across, or for a side the corner just
 * clockwise of straight across.
 */
export function pileCorner(outward: number): number {
  const inward = (((outward + 4) % 8) + 8) % 8;
  const diagonal = inward % 2 === 1 ? inward : (inward + 1) % 8;
  return (diagonal - 1) / 2;
}
