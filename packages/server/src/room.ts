import {
  applySettings,
  defaultSettings,
  defaultTeams,
  mergeSettings,
  reshapeTable,
  teamsBalanced,
  type AiConfig,
  type BotSetup,
  type MatchSettings,
  type Personality,
  type Ruleset,
  type ServerConfig,
  type TerrainConfig,
} from '@bollwerk/config';
import { Bot, PlanningSlots, dealSeats } from '@bollwerk/ai';
import {
  ActionSchema,
  MatchRecorder,
  PROTOCOL_VERSION,
  recordingId,
  type RecordingLine,
  type RoomListing,
  type ClientMessage,
  type ServerMessage,
  type Seat as WireSeat,
  type TournamentTable,
} from '@bollwerk/protocol';
import { MatchRunner } from './matchRunner.js';
import { Rng, createMatch } from '@bollwerk/sim';

/**
 * A client, abstracted away from WebSockets so a room can be driven directly in
 * tests. The integration suite runs a whole match between in-process clients with no
 * sockets and no timers at all.
 */
export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
  close(reason: string): void;
}

export interface Seat {
  playerId: number;
  name: string;
  /** Null while nobody is holding the seat: a bot plays it until someone returns. */
  connection: Connection | null;
  token: string;
  ready: boolean;
  /** True for a seat that was never claimed by a person. */
  bot: boolean;
  /** Ticks remaining before a dropped player is handed to a bot. */
  graceTicks: number;
}

export interface RoomOptions {
  code: string;
  playerCount: number;
  ruleset: Ruleset;
  terrain: TerrainConfig;
  server: ServerConfig;
  ai: AiConfig;
  seed?: number;
  /** Listed in the open games browser; false for a room joined by its code alone. */
  public?: boolean;
  /**
   * Where the lines of this room's match recording go, if anywhere. The room builds
   * them; the process decides whether and where to keep them, so the room stays free of
   * files and its tests of disks.
   */
  record?: (line: RecordingLine) => void;
  /** The server's public address while its port is open to the internet (PLAN 11.21). */
  publicUrl?: () => string | null;
}

/**
 * One match and its players.
 *
 * The server is the only authority: clients send intents, the server validates them
 * against the same rules everyone runs, and broadcasts what it actually applied. It
 * never sends board state during play — only the actions and the tick they landed on,
 * which every client replays into its own simulation. That is only safe because the
 * simulation is deterministic, so the periodic hash is not a nicety: it is the check
 * that the assumption still holds.
 */
export class Room {
  readonly code: string;
  private readonly seats: Seat[] = [];
  private readonly options: RoomOptions;
  private readonly rng: Rng;

  /** The match once it has started, until a rematch brings the table back. */
  private match: MatchRunner | null = null;
  private hostId = 0;
  /** Skill of the bot in each seat, which the host may change before the match starts. */
  private readonly botLevels: number[];
  /** Settings the host may change before the match starts, within the server's bounds. */
  private settings: MatchSettings;
  /** Seats at the table, which the host may change while the table is being set. */
  private playerCount: number;
  /** Each seat's team, by seat. Free-for-all is every seat on its own. */
  private teams: number[];
  /**
   * The match seed, drawn with the room rather than at the start, so the lobby shows the
   * map everyone will play and which island each seat will get. The host may draw
   * another, or set one.
   */
  private seed: number;
  /** A bot the host has put in their own seat, to watch rather than play. */
  private hostBot: number | null = null;
  private idle = 0;
  /**
   * Where each person sat in the lobby, by token, as the match started: the start deals
   * seats onto islands and renumbers them, and a rematch puts everyone back.
   */
  private lobbySeats = new Map<string, number>();
  private lobbyHost = 0;
  /**
   * The tournament's match the host has set the room for (docs/TOURNAMENT.md T6), or null.
   * While set, the table is the tournament's: people may take only its open seats — the
   * host's team's — and the host may only move them between those.
   */
  private tournament: TournamentTable | null = null;
  /** The host's tournament as it stands, as JSON, for the teammates' pages; never read here. */
  private tournamentSave: string | null = null;

