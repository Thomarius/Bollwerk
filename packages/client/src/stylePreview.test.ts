import { computeEnclosure } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { roseSpot } from './render/corner.js';
import { cornerState, previewState } from './stylePreview.js';
import { timerSpot } from './timerSpot.js';

describe('the island each style is previewed on', () => {
  const state = previewState();
  const enclosure = computeEnclosure(state);

  it('seals the crowned main castle with both guns, and leaves the other outside', () => {
    expect(state.players[0]?.startingCastleId).toBe(0);
    expect(enclosure.castleEnclosed).toEqual([true, false]);
    expect(state.cannons).toHaveLength(2);
    expect(enclosure.cannonActive).toEqual([true, true]);
  });

  it('is clear weather at noon, so every style shows plainly', () => {
    expect(state.seed).toBe(5);
    expect(state.round).toBe(5);
  });
});

describe('the open sea each style’s corner piece is pictured on', () => {
  it('has room for the largest piece in its bottom-right corner, clear of the timer', () => {
    const state = cornerState();
    const timer = timerSpot(state);
    const spot = roseSpot(state, 0, 0, timer);
    expect(spot?.size).toBe(4);
    // In the corner the island is not in.
    expect(spot!.x).toBeGreaterThan(state.width / 2);
    expect(spot!.y).toBeGreaterThan(state.height / 2);
  });
});
