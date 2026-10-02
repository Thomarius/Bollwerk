import type { MatchOutcome, StatRow } from '@bollwerk/analysis';

/**
 * A soak's summary (docs/SOAKS.md): the measures of PLAN 11.2–11.4 and 11.13, from the
 * per-round tables and the per-match outcomes, as one short text — the file read after
 * the run, so the CSVs need not be.
 *
 * Every win is the sim's own verdict (`MatchOutcome.winners`); nothing here re-derives
 * the rules. A shared win is split between those who share it. Shares compared with a
 * fair share carry a star when they are more than two standard errors from it.
 */

/** A batch, or the rotations of one table taken together. */
export interface SoakGroup {
  name: string;
  stats: StatRow[];
  /** Null for a table with no outcomes beside it — a person's recorded games. */
  outcomes: MatchOutcome[] | null;
  /**
   * For the pairings matrix: the level of the odd seat and of the others, and which seat
   * was the odd one in each match — rotations move it, and when the levels are the same,
   * as in the control, only the seat can say whose wins are counted.
   */
  pairing?: { odd: number; field: number; seatOf: Map<string, number> };
  /** Shown in the matrix alone, not given a line and a block of its own. */
  matrixOnly?: boolean;
}

const TRAITS = ['risk', 'targeting', 'cannons'] as const;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`;

/** An observed share beside its fair one, starred beyond two standard errors over `n`. */
function share(observed: number, fair: number, n: number): string {
  const se = Math.sqrt((fair * (1 - fair)) / Math.max(1, n));
  const star = Math.abs(observed - fair) > 2 * se ? ' *' : '';
  return `${pct(observed, 1).padStart(6)} (fair ${pct(fair, 1)}, ±${pct(2 * se, 1)})${star}`;
}

/** Each team's score: the sum of its members'. */
function teamScores(o: MatchOutcome): Map<number, number> {
  const scores = new Map<number, number>();
  o.teams.forEach((team, p) => scores.set(team, (scores.get(team) ?? 0) + (o.scores[p] ?? 0)));
  return scores;
}

function winningTeams(o: MatchOutcome): number[] {
  return [...new Set(o.winners.map((p) => o.teams[p]!))];
}

/** A match's rows by round, each player's score carried forward from their last row. */
interface Standing {
  round: number;
  leader: number | null;
}

/**
 * The leading team after each round, among teams with someone still in. A tie leaves the
 * lead where it was, so a draw on points is not counted as a change of lead.
 */
function standings(rows: readonly StatRow[], o: MatchOutcome): Standing[] {
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const score = new Map<number, number>();
  const out: Standing[] = [];
  let leader: number | null = null;
  for (const round of rounds) {
    const these = rows.filter((r) => r.round === round);
    for (const r of these) score.set(r.player, r.score);
    const alive = new Set(these.filter((r) => !r.eliminated).map((r) => o.teams[r.player]!));
    const totals = new Map<number, number>();
    for (const [player, s] of score) {
      const team = o.teams[player]!;
      if (alive.has(team)) totals.set(team, (totals.get(team) ?? 0) + s);
    }
    const top = Math.max(...totals.values());
    const leaders = [...totals].filter(([, s]) => s === top).map(([t]) => t);
    if (leaders.length === 1) leader = leaders[0]!;
    else if (leader === null || !leaders.includes(leader)) leader = null;
    out.push({ round, leader });
  }
  return out;
}

/** The measures of one group, as numbers, for the overview line and the detail block. */
export interface GroupMeasures {
  matches: number;
  byCap: number;
  byElimination: number;
  draws: number;
  unfinished: number;
  ties: number;
  rounds: number;
  marginMedian: number | null;
  marginUnder10: number | null;
  /** Matches with the lead changing hands after round 5, and how often round 5's leader won. */
  leadChanged: number | null;
  leaderAt5Won: number | null;
  failsPerPlayer: number;
  spentOne: number;
  failedRounds: number;
  knockoutsPerMatch: number;
  knockoutRounds: number[];
}

export function measure(group: SoakGroup): GroupMeasures {
  const outcomes = group.outcomes ?? [];
  const rowsByMatch = new Map<string, StatRow[]>();
  for (const row of group.stats) {
    const list = rowsByMatch.get(row.match);
    if (list === undefined) rowsByMatch.set(row.match, [row]);
    else list.push(row);
  }

  const capped = outcomes.filter((o) => o.endedBy === 'round_cap');
  const margins = capped.flatMap((o) => {
    const winners = winningTeams(o);
    if (winners.length !== 1) return [0];
    const scores = teamScores(o);
    const w = scores.get(winners[0]!)!;
    const others = [...scores].filter(([t]) => t !== winners[0]).map(([, s]) => s);
    return w <= 0 || others.length === 0 ? [] : [(w - Math.max(...others)) / w];
  });

  let changed = 0;
  let decidedAt5 = 0;
  let leaderWon = 0;
  for (const o of outcomes) {
    const rows = rowsByMatch.get(o.match) ?? [];
    const late = standings(rows, o).filter((s) => s.round >= 5);
    const leaders = late.map((s) => s.leader);
    if (
      leaders.some((l, i) => i > 0 && l !== null && leaders[i - 1] !== null && l !== leaders[i - 1])
    ) {
      changed++;
    }
    const at5 = late[0]?.leader ?? null;
    const winners = winningTeams(o);
    if (at5 !== null && winners.length === 1) {
      decidedAt5++;
      if (winners[0] === at5) leaderWon++;
    }
  }

  // A failed seal is a row with nothing sealed: a life spent, or the last one.
  const perPlayer = new Map<string, number>();
  for (const row of group.stats) {
    const key = `${row.match}/${row.player}`;
    perPlayer.set(key, (perPlayer.get(key) ?? 0) + (row.enclosedCastles === 0 ? 1 : 0));
  }
  const knockouts = group.stats.filter((r) => r.eliminated);
  const matchCount = outcomes.length > 0 ? outcomes.length : rowsByMatch.size;

  return {
    matches: matchCount,
    byCap: capped.length,
    byElimination: outcomes.filter((o) => o.endedBy === 'elimination' && !o.draw).length,
    draws: outcomes.filter((o) => o.draw).length,
    unfinished: outcomes.filter((o) => o.endedBy === 'unfinished').length,
    ties: outcomes.filter((o) => winningTeams(o).length > 1).length,
    rounds: mean(outcomes.map((o) => o.rounds)),
    marginMedian: margins.length === 0 ? null : median(margins),
    marginUnder10:
      margins.length === 0 ? null : margins.filter((m) => m < 0.1).length / margins.length,
    leadChanged: outcomes.length === 0 ? null : changed / outcomes.length,
    leaderAt5Won: decidedAt5 === 0 ? null : leaderWon / decidedAt5,
    failsPerPlayer: mean([...perPlayer.values()]),
    spentOne:
      perPlayer.size === 0
        ? 0
        : [...perPlayer.values()].filter((n) => n > 0).length / perPlayer.size,
    failedRounds:
      group.stats.length === 0
        ? 0
        : group.stats.filter((r) => r.enclosedCastles === 0).length / group.stats.length,
    knockoutsPerMatch: matchCount === 0 ? 0 : knockouts.length / matchCount,
    knockoutRounds: knockouts.map((r) => r.round),
  };
}

const OVERVIEW_HEADER =
  'group                     n   cap  elim draw unfin ties rounds  margin <10%  lead±  @5won  fails  spent  failed  KO/m';

function overviewLine(name: string, m: GroupMeasures): string {
  const opt = (x: number | null, f: (x: number) => string): string => (x === null ? '—' : f(x));
  return [
    name.padEnd(22),
    String(m.matches).padStart(5),
    pct(m.byCap / Math.max(1, m.matches)).padStart(5),
    pct(m.byElimination / Math.max(1, m.matches)).padStart(5),
    String(m.draws).padStart(4),
    String(m.unfinished).padStart(5),
    String(m.ties).padStart(4),
    m.rounds.toFixed(1).padStart(6),
    opt(m.marginMedian, (x) => pct(x, 1)).padStart(7),
    opt(m.marginUnder10, (x) => pct(x)).padStart(5),
    opt(m.leadChanged, (x) => pct(x)).padStart(6),
    opt(m.leaderAt5Won, (x) => pct(x)).padStart(6),
    m.failsPerPlayer.toFixed(2).padStart(6),
    pct(m.spentOne).padStart(6),
    pct(m.failedRounds, 1).padStart(7),
    m.knockoutsPerMatch.toFixed(2).padStart(5),
  ].join(' ');
}

/** Wins credited to each key, a shared win split; and each key's share of the seats. */
function winShares(
  outcomes: readonly MatchOutcome[],
  keyOf: (o: MatchOutcome, player: number) => string,
): { key: string; observed: number; fair: number }[] {
  const wins = new Map<string, number>();
  const seats = new Map<string, number>();
  let allSeats = 0;
  for (const o of outcomes) {
    for (let p = 0; p < o.players; p++) {
      const key = keyOf(o, p);
      seats.set(key, (seats.get(key) ?? 0) + 1);
      allSeats++;
    }
    for (const w of o.winners) {
      const key = keyOf(o, w);
      wins.set(key, (wins.get(key) ?? 0) + 1 / o.winners.length);
    }
  }
  const counted = outcomes.filter((o) => o.winners.length > 0).length;
  return [...seats.keys()]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((key) => ({
      key,
      observed: (wins.get(key) ?? 0) / Math.max(1, counted),
      fair: (seats.get(key) ?? 0) / Math.max(1, allSeats),
    }));
}

function knockoutTiming(rounds: readonly number[]): string {
  if (rounds.length === 0) return 'none';
  const bands: [string, (r: number) => boolean][] = [
    ['1-2', (r) => r <= 2],
    ['3-5', (r) => r >= 3 && r <= 5],
    ['6-10', (r) => r >= 6 && r <= 10],
    ['11+', (r) => r > 10],
  ];
  return bands.map(([label, f]) => `rounds ${label}: ${rounds.filter(f).length}`).join(', ');
}

/** Per player-round, by who played: the habits behind the outcomes. */
function habits(rows: readonly StatRow[]): string[] {
  const byLabel = new Map<string, StatRow[]>();
  for (const row of rows) {
    if (row.eliminated) continue;
    const label = row.level === null ? 'human' : `L${row.level}`;
    const list = byLabel.get(label);
    if (list === undefined) byLabel.set(label, [row]);
    else list.push(row);
  }
  const lines = ['  who      rounds  failed  sealed  guns  active  room  wall  pieces  terr   dmg'];
  for (const [label, list] of [...byLabel].sort((a, b) =>
    a[0] === 'human'
      ? 1
      : b[0] === 'human'
        ? -1
        : a[0].localeCompare(b[0], 'en', { numeric: true }),
  )) {
    const rated = list.filter((r) => r.piecesBudget !== null && r.piecesBudget > 0);
    const used =
      rated.length === 0 ? null : mean(rated.map((r) => r.piecesPlaced / r.piecesBudget!));
    lines.push(
      [
        `  ${label.padEnd(7)}`,
        String(list.length).padStart(6),
        pct(list.filter((r) => r.enclosedCastles === 0).length / list.length, 1).padStart(7),
        mean(list.map((r) => r.enclosedCastles))
          .toFixed(2)
          .padStart(7),
        mean(list.map((r) => r.cannonsOwned))
          .toFixed(1)
          .padStart(5),
        mean(list.map((r) => r.cannonsActive))
          .toFixed(1)
          .padStart(7),
        mean(list.map((r) => r.cannonRoom))
          .toFixed(1)
          .padStart(5),
        mean(list.map((r) => r.wallTiles))
          .toFixed(0)
          .padStart(5),
        (used === null
          ? `${mean(list.map((r) => r.piecesPlaced)).toFixed(1)}`
          : pct(used)
        ).padStart(7),
        mean(list.map((r) => r.territoryPoints))
          .toFixed(0)
          .padStart(5),
        mean(list.map((r) => r.damagePoints))
          .toFixed(0)
          .padStart(5),
      ].join(' '),
    );
  }
  return lines;
}

/** The detail block of one group: outcomes, then the shares, then the habits. */
export function detail(group: SoakGroup): string[] {
  const m = measure(group);
  const lines = [`== ${group.name}`, `  ${m.matches} matches`];
  const outcomes = group.outcomes ?? [];
  if (outcomes.length > 0) {
    lines.push(
      `  ended: ${m.byCap} at the cap, ${m.byElimination} by elimination, ${m.draws} drawn, ` +
        `${m.unfinished} unfinished; ${m.ties} shared wins; ${m.rounds.toFixed(1)} rounds`,
    );
    if (m.marginMedian !== null) {
      lines.push(
        `  winner's margin at the cap: median ${pct(m.marginMedian, 1)}, under 10% in ${pct(m.marginUnder10 ?? 0)}`,
      );
    }
    lines.push(
      `  lead changed after round 5 in ${pct(m.leadChanged ?? 0)}; round 5's leader won ${m.leaderAt5Won === null ? '—' : pct(m.leaderAt5Won)}`,
    );
  }
  lines.push(
    `  failed seals: ${pct(m.failedRounds, 1)} of player-rounds; ${m.failsPerPlayer.toFixed(2)} a player; ` +
      `${pct(m.spentOne)} of players failed at least once`,
    `  knockouts: ${m.knockoutsPerMatch.toFixed(2)} a match (${knockoutTiming(m.knockoutRounds)})`,
  );
  if (outcomes.length > 0) {
    const n = outcomes.filter((o) => o.winners.length > 0).length;
    const levels = winShares(outcomes, (o, p) => `L${o.levels[p]}`);
    if (levels.length > 1) {
      lines.push('  wins by level:');
      for (const s of levels) lines.push(`    ${s.key.padEnd(18)} ${share(s.observed, s.fair, n)}`);
    }
    const islands = winShares(outcomes, (_, p) => `island ${p + 1}`);
    lines.push('  wins by island:');
    for (const s of islands) lines.push(`    ${s.key.padEnd(18)} ${share(s.observed, s.fair, n)}`);
    TRAITS.forEach((trait, t) => {
      const values = winShares(outcomes, (o, p) => o.personalities[p]?.split('-')[t] ?? '?');
      if (values.length < 2) return;
      lines.push(`  wins by ${trait}:`);
      for (const s of values) lines.push(`    ${s.key.padEnd(18)} ${share(s.observed, s.fair, n)}`);
    });
  }
  lines.push(...habits(group.stats));
  return lines;
}

