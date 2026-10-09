import type { Segment } from './walls.js';

/**
 * Lines drawn by hand over the tile grid: a coast or a contour traced along tile edges,
 * joined into closed loops, its staircase rounded off and its course wavering a little,
 * as a pen follows a coast rather than a grid (S2, Parchment). Pure, so it is tested.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Tile-edge segments joined end to end into closed loops. Each loop is walked with
 * `inside` — land, for a coast — on its left, turning towards it wherever there is a
 * choice, so where two loops touch at a corner (land meeting land only diagonally) the
 * walk keeps to its own and each loop stays one simple outline.
 */
export function loops(
  segments: readonly Segment[],
  inside: (x: number, y: number) => boolean,
): Point[][] {
  const key = (x: number, y: number): string => `${Math.round(x * 64)},${Math.round(y * 64)}`;
  const at = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const k of [key(s.x1, s.y1), key(s.x2, s.y2)]) {
      const list = at.get(k);
      if (list === undefined) at.set(k, [i]);
      else list.push(i);
    }
  });
  const used = new Uint8Array(segments.length);
  const out: Point[][] = [];
  for (let first = 0; first < segments.length; first++) {
    if (used[first] === 1) continue;
    used[first] = 1;
    const s = segments[first] as Segment;
    // Started with the inside on its left — a quarter of its length that way, which on a
    // y-down screen is (dy, -dx) — so every turn towards it is the most negative one.
    const leftX = (s.x1 + s.x2) / 2 + (s.y2 - s.y1) * 0.25;
    const leftY = (s.y1 + s.y2) / 2 - (s.x2 - s.x1) * 0.25;
    const loop: Point[] = inside(leftX, leftY)
      ? [
          { x: s.x1, y: s.y1 },
          { x: s.x2, y: s.y2 },
        ]
      : [
          { x: s.x2, y: s.y2 },
          { x: s.x1, y: s.y1 },
        ];
    for (;;) {
      const end = loop[loop.length - 1] as Point;
      const before = loop[loop.length - 2] as Point;
      const heading = Math.atan2(end.y - before.y, end.x - before.x);
      // Of the unused segments here, the one turning furthest towards the inside: at a
      // pinch, round the corner of its own land rather than across into the other's.
      let best = -1;
      let bestTurn = Infinity;
      let bestTo: Point | null = null;
      for (const i of at.get(key(end.x, end.y)) ?? []) {
        if (used[i] === 1) continue;
        const c = segments[i] as Segment;
        const forward = key(c.x1, c.y1) === key(end.x, end.y);
        const to = forward ? { x: c.x2, y: c.y2 } : { x: c.x1, y: c.y1 };
        let turn = Math.atan2(to.y - end.y, to.x - end.x) - heading;
        while (turn <= -Math.PI) turn += Math.PI * 2;
        while (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < bestTurn) {
          bestTurn = turn;
          best = i;
          bestTo = to;
        }
      }
      if (best < 0 || bestTo === null) break;
      used[best] = 1;
      const start = loop[0] as Point;
      if (key(bestTo.x, bestTo.y) === key(start.x, start.y)) break;
      loop.push(bestTo);
    }
    out.push(merged(loop));
  }
  return out;
}

/** A loop with its straight runs one stretch each, so smoothing rounds corners only. */
function merged(loop: readonly Point[]): Point[] {
  const out: Point[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n] as Point;
    const b = loop[i] as Point;
    const c = loop[(i + 1) % n] as Point;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : [...loop];
}

/**
 * A closed loop's corners cut (Chaikin's method), `passes` times: each pass cuts a quarter
 * off both ends of every stretch, so a staircase of whole tiles becomes a slope and a
 * corner a curve. The line moves at most a few tenths of a tile off the grid.
 */
export function rounded(loop: readonly Point[], passes = 2): Point[] {
  let points = [...loop];
  for (let pass = 0; pass < passes; pass++) {
    const next: Point[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[i] as Point;
      const b = points[(i + 1) % n] as Point;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    points = next;
  }
  return points;
}

/**
 * A loop with every point pushed a little across its course by `wobble(x, y)`, from -1
 * to 1, times `amount` pixels: the hand's waver, the same every time for the same map.
 */
export function wavered(
  loop: readonly Point[],
  amount: number,
  wobble: (x: number, y: number) => number,
): Point[] {
  const n = loop.length;
  return loop.map((p, i) => {
    const a = loop[(i - 1 + n) % n] as Point;
    const b = loop[(i + 1) % n] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const push = wobble(p.x, p.y) * amount;
    return { x: p.x - (dy / length) * push, y: p.y + (dx / length) * push };
  });
}

/** Points every `spacing` pixels along a closed loop, each with its direction of travel. */
export function along(
  loop: readonly Point[],
  spacing: number,
): { x: number; y: number; dx: number; dy: number }[] {
  const out: { x: number; y: number; dx: number; dy: number }[] = [];
  let carry = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i] as Point;
    const b = loop[(i + 1) % n] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    let d = carry;
    for (; d < length; d += spacing) out.push({ x: a.x + dx * d, y: a.y + dy * d, dx, dy });
    carry = d - length;
  }
  return out;
}
