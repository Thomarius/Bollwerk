import type { Rng } from '@bollwerk/sim';

import type { LoserRound } from './save.js';

/** A range of teams a match. */
export interface MatchSizes {
  min: number;
  max: number;
}

/** A uniform whole number in [min, max]. */
function between(rng: Rng, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1);
}

export function product(values: readonly number[]): number {
  return values.reduce((a, b) => a * b, 1);
}

/**
 * Each knockout round's match size, drawn once for the whole round so the bracket stays
 * regular (TOURNAMENT §1.3). The field is their product; while it is over the cap the
 * largest is lowered by one, never below the minimum — and if every round is at the
 * minimum and still over it, rounds are dropped until it fits. The cap is hard because
 * a field is saved whole: eight-team matches over four rounds made 4,096 teams, 8,192
 * with a league, and a 2 MB save, where a browser keeps 5 MB for everything.
 */
export function knockoutSizes(rng: Rng, rounds: number, sizes: MatchSizes, cap: number): number[] {
  const out = Array.from({ length: rounds }, () => between(rng, sizes.min, sizes.max));
  while (product(out) > cap) {
    const largest = Math.max(...out);
    if (largest > sizes.min) out[out.indexOf(largest)] = largest - 1;
    else if (out.length > 1) out.pop();
    else break;
  }
  return out;
}

/** Teams still in the losers' pool after a round of matches of `size`: byes and winners. */
export function survivors(pool: number, size: number): number {
  return Math.floor(pool / size) + (pool % size);
}

/**
 * The losers' bracket of double elimination (TOURNAMENT §1.5), fixed at creation: after each
 * winners' round its losers join a pool, which plays one round if it is large enough for a
 * match — sizes drawn within the range, byes when the count does not divide. Once the
 * winners' final has dropped its losers in, the pool plays on until one team is left,
 * a match smaller than the minimum allowed only when nothing else can finish it.
 */
export function loserRounds(rng: Rng, rounds: readonly number[], sizes: MatchSizes): LoserRound[] {
  const out: LoserRound[] = [];
  let alive = product(rounds);
  let pool = 0;
  rounds.forEach((size, round) => {
    const matches = alive / size;
    pool += matches * (size - 1);
    alive = matches;
    const last = round === rounds.length - 1;
    while (pool >= 2 && (last || pool >= sizes.min)) {
      const s = pool < sizes.min ? pool : between(rng, sizes.min, Math.min(sizes.max, pool));
      out.push({ after: round, size: s });
      pool = survivors(pool, s);
      if (!last) break;
    }
  });
  return out;
}

/**
 * The match sizes a league of `teams` may play a matchday at: those in the range that
 * divide it. Every matchday has one size for all its matches, so a win is worth the same
 * to everyone that day — mixed sizes let a team that won every match miss the cut, beaten
 * on points by single wins in larger matches (5% of unbeaten hosts in a Short league, ARCHIVE
 * 12zf). The knockout's first round size always divides the league's field.
 */
export function matchdaySizes(teams: number, sizes: MatchSizes): number[] {
  const out: number[] = [];
  for (let s = sizes.min; s <= sizes.max; s++) if (teams % s === 0) out.push(s);
  return out;
}

/**
 * One league matchday: every team in one match of `size`, opponents drawn at random but
 * steering clear of teams already met. A few draws are tried and the one with the fewest
 * repeat meetings kept; a repeat happens only when they all have one.
 */
export function drawMatchday(
  rng: Rng,
  teams: number,
  size: number,
  met: readonly Set<number>[],
): number[][] {
  let best: number[][] = [];
  let bestRepeats = Infinity;
  for (let attempt = 0; attempt < 16 && bestRepeats > 0; attempt++) {
    const left = rng.shuffle(Array.from({ length: teams }, (_, id) => id));
    const matches: number[][] = [];
    let repeats = 0;
    for (let m = 0; m < teams / size; m++) {
      const match = [left.shift() as number];
      while (match.length < size) {
        // The first team left that has met the fewest of this match so far.
        let pick = 0;
        let fewest = Infinity;
        for (let i = 0; i < left.length && fewest > 0; i++) {
          const team = left[i] as number;
          const meetings = match.filter((m) => met[team]?.has(m)).length;
          if (meetings < fewest) {
            fewest = meetings;
            pick = i;
          }
        }
        repeats += fewest;
        match.push(left.splice(pick, 1)[0] as number);
      }
      matches.push(match);
    }
    if (repeats < bestRepeats) {
      best = matches;
      bestRepeats = repeats;
    }
  }
  return best;
}

/**
 * Every league matchday, drawn at creation: each its size, from those `matchdaySizes`
 * allows, then its matches, steering clear of the meetings before.
 */
export function drawLeague(
  rng: Rng,
  teams: number,
  matchdays: number,
  sizes: MatchSizes,
): number[][][] {
  const met = Array.from({ length: teams }, () => new Set<number>());
  const out: number[][][] = [];
  for (let day = 0; day < matchdays; day++) {
    const options = matchdaySizes(teams, sizes);
    if (options.length === 0) throw new Error(`no match size within range divides ${teams}`);
    const size = options[rng.nextInt(options.length)] as number;
    const matches = drawMatchday(rng, teams, size, met);
    for (const match of matches) {
      for (const a of match) for (const b of match) if (a !== b) met[a]?.add(b);
    }
    out.push(matches);
  }
  return out;
}

/**
 * The most teams any tournament can field at a team size, over every match range and
 * length the settings allow: what the name pools must cover for every name to be plain.
 */
export function largestField(
  config: {
    maxField: number;
    leagueFactor: number;
    lengths: Record<string, { knockoutRounds: number }>;
  },
  teams: MatchSizes,
): number {
  const rounds = Math.max(...Object.values(config.lengths).map((l) => l.knockoutRounds));
  let most = 0;
  const visit = (sizes: number[], range: MatchSizes): void => {
    const field = product(sizes);
    if (field > config.maxField) return;
    if (sizes.length > 0) most = Math.max(most, field * config.leagueFactor);
    if (sizes.length < rounds) {
      for (let s = range.min; s <= range.max; s++) visit([...sizes, s], range);
    }
  };
  for (let min = teams.min; min <= teams.max; min++) {
    for (let max = min; max <= teams.max; max++) visit([], { min, max });
  }
  return most;
}
