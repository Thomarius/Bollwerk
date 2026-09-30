import type { Castle } from '@rampart/sim';

/**
 * The moment a castle is sealed, drawn as ground being taken: the new territory floods
 * outward from the castle, a bright front running ahead of the paving, rather than the
 * whole region appearing in one frame.
 *
 * It is the most satisfying thing a player does, and it used to pass unmarked. Drawn
 * the same in both styles, because it is information as well as decoration — it shows
 * exactly what the last piece sealed. Separated from the drawing so the order and the
 * timing can be tested without a browser.
 */

/** New territory, in the order a flood reaches it. */
export interface Flood {
  /** When it began, in the client's milliseconds. */
  startMs: number;
  /** Tile indices. */
  tiles: Int32Array;
  /** Steps from the nearest seed, by position in `tiles`. */
  dist: Uint16Array;
  /** The territory value — owner + 1 — by position in `tiles`. */
  owners: Uint8Array;
  maxDist: number;
}

const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The flood for territory gained between two enclosures, or null when nothing was.
 *
 * It spreads from what the player already held: a castle's own footprint (a region
 * newly sealed — the usual case, a breach closed), or the edge of the old territory (a
 * region widened). A patch touching neither, which the rules should not produce, floods
 * from its first tile rather than not at all.
 */
export function floodFrom(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  castles: readonly Castle[],
  startMs: number,
): Flood | null {
  const size = after.length;
  const height = size / width;
  const gained = new Uint8Array(size);
  let count = 0;
  for (let i = 0; i < size; i++) {
    const owner = after[i] as number;
    if (owner > 0 && before[i] !== owner) {
      gained[i] = 1;
      count++;
    }
  }
  if (count === 0) return null;

  const inCastle = new Uint8Array(size);
  for (const castle of castles) {
    for (let y = castle.y; y < castle.y + castle.h; y++) {
      for (let x = castle.x; x < castle.x + castle.w; x++) inCastle[y * width + x] = 1;
    }
  }

  const dist = new Int32Array(size).fill(-1);
  const order: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < size; i++) {
    if (gained[i] === 0) continue;
    const owner = after[i] as number;
    const x = i % width;
    const y = (i - x) / width;
    const touchesOld = STEPS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && before[ny * width + nx] === owner;
    });
    if (inCastle[i] === 1 || touchesOld) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
  const spread = (): void => {
    while (head < queue.length) {
      const i = queue[head++] as number;
      order.push(i);
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (gained[j] === 0 || dist[j] !== -1 || after[j] !== after[i]) continue;
        dist[j] = (dist[i] as number) + 1;
        queue.push(j);
      }
    }
  };
  spread();
  // Anything the seeds could not reach starts from its own first tile.
  for (let i = 0; i < size; i++) {
    if (gained[i] === 0 || dist[i] !== -1) continue;
    dist[i] = 0;
    queue.push(i);
    spread();
  }

  const tiles = Int32Array.from(order);
  const steps = Uint16Array.from(order, (i) => dist[i] as number);
  const owners = Uint8Array.from(order, (i) => after[i] as number);
  let maxDist = 0;
  for (const d of steps) maxDist = Math.max(maxDist, d);
  return { startMs, tiles, dist: steps, owners, maxDist };
}

/** How many steps out the front of a flood has come. */
export function floodFront(flood: Flood, nowMs: number, tilesPerSecond: number): number {
  return (Math.max(0, nowMs - flood.startMs) * tilesPerSecond) / 1000;
}

/** Whether a flood has finished, its glow included. */
export function floodOver(
  flood: Flood,
  nowMs: number,
  tilesPerSecond: number,
  glowTiles: number,
): boolean {
  return floodFront(flood, nowMs, tilesPerSecond) > flood.maxDist + glowTiles;
}

/**
 * The territory to draw: as it stands, less whatever the floods have not reached yet.
 * Only ever takes tiles away, so a flood outlived by a breach cannot put back ground
 * that has since been lost.
 */
export function territoryDuring(
  territory: Uint8Array,
  floods: readonly Flood[],
  nowMs: number,
  tilesPerSecond: number,
): Uint8Array {
  if (floods.length === 0) return territory;
  const shown = territory.slice();
  for (const flood of floods) {
    const front = floodFront(flood, nowMs, tilesPerSecond);
    for (let k = 0; k < flood.tiles.length; k++) {
      if ((flood.dist[k] as number) > front) shown[flood.tiles[k] as number] = 0;
    }
  }
  return shown;
}

/** A tile at a flood's front, lit in proportion to how recently it was reached. */
export interface SealGlow {
  x: number;
  y: number;
  /** Player id. */
  owner: number;
  /** 1 at the front, falling to 0 `glowTiles` behind it. */
  strength: number;
}

export function sealGlow(
  floods: readonly Flood[],
  nowMs: number,
  width: number,
  tilesPerSecond: number,
  glowTiles: number,
): SealGlow[] {
  const glow: SealGlow[] = [];
  for (const flood of floods) {
    const front = floodFront(flood, nowMs, tilesPerSecond);
    for (let k = 0; k < flood.tiles.length; k++) {
      const behind = front - (flood.dist[k] as number);
      if (behind < 0 || behind >= glowTiles) continue;
      const i = flood.tiles[k] as number;
      const x = i % width;
      glow.push({
        x,
        y: (i - x) / width,
        owner: (flood.owners[k] as number) - 1,
        strength: 1 - behind / glowTiles,
      });
    }
  }
  return glow;
}

