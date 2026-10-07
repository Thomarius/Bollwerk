import { type BotProfile } from '@bollwerk/config';
import { Structure, sameTeam, type Action, type MatchState, type Rng } from '@bollwerk/sim';

import type { IslandCentres } from './botTurn.js';
import { rivalsOf, ticksFor } from './botTurn.js';
import { weakestWall } from './tactics.js';

/**
 * A bot's guns: which wall to shoot and when — breaching the opponent who threatens most,
 * or where its targeting trait says — and whose shots have been landing on its own walls.
 */
export class Gunner {
  constructor(
    private readonly playerId: number,
    private readonly profile: BotProfile,
    private readonly islands: IslandCentres,
  ) {}

  private nextShotTick = 0;

  shoot(state: MatchState, rng: Rng): Action | null {
    if (state.tick < this.nextShotTick) return null;

    // Never ask to fire a gun that is still reloading: the rules would refuse it.
    let ready = false;
    for (const cannon of state.cannons) {
      if (cannon.owner === this.playerId && cannon.active && cannon.shotId === null) {
        ready = true;
        break;
      }
    }
    if (!ready) return null;

    const target = this.pickTarget(state, rng);
    this.nextShotTick = state.tick + ticksFor(this.profile.fireIntervalMs, state);
    return target;
  }

  /**
   * Tiles this bot's own shots are already on their way to.
   *
   * A shot destroys exactly the tile it hits, so a second shot at the same tile is
   * always wasted — and with a three-second flight and a gun firing every 150ms, a
   * bot that did not track this put its whole opening salvo into one block. Only its
   * own shots, though: a person is shown where their own shots will land and nobody
   * else's (PLAN 11.14), so a bot must not know either. Two players' shots at one tile
   * race — the first to land takes it and its points, the second hits nothing.
   */
  private inbound(state: MatchState): Set<number> {
    const taken = new Set<number>();
    for (const shot of state.shots) {
      if (shot.owner === this.playerId) taken.add(shot.toY * state.width + shot.toX);
    }
    return taken;
  }

  private pickTarget(state: MatchState, rng: Rng): Action | null {
    const taken = this.inbound(state);

    if (rng.nextFloat() >= this.profile.aimJitter) {
      // A share of aimed shots goes where the targeting trait says (PLAN 11.6), the rest
      // by the neutral rule — breach whoever threatens most — so no bot fires one way only.
      const own = rng.nextFloat() < this.profile.targetShare;
      const tile = own ? this.traitTarget(state, taken) : null;
      const chosen = tile ?? this.breachOf(state, this.chooseOpponent(state, rng), taken);
      if (chosen !== null) {
        const x = chosen % state.width;
        return { kind: 'fire', player: this.playerId, x, y: (chosen - x) / state.width };
      }
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rng.nextInt(state.width);
      const y = rng.nextInt(state.height);
      const i = y * state.width + x;
      if (state.structure[i] !== Structure.Wall || taken.has(i)) continue;
      // Only an opponent's: your own island and a teammate's are refused.
      const island = state.islandId[i] as number;
      if (island === 0 || sameTeam(state, this.playerId, island - 1)) continue;
      // Rubble left by an eliminated player is nobody's, and only an opponent's wall
      // can be damaged, so a shot there would land and change nothing.
      if (state.owner[i] === 0) continue;
      return { kind: 'fire', player: this.playerId, x, y };
    }
    return null;
  }

  /** The thin part of each opponent's wall, worked along a block at a time, per opponent. */
  private breaches = new Map<number, { tiles: number[]; at: number }>();

  /**
   * The next block of an opponent's weakest wall — one shot per block, moving on whether
   * or not this one has landed yet — or null when there is none left to shoot.
   */
  private breachOf(
    state: MatchState,
    opponent: number,
    taken: ReadonlySet<number>,
    /** `weakestWall` of the opponent on this board, when the caller has it already. */
    weakest?: readonly number[],
  ): number | null {
    let breach = this.breaches.get(opponent);
    if (breach === undefined || state.tick - breach.at > 20 || breach.tiles.length === 0) {
      breach = { tiles: weakest?.slice() ?? weakestWall(state, opponent), at: state.tick };
      this.breaches.set(opponent, breach);
    }
    while (breach.tiles.length > 0) {
      const i = breach.tiles.shift() as number;
      if (state.structure[i] === Structure.Wall && !taken.has(i)) return i;
    }
    return null;
  }

