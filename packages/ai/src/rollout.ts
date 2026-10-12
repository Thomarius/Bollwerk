import { applyAction, step, type MatchState, type Rng, type RoundResult } from '@bollwerk/sim';

import { type Builder } from './building.js';

/**
 * A build phase played out before it is played (BUILD_PLANNING.md, step 1).
 *
 * A bot's build phase depends on nothing but its own island, its pieces and its pace: no
 * shot lands in it (the intermission before it waits for the last), the pieces are a pure
 * function of the seed, and nobody else builds on a bot's island unless a person teammate
 * does. So a copy of the match, stepped with this bot's actions alone, ends the phase as the
 * match will — and the rules' own resolution scores it, so the outcome cannot disagree with
 * the game.
 */

/** A piece laid in a rollout: where, and on which tick. */
export interface Placement {
  tick: number;
  x: number;
  y: number;
  rotation: number;
}

export interface Rollout {
  /** The pieces laid, in order. */
  placements: Placement[];
  /** This player's resolution of the round, or null if the match ended without one. */
  result: RoundResult | null;
  /** The copy of the match after the resolution: the wall swept, the guns rewarded. */
  board: MatchState;
}

/**
 * Plays `builder` through the coming or current build phase on a copy of `state`, from its
 * first tick or from the intermission before it, once no shot is left in the air.
 *
 * Every other player is out of the match in the copy: they lay nothing in it, so a teammate
 * would fail there who will not in the match, and spend the team's life this player's
 * failure would have spent. Out, they share nothing with this player's outcome.
 */
export function rollOutBuild(
  state: MatchState,
  playerId: number,
  builder: Builder,
  rng: Rng,
): Rollout | null {
  const before = state.phase === 'intermission' && state.pendingPhase === 'build';
  if (!before && state.phase !== 'build') return null;
  if (state.shots.length > 0) return null;

  const board = copyOf(state);
  for (const player of board.players) {
    if (player.id !== playerId) player.eliminated = true;
  }
  while (board.phase === 'intermission') step(board);

  const placements: Placement[] = [];
  while (board.phase === 'build') {
    const action = builder.build(board, rng);
    if (action?.kind === 'place_piece' && applyAction(board, action) === null) {
      placements.push({
        tick: board.tick,
        x: action.x,
        y: action.y,
        rotation: action.rotation,
      });
    }
    step(board);
  }

  let result: RoundResult | null = null;
  for (const event of board.events) {
    if (event.kind !== 'round_resolved') continue;
    result = event.results.find((r) => r.player === playerId) ?? null;
  }
  return { placements, result, board };
}

/**
 * A copy of the match a rollout may change: what a build phase and its resolution write,
 * copied; the terrain and the rules, which nothing writes, shared.
 */
function copyOf(state: MatchState): MatchState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    teams: state.teams.map((t) => ({ ...t })),
    structure: state.structure.slice(),
    owner: state.owner.slice(),
    territory: state.territory.slice(),
    castles: state.castles.map((c) => ({ ...c })),
    cannons: state.cannons.map((c) => ({ ...c })),
    shots: state.shots.map((s) => ({ ...s })),
    winners: [...state.winners],
    events: [],
  };
}
