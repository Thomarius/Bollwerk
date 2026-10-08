import { describe, expect, it } from 'vitest';

import { TITLE_AT_REST, titleGlide, titleTurn, type TitleFrame } from './decor.js';
import { TITLE_LETTERS_PX, neonTubes, titleLayout, type Title, type Tube } from './titles.js';

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

describe('the title gliding', () => {
  const pass = 6000;
  /** Which look a row of the letters shows, 0 at their top and 1 at their foot. */
  const lookAt = (frame: TitleFrame, row: number): string =>
    row < frame.split ? frame.upper : frame.upper === 'build' ? 'combat' : 'build';
  const rows = Array.from({ length: 41 }, (_, k) => k / 40);

  it('starts where the title rests, split through the middle with building above', () => {
    expect(titleGlide(0, pass)).toEqual(TITLE_AT_REST);
    expect(TITLE_AT_REST).toEqual({ split: 0.5, upper: 'build' });
  });

  it('moves the line at one speed, never pausing', () => {
    let last = titleGlide(0, pass).split;
    const steps = new Set<number>();
    for (let ms = 10; ms < 4 * pass; ms += 10) {
      const { split } = titleGlide(ms, pass);
      // Down, or round from the foot to the head out of sight: never still.
      if (split > last) steps.add(Math.round((split - last) * 1e6));
      else expect(last).toBeGreaterThan(1);
      last = split;
    }
    expect(steps.size).toBe(1);
  });

  it('changes a row only as the line passes it, so the word never jumps', () => {
    for (let ms = 0; ms < 3 * pass; ms += 5) {
      const a = titleGlide(ms, pass);
      const b = titleGlide(ms + 5, pass);
      for (const row of rows) {
        if (lookAt(a, row) === lookAt(b, row)) continue;
        // The line came down across this row between the two frames.
        expect(b.split).toBeGreaterThanOrEqual(row);
        expect(a.split).toBeLessThanOrEqual(row);
      }
    }
  });

  it('shows the whole word in each look by turns', () => {
    const whole = (look: string): boolean =>
      Array.from({ length: (2 * pass) / 10 }, (_, k) => titleGlide(k * 10, pass)).some((frame) =>
        rows.every((row) => lookAt(frame, row) === look),
      );
    expect(whole('combat')).toBe(true);
    expect(whole('build')).toBe(true);
  });
});

describe('the title rotating its random halves', () => {
  const pass = 1000;

  it('turns a half at the start of every pass, while it is out of sight, by turns', () => {
    const turns: string[] = [];
    let before = 0;
    for (let ms = 1; ms <= 4 * pass; ms++) {
      const look = titleTurn(before, ms, pass);
      if (look !== null) {
        turns.push(look);
        // The half the coming pass brings is wholly hidden: the word is all the other.
        const { split, upper } = titleGlide(ms, pass);
        expect(upper).toBe(look);
        expect(split).toBeLessThanOrEqual(0);
      }
      before = ms;
    }
    expect(turns).toEqual(['combat', 'build', 'combat', 'build']);
  });

  it('turns a half even when a frame skips past the moment', () => {
    expect(titleTurn(0, 2 * pass, pass)).not.toBeNull();
    expect(titleTurn(0, 10, pass)).toBeNull();
  });
});
