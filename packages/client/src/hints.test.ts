import { applyEnclosure, computeEnclosure, stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { buildHints } from './hints.js';

/** A ring around a castle with one block missing mid-edge, on the north side. */
const BREACHED = `
  ............
  .,,,,,,,,,,.
  .,###,####,.
  .,#,,,,,,#,.
  .,#,,@@,,#,.
  .,#,,@@,,#,.
  .,#,,,,,,#,.
  .,########,.
  .,,,,,,,,,,.
  ............
`;

function building(art: string) {
  const state = stateFromAscii(art);
  applyEnclosure(state);
  state.phase = 'build';
  return state;
}

describe('build hints', () => {
  it('outlines the castles of a player with nothing sealed', () => {
    const state = building(BREACHED);
    expect(buildHints(state, 0, computeEnclosure(state)).unsealed).toHaveLength(1);
  });

  it('says nothing once a castle is sealed', () => {
    const state = building(BREACHED.replace('.,###,####,.', '.,########,.'));
    expect(buildHints(state, 0, computeEnclosure(state))).toEqual({ unsealed: [], cornerGaps: [] });
  });

  it('says nothing outside the build phase', () => {
    const state = building(BREACHED);
    state.phase = 'combat';
    expect(buildHints(state, 0, computeEnclosure(state)).unsealed).toEqual([]);
  });

  /** Two castles: the left sealed, the right's ring missing its south-east corner block. */
  const SECOND = `
    ..................
    .,,,,,,,,,,,,,,,,.
    .,######,,######,.
    .,#,,,,#,,#,,,,#,.
    .,#,@@,#,,#,@@,#,.
    .,#,@@,#,,#,@@,#,.
    .,#,,,,#,,#,,,,#,.
    .,######,,#####,,.
    .,,,,,,,,,,,,,,,,.
    ..................
  `;

  it("pings a castle's corner gap while another castle is sealed", () => {
    const state = building(SECOND);
    const hints = buildHints(state, 0, computeEnclosure(state));
    expect(hints.unsealed).toEqual([]);
    expect(hints.cornerGaps.map(({ x, y }) => [x, y])).toEqual([[15, 7]]);
  });

  it('pings nothing outside the build phase', () => {
    const state = building(SECOND);
    state.phase = 'cannon_place';
    expect(buildHints(state, 0, computeEnclosure(state)).cornerGaps).toEqual([]);
  });
});