  /** Where the targeting trait sends a shot, or null to leave it to the neutral rule. */
  private traitTarget(state: MatchState, taken: ReadonlySet<number>): number | null {
    const rivals = rivalsOf(state, this.playerId);
    if (rivals.length === 0) return null;
    switch (this.profile.targeting) {
      case 'points':
        return this.nearestWall(state, rivals, taken);
      case 'strategic': {
        // Whoever earns most a round now — territory times castles, the scoring formula —
        // with the banked score to break a tie: the one about to run away with it.
        const tiles = new Array<number>(state.players.length).fill(0);
        for (let i = 0; i < state.territory.length; i++) {
          const owner = state.territory[i] as number;
          if (owner > 0) tiles[owner - 1] = (tiles[owner - 1] as number) + 1;
        }
        const rate = (p: (typeof rivals)[number]): number =>
          (tiles[p.id] as number) * p.enclosedCastles;
        const leader = rivals.reduce((best, p) =>
          rate(p) > rate(best) || (rate(p) === rate(best) && p.score > best.score) ? p : best,
        );
        return this.breachOf(state, leader.id, taken);
      }
      case 'finisher': {
        // The weakest: fewest lives left in their pool, then fewest castles sealed, then the
        // thinnest wall — worked along to force the failed round that takes a life.
        const lives = (p: (typeof rivals)[number]): number =>
          state.teams[p.team]?.continuesRemaining ?? 0;
        const walls = new Map(rivals.map((p) => [p.id, weakestWall(state, p.id)]));
        const thin = (id: number): number => walls.get(id)?.length ?? 0;
        const weakest = rivals.reduce((best, p) => {
          const a = [lives(p), p.enclosedCastles, thin(p.id)];
          const b = [lives(best), best.enclosedCastles, thin(best.id)];
          for (let k = 0; k < a.length; k++) {
            if ((a[k] as number) !== (b[k] as number))
              return (a[k] as number) < (b[k] as number) ? p : best;
          }
          return best;
        });
        return this.breachOf(state, weakest.id, taken, walls.get(weakest.id));
      }
      case 'grudge': {
        // Whoever hit it hardest last round; nobody, and the neutral rule decides.
        let foe = -1;
        let most = 0;
        for (const [shooter, count] of this.grudge.last) {
          const rival = rivals.find((p) => p.id === shooter);
          if (rival !== undefined && count > most) {
            most = count;
            foe = shooter;
          }
        }
        return foe < 0 ? null : this.breachOf(state, foe, taken);
      }
    }
  }

  /**
   * Point-maximizing: the nearest opponent's walls, the block closest to one of its own
   * guns first. Flight time is the reload, so the shortest shots are the most shots, and
   * any wall tile scores alike — so it does not hunt for the weak point; breaching is left
   * to the neutral share.
   */
  private nearestWall(
    state: MatchState,
    rivals: MatchState['players'],
    taken: ReadonlySet<number>,
  ): number | null {
    const guns = state.cannons.filter((c) => c.owner === this.playerId && c.active);
    if (guns.length === 0) return null;
    const at = (island: number): { x: number; y: number } => this.islands.centre(state, island);
    const me = at(state.players[this.playerId]?.islandId ?? 0);
    const nearest = rivals.reduce((best, p) => {
      const a = at(p.islandId);
      const b = at(best.islandId);
      return (a.x - me.x) ** 2 + (a.y - me.y) ** 2 < (b.x - me.x) ** 2 + (b.y - me.y) ** 2
        ? p
        : best;
    });
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== nearest.islandId) continue;
      if (taken.has(i)) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      for (const gun of guns) {
        const d = (gun.x - x) ** 2 + (gun.y - y) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
    }
    return best;
  }

  /**
   * Shots aimed at this bot's walls, by shooter, this round and last — for grudge. Read
   * from the shots in the air as they appear, so it follows the state alone.
   */
  private grudge = {
    round: -1,
    seen: new Set<number>(),
    current: new Map<number, number>(),
    last: new Map<number, number>(),
  };

  noteShots(state: MatchState): void {
    const g = this.grudge;
    if (g.round !== state.round) {
      g.last = g.current;
      g.current = new Map();
      g.seen.clear();
      g.round = state.round;
    }
    const island = state.players[this.playerId]?.islandId;
    for (const shot of state.shots) {
      if (g.seen.has(shot.id)) continue;
      g.seen.add(shot.id);
      const i = shot.toY * state.width + shot.toX;
      if (state.islandId[i] !== island || state.structure[i] !== Structure.Wall) continue;
      g.current.set(shot.owner, (g.current.get(shot.owner) ?? 0) + 1);
    }
  }

  /** The opponent closest to winning, so a leader is not left to run away with it. */
  private chooseOpponent(state: MatchState, rng: Rng): number {
    // Rivals are the other teams — a teammate is never a target.
    const rivals = rivalsOf(state, this.playerId);
    if (rivals.length === 0) return this.playerId;
    if (!this.profile.picksTarget) {
      return (rivals[rng.nextInt(rivals.length)] as (typeof rivals)[number]).id;
    }
    let best = rivals[0] as (typeof rivals)[number];
    const score = (p: typeof best): number =>
      p.enclosedCastles * 10 + state.cannons.filter((c) => c.owner === p.id && c.active).length;
    for (const rival of rivals) if (score(rival) > score(best)) best = rival;
    return best.id;
  }
}
