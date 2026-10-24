import { Structure, computeEnclosure, stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { cornerGaps } from './cornerGaps.js';

describe('corner gaps', () => {
  it('marks a ring missing its corner block at the corner its neighbours share', () => {
    const state = stateFromAscii(`
      ..........
      .,,,,,,,,.
      .,######,.
      .,#,,,,#,.
      .,#,@@,#,.
      .,#,@@,#,.
      .,#,,,,#,.
      .,######,,
      .,,,,,,,,.
      ..........
    `);
    // The corner block at (7, 7) taken out: (6, 6) inside meets (7, 7) outside diagonally.
    state.structure[7 * state.width + 7] = 0;
    expect(cornerGaps(state, 0)).toEqual([
      { x: 7, y: 7, inside: { x: 6, y: 6 }, outside: { x: 7, y: 7 } },
    ]);
  });

  it('finds a gap staggered through a thick wall', () => {
    const state = stateFromAscii(`
      ...............
      .,,,,,,,,,,,,,.
      .,#####,#####,.
      .,######,####,.
      .,#,,,,,,,,,#,.
      .,#,,,,@@,,,#,.
      .,#,,,,@@,,,#,.
      .,###########,.
      .,,,,,,,,,,,,,.
      ...............
    `);
    expect(cornerGaps(state, 0)).toEqual([
      { x: 8, y: 3, inside: { x: 8, y: 3 }, outside: { x: 7, y: 2 } },
    ]);
  });

  it('marks a corner whose inner block is a pocket the sea reaches only diagonally', () => {
    // A thick wall missing both blocks of its top-left corner: (3, 4) floods at 4 to neither
    // the sea nor the castle, so the sea's way in there was never marked, and filling the
    // staggered gap below, the only one marked, left the castle open with nothing marked
    // (the user's play of v0.9.12).
    const state = stateFromAscii(`
      ..............
      .,,,,,,,,,,,,.
      .,,,,,,,,,,,,.
      .,,##########.
      .,#,########,.
      .,##,,,,,,##,.
      .,##,,,,,,##,.
      .,##,,@@,,##,.
      .,##,,@@,,##,.
      .,##,,,,,,##,.
      .,##,,,,,,##,.
      .,#######,##,.
      .,######,###,.
      .,,,,,,,,,,,,.
      ..............
    `);
    const gaps = cornerGaps(state, 0);
    expect(gaps).toEqual([
      { x: 4, y: 5, inside: { x: 4, y: 5 }, outside: { x: 3, y: 4 } },
      { x: 9, y: 12, inside: { x: 9, y: 11 }, outside: { x: 8, y: 12 } },
    ]);
    // One tile of each filled seals it, as the marks promise.
    for (const gap of gaps)
      state.structure[gap.inside.y * state.width + gap.inside.x] = Structure.Wall;
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(true);
  });

  it('marks nothing while a straight gap is left too', () => {
    const state = stateFromAscii(`
      ..........
      .,,,,,,,,.
      .,######,.
      .,#,,,,#,.
      .,#,@@,,,.
      .,#,@@,#,.
      .,#,,,,#,.
      .,#####,,.
      .,,,,,,,,.
      ..........
    `);
    expect(cornerGaps(state, 0)).toEqual([]);
  });

  it('marks nothing for a sealed castle, nor for another player', () => {
    const state = stateFromAscii(`
      ..........
      .,,,,,,,,.
      .,######,.
      .,#,,,,#,.
      .,#,@@,#,.
      .,#,@@,#,.
      .,#,,,,#,.
      .,######,.
      .,,,,,,,,.
      ..........
    `);
    expect(cornerGaps(state, 0)).toEqual([]);
    state.structure[7 * state.width + 7] = 0;
    expect(cornerGaps(state, 1)).toEqual([]);
  });

  it('marks a wall meeting the sea at a point', () => {
    // The ring's east side is the shore's last land, and its corner block is sea: the sea
    // there meets the inside diagonally, past the walls either side of it.
    const state = stateFromAscii(`
      .........
      .,,,,,,,.
      .,######.
      .,#,,,,#.
      .,#,@@,#.
      .,#,@@,#.
      .,######.
      .,,,,,,,.
      .........
    `);
    state.structure[2 * state.width + 7] = 0;
    state.terrain[2 * state.width + 7] = 0;
    state.islandId[2 * state.width + 7] = 0;
    const gaps = cornerGaps(state, 0);
    expect(gaps).toContainEqual({ x: 7, y: 3, inside: { x: 6, y: 3 }, outside: { x: 7, y: 2 } });
  });
});

describe("the preview's board", () => {
  it('marks the corner of the left ring and the stagger of the middle, not the right', async () => {
    const { gapState } = await import('./gapPreview.js');
    const gaps = cornerGaps(gapState(), 0).map(({ x, y }) => [x, y]);
    expect(gaps).toEqual([
      [20, 3],
      [9, 7],
    ]);
  });
});
