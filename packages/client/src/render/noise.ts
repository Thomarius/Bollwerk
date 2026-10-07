/**
 * A fixed number in [0, 1) for a tile, so decoration stays put from one redraw to the next:
 * an integer hash of the position and a salt, the same in every style that scatters things.
 */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
