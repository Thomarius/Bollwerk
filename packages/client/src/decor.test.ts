import { describe, expect, it } from 'vitest';

import { TITLE_LETTERS_PX, neonTubes, titleLayout, type Title, type Tube } from './decor.js';

const diagonal = (t: Tube): boolean => t.x1 !== t.x2 && t.y1 !== t.y2;

describe('the neon title', () => {
  it('bends a tube along every stroke of a T, and nowhere else', () => {
    const tubes = neonTubes(['#####', '..#..', '..#..']);
    expect(tubes).toHaveLength(4 + 2);
    expect(tubes.filter(diagonal)).toEqual([]);
  });

  it('runs a diagonal only where cells meet at a corner alone, as in an M', () => {
    const m = ['#...#', '##.##', '#.#.#'];
    expect(neonTubes(m).filter(diagonal)).toEqual([
      { x1: 1, y1: 1, x2: 2, y2: 2 },
      { x1: 3, y1: 1, x2: 2, y2: 2 },
    ]);
    // A square block is four straight runs, not crossed by diagonals.
    expect(neonTubes(['##', '##']).filter(diagonal)).toEqual([]);
  });

  it('lights a cell touching nothing as a dot', () => {
    expect(neonTubes(['#.', '..'])).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 0 }]);
  });
});

describe('title layout', () => {
  const title = (cellPx: number, padPx: number, tailPx: number): Title => ({
    src: '',
    cellPx,
    padPx,
    tailPx,
    smooth: false,
    flicker: false,
  });

  it('shows the stone title as it always was: 60 pixels, no margin', () => {
    expect(titleLayout(title(4, 0, 2))).toEqual({ height: 60, margin: 0 });
  });

  it("gives back a glow's padding, so the letters stand where the stone ones do", () => {
    // Cyberpunk's sign: 12 pixels a cell, 14 of glow round it.
    const { height, margin } = titleLayout(title(12, 14, 0));
    const scale = TITLE_LETTERS_PX / (7 * 12);
    expect(height + 2 * margin).toBeCloseTo(TITLE_LETTERS_PX);
    expect(margin).toBeCloseTo(-14 * scale);
  });
});
