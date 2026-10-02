/**
 * Stained glass's panes (PLAN 11.18 Y7): the land and the sea cut into irregular panes of a
 * few tiles each, as a window's glass is, rather than one pane a tile, which read as a
 * mosaic. Each tile belongs to the nearest of a jittered grid of points — cells a few
 * tiles across, no two alike — and a pane never crosses the coast: land and sea are cut
 * apart there, as the heavier came holds them.
 *
 * A pure function of the tile and the material, so every frame and every look cut the same
 * panes, and the lead can be drawn wherever two neighbours' panes differ.
 */

/** A fixed amount for two integers, 0 to 1. */
function hash01(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where a cell's point sits, in tiles: within its cell, never on its edge. */
function pointOf(i: number, j: number, size: number): [number, number] {
  return [(i + 0.15 + 0.7 * hash01(i, j, 1)) * size, (j + 0.15 + 0.7 * hash01(i, j, 2)) * size];
}

/**
 * The pane a tile belongs to: its nearest point's cell, and whether it is land — so a pane
 * is one material whatever the cells do at a coast. `size` is how far apart the points
 * stand, in tiles.
 */
export function paneOf(x: number, y: number, land: boolean, size: number): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const ci = Math.floor(cx / size);
  const cj = Math.floor(cy / size);
  let best = Infinity;
  let bi = ci;
  let bj = cj;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const [px, py] = pointOf(ci + di, cj + dj, size);
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) {
        best = d;
        bi = ci + di;
        bj = cj + dj;
      }
    }
  }
  // Cells are numbered across a wide field, so a pane's number is unique on any board.
  return ((bj + 512) * 1024 + (bi + 512)) * 2 + (land ? 1 : 0);
}

/** A pane's own shade, 0 to 1, so neighbouring panes are not one colour. */
export function paneShade(pane: number): number {
  return hash01(pane, pane >>> 11, 3);
}
