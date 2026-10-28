import type { Seat } from '@bollwerk/protocol';
import { describe, expect, it } from 'vitest';

import { addedSeats, lobbyMarkup, nudgedSettings, type LobbyView } from './lobby.js';
import { SHAPE_PATHS } from './shapes.js';

function seat(playerId: number, name: string, connected = true): Seat {
  return { playerId, name, isBot: false, connected, ready: false, special: null };
}

function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    code: 'ABC123',
    playerCount: 4,
    hostId: 0,
    humanPlayer: 0,
    seats: [seat(0, 'Ada')],
    bots: [5, 5, 5, 5],
    settings: { maxRounds: 10, teamSize: 1, continues: 2, specials: false },
    settingBounds: {
      maxRounds: { min: 5, max: 20 },
      teamSize: { min: 1, max: 4 },
      continues: { min: 0, max: 4 },
    },
    teams: [0, 1, 2, 3],
    playerLimits: { min: 2, max: 8 },
    seed: 42,
    hostBot: null,
    ...over,
  };
}

/** Seat rows, in table order. */
function rows(html: string): string[] {
  return [...html.matchAll(/<li class="seat[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? '');
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

  it('shows each bot seat’s level once, as a number, with no pips beside it', () => {
    const table = view({ bots: [5, 3, 8, 10] });
    for (const html of [lobbyMarkup(table), lobbyMarkup({ ...table, humanPlayer: 1 })]) {
      expect(html).not.toContain('class="pips"');
    }
    expect(rows(lobbyMarkup({ ...table, humanPlayer: 1 }))[3]).toContain('Level 10');
  });

  it('shows the map, and lets only the host draw another, never showing its seed', () => {
    const asHost = lobbyMarkup(view());
    expect(asHost).toContain('id="map-preview"');
    expect(asHost).toContain('id="reroll"');
    expect(asHost).not.toContain('id="seed"');
    expect(asHost).not.toContain('42');
    const asGuest = lobbyMarkup(view({ humanPlayer: 1, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }));
    expect(asGuest).toContain('id="map-preview"');
    expect(asGuest).not.toContain('42');
    expect(asGuest).not.toContain('id="reroll"');
  });

  it('offers each bot seat Level 1 to Level 10, set to its level', () => {
    const html = lobbyMarkup(view({ bots: [5, 2, 8, 10] }));
    expect(rows(html)[1]).toContain('<option value="2" data-short="2" selected>Level 2</option>');
    expect(rows(html)[3]).toContain(
      '<option value="10" data-short="10" selected>Level 10</option>',
    );
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
      view({
        settings: { maxRounds: 10, teamSize: 2, continues: 2, specials: false },
        teams: [0, 1, 1, 0],
      }),
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
    expect(asGuest).toContain('id="ready" data-ready="true">Ready</button>');
  });

  it('has a guest say they are ready, and take it back, where the host starts', () => {
    const ready = { ...seat(1, 'Bo'), ready: true };
    const html = lobbyMarkup(view({ humanPlayer: 1, seats: [seat(0, 'Ada'), ready] }));
    expect(html).toContain('id="ready" class="quiet" data-ready="false">Not ready</button>');
    expect(html).toContain('Waiting for the host');
  });

  it('shows everyone who is ready, and keeps the host waiting for the rest', () => {
    const seats = [seat(0, 'Ada'), { ...seat(1, 'Bo'), ready: true }, seat(2, 'Cy'), seat(3, 'Di')];
    const html = lobbyMarkup(view({ seats }));
    // The host's own row says nothing: their Start is their ready.
    expect(rows(html)[0]).not.toContain('ready');
    expect(rows(html)[1]).toContain('<em class="tag ready">ready</em>');
    expect(rows(html)[2]).toContain('<em class="tag unready">not ready</em>');
    expect(html).toContain('id="begin" class="primary" disabled');
    expect(html).toContain('Waiting for 2 players to be ready.');
    const one = lobbyMarkup(view({ seats: seats.slice(0, 3) }));
    expect(one).toContain('Waiting for 1 player to be ready.');
    const all = lobbyMarkup(view({ seats: seats.map((s) => ({ ...s, ready: true })) }));
    expect(all).toContain('id="begin" class="primary">');
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
    const host = lobbyMarkup(
      view({ settings: { maxRounds: 12, teamSize: 1, continues: 2, specials: false } }),
    );
    // Rounds and lives stay the config's, not offered (the user's, 2026-10-28).
    expect(host).not.toContain('id="max-rounds"');
    expect(host).not.toContain('id="lives"');
    expect(host).toContain('id="team-size"');
    expect(host).toContain('id="player-count"');

    const guest = lobbyMarkup(
      view({
        humanPlayer: 1,
        seats: [seat(0, 'Ada'), seat(1, 'Bo')],
        settings: { maxRounds: 12, teamSize: 1, continues: 2, specials: false },
      }),
    );
    expect(guest).not.toContain('id="max-rounds"');
    expect(guest).toContain('12 rounds');
    expect(guest).toContain('Free-for-all');
  });

  it('offers only the player counts a team size allows', () => {
    const html = lobbyMarkup(
      view({
        settings: { maxRounds: 10, teamSize: 2, continues: 2, specials: false },
        teams: [0, 0, 1, 1],
      }),
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
      settings: { maxRounds: 10, teamSize: 2, continues: 2, specials: false },
      teams: [0, 0, 1, 1],
      seats: [seat(0, 'Ada'), seat(1, 'Bo')],
    };
    const host = lobbyMarkup(view(teamed));
    // No team dropdowns any more: a seat's team is the column it sits in.
    expect(host).not.toContain('team-select');
    // A person's seat offers a swap with the one other person; a bot's, a list of both.
    expect(rows(host)[0]).toContain(
      '<button type="button" class="sit" data-seat="0" data-player="1">Swap with Bo</button>',
    );
    expect(rows(host)[1]).toContain('>Swap with Ada</button>');
    const list = rows(host)[2] ?? '';
    expect(list).toContain('<span class="who">Bot 3</span>');
    expect(list).toContain('<summary>Seat…</summary>');
    expect(list).toContain('data-seat="2" data-player="0">Ada</button>');
    expect(list).toContain('data-seat="2" data-player="1">Bo</button>');

    const guest = lobbyMarkup(view({ ...teamed, humanPlayer: 1 }));
    expect(guest).not.toContain('class="sit');
    expect(guest).toContain('<span class="who">Bo</span>');
  });

  it('offers the host alone a place at every bot seat, and nothing at their own', () => {
    const html = lobbyMarkup(view());
    expect(rows(html)[0]).toContain('<span class="who">Ada</span>');
    expect(rows(html)[0]).not.toContain('class="sit');
    expect(rows(html)[1]).toContain('data-seat="1" data-player="0">Sit here</button>');
  });

  it('will not start unequal teams, and says why', () => {
    const html = lobbyMarkup(
      view({
        settings: { maxRounds: 10, teamSize: 2, continues: 2, specials: false },
        teams: [0, 0, 0, 1],
      }),
    );
    expect(html).toContain('id="begin" class="primary" disabled');
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

  it('lets the host give their own seat to a bot', () => {
    // A switch between playing it and a bot, and only for a bot the level, as every bot's is set.
    const playing = lobbyMarkup(view());
    expect(rows(playing)[0]).toContain('id="host-play"');
    expect(rows(playing)[0]).toContain('<option value="person" selected>You</option>');
    expect(rows(playing)[0]).not.toContain('id="host-bot"');
    const watching = lobbyMarkup(view({ hostBot: 8 }));
    expect(rows(watching)[0]).toContain('<option value="bot" selected>Bot</option>');
    expect(rows(watching)[0]).toContain('id="host-bot" data-ui="step"');
    expect(rows(watching)[0]).toContain(
      '<option value="8" data-short="8" selected>Level 8</option>',
    );
    // The switch says it; a line saying so too was removed (the user's, 2026-10-28).
    expect(rows(watching)[0]).not.toContain('class="blurb"');
    // A guest sees who is playing the host's seat, and cannot change it.
    const guest = lobbyMarkup(
      view({ hostBot: 8, humanPlayer: 1, seats: [seat(0, 'Ada'), seat(1, 'Bo')] }),
    );
    expect(rows(guest)[0]).not.toContain('id="host-bot"');
    expect(rows(guest)[0]).toContain('Level 8');
  });
});

describe('the lobby drawn again', () => {
  const free = { maxRounds: 10, teamSize: 1, continues: 2, specials: false };
  const pairs = { ...free, teamSize: 2 };

  it('slides in the seats a table gains, and none at its first drawing or as it shrinks', () => {
    expect(addedSeats(null, view())).toEqual([]);
    expect(addedSeats(view({ playerCount: 4 }), view({ playerCount: 6 }))).toEqual([4, 5]);
    expect(addedSeats(view({ playerCount: 6 }), view({ playerCount: 4 }))).toEqual([]);
    const html = lobbyMarkup(view({ entering: [3] }));
    expect(html).toContain('<li class="seat bot entering"');
  });

  it('marks the player counts when a team size takes some away, but not the size itself', () => {
    const before = view({ settings: free, playerCount: 4 });
    const after = view({ settings: pairs, playerCount: 4, teams: [0, 0, 1, 1] });
    expect(nudgedSettings(before, after, 'team-size')).toEqual(['player-count']);
    // A change of the count alone changes nothing else.
    expect(
      nudgedSettings(before, view({ settings: free, playerCount: 5 }), 'player-count'),
    ).toEqual([]);
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
