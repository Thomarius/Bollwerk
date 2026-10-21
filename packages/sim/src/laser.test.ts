import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { laserCount, traceLaser } from './laser.js';
import { drainEvents } from './match.js';
import { findReadyCannon, fire, flightTicks, resolveImpacts } from './shots.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchEvent, type MatchState, type Shot } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(pierce: number, flightFactor = 1): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = { footprint: [2, 2] as [number, number], flightFactor, pierce };
  return {
    ...ruleset,
    specials: { ...ruleset.specials, laser: { '2': variant, '3': variant } },
  };
}

/**
 * Player 0's Laser Tower (cost 3), its own wall before it, and a cannon below; player 1's
 * three walls in a row across the channel, player 2's three further on. From the tower's
 * centre (2.5, 1.5) the beam towards (9, 2) runs along row 2 to the corner at (15.5, 2.5),
 * then along row 3.
 */
const ART = `
  ........................
  .,XX,..,,,,,,..,,,,,,,,.
  .,XX#..,###,,..#,,,,,,,.
  .,**,..,,,,,,..,,#,#,,,.
  .,**,..,,,,,,..,,,,,,,,.
  ........................
`;
const ISLANDS = `
  ........................
  .......222222..33333333.
  .......222222..33333333.
  .......222222..33333333.
  .......222222..33333333.
  ........................
`;

function battery(ruleset: Ruleset): MatchState {
  const state = stateFromAscii(ART, ruleset, ISLANDS);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  for (const cannon of state.cannons) cannon.active = true;
  return state;
}

function beamOf(events: readonly MatchEvent[]) {
  const event = events.find((e) => e.kind === 'laser_fired');
  if (event?.kind !== 'laser_fired') throw new Error('no beam');
  return event;
}

function shotOf(result: ReturnType<typeof fire>): Shot {
  if (!('shot' in result)) throw new Error(result.rejection);
  return result.shot;
}

const tile = (state: MatchState, x: number, y: number) => y * state.width + x;
const tower = (state: MatchState) => state.cannons.find((c) => c.kind === 'laser')!;

describe('the Laser Tower', () => {
  it('clears the first walls on its line on the tick it fires, past its own', () => {
    const state = battery(rules(4));
    const shot = shotOf(fire(state, 0, 9, 2));
    expect(shot.kind).toBe('laser');
    const beam = beamOf(drainEvents(state));
    expect(beam.destroyed).toEqual([8, 9, 10, 15].map((x) => tile(state, x, 2)));
    // The player's own wall, the first on the line, is passed over and not counted.
    expect(state.structure[tile(state, 4, 2)]).toBe(Structure.Wall);
    expect(state.structure[tile(state, 17, 3)]).toBe(Structure.Wall);
    expect(state.players[0]!.wallsDestroyed).toBe(4);
    // It ends in the middle of the last wall it cleared.
    expect(Math.floor(beam.endX + 0.5)).toBe(15);
    expect(Math.floor(beam.endY + 0.5)).toBe(2);
  });

  it('clears as many walls as its variant pierces, across the channel to another opponent', () => {
    const state = battery(rules(3));
    fire(state, 0, 9, 2);
    expect(beamOf(drainEvents(state)).destroyed).toEqual([8, 9, 10].map((x) => tile(state, x, 2)));
    const further = battery(rules(6));
    fire(further, 0, 9, 2);
    const islands = beamOf(drainEvents(further)).destroyed.map((t) => further.islandId[t]);
    expect(islands).toEqual([2, 2, 2, 3, 3, 3]);
  });

  it('reloads by the flight to the first wall it clears, not to the tile clicked', () => {
    // Clicked in the channel by the tower's own shore: the beam goes on to the walls beyond,
    // and the reload is the flight to the first of them, as if it had been clicked.
    const near = battery(rules(3));
    const shot = shotOf(fire(near, 0, 6, 2));
    expect(shot.impactTick - shot.launchTick).toBe(
      flightTicks(near, shot.fromX, shot.fromY, 8, 2, 1),
    );
    expect(beamOf(drainEvents(near)).destroyed).toEqual([tile(near, 8, 2), tile(near, 9, 2)]);
    // The flight factor scales it as any tower's.
    const slow = battery(rules(3, 2));
    const slowShot = shotOf(fire(slow, 0, 6, 2));
    expect(slowShot.impactTick - slowShot.launchTick).toBe(
      flightTicks(slow, shot.fromX, shot.fromY, 8, 2, 2),
    );
  });

  it('reloads by the flight to the tile clicked when it clears nothing, landing nothing', () => {
    const state = battery(rules(3));
    const shot = shotOf(fire(state, 0, 6, 4));
    expect(shot.impactTick - shot.launchTick).toBe(
      flightTicks(state, shot.fromX, shot.fromY, 6, 4, 1),
    );
    const beam = beamOf(drainEvents(state));
    expect(beam.destroyed).toEqual([]);
    // It runs on to the map's edge.
    expect(beam.endY).toBeCloseTo(5.5);
    const walls = state.structure.filter((s) => s === Structure.Wall).length;
    state.tick = shot.impactTick;
    resolveImpacts(state);
    expect(tower(state).shotIds).toEqual([]);
    expect(state.structure.filter((s) => s === Structure.Wall).length).toBe(walls);
    expect(drainEvents(state).some((e) => e.kind === 'shot_impact')).toBe(false);
  });

  it('fires first whenever it is ready, as Big Bertha does', () => {
    const state = battery(rules(3));
    // The cannon stands nearer the target, yet the tower is chosen.
    expect(findReadyCannon(state, 0, 9, 4)?.kind).toBe('laser');
  });

  it('never slips through a sealing wall where its line crosses a corner', () => {
    // The beam's exact diagonal from the tower's centre (1.5, 1.5) passes through tiles'
    // corners only; the staircase is 4-connected, so one of its blocks sits on the line.
    const art = `
      .........
      .XX,.....
      .XX,.....
      .,,,.....
      ....,,#,.
      ....,##,.
      ....##,,.
      ....,,,,.
      .........
    `;
    const islands = `
      .........
      .........
      .........
      .........
      ....2222.
      ....2222.
      ....2222.
      ....2222.
      .........
    `;
    const state = stateFromAscii(art, rules(5), islands);
    const beam = traceLaser(state, 0, 1.5, 1.5, 7, 7, 5);
    expect(beam.cleared).toEqual([tile(state, 5, 5)]);
  });

  it('pierces a fraction by chance, drawn the same for the same shot every time', () => {
    const state = battery(rules(3.5));
    const shots = Array.from({ length: 64 }, (_, id) => ({
      ...shotOf(fire(battery(rules(3.5)), 0, 9, 2)),
      id,
    }));
    const counts = shots.map((s) => laserCount(state, s));
    expect(new Set(counts)).toEqual(new Set([3, 4]));
    expect(shots.map((s) => laserCount(state, s))).toEqual(counts);
  });
});
