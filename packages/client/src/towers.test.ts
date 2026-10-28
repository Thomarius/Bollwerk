import { defaultRuleset, offeredVariants, variantCost, variantKind } from '@bollwerk/config';
import { drawnSpecial } from '@bollwerk/ai';
import type { Seat } from '@bollwerk/protocol';
import { applyEnclosure, stateFromAscii, withSpecials, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { impactReadiness } from './controls.js';
import { lobbyMarkup, type LobbyView } from './lobby.js';
import { offeredTowers, towerMenuMarkup, variantForCard } from './towerChoice.js';
import { language, setLanguage } from './i18n.js';
import { preferredTower, saveTower, towerLine, towerName, towerWhat } from './towers.js';

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
    // Bo's page: Ada's choice and the bot's draw are shown, not to be pressed.
    const html = lobbyMarkup({ ...view(true), humanPlayer: 1 });
    // The person's own a button opening the tower menu, showing what they chose.
    expect(html).toContain('id="my-special"');
    expect(html).toContain('data-variant="rapid3"');
    expect(html).not.toContain('<select id="my-special"');
    expect(html).not.toContain('bot-tower');
    // Everyone else's a small icon before the name, a dot a cannon under it, its name and what
    // it does on hover; not to be pressed.
    const badges = html
      .split('class="tower-mini tower-badge"')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('class="who"')));
    const drawn = drawnSpecial(42, 2, defaultRuleset.specials);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toContain(`data-tip="${towerName('architect')}: `);
    expect(badges[0]).toContain('<span class="pips">••</span>');
    expect(badges[0]).not.toContain('drawn-mark');
    expect(badges[1]).toContain(`data-tip="${towerName(variantKind(drawn))}: `);
    expect(badges[1]).toContain(`<span class="pips">${'•'.repeat(variantCost(drawn))}</span>`);
    expect(badges[1]).toContain('class="drawn-mark"');
  });

  it("gives the host a button for each bot's tower, its draw marked with a die until chosen", () => {
    const bots = (botTowers?: LobbyView['botTowers']): string[] => {
      const html = lobbyMarkup({
        ...view(true),
        ...(botTowers === undefined ? {} : { botTowers }),
      });
      return [
        ...html.matchAll(
          /<button[^>]*class="tower-mini tower-button bot-tower"[^>]*>.*?<\/button>/g,
        ),
      ].map((m) => m[0]);
    };
    const drawn = drawnSpecial(42, 2, defaultRuleset.specials);
    const [left] = bots();
    expect(left).toContain('data-seat="2" data-choice="drawn"');
    expect(left).toContain(towerName(variantKind(drawn)));
    expect(left).toContain('class="drawn-mark"');
    // None chosen is none, not the draw: null is a choice of its own.
    const [none] = bots(['drawn', 'drawn', null]);
    expect(none).toContain('data-choice="none"');
    expect(none).toContain(towerName(null));
    expect(none).not.toContain('drawn-mark');
    const [chosen] = bots(['drawn', 'drawn', 'laser3']);
    expect(chosen).toContain('data-choice="laser3"');
    expect(chosen).toContain(towerName('laser'));
    // A guest sees the host's choice as a badge.
    const guest = lobbyMarkup({
      ...view(true),
      humanPlayer: 1,
      botTowers: ['drawn', 'drawn', null],
    });
    expect(guest).not.toContain('bot-tower');
    expect(guest).toContain(towerName(null));
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
    // The Laser's walls pierced, and a fraction told as the chance of one more.
    expect(towerWhat('laser2')).toContain('first 2 wall blocks');
    expect(towerWhat('laser2')).not.toContain('one more');
    expect(towerWhat('laser3')).toContain('first 2 wall blocks');
    expect(towerWhat('laser3')).toContain('one more 50%');
    const fractional = {
      ...defaultRuleset,
      specials: {
        ...specials,
        laser: { '2': { ...specials.laser!['2']!, pierce: 3.25 } },
      },
    };
    expect(towerWhat('laser2', fractional)).toContain('first 3 wall blocks');
    expect(towerWhat('laser2', fractional)).toContain('one more 25%');
    // The Frost Cannon's freeze: the whole phase until the clock runs out at cost 3, its first
    // 60% at cost 2.
    expect(towerWhat('frost3')).toContain('until its clock runs out');
    expect(towerWhat('frost2')).toContain('first 60%');
    // The Lullaby Tower's guns lulled by its cost, its reach and its sleep.
    expect(towerWhat('lullaby2')).toContain('lulls the 2 enemy guns');
    expect(towerWhat('lullaby3')).toContain('lulls the 3 enemy guns');
    expect(towerWhat('lullaby3')).toContain('within 8 blocks');
    expect(towerWhat('lullaby3')).toContain('for 3 seconds');
    expect(towerWhat('lullaby3')).toContain('after 2 lullabies');
  });
});

