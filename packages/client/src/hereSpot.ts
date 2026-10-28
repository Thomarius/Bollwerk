import { Terrain, type MatchState } from '@bollwerk/sim';

/**
 * Where "You are here" points (PLAN §11 item 4, UP1). Over the island's middle it often
 * stood on a castle, just when the castles are what to choose from: it points now at the
 * island's land nearest its middle from where the label, hung above its arrow, covers no
 * castle of that island and stays on the board. In tiles, the arrow's tip; `box` is the
 * label's size in tiles, arrow included, measured at the whole map's scale — the opening's
 * camera only zooms in from there, which makes the label smaller against the board, so the
 * spot stays clear. The middle itself when nowhere is.
 */
export function hereSpot(
  state: MatchState,
  islandId: number,
  centre: { x: number; y: number },
  box: { w: number; h: number },
): { x: number; y: number } {
  /** Room kept round each castle, in tiles, so the label's border does not touch it. */
  const margin = 0.3;
  const castles = state.castles.filter((castle) => castle.islandId === islandId);
  // On the board as well, which the HUD's bar never covers: over a top-row island the label
  // would otherwise run under the bar.
  const clear = (x: number, y: number): boolean =>
    x - box.w / 2 >= 0 &&
    x + box.w / 2 <= state.width &&
    y - box.h >= 0 &&
    castles.every(
      (c) =>
        x + box.w / 2 <= c.x - margin ||
        x - box.w / 2 >= c.x + c.w + margin ||
        y <= c.y - margin ||
        y - box.h >= c.y + c.h + margin,
    );
  const middle = { x: centre.x + 0.5, y: centre.y + 0.5 };
  let best = middle;
  let bestDistance = Infinity;
  for (let i = 0; i < state.islandId.length; i++) {
    if (state.islandId[i] !== islandId || state.terrain[i] !== Terrain.Land) continue;
    const tx = i % state.width;
    const x = tx + 0.5;
    const y = (i - tx) / state.width + 0.5;
    const distance = (x - middle.x) ** 2 + (y - middle.y) ** 2;
    if (distance < bestDistance && clear(x, y)) {
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best;
}
