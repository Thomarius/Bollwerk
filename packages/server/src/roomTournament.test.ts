import { defaultConfigBundle, type Personality } from '@bollwerk/config';
import type { RecordingLine, ServerMessage, TournamentTable } from '@bollwerk/protocol';
import { describe, expect, it } from 'vitest';

import { Room, type Connection } from './room.js';

/** A client that only listens: the tournament's room is about seats, not play. */
class Listener implements Connection {
  readonly received: ServerMessage[] = [];
  playerId = -1;
  closed: string | null = null;
  constructor(readonly id: string) {}
  send(message: ServerMessage): void {
    this.received.push(message);
    if (message.type === 'welcome') this.playerId = message.playerId;
  }
  close(reason: string): void {
    this.closed = reason;
  }
  latest<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> {
    const message = this.received.filter((m) => m.type === type).at(-1);
    if (message === undefined) throw new Error(`no ${type} message`);
    return message as Extract<ServerMessage, { type: T }>;
  }
}

function room(record?: (line: RecordingLine) => void): Room {
  return new Room({
    code: 'TOUR42',
    playerCount: 2,
    ruleset: defaultConfigBundle.ruleset,
    terrain: defaultConfigBundle.terrain,
    server: defaultConfigBundle.server,
    ai: defaultConfigBundle.ai,
    seed: 3,
    ...(record === undefined ? {} : { record }),
  });
}

/** The host's save as the room passes it on: never read there, so any text will do. */
const SAVE = '{"version":1}';

const steady: Personality = { risk: 'defensive', targeting: 'strategic', cannons: 'max' };

/**
 * Two teams of two: the opponents in seats 0 and 1, the host's team in 2 and 3 — the host
 * in 3, so the host is not in the first seat, and seat 2 a teammate's bot a person may take.
 */
function table(over: Partial<TournamentTable> = {}): TournamentTable {
  return {
    seats: [
      { name: 'Ada', level: 6, personality: steady, team: 0, open: false },
      { name: 'Bruno', level: 4, personality: steady, team: 0, open: false },
      { name: 'Mausi', level: 5, personality: steady, team: 1, open: true },
      { name: 'Thomas', level: null, personality: null, team: 1, open: false },
    ],
    teamNames: ['Granite', 'Die Wälle'],
    settings: { maxRounds: 5, teamSize: 2, continues: 2 },
    seed: 77,
    tournament: { id: 't-test', step: 2 },
    stage: 'Semi-final',
    ...over,
  };
}

function run(r: Room, ticks: number): void {
  const tickMs = 1000 / defaultConfigBundle.ruleset.tickRateHz;
  for (let i = 0; i < ticks && !r.finished; i++) r.update(tickMs);
}

