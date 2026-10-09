import type { BotSetup, Personality, TerrainConfig } from '@bollwerk/config';
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
  /**
   * A personality the table gives this seat's bot rather than one dealt from the seed — a
   * tournament's bots keep theirs from match to match (TOURNAMENT §1.1).
   */
  personality?: Personality | null;
  /** The seat's team label; omitted, the seat is a team of its own. */
  team?: number;
}

export interface DealtSeats {
  /** The player each seat becomes, by seat (`seatOrder`). */
  playerOfSeat: number[];
  /**
   * Each player's bot, by player: its level and the personality dealt it, or the one the
   * table gave it. Null for a seat with no level. Personalities are dealt over who is a bot,
   * so a person's seat changes the deal, and a seat a person holds online still gets a bot
   * to cover them if they drop. A given personality replaces the one dealt and moves no
   * other seat's: the deal is made for every seat as if none were given.
   */
  setups: (BotSetup | null)[];
}

export function dealSeats(
  seed: number,
  seats: readonly TableSeat[],
  terrain: TerrainConfig,
): DealtSeats {
  // Teams of two at three or four teams are dealt onto a fair layout (`seatOrder`).
  const playerOfSeat = seatOrder(
    seed,
    seats.map((seat, index) => seat.team ?? index),
    terrain,
  );
  const isBot = new Array<boolean>(seats.length);
  seats.forEach((seat, index) => {
    isBot[playerOfSeat[index] as number] = seat.bot;
  });
  const personalities = dealPersonalities(seed, isBot);
  const setups = new Array<BotSetup | null>(seats.length).fill(null);
  seats.forEach((seat, index) => {
    const player = playerOfSeat[index] as number;
    if (seat.level !== null) {
      const personality = seat.personality ?? (personalities[player] as Personality);
      setups[player] = { level: seat.level, personality };
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
