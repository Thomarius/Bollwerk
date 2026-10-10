import {
  defaultAiConfig,
  defaultRuleset,
  defaultTerrainConfig,
  type BotSetup,
  type Personality,
  type Ruleset,
} from '@bollwerk/config';
import { dealSeats } from '@bollwerk/ai';
import { MatchRecorder, recordingId, type RecordingLine } from '@bollwerk/protocol';

import {
  applyAction,
  createMatch,
  drainEvents,
  hashMatchState,
  step,
  type Action,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
  type Phase,
  type Rejection,
} from '@bollwerk/sim';

import { botTurns } from './bots/botTurns.js';
import { ThreadDriver, botRngSeed, type BotDriver } from './bots/driver.js';
import { WorkerDriver, type BotTransport, type WorkerTiming } from './bots/workerDriver.js';
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
  /** Each team's name, by team label in order, where the table names them. */
  teamNames?: readonly string[];
  /** The tournament this match is part of, for the recording's header. */
  tournament?: { id: string; step: number };
  ruleset?: Ruleset;
  /** Where the match's recording goes, line by line; see `recording.ts`. */
  record?: (line: RecordingLine) => void;
  /** Milliseconds of a frame the bots may think in; 0 for one bot a frame, in tests. */
  thinkBudgetMs?: number;
  /**
   * The bots' worker, to plan off the page's thread (PLAN §11 item 3); omitted, they think
   * on the page's thread, as they must for a dev fast-forward.
   */
  worker?: BotTransport;
  /** How long the worker may stay quiet, for tests; the defaults otherwise. */
  workerTiming?: WorkerTiming;
  /**
   * Wraps the work done when the worker answers — applying its actions and stepping — which
   * happens outside any frame, so `&perf=1` can count it as the sim's.
   */
  timed?: (work: () => void) => void;
}

/** Milliseconds of a frame the bots may think in before the rest wait for the next. */
const THINK_BUDGET_MS = 8;

/**
 * A match running entirely in the browser, with no server.
 *
 * Every seat but the person's is played by a bot from `@bollwerk/ai`, exactly as the
 * server would play it, and seats are shuffled onto islands the same way — so an offline
 * match is an online one with nobody else in it.
 *
 * The bots think in a worker where one is given, on the page's thread otherwise
 * (`BotDriver`): either way this holds the match and steps it, each tick once its bots
 * have taken their turns, so they play action for action alike.
 */
