import type { Personality } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';

import { placings } from './placement.js';
import type { Placed } from './progress.js';
import type { Save, Team } from './save.js';

/**
 * A tournament's match as a table to play it at (TOURNAMENT T3): its teams' members in
 * seat order, every bot with the level, name and personality it has all tournament, and
 * the host's seat a person's. The match's teams are labelled by their place in the match,
 * so the simulation's team _i_ is `teams[i]` — which is how a result is read back.
 */

/** One seat of a tournament's table. */
export interface TableSeat {
  name: string;
  /** Null for the host, the person; otherwise the bot's level. */
  level: number | null;
  personality: Personality | null;
  /** The seat's team, as its place in the match. */
  team: number;
}

export interface MatchTable {
  seats: TableSeat[];
  /** The tournament's team behind each of the match's teams. */
  teams: number[];
}

export function matchTable(save: Save, teams: readonly number[]): MatchTable {
  const seats = teams.flatMap((id, team) =>
    (save.teams[id] as Team).members.map((member) => ({
      name: member.name,
      level: member.level,
      personality: member.personality,
      team,
    })),
  );
  return { seats, teams: [...teams] };
}

/**
 * A finished match's places, by tournament team, for `recordMatch`. `coin` is the match's
 * own (`coinFor`), deciding a tie no score or knockout does.
 */
export function placedFrom(
  state: MatchState,
  table: MatchTable,
  coin: Parameters<typeof placings>[1],
): Placed[] {
  return placings(state, coin).map(({ team, score }) => {
    const id = table.teams[team];
    if (id === undefined) throw new Error(`the match has a team ${team} its table never had`);
    return { team: id, score };
  });
}
