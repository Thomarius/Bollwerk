import type { Seat } from '@bollwerk/protocol';
import { describe, expect, it } from 'vitest';

import { lobbyMarkup, type LobbyView } from './lobby.js';
import { SHAPE_PATHS } from './shapes.js';

function seat(playerId: number, name: string, connected = true): Seat {
  return { playerId, name, isBot: false, connected, ready: false };
}

function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    code: 'ABC123',
    playerCount: 4,
    hostId: 0,
    humanPlayer: 0,
    seats: [seat(0, 'Ada')],
    bots: [5, 5, 5, 5],
    settings: { maxRounds: 10, teamSize: 1 },
    settingBounds: { maxRounds: { min: 5, max: 20 }, teamSize: { min: 1, max: 4 } },
    teams: [0, 1, 2, 3],
    playerLimits: { min: 2, max: 8 },
    seed: 42,
    hostBot: null,
    ...over,
  };
}

/** Seat rows, in table order. */
function rows(html: string): string[] {
  return [...html.matchAll(/<li class="seat[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? '');
}

describe('lobby', () => {
  it('shows a row for every place at the table, taken or not', () => {
    expect(rows(lobbyMarkup(view()))).toHaveLength(4);
  });

  it('holds eight seats, which is the most the rules allow', () => {
    // The cap was raised from four and the lobby was never looked at beyond it.
    const html = lobbyMarkup(
      view({
        playerCount: 8,
        seats: [seat(0, 'Ada'), seat(3, 'Bo')],
        bots: Array.from({ length: 8 }, () => 8),
      }),
    );
    expect(rows(html)).toHaveLength(8);
    // And the two people are in their own seats, not shuffled to the front.
    expect(rows(html)[0]).toContain('Ada');
    expect(rows(html)[3]).toContain('Bo');
    expect(rows(html)[1]).toContain('Bot 2');
  });

  it('numbers every seat in the colour it will play in, as its island is labelled', () => {
    // The seed is fixed while the table is set, so the deal — and the colours — are known.
    const html = lobbyMarkup(view({ seatColours: ['#c8283c', '#2850c8', '#d8a020', '#28a050'] }));
    expect(rows(html)[0]).toContain('style="background:#c8283c">1</b>');
    expect(rows(html)[3]).toContain('style="background:#28a050">4</b>');
  });

  it('puts the shape each seat will carry beside its number, in its colour', () => {
    const html = lobbyMarkup(
      view({
        seatColours: ['#c8283c', '#2850c8', '#d8a020', '#28a050'],
        seatShapes: ['star', 'circle', 'plus', 'square'],
      }),
    );
    expect(rows(html)[0]).toContain(`>1</b><svg class="shape"`);
    expect(rows(html)[0]).toContain(`fill="#c8283c"`);
    expect(rows(html)[2]).toContain(`d="${SHAPE_PATHS.plus}" fill="#d8a020"`);
  });

  it('shows each bot seat’s level as pips, filled up to it, to the host and guests alike', () => {
    const table = view({ bots: [5, 3, 8, 10] });
    for (const html of [lobbyMarkup(table), lobbyMarkup({ ...table, humanPlayer: 1 })]) {
      const pips = (row: string): number => row.split('<i class="on"></i>').length - 1;
      expect(pips(rows(html)[1] ?? '')).toBe(3);
      expect(pips(rows(html)[2] ?? '')).toBe(8);
      expect(rows(html)[3]).toContain('title="Level 10"');
    }
  });

  it('shows the map, and lets only the host draw another', () => {
    const asHost = lobbyMarkup(view());
    expect(asHost).toContain('id="map-preview"');
    expect(asHost).toContain('id="seed"');
    expect(asHost).toContain('value="42"');
    expect(asHost).toContain('id="reroll"');
    const asGuest = lobbyMarkup(view({ humanPlayer: 1, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }));
    expect(asGuest).toContain('id="map-preview"');
    expect(asGuest).toContain('Map 42');
    expect(asGuest).not.toContain('id="reroll"');
  });

  it('offers each bot seat Level 1 to Level 10, set to its level', () => {
    const html = lobbyMarkup(view({ bots: [5, 2, 8, 10] }));
    expect(rows(html)[1]).toContain('<option value="2" selected>Level 2</option>');
    expect(rows(html)[3]).toContain('<option value="10" selected>Level 10</option>');
    const picker = (rows(html)[1] as string).match(/<select class="bot-select"[\s\S]*?<\/select>/);
    expect(picker?.[0].match(/<option /g)).toHaveLength(10);
    // A guest sees the level, not a choice.
    const guest = lobbyMarkup(
      view({ bots: [5, 2, 8, 10], humanPlayer: 1, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }),
    );
    expect(rows(guest)[2]).toContain('Level 8');
    expect(rows(guest)[2]).not.toContain('<select');
  });

  it('puts the seats in one column per team', () => {
    const html = lobbyMarkup(
      view({ settings: { maxRounds: 10, teamSize: 2 }, teams: [0, 1, 1, 0] }),
    );
    const columns = [...html.matchAll(/<section class="team-column">([\s\S]*?)<\/section>/g)];
    expect(columns).toHaveLength(2);
    expect(columns[0]?.[1]).toContain('Team A');
    expect(columns[0]?.[1]).toContain('Ada');
    expect(columns[0]?.[1]).toContain('Bot 4');
    expect(columns[1]?.[1]).toContain('Bot 2');
  });

  it('marks a seat somebody has just taken', () => {
    const html = lobbyMarkup(view({ seats: [seat(0, 'Ada'), seat(1, 'Bo')], arrived: [1] }));
    expect(html).toContain('<li class="seat arrived">');
  });

  it('lets only the host change the bots or start the match', () => {
    const asHost = lobbyMarkup(view({ humanPlayer: 0, hostId: 0 }));
    expect(asHost).toContain('bot-select');
    expect(asHost).toContain('id="begin"');

    const asGuest = lobbyMarkup(
      view({ humanPlayer: 1, hostId: 0, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }),
    );
    expect(asGuest).not.toContain('bot-select');
    expect(asGuest).not.toContain('id="begin"');
    expect(asGuest).toContain('Waiting for the host');
  });

  it('marks your own seat, the host, and anyone who has dropped', () => {
    const html = lobbyMarkup(
      view({
        humanPlayer: 1,
        hostId: 0,
        seats: [seat(0, 'Ada'), seat(1, 'Bo'), seat(2, 'Cy', false)],
      }),
    );
    expect(rows(html)[0]).toContain('>host<');
    expect(rows(html)[1]).toContain('>you<');
    expect(rows(html)[2]).toContain('>away<');
  });

  it('offers the code for copying rather than only for reading', () => {
    const html = lobbyMarkup(view({ code: 'QX7K2M' }));
    expect(html).toContain('QX7K2M');
    expect(html).toContain('id="copy-code"');
  });

  it('escapes a name rather than letting it become markup', () => {
    // Names come from other players and the server caps their length, not their content.
    const html = lobbyMarkup(view({ seats: [seat(0, '<img src=x onerror=alert(1)>')] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('gives the host the table controls, bounded by the rules, and guests a statement', () => {
    const host = lobbyMarkup(view({ settings: { maxRounds: 12, teamSize: 1 } }));
    expect(host).toContain('id="max-rounds"');
    expect(host).toContain('<option value="12" selected>');
    expect(host).toContain('id="team-size"');
    expect(host).toContain('id="player-count"');

    const guest = lobbyMarkup(
      view({
        humanPlayer: 1,
        seats: [seat(0, 'Ada'), seat(1, 'Bo')],
        settings: { maxRounds: 12, teamSize: 1 },
      }),
    );
    expect(guest).not.toContain('id="max-rounds"');
    expect(guest).toContain('12 rounds');
    expect(guest).toContain('Free-for-all');
  });

  it('offers only the player counts a team size allows', () => {
    const html = lobbyMarkup(
      view({ settings: { maxRounds: 10, teamSize: 2 }, teams: [0, 0, 1, 1] }),
    );
    const select = html.slice(
      html.indexOf('id="player-count"'),
      html.indexOf('</select>', html.indexOf('id="player-count"')),
    );
    const counts = [...select.matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
    expect(counts).toEqual([4, 6, 8]);
  });

  it('lets only the host choose who sits where, which is how sides are chosen', () => {
    const teamed = {
      settings: { maxRounds: 10, teamSize: 2 },
      teams: [0, 0, 1, 1],
      seats: [seat(0, 'Ada'), seat(1, 'Bo')],
    };
    const host = lobbyMarkup(view(teamed));
    // No team dropdowns any more: a seat's team is the column it sits in.
    expect(host).not.toContain('team-select');
    const pickers = [
      ...host.matchAll(/<select class="occupant who" data-seat="(\d)"[^>]*>([\s\S]*?)<\/select>/g),
    ];
    expect(pickers.map((m) => m[1])).toEqual(['0', '1', '2', '3']);
    // A bot's seat offers the bot and every person; a person's, the people to swap with.
    expect(pickers[2]?.[2]).toContain('<option value="" selected>Bot 3</option>');
    expect(pickers[2]?.[2]).toContain('<option value="0">Ada</option>');
    expect(pickers[2]?.[2]).toContain('<option value="1">Bo</option>');
    expect(pickers[1]?.[2]).toContain('<option value="1" selected>Bo</option>');

    const guest = lobbyMarkup(view({ ...teamed, humanPlayer: 1 }));
    expect(guest).not.toContain('class="occupant');
    expect(guest).toContain('<span class="who">Bo</span>');
  });

  it('shows a name, not a choice of one, when the host is alone at their seat', () => {
    const html = lobbyMarkup(view());
    expect(rows(html)[0]).toContain('<span class="who">Ada</span>');
    // But every bot seat still offers the host a place.
    expect(rows(html)[1]).toContain('<option value="0">Ada</option>');
  });

  it('will not start unequal teams, and says why', () => {
    const html = lobbyMarkup(
      view({ settings: { maxRounds: 10, teamSize: 2 }, teams: [0, 0, 0, 1] }),
    );
    expect(html).toContain('id="begin" disabled');
    expect(html).toContain('Teams must be the same size');
  });

  it('works without a server: no code to share', () => {
    const html = lobbyMarkup(view({ code: null }));
    expect(html).not.toContain('room-code');
  });

  it('has no separate button for watching', () => {
    const html = lobbyMarkup(view());
    // Watching is no separate button any more: it is a bot in the host's own seat.
    expect(html).not.toContain('id="watch"');
  });

  it('lets the host give their own seat to a bot, and then says they will watch', () => {
    const playing = lobbyMarkup(view());
    expect(rows(playing)[0]).toContain('id="host-bot"');
    expect(rows(playing)[0]).toContain('<option value="" selected>You play</option>');
    const watching = lobbyMarkup(view({ hostBot: 8 }));
    expect(rows(watching)[0]).toContain('<option value="8" selected>Level 8</option>');
    expect(rows(watching)[0]).toContain('Ada watches');
    // A guest sees who is playing the host's seat, and cannot change it.
    const guest = lobbyMarkup(
      view({ hostBot: 8, humanPlayer: 1, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }),
    );
    expect(rows(guest)[0]).not.toContain('id="host-bot"');
    expect(rows(guest)[0]).toContain('Level 8');
  });
});

describe('the invitation over the internet', () => {
  it('offers the link while the host’s port is open, and nothing otherwise', () => {
    expect(lobbyMarkup(view())).not.toContain('invite-link');
    const html = lobbyMarkup(view({ invite: 'http://203.0.113.7:8080/?join=ABC123' }));
    expect(html).toContain(
      '<code id="invite-link" class="invite-link">http://203.0.113.7:8080/?join=ABC123</code>',
    );
    expect(html).toContain('id="copy-invite"');
  });
});