export class LocalMatch {
  readonly state: MatchState;
  /** Seat the person holds, or -1 when nobody is playing and the match is watched. */
  readonly humanPlayer: number;
  /** Each bot's level and personality, by player, for the reveal at the end. */
  readonly setups: ReadonlyMap<number, BotSetup>;
  /** Paused: no new tick is taken, though a turn already out is still applied. */
  halted = false;
  private driver: BotDriver;
  private readonly seed: number;
  private readonly tickMs: number;
  private readonly thinkBudgetMs: number;
  private readonly timed: (work: () => void) => void;
  private accumulator = 0;
  /** A tick has been taken from the accumulator and waits for its bots' turns to step. */
  private inTick = false;
  private events: MatchEvent[] = [];
  private recorder: MatchRecorder | null = null;
  /** Everything applied on the current tick, in order, for the recording. */
  private applied: Action[] = [];
  /** The person's moves made while the worker had the tick's turn: they go on the next. */
  private queued: Action[] = [];

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
        team: options.teams?.[index] ?? index,
      })),
      defaultTerrainConfig,
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
    const matchOptions: MatchOptions = {
      seed: options.seed,
      ruleset,
      terrainConfig: defaultTerrainConfig,
      players,
      ...(options.teamNames === undefined ? {} : { teamNames: options.teamNames }),
    };
    this.state = createMatch(matchOptions);

    const setups = new Map<number, BotSetup>();
    dealt.forEach((given, id) => {
      if (given === null) return;
      // `?personality=` fixes every bot's, for testing.
      setups.set(id, { ...given, personality: options.personality ?? given.personality });
    });
    this.setups = setups;
    this.seed = options.seed;
    this.tickMs = 1000 / ruleset.tickRateHz;
    this.thinkBudgetMs = options.thinkBudgetMs ?? THINK_BUDGET_MS;
    this.timed = options.timed ?? ((work) => work());

    this.driver = this.threadDriver(botRngSeed(options.seed));
    if (options.worker !== undefined) {
      try {
        this.driver = new WorkerDriver(
          options.worker,
          {
            answered: (actions, hash) => this.answered(actions, hash),
            failed: (reason) => this.fallBack(reason),
          },
          {
            options: matchOptions,
            bots: [...setups].map(([player, setup]) => ({ player, setup })),
            humanPlayer: this.humanPlayer,
            plansPerTick: defaultAiConfig.plansPerTick,
            rngSeed: botRngSeed(options.seed),
          },
          hashMatchState(this.state),
          () => this.state.tick,
          options.workerTiming,
        );
      } catch (error) {
        // Nothing has been played: the thread's bots are the very ones the worker's would be.
        console.warn('Bots on the page’s thread: the worker could not be reached.', error);
      }
    }

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
    // A tick taken but not yet stepped has left the accumulator already: the board is still
    // on the tick before, at its end. Read from the accumulator, a frame drawn while the
    // worker had the turn — every other frame at 60 fps — put shots and banners back almost
    // a tick, and combat juddered (ARCHIVE 13k).
    if (this.inTick) return 1;
    return Math.min(1, this.accumulator / this.tickMs);
  }

  get finished(): boolean {
    return this.state.phase === 'game_over';
  }

  /** Whether the bots think in a worker, for tests and the readout. */
  get inWorker(): boolean {
    return this.driver instanceof WorkerDriver;
  }

  /**
   * Applies a human action; returns null when accepted. While the worker has the tick's turn
   * the move waits for the next tick, the worker having been sent this one's: accepted for
   * now, and silently dropped should the rules refuse it then, as a session drops refusals.
   */
  submit(action: Action): Rejection | null {
    if (this.inTick && !this.driver.idle) {
      this.queued.push(action);
      return null;
    }
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
    this.driver.frame();
    this.pump();
    return this.takeEvents();
  }

  /** No more turns: the worker forgets the match. At its end, on leaving, on cleanup. */
  dispose(): void {
    this.driver.dispose();
  }

  /**
   * Takes ticks while there is time for them and the bots are free: on the thread, as many
   * as this frame's budget allows; to a worker, one turn out at a time, the next sent from
   * its answer.
   */
  private pump(): void {
    const deadline = performance.now() + this.thinkBudgetMs;
    let progressed = false;
    while (
      !this.finished &&
      this.driver.idle &&
      (this.inTick || (!this.halted && this.accumulator >= this.tickMs))
    ) {
      if (!this.inTick) {
        this.accumulator -= this.tickMs;
        this.inTick = true;
      }
      if (!this.driver.turns(this.applied, deadline, progressed)) break;
      progressed = true;
      this.stepOnce();
    }
  }

  /** The worker's answer for the tick out: its bots' actions applied, then the step. */
  private answered(actions: readonly Action[], hash: string | undefined): void {
    this.timed(() => {
      for (const action of actions) {
        const rejection = applyAction(this.state, action);
        if (rejection !== null) {
          this.fallBack(
            `the page refused a bot's ${action.kind} on tick ${this.state.tick}: ${rejection}`,
          );
          return;
        }
        this.applied.push(action);
      }
      const tick = this.state.tick;
      const mine = this.stepOnce(hash !== undefined);
      if (hash !== undefined && mine !== hash) {
        this.fallBack(`the worker's match is not the page's after tick ${tick}`);
      }
      this.pump();
    });
  }

  /**
   * The worker failed, or never came: the bots go on on the page's thread. From tick 0
   * nothing is lost; mid-match they are new bots, their memory of the match gone, and may
   * play a little differently from here — the recording, being what the page applied, stays
   * exact.
   */
  private fallBack(reason: string): void {
    console.warn(`Bots on the page’s thread from tick ${this.state.tick}: ${reason}`);
    this.driver.dispose();
    // The seconds spent waiting for a worker that never answered are not played through in
    // a rush: the clock goes on from where it stopped.
    this.accumulator = Math.min(this.accumulator, this.tickMs);
    const tick = this.state.tick;
    this.driver = this.threadDriver(
      tick === 0
        ? botRngSeed(this.seed)
        : (botRngSeed(this.seed) ^ Math.imul(tick, 0x9e3779b1)) >>> 0,
    );
  }

  private threadDriver(rngSeed: number): ThreadDriver {
    return new ThreadDriver(this.state, this.setups, this.humanPlayer, rngSeed, (action) =>
      this.applied.push(action),
    );
  }

  /**
   * Runs the match forward with every seat, including the player's, driven by the
   * scripted driver. Dev only: it exists so a given phase can be put on screen
   * deterministically, without waiting out the clock or playing to get there.
   */
  fastForwardTo(phase: Phase, fromRound = 0, humanIdle = false, maxTicks = 40_000): void {
    const driver = this.driver;
    if (!(driver instanceof ThreadDriver)) {
      throw new Error('a fast-forward needs the bots on the page’s thread');
    }
    // A dev shortcut, not a match anyone played: nothing of it is worth keeping.
    this.recorder = null;
    const arrived = (): boolean => this.state.phase === phase && this.state.round >= fromRound;
    while (!arrived() && this.state.tick < maxTicks && !this.finished) {
      // Left to itself, the person's seat builds nothing and is soon knocked out, which
      // is the quickest way to put a mid-match elimination on screen.
      botTurns(
        this.state,
        driver.rng,
        (player) => driver.botFor(player),
        humanIdle ? this.humanPlayer : -1,
      );
      step(this.state);
      drainEvents(this.state);
    }
  }

  /**
   * The tick, once every bot has had its turn on it; the hash the recording took, or —
   * `hashWanted` — one taken for the worker's to be checked against.
   */
  private stepOnce(hashWanted = false): string | undefined {
    const tick = this.state.tick;
    step(this.state);
    this.events.push(...drainEvents(this.state));
    const recorded = this.recorder?.stepped(tick, this.applied, this.state);
    const hash = recorded ?? (hashWanted ? hashMatchState(this.state) : undefined);
    this.applied = [];
    this.inTick = false;
    // Made while the worker had this tick, they belong to the next.
    const queued = this.queued;
    this.queued = [];
    for (const action of queued) {
      if (applyAction(this.state, action) === null) this.applied.push(action);
    }
    if (this.finished) this.driver.dispose();
    return hash;
  }

  private takeEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
