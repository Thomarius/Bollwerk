import { Structure, computeEnclosure, type MatchState } from '@rampart/sim';

import type { Cell } from './render/theme.js';

/**
 * The sealing preview, a setting and off by default: while the piece in hand would seal
 * ground, that ground is outlined faintly under it. Information rather than dressing, and
 * unlike the gap marks removed after the first human play (PLAN §7) it shows what a move
 * would do rather than prescribing one — which is why it is for the testers to try
 * before it is ever on by default.
 */
const KEY = 'rampart.sealPreview';

export function sealPreviewOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSealPreview(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage refused: the choice holds for this page only.
  }
}

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
): Cell[] {
  const structure = state.structure.slice();
  for (const [dx, dy] of cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height) return [];
    structure[cy * state.width + cx] = Structure.Wall;
  }
  const now = computeEnclosure(state).territory;
  const after = computeEnclosure({ ...state, structure }).territory;
  const gained: Cell[] = [];
  for (let i = 0; i < after.length; i++) {
    if ((after[i] as number) > 0 && after[i] !== now[i] && structure[i] !== Structure.Wall) {
      gained.push({ x: i % state.width, y: Math.floor(i / state.width) });
    }
  }
  return gained;
}
