import { type BotProfile } from '@bollwerk/config';
import {
  NEIGHBOURS_8,
  Structure,
  Terrain,
  canPlaceCannon,
  distanceSquared,
  sameTeam,
  type Action,
  type MatchState,
  type Rng,
} from '@bollwerk/sim';

import { type Builder } from './building.js';
import type { IslandCentres } from './botTurn.js';
import { rivalsOf, ticksFor } from './botTurn.js';
import { type PlanningSlots } from './planning.js';
import { SealGraph } from './tactics.js';

/** Castles an opening choice may weigh beyond cost: those within this of the cheapest. */
const CASTLE_CHOICE_SLACK = 1.2;

/**
 * Clearance a cannon wants between itself and the nearest wall or shore.
 *
 * A cannon jammed against its own wall is what makes a breach there unrepairable. The
 * hole a shot leaves has the cannon on one side and, on a coastal wall, water on the
 * other — so the only tile free to build in is the hole itself, and a piece is at
 * least two cells from round three on. The size schedule stops dealing ones after
 * round two, which turns a one-tile gap from awkward into permanent.
 *
 * Two tiles is enough to leave a piece somewhere to land.
 *
 * It buys nothing in the *opening*, and cannot: a castle sits centred in its starting
 * ring, so at `ringRadiusTiles: 3` the free interior is a band exactly two tiles wide
 * and a 2x2 cannon spans it completely. Surveyed directly — sixteen legal opening
 * spots, every one of them at clearance one. Widening the ring to 4 does make room, and
 * took two-player round-one eliminations from 2 in 12 to none, but an 8x8 starting wall
 * is what the original had and what the game is built around, so the ring stayed at 3.
 *
 * Where this does bite is every round after the first, once a player holds enough
 * ground to have a choice. Before it existed, all 120 opening cannons across twelve
 * matches sat against the wall, because proximity to the enemy was the only thing being
 * scored.
 */
const CANNON_CLEARANCE = 2;

/** Where a bot stands: the castle it opens from, and where each gun it earns goes. */
export class Siting {
  constructor(
    private readonly playerId: number,
    private readonly profile: BotProfile,
    private readonly slots: PlanningSlots,
    private readonly islands: IslandCentres,
    private readonly builder: Builder,
  ) {}

  private nextCannonTick = 0;

  /** The castle that is cheapest to wall, which on a rough island is several phases of work. */
  chooseCastle(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.startingCastleId !== null) return null;
    // Weighing every castle's wall is a plan: with none left at the table, the next tick.
    if (!this.slots.take(state.tick)) return null;
    this.builder.forget();
    const mine = state.castles.filter((c) => c.islandId === player.islandId);
    if (mine.length === 0) return null;

    // A careless moment takes whichever castle comes to hand. The stream is drawn only by
    // a level with any carelessness, so careful levels play exactly as they did.
    const careless = this.profile.carelessness;
    if (careless > 0 && rng.nextFloat() < careless) {
      const pick = mine[rng.nextInt(mine.length)];
      return pick ? { kind: 'select_castle', player: this.playerId, castleId: pick.id } : null;
    }

    // Cheapest to wall is the obvious measure and a trap: it scores a castle by how
    // tightly it can be strangled, and so picks the one with the least ground around
    // it. Costing the wall that leaves room for guns instead picks a castle worth
    // holding. Falls back to the bare cost only if no castle has room at all, since
    // an unwallable start is worse than a cramped one.
    // One graph for every castle at every width: only the castle cut for differs.
    const graph = new SealGraph(state, this.playerId);
    const pick = (roomRadius: number): (typeof mine)[number] | null => {
      const costed: { castle: (typeof mine)[number]; cost: number }[] = [];
      for (const castle of mine) {
        const plan = graph.plan([castle], false, roomRadius);
        if (plan !== null) costed.push({ castle, cost: plan.cost });
      }
      if (costed.length === 0) return null;
      const cheapest = costed.reduce((a, b) => (b.cost < a.cost ? b : a));
      if (this.profile.castleChoice === 'cheapest') return cheapest.castle;
      // Risk as flavour (PLAN 11.6), among castles whose roomy wall costs little more
      // than the cheapest, so nobody opens from a castle it cannot hold: offensive from
      // the one with most castles near it to reach for, defensive from the one farthest
      // from any opponent, whose shots then fly longest and come least often.
      const fair = costed.filter((c) => c.cost <= cheapest.cost * CASTLE_CHOICE_SLACK);
      const score =
        this.profile.castleChoice === 'central'
          ? (c: (typeof mine)[number]): number =>
              -mine.reduce((sum, o) => sum + (o === c ? 0 : Math.hypot(o.x - c.x, o.y - c.y)), 0)
          : (c: (typeof mine)[number]): number => {
              let nearest = Number.POSITIVE_INFINITY;
              for (const rival of rivalsOf(state, this.playerId)) {
                const at = this.islands.centre(state, rival.islandId);
                nearest = Math.min(nearest, Math.hypot(at.x - c.x, at.y - c.y));
              }
              return nearest;
            };
      return fair.reduce((a, b) => (score(b.castle) > score(a.castle) ? b : a)).castle;
    };

