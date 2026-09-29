import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfigBundle } from '@rampart/config';
import { parseRecording, replayRecording, type RecordingLine } from '@rampart/protocol';
import { describe, expect, it } from 'vitest';

import { Room, type Connection } from './room.js';
import { RecordingStore, openRecordingStore } from './recordings.js';
import { codeVersion } from './version.js';

function room(record: (line: RecordingLine) => void): Room {
  return new Room({
    code: 'REC123',
    hostName: 'host',
    playerCount: 3,
    ruleset: defaultConfigBundle.ruleset,
    terrain: defaultConfigBundle.terrain,
    server: defaultConfigBundle.server,
    ai: defaultConfigBundle.ai,
    seed: 9,
    record,
  });
}

const silent: Connection = { id: 'c0', send: () => undefined, close: () => undefined };

describe('recording a room’s match', () => {
  it('replays to exactly the match the room ran', () => {
    const lines: RecordingLine[] = [];
    const r = room((line) => lines.push(line));
    // A person who never acts beside two bots: a mixed table, the person's seat recorded
    // as a person's.
    r.join(silent, 'Ada');
    r.start();
    const tickMs = 1000 / defaultConfigBundle.ruleset.tickRateHz;
    for (let i = 0; i < 3000; i++) r.update(tickMs);

    const header = lines[0];
    expect(header?.kind === 'header' && header.source).toBe('server');
    expect(header?.kind === 'header' && header.code).toBe('REC123');
    expect(header?.kind === 'header' && header.players.map((p) => p.difficulty === null)).toContain(
      true,
    );
    const replay = replayRecording(lines);
    expect(replay.refused).toBe(0);
    expect(replay.mismatches).toEqual([]);
    expect(lines.filter((l) => l.kind === 'tick' && l.h !== undefined).length).toBeGreaterThan(50);
  });

  it('records nothing before the match starts, and nothing without a writer', () => {
    const lines: RecordingLine[] = [];
    const r = room((line) => lines.push(line));
    r.join(silent, 'Ada');
    expect(lines).toEqual([]);
  });
});

