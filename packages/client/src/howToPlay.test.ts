import { Structure } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import {
  COMBAT,
  COMBAT_TARGET,
  CORNER_DIAGONAL,
  CORNER_TURNED,
  GUNS,
  HOW_TO_PLAY,
  SEAL_CLOSED,
  SEAL_GAP,
  SEAL_OPEN,
  span,
} from './howToPlay.js';

describe('how to play', () => {
  it('is seven pages of ten words or fewer, each standing still inside its own loop', () => {
    expect(HOW_TO_PLAY).toHaveLength(7);
    for (const page of HOW_TO_PLAY) {
      expect(page.caption.split(/\s+/).length).toBeLessThanOrEqual(10);
      expect(page.stillMs).toBeGreaterThanOrEqual(0);
      expect(page.stillMs).toBeLessThan(page.loopMs);
    }
  });

  it('shows the last block sealing the castle, as the game judges it', () => {
    expect(SEAL_OPEN.enclosure.castleEnclosed[0]).toBe(false);
    expect(SEAL_CLOSED.enclosure.castleEnclosed[0]).toBe(true);
    // The two boards differ by the one block the piece lays, and nothing else.
    const differ = [...SEAL_OPEN.state.structure.keys()].filter(
      (i) => SEAL_OPEN.state.structure[i] !== SEAL_CLOSED.state.structure[i],
    );
    expect(differ).toEqual([SEAL_GAP.y * SEAL_OPEN.state.width + SEAL_GAP.x]);
    expect(SEAL_CLOSED.floodSteps).toBeGreaterThan(0);
  });

  it('lets the sea through a join at a point, and not round a turned corner', () => {
    expect(CORNER_DIAGONAL.enclosure.castleEnclosed[0]).toBe(false);
    expect(CORNER_TURNED.enclosure.castleEnclosed[0]).toBe(true);
    const differ = [...CORNER_DIAGONAL.state.structure.keys()].filter(
      (i) => CORNER_DIAGONAL.state.structure[i] !== CORNER_TURNED.state.structure[i],
    );
    expect(differ).toEqual([2 * CORNER_DIAGONAL.state.width + 7]);
  });

  it('silences the gun outside sealed ground and only that one', () => {
    expect(GUNS.state.cannons).toHaveLength(2);
    expect(GUNS.enclosure.cannonActive.filter(Boolean)).toHaveLength(1);
    const live = GUNS.state.cannons[GUNS.enclosure.cannonActive.indexOf(true)]!;
    expect(GUNS.enclosure.territory[live.y * GUNS.state.width + live.x]).not.toBe(0);
  });

  it('aims at an opponent’s wall', () => {
    const i = COMBAT_TARGET.y * COMBAT.state.width + COMBAT_TARGET.x;
    expect(COMBAT.state.structure[i]).toBe(Structure.Wall);
    expect(COMBAT.state.islandId[i]).toBe(2);
    const gun = COMBAT.state.cannons[0]!;
    expect(COMBAT.state.islandId[gun.y * COMBAT.state.width + gun.x]).toBe(1);
  });

  it('runs a span from nothing to whole, and holds either side', () => {
    expect(span(0, 100, 200)).toBe(0);
    expect(span(150, 100, 200)).toBe(0.5);
    expect(span(900, 100, 200)).toBe(1);
  });
});
