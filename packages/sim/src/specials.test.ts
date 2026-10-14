import { defaultRuleset, defaultTerrainConfig, type Ruleset } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { applyEnclosure } from './enclosure.js';
import { applyAction, createMatch, step } from './match.js';
import { canPlaceCannon, legalCannonPlacements, placeCannon } from './placement.js';
import { holdingsOf } from './scoring.js';
import { findReadyCannon, fire, flightTicks, resolveImpacts } from './shots.js';
import { repairWalls, towersOwned } from './specials.js';
import { beginMatch, fastRuleset, stateFromAscii, withSpecials } from './testing.js';
import { Structure, type MatchState } from './types.js';

const SPECIALS = withSpecials(defaultRuleset);

/** A sealed ring round a castle, with room for guns. */
const SEALED = `
  ............
  .##########.
  .#,,,,,,,,#.
  .#,@@,,,,,#.
  .#,@@,,,,,#.
  .#,,,,,,,,#.
  .#,,,,,,,,#.
  .##########.
  ............
`;

/** Player 0 in a cannon phase on `SEALED`, bringing Big Bertha, with three cannons to place. */
function cannonPhase(ruleset: Ruleset = SPECIALS, art = SEALED): MatchState {
  const state = stateFromAscii(art, ruleset);
  applyEnclosure(state);
  state.phase = 'cannon_place';
  state.phaseEndTick = 100_000;
  const player = state.players[0]!;
  player.special = 'bertha';
  player.cannonsToPlace = 3;
  return state;
}

describe('buying a special tower', () => {
  it('takes its cost from the cannons to place, once', () => {
    const state = cannonPhase();
    const result = placeCannon(state, 0, 5, 3, true);
    expect('cannon' in result && result.cannon.kind).toBe('bertha');
    expect(state.players[0]!.cannonsToPlace).toBe(0);
    expect(state.players[0]!.specialsBought).toBe(1);
    expect(towersOwned(state, 0)).toBe(1);
    expect(state.events.at(-1)).toMatchObject({ kind: 'cannon_placed', cannonKind: 'bertha' });
  });

  it('places an ordinary cannon unless asked for the tower', () => {
    const state = cannonPhase();
    const result = placeCannon(state, 0, 5, 3);
    expect('cannon' in result && result.cannon.kind).toBe('cannon');
    expect(state.players[0]!.cannonsToPlace).toBe(2);
  });

  it('stands on its own footprint', () => {
    const ruleset = {
      ...SPECIALS,
      specials: {
        ...SPECIALS.specials,
        bertha: { ...SPECIALS.specials.bertha, footprint: [3, 3] },
      },
    } as Ruleset;
    const state = cannonPhase(ruleset);
    // Three columns from x 8 reach the wall at x 10, where a cannon's two fit.
    expect(canPlaceCannon(state, 0, 8, 2, true)).toBe('occupied');
    expect(canPlaceCannon(state, 0, 8, 2)).toBeNull();
    const result = placeCannon(state, 0, 5, 3, true);
    expect('cannon' in result && [result.cannon.w, result.cannon.h]).toEqual([3, 3]);
  });

  it('is refused when towers are not played', () => {
    const state = cannonPhase(defaultRuleset);
    expect(canPlaceCannon(state, 0, 5, 3, true)).toBe('special_off');
  });

  it('is refused to a player who brought none', () => {
    const state = cannonPhase();
    state.players[0]!.special = null;
    expect(canPlaceCannon(state, 0, 5, 3, true)).toBe('no_special');
  });

  it('is refused at an opening placement', () => {
    const state = cannonPhase();
    state.players[0]!.openingPlacement = true;
    expect(canPlaceCannon(state, 0, 5, 3, true)).toBe('special_at_opening');
    expect(canPlaceCannon(state, 0, 5, 3)).toBeNull();
  });

  it('is refused a second time in one round', () => {
    const state = cannonPhase();
    state.players[0]!.cannonsToPlace = 6;
    expect('cannon' in placeCannon(state, 0, 2, 5, true)).toBe(true);
    expect(canPlaceCannon(state, 0, 6, 5, true)).toBe('special_this_round');
    expect(canPlaceCannon(state, 0, 6, 5)).toBeNull();
  });

  it('is refused once the most towers allowed stand on the island', () => {
    const state = cannonPhase(
      { ...SPECIALS, specials: { ...SPECIALS.specials, maxOwned: 1 } },
      `
      ............
      .##########.
      .#,,,,,,,,#.
      .#,@@,,,BB#.
      .#,@@,,,BB#.
      .#,,,,,,,,#.
      .#,,,,,,,,#.
      .##########.
      ............
    `,
    );
    expect(canPlaceCannon(state, 0, 2, 5, true)).toBe('special_cap');
  });

  it('is refused while the cannons to place do not cover its cost', () => {
    const state = cannonPhase();
    state.players[0]!.cannonsToPlace = 2;
    expect(canPlaceCannon(state, 0, 5, 3, true)).toBe('special_too_dear');
    expect(canPlaceCannon(state, 0, 5, 3)).toBeNull();
  });

  it('counts as one gun for the points, whatever it cost', () => {
    const state = stateFromAscii(
      `
      ............
      .##########.
      .#,,,,,,,,#.
      .#,@@,**,,#.
      .#,@@,**,,#.
      .#,,BB,,,,#.
      .#,,BB,,,,#.
      .##########.
      ............
    `,
      SPECIALS,
    );
    applyEnclosure(state);
    expect(holdingsOf(state)[0]!.guns).toBe(2);
  });
});

