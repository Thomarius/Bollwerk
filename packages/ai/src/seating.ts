import type { BotSetup, Personality } from '@bollwerk/config';
import {
  applyAction,
  seatOrder,
  type Action,
  type MatchState,
  type Rejection,
  type Rng,
} from '@bollwerk/sim';

import type { Bot } from './bot.js';
import { dealPersonalities } from './personality.js';
import { turnOrder } from './planning.js';

/**
 * How a table becomes a match, the same wherever one starts — a room, a local table, the
 * end screen working out who played whom: which player, and so which island, each seat
 * becomes, and each bot's level with a personality dealt from the seed.
 */

/** A seat as the table had it: the level its bot plays at, and whether a bot holds it. */
export interface TableSeat {
  /** Null for a seat that has no bot at all — a person's, offline. */
  level: number | null;
  bot: boolean;
}

export interface DealtSeats {
  /** The player each seat becomes, by seat (`seatOrder`). */
  playerOfSeat: number[];
  /**
   * Each player's bot, by player: its level and the personality dealt it. Null for a seat
   * with no level. Personalities are dealt over who is a bot, so a person's seat changes
   * the deal, and a seat a person holds online still gets a bot to cover them if they drop.
   */
  setups: (BotSetup | null)[];
}

export function dealSeats(seed: number, seats: readonly TableSeat[]): DealtSeats {
  const playerOfSeat = seatOrder(seed, seats.length);
  const isBot = new Array<boolean>(seats.length);
  seats.forEach((seat, index) => {
    isBot[playerOfSeat[index] as number] = seat.bot;
  });
  const personalities = dealPersonalities(seed, isBot);
  const setups = new Array<BotSetup | null>(seats.length).fill(null);
  seats.forEach((seat, index) => {
    const player = playerOfSeat[index] as number;
    if (seat.level !== null) {
      setups[player] = { level: seat.level, personality: personalities[player] as Personality };
    }
  });
  return { playerOfSeat, setups };
}

/** One bot's turn as it went: what it asked for, and whether the rules refused it. */
export interface BotTurn {
  action: Action;
  rejection: Rejection | null;
}

/**
 * The bots' turns on a tick, in `turnOrder`, each applied as it is taken so the next bot
 * sees the board it left. `botOf` says whose bot plays: none for a person at the keys.
 * Every driver of bots takes its turns so — a room, the harness, a local match fast
 * forwarded — and `LocalMatch` in the same order, spread over frames.
 */
export function takeBotTurns(
  state: MatchState,
  rng: Rng,
  botOf: (player: number) => Bot | null | undefined,
): BotTurn[] {
  const turns: BotTurn[] = [];
  for (const player of turnOrder(state.players, state.round)) {
    const action = botOf(player.id)?.think(state, rng) ?? null;
    if (action !== null) turns.push({ action, rejection: applyAction(state, action) });
  }
  return turns;
}
