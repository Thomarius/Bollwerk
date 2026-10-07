import { type BotProfile, type FitWeights } from '@bollwerk/config';
import {
  Structure,
  cannonReward,
  computeEnclosure,
  buildRefusal,
  cellsRefusal,
  currentPieceId,
  pieceById,
  pieceCells,
  poolForRound,
  type Action,
  type Castle,
  type EnclosureResult,
  type MatchState,
  type Rng,
} from '@bollwerk/sim';

import { ticksFor } from './botTurn.js';
import { coverable } from './coverage.js';
import { type PlanningSlots } from './planning.js';
import {
  cannonRoom,
  outerSkin,
  pocketCount,
  pocketPlan,
  SealPlanner,
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

/**
 * Widening once sealed (`widensWhenSealed`, BOT_LEARNING.md B): what it can still finish,
 * in blocks for each cell it can still lay this phase. Tuned head to head, one bot against
 * two of today's, 96 matches each at Levels 5 and 8 (fair share 32): 0.55 — the share of a
 * bot's repairing cells that ends in the final wall, in the testers' recordings — won 48
 * and 54, too short to reach a castle the ladder below would have tried; 0.8 won 65 and
 * 65; 1.0, 67 and 64.
 */
const WIDEN_REACH = 0.8;

/**
 * How much more than the ground held a wider wall must be worth to be built: 1.1 against
 * 1.25, head to head, won 54 of 96 at Level 8 against 39 (with the castles below absent).
 */
const WIDEN_GAIN = 1.1;

/** A wall chosen is kept unless another is worth this much more: a switch wastes pieces. */
const KEEP_WIDER = 1.15;

/**
 * A wall widened where it stands, as people push one out, rather than all round: the
 * territory and a patch of land this far round a point beside the wall, at this many points
 * spread along it. The whole territory widened by a tile asked for a new perimeter outside
 * the old one, past any phase's budget, and was the best of ~530 plans in none.
 */
const BULGE_RADII = [2, 4];
const BULGE_SEEDS = 8;

/**
 * A wall reaching for another castle: the territory and the castle with this much band
 * round it, so the cut reuses the standing wall and only bridges to the castle.
 */
const CASTLE_BANDS = [0, 2];

/**
 * What one turn works out about the board, for everything the turn decides: the board
 * cannot change within a turn, and a plan asked the same questions of it several times.
 */
class Look {
  private enclosed: EnclosureResult | null = null;
  private weakest: number[] | null = null;

  constructor(
    private readonly state: MatchState,
    private readonly playerId: number,
  ) {}

  enclosure(): EnclosureResult {
    return (this.enclosed ??= computeEnclosure(this.state));
  }

  /** `weakestWall` of this bot's own wall; read, never changed. */
  weakestWall(): readonly number[] {
    return (this.weakest ??= weakestWall(this.state, this.playerId));
  }

  thickenTargets(): number[] {
    return thickenTargets(this.state, this.playerId, this.weakestWall());
  }
}

/**
 * A bot's walls: within a build phase it works down a ladder — stay alive, then make room,
 * then take more ground, then thicken what it has — which is roughly the order a person's
 * attention goes, and it lays a piece at a person's pace.
 */
export class Builder {
  constructor(
    private readonly playerId: number,
    private readonly profile: BotProfile,
    private readonly slots: PlanningSlots,
  ) {}

  /**
   * The wider wall it is building, by `widen`'s key and the ground it was asked to take in,
   * so it is kept from plan to plan rather than redrawn.
   */
  private widerKey: string | null = null;
  private widerGround: number[] | null = null;

  private plan: number[] = [];

  private plannedAt = -1;

  private planRound = -1;

  /**
   * Cut tiles no piece could reach, found by a fit that failed or by `markUncoverable`;
   * the next plan routes around them.
   */
  private unreachable = new Set<number>();

  private nextPlacementTick = 0;

  /** The tightest repair as the plan was made, for a learned fit to weigh (`fitWeights`). */
  private tight: number[] = [];

  /**
   * Rules out every tile of the island no piece the bag can deal could cover, so a plan
   * routes round it from the start rather than meeting it with the phase spent. A build
   * phase only fills the board, so a tile that takes no piece now takes none this round;
   * the set is cleared with the round, when shots and a new bag change both.
   *
   * Measured before (2026-10-07, 96 matches of three bots a level): a third of failed
   * rounds ended on a gap no piece could fill, mostly a shot's hole between wall and water
   * or wall and gun, already unfillable as the phase opened. With this, half as many, and
   * rounds failed 12.8% -> 11.5% at Level 5, 12.4% -> 11.4% at 8, 13.9% -> 11.8% at 3,
   * points a round up 2-5%. Also refusing, in the fit, placements that box a planned tile
   * in added nothing to it (12.4% alone, 11.5% beside it) and was dropped.
   */
  private markUncoverable(state: MatchState): void {
    const island = state.players[this.playerId]?.islandId;
    for (let i = 0; i < state.structure.length; i++) {
      if (
        state.islandId[i] !== island ||
        state.structure[i] !== Structure.Empty ||
        this.unreachable.has(i)
      ) {
        continue;
      }
      if (!coverable(state, this.playerId, i)) this.unreachable.add(i);
    }
  }

  /** Stands down briefly after a fruitless look, rather than retrying every tick. */
  private pause(state: MatchState): void {
    this.nextPlacementTick = state.tick + ticksFor(IDLE_RETRY_MS, state);
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

  build(state: MatchState, rng: Rng): Action | null {
    // Check the clock before anything else: this runs for every bot on every tick,
    // and looking the piece up first made that lookup the bot's largest single cost.
    if (state.tick < this.nextPlacementTick) return null;
    const pieceId = currentPieceId(state, this.playerId);
    const look = new Look(state, this.playerId);

    // Last round's dead ends mean nothing now that the board has changed.
    if (this.planRound !== state.round) {
      this.planRound = state.round;
      this.unreachable.clear();
      this.plan = [];
      this.plannedAt = -1;
      this.widerKey = null;
      this.widerGround = null;
    }

    if (this.plannedAt < 0 || state.tick - this.plannedAt > this.profile.replanTicks) {
      // No plan left at the table this tick: try again on the next.
      if (!this.slots.take(state.tick)) return null;
      this.markUncoverable(state);
      this.plan = this.decide(state, look);
      this.plannedAt = state.tick;
    }

    if (this.profile.fitWeights !== null) {
      return this.buildScored(state, pieceId, look, rng, this.profile.fitWeights);
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
      () => (thickens ? look.thickenTargets() : []),
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
      placement = this.fit(state, pieceId, wanted, rng, look);
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
      state.tick + ticksFor(this.placementMs(pieceById(pieceId).size), state);
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
    const seal = new SealPlanner(state, this.playerId, this.unreachable);
    const onIsland = state.castles.filter((c) => c.islandId === player.islandId).length;
    if (sealed < onIsland) {
      const next = seal.cheapest(sealed + 1, onIsland, true, this.profile.roomRadius);
      const tiles = next?.tiles.filter((i) => state.structure[i] === Structure.Empty) ?? [];
      if (tiles.length > 0) return tiles;
    }

    // No castle worth reaching for: take in more open ground instead, which is where
    // the cannons this wall earns will have to stand.
    const roomier = seal.cheapest(
      Math.max(1, sealed),
      this.profile.maxCastles,
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
    seal: SealPlanner,
    atLeastCastles: number,
    keepCannons: boolean,
    budget: number,
  ): SealPlan | null {
    for (let radius = this.profile.roomRadius; radius >= 0; radius--) {
      const plan = seal.cheapest(atLeastCastles, this.profile.maxCastles, keepCannons, radius);
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
  private decide(state: MatchState, look: Look): number[] {
    const player = state.players[this.playerId];
    if (!player) return [];
    // One graph for every wall this plan weighs, and each wall weighed once.
    const seal = new SealPlanner(state, this.playerId, this.unreachable);
    if (this.profile.fitWeights !== null) {
      this.tight = seal.cheapest(1, this.profile.maxCastles, true, 0)?.tiles ?? [];
    }
    // Counted afresh rather than read from `enclosedCastles`, which placements and
    // resolutions refresh but landing shots do not: as a breached build phase opens it
    // still says sealed, and the first plan of the phase was made for a wall that stood.
    const enclosure = look.enclosure();
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
      const tight = seal.cheapest(1, this.profile.maxCastles, true, 0);
      // An offensive bot with only a small breach closes it with a roomier wall than it
      // had, taking in more ground in the same repair — when that roomier wall fits the
      // pieces it can still lay this phase, not a hopeful fraction more. Otherwise it
      // repairs tight like everyone: the widest-first repair of 10s lost a quarter of all
      // rounds, and a small breach is the one case where there is time to spare.
      if (this.profile.widensWhileRepairing && tight !== null && tight.cost <= SMALL_REPAIR) {
        const pieces = this.piecesAffordable(state);
        for (let radius = this.profile.roomRadius + 1; radius >= 1; radius--) {
          const wide = seal.cheapest(1, this.profile.maxCastles, true, radius);
          if (wide !== null && wide.cost / 3.5 <= pieces) return wide.tiles;
        }
      }
      if (affordable(tight)) return (tight as SealPlan).tiles;

      // Reaching for two castles while unenclosed is the real gamble: it is more
      // cannons if it lands and elimination if it does not. Only when it clearly fits —
      // and only searched when the cheapest pair at no room fits, since no wider wall
      // round two castles costs less. Late in a phase nothing fits, and the search at
      // every width was a third of a plan of 30 ms where 5 is usual (PLAN 11).
      if (this.profile.maxCastles > 1 && affordable(seal.cheapest(2, this.profile.maxCastles))) {
        const bold = this.widestAffordable(seal, 2, false, budget);
        if (bold !== null) return bold.tiles;
      }
      return this.reseal(state, seal, budget);
    }

    // cannonsToPlace is zero throughout a build phase — it is set at the resolution
    // that ends it — so asking whether there is room for it always said yes. What
    // matters is the reward this wall is about to earn.
    const earning = cannonReward(state.ruleset.cannons, sealed, mainSealed);
    const needsRoom = cannonRoom(state, this.playerId) < earning + this.profile.roomMargin;
    // Max cannons walls pockets for guns (§1.3), up to its cap: sealed ground with no
    // castle, which counts while a castle is sealed. Always against the standing wall,
    // which `pocketPlan` insists on — a pocket standing alone is a whole ring of work.
    let pocketed: PocketPlan | null | undefined;
    const pocket = (): PocketPlan | null =>
      (pocketed ??=
        this.profile.maxPockets > pocketCount(state, this.playerId)
          ? pocketPlan(state, this.playerId, this.unreachable)
          : null);

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
      const recover = seal.cheapest(1, this.profile.maxCastles, true, this.profile.roomRadius);
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
    if (this.profile.thickenFirst && look.weakestWall().length < 2) {
      const thicken = look.thickenTargets().filter((i) => !this.unreachable.has(i));
      if (thicken.length > 0) return thicken;
    }

    // A defensive bot's castle is made safe before anything is widened (below).
    if (this.profile.expandsWhenSafe && wantsMore && look.weakestWall().length < 2) {
      const thicken = look.thickenTargets().filter((i) => !this.unreachable.has(i));
      if (thicken.length > 0) return thicken;
    }

    if (this.profile.widensWhenSealed) {
      const wider = this.widen(state, seal, look);
      if (wider !== null) return wider.tiles;
    }

    // A defensive bot makes its castle safe first — thickened until no way in takes fewer
    // than two shots, or until no piece can thicken it further — and then reaches for the
    // next castle straight away, whether or not this phase can close it: castles are a
    // main way to win, and a part-built extension carries into the next round. Safety is
    // judged as the phase goes, not at its start, which follows a barrage and would
    // almost never find the wall whole.
    if (this.profile.expandsWhenSafe && wantsMore) {
      const next = seal.cheapest(
        sealed + 1,
        this.profile.maxCastles,
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
      const next = seal.cheapest(
        sealed + 1,
        this.profile.maxCastles,
        true,
        this.profile.roomRadius,
      );
      if (next !== null) return next.tiles;
    }

    if (needsRoom || wantsMore) {
      const bigger = seal.cheapest(
        sealed + 1,
        this.profile.maxCastles,
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
      const thicken = look.thickenTargets();
      if (thicken.length > 0) return thicken;
    }

    // Still standing, nowhere obvious to improve: hold the current wall — but hold the
    // roomy version of it. This is the branch a settled bot spends most of the match in,
    // so a tight plan here is not one bad round, it is the shape the bot converges on.
    const hold =
      this.widestAffordable(seal, 1, true, budget) ?? seal.cheapest(1, this.profile.maxCastles);
    return hold?.tiles ?? [];
  }

  /** Cells it could still lay this phase, at its pace, with the bag's average piece. */
  private cellsAffordable(state: MatchState): number {
    const player = state.players[this.playerId];
    if (player === undefined) return 0;
    const pool = poolForRound(state.ruleset, player.pieceRound);
    let weight = 0;
    let cells = 0;
    pool.ids.forEach((id, k) => {
      const w = pool.weights[k] as number;
      weight += w;
      cells += w * pieceById(id).size;
    });
    const size = cells / Math.max(1, weight);
    const ticksLeft = Math.max(0, state.phaseEndTick - state.tick);
    const msLeft = (ticksLeft * 1000) / state.ruleset.tickRateHz;
    return (msLeft / this.placementMs(size)) * size;
  }

  /**
   * Sealed, the most valuable wall it can finish this phase, as the testers built (BOT_LEARNING
   * step 1: they end a phase with more castles, and spend 45% of their cells once sealed on
   * a wider wall where the bots thickened). Weighed: the wall it chose last; the standing
   * wall pushed out to take in each castle outside it; a stretch of land beside the wall;
   * and the castle walls with room. Valued as the scoring does, tiles times castles, with
   * the wall stood in; built if worth `WIDEN_GAIN` times what it holds. The wall standing
   * is the bail-out: building outside it leaves it whole, and a part-built extension
   * touching territory outlasts the sweep. Null to go on down the ladder.
   *
   * Head to head, one bot against two of today's, three players, Level 5 and Level 8,
   * 96 matches each (fair share 32): this won 48 and 54. The castles alone won 41 and 46,
   * the stretches alone (with a rule for going big while breached, since dropped) 32 and 39.
   */
  private widen(state: MatchState, seal: SealPlanner, look: Look): SealPlan | null {
    const player = state.players[this.playerId];
    if (player === undefined) return null;
    const island = player.islandId;
    const { width, height } = state;
    const territory = look.enclosure().territory;
    const held: number[] = [];
    for (let i = 0; i < territory.length; i++) if (territory[i] === island) held.push(i);
    if (held.length === 0) return null;
    const inside = new Set(held);
    const mine = state.castles.filter((c) => c.islandId === island);
    const castlesIn = (ground: ReadonlySet<number>): Castle[] =>
      mine.filter((c) => ground.has(c.y * width + c.x));
    const sealedCastles = castlesIn(inside);

    const options: { key: string; plan: SealPlan; ground: number[] | null }[] = [];
    const offer = (key: string, castles: readonly Castle[], ground: number[]): void => {
      const plan = seal.around(key, castles, ground);
      if (plan !== null) options.push({ key, plan, ground });
    };
    // The wall it chose last, round the same ground, whatever has been built since.
    if (this.widerGround !== null && this.widerKey !== null) {
      const ground = this.widerGround;
      offer(`kept:${this.widerKey}`, castlesIn(new Set(ground)), ground);
      const last = options.at(-1);
      if (last !== undefined) last.key = this.widerKey;
    }
    for (const seed of spreadAlong(state, outerSkin(state, this.playerId), BULGE_SEEDS)) {
      for (const radius of BULGE_RADII) {
        const key = `bulge${seed}r${radius}`;
        if (key === this.widerKey) continue;
        offer(key, sealedCastles, [...held, ...patchRound(state, island, seed, radius)]);
      }
    }
    for (const castle of mine) {
      if (inside.has(castle.y * width + castle.x)) continue;
      for (const band of CASTLE_BANDS) {
        const key = `castle${castle.id}r${band}`;
        if (key === this.widerKey) continue;
        const box: number[] = [];
        for (let y = castle.y - band; y < castle.y + castle.h + band; y++) {
          for (let x = castle.x - band; x < castle.x + castle.w + band; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            if (state.islandId[y * width + x] === island) box.push(y * width + x);
          }
        }
        offer(key, [...sealedCastles, castle], [...held, ...box]);
      }
    }
    for (const plan of seal.options(this.profile.maxCastles, true, this.profile.roomRadius)) {
      const key = `room${plan.castleIds.join('+')}`;
      if (key === this.widerKey) continue;
      options.push({ key, plan, ground: null });
    }

    const board = state.structure.slice();
    const valueOf = (tiles: readonly number[]): number => {
      for (const i of tiles) board[i] = Structure.Wall;
      const e = computeEnclosure({ ...state, structure: board });
      for (const i of tiles) board[i] = state.structure[i] as number;
      let area = 0;
      for (const t of e.territory) if (t === island) area++;
      return area * (e.enclosedCastlesByPlayer[this.playerId] ?? 0);
    };

    const reach = this.cellsAffordable(state) * WIDEN_REACH * this.profile.riskMargin;
    type Valued = (typeof options)[number] & { value: number };
    let best: Valued | null = null;
    let kept: Valued | null = null;
    for (const option of options) {
      if (option.plan.cost > reach) continue;
      const value = valueOf(option.plan.tiles);
      if (best === null || value > best.value) best = { ...option, value };
      if (option.key === this.widerKey) kept = { ...option, value };
    }
    if (kept !== null && best !== null && kept.value * KEEP_WIDER >= best.value) best = kept;
    if (best === null || best.value < valueOf([]) * WIDEN_GAIN) {
      this.widerKey = null;
      this.widerGround = null;
      return null;
    }
    this.widerKey = best.key;
    this.widerGround = best.ground;
    return best.plan;
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
  private reseal(state: MatchState, seal: SealPlanner, budget: number): number[] {
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
      const options = seal.options(this.profile.maxCastles, false, radius);
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
  private insideOf(state: MatchState, look: Look): Uint8Array {
    const key = `${state.round}:${this.plannedAt}`;
    if (this.inside?.key === key) return this.inside.territory;
    let territory = state.territory;
    const planned = this.plan.filter((i) => state.structure[i] === Structure.Empty);
    const repairing = (look.enclosure().enclosedCastlesByPlayer[this.playerId] ?? 0) === 0;
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
    look: Look,
  ): { x: number; y: number; rotation: number } | null {
    let best: { x: number; y: number; rotation: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let second: { x: number; y: number; rotation: number } | null = null;
    let secondScore = Number.NEGATIVE_INFINITY;
    const target = new Set(wanted);
    const inside = this.insideOf(state, look);
    const player = state.players[this.playerId];
    // Whether this player may build at all is one question, not one a spot: refused, no
    // spot fits, and nothing below is drawn from the stream either.
    if (player === undefined || buildRefusal(state, this.playerId) !== null) return null;
    const islandId = player.islandId;

    // Each placement once. A square tried at four turns, or one anchor reached from two
    // wanted tiles, was the same placement again, scored the same - never the best, which
    // is the first to score highest, but often the second: a sloppy bot "settling for a
    // worse fit" then laid exactly the fit it had chosen. A piece's distinct turns only,
    // and each anchor once (the key allows anchors a piece's size off the board).
    const rotations = pieceById(pieceId).rotations.length;
    const span = state.width + 16;
    const tried = new Set<number>();
    for (const tile of wanted) {
      const tx = tile % state.width;
      const ty = (tile - tx) / state.width;
      for (let rotation = 0; rotation < rotations; rotation++) {
        const cells = pieceCells(pieceId, rotation);
        for (const [ox, oy] of cells) {
          const x = tx - ox;
          const y = ty - oy;
          const key = ((y + 8) * span + (x + 8)) * 4 + rotation;
          if (tried.has(key)) continue;
          tried.add(key);
          if (cellsRefusal(state, player, cells, x, y) !== null) continue;
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

  /**
   * A piece laid by a learned score rather than the ladder's order (`fitWeights`,
   * BOT_LEARNING step 3): every legal placement reaching the plan, the tightest repair,
   * the thickening targets or the outer skin, weighed at once.
   */
  private buildScored(
    state: MatchState,
    pieceId: number,
    look: Look,
    rng: Rng,
    weights: FitWeights,
  ): Action | null {
    const open = (tiles: readonly number[]): number[] =>
      tiles.filter((i) => state.structure[i] === Structure.Empty && !this.unreachable.has(i));
    let plan = open(this.plan);
    if (plan.length === 0) {
      // The plan is built: the next castle or more room, as the ladder's spare work.
      if (!this.slots.take(state.tick)) return null;
      plan = open(this.spareWork(state));
    }
    const thickens = this.profile.thickens;
    const targets: Targets = {
      plan,
      tight: open(this.tight),
      thicken: thickens ? open(look.thickenTargets()) : [],
      skin: thickens ? open(outerSkin(state, this.playerId)) : [],
    };
    const placement = this.scoredFit(state, pieceId, targets, rng, look, weights);
    if (placement === null) {
      this.pause(state);
      return null;
    }
    this.nextPlacementTick =
      state.tick + ticksFor(this.placementMs(pieceById(pieceId).size), state);
    return { kind: 'place_piece', player: this.playerId, ...placement };
  }

  /** The placement scoring highest by `weights` — or, for a sloppy bot now and then, the next. */
  private scoredFit(
    state: MatchState,
    pieceId: number,
    targets: Targets,
    rng: Rng,
    look: Look,
    weights: FitWeights,
  ): { x: number; y: number; rotation: number } | null {
    const player = state.players[this.playerId];
    if (player === undefined || buildRefusal(state, this.playerId) !== null) return null;
    const islandId = player.islandId;
    const inside = this.insideOf(state, look);
    const plan = new Set(targets.plan);
    const tight = new Set(targets.tight);
    const thicken = new Set(targets.thicken);
    const skin = new Set(targets.skin);
    const anchors = [
      ...new Set([...targets.plan, ...targets.tight, ...targets.thicken, ...targets.skin]),
    ];
    // The repair's cost over what the phase can still lay, at repair efficiency (0.45 blocks
    // a cell, BOT_LEARNING step 1): about 1 where the repair would take the whole phase.
    const urgency = Math.min(
      2,
      targets.tight.length / Math.max(1, this.cellsAffordable(state) * 0.45),
    );

    const rotations = pieceById(pieceId).rotations.length;
    const span = state.width + 16;
    const tried = new Set<number>();
    let best: { x: number; y: number; rotation: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let second: { x: number; y: number; rotation: number } | null = null;
    let secondScore = Number.NEGATIVE_INFINITY;
    for (const tile of anchors) {
      const tx = tile % state.width;
      const ty = (tile - tx) / state.width;
      for (let rotation = 0; rotation < rotations; rotation++) {
        const cells = pieceCells(pieceId, rotation);
        for (const [ox, oy] of cells) {
          const x = tx - ox;
          const y = ty - oy;
          const key = ((y + 8) * span + (x + 8)) * 4 + rotation;
          if (tried.has(key)) continue;
          tried.add(key);
          if (cellsRefusal(state, player, cells, x, y) !== null) continue;
          let onPlan = 0;
          let onTight = 0;
          let onThicken = 0;
          let onSkin = 0;
          let indoors = 0;
          let waste = 0;
          for (const [cx, cy] of cells) {
            const i = (y + cy) * state.width + x + cx;
            const p = plan.has(i);
            const t = tight.has(i);
            const h = thicken.has(i);
            const k = skin.has(i);
            if (p) onPlan++;
            if (t) onTight++;
            if (h) onThicken++;
            if (k) onSkin++;
            if (!p && !t && !h && !k) {
              if (inside[i] === islandId) indoors++;
              else waste++;
            }
          }
          const score =
            weights.plan * onPlan +
            weights.planUrgent * onPlan * urgency +
            (plan.size > 0 && onPlan === plan.size ? weights.planCompletes : 0) +
            weights.tight * onTight +
            weights.tightUrgent * onTight * urgency +
            (tight.size > 0 && onTight === tight.size ? weights.tightCompletes : 0) +
            weights.thicken * onThicken +
            weights.skin * onSkin +
            weights.indoors * indoors +
            weights.waste * waste;
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
    }
    const slip = this.profile.sloppiness;
    if (slip > 0 && second !== null && rng.nextFloat() < slip) return second;
    return best;
  }

  /** Last round's plan described an island that no longer exists: a continue wipes it. */
  forget(): void {
    this.plan = [];
    this.plannedAt = -1;
    this.unreachable.clear();
  }
}

/**
 * Up to `count` of these tiles, spread out: the first, then each time the one farthest
 * (Chebyshev) from every one taken, the first of equals in the order given.
 */
function spreadAlong(state: MatchState, tiles: readonly number[], count: number): number[] {
  const out: number[] = [];
  if (tiles.length === 0) return out;
  const width = state.width;
  const near = new Int32Array(tiles.length).fill(0x7fffffff);
  let next = 0;
  while (out.length < count) {
    const chosen = tiles[next] as number;
    out.push(chosen);
    const cx = chosen % width;
    const cy = (chosen - cx) / width;
    let far = -1;
    let farthest = 0;
    tiles.forEach((t, k) => {
      const tx = t % width;
      const d = Math.max(Math.abs(tx - cx), Math.abs((t - tx) / width - cy));
      if (d < (near[k] as number)) near[k] = d;
      if ((near[k] as number) > farthest) {
        farthest = near[k] as number;
        far = k;
      }
    });
    if (far < 0) break;
    next = far;
  }
  return out;
}

/** This island's tiles within `radius` (Chebyshev) of a tile. */
function patchRound(state: MatchState, island: number, centre: number, radius: number): number[] {
  const { width, height } = state;
  const cx = centre % width;
  const cy = (centre - cx) / width;
  const out: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
      if (state.islandId[y * width + x] === island) out.push(y * width + x);
    }
  }
  return out;
}

/** What a learned fit weighs a placement against: tiles still wanted, by kind. */
interface Targets {
  plan: number[];
  tight: number[];
  thicken: number[];
  skin: number[];
}
