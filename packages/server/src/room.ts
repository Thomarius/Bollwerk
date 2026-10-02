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
import { Bot, dealPersonalities } from '@bollwerk/ai';
import {
  ActionSchema,
  MatchRecorder,
  PROTOCOL_VERSION,
  captureSnapshot,
  recordingId,
  type RecordingLine,
  type RoomListing,
  type ClientMessage,
  type Seat as WireSeat,
  type ServerMessage,
} from '@bollwerk/protocol';
import {
  Rng,
  applyAction,
  createMatch,
  drainEvents,
  hashMatchState,
  seatOrder,
  step,
  type Action,
  type MatchState,
} from '@bollwerk/sim';

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

interface Seat {
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
  hostName: string;
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
}

/** How often the server sends its state fingerprint for clients to check against. */
const HASH_EVERY_TICKS = 30;

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

  private state: MatchState | null = null;
  /** One per seat, created when the match starts: a bot keeps a plan between ticks. */
  private bots = new Map<number, Bot>();
  private accumulatorMs = 0;
  private pending: { seat: Seat; action: Action }[] = [];
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
  private recorder: MatchRecorder | null = null;
  /**
   * The player who paused the match, or null while it runs. Every timer in the match is
   * counted in ticks, so a paused room simply steps none — bots, phase clocks and
   * reconnect grace all wait — and adds nothing to the recording.
   */
  private pausedBy: number | null = null;
  /**
   * Where each person sat in the lobby, by token, as the match started: the start deals
   * seats onto islands and renumbers them, and a rematch puts everyone back.
   */
  private lobbySeats = new Map<string, number>();
  private lobbyHost = 0;

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
    return this.state !== null;
  }

  get finished(): boolean {
    return this.state?.phase === 'game_over';
  }

  get paused(): boolean {
    return this.pausedBy !== null;
  }

  /**
   * How the games browser lists this room, or null when it should not: private, under
   * way, or with no seat left. Whoever has the lowest seat among the people is named as
   * the host, as the lobby does.
   */
  listing(): RoomListing | null {
    if (this.options.public === false || this.state !== null) return null;
    if (this.seats.length === 0 || this.seats.length >= this.playerCount) return null;
    const host = this.seats.find((s) => s.playerId === this.hostId) ?? this.seats[0]!;
    return {
      code: this.code,
      host: host.name,
      people: this.seats.length,
      playerCount: this.playerCount,
      teamSize: this.settings.teamSize,
      maxRounds: this.settings.maxRounds,
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
          this.state !== null && seat.playerId === this.hostId && this.hostBot !== null;
        seat.bot = watching;
        seat.graceTicks = 0;
        this.sendWelcome(seat);
        if (this.state) this.sendSnapshot(seat);
        if (this.pausedBy !== null) {
          connection.send({ type: 'paused', paused: true, by: this.pausedBy });
        }
        this.broadcastRoom();
        return seat.playerId;
      }
    }

    if (this.state !== null) return null; // no new seats once a match is running
    if (this.seats.length >= this.playerCount) return null;

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
    if (this.state === null) {
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
        if (seat.playerId === this.hostId) this.start();
        return;
      case 'rematch':
        if (seat.playerId === this.hostId) this.rematch();
        return;
      case 'configure': {
        // Only the host, and only while the table is still being set.
        if (seat.playerId !== this.hostId || this.state !== null) return;
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
        if (this.state === null || this.finished) return;
        const wanted = message.paused ? seat.playerId : null;
        if ((wanted === null) === (this.pausedBy === null)) return; // already so
        this.pausedBy = wanted;
        // Resuming starts the clock afresh rather than paying out the pause as a burst.
        this.accumulatorMs = 0;
        this.broadcast({ type: 'paused', paused: message.paused, by: seat.playerId });
        return;
      }
      case 'action': {
        // A seat its bot is playing — the host who chose to watch — acts only through it.
        if (seat.bot) return;
        // Nothing moves while paused, and a move queued now would land on resuming,
        // planned with the board frozen: dropped instead.
        if (this.pausedBy !== null) return;
        // The seat decides who acted, never the message: otherwise a client could
        // move on another player's behalf simply by writing a different id.
        const action = ActionSchema.parse({ ...message.action, player: seat.playerId });
        this.pending.push({ seat, action });
        return;
      }
      case 'ping':
        connection.send({ type: 'pong', t: message.t, serverTick: this.state?.tick ?? 0 });
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

  /** The lowest seat nobody holds. */
  private freeSeat(): number {
    let seat = 0;
    while (this.seats.some((s) => s.playerId === seat)) seat++;
    return seat;
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
    if (this.state !== null) return;
    // Unequal teams cannot start. The host's controls never produce them, so this only
    // turns away a crafted message.
    if (!teamsBalanced(this.teams, this.settings.teamSize)) return;
    // Fill the rest of the table with bots so a match can start under-subscribed — in the
    // seats nobody holds, which after the host's moves need not be the last ones.
    for (let i = 0; i < this.playerCount; i++) {
      if (this.seats.some((s) => s.playerId === i)) continue;
      this.seats.push({
        playerId: i,
        // Numbered from one, as the lobby numbers its seats.
        name: `Bot ${i + 1}`,
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
    const order = seatOrder(seed, this.seats.length);
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
    // Each seat's bot, by player once the seats are dealt their islands: its level, and a
    // personality dealt from the seed (PLAN 11.6) — a person's seat gets one too, for the
    // bot that covers them if they drop. For the recording, a person is nulls.
    const isBot = new Array<boolean>(this.seats.length);
    this.seats.forEach((seat, index) => {
      isBot[order[index] as number] = seat.bot;
    });
    const personalities = dealPersonalities(seed, isBot);
    const setups = new Array<BotSetup>(this.seats.length);
    const recorded = new Array<{ level: number | null; personality: Personality | null }>(
      this.seats.length,
    );
    this.seats.forEach((seat, index) => {
      const player = order[index] as number;
      players[player] = { name: seat.name, isBot: seat.bot, team: this.teams[index] ?? index };
      const setup = {
        level: levels[index] as number,
        personality: personalities[player] as Personality,
      };
      setups[player] = setup;
      recorded[player] = seat.bot ? setup : { level: null, personality: null };
      seat.playerId = player;
    });
    this.hostId = this.seats[hostSeat]?.playerId ?? 0;

    // The server's rules with the host's settings over them. It travels in the snapshot
    // like any ruleset, so every client runs exactly these.
    const ruleset = applySettings(this.options.ruleset, this.settings);
    this.state = createMatch({
      seed,
      ruleset,
      terrainConfig: this.options.terrain,
      players,
    });

    if (this.options.record !== undefined) {
      const startedAt = new Date();
      this.recorder = new MatchRecorder(this.options.record, {
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
      });
    }

    for (const seat of this.seats) {
      // A seat a person holds still gets a bot, ready to cover them if they drop.
      const setup = setups[seat.playerId] as BotSetup;
      this.bots.set(seat.playerId, new Bot(seat.playerId, setup, this.options.ai));
    }

    // Every connection learns the player it has become before the match reaches it.
    for (const seat of this.seats) this.sendWelcome(seat);
    this.broadcastRoom();
    for (const seat of this.seats) this.sendSnapshot(seat);
  }

  /**
   * Back to the lobby once a match is over (PLAN 11.18 Y6): everyone still connected in the
   * seat they had before the start, the table — levels, teams, settings — as it was, the
   * bots that filled the empty seats gone, and a new map. Each person is told their seat
   * again, then the room, which their page reads as the lobby; the host starts as ever.
   */
  rematch(): void {
    if (this.state === null || this.state.phase !== 'game_over') return;
    this.state = null;
    this.bots.clear();
    this.recorder = null;
    this.pausedBy = null;
    this.pending = [];
    this.accumulatorMs = 0;
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
    this.seed = this.rng.nextU32();
    for (const seat of this.seats) this.sendWelcome(seat);
    this.broadcastRoom();
  }

  /** Advances the match by elapsed real time. Called by the host loop, or by tests. */
  update(elapsedMs: number): void {
    if (this.empty) this.idle += elapsedMs;
    else this.idle = 0;

    const state = this.state;
    if (state === null || state.phase === 'game_over' || this.pausedBy !== null) return;

    const tickMs = 1000 / state.ruleset.tickRateHz;
    this.accumulatorMs += Math.min(elapsedMs, 1000);
    while (this.accumulatorMs >= tickMs) {
      this.accumulatorMs -= tickMs;
      this.tick(state);
      if (this.finished) break;
    }
  }

  private tick(state: MatchState): void {
    const applied: Action[] = [];

    for (const seat of this.seats) {
      if (seat.connection !== null || seat.bot) continue;
      // A dropped player is played by a bot once the grace period lapses, so the
      // rest of the table is not held hostage by one dead connection.
      if (seat.graceTicks > 0) seat.graceTicks--;
    }

    for (const seat of this.seats) {
      const playsItself = seat.bot || (seat.connection === null && seat.graceTicks === 0);
      if (!playsItself) continue;
      const action = this.bots.get(seat.playerId)?.think(state, this.rng) ?? null;
      if (action !== null && applyAction(state, action) === null) applied.push(action);
    }

    for (const { seat, action } of this.pending) {
      if (seat.connection === null) continue;
      const rejection = applyAction(state, action);
      if (rejection === null) applied.push(action);
      else seat.connection.send({ type: 'rejected', action, reason: rejection });
    }
    this.pending = [];

    const tick = state.tick;
    step(state);
    drainEvents(state);
    this.recorder?.stepped(tick, applied, state);

    const commit: ServerMessage = { type: 'commit', tick, actions: applied };
    if (tick % HASH_EVERY_TICKS === 0) commit.hash = hashMatchState(state);
    this.broadcast(commit);
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
  }

  private sendSnapshot(seat: Seat): void {
    if (this.state === null) return;
    seat.connection?.send({ type: 'snapshot', snapshot: captureSnapshot(this.state) });
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
    });
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats) seat.connection?.send(message);
  }
}
