import { NEIGHBOURS_4, NEIGHBOURS_8 } from './grid.js';
import { Structure, type MatchState } from './types.js';

/**
 * The enclosure solver — the most load-bearing function in the simulation.
 *
 * A castle counts only when a complete wall loop on land separates it from the open
 * map. The coastline is worth nothing: water is traversable by the escape flood, so
 * a shoreline gap leaks exactly like a missing wall block.
 *
 * Only walls block. Castles and cannons do not, which stops a player from parking a
 * cannon in a gap and calling the loop sealed.
 *
 * The flood is 8-connected while the wall is not, which is what forces a wall to turn
 * its corners: the sea slips through a diagonal join, so two blocks meeting at a point
 * do not seal and the corner block has to actually be there.
 */
export interface EnclosureResult {
  /** 1 where a tile is reachable from the map border without crossing a wall. */
  outside: Uint8Array;
  /** Owning player + 1 for tiles inside a sealed region holding that player's castle. */
  territory: Uint8Array;
  /** Indexed by castle id. */
  castleEnclosed: boolean[];
  /** Indexed by player id. */
  enclosedCastlesByPlayer: number[];
  /** Indexed by position in `state.cannons`. */
  cannonActive: boolean[];
}

/** The neighbour lists as offsets, for the flood's inner loop. */
const offsets = (list: readonly (readonly [number, number])[]) => ({
  dx: Int8Array.from(list, ([x]) => x),
  dy: Int8Array.from(list, ([, y]) => y),
});
const OFFSETS_4 = offsets(NEIGHBOURS_4);
const OFFSETS_8 = offsets(NEIGHBOURS_8);

/**
 * The floods' working arrays, kept between calls: the enclosure is computed at every
 * placement, by every bot's plan and by the client's preview, and nothing it returns is
 * one of these.
 */
let scratch: { queue: Int32Array; region: Int32Array } | null = null;

function scratchFor(size: number): { queue: Int32Array; region: Int32Array } {
  if (scratch === null || scratch.queue.length !== size) {
    scratch = { queue: new Int32Array(size), region: new Int32Array(size) };
  }
  return scratch;
}

export function computeEnclosure(state: MatchState): EnclosureResult {
  const { width: w, height: h, structure } = state;
  const size = w * h;
  const { dx, dy } = state.ruleset.enclosure.connectivity === 8 ? OFFSETS_8 : OFFSETS_4;
  const reach = dx.length;
  const { queue, region } = scratchFor(size);

  // Flood inward from the border. Water is traversable — the sea is "outside".
  const outside = new Uint8Array(size);
  let head = 0;
  let tail = 0;

  const seed = (x: number, y: number): void => {
    const i = y * w + x;
    if (outside[i] === 1 || structure[i] === Structure.Wall) return;
    outside[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < reach; k++) {
      const nx = x + (dx[k] as number);
      const ny = y + (dy[k] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (outside[ni] === 1 || structure[ni] === Structure.Wall) continue;
      outside[ni] = 1;
      queue[tail++] = ni;
    }
  }

  // A castle survives only if the flood never reached any of its tiles.
  const castleEnclosed: boolean[] = [];
  for (const castle of state.castles) {
    let enclosed = true;
    for (let oy = 0; oy < castle.h && enclosed; oy++) {
      for (let ox = 0; ox < castle.w; ox++) {
        if (outside[(castle.y + oy) * w + castle.x + ox] === 1) {
          enclosed = false;
          break;
        }
      }
    }
    castleEnclosed[castle.id] = enclosed;
  }

  // Counted before the regions, since whether a pocket is territory depends on it.
  const enclosedCastlesByPlayer = new Array<number>(state.players.length).fill(0);
  for (const castle of state.castles) {
    if (!castleEnclosed[castle.id]) continue;
    const player = castle.islandId - 1;
    enclosedCastlesByPlayer[player] = (enclosedCastlesByPlayer[player] as number) + 1;
  }

  // A sealed region holding one of an island's castles is that island's territory. One
  // holding none — a pocket — is too, as in the original, while its island's player
  // holds a sealed castle somewhere (`castlelessRegionsCount`): a gun there fires, its
  // tiles score, and it all goes the moment the last castle is breached. Without a castle
  // sealed a pocket is nothing, so it can never keep a player in the round on its own.
  const pockets = state.ruleset.enclosure.castlelessRegionsCount;
  region.fill(-1);
  const regionOwner: number[] = [];
  let regionCount = 0;

  for (let start = 0; start < size; start++) {
    if (outside[start] === 1 || region[start] !== -1) continue;
    if (structure[start] === Structure.Wall) continue;
    const id = regionCount++;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    region[start] = id;
    let owner = 0;
    // The island the region lies on. Only one: islands are parted by sea, which the
    // escape flood crosses, so no sealed region spans two.
    let island = 0;

    while (head < tail) {
      const i = queue[head++] as number;
      const x = i % w;
      const y = (i - x) / w;
      if (structure[i] === Structure.Castle) owner = state.islandId[i] as number;
      if (island === 0) island = state.islandId[i] as number;
      for (let k = 0; k < reach; k++) {
        const nx = x + (dx[k] as number);
        const ny = y + (dy[k] as number);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (outside[ni] === 1 || region[ni] !== -1) continue;
        if (structure[ni] === Structure.Wall) continue;
        region[ni] = id;
        queue[tail++] = ni;
      }
    }
    if (owner === 0 && pockets && island > 0) {
      const player = state.players[island - 1];
      if (
        player !== undefined &&
        !player.eliminated &&
        (enclosedCastlesByPlayer[player.id] as number) > 0
      ) {
        owner = island;
      }
    }
    regionOwner[id] = owner;
  }

  const territory = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const id = region[i] as number;
    if (id >= 0) territory[i] = (regionOwner[id] ?? 0) as number;
  }

  // A cannon fires only from inside its owner's sealed territory.
  const cannonActive: boolean[] = [];
  for (let c = 0; c < state.cannons.length; c++) {
    const cannon = state.cannons[c] as (typeof state.cannons)[number];
    let active = true;
    for (let oy = 0; oy < cannon.h && active; oy++) {
      for (let ox = 0; ox < cannon.w; ox++) {
        if (territory[(cannon.y + oy) * w + cannon.x + ox] !== cannon.owner + 1) {
          active = false;
          break;
        }
      }
    }
    cannonActive[c] = state.ruleset.cannons.inertWhenNotEnclosed ? active : true;
  }

  return { outside, territory, castleEnclosed, enclosedCastlesByPlayer, cannonActive };
}

/** Runs the solver and writes the outcome back into the match state. */
export function applyEnclosure(state: MatchState): EnclosureResult {
  const result = computeEnclosure(state);
  state.territory = result.territory;
  for (const castle of state.castles) castle.enclosed = result.castleEnclosed[castle.id] ?? false;
  for (let c = 0; c < state.cannons.length; c++) {
    (state.cannons[c] as (typeof state.cannons)[number]).active = result.cannonActive[c] ?? false;
  }
  for (const player of state.players) {
    player.enclosedCastles = result.enclosedCastlesByPlayer[player.id] ?? 0;
  }
  return result;
}
