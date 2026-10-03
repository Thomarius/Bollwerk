import { describe, expect, it } from 'vitest';

import { rakeLines } from './sakura.js';
import type { Cell, ViewTransform } from './theme.js';
import type { Segment } from './walls.js';

const VIEW: ViewTransform = { tile: 1, originX: 0, originY: 0, width: 100, height: 100, top: 0 };

/** The cells of an ASCII picture marked `#`, and a test of membership. */
function region(picture: string): { cells: Cell[]; inside: (x: number, y: number) => boolean } {
  const rows = picture.trim().split('\n');
  const cells: Cell[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') cells.push({ x, y });
  });
  return {
    cells,
    inside: (x, y) => rows[y]?.[x] === '#',
  };
}

const length = (segs: readonly Segment[]): number =>
  segs.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);

/** Every end meets another end: the lines close into rings, with no stubs or overhangs. */
function closed(segs: readonly Segment[]): boolean {
  const ends = new Map<string, number>();
  const key = (x: number, y: number): string => `${x.toFixed(6)},${y.toFixed(6)}`;
  for (const s of segs) {
    for (const k of [key(s.x1, s.y1), key(s.x2, s.y2)]) ends.set(k, (ends.get(k) ?? 0) + 1);
  }
  return [...ends.values()].every((n) => n % 2 === 0);
}

describe('the raked gravel', () => {
  it('rakes a square in rings that follow its edge', () => {
    const { cells, inside } = region(`
####
####
####
####`);
    const lines = rakeLines(cells, inside, VIEW, 2);
    expect(closed(lines)).toBe(true);
    // Rings at a quarter and three quarters in from each tile ring's edge: squares of side
    // 3.5, 2.5, 1.5 and 0.5.
    expect(length(lines)).toBeCloseTo(4 * (3.5 + 2.5 + 1.5 + 0.5));
  });

  it('rakes round a stone left out of the middle, and turns the inside corners', () => {
    const { cells, inside } = region(`
######
######
##..##
##..##
######
######`);
    const lines = rakeLines(cells, inside, VIEW, 1);
    expect(closed(lines)).toBe(true);
    // Round the outside at half a tile in, round the stone at half a tile out from it.
    expect(length(lines)).toBeCloseTo(4 * 5 + 4 * 3);
  });

  it('closes its rings round an L, where one corner turns inward', () => {
    const { cells, inside } = region(`
####
####
##..
##..`);
    const lines = rakeLines(cells, inside, VIEW, 1);
    expect(closed(lines)).toBe(true);
    // The outer ring at half a tile in: an L of 3 by 3 with its notch, perimeter 12.
    expect(length(lines)).toBeCloseTo(12);
  });
});
