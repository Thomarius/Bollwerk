import {
  NEIGHBOURS_4,
  NEIGHBOURS_8,
  Structure,
  computeEnclosure,
  type MatchState,
} from '@bollwerk/sim';

/**
 * Corner gaps: the leaks a player cannot see. The escape flood is 8-connected while a wall
 * is not, so the sea slips between two wall blocks that touch only at a corner — a ring
 * missing its corner block, or a thick wall whose two rows are holed one column apart.
 *
 * A castle has only corner gaps left when it would be sealed by a 4-connected flood but is
 * not by the real one. Every leak of its ground is then a diagonal step through a 2×2
 * window with wall on one diagonal and open tiles on the other: one inside, and one the sea
 * reaches without crossing the castle's ground. Had either side tile been open, it would
 * join the two orthogonally and the castle would not be sealed at 4. So the windows found
 * here are all of them, and filling one open tile of each seals it.
 *
 * The sea's side is not the 4-connected flood's outside: between two corner gaps there may
 * lie ground that floods at 4 to neither — a thick wall missing both blocks of a corner
 * leaves the inner one a pocket, reached from the sea only diagonally. Marked against the
 * 4-connected outside, that corner was never marked, so filling the gaps that were left the
 * castle open with nothing marked (2026-10-24, the user's play of v0.9.12). Marked at the pinch point — the corner the two walls share — since either tile
 * closes it, and a tile marked reads as the one right repair (ARCHIVE 10t, the leak marks
 * taken out after the first human play).
 */
export interface CornerGap {
  /** The pinch point, a tile corner: the top-left corner of tile (`x`, `y`). */
  x: number;
  y: number;
  /** The open tile on the castle's side and the one the sea comes from. */
  inside: { x: number; y: number };
  outside: { x: number; y: number };
}

/** The corner gaps of `player`'s castles that have no other gaps left, on their own island. */
export function cornerGaps(
  state: MatchState,
  player: number,
  /** Which castles are sealed as the board stands, when the caller has it. */
  real: readonly boolean[] = computeEnclosure(state).castleEnclosed,
): CornerGap[] {
  const owner = state.players[player];
  if (owner === undefined) return [];
  const { width: w, height: h, structure } = state;
  // Nothing to look for while every castle is sealed, the common case at a placement.
  if (!state.castles.some((c) => c.islandId === owner.islandId && real[c.id] !== true)) return [];
  const four = computeEnclosure({
    ...state,
    ruleset: {
      ...state.ruleset,
      enclosure: { ...state.ruleset.enclosure, connectivity: 4 },
    },
  });
  const fourOutside = four.outside;

  // The ground of each castle sealed at 4 but not at 8, flooded as the 4-connected flood
  // left it.
  const inside = new Uint8Array(w * h);
  const queue: number[] = [];
  for (const castle of state.castles) {
    if (castle.islandId !== owner.islandId) continue;
    if (real[castle.id] === true || four.castleEnclosed[castle.id] !== true) continue;
    const start = castle.y * w + castle.x;
    if (inside[start] === 1) continue;
    inside[start] = 1;
    queue.push(start);
  }
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBOURS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (inside[ni] === 1 || fourOutside[ni] === 1 || structure[ni] === Structure.Wall) continue;
      inside[ni] = 1;
      queue.push(ni);
    }
  }

  // Where the sea gets to, by the real 8-connected flood, without entering that ground.
  const outside = new Uint8Array(w * h);
  const blocked = (i: number): boolean =>
    outside[i] === 1 || inside[i] === 1 || structure[i] === Structure.Wall;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) if (!blocked(y * w + x)) queue.push(y * w + x);
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) if (!blocked(y * w + x)) queue.push(y * w + x);
  }
  for (const i of queue) outside[i] = 1;
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blocked(ni)) continue;
      outside[ni] = 1;
      queue.push(ni);
    }
  }

  const gaps: CornerGap[] = [];
  const wall = (x: number, y: number): boolean => structure[y * w + x] === Structure.Wall;
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      // The window's two diagonals: a, b its top-left and bottom-right, c, d the others.
      for (const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] of [
        [
          [x, y],
          [x + 1, y + 1],
          [x + 1, y],
          [x, y + 1],
        ],
        [
          [x + 1, y],
          [x, y + 1],
          [x, y],
          [x + 1, y + 1],
        ],
      ] as const) {
        // Open on one diagonal, wall on the other.
        if (wall(ax, ay) || wall(bx, by) || !wall(cx, cy) || !wall(dx, dy)) continue;
        const a = ay * w + ax;
        const b = by * w + bx;
        const leak =
          inside[a] === 1 && outside[b] === 1
            ? { inside: { x: ax, y: ay }, outside: { x: bx, y: by } }
            : inside[b] === 1 && outside[a] === 1
              ? { inside: { x: bx, y: by }, outside: { x: ax, y: ay } }
              : null;
        if (leak !== null) gaps.push({ x: x + 1, y: y + 1, ...leak });
      }
    }
  }
  return gaps;
}
