import { dealSeats } from '@bollwerk/ai';
import type { BotSetup, Personality } from '@bollwerk/config';
import type { MatchEvent, MatchState } from '@bollwerk/sim';

import { t } from './i18n.js';

/**
 * What the end of a match shows beside the final standings: for each player the wall
 * they destroyed and the most castles they held at once, and every
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
  /** Every player's banked score, and castles sealed, after each resolution seen. */
  readonly scores: { round: number; byPlayer: number[]; castles: number[] }[] = [];
  /** Who fired each shot in flight, since an impact names only the shot. */
  private readonly shooters = new Map<number, number>();
  /**
   * For the awards (PLAN 11.18 Y5): the wall each player's shots broke on each opponent's
   * island, by shooter then owner — a wall is its island's, whoever built it; pieces each
   * player laid; lives each spent; and every player's guns and territory points at each
   * resolution seen, beside its scores.
   */
  readonly brokeOf = new Map<number, Map<number, number>>();
  readonly pieces = new Map<number, number>();
  readonly livesSpent = new Map<number, number>();
  readonly guns: number[][] = [];
  readonly territoryPoints: number[][] = [];

  /** `state` is the match as it stands once these events have happened. */
  note(
    events: readonly MatchEvent[],
    state: Pick<MatchState, 'players'> & Partial<Pick<MatchState, 'cannons' | 'islandId'>>,
  ): void {
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
          const victims = this.brokeOf.get(shooter) ?? new Map<number, number>();
          for (const tile of event.destroyed) {
            const owner = (state.islandId?.[tile] ?? 0) - 1;
            if (owner >= 0) victims.set(owner, (victims.get(owner) ?? 0) + 1);
          }
          this.brokeOf.set(shooter, victims);
          break;
        }
        case 'piece_placed':
          this.pieces.set(event.player, (this.pieces.get(event.player) ?? 0) + 1);
          break;
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
          const territory = state.players.map(() => 0);
          for (const result of event.results) territory[result.player] = result.territoryPoints;
          this.territoryPoints.push(territory);
          this.guns.push(
            state.players.map((p) => (state.cannons ?? []).filter((c) => c.owner === p.id).length),
          );
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

/**
 * Each bot's level and personality, by player, from the table as the host set it: the
 * seats in lobby order, a level for each bot and null for a person. Seats are shuffled onto
 * players by the seed and personalities dealt from it for the table (PLAN 11.6), exactly as a
 * room and a local match do, so a client needs nothing more from the server to know them.
 */
export function botSetupsFromSeats(
  seed: number,
  seats: readonly (number | null)[],
  /** Personalities the table gave its bots, by seat — a tournament's — rather than dealt. */
  personalities: readonly (Personality | null)[] = [],
): Map<number, BotSetup> {
  const { setups } = dealSeats(
    seed,
    seats.map((level, index) => ({
      level,
      bot: level !== null,
      personality: personalities[index] ?? null,
    })),
  );
  const byPlayer = new Map<number, BotSetup>();
  setups.forEach((setup, player) => {
    if (setup !== null) byPlayer.set(player, setup);
  });
  return byPlayer;
}

/** One bot revealed at the end: who, and how it played. */
export interface Reveal {
  player: number;
  name: string;
  /** "Level 6 · offensive · finisher · max cannons". */
  text: string;
}

/**
 * The surprise at the end of a match (PLAN 11.6): every bot's level and the personality it
 * was dealt, in plain words, in player order. A person is left out; so is a seat whose
 * setup this client does not know.
 */
export function revealLines(
  state: Pick<MatchState, 'players'>,
  setups: ReadonlyMap<number, BotSetup>,
): Reveal[] {
  return state.players.flatMap((p) => {
    const setup = setups.get(p.id);
    if (!p.isBot || setup === undefined) return [];
    return [
      {
        player: p.id,
        name: p.name,
        text: t('summary.reveal', {
          level: setup.level,
          risk: t(`trait.risk.${setup.personality.risk}` as const),
          targeting: t(`trait.targeting.${setup.personality.targeting}` as const),
          cannons: t(`trait.cannons.${setup.personality.cannons}` as const),
        }),
      },
    ];
  });
}
