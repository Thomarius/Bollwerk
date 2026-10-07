import { Structure, Terrain, pieceById, poolForRound, type MatchState } from '@bollwerk/sim';

type Ruleset = MatchState['ruleset'];

/**
 * Every way of laying a piece of a round's bag over a tile, as the offsets of its cells
 * from that tile: each piece, each distinct turn, each of its cells on the tile. Which
 * pieces the bag can deal is the rules', not foresight — the piece sequence stays hidden.
 */
function coveringsFor(ruleset: Ruleset, round: number): readonly Int8Array[] {
  let byRound = coveringCache.get(ruleset);
  if (byRound === undefined) {
    byRound = new Map();
    coveringCache.set(ruleset, byRound);
  }
  let out = byRound.get(round);
  if (out === undefined) {
    const seen = new Set<string>();
    const ways: Int8Array[] = [];
    for (const id of poolForRound(ruleset, round).ids) {
      for (const cells of pieceById(id).rotations) {
        for (const [ax, ay] of cells) {
          const offsets = new Int8Array(cells.length * 2);
          cells.forEach(([cx, cy], k) => {
            offsets[k * 2] = cx - ax;
            offsets[k * 2 + 1] = cy - ay;
          });
          // Two pieces laid over the tile on the same cells are one covering.
          const key = [...offsets].join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          ways.push(offsets);
        }
      }
    }
    out = ways;
    byRound.set(round, out);
  }
  return out;
}

const coveringCache = new WeakMap<Ruleset, Map<number, readonly Int8Array[]>>();

/**
 * Whether any piece the bag can deal this player could still cover a tile of their own
 * island, on a board — the state's own, or a copy with a placement stood in. Once one-cell
 * pieces stop being dealt, a hole a shot left between wall and water, or between wall and
 * gun, may take no piece at all; a wall planned through it can never close, and the build
 * phase only fills the board, so a tile no piece covers now will take none this phase.
 */
export function coverable(
  state: MatchState,
  playerId: number,
  i: number,
  structure: ArrayLike<number> = state.structure,
): boolean {
  const player = state.players[playerId];
  if (player === undefined) return false;
  const { width, height } = state;
  const island = player.islandId;
  const tx = i % width;
  const ty = (i - tx) / width;
  for (const offsets of coveringsFor(state.ruleset, player.pieceRound)) {
    let fits = true;
    for (let k = 0; k < offsets.length && fits; k += 2) {
      const x = tx + (offsets[k] as number);
      const y = ty + (offsets[k + 1] as number);
      if (x < 0 || y < 0 || x >= width || y >= height) {
        fits = false;
        break;
      }
      const j = y * width + x;
      fits =
        state.terrain[j] === Terrain.Land &&
        structure[j] === Structure.Empty &&
        state.islandId[j] === island;
    }
    if (fits) return true;
  }
  return false;
}
