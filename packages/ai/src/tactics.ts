import {
  NEIGHBOURS_4,
  NEIGHBOURS_8,
  Structure,
  Terrain,
  type Castle,
  type MatchState,
} from '@bollwerk/sim';

import { INFINITE_CAPACITY, MaxFlow, type FlowMark } from './flow.js';

/** The cheapest wall that would seal a set of castles. */
export interface SealPlan {
  /** Tiles that still need building. */
  tiles: number[];
  /** Castles the wall would enclose. */
  castleIds: number[];
  /** Blocks needed, which is the minimum cut. */
  cost: number;
}

function passable(state: MatchState, i: number): boolean {
  return state.structure[i] !== Structure.Wall;
}

/** Empty land of this player's own island: the only tiles they may build on. */
function buildable(state: MatchState, playerId: number, i: number): boolean {
  const islandId = state.players[playerId]?.islandId;
  return (
    state.terrain[i] === Terrain.Land &&
    state.islandId[i] === islandId &&
    state.structure[i] === Structure.Empty
  );
}

/**
 * The smallest set of blocks that would enclose these castles.
 *
 * Returns null when no wall could do it — which happens when a castle can be reached
 * through tiles nobody can build on, such as another player's ground.
 *
 * This is what the stopgap opponent lacked. It rebuilt the ring it was handed, which
 * is the one shape guaranteed to be expensive: a thin rectangle no piece fits along.
 * Asking instead for the cheapest loop that exists lets a bot hug the coast, reuse
 * whatever wall survived the barrage, and abandon a ring that is no longer worth
 * holding.
 */
export function planSeal(
  state: MatchState,
  playerId: number,
  castles: readonly Castle[],
  /**
   * Tiles to treat as unbuildable. A gap with no free neighbours cannot be filled,
   * because the smallest piece is three cells and pieces may not overlap — so a plan
   * that depends on it is worthless, and the wall has to go around instead.
   */
  blocked?: ReadonlySet<number>,
  /**
   * Also keep this player's cannons inside the wall. A cannon only fires from sealed
   * ground, so a wall drawn tight around the castle alone leaves the guns outside and
   * silent — and the sweep then takes the old outer wall away, so they never come
   * back. Enclosing them costs more, and that is simply what they are worth.
   */
  keepCannons = false,
  /**
   * Ground around each castle that must also end up inside the wall.
   *
   * A minimum cut is by definition the *tightest* wall that works, which is exactly
   * the wall with no room in it: a cannon needs a clear 2x2 of sealed ground, and a
   * wall drawn against the castle leaves nowhere to put one. A bot that cannot spend
   * the cannons it earns has no firepower, and a match between two of those does not
   * end.
   */
  roomRadius = 0,
): SealPlan | null {
  if (castles.length === 0) return null;
  return new SealGraph(state, playerId, blocked).plan(castles, keepCannons, roomRadius);
}

/**
 * The graph `planSeal` cuts, for one player's island as it stands: built once and cut for
 * every set of castles a bot weighs (PLAN 11.22). Only the sink differs between them, so the
 * island's tiles and their edges are laid once, marked, and put back before each cut. A bot
 * weighs eleven sets at a time, and laying the graph each time was a third of its planning.
 */
export class SealGraph {
  private readonly islandId: number | undefined;
  private readonly node: Int32Array;
  private readonly tiles: number[] = [];
  private readonly flow: MaxFlow;
  private readonly bare: FlowMark;

