import { Structure, computeEnclosure, type MatchState } from '@bollwerk/sim';

import type { Cell } from './render/theme.js';

/**
 * The sealing preview: while the piece in hand would seal ground, that ground is
 * outlined faintly under it. Information rather than dressing, and unlike the gap marks
 * removed after the first human play (PLAN §7) it shows what a move would do rather than
 * prescribing one. A menu setting, off by default, until the test sessions found it
 * helpful: now always on, and the switch is gone.
 */

/**
 * The ground a piece at (`x`, `y`) with `cells` would seal that is not sealed now, by the
 * enclosure the sim itself computes, with the piece's cells stood in as wall. Anyone's
 * ground counts: a piece laid on a teammate's island seals theirs.
 */
export function sealingCells(
  state: MatchState,
  cells: readonly (readonly [number, number])[],
  x: number,
  y: number,
  /** The territory as the board stands, when the caller has it: it changes only with the board. */
  now: Uint8Array = computeEnclosure(state).territory,
): Cell[] {
  const structure = state.structure.slice();
  for (const [dx, dy] of cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height) return [];
    structure[cy * state.width + cx] = Structure.Wall;
  }
  const after = computeEnclosure({ ...state, structure }).territory;
  const gained: Cell[] = [];
  for (let i = 0; i < after.length; i++) {
    if ((after[i] as number) > 0 && after[i] !== now[i] && structure[i] !== Structure.Wall) {
      gained.push({ x: i % state.width, y: Math.floor(i / state.width) });
    }
  }
  return gained;
}
