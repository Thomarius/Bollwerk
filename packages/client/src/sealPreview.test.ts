import { stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { sealingCells } from './sealPreview.js';

describe('the sealing preview', () => {
  // A ring round a castle, open by one tile at its east side.
  const state = stateFromAscii(`
    ..........
    .,,,,,,,,.
    .,######,.
    .,#,,,,#,.
    .,#,@@,,,.
    .,#,@@,#,.
    .,#,,,,#,.
    .,######,.
    .,,,,,,,,.
    ..........
  `);

  it('shows the ground a piece closing the gap would seal', () => {
    const gained = sealingCells(state, [[0, 0]], 7, 4);
    expect(gained.length).toBeGreaterThan(0);
    expect(gained).toContainEqual({ x: 3, y: 3 });
    // Not the piece's own tile, nor anything outside the ring.
    expect(gained).not.toContainEqual({ x: 7, y: 4 });
    expect(gained).not.toContainEqual({ x: 1, y: 1 });
  });

  it('shows nothing for a piece that seals nothing', () => {
    expect(sealingCells(state, [[0, 0]], 1, 1)).toEqual([]);
  });
});
