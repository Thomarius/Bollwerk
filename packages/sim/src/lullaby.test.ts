import { defaultRuleset, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { isAwake, lullTargets } from './lullaby.js';
import { drainEvents, hashMatchState, step } from './match.js';
import { findReadyCannon, fire, resolveImpacts } from './shots.js';
import { stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchState } from './types.js';

/** The tower's levers for a test, the rest of the ruleset as it is. */
function rules(sleepRadius: number | null = null, sleepMs = 3000): Ruleset {
  const ruleset = withSpecials(defaultRuleset);
  const variant = (targets: number) => ({
    footprint: [2, 2] as [number, number],
    flightFactor: 1,
    sleepMs,
    sleepRadius,
    targets,
    immune: ['biggest' as const],
    asCannons: ['architect' as const],
    towerLulls: null,
  });
  return {
    ...ruleset,
    specials: { ...ruleset.specials, lullaby: { '2': variant(2), '3': variant(3) } },
  };
}

/**
 * Player 0's Lullaby Tower (cost 3) and a cannon; player 1's ring across the channel: cannon A at
 * (11, 3) by the west wall, cannon B at (13, 5), a Laser Tower (cost 3) at (15, 3), and the immune
 * — an Allerdickste Bertha at (19, 3) and an Architect at (19, 5).
 */
const ART = `
  ........................
  .,ZZ,,,..,#############.
  .,ZZ,,,..,#,,,,,,,,,,,#.
  .,**,,,..,#**,,XX,,GG,#.
  .,**,,,..,#**,,XX,,GG,#.
  .,,,,,,..,#,,**,,,,AA,#.
  .,,,,,,..,#,,**,,,,AA,#.
  .,,,,,,..,#############.
  ........................
`;
const ISLANDS = `
  ........................
  .........22222222222222.
  .........22222222222222.
  .........22222222222222.
  .........22222222222222.
  .........22222222222222.
  .........22222222222222.
  .........22222222222222.
  ........................
`;

function battery(ruleset: Ruleset, art = ART): MatchState {
  const state = stateFromAscii(art, ruleset, ISLANDS);
  state.phase = 'combat';
  state.phaseEndTick = 100_000;
  for (const cannon of state.cannons) cannon.active = true;
  return state;
}

const gun = (state: MatchState, x: number, y: number) =>
  state.cannons.find((c) => c.owner === 1 && c.x === x && c.y === y)!;
const A = (s: MatchState) => gun(s, 11, 3);
const B = (s: MatchState) => gun(s, 13, 5);
const LASER = (s: MatchState) => gun(s, 15, 3);
const tower = (s: MatchState) => s.cannons.find((c) => c.kind === 'lullaby')!;

/** Fires this player's next shot at (x, y) and lands everything due by its impact. */
function land(state: MatchState, player: number, x: number, y: number): number {
  const result = fire(state, player, x, y);
  if (!('shot' in result)) throw new Error(result.rejection);
  state.tick = result.shot.impactTick;
  resolveImpacts(state);
  return result.shot.impactTick;
}

describe('the Lullaby Tower', () => {
  it('fires first whenever it is ready, as Big Bertha does', () => {
    const state = battery(rules());
    expect(findReadyCannon(state, 0, 10, 4)?.kind).toBe('lullaby');
  });

  it('clears the wall it hits, and lulls the nearest viable guns — a cannon asleep at once', () => {
    const state = battery(rules());
    const at = land(state, 0, 10, 4);
    expect(state.structure[4 * state.width + 10]).toBe(Structure.Empty);
    // Cost 3 lulls three: A, B and the Laser, never the immune two.
    const lulled = drainEvents(state).filter((e) => e.kind === 'gun_lulled');
    expect(lulled.map((e) => e.kind === 'gun_lulled' && e.cannonId)).toEqual(
      [A(state), B(state), LASER(state)].map((c) => c.id),
    );
    expect(A(state).asleepUntil).toBe(at + 90);
    expect(B(state).asleepUntil).toBe(at + 90);
    // The Laser, at 3 cannons, takes three lullabies to sleep: one so far.
    expect(isAwake(state, LASER(state))).toBe(true);
    expect(LASER(state).lulled).toBe(1);
  });

  it('lulls as many guns as its cost’s variant says', () => {
    const state = battery(rules(), ART.replaceAll('Z', 'z'));
    land(state, 0, 10, 4);
    expect(drainEvents(state).filter((e) => e.kind === 'gun_lulled')).toHaveLength(2);
    expect(LASER(state).lulled).toBeUndefined();
  });

  it('puts a special tower to sleep once lulled as often as it cost', () => {
    const state = battery(rules());
    for (let k = 0; k < 3; k++) {
      tower(state).shotIds = [];
      land(state, 0, 10, 4);
    }
    // A and B asleep from the first shot are passed over, so the Laser is lulled every time.
    expect(LASER(state).asleepUntil).toBeDefined();
    expect(LASER(state).lulled).toBeUndefined();
  });

  it('never lulls the Allerdickste Bertha, nor a gun asleep; the Architect as a cannon', () => {
    const state = battery(rules());
    land(state, 0, 10, 4);
    const architect = gun(state, 19, 5);
    const reached = lullTargets(state, 0, 20, 4, rules().specials.lullaby!['3']!);
    // A and B asleep, the Bertha immune: the Laser and the Architect are left, nearest first.
    expect(reached.map((c) => c.id).sort()).toEqual([LASER(state).id, architect.id].sort());
    // The Architect fires as a cannon in combat, so sleeps as one, after a single lullaby.
    tower(state).shotIds = [];
    land(state, 0, 21, 5);
    expect(architect.asleepUntil).toBeDefined();
  });

  it('reaches only guns within its radius, where it has one', () => {
    const state = battery(rules(1.5));
    const reached = lullTargets(state, 0, 10, 4, rules(1.5).specials.lullaby!['3']!);
    expect(reached.map((c) => c.id)).toEqual([A(state).id]);
  });

  it('pauses a reloading gun’s reload: it sleeps from when its shot lands', () => {
    const state = battery(rules());
    // The rival's towers inert, or an impact tower among them would fire first. A cannon fires, at the
    // far corner of player 0's island, so its shot lands after the lullaby's.
    for (const c of state.cannons) if (c.owner === 1 && c.kind !== 'cannon') c.active = false;
    const theirs = fire(state, 1, 1, 7);
    if (!('shot' in theirs)) throw new Error(theirs.rejection);
    const shooter = state.cannons.find((c) => c.id === theirs.shot.cannonId)!;
    expect([A(state).id, B(state).id]).toContain(shooter.id);
    const ours = fire(state, 0, 10, 4);
    if (!('shot' in ours)) throw new Error(ours.rejection);
    expect(ours.shot.impactTick).toBeLessThan(theirs.shot.impactTick);
    state.tick = ours.shot.impactTick;
    resolveImpacts(state);
    expect(shooter.asleepUntil).toBe(theirs.shot.impactTick + 90);
  });

  it('wakes every gun and forgets its lullabies as combat ends, hashed only meanwhile', () => {
    const state = battery(rules());
    const clean = hashMatchState(battery(rules()));
    expect(hashMatchState(state)).toBe(clean);
    land(state, 0, 10, 4);
    expect(hashMatchState(state)).not.toBe(clean);
    state.phaseEndTick = state.tick + 1;
    step(state);
    expect(state.phase).toBe('intermission');
    expect(state.cannons.every((c) => c.asleepUntil === undefined && c.lulled === undefined)).toBe(
      true,
    );
  });

  it('lulls nothing with a shot landing after the barrage', () => {
    const state = battery(rules());
    const result = fire(state, 0, 10, 4);
    if (!('shot' in result)) throw new Error(result.rejection);
    state.phase = 'intermission';
    state.tick = result.shot.impactTick;
    resolveImpacts(state);
    expect(A(state).asleepUntil).toBeUndefined();
    expect(LASER(state).lulled).toBeUndefined();
  });

  describe('its levers', () => {
    /** The default rules with these levers set on both variants. */
    const levers = (set: Record<string, unknown>): Ruleset => {
      const base = rules();
      const lullaby = base.specials.lullaby!;
      return {
        ...base,
        specials: {
          ...base.specials,
          lullaby: { '2': { ...lullaby['2']!, ...set }, '3': { ...lullaby['3']!, ...set } },
        },
      };
    };

    it('puts a tower to sleep after `towerLulls` lullabies, whatever it cost', () => {
      const state = battery(levers({ towerLulls: 2 }));
      for (let k = 0; k < 2; k++) {
        tower(state).shotIds = [];
        land(state, 0, 10, 4);
      }
      expect(LASER(state).asleepUntil).toBeDefined();
    });
  });
});
