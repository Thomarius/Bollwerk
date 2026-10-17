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

/**
 * Towers played, with levers of the tests' own — the balance in config/ is tuned by soaks
 * and moves, the rules under test do not: an Architect of cost 2 reaching 3 tiles from its
 * centre, of cost 3 reaching 4, and every Rapid Cannon's barrels flying as a cannon's.
 */
const SPECIALS: Ruleset = (() => {
  const ruleset = withSpecials(defaultRuleset);
  const { architect, rapid } = ruleset.specials;
  return {
    ...ruleset,
    specials: {
      ...ruleset.specials,
      architect: {
        '2': { ...architect['2']!, repairRadius: 3 },
        '3': { ...architect['3']!, repairRadius: 4 },
      },
      rapid: { '2': { ...rapid['2']!, flightFactor: 1 }, '3': { ...rapid['3']!, flightFactor: 1 } },
    },
  };
})();

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
  player.special = 'bertha3';
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
    expect(state.events.at(-1)).toMatchObject({
      kind: 'cannon_placed',
      cannonKind: 'bertha',
      cannonCost: 3,
    });
  });

  it('takes a cheaper variant’s cost, and stands it at that cost', () => {
    const state = cannonPhase();
    state.players[0]!.special = 'bertha2';
    const result = placeCannon(state, 0, 5, 3, true);
    expect('cannon' in result && [result.cannon.kind, result.cannon.cost]).toEqual(['bertha', 2]);
    expect(state.players[0]!.cannonsToPlace).toBe(1);
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
        bertha: {
          ...SPECIALS.specials.bertha,
          '3': { ...SPECIALS.specials.bertha['3']!, footprint: [3, 3] },
        },
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

  it('scores as the cannons it cost', () => {
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
    // A cannon and Big Bertha, who cost three.
    expect(holdingsOf(state)[0]!.guns).toBe(1 + 3);
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
          { name: 'a', isBot: true, special: 'rapid2' },
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
    expect(state.players.map((p) => p.special)).toEqual(['rapid2', null]);
    const classic = createMatch({
      seed: 7,
      ruleset: fastRuleset(),
      terrainConfig: defaultTerrainConfig,
      players: [
        { name: 'a', isBot: true, special: 'rapid2' },
        { name: 'b', isBot: true },
      ],
    });
    expect(classic.players[0]!.special).toBeNull();
  });

  it('gives none for a variant the ruleset does not offer', () => {
    const ruleset = withSpecials(fastRuleset());
    const { rapid } = ruleset.specials;
    const offered = { ...ruleset, specials: { ...ruleset.specials, rapid: { '3': rapid['3'] } } };
    const state = createMatch({
      seed: 7,
      ruleset: offered,
      terrainConfig: defaultTerrainConfig,
      players: [
        { name: 'a', isBot: true, special: 'rapid2' },
        { name: 'b', isBot: true, special: 'rapid3' },
      ],
    });
    expect(state.players.map((p) => p.special)).toEqual([null, 'rapid3']);
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
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.shotIds = [99];
    expect(findReadyCannon(state, 0, 16, 1)?.kind).toBe('cannon');
  });

  it('passes over an inert Big Bertha', () => {
    const state = stateFromAscii(RANGE[0], SPECIALS, RANGE[1]);
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.active = false;
    expect(findReadyCannon(state, 0, 16, 1)?.kind).toBe('cannon');
  });

  /** Player 0's Rapid Cannon of the glyph's cost alone on island 1, an opponent's wall. */
  function rapid(glyph: 'R' | 'r'): MatchState {
    return stateFromAscii(
      `
      ....................
      ..${glyph}${glyph}............##..
      ..${glyph}${glyph}............##..
    `,
      SPECIALS,
      `
      ....................
      ................22..
      ................22..
    `,
    );
  }

  it('fires a Rapid Cannon as the cannons it cost, each barrel on its own flight', () => {
    for (const [glyph, barrels] of [
      ['r', 2],
      ['R', 3],
    ] as const) {
      const state = rapid(glyph);
      const shots = [];
      for (let i = 0; i < barrels; i++) {
        const result = fire(state, 0, 16, 1);
        if (!('shot' in result)) throw new Error(result.rejection);
        shots.push(result.shot);
        state.tick++;
      }
      expect(fire(state, 0, 16, 1)).toEqual({ rejection: 'no_ready_cannon' });
      // As quick as any gun, at a flight factor of 1.
      const { fromX, fromY } = shots[0]!;
      const flight = flightTicks(state, fromX, fromY, 16, 1);
      expect(shots.map((s) => s.impactTick - s.launchTick)).toEqual(
        new Array(barrels).fill(flight),
      );
      // The first shot down frees its barrel, and only that one.
      state.tick = shots[0]!.impactTick;
      resolveImpacts(state);
      expect(state.cannons[0]!.shotIds).toEqual(shots.slice(1).map((s) => s.id));
      expect('shot' in fire(state, 0, 16, 1)).toBe(true);
      expect(fire(state, 0, 16, 1)).toEqual({ rejection: 'no_ready_cannon' });
    }
  });

  it('flies each Big Bertha’s shot by her own variant’s factor', () => {
    const { bertha } = SPECIALS.specials;
    const ruleset = {
      ...SPECIALS,
      specials: {
        ...SPECIALS.specials,
        bertha: {
          '2': { ...bertha['2']!, flightFactor: 1.5 },
          '3': { ...bertha['3']!, flightFactor: 0.5 },
        },
      },
    };
    for (const [glyph, cost, factor] of [
      ['b', 2, 1.5],
      ['B', 3, 0.5],
    ] as const) {
      const state = stateFromAscii(RANGE[0].replaceAll('B', glyph), ruleset, RANGE[1]);
      const result = fire(state, 0, 16, 1);
      if (!('shot' in result)) throw new Error(result.rejection);
      expect([result.shot.kind, result.shot.cost]).toEqual(['bertha', cost]);
      const { fromX, fromY } = result.shot;
      expect(result.shot.impactTick - state.tick).toBe(
        flightTicks(state, fromX, fromY, 16, 1, factor),
      );
    }
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
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.shotIds = [99];
    landAt(state, 16, 1);
    expect(state.structure[1 * state.width + 17]).toBe(Structure.Wall);
  });
});

