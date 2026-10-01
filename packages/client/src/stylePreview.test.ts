import { computeEnclosure } from '@rampart/sim';
import { describe, expect, it } from 'vitest';

import { previewState } from './stylePreview.js';

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
