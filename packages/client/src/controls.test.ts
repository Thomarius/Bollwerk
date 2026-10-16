import { defaultTerrainConfig } from '@bollwerk/config';
import {
  Rng,
  applyAction,
  applyEnclosure,
  beginMatch,
  createMatch,
  drainEvents,
  fastRuleset,
  legalCannonPlacements,
  scriptedAction,
  stateFromAscii,
  step,
  withSpecials,
  type MatchState,
} from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import {
  inputMode,
  maySwitchTower,
  mayTarget,
  nextReload,
  nextTowerShot,
  placeableCannons,
  readyCannons,
} from './controls.js';

/** Plays until somebody spends a life, then on to the cannon phase that follows. */
function afterContinue(seed: number): { state: MatchState; player: number } {
  const state = createMatch({
    seed,
    ruleset: fastRuleset(),
    terrainConfig: defaultTerrainConfig,
    players: [0, 1].map((i) => ({ name: `p${i}`, isBot: true })),
  });
  beginMatch(state);
  const rng = new Rng(seed);
  let continued: number | null = null;
  while (state.tick < 40_000 && state.phase !== 'game_over') {
    if (continued !== null && state.phase === 'cannon_place') return { state, player: continued };
    for (const p of state.players) {
      // The player who continued is left alone from then on, as a person reading the
      // screen would be before choosing.
      if (p.id === continued) continue;
      const action = scriptedAction(state, p.id, rng, { fireChance: 0.3, buildChance: 0.1 });
      if (action !== null) applyAction(state, action);
    }
    step(state);
    for (const e of drainEvents(state)) {
      if (e.kind === 'player_continued' && continued === null) continued = e.player;
    }
  }
  throw new Error('nobody spent a life');
}

describe('what a click means', () => {
  it('is choosing a castle, after a continue, before any cannon', () => {
    // The bug this exists for: after a continue the cannon phase offered a person a
    // 2x2 cannon with nowhere to put it, and no way to choose the castle the rules
    // were waiting for.
    const { state, player } = afterContinue(3);
    expect(inputMode(state, player)).toBe('castle');

    const castle = state.castles.find((c) => c.islandId === state.players[player]!.islandId)!;
    expect(applyAction(state, { kind: 'select_castle', player, castleId: castle.id })).toBeNull();

    // Then the guns, inside the ring that choice raised.
    expect(inputMode(state, player)).toBe('cannon');
    expect(legalCannonPlacements(state, player).length).toBeGreaterThan(0);
  });

  it('follows the phase for everyone else', () => {
    const { state, player } = afterContinue(3);
    const other = 1 - player;
    // Random play fails a lot, and both may have spent a life together; then the other
    // chooses too, and is placing guns from there on.
    const own = state.castles.find((c) => c.islandId === state.players[other]!.islandId)!;
    if (inputMode(state, other) === 'castle') {
      applyAction(state, { kind: 'select_castle', player: other, castleId: own.id });
    }
    expect(inputMode(state, other)).toBe('cannon');
    state.phase = 'build';
    expect(inputMode(state, other)).toBe('piece');
    state.phase = 'combat';
    expect(inputMode(state, other)).toBe('fire');
    state.players[other]!.eliminated = true;
    expect(inputMode(state, other)).toBe('none');
  });

  it('aims while combat is announced, and holds nothing once overtime is spent', () => {
    const { state, player } = afterContinue(3);
    const other = 1 - player;
    state.phase = 'intermission';
    state.pendingPhase = 'combat';
    expect(inputMode(state, other)).toBe('aim');
    state.pendingPhase = 'build';
    expect(inputMode(state, other)).toBe('none');

    // As a fresh build phase leaves it: last round's overtime is cleared when it opens.
    state.phase = 'build';
    state.overtime = true;
    state.players[other]!.overtimeSpent = false;
    expect(inputMode(state, other)).toBe('piece');
    state.players[other]!.overtimeSpent = true;
    expect(inputMode(state, other)).toBe('none');
  });

  it('counts the cannons that could fire now', () => {
    const { state, player } = afterContinue(3);
    const other = 1 - player;
    const mine = state.cannons.filter((c) => c.owner === other);
    const expected = mine.filter((c) => c.active && c.shotIds.length === 0).length;
    expect(readyCannons(state, other)).toBe(expected);
    // One in the air is one fewer.
    const loaded = mine.find((c) => c.active && c.shotIds.length === 0);
    if (loaded) {
      loaded.shotIds = [999];
      expect(readyCannons(state, other)).toBe(expected - 1);
    }
  });

  it('never lets the cursor aim at a teammate’s island, or your own', () => {
    const { state } = afterContinue(3);
    state.players[1]!.team = state.players[0]!.team;
    const tileOf = (island: number) => {
      const i = state.islandId.findIndex((v) => v === island);
      return { x: i % state.width, y: Math.floor(i / state.width) };
    };
    const mate = tileOf(2);
    const own = tileOf(1);
    expect(mayTarget(state, 0, mate.x, mate.y)).toBe(false);
    expect(mayTarget(state, 0, own.x, own.y)).toBe(false);
    // Open water is anybody's to aim at.
    const water = state.islandId.findIndex((v) => v === 0);
    expect(mayTarget(state, 0, water % state.width, Math.floor(water / state.width))).toBe(true);
  });
});

