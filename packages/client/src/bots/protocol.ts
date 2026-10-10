import type { BotSetup } from '@bollwerk/config';
import type { Action, MatchOptions } from '@bollwerk/sim';

/**
 * What the page and the bots' worker say to each other (PLAN §11 item 3): plain data, as
 * structured clone carries it. Every message names the match it belongs to, a generation
 * counted by the page, so the one worker can serve match after match and an answer left
 * over from the last is dropped rather than taken for this one's.
 */

/** Raised whenever a message changes shape: a page and a worker from different builds. */
export const BOT_PROTOCOL_VERSION = 1;

/** A fresh match: the worker's mirror, made from the very options the page's state was. */
export interface InitMessage {
  type: 'init';
  version: number;
  match: number;
  options: MatchOptions;
  /** Each bot as the page dealt it (`dealSeats`), by player. */
  bots: { player: number; setup: BotSetup }[];
  humanPlayer: number;
  plansPerTick: number;
  rngSeed: number;
}

/**
 * The bots' turns on `tick`, after `before`: what the person did on it, in order, which the
 * page has applied already and the mirror must too.
 */
export interface TurnMessage {
  type: 'turn';
  version: number;
  match: number;
  tick: number;
  before: Action[];
}

export interface DisposeMessage {
  type: 'dispose';
  version: number;
  match: number;
}

export type ToWorker = InitMessage | TurnMessage | DisposeMessage;

/** The mirror is made; its hash, which must be the page's. */
export interface ReadyMessage {
  type: 'ready';
  version: number;
  match: number;
  hash: string;
}

/**
 * The bots' accepted actions on `tick`, in order, and — on the ticks a recording carries one
 * (`HASH_EVERY_TICKS`) — the mirror's hash once it was stepped.
 */
export interface TurnsMessage {
  type: 'turns';
  version: number;
  match: number;
  tick: number;
  actions: Action[];
  hash?: string;
}

/** The mirror could not follow: a refused `before`, or something thrown. */
export interface FailedMessage {
  type: 'failed';
  version: number;
  match: number;
  tick: number;
  message: string;
}

export type FromWorker = ReadyMessage | TurnsMessage | FailedMessage;