    const best = pick(this.profile.roomRadius) ?? pick(0) ?? (mine[0] as (typeof mine)[number]);
    return { kind: 'select_castle', player: this.playerId, castleId: best.id };
  }

  /**
   * Cannons go as close to the enemy as the walls allow: flight time scales with
   * distance and a cannon cannot fire again until its shot lands, so a gun ten tiles
   * nearer is simply a faster gun.
   */
  placeCannon(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.cannonsToPlace <= 0) return null;
    // Siting a gun takes a person a moment too, and without this the search below ran
    // on every tick of a 25-second phase.
    if (state.tick < this.nextCannonTick) return null;
    this.nextCannonTick = state.tick + ticksFor(this.profile.placementBaseMs, state);

    // Toward the other teams' castles; a teammate's is not the front line.
    const enemies = state.castles.filter((c) => !sameTeam(state, this.playerId, c.islandId - 1));
    const hazard = this.clearanceField(state, player.islandId);
    const [cw, ch] = state.ruleset.cannons.footprint;

    // A careless placement weighs proximity half by chance; decided once a gun, and drawn
    // only by a level with any carelessness.
    const careless = this.profile.carelessness;
    const noisy = careless > 0 && rng.nextFloat() < careless;

    let best: { x: number; y: number } | null = null;
    // Never pinned if there is any alternative, then room, then proximity: compared in
    // that order rather than summed, so there is no exchange rate to invent between them.
    let bestPinned = Number.MAX_SAFE_INTEGER;
    let bestRoom = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.territory[y * state.width + x] !== player.islandId) continue;
        if (canPlaceCannon(state, this.playerId, x, y) !== null) continue;

        let clear = Number.MAX_SAFE_INTEGER;
        for (let oy = 0; oy < ch; oy++) {
          for (let ox = 0; ox < cw; ox++) {
            clear = Math.min(clear, hazard[(y + oy) * state.width + x + ox] as number);
          }
        }
        // Capped, because clearance beyond this buys nothing and every extra tile of it
        // is a tile of range given away.
        const room = Math.min(clear, CANNON_CLEARANCE);

        let nearest = Number.MAX_SAFE_INTEGER;
        for (const enemy of enemies) {
          nearest = Math.min(nearest, distanceSquared(x, y, enemy.x, enemy.y));
        }
        const score = -nearest + (noisy ? rng.nextFloat() * 5000 : 0);

        const pinned = this.pinnedWalls(state, player.islandId, x, y, cw, ch);

        const better =
          pinned < bestPinned ||
          (pinned === bestPinned && (room > bestRoom || (room === bestRoom && score > bestScore)));
        if (better) {
          bestPinned = pinned;
          bestRoom = room;
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best ? { kind: 'place_cannon', player: this.playerId, ...best } : null;
  }

  /**
   * Wall tiles beside a cannon footprint that a single shot would turn into a permanent
   * hole.
   *
   * A wall block touching the cannon's side, with nothing buildable beyond it — water,
   * another island, the map's edge. Shot out, its hole is bounded by the cannon on one
   * side and that on the other, and the wall carries on either side of it, so the only
   * cell free to build in is the hole itself. One-cell pieces stop being dealt after
   * the early rounds, so from then on it can never be closed, and the castle behind it
   * is lost for good. Clearance alone did not separate this from a cannon against an
   * inland wall, which leaves a piece somewhere to land: every spot in a tight ring
   * touches some wall, and the tie went to range — toward the enemy, which is where the
   * coast usually is.
   */
  private pinnedWalls(
    state: MatchState,
    islandId: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): number {
    const buildable = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return false;
      const i = ty * state.width + tx;
      if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== islandId) return false;
      const s = state.structure[i];
      return s === Structure.Empty || s === Structure.Wall;
    };
    let pinned = 0;
    const check = (tx: number, ty: number, dx: number, dy: number): void => {
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return;
      const i = ty * state.width + tx;
      if (state.structure[i] !== Structure.Wall || state.islandId[i] !== islandId) return;
      if (!buildable(tx + dx, ty + dy)) pinned++;
    };
    for (let ox = 0; ox < w; ox++) {
      check(x + ox, y - 1, 0, -1);
      check(x + ox, y + h, 0, 1);
    }
    for (let oy = 0; oy < h; oy++) {
      check(x - 1, y + oy, -1, 0);
      check(x + w, y + oy, 1, 0);
    }
    return pinned;
  }

  /**
   * Chebyshev distance from every tile to the nearest thing a cannon should stand off
   * from: this player's own wall, or water.
   *
   * Own wall, because that is what has to be repaired under fire. Water, because a wall
   * that runs along the coast has nothing behind it either — a cannon pressed against
   * the shore leaves the future wall there the same one-tile gap.
   *
   * Eight-connected unit steps, which is exactly Chebyshev distance, and one pass over
   * the board rather than a scan per candidate.
   */
  private clearanceField(state: MatchState, islandId: number): Int32Array {
    const size = state.width * state.height;
    const dist = new Int32Array(size).fill(0x7fffffff);
    const queue = new Int32Array(size);
    let tail = 0;

    for (let i = 0; i < size; i++) {
      const hazard =
        state.terrain[i] === Terrain.Water ||
        (state.structure[i] === Structure.Wall && state.islandId[i] === islandId);
      if (!hazard) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }

    for (let head = 0; head < tail; head++) {
      const i = queue[head] as number;
      const x = i % state.width;
      const y = (i - x) / state.width;
      const next = (dist[i] as number) + 1;
      for (const [ox, oy] of NEIGHBOURS_8) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
        const j = ny * state.width + nx;
        if (dist[j] !== 0x7fffffff) continue;
        dist[j] = next;
        queue[tail++] = j;
      }
    }
    return dist;
  }
}
