import type { EnclosureResult, MatchState } from '@bollwerk/sim';

import { cornerGaps, type CornerGap } from './cornerGaps.js';

/**
 * What the board should point out to a player who is building.
 *
 * A pure function of the state, so it can be tested without a browser, as `banners.ts`
 * is. While nothing of theirs is sealed, their castles are outlined: that is the round
 * they are about to lose a life over.
 *
 * It used to mark the gap as well — the cells of the cheapest repair. Removed after the
 * first human play: the marks were hard to tell from the piece ghost and from wall
 * already laid, and they read as the only way to close the wall, when any shape that
 * closes it will do.
 *
 * Corner gaps are pointed at, at the corner and not a tile (`cornerGaps.ts`): a castle with
 * only those left is one the player believes sealed, and cannot see why it is not. Those of
 * any castle of theirs, whatever else is sealed, since a second castle is where they hide.
 */
export interface BuildHints {
  /** The player's castles, when none of them is sealed. */
  unsealed: readonly { x: number; y: number; w: number; h: number }[];
  /** The leaks of the player's castles that have no other gaps left. */
  cornerGaps: readonly CornerGap[];
}

const NONE: BuildHints = { unsealed: [], cornerGaps: [] };

export function buildHints(
  state: MatchState,
  humanPlayer: number,
  live: EnclosureResult,
): BuildHints {
  if (state.phase !== 'build') return NONE;
  const player = state.players[humanPlayer];
  if (player === undefined || player.eliminated) return NONE;
  const gaps = cornerGaps(state, humanPlayer, live.castleEnclosed);
  // Something sealed is a round survived; the rest is ambition, and not ours to outline.
  if ((live.enclosedCastlesByPlayer[humanPlayer] ?? 0) > 0)
    return { unsealed: [], cornerGaps: gaps };
  return {
    unsealed: state.castles.filter((c) => c.islandId === player.islandId),
    cornerGaps: gaps,
  };
}
