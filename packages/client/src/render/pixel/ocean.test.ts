import { stateFromAscii } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import type { ViewTransform } from '../theme.js';

import { outerOcean } from './ocean.js';

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
