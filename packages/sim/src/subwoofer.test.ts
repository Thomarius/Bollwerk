import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { singLullaby } from './lullaby.js';
import { drainEvents, hashMatchState, step } from './match.js';
import { findReadyCannon } from './shots.js';
import { aimWave, inFlight, startCooldowns } from './subwoofer.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchEvent, type MatchState, type Shot } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(cooldownMs: number, waveTilesPerSecond = 20, waveWidth = 2): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = {
    footprint: [2, 2] as [number, number],
    cooldownMs,
    waveTilesPerSecond,
    waveWidth,
  };
  return {
    ...ruleset,
    specials: { ...ruleset.specials, subwoofer: { '2': variant, '3': variant } },
  };
}

/**
 * Player 0's Subwoofer (cost 3) at (2, 2), its own wall west of it; player 1's walls across the
 * channel to the east — (9, 2) and (10, 2) on the upper lane, (10, 3) on the lower — and one far
 * to the north, beyond the wave's reach of a tie.
 */
const ART = `
  ..................
  .,,,,..,,,,,,,,,,.
  #,WW,..,,##,,,,,,.
  .,WW,..,,,#,,,,,,.
  .,,,,..,,,,,,,,,,.
  ..................
`;
const ISLANDS = `
  ..................
  .......2222222222.
  .......2222222222.
  .......2222222222.
  .......2222222222.
  ..................
`;

function battery(art = ART, ruleset = rules(4000), islands = ISLANDS): MatchState {
  const state = stateFromAscii(art, ruleset, islands);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  startCooldowns(state);
  return state;
}

const tile = (state: MatchState, x: number, y: number) => y * state.width + x;
const tower = (state: MatchState) => state.cannons.find((c) => c.kind === 'subwoofer')!;

/** Steps until the tick given, gathering the events on the way. */
function run(state: MatchState, until: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  while (state.tick < until) {
    step(state);
    events.push(...drainEvents(state));
  }
  return events;
}

const sent = (events: readonly MatchEvent[]) => events.filter((e) => e.kind === 'wave_sent');
const ended = (events: readonly MatchEvent[]) =>
  events.flatMap((e) => (e.kind === 'wave_ended' ? [e] : []));

