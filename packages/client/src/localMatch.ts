import {
  BALANCED,
  defaultRuleset,
  defaultTerrainConfig,
  type BotSetup,
  type Personality,
  type Ruleset,
} from '@rampart/config';
import { Bot, dealPersonalities } from '@rampart/ai';
import { MatchRecorder, recordingId, type RecordingLine } from '@rampart/protocol';

import {
  Rng,
  applyAction,
  createMatch,
  drainEvents,
  seatOrder,
  step,
  type Action,
  type MatchEvent,
  type MatchState,
  type Phase,
  type Rejection,
} from '@rampart/sim';

export interface LocalMatchOptions {
  seed: number;
  /**
   * One entry per seat: `null` for the person at the keyboard, otherwise the skill level
   * of the bot playing it, 1 to 10. Every entry being a level is a watching match, which
   * is the clearest way to see how the bots actually play.
   */
  seats: readonly (number | null)[];
  /**
   * One personality for every bot, for testing (`?personality=`); otherwise each is dealt
   * from the seed exactly as a room deals it.
   */
  personality?: Personality;
  /** Each seat's team, by seat. Omitted, every seat is on its own. */
  teams?: readonly number[];
  ruleset?: Ruleset;
  /** Where the match's recording goes, line by line; see `recording.ts`. */
  record?: (line: RecordingLine) => void;
}

/**
 * A match running entirely in the browser, with no server.
 *
 * Every seat but the person's is played by a bot from `@rampart/ai`, exactly as the
 * server would play it, and seats are shuffled onto islands the same way — so an offline
 * match is an online one with nobody else in it.
 */
export class LocalMatch {
  readonly state: MatchState;
  /** Seat the person holds, or -1 when nobody is playing and the match is watched. */
  readonly humanPlayer: number;
  private readonly rng: Rng;
  private readonly bots = new Map<number, Bot>();
  private readonly tickMs: number;
  private accumulator = 0;
  private events: MatchEvent[] = [];
  private recorder: MatchRecorder | null = null;
  /** Each bot's level and personality, by player, for the reveal at the end. */
  readonly setups: ReadonlyMap<number, BotSetup>;
  /** Everything applied on the current tick, in order, for the recording. */
  private applied: Action[] = [];

  constructor(options: LocalMatchOptions) {
    const ruleset = options.ruleset ?? defaultRuleset;
    const seats = options.seats;
    // Which player — so which island — each seat becomes, shuffled exactly as the server
    // does it, so an offline match seats people as an online one would.
    const order = seatOrder(options.seed, seats.length);
    const humanSeat = seats.findIndex((seat) => seat === null);
    this.humanPlayer = humanSeat < 0 ? -1 : (order[humanSeat] as number);

    const players = new Array<{ name: string; isBot: boolean; team: number }>(seats.length);
    seats.forEach((seat, index) => {
      players[order[index] as number] = {
        // Numbered by seat, as the lobby and a room number them.
        name: seat === null ? 'You' : `Bot ${index + 1}`,
        isBot: seat !== null,
        team: options.teams?.[index] ?? index,
      };
    });
    this.state = createMatch({
      seed: options.seed,
      ruleset,
      terrainConfig: defaultTerrainConfig,
      players,
    });

    // Each bot's level, and a personality dealt from the seed as a room deals it.
    const isBot = new Array<boolean>(seats.length);
    seats.forEach((seat, index) => {
      isBot[order[index] as number] = seat !== null;
    });
    const dealt = dealPersonalities(options.seed, isBot);
    const setups = new Map<number, BotSetup>();
    seats.forEach((seat, index) => {
      const id = order[index] as number;
      if (seat === null) return;
      const setup = {
        level: seat,
        personality: options.personality ?? (dealt[id] as Personality),
      };
      setups.set(id, setup);
      this.bots.set(id, new Bot(id, setup));
    });
    this.setups = setups;
    this.rng = new Rng(options.seed ^ 0x5f3759df);
    this.tickMs = 1000 / ruleset.tickRateHz;

    if (options.record !== undefined) {
      const startedAt = new Date();
      const unique = Math.floor(Math.random() * 0xffffffff).toString(36);
      this.recorder = new MatchRecorder(options.record, {
        id: recordingId('local', startedAt, unique),
        source: 'local',
        startedAt: startedAt.toISOString(),
        code: null,
        seed: options.seed,
        ruleset,
        terrain: defaultTerrainConfig,
        players: players.map((p, id) => ({
          ...p,
          level: setups.get(id)?.level ?? null,
          personality: setups.get(id)?.personality ?? null,
        })),
      });
    }
  }

  /** Fraction of the way into the current tick, for smooth shot interpolation. */
  get tickFraction(): number {
    return Math.min(1, this.accumulator / this.tickMs);
  }

  get finished(): boolean {
    return this.state.phase === 'game_over';
  }

  /** Applies a human action immediately; returns null when accepted. */
  submit(action: Action): Rejection | null {
    const rejection = applyAction(this.state, action);
    // Applied on the tick about to be stepped, ahead of the bots' — the order a replay
    // must apply them in.
    if (rejection === null) this.applied.push(action);
    return rejection;
  }

  /**
   * Advances by real elapsed time, in fixed simulation ticks.
   *
   * The accumulator is capped so that a backgrounded tab does not return and
   * fast-forward through a whole phase the player never saw.
   */
  advance(elapsedMs: number): MatchEvent[] {
    if (this.finished) return this.takeEvents();
    this.accumulator += Math.min(elapsedMs, 250);
    while (this.accumulator >= this.tickMs && !this.finished) {
      this.accumulator -= this.tickMs;
      this.stepOnce();
    }
    return this.takeEvents();
  }

  /**
   * Runs the match forward with every seat, including the player's, driven by the
   * scripted driver. Dev only: it exists so a given phase can be put on screen
   * deterministically, without waiting out the clock or playing to get there.
   */
  fastForwardTo(phase: Phase, fromRound = 0, humanIdle = false, maxTicks = 40_000): void {
    // A dev shortcut, not a match anyone played: nothing of it is worth keeping.
    this.recorder = null;
    const arrived = (): boolean => this.state.phase === phase && this.state.round >= fromRound;
    while (!arrived() && this.state.tick < maxTicks && !this.finished) {
      for (const player of this.state.players) {
        if (player.eliminated) continue;
        // Left to itself, the person's seat builds nothing and is soon knocked out,
        // which is the quickest way to put a mid-match elimination on screen.
        if (humanIdle && player.id === this.humanPlayer) continue;
        const action = this.botFor(player.id).think(this.state, this.rng);
        if (action !== null) applyAction(this.state, action);
      }
      step(this.state);
      drainEvents(this.state);
    }
  }

  private stepOnce(): void {
    for (const player of this.state.players) {
      if (player.id === this.humanPlayer || player.eliminated) continue;
      const action = this.bots.get(player.id)?.think(this.state, this.rng) ?? null;
      if (action !== null && applyAction(this.state, action) === null) this.applied.push(action);
    }
    const tick = this.state.tick;
    step(this.state);
    this.events.push(...drainEvents(this.state));
    this.recorder?.stepped(tick, this.applied, this.state);
    this.applied = [];
  }

  /** Fast-forwarding drives every seat, including the person's. */
  private botFor(playerId: number): Bot {
    let bot = this.bots.get(playerId);
    if (!bot) {
      bot = new Bot(playerId, { level: 5, personality: BALANCED });
      this.bots.set(playerId, bot);
    }
    return bot;
  }

  private takeEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