  constructor(
    private readonly state: MatchState,
    private readonly playerId: number,
    private readonly blocked?: ReadonlySet<number>,
  ) {
    this.islandId = state.players[playerId]?.islandId;
    const islandId = this.islandId;
    // Only this player's own island can ever be part of the cut, so the graph is built
    // over its few hundred land tiles rather than all six thousand on the map. Water is
    // all connected to the border, so every tile where the island meets the sea is an
    // entry point and hangs straight off the source. That is not an approximation: any
    // route from the open map to the castle has to come ashore somewhere.
    const size = state.width * state.height;
    const node = new Int32Array(size).fill(-1);
    this.node = node;
    const tiles = this.tiles;
    if (islandId !== undefined) {
      for (let i = 0; i < size; i++) {
        if (state.islandId[i] !== islandId || !passable(state, i)) continue;
        node[i] = tiles.length;
        tiles.push(i);
      }
    }

    const count = tiles.length;
    const inNode = (n: number): number => n * 2;
    const outNode = (n: number): number => n * 2 + 1;
    const source = count * 2;
    const flow = new MaxFlow(count * 2 + 2);
    this.flow = flow;

    for (let n = 0; n < count; n++) {
      const i = tiles[n] as number;
      const canBuild = buildable(state, playerId, i) && blocked?.has(i) !== true;
      flow.addEdge(inNode(n), outNode(n), canBuild ? 1 : INFINITE_CAPACITY);

      const x = i % state.width;
      const y = (i - x) / state.width;
      let coastal = false;
      for (const [ox, oy] of NEIGHBOURS_8) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) {
          coastal = true;
          continue;
        }
        const j = ny * state.width + nx;
        if (state.islandId[j] !== islandId) {
          // Sea, or somebody else's ground: either way it is open to the border.
          if (passable(state, j)) coastal = true;
          continue;
        }
        const m = node[j] as number;
        if (m >= 0) flow.addEdge(outNode(n), inNode(m), INFINITE_CAPACITY);
      }
      if (coastal) flow.addEdge(source, inNode(n), INFINITE_CAPACITY);
    }
    this.bare = flow.mark();
  }

  /**
   * The smallest wall around these castles, as `planSeal` describes — and round every tile
   * of `ground` too, when given: the ground a player held, say, which no band round the
   * castles describes.
   */
  plan(
    castles: readonly Castle[],
    keepCannons = false,
    roomRadius = 0,
    ground?: readonly number[],
  ): SealPlan | null {
    const { state, playerId, blocked, node, tiles, flow } = this;
    if (castles.length === 0 || this.islandId === undefined || tiles.length === 0) return null;
    flow.reset(this.bare);

    const count = tiles.length;
    const inNode = (n: number): number => n * 2;
    const outNode = (n: number): number => n * 2 + 1;
    const source = count * 2;
    const sink = count * 2 + 1;
    const sinkTile = (i: number): void => {
      const n = node[i] as number;
      if (n >= 0) flow.addEdge(outNode(n), sink, INFINITE_CAPACITY);
    };

    for (const castle of castles) {
      // The castle, plus the band of ground the wall has to take in around it.
      const x0 = Math.max(0, castle.x - roomRadius);
      const y0 = Math.max(0, castle.y - roomRadius);
      const x1 = Math.min(state.width - 1, castle.x + castle.w - 1 + roomRadius);
      const y1 = Math.min(state.height - 1, castle.y + castle.h - 1 + roomRadius);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) sinkTile(y * state.width + x);
      }
    }

    if (ground !== undefined) for (const i of ground) sinkTile(i);

    if (keepCannons) {
      for (const cannon of state.cannons) {
        if (cannon.owner !== playerId) continue;
        for (let oy = 0; oy < cannon.h; oy++) {
          for (let ox = 0; ox < cannon.w; ox++)
            sinkTile((cannon.y + oy) * state.width + cannon.x + ox);
        }
      }
    }

    const cost = flow.maxFlow(source, sink, 400);
    if (cost >= 400) return null;

    const near = flow.reachable(source);
    const cut: number[] = [];
    for (let n = 0; n < count; n++) {
      const i = tiles[n] as number;
      if (!buildable(state, playerId, i) || blocked?.has(i) === true) continue;
      // A tile is on the cut when the flow reaches into it but not out of it.
      if (near[inNode(n)] === 1 && near[outNode(n)] === 0) cut.push(i);
    }

    return { tiles: cut, castleIds: castles.map((c) => c.id), cost };
  }
}

/**
 * Every wall worth considering, cheapest first.
 *
 * Each castle alone, then pairs, then the lot — so a caller can choose between
 * staying alive cheaply and reaching for a bigger enclosure, which is the decision
 * that actually matters in a build phase.
 */
