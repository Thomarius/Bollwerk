import { teamScore, type MatchState, type PlayerState } from '@bollwerk/sim';

/**
 * What the HUD says about points: the round against the cap, the standings, and who
 * won. Plain text, so the caller decides how it is escaped.
 *
 * Separated from the drawing so it can be tested without a browser, as `banners.ts`
 * is — the standings are shown by an announcement that only runs on the clock, which
 * headless Chrome cannot drive.
 */

export interface Standing {
  player: number;
  name: string;
  score: number;
  eliminated: boolean;
}

/**
 * Everyone, best placed first. Those still in come before those who are out whatever
 * their points, because being out loses to any score. Ties break on seat, so the
 * order never flickers between frames.
 */
export function standings(state: MatchState): Standing[] {
  return (state.players as readonly PlayerState[])
    .map((p) => ({ player: p.id, name: p.name, score: p.score, eliminated: p.eliminated }))
    .sort(
      (a, b) =>
        Number(a.eliminated) - Number(b.eliminated) || b.score - a.score || a.player - b.player,
    );
}

/** A team's name as players see it: A, B, C, D. */
export function teamLetter(team: number): string {
  return String.fromCharCode(65 + team);
}

/** Whether this is a team match rather than free-for-all's teams of one. */
export function isTeamMatch(state: MatchState): boolean {
  const sizes = new Map<number, number>();
  for (const p of state.players) sizes.set(p.team, (sizes.get(p.team) ?? 0) + 1);
  return [...sizes.values()].some((size) => size > 1);
}

export interface TeamStanding {
  team: number;
  /** Member player ids, in player order. */
  members: number[];
  score: number;
  eliminated: boolean;
}

/**
 * Every team, best placed first, by the sum of its members' scores — the score a team
 * match is decided on. As with players, a team still in comes before one that is out.
 */
