import { describe, expect, it } from 'vitest';

import { isMotionReduced, parseMotion } from './motion.js';

describe('the motion setting', () => {
  it('reduces motion when chosen, or when the system asks, and only then', () => {
    expect(isMotionReduced('full', false)).toBe(false);
    expect(isMotionReduced('reduced', false)).toBe(true);
    expect(isMotionReduced('full', true)).toBe(true);
  });

  it('reads only its own two values', () => {
    expect(parseMotion('reduced')).toBe('reduced');
    expect(parseMotion('full')).toBe('full');
    expect(parseMotion('high')).toBeNull();
    expect(parseMotion(null)).toBeNull();
  });
});
