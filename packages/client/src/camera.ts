import type { ArtConfig } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';

/**
 * Where the camera looks (PLAN 11.11 W6), as pure functions so they are tested rather than
 * watched: headless Chrome cannot drive anything timed. It moves only while nothing is
 * playable — the opening intermission, and game over — so a click always lands on the
 * tile under it; the scene maps input through the camera all the same.
 */
export interface CameraShot {
  /** 1 is the whole map, as fitted to the window. */
  zoom: number;
  /** The tile, in fractional tile units, held at the middle of the board's area. */
  focusX: number;
  focusY: number;
  /**
   * Zoom about the focus where it already stands on screen, rather than bringing it to
   * the middle. The push onto the winner: the middle is where the summary is.
   */
  inPlace?: boolean;
}

type CameraArt = ArtConfig['camera'];

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Between two shots; zoom in proportion, so the pull feels even from close to far. */
export function between(from: CameraShot, to: CameraShot, t: number): CameraShot {
  const e = smoothstep(t);
  return {
    zoom: from.zoom * (to.zoom / from.zoom) ** e,
    focusX: from.focusX + (to.focusX - from.focusX) * e,
    focusY: from.focusY + (to.focusY - from.focusY) * e,
  };
}

function whole(state: MatchState): CameraShot {
  return { zoom: 1, focusX: state.width / 2, focusY: state.height / 2 };
}

/**
 * The opening: on the viewer's own island as the match begins — seats are shuffled onto
 * islands, so this is where they learn which is theirs — held a moment, then out to the
 * whole map before the castle choice opens. A pure function of the sim clock, so a client
 * joining part-way picks it up where it is. Null outside the opening intermission, or
 * with no island of one's own to start on.
 */
export function openingShot(
  state: MatchState,
  tickFraction: number,
  island: { x: number; y: number } | undefined,
  art: CameraArt,
): CameraShot | null {
  if (state.phase !== 'intermission' || state.pendingPhase !== 'castle_select') return null;
  if (state.round !== 0 || island === undefined || state.phaseEndTick <= 0) return null;
  const t = (state.tick + tickFraction) / state.phaseEndTick;
  const pull = (t - art.openingHold) / (1 - art.openingHold);
  const close = { zoom: art.openingZoom, focusX: island.x + 0.5, focusY: island.y + 0.5 };
  return between(close, whole(state), pull);
}

/**
 * Game over: a slow push onto the winners' islands, over `winnerPushMs` from the moment
 * the match ended, and held there — about the islands where they stand, since the middle
 * of the screen is the summary's, and pushed there they sat behind it. Null for a draw, or
 * nobody to push onto.
 */
export function winnerShot(
  state: MatchState,
  sinceOverMs: number,
  winners: readonly { x: number; y: number }[],
  art: CameraArt,
): CameraShot | null {
  if (state.phase !== 'game_over' || winners.length === 0) return null;
  const x = winners.reduce((sum, w) => sum + w.x, 0) / winners.length + 0.5;
  const y = winners.reduce((sum, w) => sum + w.y, 0) / winners.length + 0.5;
  const zoom = between(
    { zoom: 1, focusX: x, focusY: y },
    { zoom: art.winnerZoom, focusX: x, focusY: y },
    sinceOverMs / art.winnerPushMs,
  ).zoom;
  return { zoom, focusX: x, focusY: y, inPlace: true };
}
