import { Structure, type Phase } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { t } from './i18n.js';

import {
  CASTLES,
  CHOOSE_BARE,
  CHOOSE_PICK,
  CHOOSE_RING,
  COMBAT,
  COMBAT_TARGET,
  CORNER_DIAGONAL,
  CORNER_TURNED,
  GUNS,
  HOW_TO_PLAY,
  SEAL_CLOSED,
  SEAL_GAP,
  SEAL_OPEN,
  TEAM_CLOSED,
  TEAM_GAP,
  TEAM_OPEN,
  howToSectionFor,
  span,
} from './howToPlay.js';

describe('how to play', () => {
  it('is thirteen pages of ten words or fewer, each standing still inside its own loop', () => {
    const pages = HOW_TO_PLAY.flatMap((chapter) => chapter.pages);
    expect(pages).toHaveLength(13);
    expect(new Set(pages.map((page) => page.caption)).size).toBe(pages.length);
    for (const page of pages) {
      expect(t(page.caption).split(/\s+/).length).toBeLessThanOrEqual(10);
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

  it('is in sections, the basics first and the extras last', () => {
    expect(HOW_TO_PLAY.map((chapter) => chapter.id)).toEqual([
      'basics',
      'building',
      'combat',
      'extras',
    ]);
    expect(HOW_TO_PLAY.every((chapter) => chapter.pages.length > 0)).toBe(true);
  });

  it('opens from the pause menu at the phase being played, or the one announced', () => {
    const at = (phase: Phase, pendingPhase: Phase | null = null) =>
      howToSectionFor({ phase, pendingPhase });
    expect(at('castle_select')).toBe('building');
    expect(at('build')).toBe('building');
    expect(at('cannon_place')).toBe('combat');
    expect(at('combat')).toBe('combat');
    expect(at('intermission', 'combat')).toBe('combat');
    expect(at('intermission', 'build')).toBe('building');
    expect(at('intermission')).toBe('basics');
    expect(at('game_over')).toBe('basics');
  });

  it('rings the chosen castle alone, the island otherwise as it was', () => {
    expect(CHOOSE_RING.enclosure.castleEnclosed).toEqual(
      CHOOSE_RING.state.castles.map((_, k) => k === CHOOSE_PICK),
    );
    const differ = [...CHOOSE_BARE.state.structure.keys()].filter(
      (i) => CHOOSE_BARE.state.structure[i] !== CHOOSE_RING.state.structure[i],
    );
    expect(differ.length).toBeGreaterThan(0);
    for (const i of differ) expect(CHOOSE_RING.state.structure[i]).toBe(Structure.Wall);
  });

  it('seals both castles, two guns standing with the crowned one and one with the other', () => {
    expect(CASTLES.enclosure.castleEnclosed).toEqual([true, true]);
    expect(CASTLES.enclosure.cannonActive).toEqual([true, true, true]);
    const [crowned, other] = CASTLES.state.castles;
    const near = CASTLES.state.cannons.map((gun) =>
      Math.abs(gun.x - crowned!.x) < Math.abs(gun.x - other!.x) ? 0 : 1,
    );
    // In the order the page places them: the crowned castle’s two first.
    expect(near).toEqual([0, 0, 1]);
  });

  it('lets one teammate seal the other’s castle with one block on their island', () => {
    const [red, blue] = TEAM_OPEN.state.castles;
    expect(red!.islandId).toBe(1);
    expect(blue!.islandId).toBe(2);
    expect(TEAM_OPEN.enclosure.castleEnclosed).toEqual([true, false]);
    expect(TEAM_CLOSED.enclosure.castleEnclosed).toEqual([true, true]);
    const gap = TEAM_GAP.y * TEAM_OPEN.state.width + TEAM_GAP.x;
    const differ = [...TEAM_OPEN.state.structure.keys()].filter(
      (i) => TEAM_OPEN.state.structure[i] !== TEAM_CLOSED.state.structure[i],
    );
    expect(differ).toEqual([gap]);
    expect(TEAM_CLOSED.state.islandId[gap]).toBe(2);
  });

  it('runs a span from nothing to whole, and holds either side', () => {
    expect(span(0, 100, 200)).toBe(0);
    expect(span(150, 100, 200)).toBe(0.5);
    expect(span(900, 100, 200)).toBe(1);
  });
});
