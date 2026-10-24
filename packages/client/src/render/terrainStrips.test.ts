import { stateFromAscii, type MatchState } from '@bollwerk/sim';
import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { withDrawBudget } from './islandParts.js';
import { STRIPS, TerrainStrips, whole, type TerrainPlan } from './terrainStrips.js';
import type { ViewTransform } from './theme.js';

/** Sixteen rows of one island, two to a strip. */
const board = (): MatchState => stateFromAscii(Array(16).fill('1111').join('\n'));

const view: ViewTransform = { tile: 8, originX: 0, originY: 0, width: 32, height: 128, top: 0 };

/** A plan that records which pass drew which rows, slow enough to run out any budget. */
function recording(passes = 2): {
  plans: number;
  drawn: [number, number, number][];
  plan: () => TerrainPlan;
} {
  const out = {
    plans: 0,
    drawn: [] as [number, number, number][],
    plan: (): TerrainPlan => {
      out.plans++;
      return {
        rows: [0, 16],
        passes: Array.from(
          { length: passes },
          (_, p) => (_g: Graphics, from: number, to: number) => {
            out.drawn.push([p, from, to]);
            const until = performance.now() + 1;
            while (performance.now() < until) {
              // Standing in for a strip's drawing, which takes its time.
            }
          },
        ),
      };
    },
  };
  return out;
}

describe('terrain drawn in strips', () => {
  it('draws every row once in each pass, the strips in order', () => {
    const strips = new TerrainStrips();
    const { drawn, plan } = recording();
    strips.draw(board(), view, plan);
    for (const pass of [0, 1]) {
      const rows = drawn.filter(([p]) => p === pass).map(([, from, to]) => [from, to]);
      expect(rows).toHaveLength(STRIPS);
      expect(rows[0]?.[0]).toBe(0);
      expect(rows.at(-1)?.[1]).toBe(16);
      rows.slice(1).forEach(([from], s) => expect(from).toBe(rows[s]?.[1]));
    }
  });

  it('keeps a pass a container, every strip of one before any of the next', () => {
    const strips = new TerrainStrips();
    strips.draw(board(), view, recording(3).plan);
    expect(strips.container.children).toHaveLength(3);
    for (const pass of strips.container.children) expect(pass.children).toHaveLength(STRIPS);
    // Warmed a strip at a time, with that strip of every pass.
    const pieces = strips.container.strips();
    expect(pieces).toHaveLength(STRIPS);
    expect(pieces[2]).toEqual(strips.container.children.map((pass) => pass.children[2]));
  });

  it('takes up a drawing a budget cut short where it stopped, planned once', () => {
    const strips = new TerrainStrips();
    const record = recording();
    const state = board();
    const rounds: boolean[] = [];
    for (let i = 0; i < 20 && rounds.at(-1) !== true; i++) {
      rounds.push(withDrawBudget(1, () => strips.draw(state, view, record.plan)));
    }
    expect(rounds.at(-1)).toBe(true);
    expect(rounds.length).toBeGreaterThan(1);
    expect(record.plans).toBe(1);
    // Every strip of every pass once, none twice.
    expect(record.drawn).toHaveLength(STRIPS * 2);
    expect(new Set(record.drawn.map((d) => d.join())).size).toBe(STRIPS * 2);
  });

  it('starts again for a new view, and draws a finished drawing again', () => {
    const strips = new TerrainStrips();
    const record = recording();
    const state = board();
    expect(withDrawBudget(1, () => strips.draw(state, view, record.plan))).toBe(false);
    strips.draw(state, { ...view, tile: 9 }, record.plan);
    expect(record.plans).toBe(2);
    // Finished, as a window fitted again or a new Graphics level redraws it.
    strips.draw(state, { ...view, tile: 9 }, record.plan);
    expect(record.plans).toBe(3);
  });

  it('draws a whole pass in the first strip only', () => {
    const strips = new TerrainStrips();
    let calls = 0;
    strips.draw(board(), view, () => ({ rows: [0, 16], passes: [whole(() => calls++)] }));
    expect(calls).toBe(1);
  });
});
