import { describe, expect, it } from 'vitest';

import {
  TITLE_AT_REST,
  TITLE_LETTERS_PX,
  neonTubes,
  titleLayout,
  titleSweep,
  type Title,
  type TitleFrame,
  type Tube,
} from './decor.js';

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

describe('the title sweep', () => {
  const span = 2600;
  /** Which look a row of the letters shows, 0 at their top and 1 at their foot. */
  const lookAt = (frame: TitleFrame, row: number): string =>
    row < frame.split ? frame.upper : frame.upper === 'build' ? 'combat' : 'build';
  const rows = Array.from({ length: 41 }, (_, k) => k / 40);

  it('starts and ends at rest, split through the middle with building above', () => {
    expect(titleSweep(0, span)).toEqual(TITLE_AT_REST);
    expect(titleSweep(span, span)).toEqual(TITLE_AT_REST);
    expect(TITLE_AT_REST).toEqual({ split: 0.5, upper: 'build' });
  });

  it('changes a row only as the line passes it, so the word never jumps', () => {
    for (let ms = 0; ms < span; ms += 5) {
      const a = titleSweep(ms, span);
      const b = titleSweep(ms + 5, span);
      const lo = Math.min(a.split, b.split);
      const hi = Math.max(a.split, b.split);
      for (const row of rows) {
        if (lookAt(a, row) !== lookAt(b, row)) {
          expect(row).toBeGreaterThanOrEqual(lo);
          expect(row).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('shows the whole word in combat once, as a banner brings it', () => {
    const allCombat = Array.from({ length: span / 10 }, (_, k) => titleSweep(k * 10, span)).some(
      (frame) => rows.every((row) => lookAt(frame, row) === 'combat'),
    );
    expect(allCombat).toBe(true);
  });
});