export function sealOptions(
  state: MatchState,
  playerId: number,
  maxCastles: number,
  blocked?: ReadonlySet<number>,
  keepCannons = false,
  roomRadius = 0,
): SealPlan[] {
  return new SealPlanner(state, playerId, blocked).options(maxCastles, keepCannons, roomRadius);
}

/** The castles on this player's island. */
function castlesOf(state: MatchState, playerId: number): Castle[] {
  const islandId = state.players[playerId]?.islandId;
  return state.castles.filter((c) => c.islandId === islandId);
}

/**
 * Every question about walls one plan asks, answered on one graph and remembered: a bot
 * deciding what to build asks for the same walls at several widths, and the same wall
 * more than once on the way. Good only while the board and `blocked` stand as they were
 * when it was made — for one plan, not across placements. The plans it hands out are
 * shared between askers, so they are read, never changed.
 *
 * Each castle alone, each pair and the lot are cut only when asked for: a wall round two
 * castles or more never needs the single castles' cuts, which were most of the max-flows a
 * plan ran (2026-10-06).
 */
export class SealPlanner {
  private graph: SealGraph | null = null;
  private readonly cuts = new Map<string, Cuts>();
  private readonly answers = new Map<string, SealPlan[]>();
  private readonly grounds = new Map<string, SealPlan | null>();
  private readonly mine: Castle[];

  constructor(
    private readonly state: MatchState,
    private readonly playerId: number,
    private readonly blocked?: ReadonlySet<number>,
  ) {
    this.mine = castlesOf(state, playerId);
  }

  /** As `sealOptions`: each castle alone, then pairs, then the lot, cheapest first. */
  options(maxCastles: number, keepCannons = false, roomRadius = 0): SealPlan[] {
    if (this.mine.length === 0) return [];
    const key = `${maxCastles}:${keepCannons}:${roomRadius}`;
    let plans = this.answers.get(key);
    if (plans === undefined) {
      plans = this.candidates(1, maxCastles, keepCannons, roomRadius).sort(
        (x, y) => x.cost - y.cost,
      );
      this.answers.set(key, plans);
    }
    return plans;
  }

  /**
   * As `cheapestPlanFor`: the first of `options` to take in enough castles, which is the
   * cheapest of them and, among equals, the first made — what a stable sort puts first.
   */
  cheapest(
    atLeastCastles: number,
    maxCastles: number,
    keepCannons = false,
    roomRadius = 0,
  ): SealPlan | null {
    if (this.mine.length === 0) return null;
    let best: SealPlan | null = null;
    for (const plan of this.candidates(atLeastCastles, maxCastles, keepCannons, roomRadius)) {
      if (plan.castleIds.length >= atLeastCastles && (best === null || plan.cost < best.cost)) {
        best = plan;
      }
    }
    return best;
  }

  /**
   * The smallest wall round these castles and this ground, keeping the guns, remembered by
   * `key` — which must name the ground, since the planner cannot compare tile lists.
   */
  around(key: string, castles: readonly Castle[], ground: readonly number[]): SealPlan | null {
    let plan = this.grounds.get(key);
    if (plan === undefined) {
      const graph = (this.graph ??= new SealGraph(this.state, this.playerId, this.blocked));
      plan = castles.length === 0 ? null : graph.plan(castles, true, 0, ground);
      this.grounds.set(key, plan);
    }
    return plan;
  }

  /** The plans `options` would hold that could take in this many castles, as made. */
  private candidates(
    atLeastCastles: number,
    maxCastles: number,
    keepCannons: boolean,
    roomRadius: number,
  ): SealPlan[] {
    const key = `${keepCannons}:${roomRadius}`;
    let cuts = this.cuts.get(key);
    if (cuts === undefined) {
      cuts = { singles: null, pairs: null, all: undefined };
      this.cuts.set(key, cuts);
    }
    const mine = this.mine;
    const graph = (this.graph ??= new SealGraph(this.state, this.playerId, this.blocked));
    const out: SealPlan[] = [];
    const add = (plan: SealPlan | null): void => {
      if (plan !== null) out.push(plan);
    };
    if (atLeastCastles <= 1) {
      cuts.singles ??= mine.map((castle) => graph.plan([castle], keepCannons, roomRadius));
      cuts.singles.forEach(add);
    }
    if (maxCastles > 1 && atLeastCastles <= 2) {
      if (cuts.pairs === null) {
        cuts.pairs = [];
        for (let a = 0; a < mine.length; a++) {
          for (let b = a + 1; b < mine.length; b++) {
            cuts.pairs.push(
              graph.plan([mine[a] as Castle, mine[b] as Castle], keepCannons, roomRadius),
            );
          }
        }
      }
      cuts.pairs.forEach(add);
    }
    if (maxCastles > 2 && mine.length >= 3 && atLeastCastles <= mine.length) {
      if (cuts.all === undefined) cuts.all = graph.plan(mine, keepCannons, roomRadius);
      add(cuts.all);
    }
    return out;
  }
}

