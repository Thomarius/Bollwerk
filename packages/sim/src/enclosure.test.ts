import { defaultRuleset } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { computeEnclosure } from './enclosure.js';
import { stateFromAscii } from './testing.js';

describe('enclosure solver', () => {
  it('seals a castle inside a complete wall loop', () => {
    const state = stateFromAscii(`
      ..........
      ..######..
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ..######..
      ..........
    `);
    const result = computeEnclosure(state);
    expect(result.castleEnclosed[0]).toBe(true);
    expect(result.enclosedCastlesByPlayer[0]).toBe(1);
  });

  it('leaks through a single missing block', () => {
    const state = stateFromAscii(`
      ..........
      ..######..
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ..###,##..
      ..........
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(false);
  });

  it('leaks through a diagonal join, so a wall must turn its corners', () => {
    // Two blocks meeting at a point do not seal: the escape flood is 8-connected
    // while the wall is not, so the sea slips between them. The corner block has
    // to be there.
    const state = stateFromAscii(`
      ..........
      ...####...
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ...####...
      ..........
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(false);
  });

  it('seals once the corner blocks are added', () => {
    const state = stateFromAscii(`
      ..........
      ..######..
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ..######..
      ..........
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(true);
  });

  it('does not let a diagonal staircase stand in for a wall', () => {
    const state = stateFromAscii(`
      ............
      ....#####...
      ...#,,,,#...
      ..#,,@@,,#..
      .#,,,@@,,,#.
      .#,,,,,,,,#.
      .##########.
      ............
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(false);
  });

  it('does not let the coastline stand in for a wall', () => {
    // The castle is walled on three sides and open to the sea on the fourth.
    // Water is traversable by the escape flood, so this is a breach.
    const state = stateFromAscii(`
      ..........
      ..######..
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ..........
      ..........
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(false);
  });

  it('counts every castle inside one shared loop', () => {
    const state = stateFromAscii(`
      ..............
      ..##########..
      ..#,,,,,,,,#..
      ..#,@@,,@@,#..
      ..#,@@,,@@,#..
      ..#,,,,,,,,#..
      ..##########..
      ..............
    `);
    const result = computeEnclosure(state);
    expect(result.castleEnclosed).toEqual([true, true]);
    expect(result.enclosedCastlesByPlayer[0]).toBe(2);
  });

  it('counts castles in separate loops independently', () => {
    const state = stateFromAscii(`
      ...............
      ..####,,####...
      ..#@@#,,#@@#...
      ..#@@#,,#@@#...
      ..####,,####...
      ...............
    `);
    const result = computeEnclosure(state);
    expect(result.castleEnclosed).toEqual([true, true]);
    expect(result.enclosedCastlesByPlayer[0]).toBe(2);
  });

  it('keeps a breached loop from counting while an intact one still does', () => {
    const state = stateFromAscii(`
      ...............
      ..####,,####...
      ..#@@#,,#@@#...
      ..#@@#,,#@@#...
      ..##,#,,####...
      ...............
    `);
    const result = computeEnclosure(state);
    expect(result.castleEnclosed[0]).toBe(false);
    expect(result.castleEnclosed[1]).toBe(true);
    expect(result.enclosedCastlesByPlayer[0]).toBe(1);
  });

  it('does not let a cannon plug a gap in the wall', () => {
    // A cannon sits exactly where a wall block is missing. Only walls block the
    // flood, so the loop is still open.
    const state = stateFromAscii(`
      ..........
      ..######..
      ..#,,,,#..
      ..#,@@,#..
      ..#,@@,#..
      ..#,,,,#..
      ..###**#..
      ..........
    `);
    expect(computeEnclosure(state).castleEnclosed[0]).toBe(false);
  });

  describe('a sealed pocket with no castle in it', () => {
    // As in the original, walled ground without a castle is territory for every purpose
    // — guns fire from it, its tiles score — while its player holds a sealed castle
    // somewhere. It never keeps them in the round by itself.
    const pocket = `
      ..............
      ..######......
      ..#,@@#.####..
      ..#,@@#.#**#..
      ..#,,,#.#**#..
      ..#####.####..
      ..............
    `;
    const inPocket = 3 * 14 + 9;

    it('is territory, and arms its guns, while a castle is sealed elsewhere', () => {
      const result = computeEnclosure(stateFromAscii(pocket));
      expect(result.castleEnclosed[0]).toBe(true);
      expect(result.territory[inPocket]).toBe(1);
      expect(result.cannonActive[0]).toBe(true);
    });

    it('is nothing once the castle is breached, and cannot save the round', () => {
      const state = stateFromAscii(`
        ..............
        ..######......
        ..#,@@#.####..
        ..#,@@#.#**#..
        ..#,,,#.#**#..
        ..##,##.####..
        ..............
      `);
      const result = computeEnclosure(state);
      expect(result.enclosedCastlesByPlayer[0]).toBe(0);
      expect(result.territory[inPocket]).toBe(0);
      expect(result.cannonActive[0]).toBe(false);
    });

    it('belongs to the pocket island’s player alone, not to whoever holds a castle', () => {
      // Island 2 has a pocket but no sealed castle; island 1's sealed castle is not theirs.
      const state = stateFromAscii(
        `
        ..............
        ..######......
        ..#,@@#.####..
        ..#,@@#.#,,#..
        ..#,,,#.#,,#..
        ..#####.####..
        ..............
      `,
        undefined,
        `
        ..............
        ..............
        ........2222..
        ........2222..
        ........2222..
        ........2222..
        ..............
      `,
      );
      expect(computeEnclosure(state).territory[inPocket]).toBe(0);
    });

    it('is refused under the old rule, with castlelessRegionsCount off', () => {
      const ruleset = {
        ...defaultRuleset,
        enclosure: { ...defaultRuleset.enclosure, castlelessRegionsCount: false },
      };
      const result = computeEnclosure(stateFromAscii(pocket, ruleset));
      expect(result.castleEnclosed[0]).toBe(true);
      expect(result.territory[inPocket]).toBe(0);
      expect(result.cannonActive[0]).toBe(false);
    });
  });

  it('activates a cannon sharing its region with a castle', () => {
    const state = stateFromAscii(`
      ..............
      ..##########..
      ..#,@@,,**,#..
      ..#,@@,,**,#..
      ..#,,,,,,,,#..
      ..##########..
      ..............
    `);
    const result = computeEnclosure(state);
    expect(result.cannonActive[0]).toBe(true);
    expect(result.territory[2 * 14 + 8]).toBe(1);
  });

  it('silences a cannon when its wall is breached, without destroying it', () => {
    const sealed = stateFromAscii(`
      ..............
      ..##########..
      ..#,@@,,**,#..
      ..#,@@,,**,#..
      ..#,,,,,,,,#..
      ..##########..
      ..............
    `);
    const breached = stateFromAscii(`
      ..............
      ..##########..
      ..#,@@,,**,#..
      ..#,@@,,**,#..
      ..#,,,,,,,,#..
      ..####,#####..
      ..............
    `);
    expect(computeEnclosure(sealed).cannonActive[0]).toBe(true);
    expect(computeEnclosure(breached).cannonActive[0]).toBe(false);
    // The cannon itself is untouched — re-enclosing brings it back.
    expect(breached.cannons).toHaveLength(1);
  });

  it('resolves each island independently', () => {
    const state = stateFromAscii(`
      ...................
      ..#####...#####....
      ..#,@@#...#2@@2#...
      ..#,@@#...#2@@2#...
      ..#####...#2,,2#...
      ...................
    `);
    const result = computeEnclosure(state);
    // Island 1 is sealed; island 2's "walls" are plain land, so it is wide open.
    expect(result.enclosedCastlesByPlayer[0]).toBe(1);
    expect(result.enclosedCastlesByPlayer[1]).toBe(0);
  });
});
