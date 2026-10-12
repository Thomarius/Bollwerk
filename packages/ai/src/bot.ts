import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  type AiConfig,
  type BotProfile,
  type BotSetup,
} from '@bollwerk/config';
import {
  Rng,
  Structure,
  canPlacePiece,
  currentPieceId,
  pieceAt,
  pieceById,
  type Action,
  type MatchState,
} from '@bollwerk/sim';

import { Builder } from './building.js';
import {
  PlanSearch,
  inOrder,
  pick,
  strategiesFor,
  type ChosenPlan,
  type PlanWeights,
} from './buildPlanning.js';
import { IslandCentres, ticksFor } from './botTurn.js';
import { Gunner } from './combat.js';
import { PlanningSlots } from './planning.js';
import { Siting } from './siting.js';

/** How a bot spends its build phases beyond its level and personality. */
export interface BotOptions {
  /**
   * Plays each build phase out in advance for several strategies and keeps the best; as
   * `ai.planning.enabled` says when absent.
   */
  plansAhead?: boolean;
  planWeights?: PlanWeights;
  /** Only these strategies weighed, by name in this order; when absent, every one offered. */
  planStrategies?: readonly string[];
  /** The strategies tried first, most promising first, when time may run short. */
  planOrder?: readonly string[];
}

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
  private readonly gunner: Gunner;
  private readonly builder: Builder;
  private readonly siting: Siting;

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
    slots: PlanningSlots = new PlanningSlots(),
    private readonly options: BotOptions = {},
  ) {
    this.setup = setup;
    this.profile = botProfile(ai, setup);
    this.planning = ai.planning;
    const islands = new IslandCentres();
    this.gunner = new Gunner(playerId, this.profile, islands);
    this.slots = slots;
    this.builder = new Builder(playerId, this.profile, slots);
    this.siting = new Siting(playerId, this.profile, slots, islands, this.builder);
  }

  private readonly slots: PlanningSlots;
  private readonly planning: AiConfig['planning'];

  /** The search for the coming build phase's plan, while it runs, and its round. */
  private search: {
    round: number;
    search: PlanSearch;
    seed: number;
    /** The tick its first piece of the phase is due, from its pace: the search's end. */
    deadline: number;
    /** Wall on its island as the search found it. */
    walls: number;
  } | null = null;

  /** The plan chosen for the current or coming build phase, and its round. */
  private chosen: {
    round: number;
    plan: ChosenPlan;
    next: number;
    rng: Rng;
    /** False once the board has gone otherwise than the rollout said. */
    onPlan: boolean;
    /** Wall on its island as the rollout has it before the next piece. */
    walls: number;
  } | null = null;
  /** The plan this phase follows, for the harness to report. */
  get lastPlan(): ChosenPlan | null {
    return this.chosen?.plan ?? null;
  }

  think(state: MatchState, rng: Rng): Action | null {
    const player = state.players[this.playerId];
    if (!player || player.eliminated) return null;
    this.gunner.noteShots(state);

    switch (state.phase) {
      case 'castle_select':
        return this.siting.chooseCastle(state, rng);
      case 'combat':
        return this.gunner.shoot(state, rng);
      case 'intermission':
        if (this.options.plansAhead ?? this.planning.enabled) this.planAhead(state, rng);
        return null;
      case 'build':
        if (this.search?.round === state.round && !this.planAhead(state, rng)) return null;
        if (this.chosen?.round !== state.round) return this.builder.build(state, rng);
        return this.chosen.onPlan
          ? this.playPlan(state)
          : this.builder.build(state, this.chosen.rng);
      case 'cannon_place':
        // A bot that has just spent a continue owes a castle before it owes anything
        // else: without one it has no territory, so no gun has anywhere to stand.
        if (state.players[this.playerId]?.startingCastleId === null) {
          return this.siting.chooseCastle(state, rng);
        }
        return this.siting.placeCannon(state, rng);
      default:
        return null;
    }
  }

  /**
   * The search for the coming build phase's plan (BUILD_PLANNING.md): begun in the
   * intermission once the last shot is down and the board fixed, worked a share of the
   * table's simulated pieces each tick, and ended at the bot's first piece of the phase —
   * till then its island has not changed, so a strategy played out from the start is still
   * true — with the best plan played out by then. The game never waits for it. Its slips,
   * for a sloppy level, come from a stream seeded as it begins, so the phase plays as the
   * rollout did. True once a plan is chosen, or none can be.
   */
  private planAhead(state: MatchState, rng: Rng): boolean {
    if (this.chosen?.round === state.round) return true;
    if (this.search?.round !== state.round) {
      if (state.phase !== 'intermission' || state.pendingPhase !== 'build') return true;
      if (state.shots.length > 0) return false;
      if (!this.slots.takeStart(state.tick)) return false;
      const offered = strategiesFor(state, this.playerId);
      const order =
        this.options.planStrategies !== undefined
          ? pick(offered, this.options.planStrategies)
          : inOrder(offered, this.options.planOrder ?? this.planning.order);
      const seed = rng.nextU32();
      const search = PlanSearch.start(
        state,
        this.playerId,
        this.profile,
        seed,
        this.weights,
        order,
        this.planning.minGuns,
      );
      if (search === null) return true;
      // The phase begins as the intermission ends, the last shot down; the first piece is due
      // its own time later (`Builder.build`). A tick early does no harm: a plan's pieces wait
      // for their ticks. Not from a finished rollout's first piece, which a search with
      // nothing finished does not have: run on past it, its plan could no longer be laid.
      const round = state.players[this.playerId]?.pieceRound ?? state.round;
      const first = pieceById(pieceAt(state.ruleset, state.seed, round, 0)).size;
      const pace = this.profile.placementBaseMs + this.profile.placementPerCellMs * first;
      const deadline = state.phaseEndTick + ticksFor(pace, state) - 1;
      const walls = this.wallOnIsland(state);
      this.search = { round: state.round, search, seed, deadline, walls };
      // Its share of this tick went on weighing the walls it starts from.
      return false;
    }
    const { search, seed, walls } = this.search;
    const deadline = Math.min(this.search.deadline, search.firstPieceTick ?? Infinity);
    if (state.tick < deadline && !search.complete) {
      const share = Math.max(1, Math.floor(this.slots.stepsPerTick / state.players.length));
      search.work(this.slots.takeSteps(state.tick, share));
    }
    if (!search.complete && state.tick < deadline) return false;

    const plan = search.best();
    this.search = null;
    // Short of the minimum of guns, a life to spare: the round given up, nothing laid, for a
    // fresh castle, ring and starting guns (`ai.planning.failsOnPurpose`).
    if (
      plan !== null &&
      plan.guns < this.planning.minGuns &&
      this.planning.failsOnPurpose &&
      this.maySpareALife(state)
    ) {
      this.builder.strategy = null;
      this.gaveUp++;
      const quit = { ...plan, strategy: null, name: 'continue', placements: [] };
      this.chosen = {
        round: state.round,
        plan: quit,
        next: 0,
        rng: new Rng(seed),
        onPlan: true,
        walls,
      };
      return true;
    }
    // When every plan weighed fails the round, or none was played out in time, the ladder
    // builds live, as it did before planning.
    const fails = plan === null || plan.score <= -this.weights.failure / 2;
    this.builder.strategy = fails ? null : plan.strategy;
    this.chosen =
      plan === null
        ? null
        : { round: state.round, plan, next: 0, rng: new Rng(seed), onPlan: !fails, walls };
    return true;
  }

  private get weights(): PlanWeights {
    return this.options.planWeights ?? this.planning.weights;
  }

  /**
   * The chosen rollout's pieces, each on its tick. Should the board have gone otherwise — a
   * teammate's piece on its island, a piece refused, its tick missed — the builder takes over
   * at once with the chosen strategy's walls, planned afresh on the board as it is, and no
   * new search: the user's rule, a quick answer rather than another wait (BUILD_PLANNING.md).
   */
  private playPlan(state: MatchState): Action | null {
    const chosen = this.chosen as NonNullable<typeof this.chosen>;
    const next = chosen.plan.placements[chosen.next];
    if (next === undefined) return null;
    if (state.tick < next.tick) return null;
    if (
      state.tick === next.tick &&
      this.wallOnIsland(state) === chosen.walls &&
      canPlacePiece(state, this.playerId, next.rotation, next.x, next.y) === null
    ) {
      chosen.next++;
      chosen.walls += pieceById(currentPieceId(state, this.playerId)).size;
      const { x, y, rotation } = next;
      return { kind: 'place_piece', player: this.playerId, x, y, rotation };
    }
    this.diverged++;
    chosen.onPlan = false;
    return this.builder.build(state, chosen.rng);
  }

  /** Phases whose plan did not come true, for the harness. */
  diverged = 0;

  /** Rounds given up on purpose, for the harness. */
  gaveUp = 0;

  /**
   * Whether failing this round on purpose is the bot's to choose: its team has a life left
   * and fails a round for want of a sealed castle, the round is not the last — a life spent
   * there buys nothing — and nobody in the team is a person, whose lives these are too.
   */
  private maySpareALife(state: MatchState): boolean {
    const player = state.players[this.playerId];
    const team = player === undefined ? undefined : state.teams[player.team];
    if (team === undefined || team.continuesRemaining <= 0) return false;
    if (!state.ruleset.elimination.onZeroEnclosedCastles) return false;
    const last = state.ruleset.scoring.maxRounds;
    if (last !== null && state.round >= last) return false;
    return state.players.every((p) => p.team !== team.id || p.isBot);
  }

  /**
   * Wall standing on its island. Within a build phase only pieces add to it, so its own
   * pieces account for every block unless someone else has built there.
   */
  private wallOnIsland(state: MatchState): number {
    const island = state.players[this.playerId]?.islandId;
    let walls = 0;
    for (let i = 0; i < state.structure.length; i++) {
      if (state.islandId[i] === island && state.structure[i] === Structure.Wall) walls++;
    }
    return walls;
  }
}