describe('the Subwoofer', () => {
  it('waits a cooldown from the barrage start, then clears the first wall on each lane', () => {
    const state = battery();
    // 4 s at 30 ticks a second: nothing before tick 120.
    expect(sent(run(state, 119))).toHaveLength(0);
    const events = run(state, 121);
    expect(sent(events)).toHaveLength(1);
    const wave = (sent(events)[0] as Extract<MatchEvent, { kind: 'wave_sent' }>).wave;
    expect(wave.dir).toBe(1);
    expect(wave.lanes.map((l) => [l.x, l.y])).toEqual([
      [4, 2],
      [4, 3],
    ]);
    expect(inFlight(state)).toBe(true);
    // 20 tiles a second: the lanes' walls, 5 and 6 tiles on, are reached within a few ticks.
    const after = run(state, 140);
    expect(ended(after).map((e) => e.destroyed)).toEqual([tile(state, 9, 2), tile(state, 10, 3)]);
    expect(state.structure[tile(state, 9, 2)]).toBe(Structure.Empty);
    expect(state.structure[tile(state, 10, 2)]).toBe(Structure.Wall);
    // The player's own wall, behind it, is never a target.
    expect(state.structure[tile(state, 0, 2)]).toBe(Structure.Wall);
    expect(state.players[0]!.wallsDestroyed).toBe(2);
    expect(inFlight(state)).toBe(false);
  });

  it('starts its cooldown again as it fires, drilling on down its lanes or off the map', () => {
    const state = battery();
    const events = run(state, 300);
    expect(sent(events).map((e) => e.tick)).toEqual([120, 240]);
    // The second wave's upper lane finds the wall behind the one the first cleared; its lower
    // lane, with nothing left in its row, runs off the map's edge and disappears.
    const second = ended(events).slice(2);
    expect(state.structure[tile(state, 10, 2)]).toBe(Structure.Empty);
    expect(second.map((e) => e.destroyed)).toEqual([tile(state, 10, 2), null]);
    expect(second[1]).toMatchObject({ x: state.width, y: 3 });
    expect(state.waves).toHaveLength(0);
  });

  it('sends a wave four lanes wide as a lane more on either side, a wall cleared on each', () => {
    const wide = `
      ..................
      .,,,,..,,,#,,,,,,.
      #,WW,..,,##,,,,,,.
      .,WW,..,,,#,,,,,,.
      .,,,,..,,,,,#,,,,.
      ..................
    `;
    const state = battery(wide, rules(4000, 20, 4));
    const events = run(state, 150);
    const wave = (sent(events)[0] as Extract<MatchEvent, { kind: 'wave_sent' }>).wave;
    expect(wave.lanes.map((l) => l.y)).toEqual([1, 2, 3, 4]);
    expect(ended(events).map((e) => e.destroyed)).toEqual([
      tile(state, 9, 2),
      tile(state, 10, 1),
      tile(state, 10, 3),
      tile(state, 12, 4),
    ]);
  });

  it('fires as often as its cooldown fits a 10-second barrage', () => {
    const thick = `
      ..................
      .,,,,..,########,.
      .,WW,..,########,.
      .,WW,..,########,.
      .,,,,..,,,,,,,,,,.
      ..................
    `;
    for (const [cooldown, waves] of [
      [4000, 2],
      [3000, 3],
    ] as const) {
      const state = battery(thick, rules(cooldown));
      state.phaseEndTick = 300;
      expect(sent(run(state, 300))).toHaveLength(waves);
    }
  });

  it('turns to the nearest wall, ties broken by the other lane, then north, east, south, west', () => {
    const north = `
      ...........
      ....##.....
      ...........
      ....WW.,#,.
      ....WW.,,,.
      ...........
    `;
    const islands = `
      ...........
      .2222222...
      .......222.
      .......222.
      .......222.
      ...........
    `;
    // North: 1 tile to each lane; east: 2 to the upper lane, none to the lower. North wins.
    const state = stateFromAscii(north, rules(4000), islands);
    expect(aimWave(state, tower(state).owner, tower(state), 2)?.dir).toBe(0);
    // Remove one of the northern walls: now north (1, ∞) and east (2, ∞) — the nearer lane
    // decides, still north. Remove both: east.
    state.structure[tile(state, 4, 1)] = Structure.Empty;
    expect(aimWave(state, 0, tower(state), 2)).toEqual({ dir: 0, distances: [Infinity, 1] });
    state.structure[tile(state, 5, 1)] = Structure.Empty;
    expect(aimWave(state, 0, tower(state), 2)).toEqual({ dir: 1, distances: [2, Infinity] });
  });

  it('breaks a tie of both lanes by the fixed order, north first', () => {
    const square = `
      .........
      ...##....
      .........
      ...WW.#..
      ...WW.#..
      .........
    `;
    const islands = `
      .........
      .2222....
      .....222.
      .....222.
      .....222.
      .........
    `;
    const state = stateFromAscii(square, rules(4000), islands);
    // North: 1 and 1; east: 1 and 1. North comes first.
    expect(aimWave(state, 0, tower(state), 2)).toEqual({ dir: 0, distances: [1, 1] });
  });

  it('stays silent with no enemy wall on any lane, and when inert', () => {
    const lonely = `
      ..........
      .,,,,..,,.
      .,WW,..,#.
      .,WW,..,,.
      .,,,,..,,.
      .,,,,..,#.
      ..........
    `;
    const islands = `
      ..........
      .......22.
      .......22.
      .......22.
      .......22.
      .......22.
      ..........
    `;
    const state = battery(lonely, rules(4000), islands);
    // The wall at (8, 2) is in reach: knock it out first, and nothing is left on a lane.
    state.structure[tile(state, 8, 2)] = Structure.Empty;
    expect(sent(run(state, 300))).toHaveLength(0);
    const inert = battery();
    tower(inert).active = false;
    expect(sent(run(inert, 300))).toHaveLength(0);
  });

  it('is never the gun a click fires', () => {
    const state = battery();
    expect(findReadyCannon(state, 0, 9, 2)).toBeNull();
  });

  it('lands a wave sent late in the intermission, which waits for it', () => {
    const slow = rules(3000, 1);
    const state = battery(ART, slow);
    state.phaseEndTick = 100;
    run(state, 101);
    expect(state.phase).toBe('intermission');
    // Its cooldown ended with the barrage; the wave (1 tile a second) is still on its way.
    expect(tower(state).waveTick).toBeUndefined();
    expect(state.waves).toHaveLength(1);
    const events = run(state, 400);
    expect(ended(events).map((e) => e.destroyed)).toEqual([tile(state, 9, 2), tile(state, 10, 3)]);
    // No second wave outside combat, and the intermission held until the first was down.
    expect(sent(events)).toHaveLength(0);
    expect(state.phase).toBe('intermission');
    expect(state.phaseEndTick).toBeGreaterThan(ended(events).at(-1)!.tick);
  });

  it('has its cooldown pushed back while a lullaby has it asleep', () => {
    const lulled = `
      ..................
      .,,,,..,,,,,,,,,,.
      .,WW,..,,##,,,,,,.
      .,WW,..,,,#,,zz,,.
      .,,,,..,,,,,,zz,,.
      ..................
    `;
    const state = battery(lulled, rules(4000));
    run(state, 30);
    // Two lullabies put a tower to sleep for 3 s, from when it would next have fired.
    const singer = state.cannons.find((c) => c.kind === 'lullaby')!;
    const shot: Shot = {
      id: 99,
      cannonId: singer.id,
      owner: singer.owner,
      kind: 'lullaby',
      cost: 2,
      fromX: 13.5,
      fromY: 3.5,
      toX: 3,
      toY: 2,
      launchTick: 0,
      impactTick: 30,
    };
    singLullaby(state, shot);
    singLullaby(state, shot);
    expect(tower(state).asleepUntil).toBe(120 + 90);
    expect(sent(run(state, 209))).toHaveLength(0);
    expect(sent(run(state, 211))).toHaveLength(1);
  });

  it('leaves the hash of a match without one as it was', () => {
    const plain = stateFromAscii(ART.replace(/W/g, ','), rules(4000), ISLANDS);
    const before = hashMatchState(plain);
    startCooldowns(plain);
    expect(hashMatchState(plain)).toBe(before);
  });
});