  constructor(options: RoomOptions) {
    this.options = options;
    this.code = options.code;
    this.rng = new Rng(options.seed ?? Math.floor(Math.random() * 0xffffffff));
    this.botLevels = new Array<number>(options.playerCount).fill(options.server.botLevel);
    this.settings = defaultSettings(options.ruleset, options.server.lobbySettings);
    this.playerCount = options.playerCount;
    this.teams = defaultTeams(this.playerCount, this.settings.teamSize);
    this.seed = this.rng.nextU32();
  }

  get started(): boolean {
    return this.match !== null;
  }

  get finished(): boolean {
    return this.match?.finished === true;
  }

  get paused(): boolean {
    return (this.match?.pausedBy ?? null) !== null;
  }

  /**
   * How the games browser lists this room, or null when it should not: private, under
   * way, or with no seat left. Whoever has the lowest seat among the people is named as
   * the host, as the lobby does.
   */
  listing(): RoomListing | null {
    if (this.options.public === false || this.match !== null) return null;
    if (this.seats.length === 0 || this.freeSeat() >= this.playerCount) return null;
    const host = this.seats.find((s) => s.playerId === this.hostId) ?? this.seats[0]!;
    return {
      code: this.code,
      host: host.name,
      people: this.seats.length,
      playerCount: this.playerCount,
      teamSize: this.settings.teamSize,
      maxRounds: this.settings.maxRounds,
      tournament: this.tournament?.teamNames[this.tournament.seats[this.hostId]?.team ?? 0] ?? null,
    };
  }

  get empty(): boolean {
    return this.seats.every((seat) => seat.connection === null);
  }

  /** Milliseconds this room has had nobody connected. */
  get idleMs(): number {
    return this.idle;
  }

  // ---------------------------------------------------------------- membership

  join(connection: Connection, name: string, token?: string): number | null {
    if (token !== undefined) {
      const seat = this.seats.find((s) => s.token === token);
      if (seat) {
        // Reclaiming a seat a bot has been holding — unless it is the seat the host
        // gave to a bot on purpose, which stays the bot's: they came back to watch.
        seat.connection = connection;
        const watching =
          this.match !== null && seat.playerId === this.hostId && this.hostBot !== null;
        seat.bot = watching;
        seat.graceTicks = 0;
        this.sendWelcome(seat);
        this.match?.sendSnapshot(seat);
        const pausedBy = this.match?.pausedBy ?? null;
        if (pausedBy !== null) connection.send({ type: 'paused', paused: true, by: pausedBy });
        this.broadcastRoom();
        return seat.playerId;
      }
    }

    if (this.match !== null) return null; // no new seats once a match is running
    if (this.freeSeat() >= this.playerCount) return null;

    const seat: Seat = {
      // The lowest seat nobody holds: once the host has moved people about, the count of
      // people is no longer the next free seat.
      playerId: this.freeSeat(),
      name,
      connection,
      token: this.newToken(),
      ready: false,
      bot: false,
      graceTicks: 0,
    };
    this.seats.push(seat);
    if (this.seats.length === 1) this.hostId = seat.playerId;
    this.sendWelcome(seat);
    this.broadcastRoom();
    return seat.playerId;
  }

  leave(connection: Connection): void {
    const seat = this.seats.find((s) => s.connection?.id === connection.id);
    if (!seat) return;
    seat.connection = null;
    if (this.match === null) {
      // Nothing has started: drop the seat, and leave everybody else where they sit — the
      // host may have put them there. It used to renumber everyone, which undid the
      // seating and never told the renumbered who they had become.
      this.seats.splice(this.seats.indexOf(seat), 1);
      if (seat.playerId === this.hostId && this.seats.length > 0) {
        this.hostId = Math.min(...this.seats.map((s) => s.playerId));
      }
    } else {
      // Mid-match: hold the seat open, and let a bot play it in the meantime so the
      // match does not stall for everyone else.
      seat.graceTicks = this.ticksFor(this.options.server.reconnect.botTakeoverDelayMs);
    }
    this.broadcastRoom();
  }

