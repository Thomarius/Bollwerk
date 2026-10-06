import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  type AiConfig,
  type BotProfile,
  type BotSetup,
} from '@bollwerk/config';
import {
  NEIGHBOURS_8,
  Structure,
  cannonReward,
  computeEnclosure,
  Terrain,
  canPlaceCannon,
  canPlacePiece,
  currentPieceId,
  distanceSquared,
  pieceById,
  pieceCells,
  sameTeam,
  type Action,
  type MatchState,
  type Rng,
} from '@bollwerk/sim';

import { PlanningSlots } from './planning.js';
import {
  cannonRoom,
  cheapestPlanFor,
  outerSkin,
  pocketCount,
  pocketPlan,
  sealOptions,
  thickenTargets,
  weakestWall,
  type PocketPlan,
  type SealPlan,
} from './tactics.js';

/** How long a bot waits before looking again when it found nothing to do. */
const IDLE_RETRY_MS = 250;

/** How far from a castle a cannon is taken to belong to it. */
const GUN_REACH = 12;

/**
 * A breach an offensive bot may close with a roomier wall than it had (PLAN 11.6): its
 * tightest repair, in blocks, at most this. Agreed with the user as the start.
 */
const SMALL_REPAIR = 4;

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

/**
 * A bot.
 *
 * It plays through the same validated action API as a person, so it cannot cheat by
 * construction, and it acts at a human pace rather than a machine one: placement and
 * firing are limited by time in milliseconds, not by a per-tick probability.
 *
 * Within a build phase it works down a ladder — stay alive, then make room, then take
 * more ground, then thicken what it has — which is roughly the order a person's
 * attention goes.
 */
export class Bot {
  private readonly profile: BotProfile;

  private plan: number[] = [];
  private plannedAt = -1;
  private planRound = -1;
  /** Cut tiles no piece could reach; the next plan routes around them. */
  private unreachable = new Set<number>();

  private nextPlacementTick = 0;
  private nextCannonTick = 0;
  private nextShotTick = 0;

  /** How well and how it plays: a level's skill under a personality (PLAN 11.6). */
  readonly setup: BotSetup;

  /**
   * @param slots shared by every bot at the table, so they do not all plan on one tick;
   * a bot alone, as in tests, is never held back.
   */
  constructor(
    readonly playerId: number,
    setup: BotSetup = { level: 5, personality: BALANCED },
    ai: AiConfig = defaultAiConfig,
    private readonly slots: PlanningSlots = new PlanningSlots(),
  ) {
    this.setup = setup;
    this.profile = botProfile(ai, setup);
  }

  think(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.eliminated) return null;
    this.noteShots(state);