/** The cuts a planner has made at one width, each null until first asked for. */
interface Cuts {
  singles: (SealPlan | null)[] | null;
  pairs: (SealPlan | null)[] | null;
  all: SealPlan | null | undefined;
}

/** The cheapest wall that encloses at least this many castles, if one exists. */
export function cheapestPlanFor(
  state: MatchState,
  playerId: number,
  atLeastCastles: number,
  maxCastles: number,
  blocked?: ReadonlySet<number>,
  keepCannons = false,
  roomRadius = 0,
): SealPlan | null {
  return new SealPlanner(state, playerId, blocked).cheapest(
    atLeastCastles,
    maxCastles,
    keepCannons,
    roomRadius,
  );
}

/**
 * How many cannons this player's sealed ground could still hold.
 *
 * A wall drawn tight around one castle runs out of room to put the cannons it earns,
 * so the reward becomes unspendable. Counting the space is what lets a bot notice
 * that and widen before it matters.
 */
export function cannonRoom(state: MatchState, playerId: number): number {
  const islandId = state.players[playerId]?.islandId;
  if (islandId === undefined) return 0;
  const [cw, ch] = state.ruleset.cannons.footprint;

  const taken = new Uint8Array(state.width * state.height);
  let spots = 0;
  for (let y = 0; y + ch <= state.height; y++) {
    for (let x = 0; x + cw <= state.width; x++) {
      let fits = true;
      for (let oy = 0; oy < ch && fits; oy++) {
        for (let ox = 0; ox < cw; ox++) {
          const i = (y + oy) * state.width + x + ox;
          if (
            state.territory[i] !== islandId ||
            state.structure[i] !== Structure.Empty ||
            taken[i]
          ) {
            fits = false;
            break;
          }
        }
      }
      if (!fits) continue;
      // Reserve the footprint, so overlapping positions are not counted twice.
      for (let oy = 0; oy < ch; oy++) {
        for (let ox = 0; ox < cw; ox++) taken[(y + oy) * state.width + x + ox] = 1;
      }
      spots++;
    }
  }
  return spots;
}

/**
 * Tiles worth building to thicken the wall where it is thinnest.
 *
 * A minimum cut is by definition one block thick, so every block of it is
 * load-bearing and a single crater breaks the seal. `weakestWall` already computes
 * where an opponent would come through; the empty ground beside those blocks is
 * where a second layer is worth having.
 */
