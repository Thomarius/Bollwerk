import { describe, expect, it } from 'vitest';

import { pauseText } from './pause.js';

describe('the pause overlay', () => {
  const names = ['Ada', 'Bo', 'Cy'];

  it('names whoever paused', () => {
    expect(pauseText(1, 0, names)).toBe('Bo paused the match');
  });

  it('speaks to the viewer who paused it themselves, or who is watching a local match', () => {
    expect(pauseText(0, 0, names)).toBe('You paused the match');
    // A local match being watched pauses as nobody's seat.
    expect(pauseText(-1, -1, names)).toBe('You paused the match');
  });

  it('still says something for a player it has no name for', () => {
    expect(pauseText(7, 0, names)).toBe('The match is paused');
  });
});
