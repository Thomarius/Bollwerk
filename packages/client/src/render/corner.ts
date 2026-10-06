import type { MatchState } from '@bollwerk/sim';

import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { roseSpot } from './parchment.js';
import type { ViewTransform } from './theme.js';

/**
 * The piece each style stands in the sea's bottom-right corner (PLAN 11.24) — Parchment's
 * compass rose, Opera's conductor, Oktoberfest's Ferris wheel and the rest: the place, and
 * the moment they share.
 */

/** Where it stands for this board and window, clear of the big timer; see `roseSpot`. */
export function cornerSpot(state: MatchState, view: ViewTransform): TimerSpot | null {
  const right = Math.floor((view.width - view.originX) / view.tile) - state.width;
  const bottom = Math.floor((view.height - view.originY) / view.tile) - state.height;
  return roseSpot(state, right, bottom, timerSpot(state));
}

/**
 * Whether the clock is pressing — a phase's last seconds, or overtime — when the pieces
 * hurry, as the conductor's beat does.
 */
export function pressing(state: MatchState): boolean {
  const left = (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz;
  if (state.phase === 'build' && state.overtime) return true;
  return state.phase !== 'intermission' && state.phase !== 'game_over' && left < 5;
}
