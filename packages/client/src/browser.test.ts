import { PROTOCOL_VERSION } from '@rampart/protocol';
import { describe, expect, it } from 'vitest';

import { gamesMarkup, joinRefusedNotice, parseRoomList } from './browser.js';

const room = {
  code: 'ABCD',
  host: 'Ada',
  people: 1,
  playerCount: 3,
  teamSize: 1,
  maxRounds: 10,
};

describe('the open games browser', () => {
  it('reads a server’s list of open rooms', () => {
    expect(parseRoomList({ protocol: PROTOCOL_VERSION, rooms: [room] })).toEqual([room]);
  });

  it('shows no browser without a server, or for one this page cannot join', () => {
    // Under the dev server any path answers with the page itself, not JSON.
    expect(parseRoomList(undefined)).toBeNull();
    expect(parseRoomList('<!doctype html>')).toBeNull();
    expect(parseRoomList({ protocol: PROTOCOL_VERSION - 1, rooms: [room] })).toBeNull();
  });

  it('lists each room with its host, seats and rounds, and a Join button for its code', () => {
    const html = gamesMarkup([room, { ...room, code: 'WXYZ', host: 'Bo', teamSize: 2 }]);
    expect(html).toContain('Ada');
    expect(html).toContain('1 of 3 seated · 10 rounds');
    expect(html).toContain('teams of 2');
    expect(html).toContain('data-code="ABCD"');
    expect(html).toContain('data-code="WXYZ"');
  });

  it('escapes names, which come from other players', () => {
    expect(gamesMarkup([{ ...room, host: '<b>x</b>' }])).not.toContain('<b>x</b>');
  });

  it('says so when there are no open games', () => {
    expect(gamesMarkup([])).toContain('No open games');
  });

  it('explains a room that filled or closed while the list was up, and nothing else', () => {
    expect(joinRefusedNotice('room_full')).toMatch(/filled up/);
    expect(joinRefusedNotice('no_room')).toMatch(/closed/);
    expect(joinRefusedNotice('no_capacity')).toBeNull();
  });
});
