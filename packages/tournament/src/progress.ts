import type { TournamentConfig } from '@bollwerk/config';
import { streamFor, type Rng } from '@bollwerk/sim';

import { chunk, seedBracket, separate, snake } from './bracket.js';
import { rollOrder, strength } from './roll.js';
import { HOST_TEAM, type MatchRecord, type Save, type StepRecord } from './save.js';

/**
 * Where a tournament stands, derived from its save: the steps it runs through, who is out
 * and when, the league's table, the bracket, and the matches of the next step. Nothing here
 * is stored; a save is its settings, its plan and its finished steps, and this replays them.
 */

/**
 * One step of the schedule: matches played at the same time, of which the host's team
 * plays at most one. In double elimination `knockout` is the winners' bracket, and its last
 * round the winners' final; in single elimination the last `knockout` round is the final.
 */
export type Step =
  | { kind: 'league'; matchday: number }
  | { kind: 'knockout'; round: number }
  | { kind: 'losers'; round: number }
  | { kind: 'final' };

/** Every step of a tournament, in order, fixed at creation. */
export function stepsOf(save: Save): Step[] {
  const { plan } = save;
  const steps: Step[] = plan.matchdays.map((_, matchday) => ({ kind: 'league', matchday }));
  plan.rounds.forEach((_, round) => {
    steps.push({ kind: 'knockout', round });
    plan.losers.forEach((loser, index) => {
      if (loser.after === round) steps.push({ kind: 'losers', round: index });
    });
  });
  if (save.settings.knockout === 'double') steps.push({ kind: 'final' });
  return steps;
}

export type Status =
  | { kind: 'playing' }
  /** Out at this step: lost a match there, or, at the end of the league, not through. */
  | { kind: 'out'; step: number }
  | { kind: 'won' };

/** A step's matches as team ids, and in the losers' bracket the teams through on a bye. */
export interface Pairing {
  matches: number[][];
  byes: number[];
}

/** A team's line in the league's table. */
export interface TableRow {
  team: number;
  points: number;
  /** The sum of the points of every team met, once per meeting. */
  buchholz: number;
  played: number;
}

export class Progress {
  readonly steps: Step[];
  /** Steps finished; the next to be played is this one. */
  readonly done: number;
  readonly status: Status;
  /** The next step's matches while the host's team is still in, otherwise null. */
  readonly next: Pairing | null;

  private readonly points: number[];
  private readonly played: number[];
  private readonly opponents: number[][];
  /** Each knockout team's seed, 0 best; null until the knockout begins. */
  private seedRank: Map<number, number> | null = null;
  /** The winners' bracket's teams still in, in bracket order. */
  private bracket: number[] = [];
  /** The losers' bracket's teams still in. */
  private pool: number[] = [];
  private readonly outAt = new Map<number, number>();
  private winnersChampion: number | null = null;
  private champion: number | null = null;

  constructor(private readonly save: Save) {
    this.steps = stepsOf(save);
    this.points = save.teams.map(() => 0);
    this.played = save.teams.map(() => 0);
    this.opponents = save.teams.map(() => []);
    save.steps.forEach((record, index) => {
      this.enter(index);
      this.apply(index, record);
    });
    this.done = save.steps.length;
    if (this.done < this.steps.length) this.enter(this.done);

    const out = this.outAt.get(HOST_TEAM);
    if (out !== undefined) this.status = { kind: 'out', step: out };
    else if (this.champion === HOST_TEAM) this.status = { kind: 'won' };
    else if (this.done >= this.steps.length) throw new Error('a finished tournament with no end');
    else this.status = { kind: 'playing' };
    this.next = this.status.kind === 'playing' ? this.pairing(this.done) : null;
  }

  /** The step a team went out at, or null while it is in. */
  outStep(team: number): number | null {
    return this.outAt.get(team) ?? null;
  }

  /** The winners' bracket's teams still in — the knockout's, in single elimination. */
  get winnersBracket(): readonly number[] {
    return this.bracket.filter((team) => !this.outAt.has(team));
  }

  /** The losers' bracket's teams still in; always empty in single elimination. */
  get losersBracket(): readonly number[] {
    return this.pool.filter((team) => !this.outAt.has(team));
  }

  /** The knockout's champion, once there is one. */
  get winner(): number | null {
    return this.champion;
  }

