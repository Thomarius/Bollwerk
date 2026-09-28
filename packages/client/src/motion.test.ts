import { describe, expect, it } from 'vitest';

import { isMotionReduced } from './motion.js';

describe('the effects setting', () => {
  it('reduces motion when chosen, or when the system asks, and only then', () => {
    expect(isMotionReduced('full', false)).toBe(false);
    expect(isMotionReduced('reduced', false)).toBe(true);
    expect(isMotionReduced('full', true)).toBe(true);
    // High is full motion with bloom on top, not less motion.
    expect(isMotionReduced('high', false)).toBe(false);
  });
});
