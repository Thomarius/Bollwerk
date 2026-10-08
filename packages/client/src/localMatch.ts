import {
  BALANCED,
  defaultAiConfig,
  defaultRuleset,
  defaultTerrainConfig,
  type BotSetup,
  type Personality,
  type Ruleset,
} from '@bollwerk/config';
import { Bot, PlanningSlots, dealSeats, takeBotTurns, turnOrder } from '@bollwerk/ai';
import { MatchRecorder, recordingId, type RecordingLine } from '@bollwerk/protocol';

import {
  Rng,
  applyAction,
  createMatch,
  drainEvents,
  step,
  type Action,
  type MatchEvent,
  type MatchState,
  type Phase,
  type Rejection,
} from '@bollwerk/sim';

import { t } from './i18n.js';

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
  /**
   * Each seat's name, by seat, where the table names it — a tournament's bots and its host;
   * otherwise the person is "You" and a bot is numbered by seat.
   */
  names?: readonly (string | null)[];
  /** Each seat's bot's personality, by seat, where the table gives one rather than dealing it. */
  personalities?: readonly (Personality | null)[];
  /** The tournament this match is part of, for the recording's header. */
  tournament?: { id: string; step: number };
  ruleset?: Ruleset;
  /** Where the match's recording goes, line by line; see `recording.ts`. */
  record?: (line: RecordingLine) => void;
  /** Milliseconds of a frame the bots may think in; 0 for one bot a frame, in tests. */
  thinkBudgetMs?: number;
}

/** Milliseconds of a frame the bots may think in before the rest wait for the next. */
const THINK_BUDGET_MS = 8;

/**
 * A match running entirely in the browser, with no server.
 *
 * Every seat but the person's is played by a bot from `@bollwerk/ai`, exactly as the
 * server would play it, and seats are shuffled onto islands the same way — so an offline
 * match is an online one with nobody else in it.
 */
export class LocalMatch {
  readonly state: MatchState;
  /** Seat the person holds, or -1 when nobody is playing and the match is watched. */
  readonly humanPlayer: number;
  private readonly rng: Rng;
  private readonly bots = new Map<number, Bot>();
  /** The plans the bots may make on one tick between them, shared by all of them. */
  private readonly slots = new PlanningSlots(defaultAiConfig.plansPerTick);
  private readonly tickMs: number;
  /**
   * The next turn to think on the tick in progress, or null between ticks. A bot planning
   * its walls takes 15 to 50 ms, and bots of one level planned on the same ticks: eight of
   * them froze the page for up to 135 ms (PLAN 11.22). Since then they share a few plans a
   * tick (`PlanningSlots`), and a tick's thinking may still run over several frames, the
   * screen drawn between; the actions and the tick they land on are the same.
   */
  private thinking: number | null = null;
  private readonly thinkBudgetMs: number;
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
    // Which player — so which island — each seat becomes, and each bot's level with a
    // personality dealt from the seed: exactly as a room deals them, so an offline match
    // seats people as an online one would.
    const { playerOfSeat: order, setups: dealt } = dealSeats(
      options.seed,
      seats.map((level, index) => ({
        level,
        bot: level !== null,
        personality: options.personalities?.[index] ?? null,
      })),
    );
    const humanSeat = seats.findIndex((seat) => seat === null);
    this.humanPlayer = humanSeat < 0 ? -1 : (order[humanSeat] as number);

    const players = new Array<{ name: string; isBot: boolean; team: number }>(seats.length);
    seats.forEach((seat, index) => {
      players[order[index] as number] = {
        // Numbered by seat, as the lobby and a room number them.
        name:
          options.names?.[index] ??
          (seat === null ? t('local.you') : t('lobby.bot', { n: index + 1 })),
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

    const setups = new Map<number, BotSetup>();
    dealt.forEach((given, id) => {
      if (given === null) return;
      // `?personality=` fixes every bot's, for testing.
      const setup = { ...given, personality: options.personality ?? given.personality };
      setups.set(id, setup);
      this.bots.set(id, new Bot(id, setup, defaultAiConfig, this.slots));
    });
    this.setups = setups;
    this.rng = new Rng(options.seed ^ 0x5f3759df);
    this.tickMs = 1000 / ruleset.tickRateHz;
    this.thinkBudgetMs = options.thinkBudgetMs ?? THINK_BUDGET_MS;

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
        ...(options.tournament === undefined ? {} : { tournament: options.tournament }),
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
    const deadline = performance.now() + this.thinkBudgetMs;
    let progressed = false;
    while ((this.thinking !== null || this.accumulator >= this.tickMs) && !this.finished) {
      if (this.thinking === null) {
        this.accumulator -= this.tickMs;
        this.thinking = 0;
      }
      // Out of time among the bots: the rest of them, and the step, wait for the next frame.
      if (!this.think(deadline, progressed)) break;
      progressed = true;
      this.stepOnce();
    }
    return this.takeEvents();
  }

  /**
   * The bots' turns on the tick in progress, from where the last frame stopped; false when
   * the frame's time ran out first. Always at least one, so a match never stalls.
   */
  private think(deadline: number, progressed: boolean): boolean {
    const players = turnOrder(this.state.players, this.state.round);
    while (this.thinking !== null && this.thinking < players.length) {
      if (progressed && performance.now() > deadline) return false;
      const player = players[this.thinking++] as (typeof players)[number];
      progressed = true;
      if (player.id === this.humanPlayer || player.eliminated) continue;
      const action = this.bots.get(player.id)?.think(this.state, this.rng) ?? null;
      if (action !== null && applyAction(this.state, action) === null) this.applied.push(action);
    }
    this.thinking = null;
    return true;
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
      // Left to itself, the person's seat builds nothing and is soon knocked out, which
      // is the quickest way to put a mid-match elimination on screen.
      takeBotTurns(this.state, this.rng, (player) =>
        this.state.players[player]?.eliminated === true ||
        (humanIdle && player === this.humanPlayer)
          ? null
          : this.botFor(player),
      );
      step(this.state);
      drainEvents(this.state);
    }
  }

  /** The tick, once every bot has had its turn on it. */
  private stepOnce(): void {
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
      bot = new Bot(playerId, { level: 5, personality: BALANCED }, defaultAiConfig, this.slots);
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