describe('the tower menu', () => {
  it('offers every tower at the costs the rules offer, and no tower first', () => {
    expect(offeredTowers()).toEqual([
      { kind: 'bertha', costs: [2, 3] },
      { kind: 'architect', costs: [2, 3] },
      { kind: 'rapid', costs: [2, 3] },
      { kind: 'lightning', costs: [2, 3] },
      { kind: 'biggest', costs: [2, 3] },
      { kind: 'laser', costs: [2, 3] },
      { kind: 'frost', costs: [2, 3] },
      { kind: 'lullaby', costs: [2, 3] },
    ]);
    const html = towerMenuMarkup('bertha2');
    expect(html.match(/data-kind="\w+"/)?.[0]).toBe('data-kind="none"');
    expect(html).toContain('class="card chosen" data-kind="bertha"');
    // A person's menu has no Random.
    expect(html).not.toContain('class="random');
  });

  it('chooses none as a card of its own, both costs off', () => {
    const html = towerMenuMarkup(null);
    expect(html).toContain('class="card chosen" data-kind="none"');
    expect(html).toMatch(/data-cost="2" disabled/);
    expect(html).toMatch(/data-cost="3" disabled/);
  });

  it("offers a bot's menu Random, its draw's card marked rather than chosen", () => {
    const html = towerMenuMarkup('drawn', 'frost3');
    expect(html).toContain('class="random chosen"');
    expect(html).toContain('class="card drawn" data-kind="frost"');
    expect(html).not.toContain('card chosen');
    expect(html).toContain(towerWhat('frost3'));
    // Chosen over the draw, Random is offered but no longer chosen.
    const chosen = towerMenuMarkup('frost2', 'frost3');
    expect(chosen).toContain('class="random"');
    expect(chosen).toContain('class="card chosen" data-kind="frost"');
  });

  it('shows the cards alphabetically by their names in the language shown', () => {
    const order = (): string[] =>
      [...towerMenuMarkup('bertha2').matchAll(/data-kind="(\w+)"/g)].map((m) => m[1] as string);
    const before = language();
    try {
      setLanguage('en');
      expect(order()).toEqual([
        'none',
        'biggest',
        'architect',
        'bertha',
        'frost',
        'laser',
        'lightning',
        'lullaby',
        'rapid',
      ]);
      setLanguage('de');
      expect(order()).toEqual([
        'none',
        'biggest',
        'architect',
        'lightning',
        'bertha',
        'frost',
        'laser',
        'lullaby',
        'rapid',
      ]);
    } finally {
      setLanguage(before);
    }
  });

  it('draws a tower for a player who never chose one, the same all visit', () => {
    const drawn = preferredTower();
    expect(offeredVariants(defaultRuleset.specials)).toContain(drawn);
    expect(preferredTower()).toBe(drawn);
  });

  it('brings none back as none once chosen, and a tower chosen as that tower', () => {
    const items = new Map<string, string>();
    const before = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => items.set(k, v),
      },
    });
    try {
      saveTower(null);
      expect(preferredTower()).toBeNull();
      saveTower('laser3');
      expect(preferredTower()).toBe('laser3');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: before });
    }
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