  /** The host's match in the next step, as an index into `next.matches`; -1 for none. */
  get hostMatch(): number {
    return this.next?.matches.findIndex((m) => m.includes(HOST_TEAM)) ?? -1;
  }

  /** Each knockout team's seed, 0 best; null before the knockout. */
  seedOf(team: number): number | null {
    return this.seedRank?.get(team) ?? null;
  }

  /**
   * The league's table, best first (TOURNAMENT §1.4): by points — one for every team
   * finished ahead of — then Buchholz, then a draw fixed by the seed.
   */
  table(): TableRow[] {
    const order = streamFor(this.save.settings.seed, 'table').shuffle(
      this.save.teams.map((_, id) => id),
    );
    const draw = new Map(order.map((team, index) => [team, index]));
    const rows = this.save.teams.map((_, team) => ({
      team,
      points: this.points[team] as number,
      buchholz: (this.opponents[team] as number[]).reduce(
        (sum, o) => sum + (this.points[o] as number),
        0,
      ),
      played: this.played[team] as number,
    }));
    return rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.buchholz - a.buchholz ||
        (draw.get(a.team) as number) - (draw.get(b.team) as number),
    );
  }

  /** Called before a step is applied or paired: the knockout is seeded as it begins. */
  private enter(index: number): void {
    const step = this.steps[index];
    if (step?.kind !== 'knockout' || step.round !== 0 || this.seedRank !== null) return;
    const { plan } = this.save;
    // After a league, its table seeds the knockout and everyone below the cut is out with
    // the league's last matchday; without one, the draw made at creation does.
    const ranked =
      plan.draw ??
      this.table()
        .slice(0, plan.advance)
        .map((row) => row.team);
    const through = new Set(ranked);
    for (let team = 0; team < this.save.teams.length; team++) {
      if (!through.has(team)) this.outAt.set(team, index - 1);
    }
    this.seedRank = new Map(ranked.map((team, seed) => [team, seed]));
    let leaves = seedBracket(ranked, plan.rounds);
    const archnemesis = this.save.teams.findIndex((t) => t.archnemesis);
    if (archnemesis > 0) leaves = separate(leaves, plan.rounds, HOST_TEAM, archnemesis);
    this.bracket = leaves;
  }

  private pairing(index: number): Pairing {
    const step = this.steps[index] as Step;
    const { plan } = this.save;
    switch (step.kind) {
      case 'league':
        return {
          matches: (plan.matchdays[step.matchday] as number[][]).map((m) => [...m]),
          byes: [],
        };
      case 'knockout':
        return { matches: chunk(this.bracket, plan.rounds[step.round] as number), byes: [] };
      case 'losers': {
        const size = (plan.losers[step.round] as { size: number }).size;
        const sorted = [...this.pool].sort((a, b) => this.seed(a) - this.seed(b));
        if (sorted.length < size)
          throw new Error(`a losers' round of ${size} with ${sorted.length} left`);
        // The best seeds sit out the remainder, and the rest are dealt into matches in a
        // snake so no match gathers all the strong.
        const byes = sorted.length % size;
        return {
          matches: snake(sorted.slice(byes), (sorted.length - byes) / size),
          byes: sorted.slice(0, byes),
        };
      }
      case 'final':
        return { matches: [[this.winnersChampion as number, this.pool[0] as number]], byes: [] };
    }
  }

  private seed(team: number): number {
    return this.seedRank?.get(team) ?? Infinity;
  }

  private apply(index: number, record: StepRecord): void {
    const step = this.steps[index];
    if (step === undefined) throw new Error(`a result for step ${index}, which does not exist`);
    const double = this.save.settings.knockout === 'double';
    const losersOf = (match: MatchRecord): number[] => match.order.slice(1);
    const out = (teams: readonly number[]): void => {
      for (const team of teams) this.outAt.set(team, index);
    };
    switch (step.kind) {
      case 'league':
        for (const match of record.matches) {
          const n = match.order.length;
          match.order.forEach((team, place) => {
            this.points[team] = (this.points[team] as number) + n - 1 - place;
            this.played[team] = (this.played[team] as number) + 1;
            this.opponents[team]?.push(...match.teams.filter((t) => t !== team));
          });
        }
        return;
      case 'knockout': {
        this.bracket = record.matches.map((m) => m.order[0] as number);
        for (const match of record.matches) {
          if (double) this.pool.push(...losersOf(match));
          else out(losersOf(match));
        }
        if (step.round === this.save.plan.rounds.length - 1) {
          if (double) this.winnersChampion = this.bracket[0] as number;
          else this.champion = this.bracket[0] as number;
        }
        return;
      }
      case 'losers':
        for (const match of record.matches) out(losersOf(match));
        this.pool = [...record.byes, ...record.matches.map((m) => m.order[0] as number)];
        return;
      case 'final': {
        const match = record.matches[0] as MatchRecord;
        this.champion = match.order[0] as number;
        out(losersOf(match));
        return;
      }
    }
  }
}