describe('the recording store', () => {
  const header = (id: string): RecordingLine => ({
    kind: 'header',
    format: 1,
    id,
    source: 'local',
    startedAt: '2026-09-27T10:00:00.000Z',
    code: null,
    seed: 1,
    ruleset: defaultConfigBundle.ruleset,
    terrain: defaultConfigBundle.terrain,
    players: [{ name: 'You', isBot: false, team: 0, difficulty: null }],
  });
  const body = (...lines: RecordingLine[]): string =>
    lines.map((l) => JSON.stringify(l)).join('\n');
  const tick = (t: number): RecordingLine => ({ kind: 'tick', t, a: [] });

  it('keeps what a browser sends, a few lines at a time, in one file per match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle);
    const id = '20260927-100000-local-abc123';
    expect(store.upload(id, body(header(id), tick(1)))).toEqual({ ok: true });
    expect(store.upload(id, body(tick(5), tick(9)))).toEqual({ ok: true });
    const lines = parseRecording(readFileSync(join(dir, `${id}.jsonl`), 'utf8'));
    expect(lines.map((l) => l.kind)).toEqual(['header', 'tick', 'tick', 'tick']);
  });

  it('stamps every header with the code it runs, whatever the browser claimed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle, undefined, 'abc123def456');
    const uploaded = '20260927-100000-local-stamp1';
    const claimed = { ...header(uploaded), commit: 'whatever-the-page-said' } as RecordingLine;
    expect(store.upload(uploaded, body(claimed, tick(1))).ok).toBe(true);
    const own = '20260927-100000-server-stamp2';
    const write = store.writer();
    write(header(own));
    write(tick(1));
    for (const id of [uploaded, own]) {
      const first = parseRecording(readFileSync(join(dir, `${id}.jsonl`), 'utf8'))[0];
      expect(first?.kind === 'header' && first.commit).toBe('abc123def456');
    }
  });

  it('writes no commit it does not know, and still reads recordings made without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle);
    const id = '20260927-100000-local-nocode';
    const claimed = { ...header(id), commit: 'a-browser-guess' } as RecordingLine;
    expect(store.upload(id, body(claimed)).ok).toBe(true);
    const first = parseRecording(readFileSync(join(dir, `${id}.jsonl`), 'utf8'))[0];
    expect(first?.kind === 'header' && 'commit' in first).toBe(false);
  });

  it('refuses anything that is not a recording, or would not start one properly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle);
    const id = '20260927-100000-local-def456';
    expect(store.upload('../../etc/passwd', body(header(id))).ok).toBe(false);
    expect(store.upload(id, 'not json').ok).toBe(false);
    expect(store.upload(id, JSON.stringify({ kind: 'tick', t: -1, a: [] })).ok).toBe(false);
    // A file must open with its own header, and never take a second one.
    expect(store.upload(id, body(tick(1))).ok).toBe(false);
    expect(store.upload(id, body(header('20260927-100000-local-other1'))).ok).toBe(false);
    expect(store.upload(id, body(header(id))).ok).toBe(true);
    expect(store.upload(id, body(header(id))).ok).toBe(false);
    expect(new RecordingStore(dir, 10, defaultConfigBundle).upload(id, body(tick(1))).ok).toBe(
      false,
    );
  });

  it('writes a room’s lines to the file its header names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle);
    const r = room(store.writer());
    r.join(silent, 'Ada');
    r.start();
    const tickMs = 1000 / defaultConfigBundle.ruleset.tickRateHz;
    for (let i = 0; i < 200; i++) r.update(tickMs);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-\d{6}-server-REC123\.jsonl$/);
    const lines = parseRecording(readFileSync(join(dir, files[0] as string), 'utf8'));
    const replay = replayRecording(lines);
    expect(replay.mismatches).toEqual([]);
    expect(replay.refused).toBe(0);
  });

  it('writes the finished match’s statistics beside it, without being asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const store = new RecordingStore(dir, 1 << 20, defaultConfigBundle);
    // A short cap, so the match ends quickly.
    const ruleset = {
      ...defaultConfigBundle.ruleset,
      scoring: { ...defaultConfigBundle.ruleset.scoring, maxRounds: 1 },
    };
    const r = new Room({
      code: 'END123',
      hostName: 'host',
      playerCount: 2,
      ruleset,
      terrain: defaultConfigBundle.terrain,
      server: defaultConfigBundle.server,
      ai: defaultConfigBundle.ai,
      seed: 4,
      record: store.writer(),
    });
    r.join(silent, 'Ada');
    r.handle(silent, { type: 'configure', hostBot: 'gunner' });
    r.start();
    const tickMs = 1000 / defaultConfigBundle.ruleset.tickRateHz;
    for (let i = 0; i < 20000 && !r.finished; i++) r.update(tickMs);
    expect(r.finished).toBe(true);
    // Written after the step that ended the match has gone out.
    expect(readdirSync(dir).some((f) => f.endsWith('.stats.csv'))).toBe(false);
    await new Promise((done) => setImmediate(done));
    const csv = readdirSync(dir).find((f) => f.endsWith('.stats.csv'));
    expect(csv).toMatch(/^\d{8}-\d{6}-server-END123\.stats\.csv$/);
    const rows = readFileSync(join(dir, csv as string), 'utf8')
      .trim()
      .split('\n');
    expect(rows[0]).toMatch(/^match,seed,round,player,difficulty,/);
    // A row per player per round, two players: the lobby's bounds lift the cap to its
    // minimum, so how many rounds that is is the lobby's business, not this test's.
    const body = rows.slice(1);
    expect(body.length).toBeGreaterThan(0);
    expect(body.length % 2).toBe(0);
    expect(body.every((row) => row.includes(',gunner,'))).toBe(true);
    // A whole bot match: about 3.5 s alone, and past the default 5 s in a full run beside
    // the soak tests on a slower machine, where it failed twice in four runs.
  }, 20_000);

  it('runs on without recording when its folder cannot be made, rather than crash', () => {
    // Beneath a plain file, which no user can make a directory in — not even root, so
    // this holds wherever the tests run. The image once died at start-up on exactly
    // this, as an unprivileged user in a directory owned by root.
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    writeFileSync(join(dir, 'file'), '');
    const said: string[] = [];
    const store = openRecordingStore(
      join(dir, 'file', 'recordings'),
      1 << 20,
      defaultConfigBundle,
      (m) => said.push(m),
    );
    expect(store).toBeNull();
    expect(said[0]).toMatch(/^recordings disabled/);
  });
});

describe('the code version', () => {
  it('is what the image was built with, when it says', () => {
    expect(codeVersion('/nonexistent', { RAMPART_COMMIT: ' 0123abcd ' })).toBe('0123abcd');
  });

  it('is unknown rather than an error where there is no repository to ask', () => {
    expect(codeVersion(tmpdir(), {})).toBeNull();
  });
});
