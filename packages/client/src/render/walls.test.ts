import { describe, expect, it } from 'vitest';

import type { ViewTransform } from './theme.js';
import { dashed, hatch, outline, wallGeometry, type Segment } from './walls.js';

const view: ViewTransform = { tile: 10, originX: 0, originY: 0 };
/** Faces of three tenths of a tile, so they are 3 pixels at this view. */
const FACE = 0.3;

function cellsOf(picture: string): {
  cells: { x: number; y: number }[];
  has: (x: number, y: number) => boolean;
} {
  const rows = picture
    .trim()
    .split('\n')
    .map((r) => r.trim());
  const cells: { x: number; y: number }[] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c === '#' && cells.push({ x, y })));
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  return { cells, has: (x, y) => set.has(`${x},${y}`) };
}

const sorted = (segments: Segment[]): string[] =>
  segments.map((s) => `${s.x1},${s.y1}-${s.x2},${s.y2}`).sort();

describe('wall geometry', () => {
  it('stands a straight run up: one face along its foot, the rim round its top', () => {
    const { cells, has } = cellsOf('###');
    const g = wallGeometry(cells, has, view, FACE);
    expect(g.faces).toHaveLength(3);
    expect(g.blocks.every((b) => b.faced && b.lip === 7)).toBe(true);
    expect(sorted(g.rim)).toEqual(
      sorted([
        // North side and lip, block by block, and the two open ends down to the lip.
        { x1: 0, y1: 0, x2: 10, y2: 0 },
        { x1: 10, y1: 0, x2: 20, y2: 0 },
        { x1: 20, y1: 0, x2: 30, y2: 0 },
        { x1: 0, y1: 7, x2: 10, y2: 7 },
        { x1: 10, y1: 7, x2: 20, y2: 7 },
        { x1: 20, y1: 7, x2: 30, y2: 7 },
        { x1: 0, y1: 0, x2: 0, y2: 7 },
        { x1: 30, y1: 0, x2: 30, y2: 7 },
      ]),
    );
    // The face's ends close only at the ends of the run.
    expect(g.faceEdges.filter((s) => s.x1 === s.x2).map((s) => s.x1)).toEqual([0, 30]);
  });

  it('shows no face on a block with wall to its south', () => {
    const { cells, has } = cellsOf(`
      #
      #
    `);
    const g = wallGeometry(cells, has, view, FACE);
    expect(g.blocks.map((b) => b.faced)).toEqual([false, true]);
    expect(g.faces).toEqual([{ x: 0, y: 17, w: 10, h: 3 }]);
  });

  it("draws the rim down a shared side where the neighbour's face meets its top", () => {
    // The corner block has wall below it; its neighbour to the east does not, so the
    // neighbour's face stands against the corner's top.
    const { cells, has } = cellsOf(`
      ##
      #.
    `);
    const g = wallGeometry(cells, has, view, FACE);
    expect(sorted(g.rim)).toContain('10,7-10,10');
  });
});

describe('hatching', () => {
  it('keeps every line inside its rectangle', () => {
    for (const direction of ['/', '\\'] as const) {
      for (const s of hatch({ x: 3, y: 5, w: 17, h: 9 }, 4, direction)) {
        for (const [x, y] of [
          [s.x1, s.y1],
          [s.x2, s.y2],
        ] as const) {
          expect(x).toBeGreaterThanOrEqual(3 - 1e-9);
          expect(x).toBeLessThanOrEqual(20 + 1e-9);
          expect(y).toBeGreaterThanOrEqual(5 - 1e-9);
          expect(y).toBeLessThanOrEqual(14 + 1e-9);
        }
        expect(Math.abs(s.x2 - s.x1)).toBeCloseTo(Math.abs(s.y2 - s.y1));
      }
    }
  });

  it('runs on unbroken from one rectangle into the next', () => {
    // Two tiles side by side hatch like the one rectangle over both.
    const a = hatch({ x: 0, y: 0, w: 10, h: 10 }, 5, '/');
    const b = hatch({ x: 10, y: 0, w: 10, h: 10 }, 5, '/');
    const ends = new Set(a.map((s) => `${s.x2},${s.y2}`));
    // Through the shared side, not its corners, where a line only touches the first tile.
    const starts = b
      .filter((s) => s.x1 === 10 && s.y1 > 0 && s.y1 < 10)
      .map((s) => `${s.x1},${s.y1}`);
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) expect(ends.has(start)).toBe(true);
  });
});

describe('dashes and outlines', () => {
  it('breaks a line into dashes of the asked length', () => {
    const dashes = dashed({ x1: 0, y1: 0, x2: 10, y2: 0 }, 2, 2);
    expect(dashes.map((d) => [d.x1, d.x2])).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ]);
  });

  it('outlines only the outside of a set of tiles', () => {
    const { cells, has } = cellsOf('##');
    expect(outline(cells, has, view)).toHaveLength(6);
  });
});
