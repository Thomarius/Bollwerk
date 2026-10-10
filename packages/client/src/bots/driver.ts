import { defaultAiConfig, BALANCED, type BotSetup } from '@bollwerk/config';
import { Bot, PlanningSlots } from '@bollwerk/ai';
import { Rng, type Action, type MatchState } from '@bollwerk/sim';

import { botTurns } from './botTurns.js';

/**
 * Whatever plays a local match's bots, for `LocalMatch`: on the page's own thread
 * (`ThreadDriver`) or in a worker (`WorkerDriver`). Either way the page holds the match and
 * steps it; a driver only takes the bots' turns on the tick in progress.
 */
export interface BotDriver {
  /**
   * Whether a tick's turns may be asked for now: not before a worker is ready, nor while
   * one has a turn out. A thread is always idle, even with a tick's turns half taken.
   */
  readonly idle: boolean;
  /**
   * The bots' turns on the tick in progress, `before` — the person's moves on it — applied
   * already. True once every turn is taken and its accepted actions handed to `accept`;
   * false while some wait — for the next frame's time on the thread, called again then, or
   * for the worker's answer, which comes to the host on its own.
   */
  turns(before: readonly Action[], deadline: number, progressed: boolean): boolean;
  /** Each frame, before any turn: where a worker notices one that has gone quiet. */
  frame(): void;
  /** No more turns: the match is over or left. */
  dispose(): void;
}

/** The bots' seed for a match, as every local match has had it. */
export function botRngSeed(seed: number): number {
  return seed ^ 0x5f3759df;
}

/**
 * The bots on the page's own thread: a tick's turns spread over frames, `thinkBudgetMs` of
 * each. A bot planning its walls takes 15 to 50 ms, and bots of one level plan on the same
 * ticks: eight froze the page for up to 135 ms (PLAN 11.22). Since then they share a few
 * plans a tick (`PlanningSlots`), and a tick's thinking may run over several frames, the
 * screen drawn between; the actions and the tick they land on are the same.
 */
export class ThreadDriver implements BotDriver {
  readonly idle = true;
  readonly rng: Rng;
  private readonly bots = new Map<number, Bot>();
  /** The plans the bots may make on one tick between them, shared by all of them. */
  private readonly slots = new PlanningSlots(defaultAiConfig.plansPerTick);
  /** The next turn to take on the tick in progress, or null between ticks. */
  private next: number | null = null;

  constructor(
    private readonly state: MatchState,
    setups: ReadonlyMap<number, BotSetup>,
    private readonly humanPlayer: number,
    rngSeed: number,
    private readonly accept: (action: Action) => void,
  ) {
    for (const [player, setup] of setups) {
      this.bots.set(player, new Bot(player, setup, defaultAiConfig, this.slots));
    }
    this.rng = new Rng(rngSeed);
  }

  /** From where the last frame stopped; always at least one turn, so a match never stalls. */
  turns(_before: readonly Action[], deadline: number, progressed: boolean): boolean {
    const taken = botTurns(
      this.state,
      this.rng,
      (player) => this.bots.get(player),
      this.humanPlayer,
      this.next ?? 0,
      (count) => (progressed || count > 0) && performance.now() > deadline,
    );
    for (const action of taken.actions) this.accept(action);
    this.next = taken.next;
    return taken.next === null;
  }

  frame(): void {}

  dispose(): void {}

  /** Fast-forwarding drives every seat, including the person's. */
  botFor(player: number): Bot {
    let bot = this.bots.get(player);
    if (!bot) {
      bot = new Bot(player, { level: 5, personality: BALANCED }, defaultAiConfig, this.slots);
      this.bots.set(player, bot);
    }
    return bot;
  }
}
