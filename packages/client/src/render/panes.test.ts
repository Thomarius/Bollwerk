import { describe, expect, it } from 'vitest';

import { paneOf, paneShade } from './panes.js';

describe('the panes stained glass cuts land and sea into', () => {
  // A field 40 tiles wide, land in its left half.
  const W = 40;
  const H = 30;
  const isLand = (x: number): boolean => x < 20;
  const panes = new Map<number, { x: number; y: number }[]>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pane = paneOf(x, y, isLand(x), 2.6);
      panes.set(pane, [...(panes.get(pane) ?? []), { x, y }]);
    }
  }

  it('never crosses the coast: every pane is land or sea alone', () => {
    for (const tiles of panes.values()) {
      expect(new Set(tiles.map((t) => isLand(t.x))).size).toBe(1);
    }
  });

  it('is a few tiles each, larger than a tile on average and no great sheet', () => {
    const sizes = [...panes.values()].map((t) => t.length);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(12);
    expect(Math.max(...sizes)).toBeLessThan(30);
  });

  it('cuts the same panes every time, and shades them apart', () => {
    expect(paneOf(7, 11, true, 2.6)).toBe(paneOf(7, 11, true, 2.6));
    const shades = new Set([...panes.keys()].map((p) => Math.round(paneShade(p) * 10)));
    expect(shades.size).toBeGreaterThan(5);
  });
});
