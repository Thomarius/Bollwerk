import { stateFromAscii } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { heroExpression } from '../animeBanner.js';

import { clanOfTeam, clanOrder, cutInSpot, type TileBox } from './anime/clans.js';
import { CLANS } from './anime/figures.js';

/** The open board for a cut-in: the whole picture, nothing to keep clear. */
const ALL: TileBox = { x: 0, y: 0, w: 99, h: 99 };

describe('the Anime style', () => {
  it('deals every team of eight a clan of its own, the same on every client', () => {
    for (const seed of [1, 7, 42]) {
      const order = clanOrder(seed);
      expect([...order].sort()).toEqual([...CLANS].sort());
      expect(clanOrder(seed)).toEqual(order);
      const dealt = Array.from({ length: 8 }, (_, team) => clanOfTeam(team, seed));
      expect(new Set(dealt).size).toBe(8);
    }
    // And not the same cast in every match.
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => clanOfTeam(0, seed)));
    expect(firsts.size).toBeGreaterThan(2);
  });

  it('gives the hero the face the moment calls for', () => {
    const moment = { continued: false, breached: false };
    expect(heroExpression({ ...moment, phase: 'combat' })).toBe('determined');
    expect(heroExpression({ ...moment, phase: 'build' })).toBe('determined');
    expect(heroExpression({ ...moment, phase: 'build', breached: true })).toBe('shocked');
    expect(heroExpression({ ...moment, phase: 'cannon_place' })).toBe('relaxed');
    expect(heroExpression({ ...moment, phase: 'castle_select' })).toBe('determined');
    expect(heroExpression({ ...moment, phase: 'castle_select', continued: true })).toBe('tears');
    expect(heroExpression({ ...moment, phase: 'game_over' })).toBeNull();
  });

  it('stands a cut-in on open sea, never over anything in play', () => {
    // An island walled round its castle and gun on the left, open sea on the right.
    const state = stateFromAscii(`
      ..............
      .,,,,,,,,.....
      .,######,.....
      .,#@@,*#,.....
      .,#@@,,#,.....
      .,######,.....
      .,,,,,,,,.....
      ..............
    `);
    // The screen the picture: the sea beyond the map counts as open, as it is in play.
    const bounds = { x: 0, y: 0, w: 14, h: 8 };
    const options = { clear: 1, viewer: -1, bounds, avoid: [], reach: 12 };
    const box = cutInSpot(state, 4, 4, 4, 3, options);
    // Clear of the island's walls, castle and gun and the tile round them: on the sea past
    // it, as near the spot asked for as it fits.
    expect(box).toEqual({ x: 9, y: 3, w: 4, h: 3 });
  });

  it('keeps off the viewer’s own island, the boxes to avoid, and the screen’s edge', () => {
    const state = stateFromAscii(`
      ..........
      .,,,,,,,,.
      .,,,,,,,,.
      .,,,,,,,,.
      .,,,,,,,,.
      ..........
    `);
    const near = { clear: 0, bounds: ALL, avoid: [], reach: 6 };
    // Bare land is open to anyone's cut-in but its owner's.
    expect(cutInSpot(state, 4, 2, 3, 2, { ...near, viewer: 1 })).toEqual({
      x: 3,
      y: 1,
      w: 3,
      h: 2,
    });
    const mine = cutInSpot(state, 4, 2, 3, 2, { ...near, viewer: 0 });
    expect(mine === null || mine.y >= 5 || mine.y + 2 <= 1 || mine.x >= 9 || mine.x + 3 <= 1).toBe(
      true,
    );
    // A box to avoid pushes it aside; a screen too small for it leaves none.
    const pushed = cutInSpot(state, 4, 2, 3, 2, {
      ...near,
      viewer: 1,
      avoid: [{ x: 2, y: 0, w: 5, h: 4 }],
    });
    expect(pushed).not.toBeNull();
    expect(pushed!.y >= 4 || pushed!.x >= 7 || pushed!.x + 3 <= 2).toBe(true);
    expect(
      cutInSpot(state, 4, 2, 3, 2, { ...near, viewer: 1, bounds: { x: 0, y: 0, w: 2, h: 2 } }),
    ).toBeNull();
  });
});