export function teamStandings(state: MatchState): TeamStanding[] {
  const teams = [...new Set(state.players.map((p) => p.team))];
  return teams
    .map((team) => {
      const members = state.players.filter((p) => p.team === team);
      return {
        team,
        members: members.map((p) => p.id),
        score: teamScore(state, team),
        eliminated: members.every((p) => p.eliminated),
      };
    })
    .sort(
      (a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score || a.team - b.team,
    );
}

export function roundLabel(state: MatchState): string {
  const cap = state.ruleset.scoring.maxRounds;
  if (cap === null) return `round ${state.round}`;
  return inFinalRound(state)
    ? `final round ${state.round} / ${cap}`
    : `round ${state.round} / ${cap}`;
}

/**
 * Whether the last round is being played: from its combat to the resolution that ends
 * the match. The round counter moves as combat begins, so its intermission is not yet it.
 */
export function inFinalRound(state: MatchState): boolean {
  const cap = state.ruleset.scoring.maxRounds;
  return cap !== null && state.round === cap && state.phase !== 'game_over';
}

/**
 * The headline of an announcement, where it is not simply the phase's own call: the
 * last round gets a banner of its own, with "Fire!" riding under it.
 */
export function announcementTitle(state: MatchState): string | null {
  return finalRoundNext(state) ? 'Final round' : null;
}

/**
 * Whether the combat phase about to begin opens the last round. Asked during the
 * intermission before it, while `round` still holds the one just finished.
 */
export function finalRoundNext(state: MatchState): boolean {
  const cap = state.ruleset.scoring.maxRounds;
  return (
    cap !== null &&
    state.phase === 'intermission' &&
    state.pendingPhase === 'combat' &&
    state.round + 1 === cap
  );
}

/**
 * One entry of the ranking a banner carries after a resolution (PLAN 11.16 I1): a player,
 * or a team in a team match, where it stands now, where it stood after the round before,
 * and the score it counts up from.
 */
export interface RankEntry {
  key: string;
  /** A name, or "Team A". */
  label: string;
  /** The player whose colour and shape it is shown in: a team's first member. */
  lead: number;
  score: number;
  /** The score after the round before; nought for the first. */
  from: number;
  /** One for the leader. */
  rank: number;
  /** Places climbed since the round before: negative for places lost, nought for none. */
  moved: number;
  out: boolean;
}

/**
 * The standings as the banner after a resolution shows them, given every player's score
 * after the round before (`before`, by player; null before the first). Ranked as the
 * standings are — those still in ahead of those out, then by score, then by seat — and
 * the places before ranked the same way, so a move is a real change of places, not a tie
 * breaking differently.
 */
export function ranking(state: MatchState, before: readonly number[] | null): RankEntry[] {
  const was = (id: number): number => before?.[id] ?? 0;
  const entries = isTeamMatch(state)
    ? teamStandings(state).map((t) => ({
        key: `t${t.team}`,
        label: `Team ${teamLetter(t.team)}`,
        lead: t.members[0] ?? 0,
        score: t.score,
        from: t.members.reduce((sum, id) => sum + was(id), 0),
        out: t.eliminated,
        order: t.team,
      }))
    : standings(state).map((p) => ({
        key: `p${p.player}`,
        label: p.name,
        lead: p.player,
        score: p.score,
        from: was(p.player),
        out: p.eliminated,
        order: p.player,
      }));
  const placeBefore = new Map(
    [...entries]
      .sort((a, b) => Number(a.out) - Number(b.out) || b.from - a.from || a.order - b.order)
      .map((e, k) => [e.key, k + 1]),
  );
  return entries.map(({ order: _order, ...e }, k) => ({
    ...e,
    rank: k + 1,
    moved: before === null ? 0 : (placeBefore.get(e.key) ?? k + 1) - (k + 1),
  }));
}

export interface AnnouncementLine {
  text: string;
  /** Set in the accent colour: news, rather than the standings' plain record. */
  emphasis: boolean;
}

/**
 * The lines carried under a phase announcement. The standings that follow a resolution
 * are a ranking of their own (`ranking`), drawn by the HUD; a line of text before.
 */
export function announcementLines(state: MatchState): AnnouncementLine[] {
  // The final round's banner is headed "Final round", so the call it replaced rides under.
  return finalRoundNext(state) ? [{ text: 'Fire!', emphasis: true }] : [];
}

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The headline once a match is over, from the point of view of `humanPlayer`. */
export function endOfMatchText(state: MatchState, humanPlayer: number): string {
  if (state.draw) return 'Draw — nobody held a castle';
  const { winners } = state;
  if (winners.length === 0) return 'Nobody wins';

  const onPoints = state.endedBy === 'round_cap' ? ' on points' : '';
  if (isTeamMatch(state)) {
    // A team wins or loses whole, so the headline names teams, not their members.
    const teams = [...new Set(winners.map((id) => state.players[id]?.team ?? 0))];
    const yours = state.players[humanPlayer]?.team;
    if (teams.length === 1) {
      return teams[0] === yours
        ? `Your team wins${onPoints}`
        : `Team ${teamLetter(teams[0] as number)} wins${onPoints}`;
    }
    const letters = names(teams.map(teamLetter));
    return yours !== undefined && teams.includes(yours)
      ? `Your team shares the win${onPoints}`
      : `Teams ${letters} share the win${onPoints}`;
  }
  if (winners.length === 1) {
    const winner = winners[0] as number;
    return winner === humanPlayer
      ? `You win${onPoints}`
      : `${state.players[winner]?.name ?? 'Nobody'} wins${onPoints}`;
  }
  // A shared win is a win for each of them, not a draw.
  if (winners.includes(humanPlayer)) return `You share the win${onPoints}`;
  return `${names(winners.map((id) => state.players[id]?.name ?? '?'))} share the win${onPoints}`;
}

/**
 * A score on its way from `from` to `to`, `elapsedMs` into a count lasting `spanMs`:
 * quick at first and settling as it arrives, in whole points, as the island banners
 * count the points they bank.
 */
export function countUp(from: number, to: number, elapsedMs: number, spanMs: number): number {
  if (elapsedMs >= spanMs || spanMs <= 0) return to;
  const t = Math.max(0, elapsedMs / spanMs);
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(from + (to - from) * eased);
}