/** The stream deciding ties in the host's match of a step: its coin (`placings`). */
export function coinFor(save: Save, step: number): Rng {
  return streamFor(save.settings.seed, `tie:${step}`);
}

/** The map of the host's match of a step: the same on a replay (TOURNAMENT §1.7). */
export function mapSeed(save: Save, step: number): number {
  return streamFor(save.settings.seed, `map:${step}`).nextU32();
}

/** Rolls a match of a step, from a stream of its own, so nothing else changes its result. */
function rollMatch(
  save: Save,
  config: TournamentConfig,
  step: number,
  match: number,
  teams: readonly number[],
  hostLevel?: number,
): MatchRecord {
  const strengths = teams.map((id) =>
    strength(save.teams[id] as (typeof save.teams)[number], config, hostLevel),
  );
  const order = rollOrder(teams, strengths, streamFor(save.settings.seed, `roll:${step}:${match}`));
  return { teams: [...teams], order, scores: null };
}

/**
 * Rolls every step in which the host's team has no match — a bye, or the steps after it
 * is out are never reached — until it has one or the tournament is over.
 */
export function settle(save: Save, config: TournamentConfig): Progress {
  for (;;) {
    const progress = new Progress(save);
    if (progress.next === null || progress.hostMatch >= 0) return progress;
    const { matches, byes } = progress.next;
    save.steps.push({
      matches: matches.map((teams, m) => rollMatch(save, config, progress.done, m, teams)),
      byes,
    });
  }
}

/** One team's place in the host's match, by tournament team id. */
export interface Placed {
  team: number;
  score: number;
}

/**
 * The host's match of the next step, finished: the rest of the step is rolled, the step
 * stored whole, and every step after it the host has no part in is rolled too. Changes
 * the save in place; the caller stores it.
 */
export function recordMatch(
  save: Save,
  config: TournamentConfig,
  placed: readonly Placed[],
  now: string,
): Progress {
  const progress = new Progress(save);
  const host = progress.hostMatch;
  if (progress.next === null || host < 0) throw new Error('the host has no match to record');
  const teams = progress.next.matches[host] as number[];
  const order = placed.map((p) => p.team);
  if (order.length !== teams.length || !teams.every((t) => order.includes(t))) {
    throw new Error(`a result for ${order.join(',')} in a match of ${teams.join(',')}`);
  }
  save.steps.push({
    matches: progress.next.matches.map((m, index) =>
      index === host
        ? { teams: [...m], order, scores: placed.map((p) => p.score) }
        : rollMatch(save, config, progress.done, index, m),
    ),
    byes: progress.next.byes,
  });
  save.playedAt = now;
  return settle(save, config);
}

/**
 * The host's match rolled as if the host were a bot of `hostLevel` — for the headless
 * runner and tests, which play whole tournaments without a match being played.
 */
export function rollHostMatch(save: Save, config: TournamentConfig, hostLevel: number): Progress {
  const progress = new Progress(save);
  const teams = progress.next?.matches[progress.hostMatch];
  if (teams === undefined) throw new Error('the host has no match to roll');
  const rolled = rollMatch(save, config, progress.done, progress.hostMatch, teams, hostLevel);
  return recordMatch(
    save,
    config,
    rolled.order.map((team) => ({ team, score: 0 })),
    save.playedAt,
  );
}

/** One match of the host's team, for its history at the end. */
export interface HostMatch {
  step: number;
  kind: Step;
  match: MatchRecord;
}

/** Every match the host's team has played, in order. */
export function hostHistory(save: Save): HostMatch[] {
  const steps = stepsOf(save);
  return save.steps.flatMap((record, step) =>
    record.matches
      .filter((m) => m.teams.includes(HOST_TEAM))
      .map((match) => ({ step, kind: steps[step] as Step, match })),
  );
}