describe('buying in a match', () => {
  function started(): MatchState {
    const ruleset = withSpecials(fastRuleset());
    const state = beginMatch(
      createMatch({
        seed: 7,
        ruleset,
        terrainConfig: defaultTerrainConfig,
        players: [
          { name: 'a', isBot: true, special: 'rapid' },
          { name: 'b', isBot: true },
        ],
      }),
    );
    for (const player of state.players) {
      const castle = state.castles.find((c) => c.islandId === player.islandId)!;
      applyAction(state, { kind: 'select_castle', player: player.id, castleId: castle.id });
    }
    return state;
  }

  function toPhase(state: MatchState, phase: MatchState['phase']): void {
    while (state.phase !== phase && state.phase !== 'game_over') step(state);
  }

  function buyAnywhere(state: MatchState): ReturnType<typeof applyAction> {
    const spot = legalCannonPlacements(state, 0)[0]!;
    return applyAction(state, { kind: 'place_cannon', player: 0, ...spot, special: true });
  }

  it('gives each player the tower they bring, only when towers are played', () => {
    const state = started();
    expect(state.players.map((p) => p.special)).toEqual(['rapid', null]);
    const classic = createMatch({
      seed: 7,
      ruleset: fastRuleset(),
      terrainConfig: defaultTerrainConfig,
      players: [
        { name: 'a', isBot: true, special: 'rapid' },
        { name: 'b', isBot: true },
      ],
    });
    expect(classic.players[0]!.special).toBeNull();
  });

  it('refuses the tower at the opening, then sells it in the next cannon phase', () => {
    const state = started();
    toPhase(state, 'cannon_place');
    expect(state.round).toBe(0);
    expect(buyAnywhere(state)).toBe('special_at_opening');
    // Round one passes untouched: the starting rings hold, and each earns two cannons.
    toPhase(state, 'combat');
    toPhase(state, 'cannon_place');
    expect(state.round).toBe(1);
    expect(state.players[0]!.cannonsToPlace).toBe(2);
    expect(buyAnywhere(state)).toBeNull();
    expect(state.players[0]!.cannonsToPlace).toBe(0);
    expect(towersOwned(state, 0)).toBe(1);
  });

  it('frees the count after a continue, which wipes the towers and makes an opening', () => {
    const state = started();
    toPhase(state, 'combat');
    toPhase(state, 'cannon_place');
    expect(buyAnywhere(state)).toBeNull();
    toPhase(state, 'build');
    // Player 0's ring goes, so the round fails and spends a life.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.islandId[i] === 1 && state.structure[i] === Structure.Wall) {
        state.structure[i] = Structure.Empty;
        state.owner[i] = 0;
      }
    }
    toPhase(state, 'cannon_place');
    const player = state.players[0]!;
    expect(player.startingCastleId).toBeNull();
    expect(player.openingPlacement).toBe(true);
    expect(towersOwned(state, 0)).toBe(0);
  });
});

