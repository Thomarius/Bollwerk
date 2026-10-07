import { takeBotTurns, type Bot } from '@bollwerk/ai';
import {
  HASH_EVERY_TICKS,
  captureSnapshot,
  type MatchRecorder,
  type ServerMessage,
} from '@bollwerk/protocol';
import {
  applyAction,
  drainEvents,
  hashMatchState,
  step,
  type Action,
  type MatchState,
  type Rng,
} from '@bollwerk/sim';

import type { Seat } from './room.js';

/**
 * A room's match once it has started: the state, the bots, the clock that steps it, the
 * moves waiting for the next tick, the pause and the recording. The room keeps the seats
 * and the table, and hands this the seats it plays with — the same objects, so a person
 * dropping or coming back is seen here at once.
 */
export class MatchRunner {
  private accumulatorMs = 0;
  private pending: { seat: Seat; action: Action }[] = [];
  /**
   * The player who paused the match, or null while it runs. Every timer in the match is
   * counted in ticks, so a paused room simply steps none — bots, phase clocks and a bot's
   * takeover of a dropped seat all wait — and adds nothing to the recording.
   */
  private by: number | null = null;

  constructor(
    readonly state: MatchState,
    /** One per seat: a bot keeps a plan between ticks, and covers a person who drops. */
    private readonly bots: ReadonlyMap<number, Bot>,
    private readonly recorder: MatchRecorder | null,
    /** The room's own stream, which its bots draw from as they always have. */
    private readonly rng: Rng,
    private readonly seats: readonly Seat[],
    private readonly broadcast: (message: ServerMessage) => void,
  ) {}

  get finished(): boolean {
    return this.state.phase === 'game_over';
  }

  get pausedBy(): number | null {
    return this.by;
  }

  /** Pauses for this player, or resumes with null; false when it already stood so. */
  setPaused(by: number | null): boolean {
    if ((by === null) === (this.by === null)) return false;
    this.by = by;
    // Resuming starts the clock afresh rather than paying out the pause as a burst.
    this.accumulatorMs = 0;
    return true;
  }

  /** A person's move, for the next tick. */
  queue(seat: Seat, action: Action): void {
    this.pending.push({ seat, action });
  }

  /** The whole match as it stands, for a connection joining or coming back. */
  sendSnapshot(seat: Seat): void {
    seat.connection?.send({ type: 'snapshot', snapshot: captureSnapshot(this.state) });
  }

  /** Advances the match by elapsed real time. */
  update(elapsedMs: number): void {
    if (this.finished || this.by !== null) return;
    const tickMs = 1000 / this.state.ruleset.tickRateHz;
    this.accumulatorMs += Math.min(elapsedMs, 1000);
    while (this.accumulatorMs >= tickMs) {
      this.accumulatorMs -= tickMs;
      this.tick();
      if (this.finished) break;
    }
  }

  private tick(): void {
    const state = this.state;
    const applied: Action[] = [];

    for (const seat of this.seats) {
      if (seat.connection !== null || seat.bot) continue;
      // A dropped player is played by a bot once the grace period lapses, so the
      // rest of the table is not held hostage by one dead connection.
      if (seat.graceTicks > 0) seat.graceTicks--;
    }

    // A seat's bot plays it when the seat is a bot's, or its person dropped and the grace
    // has run out; in `turnOrder`, so the same bots do not always wait for a plan.
    const seatOf = new Map(this.seats.map((seat) => [seat.playerId, seat]));
    for (const { action, rejection } of takeBotTurns(state, this.rng, (player) => {
      const seat = seatOf.get(player);
      const playsItself =
        seat !== undefined && (seat.bot || (seat.connection === null && seat.graceTicks === 0));
      return playsItself ? this.bots.get(player) : null;
    })) {
      if (rejection === null) applied.push(action);
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
    // The recorder fingerprints the state on the ticks the commit carries one.
    const recorded = this.recorder?.stepped(tick, applied, state);

    const commit: ServerMessage = { type: 'commit', tick, actions: applied };
    if (tick % HASH_EVERY_TICKS === 0) commit.hash = recorded ?? hashMatchState(state);
    this.broadcast(commit);
  }
}
