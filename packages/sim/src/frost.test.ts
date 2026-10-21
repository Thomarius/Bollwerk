import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { applyEnclosure } from './enclosure.js';
import { FROZEN_TO_END, isFrozen, startFreezes, thawExpired } from './frost.js';
import { drainEvents, hashMatchState, step } from './match.js';
import { cellsRefusal } from './placement.js';
import { findReadyCannon, fire, resolveImpacts } from './shots.js';
import { repairWalls } from './specials.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchState } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(share2 = 0.5, share3 = 1, throughOvertime = true): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = (freezeShare: number) => ({
    footprint: [2, 2] as [number, number],
    flightFactor: 1,
    freezeShare,
    throughOvertime,
  });
  return {
    ...ruleset,
    specials: { ...ruleset.specials, frost: { '2': variant(share2), '3': variant(share3) } },
  };
}

/**
 * Player 0's Frost Cannon (cost 3) and a cannon; player 1's ring across the channel, with an
 * Architect (cost 3) inside it by its east wall.
 */
const ART = `
  ......................
  .,,,,,,..,,,,,,,,,,,,.
  .,FF,,,..,##########,.
  .,FF,,,..,#,,,,,,AA#,.
  .,**,,,..,#,,,,,,AA#,.
  .,**,,,..,##########,.
  .,,,,,,..,,,,,,,,,,,,.
  ......................
`;
const ISLANDS = `
  ......................
  .........222222222222.
  .........222222222222.
  .........222222222222.
  .........222222222222.
  .........222222222222.
  .........222222222222.
  ......................
`;

function battery(ruleset: Ruleset, architect = false): MatchState {
  const art = architect ? ART : ART.replaceAll('A', ',');
  const state = stateFromAscii(art, ruleset, ISLANDS);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  applyEnclosure(state);
  for (const cannon of state.cannons) cannon.active = true;
  return state;
}

const tile = (state: MatchState, x: number, y: number) => y * state.width + x;
const tower = (state: MatchState) => state.cannons.find((c) => c.kind === 'frost')!;

/** Fires player 0's next shot at (x, y) and lands it. */
function land(state: MatchState, x: number, y: number): void {
  const result = fire(state, 0, x, y);
  if (!('shot' in result)) throw new Error(result.rejection);
  state.tick = result.shot.impactTick;
  resolveImpacts(state);
}

/** The build phase opening, as the match opens it: its freezes started. */
function openBuild(state: MatchState): void {
  state.phase = 'build';
  state.phaseEndTick = state.tick + 600;
  startFreezes(state);
}

/** Whether player 1 may lay a one-cell piece on (x, y). */
const mayBuild = (state: MatchState, x: number, y: number) =>
  cellsRefusal(state, state.players[1]!, [[0, 0]], x, y);

describe('the Frost Cannon', () => {
  it('fires first whenever it is ready, as Big Bertha does', () => {
    const state = battery(rules());
    // The cannon stands as near the target, yet the tower is chosen.
    expect(findReadyCannon(state, 0, 10, 4)?.kind).toBe('frost');
  });

  it('clears the wall it hits as a cannon does, and freezes it for the next build phase', () => {
    const state = battery(rules());
    land(state, 10, 3);
    expect(state.structure[tile(state, 10, 3)]).toBe(Structure.Empty);
    expect(state.players[0]!.wallsDestroyed).toBe(1);
    expect(drainEvents(state).some((e) => e.kind === 'tile_frozen')).toBe(true);
    // Not yet: a freeze is for the build phase to come.
    expect(isFrozen(state, tile(state, 10, 3))).toBe(false);
    openBuild(state);
    expect(mayBuild(state, 10, 3)).toBe('frozen');
    expect(mayBuild(state, 10, 4)).toBe('occupied');
  });

  it('freezes bare ground it hits too, and not the sea', () => {
    const state = battery(rules());
    land(state, 12, 4);
    land(state, 8, 4);
    openBuild(state);
    expect(mayBuild(state, 12, 4)).toBe('frozen');
    expect(state.frozen.map((f) => f.tile)).toEqual([tile(state, 12, 4)]);
  });

  it('thaws a cheap one after its share of the build phase', () => {
    // Cost 2's tower: the same board with a cheaper tower.
    const state = stateFromAscii(ART.replaceAll('F', 'f').replaceAll('A', ','), rules(), ISLANDS);
    state.phase = 'combat';
    state.phaseEndTick = 100_000;
    for (const cannon of state.cannons) cannon.active = true;
    land(state, 10, 3);
    openBuild(state);
    const start = state.tick;
    // Half of a 20-second phase at 30 ticks a second.
    expect(state.frozen[0]!.thawTick).toBe(start + 300);
    state.tick = start + 299;
    expect(mayBuild(state, 10, 3)).toBe('frozen');
    state.tick = start + 300;
    expect(mayBuild(state, 10, 3)).toBeNull();
    thawExpired(state);
    expect(state.frozen).toEqual([]);
  });

  it('holds a whole phase’s freeze through the overtime, and lets it go as the phase ends', () => {
    const state = battery(rules());
    land(state, 10, 3);
    openBuild(state);
    expect(state.frozen[0]!.thawTick).toBe(FROZEN_TO_END);
    state.tick = state.phaseEndTick - 1;
    step(state);
    expect(state.overtime).toBe(true);
    expect(mayBuild(state, 10, 3)).toBe('frozen');
    while (state.phase === 'build') step(state);
    expect(state.frozen).toEqual([]);
  });

  it('thaws a whole phase’s freeze as the clock runs out, where it stops at the overtime', () => {
    const state = battery(rules(0.5, 1, false));
    land(state, 10, 3);
    openBuild(state);
    expect(state.frozen[0]!.thawTick).toBe(state.phaseEndTick);
    state.tick = state.phaseEndTick - 2;
    step(state);
    expect(state.overtime).toBe(false);
    expect(mayBuild(state, 10, 3)).toBe('frozen');
    step(state);
    expect(state.overtime).toBe(true);
    expect(mayBuild(state, 10, 3)).toBeNull();
  });

  it('is thawed by an Architect in reach as the barrage ends, the wall rebuilt', () => {
    const state = battery(rules(), true);
    // The east wall beside the Architect, and ground out of its reach of 2.6.
    land(state, 19, 3);
    land(state, 12, 3);
    repairWalls(state);
    expect(state.structure[tile(state, 19, 3)]).toBe(Structure.Wall);
    const repair = drainEvents(state).find((e) => e.kind === 'walls_repaired');
    expect(repair?.kind === 'walls_repaired' && repair.thawed).toEqual([tile(state, 19, 3)]);
    // The ground out of its reach stays frozen.
    expect(state.frozen.map((f) => f.tile)).toEqual([tile(state, 12, 3)]);
  });

  it('is in the fingerprint only while there are freezes', () => {
    const state = battery(rules());
    const before = hashMatchState(state);
    const copy = battery(rules());
    expect(hashMatchState(copy)).toBe(before);
    land(state, 12, 4);
    land(copy, 12, 4);
    expect(hashMatchState(state)).toBe(hashMatchState(copy));
    copy.frozen = [];
    expect(hashMatchState(state)).not.toBe(hashMatchState(copy));
    expect(tower(state).kind).toBe('frost');
  });
});
