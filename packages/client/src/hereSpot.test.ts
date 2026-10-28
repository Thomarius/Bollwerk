import { stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { hereSpot } from './hereSpot.js';

describe('where "You are here" points', () => {
  // A castle on the island's middle, as the label once covered one.
  const state = stateFromAscii(`
    ..............
    .,,,,,,,,,,,,.
    .,,,,,,,,,,,,.
    .,,,,,,,,,,,,.
    .,,,,,@@,,,,,.
    .,,,,,@@,,,,,.
    .,,,,,,,,,,,,.
    .,,,,,,,,,,,,.
    .,,,,,,,,,,,,.
    ..............
  `);
  const centre = { x: 6, y: 4 };
  const box = { w: 4, h: 1.5 };

  it('keeps the label, hung above its arrow, off every castle', () => {
    const spot = hereSpot(state, 1, centre, box);
    for (const c of state.castles) {
      const apart =
        spot.x + box.w / 2 <= c.x ||
        spot.x - box.w / 2 >= c.x + c.w ||
        spot.y <= c.y ||
        spot.y - box.h >= c.y + c.h;
      expect(apart).toBe(true);
    }
    // Pointing at the island's land, and near its middle: just over or under the castle.
    expect(Math.abs(spot.x - 6.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(spot.y - 4.5)).toBeLessThanOrEqual(3);
  });

  it('stays at the middle when no castle is in the way', () => {
    const open = stateFromAscii(`
      ......
      .,,,,.
      .,,,,.
      ......
    `);
    expect(hereSpot(open, 1, { x: 2, y: 1 }, box)).toEqual({ x: 2.5, y: 1.5 });
  });

  it('falls back on the middle when nowhere is clear', () => {
    expect(hereSpot(state, 1, centre, { w: 40, h: 40 })).toEqual({ x: 6.5, y: 4.5 });
  });
});
