import { replayRecording, type RecordingLine } from '@bollwerk/protocol';
import { Rng, type Action } from '@bollwerk/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalMatch, type LocalMatchOptions } from '../localMatch.js';
import { BotTable } from './botTable.js';
import type { FromWorker, ToWorker } from './protocol.js';
import type { BotTransport, WorkerTiming } from './workerDriver.js';

/**
 * A worker as the tests have one: a `BotTable` behind timers, each message delivered after
 * a seeded random delay, in the order sent, as a real worker's are.
 */
class TimerTransport implements BotTransport {
  readonly table = new BotTable();
  readonly sent: ToWorker[] = [];
  terminated = false;
  /** Rewrites an answer on its way, to make a worker go wrong. */
  tamper: (message: FromWorker) => FromWorker | null = (message) => message;
  private heard: (message: FromWorker) => void = () => undefined;
  private toWorkerAt = 0;
  private toPageAt = 0;

  constructor(
    private readonly rng: Rng,
    private readonly maxDelayMs = 25,
  ) {}

  post(message: ToWorker): void {
    const copy = structuredClone(message);
    this.sent.push(copy);
    this.toWorkerAt = this.after(this.toWorkerAt);
    setTimeout(() => {
      if (this.terminated) return;
      const answer = this.table.handle(copy);
      if (answer === null) return;
      this.toPageAt = this.after(this.toPageAt);
      setTimeout(() => {
        const tampered = this.terminated ? null : this.tamper(structuredClone(answer));
        if (tampered !== null) this.heard(tampered);
      }, this.toPageAt - Date.now());
    }, this.toWorkerAt - Date.now());
  }

  listen(onMessage: (message: FromWorker) => void): void {
    this.heard = onMessage;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** A delivery time, never before the last one: a worker's messages keep their order. */
  private after(last: number): number {
    return Math.max(last, Date.now() + this.rng.nextInt(this.maxDelayMs + 1));
  }
}

const FRAME_MS = 1000 / 60;

/** Frames of a match, the timers run between them for a frame's time. */
function play(match: LocalMatch, untilTick: number, each?: () => void): void {
  for (let frame = 0; frame < 20 * untilTick && match.state.tick < untilTick; frame++) {
    match.advance(FRAME_MS);
    each?.();
    vi.advanceTimersByTime(FRAME_MS);
  }
}

function recorded(options: LocalMatchOptions): { match: LocalMatch; lines: RecordingLine[] } {
  const lines: RecordingLine[] = [];
  const match = new LocalMatch({ ...options, record: (line) => lines.push(line) });
  return { match, lines };
}

/** The ticks' lines before `tick`: two runs stopped a few ticks apart compare on these. */
const ticksBefore = (lines: RecordingLine[], tick: number): RecordingLine[] =>
  lines.filter((line) => line.kind === 'tick' && line.t < tick);

describe('the bots in a worker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('play the very match the page’s thread plays, action for action', () => {
    const TICKS = 3000;
    const thread = recorded({ seed: 7, seats: [4, 6, 8] });
    while (thread.match.state.tick < TICKS) thread.match.advance(FRAME_MS);

    const transport = new TimerTransport(new Rng(1));
    const worker = recorded({ seed: 7, seats: [4, 6, 8], worker: transport });
    expect(worker.match.inWorker).toBe(true);
    play(worker.match, TICKS);
    expect(worker.match.inWorker).toBe(true);
    expect(worker.match.state.tick).toBeGreaterThanOrEqual(TICKS);

    const expected = ticksBefore(thread.lines, TICKS);
    // Built and fought over, and hashed every 30 ticks: the states, not only the actions.
    expect(expected.length).toBeGreaterThan(100);
    expect(ticksBefore(worker.lines, TICKS)).toEqual(expected);
  });

  it('take the person’s moves made while a turn is out on the next tick', () => {
    const transport = new TimerTransport(new Rng(2));
    const { match, lines } = recorded({ seed: 11, seats: [null, 5, 2], worker: transport });
    const rng = new Rng(9);
    const me = match.humanPlayer;
    let tried = 0;
    // Clicks between frames, most of them refused, as a hurried person's are.
    play(match, 2500, () => {
      const state = match.state;
      const x = rng.nextInt(state.width);
      const y = rng.nextInt(state.height);
      const castle = state.castles.find((c) => c.islandId === state.players[me]?.islandId);
      const moves: Action[] = [
        { kind: 'select_castle', player: me, castleId: castle?.id ?? 0 },
        { kind: 'place_cannon', player: me, x, y },
        { kind: 'place_piece', player: me, rotation: rng.nextInt(4), x, y },
        { kind: 'fire', player: me, x, y },
      ];
      for (const move of moves) {
        match.submit(move);
        tried++;
      }
    });
    expect(match.inWorker).toBe(true);
    expect(tried).toBeGreaterThan(1000);
    const mine = lines
      .flatMap((l) => (l.kind === 'tick' ? l.a : []))
      .filter((a) => a.player === me);
    expect(mine.length).toBeGreaterThan(10);
    const replay = replayRecording(lines);
    expect(replay.refused).toBe(0);
    expect(replay.mismatches).toEqual([]);
  });

  it('never draw the match going backwards while a turn is out', () => {
    // What a frame draws is the tick and the way into it: shots and banners move by it. A
    // frame drawn with a turn out once showed the tick before at the start, not its end.
    const drawnTimes = (match: LocalMatch, advance: () => void): number[] => {
      const times: number[] = [];
      while (match.state.tick < 600) {
        advance();
        times.push(match.state.tick + match.tickFraction);
      }
      return times;
    };
    const worker = new LocalMatch({
      seed: 7,
      seats: [4, 6],
      worker: new TimerTransport(new Rng(8)),
    });
    const thread = new LocalMatch({ seed: 7, seats: [4, 6], thinkBudgetMs: 0 });
    for (const times of [
      drawnTimes(worker, () => {
        worker.advance(FRAME_MS);
        vi.advanceTimersByTime(FRAME_MS);
      }),
      drawnTimes(thread, () => thread.advance(FRAME_MS)),
    ]) {
      const back = times.filter((time, i) => i > 0 && time < (times[i - 1] as number));
      expect(back).toEqual([]);
    }
  });

  it('send no turn while the match is paused', () => {
    const transport = new TimerTransport(new Rng(3));
    const match = new LocalMatch({ seed: 5, seats: [3, 3], worker: transport });
    play(match, 100);
    match.halted = true;
    // The turn out, if any, still lands; nothing after it.
    vi.advanceTimersByTime(1000);
    const tick = match.state.tick;
    for (let frame = 0; frame < 200; frame++) {
      match.advance(FRAME_MS);
      vi.advanceTimersByTime(FRAME_MS);
    }
    expect(match.state.tick).toBe(tick);
    match.halted = false;
    play(match, tick + 50);
    expect(match.state.tick).toBeGreaterThanOrEqual(tick + 50);
  });

  it('drop an answer that comes after the match was disposed', () => {
    const transport = new TimerTransport(new Rng(4), 50);
    const match = new LocalMatch({ seed: 5, seats: [3, 3], worker: transport });
    play(match, 40);
    match.advance(FRAME_MS * 3);
    const tick = match.state.tick;
    match.dispose();
    vi.advanceTimersByTime(1000);
    expect(match.state.tick).toBe(tick);
    expect(transport.sent.at(-1)?.type).toBe('dispose');
    // A new match on the same worker is a new generation, and plays.
    const next = new LocalMatch({ seed: 6, seats: [3, 3], worker: transport });
    play(next, 40);
    expect(next.inWorker).toBe(true);
    expect(next.state.tick).toBeGreaterThanOrEqual(40);
  });
});