  handle(connection: Connection, message: ClientMessage): void {
    const seat = this.seats.find((s) => s.connection?.id === connection.id);
    if (!seat) return;

    switch (message.type) {
      case 'ready':
        seat.ready = message.ready;
        this.broadcastRoom();
        return;
      case 'start':
        // At a tournament's table, only from the seat whose tournament it is: a guest left
        // as host has no tournament to record the match in.
        if (seat.playerId !== this.hostId) return;
        if (this.tournament !== null && this.tournament.seats[seat.playerId]?.level !== null)
          return;
        this.start();
        return;
      case 'rematch':
        // A tournament's next match is its host's to send, not this one again.
        if (seat.playerId === this.hostId && this.tournament === null) this.rematch();
        return;
      case 'tournament':
        if (seat.playerId === this.hostId) this.setTournament(message.table, message.save);
        return;
      case 'configure': {
        // Only the host, and only while the table is still being set.
        if (seat.playerId !== this.hostId || this.match !== null) return;
        if (this.tournament !== null) {
          // The tournament's table is fixed: only who sits in which open seat may change.
          if (message.move !== undefined) this.moveSeat(message.move.from, message.move.to);
          this.broadcastRoom();
          return;
        }
        for (let i = 0; i < this.botLevels.length; i++) {
          const wanted = message.bots?.[i];
          if (wanted !== undefined) this.botLevels[i] = wanted;
        }
        let settings = this.settings;
        if (message.settings !== undefined) {
          // Only the fields actually sent: absent ones keep their current value.
          const change = Object.fromEntries(
            Object.entries(message.settings).filter(([, v]) => v !== undefined),
          ) as Partial<MatchSettings>;
          settings =
            mergeSettings(this.settings, change, this.options.server.lobbySettings) ?? settings;
        }
        this.configureTable(settings, message.playerCount ?? this.playerCount, message.teams);
        if (message.seed !== undefined) this.seed = message.seed;
        if (message.move !== undefined) this.moveSeat(message.move.from, message.move.to);
        if (message.hostBot !== undefined) this.hostBot = message.hostBot;
        this.broadcastRoom();
        return;
      }
      case 'pause': {
        // Anyone at the table, watching or playing, and without limit: for the test
        // sessions, trust the table. Only a match under way can be paused.
        if (this.match === null || this.match.finished) return;
        if (!this.match.setPaused(message.paused ? seat.playerId : null)) return; // already so
        this.broadcast({ type: 'paused', paused: message.paused, by: seat.playerId });
        return;
      }
      case 'action': {
        // A seat its bot is playing — the host who chose to watch — acts only through it.
        if (seat.bot || this.match === null) return;
        // Nothing moves while paused, and a move queued now would land on resuming,
        // planned with the board frozen: dropped instead.
        if (this.match.pausedBy !== null) return;
        // The seat decides who acted, never the message: otherwise a client could
        // move on another player's behalf simply by writing a different id.
        const action = ActionSchema.parse({ ...message.action, player: seat.playerId });
        this.match.queue(seat, action);
        return;
      }
      case 'ping':
        connection.send({ type: 'pong', t: message.t, serverTick: this.match?.state.tick ?? 0 });
        return;
      default:
        return;
    }
  }

  /**
   * The table's shape: team size, seats, and who is on which team — changed together,
   * since each constrains the others. A team size needs a player count that makes at
   * least two equal teams; if the current count does not, the smallest that does and
   * seats everyone who has joined is taken. Changing either resets the teams to seat
   * order. An assignment the host sends is taken only if it makes equal teams.
   */
  private configureTable(
    settings: MatchSettings,
    playerCount: number,
    teams: readonly number[] | undefined,
  ): void {
    const table = reshapeTable(
      { settings: this.settings, playerCount: this.playerCount, teams: this.teams },
      { settings, playerCount, ...(teams === undefined ? {} : { teams }) },
      this.options.ruleset.players,
      this.seats.length,
    );
    this.settings = table.settings;
    this.teams = table.teams;
    if (table.playerCount !== this.playerCount) {
      // Seats kept keep their bot's skill; new ones take the server's default.
      this.playerCount = table.playerCount;
      this.botLevels.length = table.playerCount;
      for (let i = 0; i < table.playerCount; i++) {
        this.botLevels[i] ??= this.options.server.botLevel;
      }
      // Anybody seated beyond a shrunken table moves to the lowest free seat; there is
      // always one, since a table never shrinks below the people at it.
      for (const seat of this.seats) {
        if (seat.playerId < this.playerCount) continue;
        const wasHost = seat.playerId === this.hostId;
        seat.playerId = this.freeSeat();
        if (wasHost) this.hostId = seat.playerId;
        this.sendWelcome(seat);
      }
    }
  }