describe('the next gun to be ready', () => {
  /** Two of player 0's guns, each with a shot in the air, and the clock at tick 40. */
  function twoLoading(): MatchState {
    const state = stateFromAscii(`
      ........
      .**.**..
      .**.**..
      ........
    `);
    state.tick = 40;
    const [a, b] = state.cannons;
    state.shots = [
      {
        id: 1,
        cannonId: a!.id,
        kind: 'cannon',
        cost: 1,
        owner: 0,
        fromX: 1,
        fromY: 1,
        toX: 7,
        toY: 3,
        launchTick: 0,
        impactTick: 100,
      },
      {
        id: 2,
        cannonId: b!.id,
        kind: 'cannon',
        cost: 1,
        owner: 0,
        fromX: 4,
        fromY: 1,
        toX: 7,
        toY: 3,
        launchTick: 30,
        impactTick: 50,
      },
    ];
    a!.shotIds = [1];
    b!.shotIds = [2];
    for (const cannon of state.cannons) cannon.active = true;
    return state;
  }

  it('follows the shot that lands first, as a share of its flight', () => {
    // The second shot lands at 50, before the first at 100: 10 of its 20 ticks are gone.
    expect(nextReload(twoLoading(), 0)).toBe(0.5);
    // And between ticks, so the cursor fills smoothly.
    expect(nextReload(twoLoading(), 0, 0.5)).toBe(0.525);
  });

  it('says nothing while a gun is ready, or none could fire at all', () => {
    const ready = twoLoading();
    ready.cannons[0]!.shotIds = [];
    expect(nextReload(ready, 0)).toBeNull();
    // An inert gun reloads nothing: its shot landing would not let a click fire.
    const inert = twoLoading();
    for (const cannon of inert.cannons) cannon.active = false;
    expect(nextReload(inert, 0)).toBeNull();
    // Another player's guns are not this one's.
    expect(nextReload(twoLoading(), 1)).toBeNull();
  });
});

describe('the next shot a tower fires', () => {
  /** Player 0's cannon and Big Bertha side by side, both active, both loaded. */
  function battery(): MatchState {
    const state = stateFromAscii(`
      ..........
      .**..BB...
      .**..BB...
      ..........
    `);
    for (const cannon of state.cannons) cannon.active = true;
    return state;
  }

  it('is a ready Bertha’s cross, wherever the cursor is', () => {
    // Nearer the cannon, yet the Bertha fires first, as the sim chooses.
    const next = nextTowerShot(battery(), 0, 0, 1);
    expect(next?.kind).toBe('bertha');
    expect([...(next?.crater ?? [])].sort()).toEqual(
      [
        [0, 0],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ].sort(),
    );
  });

  it('is nothing while she loads, the next shot a cannon’s', () => {
    const state = battery();
    state.cannons.find((c) => c.kind === 'bertha')!.shotIds = [99];
    expect(nextTowerShot(state, 0, 0, 1)).toBeNull();
  });
});

describe('the cannons still to place', () => {
  /** Player 0's castle sealed in a cannon phase, with room for guns or none. */
  function placing(art: string): MatchState {
    const state = stateFromAscii(art, withSpecials(fastRuleset()));
    applyEnclosure(state);
    state.phase = 'cannon_place';
    state.phaseEndTick = 100_000;
    const player = state.players[0]!;
    player.startingCastleId = state.castles[0]!.id;
    player.cannonsToPlace = 3;
    player.special = 'bertha2';
    return state;
  }
  const ROOMY = `
    ..........
    .########.
    .#,,,,,,#.
    .#,@@,,,#.
    .#,@@,,,#.
    .#,,,,,,#.
    .########.
    ..........
  `;
  const TIGHT = `
    ......
    .####.
    .#@@#.
    .#@@#.
    .####.
    ......
  `;

  it('are the count while one still fits', () => {
    expect(placeableCannons(placing(ROOMY), 0)).toBe(3);
  });

  it('are none once nowhere is left for one, though the sim keeps the count', () => {
    const state = placing(TIGHT);
    expect(state.players[0]!.cannonsToPlace).toBe(3);
    expect(placeableCannons(state, 0)).toBe(0);
    // Nor does the right button offer the tower with nowhere to stand it.
    expect(maySwitchTower(state, 0)).toBe(false);
  });

  it('offer the tower where the rules sell it and a gun fits', () => {
    const state = placing(ROOMY);
    expect(maySwitchTower(state, 0)).toBe(true);
    state.players[0]!.openingPlacement = true;
    expect(maySwitchTower(state, 0)).toBe(false);
  });
});