describe('the Architect’s repair', () => {
  /**
   * Player 0's Architect of cost 2 at (3, 3) inside a ring, its centre at (4, 4) and its
   * reach 3 round it: the ring's west wall but not its east, nor the ring's corner beside
   * it, 3.5 off diagonally; player 1's two cannons below.
   */
  const RING = [
    `
    ..............
    .##########...
    .#,,,,,,,,#...
    .#,aa,@@,,#...
    .#,aa,@@,,#...
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
      towers: 1,
    });
    // The attacker keeps the points: the shots landed.
    expect(state.players[1]!.wallsDestroyed).toBe(2);
  });

  it('reaches as far as its cost’s variant says', () => {
    const architect = { ...SPECIALS.specials.architect['3']!, repairRadius: 7 };
    const ruleset = {
      ...SPECIALS,
      specials: {
        ...SPECIALS.specials,
        architect: { ...SPECIALS.specials.architect, '3': architect },
      },
    };
    const state = breached(ruleset);
    state.cannons.find((c) => c.kind === 'architect')!.cost = 3;
    repairWalls(state);
    expect(state.structure[WEST]).toBe(Structure.Wall);
    expect(state.structure[EAST]).toBe(Structure.Wall);
  });

  it('reaches round, not square', () => {
    // The corner is 2 tiles out from the footprint as the west wall's end is, but diagonally.
    const state = breached();
    const corner = 1 * 14 + 1;
    const end = 5 * 14 + 1;
    for (const i of [corner, end]) {
      state.structure[i] = Structure.Empty;
      state.lostWalls.push(i);
    }
    repairWalls(state);
    expect(state.structure[end]).toBe(Structure.Wall);
    expect(state.structure[corner]).toBe(Structure.Empty);
  });

  it('waits for the last shot in the air', () => {
    const state = breached();
    state.shots.push({
      id: 50,
      cannonId: 0,
      owner: 1,
      kind: 'cannon',
      cost: 1,
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

  it('counts the Architects that rebuilt anything, for the sound of each', () => {
    // A second Architect by the east wall: both rebuild, then only the first when the east
    // wall still stands.
    const withSecond = (): MatchState => {
      const state = breached();
      const first = state.cannons.find((c) => c.kind === 'architect')!;
      state.cannons.push({ ...first, id: 90, x: 8, y: 4, shotIds: [] });
      return state;
    };
    const repaired = (state: MatchState) =>
      state.events.find((e) => e.kind === 'walls_repaired') as { towers: number } | undefined;
    const both = withSecond();
    repairWalls(both);
    expect(both.structure[EAST]).toBe(Structure.Wall);
    expect(repaired(both)?.towers).toBe(2);
    const one = withSecond();
    one.structure[EAST] = Structure.Wall;
    repairWalls(one);
    expect(repaired(one)?.towers).toBe(1);
  });

  it('repairs only its own island', () => {
    // The Architect made player 1's: the walls lost are player 0's, so it leaves them.
    const state = breached();
    state.cannons.find((c) => c.kind === 'architect')!.owner = 1;
    repairWalls(state);
    expect(state.structure[WEST]).toBe(Structure.Empty);
  });
});
