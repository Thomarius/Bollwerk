import { type AiConfig } from '@bollwerk/config';

/**
 * The plans a table's bots may make on one tick, shared between them.
 *
 * A plan — a wall's minimum cuts, or a castle's choice — costs a bot about 5 ms, and a
 * room cannot send a tick before every bot has thought on it. Every player is dealt the
 * same pieces, so bots of one level take the same time over each and fall due to replan
 * on the same ticks, all phase long: eight Level 8 bots planned together every 40–49
 * ticks, 40 to 90 ms where a tick is 33 (2026-10-05). With a limit, a bot finding no plan
 * left waits a tick, and the bots fall out of step for the rest of the phase, since they
 * keep the same pace from different starts.
 *
 * Counted in plans, never in time, so a match plays the same on any machine.
 */
export class PlanningSlots {
  private tick = -1;
  private used = 0;
  private stepsTick = -1;
  private stepsUsed = 0;

  constructor(
    readonly perTick: number = Number.POSITIVE_INFINITY,
    /**
     * The simulated pieces the table's bots may play out a tick between them, searching for
     * their build phases' plans (BUILD_PLANNING.md): a search's cost spread over the ticks
     * before the phase, bounded on each, so the game never waits for it.
     */
    readonly stepsPerTick: number = Number.POSITIVE_INFINITY,
  ) {}

  private startTick = -1;

  /**
   * Whether a bot may begin its build search on this tick: one a tick at a table, since
   * weighing the walls a search starts from costs what a dozen simulated pieces do, and
   * eight bots beginning on one tick took 130-180 ms (Level 8, 2026-10-12).
   */
  takeStart(tick: number): boolean {
    if (this.stepsPerTick === Number.POSITIVE_INFINITY) return true;
    if (tick === this.startTick) return false;
    this.startTick = tick;
    return true;
  }

  /** Up to `wanted` simulated pieces on this tick, as many as are left. */
  takeSteps(tick: number, wanted: number): number {
    if (tick !== this.stepsTick) {
      this.stepsTick = tick;
      this.stepsUsed = 0;
    }
    const granted = Math.max(0, Math.min(wanted, this.stepsPerTick - this.stepsUsed));
    this.stepsUsed += granted;
    return granted;
  }

  /** Takes a plan on this tick, or says there is none left. */
  take(tick: number): boolean {
    if (tick !== this.tick) {
      this.tick = tick;
      this.used = 0;
    }
    if (this.used >= this.perTick) return false;
    this.used++;
    return true;
  }
}

/**
 * The slots a table's bots share, as the rules for bots set them: every driver of bots — a
 * room, a local match's worker or thread, the harness — makes its table's with this.
 */
export function tableSlots(ai: AiConfig): PlanningSlots {
  return new PlanningSlots(ai.plansPerTick, ai.planning.stepsPerTick);
}

/**
 * The order bots take their turns in on a tick: the players rotated by the round, so the
 * ones who wait for a plan as a phase opens, when every bot plans, are not the same ones
 * every round.
 */
export function turnOrder<T>(players: readonly T[], round: number): T[] {
  const n = players.length;
  if (n === 0) return [];
  const start = ((round % n) + n) % n;
  return [...players.slice(start), ...players.slice(0, start)];
}
