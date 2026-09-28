import type { MatchEvent, MatchState } from '@rampart/sim';

/**
 * What the end of a match shows beside the final standings: for each player the wall
 * they destroyed, the most castles they held at once and the lives they spent, and every
 * score round by round, so the summary shows where the match was won.
 *
 * Kept from the events the client already receives, as they arrive, so it needs nothing
 * from the server. A client that joined part-way — a reconnect — saw only the rounds
 * since, and its chart starts there; the standings themselves come from the state and
 * are always whole.
 *
 * Separated from the drawing so it can be tested without a browser, as `scores.ts` is.
 */
export class MatchLog {
  /** Wall blocks each player's shots destroyed. */
  readonly destroyed = new Map<number, number>();
  /** Lives each player spent failing to seal. */
  readonly livesSpent = new Map<number, number>();
  /** Every player's banked score, and castles sealed, after each resolution seen. */
  readonly scores: { round: number; byPlayer: number[]; castles: number[] }[] = [];
  /** Who fired each shot in flight, since an impact names only the shot. */
  private readonly shooters = new Map<number, number>();

  /** `state` is the match as it stands once these events have happened. */
  note(events: readonly MatchEvent[], state: Pick<MatchState, 'players'>): void {
    for (const event of events) {
      switch (event.kind) {
        case 'shot_fired':
          this.shooters.set(event.shot.id, event.shot.owner);
          break;
        case 'shot_impact': {
          const shooter = this.shooters.get(event.shotId);
          this.shooters.delete(event.shotId);
          if (shooter === undefined || event.destroyed.length === 0) break;
          this.destroyed.set(shooter, (this.destroyed.get(shooter) ?? 0) + event.destroyed.length);
          break;
        }
        case 'player_continued':
          this.livesSpent.set(event.player, (this.livesSpent.get(event.player) ?? 0) + 1);
          break;
        case 'round_resolved': {
          // The scores as banked by this resolution, which the state already carries.
          const castles = state.players.map(() => 0);
          for (const result of event.results) castles[result.player] = result.enclosedCastles;
          this.scores.push({
            round: event.round,
            byPlayer: state.players.map((p) => p.score),
            castles,
          });
          break;
        }
        default:
          break;
      }
    }
  }
}

/**
 * The most castles a group of players — one, or a team — held sealed at once, at any
 * resolution seen: a team's best round, not the sum of its members' separate bests.
 */
export function mostCastlesOf(log: MatchLog, players: readonly number[]): number {
  let best = 0;
  for (const round of log.scores) {
    best = Math.max(
      best,
      players.reduce((sum, p) => sum + (round.castles[p] ?? 0), 0),
    );
  }
  return best;
}

/** A line of the chart: the points it passes through, in the chart's own pixels. */
export interface ChartLine {
  key: number;
  points: { x: number; y: number }[];
}

/**
 * Score by round as lines across a `width` by `height` chart: rounds along, points up,
 * every line from nought before the first round seen. One line per series — a player in
 * free-for-all, a team in a team match — keyed as given.
 */
export function scoreChart(
  series: readonly { key: number; scores: readonly number[] }[],
  rounds: number,
  width: number,
  height: number,
): ChartLine[] {
  const top = Math.max(1, ...series.flatMap((s) => s.scores));
  const step = rounds > 0 ? width / rounds : width;
  return series.map((s) => ({
    key: s.key,
    points: [0, ...s.scores].map((score, i) => ({
      x: Number((i * step).toFixed(1)),
      y: Number((height - (score / top) * height).toFixed(1)),
    })),
  }));
}
