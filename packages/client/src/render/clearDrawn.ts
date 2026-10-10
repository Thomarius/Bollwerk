import type { Graphics } from 'pixi.js';

/**
 * Empties a `Graphics` redrawn every frame, without telling Pixi when it was empty already.
 *
 * `clear()` marks the drawing changed whatever it held, and Pixi rebuilds the whole draw
 * list of the render group of anything changed (ARCHIVE 13f) — so a layer cleared each frame
 * for an overlay that is mostly not there cost every style that rebuild every frame. An
 * empty one is left alone, but for the path begun and the transform set on it, which
 * `clear()` would have dropped too and which a drawing that never filled could leave.
 */
export function clearDrawn(g: Graphics): void {
  if (g.context.instructions.length > 0) {
    g.clear();
    return;
  }
  g.context.beginPath();
  g.context.resetTransform();
}