  /**
   * The lowest seat nobody holds, or the table's size when there is none — at a
   * tournament's table, the lowest of its open seats.
   */
  private freeSeat(): number {
    let seat = 0;
    while (
      seat < this.playerCount &&
      (this.seats.some((s) => s.playerId === seat) ||
        (this.tournament !== null && this.tournament.seats[seat]?.open !== true))
    ) {
      seat++;
    }
    return seat;
  }

  /**
   * Sets the room for a tournament's match (docs/TOURNAMENT.md T6): the table as the host's
   * tournament has it, the host in their own seat, everyone else who is here in an open
   * seat — the one they had, while it stays open. Sent once a match is over, it brings the
   * room back to its lobby first, as a rematch does. Refused while a match is under way.
   */
  private setTournament(table: TournamentTable, save: string): void {
    if (this.match !== null && !this.match.finished) return;
    const hostSeat = table.seats.findIndex((seat) => seat.level === null);
    const open = table.seats.flatMap((seat, index) => (seat.open ? [index] : []));
    if (hostSeat < 0 || table.seats[hostSeat]?.open === true) return;
    if (this.match !== null) this.backToLobby();
    this.tournament = table;
    this.tournamentSave = save;
    this.playerCount = table.seats.length;
    this.teams = table.seats.map((seat) => seat.team);
    this.settings = { ...table.settings };
    this.seed = table.seed;
    this.hostBot = null;
    this.botLevels.length = 0;
    for (const seat of table.seats) this.botLevels.push(seat.level ?? this.options.server.botLevel);
    // The host first, then everyone else into the open seats, keeping theirs where it is.
    const host = this.seats.find((s) => s.playerId === this.hostId);
    const guests = this.seats.filter((s) => s !== host);
    const kept = new Set<number>();
    for (const guest of guests) {
      if (open.includes(guest.playerId) && !kept.has(guest.playerId)) kept.add(guest.playerId);
    }
    const free = open.filter((seat) => !kept.has(seat));
    for (const guest of guests) {
      if (kept.has(guest.playerId) && open.includes(guest.playerId)) continue;
      const seat = free.shift();
      if (seat === undefined) {
        // More people than open seats: only a table sent wrongly; the latest are let go.
        guest.connection?.close('the table has no seat for you');
        this.seats.splice(this.seats.indexOf(guest), 1);
        continue;
      }
      guest.playerId = seat;
      kept.add(seat);
    }
    if (host !== undefined) host.playerId = hostSeat;
    this.hostId = hostSeat;
    for (const seat of this.seats) {
      seat.ready = false;
      this.sendWelcome(seat);
    }
    this.broadcastRoom();
  }

  /**
   * Moves a person to another seat, swapping with whoever sits there. A bot swapped out
   * takes the person's old seat and keeps its skill; the host stays host wherever they
   * go. Everyone moved is told their new seat, as the start tells them their player.
   */
  private moveSeat(from: number, to: number): void {
    if (from === to || to >= this.playerCount) return;
    const mover = this.seats.find((s) => s.playerId === from);
    if (mover === undefined) return;
    if (this.tournament !== null) {
      // Between open seats only, and the bots stay with their seats: the tournament's bot
      // in a seat a person takes is the one that sits the match out.
      const open = (seat: number): boolean => this.tournament?.seats[seat]?.open === true;
      if (!open(from) || !open(to)) return;
      const other = this.seats.find((s) => s.playerId === to);
      mover.playerId = to;
      if (other !== undefined) other.playerId = from;
      this.sendWelcome(mover);
      if (other !== undefined) this.sendWelcome(other);
      return;
    }
    const other = this.seats.find((s) => s.playerId === to);
    const hostWas = this.hostId;
    mover.playerId = to;
    if (other !== undefined) other.playerId = from;
    if (hostWas === from) this.hostId = to;
    else if (hostWas === to && other !== undefined) this.hostId = from;
    const fromLevel = this.botLevels[from] as number;
    this.botLevels[from] = this.botLevels[to] as number;
    this.botLevels[to] = fromLevel;
    this.sendWelcome(mover);
    if (other !== undefined) this.sendWelcome(other);
  }

