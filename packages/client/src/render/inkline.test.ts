import { describe, expect, it } from 'vitest';

import { along, loops, rounded, wavered, type Point } from './inkline.js';
import type { Segment } from './walls.js';

/** The tile-edge outline of a set of tiles, one unit a tile, as `outline` draws it. */
function edges(cells: readonly [number, number][]): Segment[] {
  const has = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);
  const out: Segment[] = [];
  for (const [x, y] of cells) {
    if (!has(x, y - 1)) out.push({ x1: x, y1: y, x2: x + 1, y2: y });
    if (!has(x, y + 1)) out.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
    if (!has(x - 1, y)) out.push({ x1: x, y1: y, x2: x, y2: y + 1 });
    if (!has(x + 1, y)) out.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
  }
  return out;
}

/** Whether a point lies inside one of the tiles. */
function within(cells: readonly [number, number][]) {
  return (x: number, y: number) =>
    cells.some(([cx, cy]) => x > cx && x < cx + 1 && y > cy && y < cy + 1);
}

function area(loop: readonly Point[]): number {
  let sum = 0;
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length] as Point;
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

describe('a line drawn by hand over the grid', () => {
  it('joins an outline into one loop, its straight runs merged to corners', () => {
    // An L of three tiles: six corners.
    const ell: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const [loop, ...rest] = loops(edges(ell), within(ell));
    expect(rest).toHaveLength(0);
    expect(loop).toHaveLength(6);
    expect(area(loop as Point[])).toBeCloseTo(3);
  });

  it('keeps two tiles touching only at a corner as two loops', () => {
    const pinch: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    const found = loops(edges(pinch), within(pinch));
    expect(found).toHaveLength(2);
    for (const loop of found) expect(area(loop)).toBeCloseTo(1);
  });

  it('rounds a staircase without moving it far from the grid', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const soft = rounded(square, 2);
    expect(soft).toHaveLength(16);
    // A corner is cut, but the area stays most of the square's.
    expect(area(soft)).toBeGreaterThan(13);
    expect(area(soft)).toBeLessThan(16);
  });

  it('wavers across its course alone, the same every time', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const once = wavered(line, 1, () => 1);
    expect(once).toEqual(wavered(line, 1, () => 1));
    expect(Math.abs((once[1] as Point).x - 10) + Math.abs((once[1] as Point).y)).toBeCloseTo(
      Math.SQRT2,
    );
  });

  it('marks points evenly along a loop', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(along(square, 1)).toHaveLength(16);
  });
});
