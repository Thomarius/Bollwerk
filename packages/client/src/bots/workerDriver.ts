import type { Action } from '@bollwerk/sim';

import type { BotDriver } from './driver.js';
import {
  BOT_PROTOCOL_VERSION,
  type FromWorker,
  type InitMessage,
  type ToWorker,
} from './protocol.js';

/**
 * The way to the bots' worker: a real `Worker` in the page (`botWorkerTransport.ts`), a
 * `BotTable` behind timers in the tests.
 */
export interface BotTransport {
  post(message: ToWorker): void;
  /** Whoever uses the worker now hears it; the last listener is replaced. */
  listen(onMessage: (message: FromWorker) => void, onError: (reason: string) => void): void;
  /** After a failure: this worker is done with, and the next match makes another. */
  terminate(): void;
}

/** What a `WorkerDriver` hands back to the match it drives. */
export interface WorkerHost {
  /** The bots' accepted actions on the tick out, in order, for the host to apply and step. */
  answered(actions: Action[], hash: string | undefined): void;
  /** The worker cannot go on, or never came: the host goes on without it. */
  failed(reason: string): void;
}

export interface WorkerTiming {
  /** How long a fresh worker may take to say it is ready, before the thread takes over. */
  readyMs: number;
  /** How long one turn may stay out. */
  answerMs: number;
  now: () => number;
}

/**
 * Milliseconds, and frames too, before a quiet worker is given up: a page that was itself
 * blocked for the whole wait has not yet had the chance to hear it.
 */
export const DEFAULT_TIMING: WorkerTiming = {
  readyMs: 3000,
  answerMs: 2000,
  now: () => performance.now(),
};
const MIN_FRAMES_WAITED = 4;

/** Each match the page drives gets the next; an answer naming another is dropped. */
let generation = 0;

/**
 * The bots in a worker, in lockstep with the page (PLAN §11 item 3): the page sends a tick's
 * turn with the person's moves on it, the worker answers with the bots' actions, and only
 * then does the page step — the bots playing action for action as they would on the
 * page's thread, while the screen goes on drawing.
 */
export class WorkerDriver implements BotDriver {
  readonly match = ++generation;
  private ready = false;
  private out: { tick: number; sentAt: number; frames: number } | null = null;
  private readonly startedAt: number;
  private framesWaited = 0;
  private done = false;

  constructor(
    private readonly transport: BotTransport,
    private readonly host: WorkerHost,
    init: Omit<InitMessage, 'type' | 'version' | 'match'>,
    /** The page's fresh state's hash, which the mirror's must be. */
    private readonly readyHash: string,
    /** The tick the page is on, read when a turn is sent. */
    private readonly tick: () => number,
    private readonly timing: WorkerTiming = DEFAULT_TIMING,
  ) {
    this.startedAt = timing.now();
    transport.listen(
      (message) => this.heard(message),
      (reason) => this.fail(reason),
    );
    transport.post({ type: 'init', version: BOT_PROTOCOL_VERSION, match: this.match, ...init });
  }

  get idle(): boolean {
    return this.ready && this.out === null && !this.done;
  }

  turns(before: readonly Action[]): boolean {
    const tick = this.tick();
    this.out = { tick, sentAt: this.timing.now(), frames: 0 };
    this.transport.post({
      type: 'turn',
      version: BOT_PROTOCOL_VERSION,
      match: this.match,
      tick,
      before: [...before],
    });
    return false;
  }

  frame(): void {
    if (this.done) return;
    const now = this.timing.now();
    if (!this.ready) {
      this.framesWaited++;
      if (now - this.startedAt > this.timing.readyMs && this.framesWaited >= MIN_FRAMES_WAITED) {
        this.fail('the worker never said it was ready');
      }
    } else if (this.out !== null) {
      this.out.frames++;
      if (now - this.out.sentAt > this.timing.answerMs && this.out.frames >= MIN_FRAMES_WAITED) {
        this.fail(`no answer for tick ${this.out.tick}`);
      }
    }
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    this.transport.post({ type: 'dispose', version: BOT_PROTOCOL_VERSION, match: this.match });
  }

  private heard(message: FromWorker): void {
    // Another match's, or this one's after it ended: nothing to do with what is played now.
    if (this.done || message.match !== this.match) return;
    if (message.version !== BOT_PROTOCOL_VERSION) {
      this.fail(`the worker speaks protocol ${message.version}`);
      return;
    }
    switch (message.type) {
      case 'ready':
        if (this.ready) return;
        if (message.hash !== this.readyHash) {
          this.fail('the mirror is not the page’s match');
          return;
        }
        this.ready = true;
        return;
      case 'turns':
        if (this.out === null || message.tick !== this.out.tick) return;
        this.out = null;
        this.host.answered(message.actions, message.hash);
        return;
      case 'failed':
        this.fail(message.message);
        return;
    }
  }

  private fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.transport.terminate();
    this.host.failed(reason);
  }
}