  // --------------------------------------------------------------------- match

  start(): void {
    if (this.match !== null) return;
    // Unequal teams cannot start. The host's controls never produce them, so this only
    // turns away a crafted message.
    if (!teamsBalanced(this.teams, this.settings.teamSize)) return;
    // Fill the rest of the table with bots so a match can start under-subscribed — in the
    // seats nobody holds, which after the host's moves need not be the last ones.
    for (let i = 0; i < this.playerCount; i++) {
      if (this.seats.some((s) => s.playerId === i)) continue;
      this.seats.push({
        playerId: i,
        // Numbered from one, as the lobby numbers its seats; a tournament's have names.
        name: this.tournament?.seats[i]?.name ?? `Bot ${i + 1}`,
        connection: null,
        token: this.newToken(),
        ready: true,
        bot: true,
        graceTicks: 0,
      });
    }

    // Where the people sit in the lobby, for a rematch to put them back.
    this.lobbySeats = new Map(
      this.seats.filter((s) => !s.bot).map((s) => [s.token, s.playerId] as const),
    );
    this.lobbyHost = this.hostId;

    // In seat order, so a seat's index here is its place at the table: its team, its bot's
    // skill, and what the shuffle deals it are all by seat.
    this.seats.sort((a, b) => a.playerId - b.playerId);

    // Which player, and so which island, each seat becomes — shuffled, so no seat is
    // always the one with the awkward neighbours.
    const seed = this.seed;
    const players = new Array<{ name: string; isBot: boolean; team: number }>(this.seats.length);
    const levels = this.seats.map(
      (_, index) => this.botLevels[index] ?? this.options.server.botLevel,
    );
    const hostSeat = this.seats.findIndex((seat) => seat.playerId === this.hostId);
    // The host chose to watch: their seat is played by the bot they picked, and they stay
    // connected to see it. With nobody else at the table, it is a match of bots alone.
    const hosting = this.seats[hostSeat];
    if (this.hostBot !== null && hosting !== undefined) {
      hosting.bot = true;
      levels[hostSeat] = this.hostBot;
    }
    // Each seat's bot, by player once the seats are dealt their islands (PLAN 11.6) — a
    // person's seat gets one too, for the bot that covers them if they drop. For the
    // recording, a person is nulls.
    const { playerOfSeat, setups } = dealSeats(
      seed,
      this.seats.map((seat, index) => ({
        level: levels[index] as number,
        bot: seat.bot,
        // A tournament's bots keep theirs; a person's seat is covered by the seat's bot.
        personality: this.tournament?.seats[index]?.personality ?? null,
        team: this.teams[index] ?? index,
      })),
      this.options.terrain,
    );
    const recorded = new Array<{ level: number | null; personality: Personality | null }>(
      this.seats.length,
    );
    this.seats.forEach((seat, index) => {
      const player = playerOfSeat[index] as number;
      players[player] = { name: seat.name, isBot: seat.bot, team: this.teams[index] ?? index };
      recorded[player] = seat.bot
        ? (setups[player] as BotSetup)
        : { level: null, personality: null };
      seat.playerId = player;
    });
    this.hostId = this.seats[hostSeat]?.playerId ?? 0;

    // The server's rules with the host's settings over them. It travels in the snapshot
    // like any ruleset, so every client runs exactly these.
    const ruleset = applySettings(this.options.ruleset, this.settings);
    const state = createMatch({
      seed,
      ruleset,
      terrainConfig: this.options.terrain,
      players,
      ...(this.tournament === null ? {} : { teamNames: this.tournament.teamNames }),
    });

    let recorder: MatchRecorder | null = null;
    if (this.options.record !== undefined) {
      const startedAt = new Date();
      recorder = new MatchRecorder(this.options.record, {
        id: recordingId('server', startedAt, this.code),
        source: 'server',
        startedAt: startedAt.toISOString(),
        code: this.code,
        seed,
        ruleset,
        terrain: this.options.terrain,
        players: players.map((p, id) => ({
          ...p,
          ...(recorded[id] ?? { level: null, personality: null }),
        })),
        ...(this.tournament === null ? {} : { tournament: this.tournament.tournament }),
      });
    }

    // The plans the bots may make on one tick between them, a fresh set each match. A seat
    // a person holds still gets a bot, ready to cover them if they drop.
    const slots = new PlanningSlots(this.options.ai.plansPerTick);
    const bots = new Map<number, Bot>();
    for (const seat of this.seats) {
      const setup = setups[seat.playerId] as BotSetup;
      bots.set(seat.playerId, new Bot(seat.playerId, setup, this.options.ai, slots));
    }
    const match = new MatchRunner(state, bots, recorder, this.rng, this.seats, (message) =>
      this.broadcast(message),
    );
    this.match = match;

    // Every connection learns the player it has become before the match reaches it.
    for (const seat of this.seats) this.sendWelcome(seat);
    this.broadcastRoom();
    for (const seat of this.seats) match.sendSnapshot(seat);
  }

