import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { drainEvents, step } from './match.js';
import { findReadyCannon, fire, flightTicks } from './shots.js';
import { inFlight, waveRays } from './subwoofer.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchEvent, type MatchState, type Shot } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(waveTilesPerSecond = 20, flightFactor = 1): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = (waveWidth: number) => ({
    footprint: [2, 2] as [number, number],
    flightFactor,
    waveTilesPerSecond,
    waveWidth,
  });
  return {
    ...ruleset,
    specials: { ...ruleset.specials, subwoofer: { '2': variant(2), '3': variant(3) } },
  };
}

/**
 * Player 0's Subwoofer — cost 3 (`W`) or cost 2 (`w`) — at (2, 2), its own wall behind it and a
 * cannon below; player 1's island across the channel, two walls running north to south, at
 * columns 9 and 12. Aimed east, a wave meets the first, and the next wave through its gap the
 * second.
 */
const art = (tower: 'W' | 'w') => `
  ...................
  .,,,,..,,#,,#,,,,,.
  #,${tower}${tower},..,,#,,#,,,,,.
  .,${tower}${tower},..,,#,,#,,,,,.
  .,**,..,,#,,#,,,,,.
  .,**,..,,#,,#,,,,,.
  ...................
`;
const ISLANDS = `
  ...................
  .......22222222222.
  .......22222222222.
  .......22222222222.
  .......22222222222.
  .......22222222222.
  ...................
`;

function battery(tower: 'W' | 'w' = 'w', ruleset = rules()): MatchState {
  const state = stateFromAscii(art(tower), ruleset, ISLANDS);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  return state;
}

const tower = (state: MatchState) => state.cannons.find((c) => c.kind === 'subwoofer')!;

function shotOf(result: ReturnType<typeof fire>): Shot {
  if (!('shot' in result)) throw new Error(result.rejection);
  return result.shot;
}

/** Steps until the tick given, gathering the events on the way. */
function run(state: MatchState, until: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  while (state.tick < until) {
    step(state);
    events.push(...drainEvents(state));
  }
  return events;
}

const ended = (events: readonly MatchEvent[]) =>
  events.flatMap((e) => (e.kind === 'wave_ended' ? [e] : []));
/** The walls a run of events cleared, as tiles. */
const cleared = (events: readonly MatchEvent[]) =>
  ended(events).flatMap((e) => (e.destroyed === null ? [] : [e.destroyed]));
const column = (state: MatchState, tiles: readonly number[]) => tiles.map((i) => i % state.width);

describe('the Subwoofer', () => {
  it('fires first whenever it is ready, a wave as wide as its variant', () => {
    for (const [glyph, width] of [
      ['w', 2],
      ['W', 3],
    ] as const) {
      const state = battery(glyph);
      expect(findReadyCannon(state, 0, 14, 3)?.kind).toBe('subwoofer');
      const shot = shotOf(fire(state, 0, 14, 3));
      expect(shot.kind).toBe('subwoofer');
      const sent = drainEvents(state).find((e) => e.kind === 'wave_sent');
      if (sent?.kind !== 'wave_sent') throw new Error('no wave');
      expect(sent.wave.lanes).toHaveLength(width);
      expect(inFlight(state)).toBe(true);
    }
  });

  it('clears the first enemy wall on each lane as the wave reaches it, side by side', () => {
    for (const [glyph, width] of [
      ['w', 2],
      ['W', 3],
    ] as const) {
      const state = battery(glyph);
      fire(state, 0, 14, 3);
      drainEvents(state);
      const walls = cleared(run(state, 30));
      // One wall a lane, every one in the first wall facing it, each in a row of its own: a gap
      // as wide as the wave.
      expect(walls).toHaveLength(width);
      expect(column(state, walls)).toEqual(Array(width).fill(9));
      expect(new Set(walls).size).toBe(width);
      for (const i of walls) expect(state.structure[i]).toBe(Structure.Empty);
      expect(state.players[0]!.wallsDestroyed).toBe(width);
      // Its own wall, behind it, is never a target.
      expect(state.structure[2 * state.width]).toBe(Structure.Wall);
      expect(state.waves).toHaveLength(0);
    }
  });

  it('travels: its walls fall as the front arrives, not as it fires', () => {
    const state = battery('w', rules(2));
    fire(state, 0, 14, 3);
    drainEvents(state);
    // 2 tiles a second, from the tower's centre at 2.5 to the wall at 9: three seconds and more.
    expect(cleared(run(state, 90))).toEqual([]);
    expect(cleared(run(state, 150))).toHaveLength(2);
  });

  it('reloads by the flight to the nearest wall a lane will clear, not to the tile clicked', () => {
    const state = battery();
    const shot = shotOf(fire(state, 0, 17, 3));
    const flight = shot.impactTick - shot.launchTick;
    expect(flight).toBe(flightTicks(state, shot.fromX, shot.fromY, 9, 2));
    expect(flight).toBeLessThan(flightTicks(state, shot.fromX, shot.fromY, 17, 3));
  });

  it('sends the next wave through the gap the last one made, to the wall behind', () => {
    const state = battery('W');
    fire(state, 0, 14, 3);
    run(state, 200);
    shotOf(fire(state, 0, 14, 3));
    const walls = cleared(run(state, 260));
    expect(column(state, walls)).toEqual([12, 12, 12]);
  });

  it('runs a lane with no wall left on to the map edge, and one whose wall fell first on past it', () => {
    const state = battery('w', rules(4));
    fire(state, 0, 14, 3);
    drainEvents(state);
    const rays = waveRays(tower(state).x + 0.5, tower(state).y + 0.5, 14, 3, 2)!;
    expect(rays).toHaveLength(2);
    // Another shot takes both of column 9's walls on its lanes before the wave gets there.
    const lanesRows = [2, 3];
    for (const y of lanesRows) state.structure[y * state.width + 9] = Structure.Empty;
    for (const y of lanesRows) state.structure[y * state.width + 12] = Structure.Empty;
    const events = run(state, 400);
    const ends = ended(events);
    expect(ends).toHaveLength(2);
    expect(ends.every((e) => e.destroyed === null)).toBe(true);
    expect(ends.every((e) => e.x >= state.width - 0.5)).toBe(true);
    expect(inFlight(state)).toBe(false);
  });

  it('lands a wave sent late in the intermission, which waits for it', () => {
    const state = battery('w', rules(1));
    state.phaseEndTick = 10;
    fire(state, 0, 14, 3);
    run(state, 11);
    expect(state.phase).toBe('intermission');
    expect(state.waves).toHaveLength(1);
    const events: MatchEvent[] = [];
    while (state.waves.length > 0) events.push(...run(state, state.tick + 1));
    expect(cleared(events)).toHaveLength(2);
    // Its last lane landed with the barrage over, and the build phase still waiting for it.
    expect(state.phase).toBe('intermission');
    expect(state.pendingPhase).toBe('build');
  });
});
