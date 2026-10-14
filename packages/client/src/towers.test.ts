import { defaultRuleset } from '@bollwerk/config';
import { drawnSpecial } from '@bollwerk/ai';
import type { Seat } from '@bollwerk/protocol';
import { applyEnclosure, stateFromAscii, withSpecials, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { impactReadiness } from './controls.js';
import { lobbyMarkup, type LobbyView } from './lobby.js';
import { towerLine, towerName } from './towers.js';

/** Player 0's sealed ring, in a cannon phase, bringing Big Bertha with three cannons. */
function cannonPhase(): MatchState {
  const state = stateFromAscii(
    `
    ............
    .##########.
    .#,,,,,,,,#.
    .#,@@,,,,,#.
    .#,@@,,,,,#.
    .#,,,,,,,,#.
    .##########.
    ............
  `,
    withSpecials(defaultRuleset),
  );
  applyEnclosure(state);
  state.phase = 'cannon_place';
  const player = state.players[0]!;
  player.startingCastleId = 0;
  player.special = 'bertha';
  player.cannonsToPlace = 3;
  return state;
}

describe('the tower line in a cannon phase', () => {
  it('offers the tower and its price, and says when it is the ghost', () => {
    const state = cannonPhase();
    expect(towerLine(state, 0, false)).toContain(towerName('bertha'));
    expect(towerLine(state, 0, false)).toContain('3');
    expect(towerLine(state, 0, true)).not.toBe(towerLine(state, 0, false));
  });

  it('says why not, where it may not be bought', () => {
    const state = cannonPhase();
    state.players[0]!.openingPlacement = true;
    const opening = towerLine(state, 0, false);
    state.players[0]!.openingPlacement = false;
    state.players[0]!.specialsBought = 1;
    const bought = towerLine(state, 0, false);
    state.players[0]!.specialsBought = 0;
    state.players[0]!.cannonsToPlace = 2;
    const dear = towerLine(state, 0, false);
    expect(new Set([opening, bought, dear]).size).toBe(3);
    for (const line of [opening, bought, dear]) expect(line).toContain(towerName('bertha'));
  });

  it('says nothing for none brought, towers off, or outside the cannon phase', () => {
    const none = cannonPhase();
    none.players[0]!.special = null;
    expect(towerLine(none, 0, false)).toBeNull();
    const combat = cannonPhase();
    combat.phase = 'combat';
    expect(towerLine(combat, 0, false)).toBeNull();
    const off = cannonPhase();
    off.ruleset = defaultRuleset;
    expect(towerLine(off, 0, false)).toBeNull();
  });
});

describe('the cursor and the impact towers', () => {
  function armed(): MatchState {
    const state = stateFromAscii(`
      ..........
      .BB....**.
      .BB....**.
    `);
    for (const cannon of state.cannons) cannon.active = true;
    return state;
  }

  it('says when one is ready, and otherwise how far the next is from it', () => {
    const state = armed();
    expect(impactReadiness(state, 0)).toEqual({ ready: true });
    const bertha = state.cannons.find((c) => c.kind === 'bertha')!;
    bertha.shotId = 9;
    state.tick = 40;
    state.shots = [
      {
        id: 9,
        cannonId: bertha.id,
        owner: 0,
        kind: 'bertha',
        fromX: 1.5,
        fromY: 1.5,
        toX: 9,
        toY: 1,
        launchTick: 30,
        impactTick: 50,
      },
    ];
    expect(impactReadiness(state, 0)).toEqual({ ready: false, reload: 0.5 });
  });

  it('says nothing for a player with none that can fire', () => {
    const state = armed();
    for (const cannon of state.cannons) if (cannon.kind === 'bertha') cannon.active = false;
    expect(impactReadiness(state, 0)).toBeNull();
  });
});

describe('the lobby with special towers', () => {
  const seat = (playerId: number, name: string, special: Seat['special'] = null): Seat => ({
    playerId,
    name,
    isBot: false,
    connected: true,
    ready: false,
    special,
  });
  const view = (specials: boolean): LobbyView => ({
    code: null,
    playerCount: 3,
    hostId: 0,
    humanPlayer: 0,
    seats: [seat(0, 'Ada', 'architect'), seat(1, 'Bo', 'rapid')],
    bots: [5, 5, 5],
    settings: { maxRounds: 10, teamSize: 1, continues: 2, specials },
    settingBounds: {
      maxRounds: { min: 5, max: 20 },
      teamSize: { min: 1, max: 4 },
      continues: { min: 0, max: 4 },
    },
    teams: [0, 1, 2],
    playerLimits: { min: 2, max: 8 },
    seed: 42,
    hostBot: null,
  });

  it('gives the host the switch, and shows no tower while it is off', () => {
    const off = lobbyMarkup(view(false));
    expect(off).toContain('id="specials"');
    expect(off).not.toContain('id="my-special"');
    expect(off).not.toContain(towerName('rapid'));
  });

  it('lets each person choose their own, and shows everyone else’s and the bots’ draws', () => {
    const html = lobbyMarkup(view(true));
    expect(html).toContain('id="my-special"');
    expect(html).toMatch(/<option value="architect" selected>/);
    expect(html).toContain(towerName('rapid'));
    expect(html).toContain(towerName(drawnSpecial(42, 2)));
  });
});
