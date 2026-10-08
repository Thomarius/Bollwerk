import type { TournamentConfig } from '@bollwerk/config';
import type { Rng } from '@bollwerk/sim';

import type { Team } from './save.js';

/**
 * A match decided without being played (TOURNAMENT §1.6): each team's strength is the sum
 * of its members' level ratings, and the places are drawn Plackett–Luce — first place in
 * proportion to strength among all, second among the rest, and so on. Personalities play
 * no part. Rolls cannot tie.
 */

/** A team's strength in a roll. A member with no level — the host — counts `hostLevel`'s. */
export function strength(team: Team, config: TournamentConfig, hostLevel?: number): number {
  let total = 0;
  for (const member of team.members) {
    const level = member.level ?? hostLevel;
    if (level === undefined)
      throw new Error(`${team.name} has a person in it and cannot be rolled`);
    total += config.levelRatings[level - 1] as number;
  }
  return total;
}

/** The teams, best placed first, drawn in proportion to their strengths. */
export function rollOrder(
  teams: readonly number[],
  strengths: readonly number[],
  rng: Rng,
): number[] {
  const left = [...teams];
  const weights = [...strengths];
  const order: number[] = [];
  while (left.length > 0) {
    const i = rng.nextWeightedIndex(weights);
    order.push(left.splice(i, 1)[0] as number);
    weights.splice(i, 1);
  }
  return order;
}