/**
 * Ground lost to a breach, drained away from the gap (PLAN 11.15): the seal's flood run
 * in reverse. As the "Rebuild" banner reveals the board as it stands, the ground a
 * player held when combat began and holds no longer is washed dark red, and the wash
 * runs out through the breach — the tiles by the gap first, the deepest last — so the
 * barrage's cost is seen, not merely found missing.
 *
 * Seeded at the gaps: lost tiles beside ground that is outside now and was not lost with
 * them, which is where the sea came in. A lost patch no gap reaches drains from its own
 * first tile, as the flood's stray patches do. `dist` counts steps from the gap.
 */
export function drainFrom(
  before: Uint8Array,
  after: Uint8Array,
  outside: Uint8Array,
  width: number,
  startMs: number,
): Flood | null {
  const size = before.length;
  const height = size / width;
  const lost = new Uint8Array(size);
  let count = 0;
  for (let i = 0; i < size; i++) {
    const owner = before[i] as number;
    if (owner > 0 && after[i] !== owner) {
      lost[i] = 1;
      count++;
    }
  }
  if (count === 0) return null;

  const dist = new Int32Array(size).fill(-1);
  const order: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < size; i++) {
    if (lost[i] === 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const atGap = STEPS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const j = ny * width + nx;
      return lost[j] === 0 && outside[j] === 1;
    });
    if (atGap) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  const spread = (): void => {
    while (head < queue.length) {
      const i = queue[head++] as number;
      order.push(i);
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (lost[j] === 0 || dist[j] !== -1 || before[j] !== before[i]) continue;
        dist[j] = (dist[i] as number) + 1;
        queue.push(j);
      }
    }
  };
  spread();
  for (let i = 0; i < size; i++) {
    if (lost[i] === 0 || dist[i] !== -1) continue;
    dist[i] = 0;
    queue.push(i);
    spread();
  }

  const tiles = Int32Array.from(order);
  const steps = Uint16Array.from(order, (i) => dist[i] as number);
  const owners = Uint8Array.from(order, (i) => before[i] as number);
  let maxDist = 0;
  for (const d of steps) maxDist = Math.max(maxDist, d);
  return { startMs, tiles, dist: steps, owners, maxDist };
}

/** A lost tile's wash: 1 while the drain has not reached it, fading over a step as it does. */
export interface DrainWash {
  x: number;
  y: number;
  strength: number;
}

export function drainWash(
  drains: readonly Flood[],
  nowMs: number,
  width: number,
  tilesPerSecond: number,
): DrainWash[] {
  const wash: DrainWash[] = [];
  for (const drain of drains) {
    const front = floodFront(drain, nowMs, tilesPerSecond);
    for (let k = 0; k < drain.tiles.length; k++) {
      const strength = Math.min(1, (drain.dist[k] as number) + 1 - front);
      if (strength <= 0) continue;
      const i = drain.tiles[k] as number;
      const x = i % width;
      wash.push({ x, y: (i - x) / width, strength });
    }
  }
  return wash;
}

/**
 * `drainFrom`, one drain per player, each waiting (`startMs` Infinity, so wholly washed)
 * until `release` starts it: an island's drain should begin as the banner's line reaches
 * it, not as the banner appears — begun together, the upper islands had drained before
 * the lower ones were even revealed.
 */
export function drainsFrom(
  before: Uint8Array,
  after: Uint8Array,
  outside: Uint8Array,
  width: number,
): Flood[] {
  const all = drainFrom(before, after, outside, width, Number.POSITIVE_INFINITY);
  if (all === null) return [];
  const byOwner = new Map<number, number[]>();
  for (let k = 0; k < all.tiles.length; k++) {
    const owner = all.owners[k] as number;
    let list = byOwner.get(owner);
    if (list === undefined) byOwner.set(owner, (list = []));
    list.push(k);
  }
  return [...byOwner.values()].map((ks) => {
    const dist = Uint16Array.from(ks, (k) => all.dist[k] as number);
    return {
      startMs: Number.POSITIVE_INFINITY,
      tiles: Int32Array.from(ks, (k) => all.tiles[k] as number),
      dist,
      owners: Uint8Array.from(ks, (k) => all.owners[k] as number),
      maxDist: dist.reduce((a, b) => Math.max(a, b), 0),
    };
  });
}

/**
 * Starts every waiting drain whose top row the banner's line has passed (`lineRow`,
 * Infinity once the banner is gone), at `nowMs`.
 */
export function releaseDrains(
  drains: readonly Flood[],
  lineRow: number,
  width: number,
  nowMs: number,
): void {
  for (const drain of drains) {
    if (drain.startMs !== Number.POSITIVE_INFINITY) continue;
    let top = Number.POSITIVE_INFINITY;
    for (const i of drain.tiles) top = Math.min(top, Math.floor(i / width));
    if (top < lineRow) drain.startMs = nowMs;
  }
}
