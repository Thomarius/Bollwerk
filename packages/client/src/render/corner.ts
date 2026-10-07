import { Terrain, type MatchState } from '@bollwerk/sim';

import { timerSpot, type TimerSpot } from '../timerSpot.js';

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

/** Squares tried for the compass rose, largest first. */
const ROSE_SIZES = [4, 3] as const;

/**
 * Where the compass rose goes: open water as near the bottom-right of the window as fits
 * it, in tile coordinates, which may lie outside the map in the sea round it.
 *
 * It first sat under the big timer, the one place in the sea certain to be open, and
 * muddied its figures. The bottom-right corner is the one the HUD leaves alone — the
 * bar is along the top, the sound switch and the hint along the bottom's left and
 * middle. `right` and `bottom` are the whole tiles of sea on screen beyond the map on
 * those sides — not the sheet drawn, which runs past the window, nor the margin above,
 * which the HUD's inset makes deeper than the one below. The rose keeps a tile clear of
 * the window's edge, and never overlaps `avoid`, the timer's square.
 */
export function roseSpot(
  state: MatchState,
  right: number,
  bottom: number,
  avoid: TimerSpot | null,
): TimerSpot | null {
  const land = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < state.width &&
    y < state.height &&
    state.terrain[y * state.width + x] === Terrain.Land;
  const cornerX = state.width + right - 1;
  const cornerY = state.height + bottom - 1;
  for (const s of ROSE_SIZES) {
    let best: TimerSpot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = 1; y + s <= cornerY; y++) {
      for (let x = 1; x + s <= cornerX; x++) {
        const d = Math.hypot(cornerX - (x + s), cornerY - (y + s));
        if (d >= bestDistance) continue;
        if (avoid !== null) {
          const ax = avoid.x - avoid.size / 2;
          const ay = avoid.y - avoid.size / 2;
          if (x < ax + avoid.size && ax < x + s && y < ay + avoid.size && ay < y + s) continue;
        }
        let open = true;
        for (let dy = 0; dy < s && open; dy++) {
          for (let dx = 0; dx < s && open; dx++) if (land(x + dx, y + dy)) open = false;
        }
        if (!open) continue;
        bestDistance = d;
        best = { x: x + s / 2, y: y + s / 2, size: s };
      }
    }
    if (best !== null) return best;
  }
  return null;
}
