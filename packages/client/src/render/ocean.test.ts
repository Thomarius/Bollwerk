import { stateFromAscii } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import type { ViewTransform } from './theme.js';

import { Circling, Crossings, NO_OCEAN, Surfacings, outerOcean } from './ocean.js';

describe('the outer ocean, where sea life is kept', () => {
  // Two islands with a channel between them, in a map drawn at 10 pixels a tile with
  // three tiles of sea round it on screen and the top two under the HUD bar.
  const state = stateFromAscii(`
    ..........
    .,,,..,,,.
    .,,,..,,,.
    ..........
  `);
  const view: ViewTransform = {
    tile: 10,
    originX: 30,
    originY: 30,
    width: 160,
    height: 100,
    top: 20,
  };
  const ocean = outerOcean(state, view);

  it('keeps out of the box round the land and the tile beside it — the channel included', () => {
    expect(ocean.cells.length).toBeGreaterThan(0);
    for (const { x, y } of ocean.cells) {
      const inBox = x >= 0 && x <= 9 && y >= 0 && y <= 3;
      expect(inBox).toBe(false);
    }
    expect(ocean.cells).not.toContainEqual({ x: 4, y: 1 });
  });

  it('stays on screen and out from under the HUD', () => {
    for (const { x, y } of ocean.cells) {
      expect(view.originX + x * view.tile).toBeGreaterThanOrEqual(0);
      expect(view.originX + (x + 1) * view.tile).toBeLessThanOrEqual(view.width);
      expect(view.originY + y * view.tile).toBeGreaterThanOrEqual(view.top);
      expect(view.originY + (y + 1) * view.tile).toBeLessThanOrEqual(view.height);
    }
  });

  it('offers boats only rows clear of the land, right across the screen', () => {
    expect(ocean.rows.length).toBeGreaterThan(0);
    for (const y of ocean.rows) expect(y < 0 || y > 3).toBe(true);
    expect(ocean.x0).toBe(-3);
    expect(ocean.x1).toBe(12);
  });
});

describe('sea life moving on the outer ocean', () => {
  const ocean = {
    rows: [-2, 6],
    x0: -3,
    x1: 12,
    y0: -3,
    cells: [
      { x: -2, y: -2 },
      { x: 11, y: 6 },
    ],
  };

  it('sends one crosser at a time along an open row, off one side and out the other', () => {
    const crossings = new Crossings();
    crossings.layout(ocean, 1000);
    let seen = 0;
    for (let ms = 0; ms < 120_000; ms += 50) {
      crossings.step(ocean, 50, 1000, 2);
      expect(crossings.items.length).toBeLessThanOrEqual(1);
      const c = crossings.items[0];
      if (c === undefined) continue;
      seen++;
      expect(ocean.rows).toContain(c.y - 0.5);
      expect(c.x).toBeGreaterThan(ocean.x0 - 4);
      expect(c.x).toBeLessThan(ocean.x1 + 4);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps a tall crosser off rows that would put its top under the HUD', () => {
    const crossings = new Crossings();
    crossings.layout(ocean, 100);
    for (let ms = 0; ms < 60_000; ms += 50) {
      crossings.step(ocean, 50, 100, 8, 2);
      for (const c of crossings.items) expect(c.y).toBe(6.5);
    }
  });

  it('keeps crossers to rows still open when the board is laid out again', () => {
    const crossings = new Crossings();
    crossings.items = [{ x: 0, y: 6.5, dir: 1 }];
    crossings.layout({ ...ocean, rows: [-2] }, 1000);
    expect(crossings.items).toEqual([]);
  });

  it('lets surfacings go under once their time is up, and sends nothing with no ocean', () => {
    const surfacings = new Surfacings();
    for (let ms = 0; ms < 10_000; ms += 100) {
      surfacings.step(ocean, 100, 500, 1500);
      for (const s of surfacings.items) expect(s.ageMs).toBeLessThan(1500);
    }
    const none = new Surfacings();
    for (let ms = 0; ms < 10_000; ms += 100) none.step(NO_OCEAN, 100, 500, 1500);
    expect(none.items).toEqual([]);
  });

  it('wheels circlers round their spot, within their radius', () => {
    const circling = new Circling();
    circling.layout(ocean, 3);
    expect(circling.items).toHaveLength(3);
    for (let k = 0; k < 50; k++) {
      circling.step(100);
      for (const c of circling.items) {
        const at = Circling.at(c);
        expect(Math.abs(at.x - c.cx)).toBeLessThanOrEqual(c.radius + 1e-9);
        expect(Math.abs(at.y - c.cy)).toBeLessThanOrEqual(c.radius * 0.6 + 1e-9);
      }
    }
  });
});