/** Player 0's guns on island 1, an opponent's wall on island 2 at (16, 1) and (17, 1). */
const RANGE = [
  `
  ....................
  ..BB..........**##..
  ..BB..........**##..
  ....................
  ..BB................
  ..BB................
`,
  `
  ....................
  ................22..
  ................22..
  ....................
  ....................
  ....................
`,
] as const;

describe('firing a special tower', () => {
  it('fires a ready Big Bertha before a nearer cannon, the nearest of them', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    const chosen = findReadyCannon(state, 0, 16, 1);
    expect(chosen?.kind).toBe('bertha');
    expect(chosen?.y).toBe(1);
  });

  it('fires the cannons while Big Bertha is loading', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.shotId = 99;
    expect(findReadyCannon(state, 0, 16, 1)?.kind).toBe('cannon');
  });

  it('passes over an inert Big Bertha', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.active = false;
    expect(findReadyCannon(state, 0, 16, 1)?.kind).toBe('cannon');
  });

  it('fires the Rapid Cannon as any gun, on a shorter flight', () => {
    const state = stateFromAscii(
      `
      ....................
      ..**..........RR##..
      ..**..........RR##..
    `,
      SPECIALS,
      `
      ....................
      ................22..
      ................22..
    `,
    );
    const result = fire(state, 0, 16, 1);
    if (!('shot' in result)) throw new Error(result.rejection);
    expect(result.shot.kind).toBe('rapid');
    const { fromX, fromY } = result.shot;
    const ordinary = flightTicks(state, fromX, fromY, 16, 1);
    const rapid = flightTicks(state, fromX, fromY, 16, 1, SPECIALS.specials.rapid.flightFactor);
    expect(result.shot.impactTick - state.tick).toBe(rapid);
    expect(rapid).toBeLessThan(ordinary);
    // It must fire more than the two cannons it costs.
    expect(rapid * 2).toBeLessThan(ordinary);
  });

  it('leaves an ordinary gun’s flight exactly as it was', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    expect(flightTicks(state, 2.5, 1.5, 16, 1, 1)).toBe(flightTicks(state, 2.5, 1.5, 16, 1));
  });
});

describe('Big Bertha’s crater', () => {
  /** Island 2 a teammate's, island 3 an opponent's, water between them at (7, 1). */
  const BETWEEN = [
    `
    .............
    ..**.##.##...
    ..**.##.##...
    .............
    ..BB.........
    ..BB.........
  `,
    `
    .............
    .....22.33...
    .....22.33...
    .............
    .............
    .............
  `,
  ] as const;

  function landAt(state: MatchState, x: number, y: number): void {
    const result = fire(state, 0, x, y);
    if (!('shot' in result)) throw new Error(result.rejection);
    state.tick = result.shot.impactTick;
    resolveImpacts(state);
  }

  it('clears the tile and its four neighbours of an opponent’s wall', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    landAt(state, 16, 1);
    const at = (x: number, y: number): number => state.structure[y * state.width + x]!;
    expect(at(16, 1)).toBe(Structure.Empty);
    expect(at(17, 1)).toBe(Structure.Empty);
    expect(at(16, 2)).toBe(Structure.Empty);
    expect(at(17, 2)).toBe(Structure.Wall); // the diagonal stands
    expect(state.players[0]!.wallsDestroyed).toBe(3);
  });

  it('spares a teammate’s wall within its reach', () => {
    const state = stateFromAscii(BETWEEN[0], SPECIALS, BETWEEN[1]);
    state.players[1]!.team = 0;
    landAt(state, 7, 1);
    const at = (x: number, y: number): number => state.structure[y * state.width + x]!;
    expect(at(6, 1)).toBe(Structure.Wall); // the teammate's
    expect(at(8, 1)).toBe(Structure.Empty); // the opponent's
  });

  it('leaves the ordinary guns’ crater as the ruleset has it', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.shotId = 99;
    landAt(state, 16, 1);
    expect(state.structure[1 * state.width + 17]).toBe(Structure.Wall);
  });
});

