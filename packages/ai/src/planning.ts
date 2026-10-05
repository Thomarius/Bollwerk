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

  constructor(readonly perTick: number = Number.POSITIVE_INFINITY) {}

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
