import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { statsCsv, statsOfRecording } from '@bollwerk/analysis';
import type { ConfigBundle } from '@bollwerk/config';
import { RecordingLineSchema, parseRecording, type RecordingLine } from '@bollwerk/protocol';

/**
 * Match recordings on disk, one file per match (`<id>.jsonl`), for tuning the rules
 * against people. See `recording.ts` in the protocol for the format.
 *
 * Lines are appended as the match runs, so a match abandoned halfway, or a server
 * stopped mid-game, keeps everything up to that point. The server records its own rooms
 * directly; a browser playing a match on its own sends its lines here instead, since it
 * has no disk to write to.
 *
 * When a match ends its statistics are written beside it, `<id>.stats.csv`: the same
 * per-round table `--replay` produces, by the same replay, so nothing has to be run by
 * hand after a session. An abandoned match has no end and gets none; `--replay` still
 * reads it.
 */
export class RecordingStore {
  constructor(
    private readonly dir: string,
    private readonly maxUploadBytes: number,
    /** The rules the statistics are measured by; the recording carries its own ruleset. */
    private readonly bundle: ConfigBundle,
    /** Where to say that a statistics file was written, or why not. */
    private readonly log: (message: string) => void = () => undefined,
    /** The code this server runs, stamped into every header it writes; see `version.ts`. */
    private readonly commit: string | null = null,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /**
   * Replays a finished match into its statistics. Deferred to after the current turn of
   * the event loop, so the step that ended the match — and its broadcast — go first;
   * the replay itself takes a fraction of a second.
   */
  private finish(id: string): void {
    setImmediate(() => {
      try {
        const lines = parseRecording(readFileSync(join(this.dir, `${id}.jsonl`), 'utf8'));
        const { rows, replay } = statsOfRecording(this.bundle, lines);
        writeFileSync(join(this.dir, `${id}.stats.csv`), statsCsv(rows), 'utf8');
        const exact = replay.mismatches.length === 0 && replay.refused === 0;
        this.log(
          `recording ${id}: ${rows.length} statistics row(s)` +
            (exact ? '' : ' — the replay DIVERGED from the match, so these are not to be trusted'),
        );
      } catch (error) {
        this.log(`recording ${id}: no statistics (${String(error).slice(0, 120)})`);
      }
    });
  }

  /** A header as this server writes it: carrying its code, whatever it said before. */
  private stamped(line: RecordingLine): RecordingLine {
    if (line.kind !== 'header') return line;
    const { commit: _claimed, ...rest } = line;
    return this.commit === null ? rest : { ...rest, commit: this.commit };
  }

  /** A writer for one match: the header names the file, every later line joins it. */
  writer(): (line: RecordingLine) => void {
    let id: string | null = null;
    return (given) => {
      const line = this.stamped(given);
      if (line.kind === 'header') id = line.id;
      if (id === null) return;
      appendFileSync(join(this.dir, `${id}.jsonl`), `${JSON.stringify(line)}\n`);
      if (line.kind === 'end') this.finish(id);
    };
  }

  /**
   * Lines a browser sent for its own match. Refused whole unless every line is a valid
   * recording line, the first a header naming this id when the file does not exist yet,
   * and no later one another header — nothing but recordings gets written, and nothing
   * lands in a file that another match began.
   */
  upload(id: string, body: string): { ok: true } | { ok: false; reason: string } {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, reason: 'bad id' };
    if (Buffer.byteLength(body) > this.maxUploadBytes) return { ok: false, reason: 'too large' };
    const lines: RecordingLine[] = [];
    try {
      for (const text of body.split('\n')) {
        if (text.trim() === '') continue;
        const parsed = RecordingLineSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return { ok: false, reason: 'not a recording line' };
        lines.push(this.stamped(parsed.data));
      }
    } catch {
      return { ok: false, reason: 'not JSON' };
    }
    const file = join(this.dir, `${id}.jsonl`);
    const exists = existsSync(file);
    for (const [i, line] of lines.entries()) {
      const opens = !exists && i === 0;
      if (line.kind === 'header' && (!opens || line.id !== id)) {
        return { ok: false, reason: 'misplaced header' };
      }
      if (opens && line.kind !== 'header') return { ok: false, reason: 'no header' };
    }
    if (lines.length > 0) {
      appendFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    }
    if (lines.some((line) => line.kind === 'end')) this.finish(id);
    return { ok: true };
  }
}

/**
 * The store, or null with a warning when its folder cannot be made — the server runs on
 * without recording rather than not at all. A recording is never worth a game server:
 * the deployment image once crashed at start-up because it runs as an unprivileged user
 * who could not create `recordings/` in a directory owned by root (ARCHIVE 11e).
 */
export function openRecordingStore(
  dir: string,
  maxUploadBytes: number,
  bundle: ConfigBundle,
  log: (message: string) => void,
  commit: string | null = null,
): RecordingStore | null {
  try {
    return new RecordingStore(dir, maxUploadBytes, bundle, log, commit);
  } catch (error) {
    log(`recordings disabled: cannot use ${dir} (${String(error).slice(0, 120)})`);
    return null;
  }
}