describe('a worker that fails', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const timing: WorkerTiming = { readyMs: 3000, answerMs: 2000, now: () => Date.now() };

  it('never ready: the thread plays from tick 0, the very match', () => {
    const thread = recorded({ seed: 7, seats: [4, 6] });
    while (thread.match.state.tick < 600) thread.match.advance(FRAME_MS);

    const transport = new TimerTransport(new Rng(5));
    transport.tamper = (message) => (message.type === 'ready' ? null : message);
    const silent = recorded({ seed: 7, seats: [4, 6], worker: transport, workerTiming: timing });
    play(silent.match, 600);
    expect(silent.match.inWorker).toBe(false);
    expect(transport.terminated).toBe(true);
    expect(ticksBefore(silent.lines, 600)).toEqual(ticksBefore(thread.lines, 600));
  });

  it('diverging mid-match: the thread takes over, and the recording stays exact', () => {
    const transport = new TimerTransport(new Rng(6));
    transport.tamper = (message) =>
      message.type === 'turns' && message.tick === 900 ? { ...message, hash: 'wrong' } : message;
    const { match, lines } = recorded({
      seed: 7,
      seats: [null, 4, 6],
      worker: transport,
      workerTiming: timing,
    });
    play(match, 1500);
    expect(match.inWorker).toBe(false);
    expect(match.state.tick).toBeGreaterThanOrEqual(1500);
    const replay = replayRecording(lines);
    expect(replay.refused).toBe(0);
    expect(replay.mismatches).toEqual([]);
  });

  it('gone quiet mid-turn: the thread takes the tick over', () => {
    const transport = new TimerTransport(new Rng(7));
    transport.tamper = (message) =>
      message.type === 'turns' && message.tick === 300 ? null : message;
    const { match, lines } = recorded({
      seed: 7,
      seats: [4, 6],
      worker: transport,
      workerTiming: timing,
    });
    play(match, 600);
    expect(match.inWorker).toBe(false);
    expect(match.state.tick).toBeGreaterThanOrEqual(600);
    const replay = replayRecording(lines);
    expect(replay.refused).toBe(0);
    expect(replay.mismatches).toEqual([]);
  });
});