  /**
   * Back to the lobby once a match is over (PLAN 11.18 Y6): everyone still connected in the
   * seat they had before the start, the table — levels, teams, settings — as it was, the
   * bots that filled the empty seats gone, and a new map. Each person is told their seat
   * again, then the room, which their page reads as the lobby; the host starts as ever.
   */
  rematch(): void {
    if (this.match === null || !this.match.finished) return;
    this.backToLobby();
    this.seed = this.rng.nextU32();
    for (const seat of this.seats) this.sendWelcome(seat);
    this.broadcastRoom();
  }

  /** The finished match gone, and everyone still here back in their lobby seats. */
  private backToLobby(): void {
    this.match = null;
    this.seats.splice(
      0,
      this.seats.length,
      ...this.seats.filter((s) => s.connection !== null && this.lobbySeats.has(s.token)),
    );
    for (const seat of this.seats) {
      seat.playerId = this.lobbySeats.get(seat.token) as number;
      seat.bot = false;
      seat.ready = false;
      seat.graceTicks = 0;
    }
    // The host came back in their own seat, or — had they left — whoever sits lowest.
    this.hostId = this.seats.some((s) => s.playerId === this.lobbyHost)
      ? this.lobbyHost
      : Math.min(...this.seats.map((s) => s.playerId));
  }

  /** Advances the match by elapsed real time. Called by the host loop, or by tests. */
  update(elapsedMs: number): void {
    if (this.empty) this.idle += elapsedMs;
    else this.idle = 0;
    this.match?.update(elapsedMs);
  }

  // ------------------------------------------------------------------ plumbing

  private ticksFor(ms: number): number {
    return Math.ceil((ms * this.options.ruleset.tickRateHz) / 1000);
  }

  private newToken(): string {
    return this.rng.nextU32().toString(36) + this.rng.nextU32().toString(36);
  }

  private wireSeats(): WireSeat[] {
    return this.seats.map((seat) => ({
      playerId: seat.playerId,
      name: seat.name,
      isBot: seat.bot,
      connected: seat.connection !== null,
      ready: seat.ready,
    }));
  }

  private sendWelcome(seat: Seat): void {
    seat.connection?.send({
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      code: this.code,
      playerId: seat.playerId,
      token: seat.token,
      hostId: this.hostId,
    });
    // Every welcome — a join, a return, a new tournament's table — brings the tournament.
    if (this.tournamentSave !== null) {
      seat.connection?.send({ type: 'tournamentSave', save: this.tournamentSave });
    }
  }

  private broadcastRoom(): void {
    this.broadcast({
      type: 'room',
      code: this.code,
      seats: this.wireSeats(),
      playerCount: this.playerCount,
      bots: [...this.botLevels],
      settings: { ...this.settings },
      settingBounds: this.options.server.lobbySettings,
      teams: [...this.teams],
      seed: this.seed,
      hostBot: this.hostBot,
      playerLimits: { ...this.options.ruleset.players },
      hostId: this.hostId,
      started: this.started,
      internet: this.options.publicUrl?.() ?? null,
      tournament: this.tournament,
    });
  }

  /** The lobby told again, while it is one: the public address came or went. */
  refreshLobby(): void {
    if (!this.started) this.broadcastRoom();
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats) seat.connection?.send(message);
  }
}
