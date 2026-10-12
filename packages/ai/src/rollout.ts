import { applyAction, step, type MatchState, type Rng, type RoundResult } from '@bollwerk/sim';

import { type Builder, type Strategy } from './building.js';

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
 */
export function rollOutBuild(
  state: MatchState,
  playerId: number,
  builder: Builder,
  rng: Rng,
): Rollout | null {
  const run = RolloutRun.start(state, playerId, builder, rng);
  if (run === null) return null;
  while (run.advance() === 'placed');
  return run.outcome();
}

/**
 * A rollout that can be advanced a piece at a time, so its work can be spread over ticks,
 * and branched where its builder halts (`Builder.halted`), so strategies sharing a start
 * play it once.
 *
 * Every other player is out of the match in the copy: they lay nothing in it, so a teammate
 * would fail there who will not in the match, and spend the team's life this player's
 * failure would have spent. Out, they share nothing with this player's outcome.
 */
export class RolloutRun {
  private constructor(
    private readonly board: MatchState,
    private readonly playerId: number,
    readonly builder: Builder,
    private readonly rng: Rng,
    readonly placements: Placement[],
  ) {}

  static start(state: MatchState, playerId: number, builder: Builder, rng: Rng): RolloutRun | null {
    const before = state.phase === 'intermission' && state.pendingPhase === 'build';
    if (!before && state.phase !== 'build') return null;
    if (state.shots.length > 0) return null;
    const board = copyOf(state);
    for (const player of board.players) {
      if (player.id !== playerId) player.eliminated = true;
    }
    while (board.phase === 'intermission') step(board);
    return new RolloutRun(board, playerId, builder, rng, []);
  }

  /**
   * Plays on until a piece is laid, the builder halts — on the tick it halted, not yet
   * stepped, for a branch to take it from there — or the phase is over.
   */
  advance(): 'placed' | 'halted' | 'done' {
    const { board, builder, rng } = this;
    while (board.phase === 'build') {
      const action = builder.build(board, rng);
      if (builder.halted) return 'halted';
      let placed = false;
      if (action?.kind === 'place_piece' && applyAction(board, action) === null) {
        this.placements.push({
          tick: board.tick,
          x: action.x,
          y: action.y,
          rotation: action.rotation,
        });
        placed = true;
      }
      step(board);
      if (placed) return 'placed';
    }
    return 'done';
  }

  /** A run going on from here as this one would, with its builder following `strategy`. */
  fork(strategy: Strategy | null): RolloutRun {
    return new RolloutRun(
      copyOf(this.board, this.board.events),
      this.playerId,
      this.builder.fork(strategy),
      this.rng.clone(),
      [...this.placements],
    );
  }

  /** The pieces laid and, once the phase is over, how the round ended for this player. */
  outcome(): Rollout {
    let result: RoundResult | null = null;
    for (const event of this.board.events) {
      if (event.kind !== 'round_resolved') continue;
      result = event.results.find((r) => r.player === this.playerId) ?? null;
    }
    return { placements: this.placements, result, board: this.board };
  }
}

/**
 * A copy of the match a rollout may change: what a build phase and its resolution write,
 * copied; the terrain and the rules, which nothing writes, shared.
 */
/** The board as it stands, for a search to play every strategy from (`PlanSearch`). */
export function snapshot(state: MatchState): MatchState {
  return copyOf(state);
}

function copyOf(state: MatchState, events: MatchState['events'] = []): MatchState {
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
    events: [...events],
  };
}
