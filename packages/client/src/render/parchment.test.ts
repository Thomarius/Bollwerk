import { stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { timerSpot } from '../timerSpot.js';

import { roseSpot } from './corner.js';

describe('where the compass rose goes', () => {
  it('takes the open water nearest the bottom-right, on open sea, clear of the timer', () => {
    // Land in the bottom-right corner pushes the rose away from it.
    const state = stateFromAscii(`
      ....................
      ....................
      ..,,................
      ..,,................
      ....................
      ....................
      ....................
      ....................
      ....................
      ....................
      ................,,,,
      ................,,,,
      ................,,,,
    `);
    const timer = timerSpot(state);
    const spot = roseSpot(state, 0, 0, timer)!;
    expect(spot.size).toBe(4);
    const x0 = spot.x - spot.size / 2;
    const y0 = spot.y - spot.size / 2;
    for (let y = y0; y < y0 + spot.size; y++) {
      for (let x = x0; x < x0 + spot.size; x++) expect(state.terrain[y * state.width + x]).toBe(0);
    }
    // A tile clear of the window's edge.
    expect(x0).toBeGreaterThanOrEqual(1);
    expect(y0 + spot.size).toBeLessThanOrEqual(state.height - 1);
    expect(x0 + spot.size).toBeLessThanOrEqual(state.width - 1);
    // Nearer the bottom-right than the middle of the map.
    expect(spot.x).toBeGreaterThan(state.width / 2);
    expect(spot.y).toBeGreaterThan(state.height / 2 - 1);
    if (timer !== null) {
      const apart =
        Math.abs(spot.x - timer.x) >= (spot.size + timer.size) / 2 ||
        Math.abs(spot.y - timer.y) >= (spot.size + timer.size) / 2;
      expect(apart).toBe(true);
    }
  });

  it('uses the sea on screen round the map, where it is open for certain', () => {
    const state = stateFromAscii(`
      ,,,,,,
      ,,,,,,
      ,,,,,,
    `);
    const spot = roseSpot(state, 6, 6, null)!;
    expect(spot.size).toBe(4);
    // Entirely beyond the map, in the margin to the bottom-right, and inside the window.
    expect(spot.x - spot.size / 2 >= state.width || spot.y - spot.size / 2 >= state.height).toBe(
      true,
    );
    expect(spot.x + spot.size / 2).toBeLessThanOrEqual(state.width + 6 - 1);
    expect(spot.y + spot.size / 2).toBeLessThanOrEqual(state.height + 6 - 1);
  });
});
