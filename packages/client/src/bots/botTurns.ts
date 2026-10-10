import { turnOrder, type Bot } from '@bollwerk/ai';
import { applyAction, type Action, type MatchState, type Rng } from '@bollwerk/sim';

/** The turns a call took, and where the tick's next one is, or null once all are taken. */
export interface TurnsTaken {
  /** The actions the rules accepted, in the order applied. */
  actions: Action[];
  next: number | null;
}

/**
 * The bots' turns on the tick in progress, in `turnOrder`, from turn `from`, each applied as
 * it is taken so the next bot sees the board it left — as `takeBotTurns` takes them, keeping
 * only what the rules accepted. Every local driver of bots goes through here: the page's
 * thread, the worker (`BotTable`) and the dev fast-forward, so they cannot drift apart.
 *
 * `stop` is asked before each turn, with how many this call has taken: true leaves the rest
 * for a later call, from `next`. `humanPlayer`'s seat is skipped, whatever bot `botOf` has
 * for it, as are the eliminated.
 */
export function botTurns(
  state: MatchState,
  rng: Rng,
  botOf: (player: number) => Bot | null | undefined,
  humanPlayer: number,
  from = 0,
  stop?: (taken: number) => boolean,
): TurnsTaken {
  const players = turnOrder(state.players, state.round);
  const actions: Action[] = [];
  let next = from;
  let taken = 0;
  while (next < players.length) {
    if (stop?.(taken) === true) return { actions, next };
    const player = players[next++] as (typeof players)[number];
    taken++;
    if (player.id === humanPlayer || player.eliminated) continue;
    const action = botOf(player.id)?.think(state, rng) ?? null;
    if (action !== null && applyAction(state, action) === null) actions.push(action);
  }
  return { actions, next: null };
}
