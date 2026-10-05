/**
 * The weekend soak of 2026-10-03 (ARCHIVE 12h): packages A, B and D, agreed with the
 * user — the planned soaks at twice to ten times their size, the full level ladder with
 * every pairing, and the odd cases. Measurement only: every batch runs the rules as they
 * are.
 *
 * Batches are cut into chunks of a few matches, each one harness process writing its own
 * files, so a weekend's run can stop anywhere — a crash, a restart — and pick up where it
 * was. Every batch has a seed range of its own, so no two play the same maps.
 */

export interface Batch {
  /** Unique; the files are named for it. */
  name: string;
  /** The summary's group: rotations of one table share it. */
  group: string;
  players: number;
  teams?: number;
  levels: number[];
  matches: number;
  /** `none` lifts the round cap. */
  maxRounds?: 'none';
  /**
   * One bot at `odd` against the rest at `field`, the odd one in seat `seat`. By seat and
   * not by level, so the control — Level 5 against two Level 5s — counts one seat's wins.
   */
  pairing?: { odd: number; field: number; seat: number };
  matrixOnly?: boolean;
  /** Replays the recordings instead of running bots. */
  replay?: boolean;
}

export interface Chunk {
  batch: Batch;
  /** `<batch>.<nnn>`, the stem of its files. */
  name: string;
  seed: number;
  matches: number;
  /** Seconds of one core, estimated — for the order and the time left, not for anything else. */
  cost: number;
}

/** Matches a chunk: small enough that a stop loses little, large enough to start few processes. */
export const CHUNK_MATCHES = 16;

/** Every rotation of a seat list, so no level sits on one island (the harness does not shuffle). */
function rotations(levels: readonly number[]): number[][] {
  return levels.map((_, r) => [...levels.slice(r), ...levels.slice(0, r)]);
}

const SUFFIX = 'abcdefgh';

/** A table played from every seat: one batch a rotation, the matches split between them. */
function rotated(
  group: string,
  players: number,
  levels: number[],
  matches: number,
  extra: Partial<Batch> = {},
): Batch[] {
  const all = rotations(levels);
  return all.map((seats, r) => ({
    name: `${group}-${SUFFIX[r]}`,
    group,
    players,
    levels: seats,
    matches: Math.round(matches / all.length),
    ...extra,
    // The first seat of the list given, wherever this rotation has moved it.
    ...(extra.pairing === undefined
      ? {}
      : { pairing: { ...extra.pairing, seat: (all.length - r) % all.length } }),
  }));
}

export function soakPlan(): Batch[] {
  const batches: Batch[] = [];
  const add = (...b: Batch[]): void => void batches.push(...b);
  const one = (
    name: string,
    players: number,
    levels: number[],
    matches: number,
    extra: Partial<Batch> = {},
  ): Batch => ({
    name,
    group: name,
    players,
    levels,
    matches,
    ...extra,
  });

  // A — soak 1, the points game (PLAN 11.2).
  add(one('s1-3p-L5', 3, [5], 960));
  add(one('s1-4p-L5', 4, [5], 960));
  add(one('s1-2v2-L5', 4, [5], 960, { teams: 2 }));
  add(one('s1-3p-L8', 3, [8], 480));
  add(...rotated('s1-mix356', 3, [3, 5, 6], 960));
  // A — soak 4, two players (PLAN 11.3).
  add(one('s4-2p-L5', 2, [5], 960));
  add(...rotated('s4-2p-36', 2, [3, 6], 960));
  // A — soak 5, position bias (PLAN 11.4); four players is s1-4p-L5.
  add(one('s5-6p-L5', 6, [5], 960));
  add(one('s5-8p-L5', 8, [5], 960));

  // B — soak 2, the ladder: one bot at each level against two at Level 5.
  for (let k = 1; k <= 10; k++) {
    add(...rotated(`s2-L${k}`, 3, [k, 5, 5], 480, { pairing: { odd: k, field: 5, seat: 0 } }));
  }
  // B — every other pairing, one at k against two at j, for the matrix alone.
  for (let j = 1; j <= 10; j++) {
    if (j === 5) continue;
    for (let k = 1; k <= 10; k++) {
      if (k === j) continue;
      add(
        ...rotated(`s2-pair-L${k}vL${j}`, 3, [k, j, j], 96, {
          pairing: { odd: k, field: j, seat: 0 },
          matrixOnly: true,
        }),
      );
    }
  }

  // D — the odd cases: two players with no cap (does every match end?), five and seven
  // players, whose grids have a short last row, and the user's recorded games (soak 6).
  add(one('s7-2p-L5-nocap', 2, [5], 480, { maxRounds: 'none' }));
  add(...rotated('s7-2p-36-nocap', 2, [3, 6], 480, { maxRounds: 'none' }));
  add(one('s7-5p-L5', 5, [5], 480));
  add(one('s7-7p-L5', 7, [5], 480));
  add({ name: 's6-human', group: 's6-human', players: 0, levels: [], matches: 0, replay: true });
  return batches;
}

/**
 * Seconds of one core a match takes, measured on this machine on 2026-10-02 (3.2 s at
 * three players, 5 at four, about 12 at eight) and guessed for no cap — a two-player
 * match then runs until the tick limit or a knockout.
 */
function matchCost(batch: Batch): number {
  if (batch.replay === true) return 60;
  const perPlayer = 0.4 + 1.4 * batch.players;
  return batch.maxRounds === 'none' ? perPlayer * 8 : perPlayer;
}

/** The chunks, the dearest first, so the run does not end on one long straggler. */
export function chunksOf(batches: readonly Batch[], firstSeed = 100_000): Chunk[] {
  const chunks: Chunk[] = [];
  batches.forEach((batch, b) => {
    // A range of ten thousand seeds a batch: no batch here plays more than a thousand.
    const base = firstSeed + b * 10_000;
    if (batch.replay === true) {
      chunks.push({ batch, name: batch.name, seed: 0, matches: 0, cost: matchCost(batch) });
      return;
    }
    for (let c = 0; c * CHUNK_MATCHES < batch.matches; c++) {
      const matches = Math.min(CHUNK_MATCHES, batch.matches - c * CHUNK_MATCHES);
      chunks.push({
        batch,
        name: `${batch.name}.${String(c).padStart(3, '0')}`,
        seed: base + c * CHUNK_MATCHES,
        matches,
        cost: matches * matchCost(batch),
      });
    }
  });
  return chunks.sort((a, b) => b.cost - a.cost);
}

/** The harness's arguments for a chunk, its files given as absolute paths. */
export function chunkArgs(
  chunk: Chunk,
  stats: string,
  outcomes: string,
  recordings: string,
): string[] {
  const { batch } = chunk;
  if (batch.replay === true) return ['--replay', recordings, '--stats', stats];
  const args = [
    '--players',
    String(batch.players),
    '--level',
    batch.levels.join(','),
    '--personality',
    'dealt',
    '--matches',
    String(chunk.matches),
    '--seed',
    String(chunk.seed),
    '--stats',
    stats,
    '--outcomes',
    outcomes,
  ];
  if (batch.teams !== undefined) args.push('--teams', String(batch.teams));
  if (batch.maxRounds === 'none') args.push('--max-rounds', 'none');
  return args;
}
