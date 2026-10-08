import { teamScore, type MatchState, type Rng } from '@bollwerk/sim';

/** One team's place in a finished match, by the match's own team number. */
export interface Placing {
  team: number;
  score: number;
}

/**
 * A finished match's teams, best placed first (TOURNAMENT §1.6): teams still in by score,
 * then teams knocked out by how late they went out, the later first. A tie — a shared win
 * at the cap, a simultaneous knockout — goes to the higher score, then to the later
 * knockout, then to `coin`, the tournament's stream for this match.
 */
export function placings(state: MatchState, coin: Rng): Placing[] {
  const teams = [...new Set(state.players.map((p) => p.team))].sort((a, b) => a - b);
  const rows = teams.map((team) => {
    const members = state.players.filter((p) => p.team === team);
    const alive = members.some((p) => !p.eliminated);
    const outRound = Math.max(...members.map((p) => p.eliminatedRound ?? -1));
    // Drawn for every team in team order, so the coin is the same whoever ties.
    return { team, score: teamScore(state, team), alive, outRound, coin: coin.nextU32() };
  });
  rows.sort(
    (a, b) =>
      Number(b.alive) - Number(a.alive) ||
      (a.alive ? 0 : b.outRound - a.outRound) ||
      b.score - a.score ||
      b.outRound - a.outRound ||
      a.coin - b.coin,
  );
  return rows.map(({ team, score }) => ({ team, score }));
}
