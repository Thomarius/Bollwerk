import {
  offeredVariants,
  type BotSetup,
  type Personality,
  type Specials,
  type TerrainConfig,
  type TowerVariant,
} from '@bollwerk/config';
import {
  applyAction,
  seatOrder,
  streamFor,
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
  /**
   * The special tower a person in this seat chose, at its cost, or null for none. A bot's
   * seat — `bot` true — ignores it and brings the tower drawn for it (`drawnSpecial`).
   */
  special?: TowerVariant | null;
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
  /**
   * Each player's special tower, by player: a person's choice, a bot's draw. Read only
   * where the match plays towers; `createMatch` drops them otherwise.
   */
  specials: (TowerVariant | null)[];
}

/**
 * The special tower a bot in this seat brings: drawn from the seed and the seat among the
 * variants the ruleset offers, every tower at each of its costs, never none (the user's
 * decision, 2026-10-14). By seat, not by player, so the lobby can show it before the seats
 * are dealt their islands — the seed is fixed when the table is set.
 */
export function drawnSpecial(seed: number, seat: number, specials: Specials): TowerVariant {
  const variants = offeredVariants(specials);
  return variants[streamFor(seed, `special:${seat}`).nextInt(variants.length)] as TowerVariant;
}

export function dealSeats(
  seed: number,
  seats: readonly TableSeat[],
  terrain: TerrainConfig,
  /** The ruleset's towers, which a bot draws its own from. */
  specials: Specials,
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
  const loadouts = new Array<TowerVariant | null>(seats.length).fill(null);
  seats.forEach((seat, index) => {
    const player = playerOfSeat[index] as number;
    loadouts[player] = seat.bot ? drawnSpecial(seed, index, specials) : (seat.special ?? null);
    if (seat.level !== null) {
      const personality = seat.personality ?? (personalities[player] as Personality);
      setups[player] = { level: seat.level, personality };
    }
  });
  return { playerOfSeat, setups, specials: loadouts };
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
