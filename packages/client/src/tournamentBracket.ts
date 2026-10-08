import { HOST_TEAM, stepsOf, type Progress, type Save, type Step } from '@bollwerk/tournament';

/**
 * The knockout as a tree of matches, laid out (the test session's request, 2026-10-08): its
 * rounds as columns, each match a box joined to the match its winner goes on to; double
 * elimination's losers' bracket in a band below, and its final at the right. Matches, not
 * teams — a knockout of 128 teams is 127 matches, and a match of any size is one box — the
 * teams and their places shown for the box the mouse is on. Pure: the window draws it.
 */

/** Where a match stands: played (or rolled), the host's next step, or still to come. */
export type NodeState = 'played' | 'next' | 'later';

export interface BracketNode {
  /** `step:match`, unique. */
  key: string;
  step: number;
  match: number;
  section: 'winners' | 'losers' | 'final';
  /** In layout units: columns one apart, rows one apart. */
  x: number;
  y: number;
  state: NodeState;
  /** The teams in it, once known, in the bracket's order. */
  teams: number[] | null;
  /** The teams best placed first, once it has been played. */
  order: number[] | null;
  /** Whether it was played rather than rolled: it has scores. */
  scores: number[] | null;
  host: boolean;
  arch: boolean;
}

export interface BracketEdge {
  from: string;
  to: string;
  /** The host's team went along it. */
  host: boolean;
}

export interface BracketLayout {
  nodes: BracketNode[];
  edges: BracketEdge[];
  /** Where the losers' bracket's band begins, in rows, or null without one. */
  losersTop: number | null;
  columns: number;
  rows: number;
}

function product(values: readonly number[]): number {
  return values.reduce((a, b) => a * b, 1);
}

export function bracketLayout(save: Save, progress: Progress): BracketLayout {
  const steps = stepsOf(save);
  const { plan } = save;
  const arch = save.teams.findIndex((t) => t.archnemesis);
  const nodes: BracketNode[] = [];
  const edges: BracketEdge[] = [];
  const at = (kind: Step['kind'], round: number): number =>
    steps.findIndex(
      (s) => s.kind === kind && (s.kind === 'final' || ('round' in s && s.round === round)),
    );
  /** What is known of a step's matches: recorded, the next step's pairing, or nothing. */
  const known = (
    step: number,
  ): { teams: number[]; order: number[] | null; scores: number[] | null }[] | null => {
    const record = save.steps[step];
    if (record !== undefined) {
      return record.matches.map((m) => ({ teams: m.teams, order: m.order, scores: m.scores }));
    }
    if (step === progress.done && progress.next !== null) {
      return progress.next.matches.map((teams) => ({ teams, order: null, scores: null }));
    }
    return null;
  };
  const node = (
    section: BracketNode['section'],
    step: number,
    match: number,
    x: number,
    y: number,
  ): BracketNode => {
    const info = known(step)?.[match];
    const teams = info?.teams ?? null;
    const n: BracketNode = {
      key: `${step}:${match}`,
      step,
      match,
      section,
      x,
      y,
      state: save.steps[step] !== undefined ? 'played' : step === progress.done ? 'next' : 'later',
      teams,
      order: info?.order ?? null,
      scores: info?.scores ?? null,
      host: teams?.includes(HOST_TEAM) ?? false,
      arch: arch > 0 && (teams?.includes(arch) ?? false),
    };
    nodes.push(n);
    return n;
  };

  // The winners' bracket — the whole knockout in single elimination — as a tree: the first
  // round's matches a row each, every later match level with the middle of those it draws on.
  let ys = Array.from({ length: plan.advance / (plan.rounds[0] ?? 1) }, (_, i) => i);
  let previous: BracketNode[] = [];
  plan.rounds.forEach((size, round) => {
    const step = at('knockout', round);
    if (round > 0) {
      const feeders = size;
      ys = Array.from({ length: previous.length / feeders }, (_, j) => {
        const group = previous.slice(j * feeders, (j + 1) * feeders);
        return group.reduce((sum, p) => sum + p.y, 0) / group.length;
      });
    }
    const column = ys.map((y, match) => node('winners', step, match, round, y));
    if (round > 0) {
      column.forEach((to, j) => {
        for (const from of previous.slice(j * size, (j + 1) * size)) {
          edges.push({ from: from.key, to: to.key, host: from.host && to.host });
        }
      });
    }
    previous = column;
  });
  const winnersRows = Math.max(1, plan.advance / (plan.rounds[0] ?? 1));
  const winnersFinal = previous[0] ?? null;

  // The losers' bracket, its rounds as columns in a band below, each round's matches spread
  // down it; joined where a team that won one played the next, as far as that is known.
  let losersTop: number | null = null;
  let losersFinal: BracketNode | null = null;
  if (plan.losers.length > 0) {
    losersTop = winnersRows + 1;
    // The pool through the rounds, as `loserRounds` counts it, for the rounds not yet played.
    let alive = product(plan.rounds);
    let pool = 0;
    const counts: number[] = [];
    plan.rounds.forEach((size, round) => {
      const matches = alive / size;
      pool += matches * (size - 1);
      alive = matches;
      plan.losers.forEach((loser) => {
        if (loser.after !== round) return;
        counts.push(Math.floor(pool / loser.size));
        pool = Math.floor(pool / loser.size) + (pool % loser.size);
      });
    });
    const tallest = Math.max(1, ...counts);
    const columns: BracketNode[][] = [];
    plan.losers.forEach((_, k) => {
      const step = at('losers', k);
      const count = known(step)?.length ?? counts[k] ?? 1;
      const gap = tallest / count;
      columns.push(
        Array.from({ length: count }, (_, match) =>
          node('losers', step, match, k, (losersTop as number) + (match + 0.5) * gap - 0.5),
        ),
      );
    });
    columns.forEach((column, k) => {
      if (k === 0) return;
      for (const to of column) {
        for (const from of columns.slice(0, k).flat()) {
          const winner = from.order?.[0];
          if (winner !== undefined && to.teams?.includes(winner)) {
            edges.push({ from: from.key, to: to.key, host: winner === HOST_TEAM });
          }
        }
      }
    });
    losersFinal = columns.at(-1)?.[0] ?? null;
  }

  // Double elimination's final, at the right, between the two brackets' champions.
  let columns = plan.rounds.length;
  let rows = winnersRows;
  if (save.settings.knockout === 'double') {
    const losersColumns = plan.losers.length;
    columns = Math.max(plan.rounds.length, losersColumns) + 1;
    const top = winnersFinal?.y ?? 0;
    const bottom = losersFinal?.y ?? top;
    const final = node('final', at('final', 0), 0, columns - 1, (top + bottom) / 2);
    for (const from of [winnersFinal, losersFinal]) {
      if (from === null) continue;
      edges.push({ from: from.key, to: final.key, host: from.host && final.host });
    }
    rows =
      (losersTop ?? winnersRows) +
      Math.max(
        1,
        ...nodes.filter((n) => n.section === 'losers').map((n) => n.y - (losersTop ?? 0) + 1),
      );
  }
  return { nodes, edges, losersTop, columns, rows };
}
