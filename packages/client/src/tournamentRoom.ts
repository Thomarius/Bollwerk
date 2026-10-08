import type { Seat, ServerMessage, TournamentTable } from '@bollwerk/protocol';
import { HOST_TEAM, mapSeed, matchTable, type Progress, type Save } from '@bollwerk/tournament';

import { ServerConnection } from './net/connection.js';
import { NetworkMatch } from './net/networkMatch.js';
import { stageName } from './tournamentText.js';

/**
 * A tournament's room on the server (docs/TOURNAMENT.md T6), held by its host for as long as
 * the tournament is open: teammates join it by its code, for any of the matches, and the
 * host sends it each match's table. The tournament itself stays on the host's computer; the
 * room plays only the match it is sent.
 */

/** How long to wait for a server, as the lobby waits, before playing on alone. */
const SERVER_WAIT_MS = 2000;

/**
 * A tournament's match as the room is sent it: the tournament's table, its bots by name,
 * level and personality, the seats of the host's team's bots open to people, and the step's
 * map and words.
 */
export function roomTable(save: Save, progress: Progress): TournamentTable | null {
  const teams = progress.next?.matches[progress.hostMatch];
  if (teams === undefined) return null;
  const table = matchTable(save, teams);
  const hostTeam = teams.indexOf(HOST_TEAM);
  return {
    seats: table.seats.map((seat) => ({
      ...seat,
      open: seat.team === hostTeam && seat.level !== null,
    })),
    teamNames: teams.map((id) => save.teams[id]?.name ?? ''),
    settings: { maxRounds: save.settings.maxRounds, teamSize: save.settings.teamSize },
    seed: mapSeed(save, progress.done),
    tournament: { id: save.id, step: progress.done },
    stage: stageName(save, progress.done),
  };
}

export class TournamentRoom {
  readonly match: NetworkMatch;
  code = '';
  /** The room's address on the internet, while the host's port is open there. */
  invite: string | null = null;
  /** The people at the table, the host among them, as the room last said. */
  people: readonly Seat[] = [];
  hostId = 0;
  /** Called as the room changes: somebody arrived, left or moved. */
  onChange: (() => void) | null = null;
  /** Called as a match starts: the snapshot has come. */
  onSnapshot: (() => void) | null = null;
  private readonly pinging: ReturnType<typeof setInterval>;

  private constructor(readonly connection: ServerConnection) {
    this.match = new NetworkMatch(connection);
    connection.onMessage((message) => this.receive(message));
    this.pinging = setInterval(() => {
      if (connection.state === 'closed') clearInterval(this.pinging);
      else connection.ping();
    }, 2000);
  }

  /**
   * A new room for the tournament, or null when no server answers within the wait — a
   * page from the dev server, or the desktop app's window with nobody to share it with.
   */
  static async open(name: string, isPublic: boolean): Promise<TournamentRoom | null> {
    const connection = new ServerConnection(ServerConnection.defaultUrl());
    const answered = new Promise<ServerMessage | null>((resolve) => {
      connection.onMessage((message) => {
        if (message.type === 'welcome' || message.type === 'error') resolve(message);
      });
      setTimeout(() => resolve(null), SERVER_WAIT_MS);
    });
    connection.connect().catch(() => undefined);
    // The room's player count is the table's to set; two is any count allowed.
    connection.createRoom(name, 2, isPublic);
    const first = await answered;
    if (first?.type !== 'welcome') {
      connection.close();
      return null;
    }
    const room = new TournamentRoom(connection);
    room.receive(first);
    return room;
  }

  get open(): boolean {
    return this.connection.state !== 'closed';
  }

  /** Everyone at the table but the host. */
  get guests(): Seat[] {
    return this.people.filter((seat) => seat.playerId !== this.hostId);
  }

  sendTable(table: TournamentTable): void {
    this.connection.send({ type: 'tournament', table });
  }

  start(): void {
    this.connection.send({ type: 'start' });
  }

  /** A person to another open seat: the bot whose seat they take sits the match out. */
  move(from: number, to: number): void {
    this.connection.send({ type: 'configure', move: { from, to } });
  }

  close(): void {
    clearInterval(this.pinging);
    this.connection.close();
  }

  private receive(message: ServerMessage): void {
    this.match.receive(message);
    switch (message.type) {
      case 'welcome':
        this.code = message.code;
        this.hostId = message.hostId;
        return;
      case 'room':
        this.code = message.code;
        this.hostId = message.hostId;
        this.people = message.seats;
        this.invite =
          message.internet === null ? null : `${message.internet}/?join=${message.code}`;
        if (!message.started) this.onChange?.();
        return;
      case 'snapshot':
        this.onSnapshot?.();
        return;
      default:
        return;
    }
  }
}