/**
 * The odd seat's share of the wins, one bot at the row's level against two at the
 * column's, from the pairing groups; a third is even.
 */
function pairingMatrix(groups: readonly SoakGroup[]): string[] {
  const cells = new Map<string, { won: number; n: number }>();
  for (const g of groups) {
    if (g.pairing === undefined || g.outcomes === null) continue;
    const { odd, field, seatOf } = g.pairing;
    let won = 0;
    let n = 0;
    for (const o of g.outcomes) {
      const seat = seatOf.get(o.match);
      if (o.winners.length === 0 || seat === undefined) continue;
      n++;
      if (o.winners.includes(seat)) won += 1 / o.winners.length;
    }
    const key = `${odd}/${field}`;
    const cell = cells.get(key) ?? { won: 0, n: 0 };
    cells.set(key, { won: cell.won + won, n: cell.n + n });
  }
  if (cells.size === 0) return [];
  const levels = [...new Set([...cells.keys()].flatMap((k) => k.split('/').map(Number)))].sort(
    (a, b) => a - b,
  );
  const lines = [
    '== pairings: one bot at the row level against two at the column level; its share of wins',
    `   (a third is even; matches per cell in brackets)`,
    `  vs  ${levels.map((l) => `L${l}`.padStart(10)).join('')}`,
  ];
  for (const odd of levels) {
    const row = levels.map((field) => {
      const cell = cells.get(`${odd}/${field}`);
      return (
        cell === undefined ? '' : `${pct(cell.won / Math.max(1, cell.n))} (${cell.n})`
      ).padStart(10);
    });
    lines.push(`  L${String(odd).padEnd(3)}${row.join('')}`);
  }
  return lines;
}

/** The whole summary: a line a group, the pairings matrix, then each group in detail. */
export function soakSummary(groups: readonly SoakGroup[], heading: readonly string[] = []): string {
  const plain = groups.filter((g) => g.matrixOnly !== true);
  const lines = [...heading, '', OVERVIEW_HEADER];
  for (const g of plain) lines.push(overviewLine(g.name, measure(g)));
  lines.push(
    '',
    'n matches; cap/elim how they ended; margin the median winner margin at the cap, <10% the share',
    "under it; lead± matches whose lead changed after round 5; @5won how often round 5's leader",
    'won; fails failed seals a player; spent players failing at least once; failed the share of',
    'player-rounds failed; KO/m knockouts a match.',
  );
  const matrix = pairingMatrix(groups);
  if (matrix.length > 0) lines.push('', ...matrix);
  for (const g of plain) lines.push('', ...detail(g));
  return `${lines.join('\n')}\n`;
}
