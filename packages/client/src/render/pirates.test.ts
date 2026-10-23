import { describe, expect, it } from 'vitest';

import { parrotFlight, torchSpots } from './pirates.js';

/** A territory board from rows of digits, each a player's ground plus one, 0 for none. */
function board(rows: string[]): { territory: Uint8Array; width: number } {
  const width = rows[0]!.length;
  return { territory: Uint8Array.from(rows.join('').split('').map(Number)), width };
}

describe('the Pirates style', () => {
  it('keeps a parrot on its gun while it is ready, and over it while it reloads', () => {
    // Perched long since: on the gun. Just fired: taking off, then circling.
    expect(parrotFlight(true, 0, 5000, 300, 250)).toEqual({ mode: 'perch' });
    expect(parrotFlight(false, 1000, 1150, 300, 250)).toEqual({ mode: 'takeoff', k: 0.5 });
    expect(parrotFlight(false, 1000, 1400, 300, 250)).toEqual({ mode: 'hover' });
    // Loaded again: landing, then on its gun.
    expect(parrotFlight(true, 2000, 2125, 300, 250)).toEqual({ mode: 'landing', k: 0.5 });
    expect(parrotFlight(true, 2000, 2300, 300, 250)).toEqual({ mode: 'perch' });
  });

  it('stands a torch at every corner of a small sealed plot', () => {
    const { territory, width } = board([
      '000000',
      '011110',
      '011110',
      '011110',
      '011110',
      '000000',
    ]);
    const spots = torchSpots(territory, width, 1, 6);
    expect(spots).toHaveLength(4);
    for (const s of spots) {
      expect(s.player).toBe(0);
      // Just inside the plot, which runs from 1 to 5 both ways.
      expect(s.x).toBeGreaterThan(1);
      expect(s.x).toBeLessThan(5);
      expect(s.y).toBeGreaterThan(1);
      expect(s.y).toBeLessThan(5);
    }
  });

  it('keeps to its cap a player, spreading the torches round the ground', () => {
    // An L of ground for player 0 and a square for player 1.
    const { territory, width } = board([
      '1111111100',
      '1111111100',
      '1100000000',
      '1100002220',
      '1100002220',
      '1100002220',
    ]);
    const spots = torchSpots(territory, width, 2, 3);
    const first = spots.filter((s) => s.player === 0);
    const second = spots.filter((s) => s.player === 1);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    // None of the three bunched together: each at least a few tiles from the others.
    for (const a of first) {
      for (const b of first)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(3);
    }
    // The same board gives the same torches, every time it is drawn.
    expect(torchSpots(territory, width, 2, 3)).toEqual(spots);
    expect(torchSpots(territory, width, 2, 0)).toEqual([]);
  });
});
