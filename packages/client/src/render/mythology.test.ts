import { describe, expect, it } from 'vitest';

import { ARM_FIRED, ARM_READY } from './mythology/drawings.js';

describe('the Mythology style', () => {
  it('swings an onager’s arm back over the top as it reloads, never down through the ground', () => {
    // Loaded, the arm lies back (to the left, a little up); fired, it stands up at the crossbar.
    expect(Math.cos(ARM_READY)).toBeLessThan(-0.9);
    expect(Math.sin(ARM_READY)).toBeLessThan(0);
    expect(Math.sin(ARM_FIRED)).toBeLessThan(-0.9);
    // Every angle the reload passes through points upwards, the screen's y being down.
    for (let k = 0; k <= 1; k += 0.05) {
      expect(Math.sin(ARM_FIRED + (ARM_READY - ARM_FIRED) * k)).toBeLessThan(0);
    }
  });
});