describe('the Architect’s repair', () => {
  /**
   * Player 0's Architect at (3, 3) inside a ring, reaching x 1–6 and y 1–6 at radius 2, so
   * the ring's west wall but not its east; player 1's two cannons below.
   */
  const RING = [
    `
    ..............
    .##########...
    .#,,,,,,,,#...
    .#,AA,@@,,#...
    .#,AA,@@,,#...
    .#,,,,,,,,#...
    .##########...
    ..............
    ..**..**......
    ..**..**......
  `,
    `
    ..............
    ..............
    ..............
    ..............
    ..............
    ..............
    ..............
    ..............
    ..22..22......
    ..22..22......
  `,
  ] as const;
  const WEST = 3 * 14 + 1;
  const EAST = 3 * 14 + 10;

  /** Player 1 breaches both sides of the ring; the barrage ends with the last shot down. */
  function breached(ruleset: Ruleset = SPECIALS): MatchState {
    const state = stateFromAscii(RING[0], ruleset, RING[1]);
    applyEnclosure(state);
    // Player 1's guns stand on open ground in the picture; they fire all the same.
    for (const cannon of state.cannons) if (cannon.owner === 1) cannon.active = true;
    const shots = [fire(state, 1, 1, 3), fire(state, 1, 10, 3)];
    for (const shot of shots) if (!('shot' in shot)) throw new Error(shot.rejection);
    state.tick = Math.max(...shots.map((s) => ('shot' in s ? s.shot.impactTick : 0)));
    resolveImpacts(state);
    state.phase = 'intermission';
    state.pendingPhase = 'build';
    state.phaseEndTick = state.tick + 100;
    return state;
  }

  it('notes the walls shots take, only while towers are played', () => {
    expect(breached().lostWalls.sort()).toEqual([WEST, EAST].sort());
    expect(breached(defaultRuleset).lostWalls).toEqual([]);
  });

  it('rebuilds them within its radius once the barrage is over, and not beyond', () => {
    const state = breached();
    step(state);
    expect(state.structure[WEST]).toBe(Structure.Wall);
    expect(state.owner[WEST]).toBe(1);
    expect(state.structure[EAST]).toBe(Structure.Empty);
    expect(state.lostWalls).toEqual([]);
    expect(state.events.at(-1)).toEqual({
      kind: 'walls_repaired',
      tick: state.tick,
      player: 0,
      tiles: [WEST],
    });
    // The attacker keeps the points: the shots landed.
    expect(state.players[1]!.wallsDestroyed).toBe(2);
  });

  it('waits for the last shot in the air', () => {
    const state = breached();
    state.shots.push({
      id: 50,
      cannonId: 0,
      owner: 1,
      kind: 'cannon',
      fromX: 2.5,
      fromY: 8.5,
      toX: 12,
      toY: 0,
      launchTick: state.tick,
      impactTick: state.tick + 5,
    });
    step(state);
    expect(state.structure[WEST]).toBe(Structure.Empty);
    for (let i = 0; i < 5; i++) step(state);
    expect(state.structure[WEST]).toBe(Structure.Wall);
  });

  it('repairs nothing while it is inert', () => {
    const state = breached();
    state.cannons.find((c) => c.kind === 'architect')!.active = false;
    repairWalls(state);
    expect(state.structure[WEST]).toBe(Structure.Empty);
    expect(state.lostWalls).toEqual([]);
  });

  it('never builds over what stands there now', () => {
    const state = breached();
    state.structure[WEST] = Structure.Cannon;
    repairWalls(state);
    expect(state.structure[WEST]).toBe(Structure.Cannon);
    expect(state.events.some((e) => e.kind === 'walls_repaired')).toBe(false);
  });

  it('repairs only its own island', () => {
    // The Architect made player 1's: the walls lost are player 0's, so it leaves them.
    const state = breached();
    state.cannons.find((c) => c.kind === 'architect')!.owner = 1;
    repairWalls(state);
    expect(state.structure[WEST]).toBe(Structure.Empty);
  });
});
