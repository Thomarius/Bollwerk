import { defaultRuleset } from '@bollwerk/config';
import { drawnSpecial } from '@bollwerk/ai';
import type { Seat } from '@bollwerk/protocol';
import { applyEnclosure, stateFromAscii, withSpecials, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { impactReadiness } from './controls.js';
import { lobbyMarkup, type LobbyView } from './lobby.js';
import { offeredTowers, towerMenuMarkup, variantForCard } from './towerChoice.js';
import { towerLine, towerName, towerWhat, variantName } from './towers.js';

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
  player.special = 'bertha3';
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
    bertha.shotIds = [9];
    state.tick = 40;
    state.shots = [
      {
        id: 9,
        cannonId: bertha.id,
        owner: 0,
        kind: 'bertha',
        cost: 3,
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
    seats: [seat(0, 'Ada', 'architect2'), seat(1, 'Bo', 'rapid3')],
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
    // The person's own a button opening the tower menu, showing what they chose.
    expect(html).toContain('id="my-special"');
    expect(html).toContain('data-variant="architect2"');
    expect(html).not.toContain('<select id="my-special"');
    expect(html).toContain(variantName('rapid3'));
    expect(html).toContain(variantName(drawnSpecial(42, 2, defaultRuleset.specials)));
  });

  it('describes each variant by its own numbers', () => {
    const { specials } = defaultRuleset;
    const ruleset = {
      ...defaultRuleset,
      specials: {
        ...specials,
        bertha: { ...specials.bertha, '2': { ...specials.bertha['2']!, flightFactor: 1.5 } },
        architect: {
          '2': { ...specials.architect['2']!, repairRadius: 4 },
          '3': { ...specials.architect['3']!, repairRadius: 7 },
        },
      },
    };
    // The reach told as blocks across: twice the radius.
    expect(towerWhat('architect2', ruleset)).toContain('8');
    expect(towerWhat('architect3', ruleset)).toContain('14');
    expect(towerWhat('rapid3')).toContain('3');
    // Her two costs as the rules have them differ by the shell, and the text says how.
    expect(towerWhat('bertha2')).not.toBe(towerWhat('bertha3'));
    // A Bertha whose shell flies slower than a gun's says so.
    expect(towerWhat('bertha2', ruleset)).not.toBe(towerWhat('bertha3', ruleset));
    // The Allerdickste's crater and her flight, as the rules have them.
    // Told by its tiles: radius 2 and 2.5 are both 5 across, 13 and 21 tiles.
    expect(towerWhat('biggest2')).toContain('13 tiles');
    expect(towerWhat('biggest3')).toContain('21 tiles');
    expect(towerWhat('biggest3')).toContain('10 seconds');
  });
});

describe('the tower menu', () => {
  it('offers none and every tower, each at the costs the rules offer', () => {
    expect(offeredTowers()).toEqual([
      { kind: 'bertha', costs: [2, 3] },
      { kind: 'architect', costs: [2, 3] },
      { kind: 'rapid', costs: [2, 3] },
      { kind: 'lightning', costs: [2, 3] },
      { kind: 'biggest', costs: [2, 3] },
    ]);
    const html = towerMenuMarkup(null);
    for (const kind of ['none', 'bertha', 'architect', 'rapid', 'lightning', 'biggest']) {
      expect(html).toContain(`data-kind="${kind}"`);
    }
    expect(html).toContain('class="card chosen" data-kind="none"');
    // None has no cost to choose.
    expect(html).not.toContain('class="costs"');
  });

  it('shows the chosen tower’s cost and what that variant does', () => {
    const html = towerMenuMarkup('architect3');
    expect(html).toContain('class="card chosen" data-kind="architect"');
    expect(html).toMatch(/class="cost chosen" data-cost="3"/);
    expect(html).toContain(towerWhat('architect3'));
  });

  it('keeps the cost chosen when the tower changes, else takes the cheapest', () => {
    expect(variantForCard('bertha', null)).toBe('bertha2');
    expect(variantForCard('bertha', 3)).toBe('bertha3');
    expect(variantForCard('rapid', 3)).toBe('rapid3');
    expect(variantForCard('lightning', 2)).toBe('lightning2');
    // A cost the rules do not offer falls back to the cheapest.
    expect(variantForCard('rapid', 5)).toBe('rapid2');
  });
});
