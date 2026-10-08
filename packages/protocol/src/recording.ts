import {
  BALANCED,
  DifficultySchema,
  LevelSchema,
  PersonalitySchema,
  RulesetSchema,
  TerrainConfigSchema,
  tierSetup,
  withoutRetiredKeys,
  type BotSetup,
} from '@bollwerk/config';
import {
  applyAction,
  createMatch,
  drainEvents,
  hashMatchState,
  step,
  type Action,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
} from '@bollwerk/sim';
import { z } from 'zod';

import { ActionSchema } from './messages.js';

/**
 * A recorded match, for tuning the rules against people rather than bots.
 *
 * The simulation is deterministic, so a match is its start and its inputs: the seed,
 * the rules, the players, and every action with the tick it landed on. Nothing else is
 * kept, and nothing needs to be — any statistic thought of later is recomputed by
 * replaying it (`replayRecording`, and `--replay` in the headless harness).
 *
 * One JSON object per line: a header, then a line for every tick on which something was
 * done, then an end line once the match is over. Written as the match runs, so one
 * abandoned or cut short keeps everything up to that point — only the end is missing.
 * The same format whether the server recorded it or a browser playing locally did.
 */

/**
 * The format a recording is written in, which names the state fingerprint on its lines:
 * 1 took version 1 (before 2026-10-07), 2 takes version 2 (`HASH_VERSION`). Both read and
 * replay exactly, each checked against its own fingerprint.
 */
export const RECORDING_FORMAT = 2;

/** The fingerprint a recording of this format carries. */
export function hashVersionOf(format: 1 | 2): number {
  return format;
}

export const RecordingHeaderSchema = z.strictObject({
  kind: z.literal('header'),
  format: z.union([z.literal(1), z.literal(RECORDING_FORMAT)]),
  /** Also the file's name. */
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  source: z.enum(['server', 'local']),
  /** Wall-clock time the match started, ISO 8601. Never read by the replay. */
  startedAt: z.string(),
  /**
   * The code that made it — the commit, `-dirty` with uncommitted changes — stamped by
   * the server as it writes the file, whoever played the match; the browser's own claim
   * is overwritten. A recording replays exactly only against this code. Absent from
   * recordings made before it was kept, and when the server could not tell.
   */
  commit: z.string().min(1).optional(),
  /** The room's code, for a match played through the server. */
  code: z.string().nullable(),
  seed: z.number().int().nonnegative(),
  /** Without the keys the ruleset no longer has, which older recordings carry. */
  ruleset: z.preprocess(withoutRetiredKeys, RulesetSchema),
  terrain: TerrainConfigSchema,
  /**
   * By player id, as the match was created: name, team label, and who played the seat
   * at the start — a bot's level and the personality it was dealt, or nulls for a person.
   * Recordings made before levels name a tier in `difficulty` instead, which still reads.
   */
  players: z.array(
    z.strictObject({
      name: z.string(),
      isBot: z.boolean(),
      team: z.number().int(),
      level: LevelSchema.nullable().optional(),
      personality: PersonalitySchema.nullable().optional(),
      difficulty: DifficultySchema.nullable().optional(),
    }),
  ),
  /**
   * A tournament's match (docs/TOURNAMENT.md): the tournament's id and the step of its
   * schedule. Absent from any other match. A key only added, so the format stands: every
   * reader of this format reads it, and a recording replays only against its own code.
   */
  tournament: z
    .strictObject({ id: z.string().min(1).max(64), step: z.number().int().nonnegative() })
    .optional(),
});
export type RecordingHeader = z.infer<typeof RecordingHeaderSchema>;

/** Who played a recorded seat at the start: a bot's setup, or null for a person. */
export function setupOfRecorded(
  player: RecordingHeader['players'][number] | undefined,
): BotSetup | null {
  if (player === undefined) return null;
  if (player.level !== undefined && player.level !== null) {
    return { level: player.level, personality: player.personality ?? BALANCED };
  }
  // Made before levels: the tier it names stands for a setup.
  if (player.difficulty !== undefined && player.difficulty !== null)
    return tierSetup(player.difficulty);
  return null;
}

export const RecordingTickSchema = z.strictObject({
  kind: z.literal('tick'),
  /** The tick these actions were applied on, before it was stepped. */
  t: z.number().int().nonnegative(),
  a: z.array(ActionSchema),
  /** The state's fingerprint after the step, now and then, to check a replay against. */
  h: z.string().optional(),
});
export type RecordingTick = z.infer<typeof RecordingTickSchema>;

export const RecordingEndSchema = z.strictObject({
  kind: z.literal('end'),
  /** The tick the match stood at when it ended. */
  t: z.number().int().nonnegative(),
  hash: z.string(),
  endedAt: z.string(),
  winners: z.array(z.number().int().nonnegative()),
  draw: z.boolean(),
});
export type RecordingEnd = z.infer<typeof RecordingEndSchema>;

