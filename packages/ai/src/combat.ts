import {
  variantConfig,
  variantOf,
  type BotProfile,
  type LightningVariant,
  type TowerCost,
} from '@bollwerk/config';
import {
  Structure,
  Terrain,
  craterTilesOf,
  heldValue,
  isImpactTower,
  isLoaded,
  holdingsOf,
  sameTeam,
  strikable,
  type Action,
  type Cannon,
  type Holding,
  type MatchState,
  type Rng,
} from '@bollwerk/sim';

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
  /** The tick each of its guns was first seen ready since it last fired. */
  private readonly readySince = new Map<number, number>();
  /** Where and when its last shot went, for a shot fired there again by mistake. */
  private lastShot: { x: number; y: number; tick: number } | null = null;

  shoot(state: MatchState, rng: Rng): Action | null {
    // Never ask to fire a gun that is still reloading: the rules would refuse it. Nor one that
    // has not stood ready for `readyDelayMs`, the time a person takes to notice it.
    // Not `ticksFor`, which waits a tick at least: no delay is none.
    const delay = Math.round((this.profile.readyDelayMs * state.ruleset.tickRateHz) / 1000);
    let ready = false;
    for (const cannon of state.cannons) {
      if (cannon.owner !== this.playerId || !cannon.active || !isLoaded(cannon)) {
        this.readySince.delete(cannon.id);
        continue;
      }
      let since = this.readySince.get(cannon.id);
      if (since === undefined) this.readySince.set(cannon.id, (since = state.tick));
      if (state.tick - since >= delay) ready = true;
    }
    if (!ready || state.tick < this.nextShotTick) return null;

    const aimed = this.pickTarget(state, rng);
    this.nextShotTick = state.tick + ticksFor(this.profile.fireIntervalMs, state);
    if (aimed === null || aimed.kind !== 'fire') return aimed;
    const shot = this.missed(state, rng, aimed);
    this.lastShot = { x: shot.x, y: shot.y, tick: state.tick };
    return shot;
  }

  /**
   * The shot as fired: where it was aimed, or — one time in `1 - ownAccuracy` — wasted as the
   * testers' were (ARCHIVE 13r), half on the tile its last shot went to, clicked twice, and
   * half on a tile of land beside the wall aimed at. People never missed by more than a
   * tile, nor into the sea. A perfect level draws nothing, so it plays exactly as before.
   */
  private missed(
    state: MatchState,
    rng: Rng,
    aimed: Extract<Action, { kind: 'fire' }>,
  ): Extract<Action, { kind: 'fire' }> {
    if (this.profile.ownAccuracy >= 1 || rng.nextFloat() < this.profile.ownAccuracy) return aimed;
    const last = this.lastShot;
    const recent =
      last !== null && state.tick - last.tick <= ticksFor(this.profile.doubleWithinMs, state);
    if (recent && rng.nextFloat() < this.profile.doubleShare) {
      return { ...aimed, x: last.x, y: last.y };
    }
    const beside: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = aimed.x + dx;
        const y = aimed.y + dy;
        if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= state.width || y >= state.height) {
          continue;
        }
        const i = y * state.width + x;
        if (state.structure[i] === Structure.Wall || state.terrain[i] === Terrain.Water) continue;
        // The rules refuse a shot at its own island or a teammate's.
        const island = state.islandId[i] as number;
        if (island !== 0 && sameTeam(state, this.playerId, island - 1)) continue;
        beside.push(i);
      }
    }
    if (beside.length === 0) return aimed;
    const i = beside[rng.nextInt(beside.length)] as number;
    const x = i % state.width;
    return { ...aimed, x, y: (i - x) / state.width };
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

    // A ready impact tower fires before any gun (`findReadyCannon`), so this shot is its:
    // aimed where its crater takes most of the weakest wall. Drawn only when one is ready,
    // so a table without towers draws exactly as before.
    const tower = this.readyImpactTower(state);
    if (tower !== null && rng.nextFloat() >= this.profile.aimJitter) {
      const chosen = this.craterTarget(state, tower, this.chooseOpponent(state, rng), taken);
      if (chosen !== null) {
        const x = chosen % state.width;
        return { kind: 'fire', player: this.playerId, x, y: (chosen - x) / state.width };
      }
    }

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

    // A worse target: any wall of a rival, the rival drawn by nearness — a person's lapse is
    // a wall nearby, not one across the map (ARCHIVE 13r). Only a live rival's: your own and
    // a teammate's are refused, and an eliminated player's rubble changes nothing when hit.
    const rivals = rivalsOf(state, this.playerId);
    const weights = this.nearness(state, rivals);
    while (rivals.length > 0) {
      const total = weights.reduce((a, b) => a + b, 0);
      let pick = rng.nextFloat() * total;
      let k = 0;
      while (k < rivals.length - 1 && pick >= (weights[k] as number))
        pick -= weights[k++] as number;
      const island = (rivals[k] as (typeof rivals)[number]).islandId;
      const walls: number[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] === Structure.Wall && state.owner[i] === island && !taken.has(i)) {
          walls.push(i);
        }
      }
      if (walls.length > 0) {
        const i = walls[rng.nextInt(walls.length)] as number;
        const x = i % state.width;
        return { kind: 'fire', player: this.playerId, x, y: (i - x) / state.width };
      }
      rivals.splice(k, 1);
      weights.splice(k, 1);
    }
    return null;
  }

  /**
   * How near each rival is, as a weight: 1 for the nearest, `(nearest / distance) **
   * rivalDistanceExponent` for the rest, so a rival twice as far must be that many times the
   * threat to be chosen. People shot mostly at their nearest rivals, and at a far one only when
   * it threatened most: unweighed, bots at eight players sent half their shots past their three
   * nearest rivals where a person sent a fifth, and the longer flights cost them a third of
   * their shots (ARCHIVE 13r).
   */
  private nearness(state: MatchState, rivals: MatchState['players']): number[] {
    const me = this.islands.centre(state, state.players[this.playerId]?.islandId ?? 0);
    // An island with no land, as on some test boards, has no centre: then nearness says nothing.
    if (!Number.isFinite(me.x)) return rivals.map(() => 1);
    const distances = rivals.map((p) => {
      const c = this.islands.centre(state, p.islandId);
      return Math.max(1, Math.hypot(c.x - me.x, c.y - me.y));
    });
    const nearest = Math.min(...distances);
    return distances.map((d) => (nearest / d) ** this.profile.rivalDistanceExponent);
  }

  /** Its ready impact tower, which fires next whatever is aimed at; or null. */
  private readyImpactTower(state: MatchState): Cannon | null {
    for (const cannon of state.cannons) {
      if (cannon.owner !== this.playerId || !cannon.active || !isLoaded(cannon)) continue;
      if (isImpactTower(cannon.kind)) return cannon;
    }
    return null;
  }

  /**
   * Where a crater takes most of an opponent's wall: centred on a block of their weakest
   * wall or beside it, each block of it the crater clears counting three and any other of a
   * rival's wall one. Never centred where its own shot is headed; null when nothing scores.
   */
  private craterTarget(
    state: MatchState,
    tower: Cannon,
    opponent: number,
    taken: ReadonlySet<number>,
  ): number | null {
    const weakest = new Set(weakestWall(state, opponent));
    if (weakest.size === 0) return null;
    if (tower.kind === 'lightning') return this.lightningTarget(state, tower, weakest, taken);
    const offsets = craterTilesOf(state.ruleset, tower.kind, tower.cost);
    const rivalWall = (i: number): boolean => {
      if (state.structure[i] !== Structure.Wall) return false;
      const owner = state.owner[i] as number;
      return owner !== 0 && !sameTeam(state, this.playerId, owner - 1);
    };
    let best: number | null = null;
    let bestScore = 0;
    const seen = new Set<number>();
    for (const block of weakest) {
      const bx = block % state.width;
      const by = (block - bx) / state.width;
      for (const [ox, oy] of [[0, 0], ...offsets] as const) {
        const cx = bx + ox;
        const cy = by + oy;
        if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height) continue;
        const centre = cy * state.width + cx;
        if (seen.has(centre) || taken.has(centre)) continue;
        seen.add(centre);
        // The rules refuse a shot at its own island or a teammate's.
        const island = state.islandId[centre] as number;
        if (island !== 0 && sameTeam(state, this.playerId, island - 1)) continue;
        let score = 0;
        for (const [dx, dy] of offsets) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
          const i = y * state.width + x;
          if (rivalWall(i)) score += weakest.has(i) ? 3 : 1;
        }
        if (score > bestScore) {
          bestScore = score;
          best = centre;
        }
      }
    }
    return best;
  }

  /**
   * Where a Lightning Tower's strike starts best: a block of the weakest wall, which the first
   * strike takes, with the most of rivals' wall within the jump's reach for the chain to find
   * — the weakest wall's blocks counting three. Its own shots' tiles are passed over.
   */
  private lightningTarget(
    state: MatchState,
    tower: Cannon,
    weakest: ReadonlySet<number>,
    taken: ReadonlySet<number>,
  ): number | null {
    const config = variantConfig(
      state.ruleset.specials,
      variantOf('lightning', tower.cost as TowerCost),
    ) as LightningVariant;
    const r = config.jumpRadius;
    const reach = Math.floor(r);
    let best: number | null = null;
    let bestScore = -1;
    for (const block of weakest) {
      if (taken.has(block)) continue;
      const bx = block % state.width;
      const by = (block - bx) / state.width;
      let score = 0;
      for (let y = Math.max(0, by - reach); y <= Math.min(state.height - 1, by + reach); y++) {
        for (let x = Math.max(0, bx - reach); x <= Math.min(state.width - 1, bx + reach); x++) {
          if ((x - bx) ** 2 + (y - by) ** 2 > r * r) continue;
          const i = y * state.width + x;
          if (strikable(state, this.playerId, i)) score += weakest.has(i) ? 3 : 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = block;
      }
    }
    return best;
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
        // Whoever earns most a round now, by the scoring's own formula, with the banked
        // score to break a tie: the one about to run away with it.
        const holdings = holdingsOf(state);
        // Weighed by nearness: a far leader is chased only when far ahead.
        const near = this.nearness(state, rivals);
        const rate = (p: (typeof rivals)[number]): number =>
          heldValue(state.ruleset.scoring, holdings[p.id] as Holding) *
          (near[rivals.indexOf(p)] as number);
        const leader = rivals.reduce((best, p) =>
          rate(p) > rate(best) || (rate(p) === rate(best) && p.score > best.score) ? p : best,
        );
        return this.breachOf(state, leader.id, taken);
      }
      case 'finisher': {
        // The weakest: fewest lives left in their pool, then fewest castles sealed, then the
        // thinnest wall — worked along to force the failed round that takes a life. Among the
        // rivals within twice the nearest's distance: weakness is no threat to chase far.
        const near = this.nearness(state, rivals);
        const reach = 0.5 ** this.profile.rivalDistanceExponent;
        const close = rivals.filter((_, k) => (near[k] as number) >= reach - 1e-9);
        const lives = (p: (typeof rivals)[number]): number =>
          state.teams[p.team]?.continuesRemaining ?? 0;
        const walls = new Map(close.map((p) => [p.id, weakestWall(state, p.id)]));
        const thin = (id: number): number => walls.get(id)?.length ?? 0;
        const weakest = close.reduce((best, p) => {
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

  /** The opponent who threatens most, so a leader is not left to run away with it: by nearness. */
  private chooseOpponent(state: MatchState, rng: Rng): number {
    // Rivals are the other teams — a teammate is never a target.
    const rivals = rivalsOf(state, this.playerId);
    if (rivals.length === 0) return this.playerId;
    if (!this.profile.picksTarget) {
      return (rivals[rng.nextInt(rivals.length)] as (typeof rivals)[number]).id;
    }
    const near = this.nearness(state, rivals);
    const score = (p: (typeof rivals)[number]): number =>
      (p.enclosedCastles * 10 + state.cannons.filter((c) => c.owner === p.id && c.active).length) *
      (near[rivals.indexOf(p)] as number);
    let best = rivals[0] as (typeof rivals)[number];
    for (const rival of rivals) if (score(rival) > score(best)) best = rival;
    return best.id;
  }
}
