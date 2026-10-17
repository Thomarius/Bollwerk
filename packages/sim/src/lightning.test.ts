import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { applyEnclosure } from './enclosure.js';
import { drainEvents } from './match.js';
import { findReadyCannon, fire, flightTicks, resolveImpacts } from './shots.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchEvent, type MatchState } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(jumps: number, missChance = 0, jumpRadius = 4): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = {
    footprint: [2, 2] as [number, number],
    flightFactor: 1,
    jumps,
    jumpRadius,
    missChance,
  };
  return {
    ...ruleset,
    specials: { ...ruleset.specials, lightning: { '2': variant, '3': variant } },
  };
}

/**
 * Player 0's Lightning Tower (cost 3) and a cannon on the left; player 1's ring across the
 * channel; player 2's, a teammate of nobody, further right.
 */
const ART = `
  ..............................
  .,,,,,,,..,,,,,,,,..,,,,,,,,,.
  .,LL,**,..,######,..,######,,.
  .,LL,**,..,#,,,,#,..,#,,,,#,,.
  .,,,,,,,..,#,,,,#,..,#,,,,#,,.
  .,,,,,,,..,######,..,######,,.
  .,,,,,,,..,,,,,,,,..,,,,,,,,,.
  ..............................
`;
const ISLANDS = `
  ..............................
  ..........22222222..333333333.
  ..........22222222..333333333.
  ..........22222222..333333333.
  ..........22222222..333333333.
  ..........22222222..333333333.
  ..........22222222..333333333.
  ..............................
`;

function battery(ruleset: Ruleset): MatchState {
  const state = stateFromAscii(ART, ruleset, ISLANDS);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  applyEnclosure(state);
  for (const cannon of state.cannons) cannon.active = true;
  return state;
}

function struck(events: readonly MatchEvent[]) {
  const event = events.find((e) => e.kind === 'lightning_struck');
  if (event?.kind !== 'lightning_struck') throw new Error('no strike');
  return event;
}

const tower = (state: MatchState) => state.cannons.find((c) => c.kind === 'lightning')!;

describe('the Lightning Tower', () => {
  it('strikes the tile aimed at on the tick it fires, then jumps from wall to wall', () => {
    const state = battery(rules(3));
    const walls = state.structure.filter((s) => s === Structure.Wall).length;
    const result = fire(state, 0, 11, 3);
    expect('shot' in result && result.shot.kind).toBe('lightning');
    const strike = struck(drainEvents(state));
    expect(strike.path[0]).toEqual({ x: 11, y: 3 });
    expect(strike.path).toHaveLength(4);
    // Every jump within reach of the last, onto a wall, so four walls fall at once.
    for (let k = 1; k < strike.path.length; k++) {
      const [a, b] = [strike.path[k - 1]!, strike.path[k]!];
      expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeLessThanOrEqual(16);
    }
    expect(strike.destroyed).toHaveLength(4);
    expect(state.structure.filter((s) => s === Structure.Wall).length).toBe(walls - 4);
    expect(state.players[0]!.wallsDestroyed).toBe(4);
  });

  it('jumps as many times as its cost’s variant says', () => {
    const state = battery(rules(2));
    fire(state, 0, 11, 3);
    expect(struck(drainEvents(state)).path).toHaveLength(3);
  });

  it('reloads as an ordinary shot to the tile aimed at would, landing nothing more', () => {
    const state = battery(rules(3));
    const result = fire(state, 0, 11, 3);
    if (!('shot' in result)) throw new Error(result.rejection);
    const { shot } = result;
    expect(shot.impactTick - shot.launchTick).toBe(
      flightTicks(state, shot.fromX, shot.fromY, 11, 3, 1),
    );
    drainEvents(state);
    const walls = state.structure.filter((s) => s === Structure.Wall).length;
    expect(tower(state).shotIds).toEqual([shot.id]);
    state.tick = shot.impactTick;
    resolveImpacts(state);
    expect(tower(state).shotIds).toEqual([]);
    expect(state.structure.filter((s) => s === Structure.Wall).length).toBe(walls);
    expect(drainEvents(state).some((e) => e.kind === 'shot_impact')).toBe(false);
  });

  it('fires first whenever it is ready, as Big Bertha does', () => {
    const state = battery(rules(3));
    // The cannon stands nearer the target, yet the tower is chosen.
    expect(findReadyCannon(state, 0, 11, 3)?.kind).toBe('lightning');
  });

  it('never strikes its own side’s walls, and leaps the channel to another opponent', () => {
    // Player 1's one wall beside the channel; across it, 3 tiles off, player 2's; and the
    // player's own wall 4 tiles off, in reach as well.
    const art = `
      ..............
      .,LL,#..,#..#.
      .,LL,,..,,..,.
      ..............
    `;
    const islands = `
      ..............
      ........22..3.
      ........22..3.
      ..............
    `;
    const state = stateFromAscii(art, rules(2), islands);
    state.phase = 'combat';
    state.phaseEndTick = 100_000;
    for (const cannon of state.cannons) cannon.active = true;
    fire(state, 0, 9, 1);
    const strike = struck(drainEvents(state));
    expect(strike.destroyed.map((t) => state.islandId[t])).toEqual([2, 3]);
    // The player's own wall stands, though it was in reach.
    expect(state.structure[1 * state.width + 5]).toBe(Structure.Wall);
  });

  it('goes on from a tile at random where no wall is in reach', () => {
    // Aimed at the sea off the player's own island, where no opponent's wall is in reach.
    const state = battery(rules(2, 0, 2));
    fire(state, 0, 1, 7);
    const strike = struck(drainEvents(state));
    expect(strike.path).toHaveLength(3);
    expect(strike.destroyed).toEqual([]);
  });

  it('strikes at random by its miss chance, and draws the same chain every time', () => {
    // Missing every time, the jumps fall on any tile in reach, not only on walls.
    const missing = battery(rules(3, 1));
    const walls = new Set(
      Array.from(missing.structure).flatMap((s, i) => (s === Structure.Wall ? [i] : [])),
    );
    fire(missing, 0, 11, 3);
    const jumps = struck(drainEvents(missing)).path.slice(1);
    expect(jumps.some((p) => !walls.has(p.y * missing.width + p.x))).toBe(true);
    const paths = [0, 1].map(() => {
      const state = battery(rules(3, 0.5));
      fire(state, 0, 11, 3);
      return struck(drainEvents(state)).path;
    });
    expect(paths[0]).toEqual(paths[1]);
  });
});