export const RecordingLineSchema = z.discriminatedUnion('kind', [
  RecordingHeaderSchema,
  RecordingTickSchema,
  RecordingEndSchema,
]);
export type RecordingLine = z.infer<typeof RecordingLineSchema>;

/**
 * How often the state's fingerprint is taken: sent by the server for clients to check
 * against, and written on a recording's tick line. One interval, so it is hashed once.
 */
export const HASH_EVERY_TICKS = 30;

/**
 * An id for a recording: when it started, where, and something unique — sortable by
 * date in a directory listing, and safe as a file name.
 */
export function recordingId(source: 'server' | 'local', startedAt: Date, unique: string): string {
  const stamp = startedAt
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `${stamp}-${source}-${unique.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
}

/** The options the match was created with, rebuilt from its header. */
export function matchOptionsOf(header: RecordingHeader): MatchOptions {
  return {
    seed: header.seed,
    ruleset: header.ruleset,
    terrainConfig: header.terrain,
    players: header.players.map((p) => ({ name: p.name, isBot: p.isBot, team: p.team })),
  };
}

/**
 * Writes the lines of a recording as the match runs. The caller decides where they go —
 * a file on the server, the server from a browser — so this knows nothing of either.
 */
export class MatchRecorder {
  private ended = false;

  constructor(
    private readonly write: (line: RecordingLine) => void,
    header: Omit<RecordingHeader, 'kind' | 'format'>,
  ) {
    write({ kind: 'header', format: RECORDING_FORMAT, ...header });
  }

  /**
   * Call after stepping tick `t`, with what was applied on it. Only ticks where
   * something was done are written, and the regular fingerprint ticks. Returns the
   * fingerprint when it took one, for the server's commit.
   */
  stepped(t: number, actions: readonly Action[], state: MatchState): string | undefined {
    if (this.ended) return undefined;
    const hash = t % HASH_EVERY_TICKS === 0 ? hashMatchState(state) : undefined;
    if (actions.length > 0 || hash !== undefined) {
      const line: RecordingTick = { kind: 'tick', t, a: [...actions] };
      if (hash !== undefined) line.h = hash;
      this.write(line);
    }
    if (state.phase === 'game_over') {
      this.ended = true;
      this.write({
        kind: 'end',
        t: state.tick,
        hash: hashMatchState(state),
        endedAt: new Date().toISOString(),
        winners: [...state.winners],
        draw: state.draw,
      });
    }
    return hash;
  }
}

/** Parses a recording file: one line per JSON object, blank lines ignored. */
export function parseRecording(text: string): RecordingLine[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => RecordingLineSchema.parse(JSON.parse(line)));
}

export interface ReplayResult {
  header: RecordingHeader;
  state: MatchState;
  /** The end line, or null for a match that was abandoned or cut short. */
  end: RecordingEnd | null;
  /** Fingerprints checked along the way that did not match. Empty for a true replay. */
  mismatches: number[];
  /** Actions the rules refused on replay — a recording from different code. */
  refused: number;
}

/**
 * Replays a recording tick by tick, handing every step's events to `observe` — the
 * same shape of loop the headless harness runs bots in, so the same statistics can be
 * gathered from people as from bots.
 *
 * A mismatch means the code or rules have changed since the match was recorded: the
 * ruleset and terrain are in the header, but the simulation itself is not, so a
 * recording is only exact against the code it was made with.
 */
export function replayRecording(
  lines: readonly RecordingLine[],
  observe: (state: MatchState, events: MatchEvent[]) => void = () => undefined,
): ReplayResult {
  const header = lines[0];
  if (header?.kind !== 'header') throw new Error('a recording starts with its header');
  const state = createMatch(matchOptionsOf(header));
  drainEvents(state);
  const hash = (): string => hashMatchState(state, hashVersionOf(header.format));
  const mismatches: number[] = [];
  let refused = 0;
  let end: RecordingEnd | null = null;

  const stepOnce = (): void => {
    step(state);
    observe(state, drainEvents(state));
  };

  for (const line of lines.slice(1)) {
    if (line.kind === 'end') {
      end = line;
      while (state.tick < line.t && state.phase !== 'game_over') stepOnce();
      if (hash() !== line.hash) mismatches.push(line.t);
      break;
    }
    if (line.kind !== 'tick') continue;
    while (state.tick < line.t && state.phase !== 'game_over') stepOnce();
    for (const action of line.a) {
      if (applyAction(state, action) !== null) refused++;
    }
    stepOnce();
    if (line.h !== undefined && hash() !== line.h) mismatches.push(line.t);
  }
  return { header, state, end, mismatches, refused };
}
