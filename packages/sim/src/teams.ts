import type { TeamLayout, TerrainConfig } from '@bollwerk/config';

import { streamFor } from './rng.js';
import { patternFor } from './terrain.js';
import type { MatchState } from './types.js';

/**
 * Team relations, kept apart from the match so the shot and placement rules can ask them
 * without importing the match that imports them.
 */

/** Whether two players are on the same team — a player is on their own, too. */
export function sameTeam(state: MatchState, a: number, b: number): boolean {
  const pa = state.players[a];
  const pb = state.players[b];
  return pa !== undefined && pb !== undefined && pa.team === pb.team;
}

/** A team's score: the sum of its members' own. */
export function teamScore(state: MatchState, team: number): number {
  let total = 0;
  for (const p of state.players) if (p.team === team) total += p.score;
  return total;
}

/**
 * A table's team size: the size its teams share, or 1 for free-for-all — or for teams of
 * different sizes, which have no pattern or fair seating of their own.
 */
export function tableTeamSize(labels: readonly (number | undefined)[]): number {
  if (labels.some((label) => label === undefined)) return 1;
  const sizes = new Map<number, number>();
  for (const label of labels) sizes.set(label as number, (sizes.get(label as number) ?? 0) + 1);
  const values = [...sizes.values()];
  const size = values[0] ?? 1;
  return values.length > 1 && values.every((v) => v === size) ? size : 1;
}

/**
 * Which player — and so which island — each seat becomes, as `order[seat]`, from each
 * seat's team label.
 *
 * The host chooses who plays with whom, but not where: which island each seat gets is
 * dealt at the start, so no seat is always the one with the awkward neighbours. Where the
 * table's pattern has fair team layouts (`teamLayouts`) — three or four teams of two — one
 * is drawn by weight, the teams dealt onto its groups of islands and each team's members
 * onto its own; otherwise every seat is shuffled onto any island. Seeded from the match
 * seed, so the server and a local match agree, and a match can be reproduced. Players keep
 * the invariant that player p owns island p + 1; it is the seats that move.
 */
export function seatOrder(
  seed: number,
  teamsBySeat: readonly (number | undefined)[],
  config: TerrainConfig,
): number[] {
  const count = teamsBySeat.length;
  const rng = streamFor(seed, 'seats');
  const teamSize = tableTeamSize(teamsBySeat);
  const layouts = patternFor(config, count, teamSize).teamLayouts;
  if (layouts !== undefined) {
    const layout = layouts[rng.nextWeightedIndex(layouts.map((l) => l.weight))] as TeamLayout;
    const groups = rng.shuffle(layout.teams.map((islands) => [...islands]));
    const order = new Array<number>(count);
    [...new Set(teamsBySeat)].forEach((label, team) => {
      const islands = rng.shuffle([...(groups[team] as number[])]);
      teamsBySeat.forEach((l, seat) => {
        if (l === label) order[seat] = islands.shift() as number;
      });
    });
    return order;
  }
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

/**
 * Team labels, one per player, to dense team ids — in ascending order of label, so the
 * table's Team A (label 0) is team 0 whichever players the shuffle dealt its seats to.
 *
 * It was order of first appearance among the players, which after the seat shuffle made
 * the host's Team A come out as team 1 whenever a Team B seat happened to become player
 * 0, and the letter on screen changed between the lobby and the match. A player with no
 * label is a team of their own, numbered after every labelled team in player order —
 * which, with no labels at all, is simply team = player.
 */
export function denseTeams(labels: readonly (number | undefined)[]): number[] {
  const order = labels.map((label, id) => ({ label, id }));
  const distinct = [...new Set(labels.filter((l): l is number => l !== undefined))].sort(
    (a, b) => a - b,
  );
  const idOf = new Map(distinct.map((label, i) => [label, i]));
  let next = distinct.length;
  return order.map(({ label }) => (label === undefined ? next++ : (idOf.get(label) as number)));
}