describe("a tournament's room", () => {
  it('takes the table, seats the host in their seat, and tells everyone', () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    expect(host.playerId).toBe(3);
    const message = host.latest('room');
    expect(message.playerCount).toBe(4);
    expect(message.teams).toEqual([0, 0, 1, 1]);
    expect(message.settings).toEqual({ maxRounds: 5, teamSize: 2, continues: 2 });
    expect(message.seed).toBe(77);
    expect(message.hostId).toBe(3);
    expect(message.tournament?.stage).toBe('Semi-final');
  });

  it("passes the host's save on to everyone, and to whoever joins later", () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    expect(host.latest('tournamentSave').save).toBe(SAVE);
    const guest = new Listener('g');
    r.join(guest, 'Mausica');
    expect(guest.latest('tournamentSave').save).toBe(SAVE);
    r.handle(host, { type: 'tournament', table: table({ stage: 'Final' }), save: '{"n":2}' });
    expect(guest.latest('tournamentSave').save).toBe('{"n":2}');
  });

  it('seats people only in the open seats, and turns away the rest', () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    const guest = new Listener('g');
    expect(r.join(guest, 'Mausica')).toBe(2);
    expect(r.join(new Listener('x'), 'Nobody')).toBeNull();
  });

  it('lets the host move people between open seats, and change nothing else', () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    // Two teams of three: the host in seat 3, their teammates' bots in 4 and 5.
    const bot = (name: string, team: number, open: boolean) => ({
      name,
      level: 5,
      personality: steady,
      team,
      open,
    });
    r.handle(host, {
      type: 'tournament',
      save: SAVE,
      table: table({
        seats: [
          bot('Ada', 0, false),
          bot('Bruno', 0, false),
          bot('Carla', 0, false),
          { name: 'Thomas', level: null, personality: null, team: 1, open: false },
          bot('Mausi', 1, true),
          bot('Nora', 1, true),
        ],
        settings: { maxRounds: 5, teamSize: 3, continues: 2 },
      }),
    });
    const guest = new Listener('g');
    expect(r.join(guest, 'Mausica')).toBe(4);
    r.handle(host, {
      type: 'configure',
      bots: [1, 1, 1, 1, 1, 1],
      seed: 5,
      move: { from: 4, to: 5 },
    });
    expect(guest.playerId).toBe(5);
    const message = host.latest('room');
    // The bots stay with their seats, and nothing else changed.
    expect(message.bots).toEqual([5, 5, 5, defaultConfigBundle.server.botLevel, 5, 5]);
    expect(message.seed).toBe(77);
    // Into the opponents' seats, or the host's: refused.
    r.handle(host, { type: 'configure', move: { from: 5, to: 0 } });
    r.handle(host, { type: 'configure', move: { from: 5, to: 3 } });
    expect(guest.playerId).toBe(5);
  });

  it('plays the tournament bots by their names, levels and personalities, and its team names', () => {
    const lines: RecordingLine[] = [];
    const r = room((line) => lines.push(line));
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    const guest = new Listener('g');
    r.join(guest, 'Mausica');
    r.handle(guest, { type: 'start' });
    expect(r.started).toBe(false);
    r.handle(host, { type: 'start' });
    expect(r.started).toBe(true);
    const snapshot = host.latest('snapshot').snapshot;
    expect(snapshot.teamNames).toEqual(['Granite', 'Die Wälle']);
    expect(snapshot.players.map((p) => p.name).sort()).toEqual(
      ['Ada', 'Bruno', 'Mausica', 'Thomas'].sort(),
    );
    const header = lines[0];
    expect(header?.kind === 'header' && header.tournament).toEqual({ id: 't-test', step: 2 });
    if (header?.kind === 'header') {
      const ada = header.players.find((p) => p.name === 'Ada');
      expect(ada).toMatchObject({ isBot: true, level: 6, personality: steady });
      expect(header.players.find((p) => p.name === 'Mausica')).toMatchObject({ isBot: false });
    }
  });

  it('refuses a rematch, and goes back to its lobby for the next table once the match is over', () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    const guest = new Listener('g');
    r.join(guest, 'Mausica');
    r.handle(host, { type: 'start' });
    // Mid-match, the next table waits.
    r.handle(host, { type: 'tournament', table: table({ stage: 'Final' }), save: SAVE });
    expect(host.latest('room').tournament?.stage).toBe('Semi-final');
    // The host's team never moves, so it is soon out and the match over.
    run(r, 60_000);
    expect(r.finished).toBe(true);
    r.handle(host, { type: 'rematch' });
    expect(r.started).toBe(true);

    const next = table({ stage: 'Final', seed: 9, tournament: { id: 't-test', step: 3 } });
    next.seats = [next.seats[2]!, next.seats[3]!, next.seats[0]!, next.seats[1]!];
    next.seats = next.seats.map((seat) => ({ ...seat, team: seat.team === 1 ? 0 : 1 }));
    r.handle(host, { type: 'tournament', table: next, save: SAVE });
    expect(r.started).toBe(false);
    const message = guest.latest('room');
    expect(message.started).toBe(false);
    expect(message.tournament?.stage).toBe('Final');
    // Everyone back, in the seats the new table gives them.
    expect(host.playerId).toBe(1);
    expect(guest.playerId).toBe(0);
  });

  it("passes the finished tournament on once its last match is over, and only the host's", () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    const guest = new Listener('g');
    r.join(guest, 'Mausica');
    r.handle(host, { type: 'start' });
    const ENDED = '{"version":1,"ended":true}';
    // Mid-match, the end waits; and a guest has no tournament to end.
    r.handle(host, { type: 'tournamentEnd', save: ENDED });
    run(r, 60_000);
    expect(r.finished).toBe(true);
    r.handle(guest, { type: 'tournamentEnd', save: ENDED });
    expect(guest.latest('tournamentSave').save).toBe(SAVE);

    r.handle(host, { type: 'tournamentEnd', save: ENDED });
    expect(guest.latest('tournamentSave').save).toBe(ENDED);
    // The room stays on the finished match: there is no lobby to go back to.
    expect(r.started).toBe(true);
  });

  it('is listed with its team while an open seat is free', () => {
    const r = new Room({
      code: 'TOUR43',
      playerCount: 2,
      ruleset: defaultConfigBundle.ruleset,
      terrain: defaultConfigBundle.terrain,
      server: defaultConfigBundle.server,
      ai: defaultConfigBundle.ai,
      public: true,
    });
    const host = new Listener('h');
    r.join(host, 'Thomas');
    r.handle(host, { type: 'tournament', table: table(), save: SAVE });
    expect(r.listing()).toMatchObject({ tournament: 'Die Wälle', people: 1, playerCount: 4 });
    r.join(new Listener('g'), 'Mausica');
    expect(r.listing()).toBeNull();
  });

  it('refuses a table with no seat for its host', () => {
    const r = room();
    const host = new Listener('h');
    r.join(host, 'Thomas');
    const headless = table();
    headless.seats[3] = { name: 'Thomas', level: 5, personality: steady, team: 1, open: false };
    r.handle(host, { type: 'tournament', table: headless, save: SAVE });
    expect(host.received.some((m) => m.type === 'room' && m.tournament !== null)).toBe(false);
  });
});