    switch (state.phase) {
      case 'castle_select':
        return this.chooseCastle(state, rng);
      case 'combat':
        return this.shoot(state, rng);
      case 'build':
        return this.build(state, rng);
      case 'cannon_place':
        // A bot that has just spent a continue owes a castle before it owes anything
        // else: without one it has no territory, so no gun has anywhere to stand.
        if (state.players[this.playerId]?.startingCastleId === null) {
          return this.chooseCastle(state, rng);
        }
        return this.placeCannon(state, rng);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ timing

  private ticks(ms: number, state: MatchState): number {
    return Math.max(1, Math.round((ms * state.ruleset.tickRateHz) / 1000));
  }

  /** Stands down briefly after a fruitless look, rather than retrying every tick. */
  private pause(state: MatchState): void {
    this.nextPlacementTick = state.tick + this.ticks(IDLE_RETRY_MS, state);
  }

  /** How long this bot takes over a piece; a larger shape takes longer to fit. */
  private placementMs(cells: number): number {
    return this.profile.placementBaseMs + this.profile.placementPerCellMs * cells;
  }

  /**
   * Pieces it could still lay before the phase ends.
   *
   * This is what turns "should I reach for a second castle?" from a guess into a
   * question with an answer: a slower bot is correctly more cautious, because it
   * genuinely has fewer pieces left to spend.
   */
  private piecesAffordable(state: MatchState): number {
    const ticksLeft = Math.max(0, state.phaseEndTick - state.tick);
    const msLeft = (ticksLeft * 1000) / state.ruleset.tickRateHz;
    const averagePiece = this.placementMs(3.5);
    return msLeft / averagePiece;
  }

  // ------------------------------------------------------------------ combat

  private shoot(state: MatchState, rng: Rng): Action | null {
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
    this.nextShotTick = state.tick + this.ticks(this.profile.fireIntervalMs, state);
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
  private breachOf(state: MatchState, opponent: number, taken: ReadonlySet<number>): number | null {
    let breach = this.breaches.get(opponent);
    if (breach === undefined || state.tick - breach.at > 20 || breach.tiles.length === 0) {
      breach = { tiles: weakestWall(state, opponent), at: state.tick };
      this.breaches.set(opponent, breach);
    }
    while (breach.tiles.length > 0) {
      const i = breach.tiles.shift() as number;
      if (state.structure[i] === Structure.Wall && !taken.has(i)) return i;
    }
    return null;
  }

  /** Rivals still in it: never a teammate. */
  private rivals(state: MatchState): MatchState['players'] {
    return state.players.filter((p) => !p.eliminated && !sameTeam(state, this.playerId, p.id));
  }

  /** Where the targeting trait sends a shot, or null to leave it to the neutral rule. */
  private traitTarget(state: MatchState, taken: ReadonlySet<number>): number | null {
    const rivals = this.rivals(state);
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
        const thin = new Map(rivals.map((p) => [p.id, weakestWall(state, p.id).length]));
        const weakest = rivals.reduce((best, p) => {
          const a = [lives(p), p.enclosedCastles, thin.get(p.id) ?? 0];
          const b = [lives(best), best.enclosedCastles, thin.get(best.id) ?? 0];
          for (let k = 0; k < a.length; k++) {
            if ((a[k] as number) !== (b[k] as number))
              return (a[k] as number) < (b[k] as number) ? p : best;
          }
          return best;
        });
        return this.breachOf(state, weakest.id, taken);
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
    const at = (island: number): { x: number; y: number } => this.islandCentre(state, island);
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

  /** Island middles, measured once each: islands never move. */
  private readonly centres = new Map<number, { x: number; y: number }>();

  private islandCentre(state: MatchState, island: number): { x: number; y: number } {
    let centre = this.centres.get(island);
    if (centre === undefined) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < state.islandId.length; i++) {
        if (state.islandId[i] !== island) continue;
        sx += i % state.width;
        sy += Math.floor(i / state.width);
        n++;
      }
      centre = { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
      this.centres.set(island, centre);
    }
    return centre;
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

  private noteShots(state: MatchState): void {
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
    const rivals = state.players.filter(
      (p) => !p.eliminated && !sameTeam(state, this.playerId, p.id),
    );
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

  // ------------------------------------------------------------------- build

  private build(state: MatchState, rng: Rng): Action | null {
    // Check the clock before anything else: this runs for every bot on every tick,
    // and looking the piece up first made that lookup the bot's largest single cost.
    if (state.tick < this.nextPlacementTick) return null;
    const pieceId = currentPieceId(state, this.playerId);

    // Last round's dead ends mean nothing now that the board has changed.
    if (this.planRound !== state.round) {
      this.planRound = state.round;
      this.unreachable.clear();
      this.plan = [];
      this.plannedAt = -1;
    }

    if (this.plannedAt < 0 || state.tick - this.plannedAt > this.profile.replanTicks) {
      // No plan left at the table this tick: try again on the next.
      if (!this.slots.take(state.tick)) return null;
      this.plan = this.decide(state);
      this.plannedAt = state.tick;
    }

    // What to build, most urgent first, tried in turn until a piece fits one of them.
    // Stopping is almost never right: a piece not laid is wall the bot will wish it had
    // when the barrage starts. Measured before this existed: gunner and recruit laid 65%
    // of the pieces they had time for. And a failed fit falls through to the next
    // choice rather than pausing — a bot whose thickening targets no piece could reach
    // used to mark them, pause, replan, get the same targets back, and stand idle for
    // the rest of the phase beside a castle it had not finished walling.
    const thickens = this.profile.thickens;
    // Spare work plans afresh at every placement, so it takes a plan from the table; with
    // none left this tick, the bot waits for the next rather than skip to the outer skin.
    let deferred = false;
    const choices: (() => number[])[] = [
      () => this.plan,
      // Outward only, which `thickenTargets` guarantees — a second layer laid on the
      // inside stands where a cannon could have stood.
      () => (thickens ? thickenTargets(state, this.playerId) : []),
      () => {
        if (this.slots.take(state.tick)) return this.spareWork(state);
        deferred = true;
        return [];
      },
      () => (thickens ? outerSkin(state, this.playerId) : []),
    ];
    let placement: { x: number; y: number; rotation: number } | null = null;
    let tried = false;
    for (const choice of choices) {
      const tiles = choice();
      if (deferred) return null;
      const wanted = tiles.filter(
        (i) => state.structure[i] === Structure.Empty && !this.unreachable.has(i),
      );
      if (wanted.length === 0) continue;
      tried = true;
      placement = this.fit(state, pieceId, wanted, rng);
      if (placement !== null) break;
      // Nothing legal reaches any of these tiles — a gap with no free neighbours
      // cannot take a piece. Rule them out so the next plan routes around them.
      for (const tile of wanted) this.unreachable.add(tile);
    }

    if (placement === null) {
      if (tried) this.plannedAt = -1;
      // And wait before trying again. Forcing a replan without also standing down
      // meant re-planning on every tick, which cost more than the entire rest of the
      // match put together.
      this.pause(state);
      return null;
    }

    this.nextPlacementTick =
      state.tick + this.ticks(this.placementMs(pieceById(pieceId).size), state);
    return { kind: 'place_piece', player: this.playerId, ...placement };
  }

  /**
   * What to build once the plan is standing and there is nothing left to thicken.
   *
   * Idling is almost never right. A build phase the bot does not spend is wall it will
   * wish it had, and the two things worth starting are both worth starting even when
   * they cannot be finished this round: a part-built extension of a live wall still
   * touches territory, so the sweep leaves it standing and the work carries over into
   * the next phase. That is the difference between an expansion that takes two rounds
   * and one that never happens.
   *
   * Affordability is deliberately not consulted here. It governs whether to *commit*
   * to a plan over staying alive, which is the gamble ARCHIVE.md 10d found you must not
   * take. Spending time nobody else wants is not that gamble.
   */
  private spareWork(state: MatchState): number[] {
    const player = state.players[this.playerId];
    if (player === undefined) return [];
    const sealed = player.enclosedCastles;

    // Another castle is another cannon a round, a spare life, and under points a larger
    // multiplier. Start it even if this phase cannot close it — and reach for every
    // castle on the island, not only the tier's ambition: that bounds what a bot commits
    // to, and this is time nobody else wants.
    const onIsland = state.castles.filter((c) => c.islandId === player.islandId).length;
    if (sealed < onIsland) {
      const next = cheapestPlanFor(
        state,
        this.playerId,
        sealed + 1,
        onIsland,
        this.unreachable,
        true,
        this.profile.roomRadius,
      );
      const tiles = next?.tiles.filter((i) => state.structure[i] === Structure.Empty) ?? [];
      if (tiles.length > 0) return tiles;
    }

    // No castle worth reaching for: take in more open ground instead, which is where
    // the cannons this wall earns will have to stand.
    const roomier = cheapestPlanFor(
      state,
      this.playerId,
      Math.max(1, sealed),
      this.profile.maxCastles,
      this.unreachable,
      true,
      this.profile.roomRadius + 2,
    );
    return roomier?.tiles.filter((i) => state.structure[i] === Structure.Empty) ?? [];
  }

  /**
   * The widest wall this phase can pay for, rather than the tightest one that works.
   *
   * This is the correction to the planner's central bias. A minimum cut is by
   * definition the *tightest* wall that works, so asking it for a wall and taking what
   * it returns means always choosing the one with nowhere to put a gun — a bot that
   * defends perfectly, cannot spend a single cannon it earns, and cannot win. Measured
   * before this existed: gunner and marshal held room for 0.3 cannons behind a 37-tile
   * ring, with half their guns idle.
   *
   * So room is asked for first and surrendered only to the budget, one tile of band at
   * a time. A tight wall is still reachable, as the last rung rather than the first.
   */
  private widestAffordable(
    state: MatchState,
    atLeastCastles: number,
    keepCannons: boolean,
    budget: number,
  ): SealPlan | null {
    for (let radius = this.profile.roomRadius; radius >= 0; radius--) {
      const plan = cheapestPlanFor(
        state,
        this.playerId,
        atLeastCastles,
        this.profile.maxCastles,
        this.unreachable,
        keepCannons,
        radius,
      );
      if (plan !== null && plan.cost / 3.5 <= budget) return plan;
    }
    return null;
  }

  /**
   * What to build, in order of what would hurt most to be without.
   *
   * 1. Stay alive. Enclose something, or everything else is moot.
   * 2. Make room. Cannons need sealed 2x2 ground; without it the reward is unspendable.
   * 3. Take more ground. Another castle is another cannon a round, and a spare life.
   * 4. Thicken. A minimum cut is one block thick, so every block of it is load-bearing.
   */
  private decide(state: MatchState): number[] {
    const player = state.players[this.playerId];
    if (!player) return [];
    // Counted afresh rather than read from `enclosedCastles`, which placements and
    // resolutions refresh but landing shots do not: as a breached build phase opens it
    // still says sealed, and the first plan of the phase was made for a wall that stood.
    const enclosure = computeEnclosure(state);
    const sealed = enclosure.enclosedCastlesByPlayer[this.playerId] ?? 0;
    const mainSealed =
      player.startingCastleId !== null &&
      enclosure.castleEnclosed[player.startingCastleId] === true;
    const budget = this.piecesAffordable(state) * this.profile.riskMargin;
    const affordable = (plan: SealPlan | null): boolean =>
      plan !== null && plan.cost / 3.5 <= budget;

    if (sealed === 0) {
      // Close the breach before anything else, with the tightest wall that keeps the
      // guns; room is bought afterwards, once something is sealed, by the branches
      // below. Asking for the roomy wall first is what lost rounds: every failed round
      // in a 2026-09-25 soak had a repair of 3-12 cells against a budget of 42-47, and
      // ended 1-3 cells short with the phase spent on a wider plan that did not close.
      // Tight first took marshal from 26% of rounds forfeited to 9%, and from 7 of 11
      // wins against two gunners to 10 of 12.
      const tight = cheapestPlanFor(
        state,
        this.playerId,
        1,
        this.profile.maxCastles,
        this.unreachable,
        true,
        0,
      );
      // An offensive bot with only a small breach closes it with a roomier wall than it
      // had, taking in more ground in the same repair — when that roomier wall fits the
      // pieces it can still lay this phase, not a hopeful fraction more. Otherwise it
      // repairs tight like everyone: the widest-first repair of 10s lost a quarter of all
      // rounds, and a small breach is the one case where there is time to spare.
      if (this.profile.widensWhileRepairing && tight !== null && tight.cost <= SMALL_REPAIR) {
        const pieces = this.piecesAffordable(state);
        for (let radius = this.profile.roomRadius + 1; radius >= 1; radius--) {
          const wide = cheapestPlanFor(
            state,
            this.playerId,
            1,
            this.profile.maxCastles,
            this.unreachable,
            true,
            radius,
          );
          if (wide !== null && wide.cost / 3.5 <= pieces) return wide.tiles;
        }
      }
      if (affordable(tight)) return (tight as SealPlan).tiles;

      // Reaching for two castles while unenclosed is the real gamble: it is more
      // cannons if it lands and elimination if it does not. Only when it clearly fits —
      // and only searched when the cheapest pair at no room fits, since no wider wall
      // round two castles costs less. Late in a phase nothing fits, and the search at
      // every width was a third of a plan of 30 ms where 5 is usual (PLAN 11).
      if (
        this.profile.maxCastles > 1 &&
        affordable(
          cheapestPlanFor(state, this.playerId, 2, this.profile.maxCastles, this.unreachable),
        )
      ) {
        const bold = this.widestAffordable(state, 2, false, budget);
        if (bold !== null) return bold.tiles;
      }
      return this.reseal(state, budget);
    }

    // cannonsToPlace is zero throughout a build phase — it is set at the resolution
    // that ends it — so asking whether there is room for it always said yes. What
    // matters is the reward this wall is about to earn.
    const earning = cannonReward(state.ruleset.cannons, sealed, mainSealed);
    const needsRoom = cannonRoom(state, this.playerId) < earning + this.profile.roomMargin;
    // Max cannons walls pockets for guns (§1.3), up to its cap: sealed ground with no
    // castle, which counts while a castle is sealed. Always against the standing wall,
    // which `pocketPlan` insists on — a pocket standing alone is a whole ring of work.
    const pocket = (): PocketPlan | null =>
      this.profile.maxPockets > pocketCount(state, this.playerId)
        ? pocketPlan(state, this.playerId, this.unreachable)
        : null;

    // Guns left outside the wall are the thing most worth fixing. When one of two
    // enclosures is breached the sweep takes that whole wall, and its cannons are
    // stranded on open ground — silent, and expensive to reach. A single build phase
    // rarely pays for the wall that recovers them, so the bot commits across phases
    // instead: a part-built extension of a live wall still touches territory, so the
    // sweep leaves it standing and the work carries over. Without this, two bots
    // grind each other down to no firepower at all and the match never ends.
    let owned = 0;
    let firing = 0;
    for (const cannon of state.cannons) {
      if (cannon.owner !== this.playerId) continue;
      owned++;
      if (cannon.active) firing++;
    }
    if (owned >= 3 && firing * 2 < owned) {
      const recover = cheapestPlanFor(
        state,
        this.playerId,
        1,
        this.profile.maxCastles,
        this.unreachable,
        true,
        this.profile.roomRadius,
      );
      if (recover !== null) return recover.tiles;
    }
    const wantsMore = sealed < this.profile.maxCastles;

    // Short of room, a max-cannons bot takes a pocket rather than widening its loop: a
    // few blocks against the wall it has, not a longer wall round everything.
    if (needsRoom) {
      const room = pocket();
      if (room !== null) return room.tiles;
    }

    // Cannon space second: a thin wall is thickened before any room is sought.
    if (this.profile.thickenFirst && weakestWall(state, this.playerId).length < 2) {
      const thicken = thickenTargets(state, this.playerId).filter((i) => !this.unreachable.has(i));
      if (thicken.length > 0) return thicken;
    }

    // A defensive bot makes its castle safe first — thickened until no way in takes fewer
    // than two shots, or until no piece can thicken it further — and then reaches for the
    // next castle straight away, whether or not this phase can close it: castles are a
    // main way to win, and a part-built extension carries into the next round. Safety is
    // judged as the phase goes, not at its start, which follows a barrage and would
    // almost never find the wall whole.
    if (this.profile.expandsWhenSafe && wantsMore) {
      if (weakestWall(state, this.playerId).length < 2) {
        const thicken = thickenTargets(state, this.playerId).filter(
          (i) => !this.unreachable.has(i),
        );
        if (thicken.length > 0) return thicken;
      }
      const next = cheapestPlanFor(
        state,
        this.playerId,
        sealed + 1,
        this.profile.maxCastles,
        this.unreachable,
        true,
        this.profile.roomRadius,
      );
      if (next !== null) return next.tiles;
    }

    // An expander reaches for the next castle the moment one is secured, whether or not
    // this phase can close it. Less of a gamble than it sounds: the wall it has stays
    // standing while the new one is built outside it, and a part-built extension that
    // touches territory survives the sweep and carries into the next phase.
    if (this.profile.expandsWhenSealed && wantsMore) {
      const next = cheapestPlanFor(
        state,
        this.playerId,
        sealed + 1,
        this.profile.maxCastles,
        this.unreachable,
        true,
        this.profile.roomRadius,
      );
      if (next !== null) return next.tiles;
    }

    if (needsRoom || wantsMore) {
      const bigger = cheapestPlanFor(
        state,
        this.playerId,
        sealed + 1,
        this.profile.maxCastles,
        this.unreachable,
        true,
        this.profile.roomRadius,
      );
      if (affordable(bigger)) return (bigger as SealPlan).tiles;
    }

    // With time to spare, a max-cannons bot walls a pocket before it thickens.
    const spare = pocket();
    if (spare !== null) return spare.tiles;

    // Only thicken when there is somewhere to put the guns. Otherwise a bot spends
    // the phase making its wall stouter and its arsenal smaller, which is how a match
    // turns into two impregnable castles with nothing to shoot at each other.
    if (!needsRoom && this.profile.thickens) {
      const thicken = thickenTargets(state, this.playerId);
      if (thicken.length > 0) return thicken;
    }

    // Still standing, nowhere obvious to improve: hold the current wall — but hold the
    // roomy version of it. This is the branch a settled bot spends most of the match in,
    // so a tight plan here is not one bad round, it is the shape the bot converges on.
    const hold =
      this.widestAffordable(state, 1, true, budget) ??
      cheapestPlanFor(state, this.playerId, 1, this.profile.maxCastles, this.unreachable);
    return hold?.tiles ?? [];
  }

  /**
   * Chooses which castle to wall when nothing is enclosed.
   *
   * Cheapest is the obvious answer and the wrong one. A cannon only fires from inside
   * sealed ground, so walling a fresh castle across the island abandons every gun the
   * bot owns: it survives the round with no firepower, and so does whoever breached
   * it. Two bots doing that to each other is precisely the stalemate that looks like
   * thick walls and no guns — measured at two active cannons out of sixteen.
   *
   * So a wall that takes back the ground the guns are standing on is worth paying
   * more for.
   */
  private reseal(state: MatchState, budget: number): number[] {
    // No wall that keeps the guns is asked for here: `decide` comes here only once the
    // tightest of them is past the budget, and a wall with room in it is never cheaper,
    // so asking at every width could only fail — a third of a slow plan late in a phase
    // (PLAN 11). The guns are weighed below instead, a silent cannon still beating
    // elimination.

    // Which of this bot's guns stand near the castles a wall would take in. Not which
    // castles were sealed last round: after a breach that is nothing at all, which is
    // exactly the moment the choice matters most.
    const gunsKept = (plan: SealPlan): number =>
      state.cannons.filter(
        (cannon) =>
          cannon.owner === this.playerId &&
          plan.castleIds.some((id) => {
            const castle = state.castles[id];
            return (
              castle !== undefined &&
              Math.abs(cannon.x - castle.x) <= GUN_REACH &&
              Math.abs(cannon.y - castle.y) <= GUN_REACH
            );
          }),
      ).length;

    // Widest first here too, so giving up room is a concession to the budget rather
    // than the default. Within a radius the choice is between castles, and a gun
    // recovered is worth a few extra blocks of wall.
    let cheapest: SealPlan | null = null;
    for (let radius = this.profile.roomRadius; radius >= 0; radius--) {
      const options = sealOptions(
        state,
        this.playerId,
        this.profile.maxCastles,
        this.unreachable,
        false,
        radius,
      );
      let best: SealPlan | null = null;
      let bestValue = -Infinity;
      for (const plan of options) {
        // sealOptions is sorted by cost, so the first plan at radius 0 is the
        // cheapest wall that exists — the last resort below.
        if (cheapest === null || plan.cost < cheapest.cost) cheapest = plan;
        if (plan.cost / 3.5 > budget) continue;
        // The main castle earns one cannon more than any other (`cannonReward`), so
        // taking it back is weighed as one more gun kept.
        const main = state.players[this.playerId]?.startingCastleId ?? null;
        const mainBonus = main !== null && plan.castleIds.includes(main) ? 1 : 0;
        const value = (gunsKept(plan) + mainBonus) * 3 - plan.cost / 3.5;
        if (value > bestValue) {
          bestValue = value;
          best = plan;
        }
      }
      if (best !== null) return best.tiles;
    }

    // Nothing fits the budget at any width. Build toward the cheapest wall on the
    // board anyway rather than the roomiest: an unfinished wall encloses nothing, the
    // sweep takes the lot, and a phase spent on a plan that could never close is how
    // a bot ends a round with fourteen pieces laid and no wall at all.
    return cheapest?.tiles ?? [];
  }

  /** The ground the current plan would seal, kept until the plan is redrawn. */
  private inside: { key: string; territory: Uint8Array } | null = null;

  /**
   * What counts as the inside of the wall for a piece's spill. While the bot holds no
   * sealed castle — repairing a breach — the ground its plan would seal: inside the broken
   * ring nothing is territory, so spill there went unpenalised in exactly the case the user
   * named, closing the gaps to a castle, which is better done from the outside to leave
   * the room inside for guns. The sim's own enclosure with the plan's tiles stood in as
   * wall, so it cannot disagree with the rules. Only then: applied to every plan, an
   * expansion's whole interior counted as inside, including the band just outside the
   * current wall where thickening goes, and walls came out 14% thinner at Level 5 with
   * forfeits up 2.3 points. Once something is sealed, the territory as before.
   */
  private insideOf(state: MatchState): Uint8Array {
    const key = `${state.round}:${this.plannedAt}`;
    if (this.inside?.key === key) return this.inside.territory;
    let territory = state.territory;
    const planned = this.plan.filter((i) => state.structure[i] === Structure.Empty);
    const repairing = (computeEnclosure(state).enclosedCastlesByPlayer[this.playerId] ?? 0) === 0;
    if (repairing && planned.length > 0) {
      const structure = state.structure.slice();
      for (const i of planned) structure[i] = Structure.Wall;
      territory = computeEnclosure({ ...state, structure }).territory;
    }
    this.inside = { key, territory };
    return territory;
  }

  /**
   * The placement that covers most of what is wanted, proposed from the tiles themselves —
   * or, now and then for a sloppy bot, the next best, as a hurried person settles for a
   * worse fit. The random stream is drawn only when there is sloppiness, so careful
   * levels play exactly as they did.
   */
  private fit(
    state: MatchState,
    pieceId: number,
    wanted: readonly number[],
    rng: Rng,
  ): { x: number; y: number; rotation: number } | null {
    let best: { x: number; y: number; rotation: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let second: { x: number; y: number; rotation: number } | null = null;
    let secondScore = Number.NEGATIVE_INFINITY;
    const target = new Set(wanted);
    const islandId = state.players[this.playerId]?.islandId;
    const inside = this.insideOf(state);

    for (const tile of wanted) {
      const tx = tile % state.width;
      const ty = (tile - tx) / state.width;
      for (let rotation = 0; rotation < 4; rotation++) {
        const cells = pieceCells(pieceId, rotation);
        for (const [ox, oy] of cells) {
          const x = tx - ox;
          const y = ty - oy;
          if (canPlacePiece(state, this.playerId, rotation, x, y) !== null) continue;
          let covered = 0;
          let indoors = 0;
          for (const [cx, cy] of cells) {
            const i = (y + cy) * state.width + x + cx;
            if (target.has(i)) covered++;
            else if (inside[i] === islandId) indoors++;
          }
          // Spill outside is merely wasted. Spill inside is worse than wasted: it
          // occupies ground the wall will seal, which is the only place a cannon may go,
          // and a wall with no guns behind it wins nothing.
          const score = covered * 4 - (cells.length - covered) - indoors * 5;
          if (score > bestScore) {
            second = best;
            secondScore = bestScore;
            bestScore = score;
            best = { x, y, rotation };
          } else if (score > secondScore) {
            secondScore = score;
            second = { x, y, rotation };
          }
        }
      }
      if (bestScore >= pieceCells(pieceId, 0).length * 4) break;
    }
    const slip = this.profile.sloppiness;
    if (slip > 0 && second !== null && rng.nextFloat() < slip) return second;
    return best;
  }

  // ------------------------------------------------------------------ castles

  /** The castle that is cheapest to wall, which on a rough island is several phases of work. */
  private chooseCastle(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.startingCastleId !== null) return null;
    // Weighing every castle's wall is a plan: with none left at the table, the next tick.
    if (!this.slots.take(state.tick)) return null;
    // Last round's plan described an island that no longer exists: a continue wipes it.
    this.plan = [];
    this.plannedAt = -1;
    this.unreachable.clear();
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
    const pick = (roomRadius: number): (typeof mine)[number] | null => {
      const costed: { castle: (typeof mine)[number]; cost: number }[] = [];
      for (const castle of mine) {
        const plan = cheapestPlanFor(
          { ...state, castles: [castle] } as MatchState,
          this.playerId,
          1,
          1,
          undefined,
          false,
          roomRadius,
        );
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
              for (const rival of this.rivals(state)) {
                const at = this.islandCentre(state, rival.islandId);
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
  private placeCannon(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.cannonsToPlace <= 0) return null;
    // Siting a gun takes a person a moment too, and without this the search below ran
    // on every tick of a 25-second phase.
    if (state.tick < this.nextCannonTick) return null;
    this.nextCannonTick = state.tick + this.ticks(this.profile.placementBaseMs, state);

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