export function thickenTargets(
  state: MatchState,
  playerId: number,
  /** `weakestWall` of this player, when the caller has it already. */
  breach: readonly number[] = weakestWall(state, playerId),
): number[] {
  if (breach.length === 0) return [];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const wall of breach) {
    const x = wall % state.width;
    const y = (wall - x) / state.width;
    for (const [ox, oy] of NEIGHBOURS_8) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const i = ny * state.width + nx;
      if (seen.has(i) || !buildable(state, playerId, i)) continue;
      // Outward only. A second layer laid on the inside is a block of wall standing
      // where a cannon could have stood, and a cannon is what wins the match.
      if (state.territory[i] === state.players[playerId]?.islandId) continue;
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

/**
 * Every free tile against the outside of this player's wall — the last thing worth
 * building when nothing more particular is. A second layer anywhere is a breach that
 * takes two shots instead of one, and it is laid outward, so it never takes ground a
 * cannon could stand on.
 */
export function outerSkin(state: MatchState, playerId: number): number[] {
  const islandId = state.players[playerId]?.islandId;
  if (islandId === undefined) return [];
  const out: number[] = [];
  for (let i = 0; i < state.structure.length; i++) {
    if (!buildable(state, playerId, i) || state.territory[i] === islandId) continue;
    const x = i % state.width;
    const y = (i - x) / state.width;
    for (const [ox, oy] of NEIGHBOURS_4) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const j = ny * state.width + nx;
      if (state.structure[j] === Structure.Wall && state.islandId[j] === islandId) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

/**
 * The wall blocks on the cheapest way in to an enemy castle.
 *
 * A 0-1 breadth-first search from the map border: crossing open ground is free,
 * crossing a wall costs one. The cheapest path is therefore the thinnest part of
 * their defence, and its wall tiles are exactly what to shoot. Scattering fire over
 * a wall achieves nothing; concentrating it on four blocks in a line opens a breach.
 */
export function weakestWall(state: MatchState, targetPlayer: number): number[] {
  const islandId = state.players[targetPlayer]?.islandId;
  if (islandId === undefined) return [];
  const targets = state.castles.filter((c) => c.islandId === islandId && c.enclosed);
  if (targets.length === 0) return [];

  const size = state.width * state.height;
  const { dist, from, deque, goal } = weakestScratch(size);
  // Not MAX_SAFE_INTEGER: an Int32Array truncates it to -1, which makes every
  // relaxation look like a step backwards and the search never leaves the border.
  dist.fill(0x7fffffff);
  from.fill(-1);
  goal.fill(0);

  // A real double-ended queue: 0-1 BFS pushes free steps to the front and costly ones
  // to the back, which is only linear if the front push is O(1). Splicing an array
  // instead turns this into the slowest thing the bot does.
  const capacity = deque.length;
  let head = capacity >> 1;
  let tail = head;
  const pushFront = (v: number): void => {
    deque[--head] = v;
  };
  const pushBack = (v: number): void => {
    deque[tail++] = v;
  };

  for (const castle of targets) {
    for (let oy = 0; oy < castle.h; oy++) {
      for (let ox = 0; ox < castle.w; ox++) goal[(castle.y + oy) * state.width + castle.x + ox] = 1;
    }
  }

  // The border, in index order: the order the search sets out in decides between paths
  // of equal cost.
  const seedBorder = (i: number): void => {
    const cost = state.structure[i] === Structure.Wall ? 1 : 0;
    if (cost >= (dist[i] as number)) return;
    dist[i] = cost;
    if (cost === 0) pushFront(i);
    else pushBack(i);
  };
  for (let y = 0; y < state.height; y++) {
    const row = y * state.width;
    if (y === 0 || y === state.height - 1) {
      for (let x = 0; x < state.width; x++) seedBorder(row + x);
    } else {
      seedBorder(row);
      if (state.width > 1) seedBorder(row + state.width - 1);
    }
  }

  let reached = -1;
  while (head < tail) {
    const i = deque[head++] as number;
    if (goal[i] === 1) {
      reached = i;
      break;
    }
    const x = i % state.width;
    const y = (i - x) / state.width;
    for (let k = 0; k < 8; k++) {
      const nx = x + (DX8[k] as number);
      const ny = y + (DY8[k] as number);
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const j = ny * state.width + nx;
      const step = state.structure[j] === Structure.Wall ? 1 : 0;
      const next = (dist[i] as number) + step;
      if (next >= (dist[j] as number)) continue;
      dist[j] = next;
      from[j] = i;
      if (step === 0) pushFront(j);
      else pushBack(j);
    }
  }

  if (reached === -1) return [];
  const path: number[] = [];
  for (let at = reached; at !== -1; at = from[at] as number) {
    if (state.structure[at] === Structure.Wall) path.push(at);
  }
  return path;
}

/** `NEIGHBOURS_8` as two arrays, in its order, for the searches run most. */
const DX8 = Int8Array.from(NEIGHBOURS_8, ([x]) => x);
const DY8 = Int8Array.from(NEIGHBOURS_8, ([, y]) => y);

/** `weakestWall`'s arrays, kept between calls: it runs at every shot of some bots. */
let weakestArrays: {
  size: number;
  dist: Int32Array;
  from: Int32Array;
  deque: Int32Array;
  goal: Uint8Array;
} | null = null;

function weakestScratch(size: number): NonNullable<typeof weakestArrays> {
  if (weakestArrays?.size !== size) {
    weakestArrays = {
      size,
      dist: new Int32Array(size),
      from: new Int32Array(size),
      deque: new Int32Array(size * 4),
      goal: new Uint8Array(size),
    };
  }
  return weakestArrays;
}

/** A pocket for guns (§1.3): the blocks still to build, and how many guns it will hold. */
export interface PocketPlan {
  tiles: number[];
  cost: number;
  guns: number;
}

/** Pocket interiors tried: room for one 2x2 gun, or two side by side either way. */
const POCKET_SHAPES: readonly (readonly [number, number, number])[] = [
  [2, 2, 1],
  [4, 2, 2],
  [2, 4, 2],
];

/**
 * Tiles of existing wall a pocket must reuse. A pocket against the wall already standing
 * shares a side with it and costs a few blocks; one standing alone costs a whole ring, is
 * slow to build and is one more wall to repair — the user's point, and the reason a pocket
 * is worth more than widening the main loop at all.
 */
const POCKET_MIN_REUSE = 2;

/**
 * The cheapest pocket per gun: a small interior of free land outside this player's
 * territory, ringed — corners included, since the sea slips through a diagonal join — by
 * its own wall where that already stands and new blocks where it does not. Reused wall
 * costs nothing, so pockets against the standing wall win by construction. Null when no
 * pocket reuses enough wall.
 */
export function pocketPlan(
  state: MatchState,
  playerId: number,
  blocked: ReadonlySet<number> = new Set(),
): PocketPlan | null {
  const islandId = state.players[playerId]?.islandId;
  if (islandId === undefined) return null;
  const { width, height } = state;
  const free = (x: number, y: number): boolean => {
    const i = y * width + x;
    return buildable(state, playerId, i) && state.territory[i] !== islandId && !blocked.has(i);
  };
  let best: PocketPlan | null = null;
  for (let y0 = 1; y0 < height - 1; y0++) {
    for (let x0 = 1; x0 < width - 1; x0++) {
      if (state.islandId[y0 * width + x0] !== islandId) continue;
      for (const [w, h, guns] of POCKET_SHAPES) {
        if (x0 + w >= width || y0 + h >= height) continue;
        let ok = true;
        for (let y = y0; y < y0 + h && ok; y++) {
          for (let x = x0; x < x0 + w && ok; x++) ok = free(x, y);
        }
        if (!ok) continue;
        const tiles: number[] = [];
        let reused = 0;
        for (let y = y0 - 1; y <= y0 + h && ok; y++) {
          for (let x = x0 - 1; x <= x0 + w && ok; x++) {
            if (y >= y0 && y < y0 + h && x >= x0 && x < x0 + w) continue;
            const i = y * width + x;
            if (state.structure[i] === Structure.Wall && state.owner[i] === islandId) reused++;
            else if (free(x, y)) tiles.push(i);
            else ok = false;
          }
        }
        if (!ok || reused < POCKET_MIN_REUSE || tiles.length === 0) continue;
        const cost = tiles.length;
        if (best === null || cost / guns < best.cost / best.guns) best = { tiles, cost, guns };
      }
    }
  }
  return best;
}

/**
 * This player's pockets as the board stands: sealed regions of its territory holding no
 * castle. Territory is flooded 8-connected, as the enclosure is.
 */
export function pocketCount(state: MatchState, playerId: number): number {
  const islandId = state.players[playerId]?.islandId;
  if (islandId === undefined) return 0;
  const { width, height } = state;
  const seen = new Uint8Array(width * height);
  let pockets = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] === 1 || state.territory[start] !== islandId) continue;
    let castle = false;
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop() as number;
      if (state.structure[i] === Structure.Castle) castle = true;
      const x = i % width;
      const y = (i - x) / width;
      for (const [ox, oy] of NEIGHBOURS_8) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (seen[j] === 1 || state.territory[j] !== islandId) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    if (!castle) pockets++;
  }
  return pockets;
}
