import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  type AiConfig,
  type BotProfile,
  type BotSetup,
} from '@bollwerk/config';
import { Rng, canPlacePiece, type Action, type MatchState } from '@bollwerk/sim';

import { Builder } from './building.js';
import {
  DEFAULT_PLAN_ORDER,
  DEFAULT_PLAN_WEIGHTS,
  PlanSearch,
  inOrder,
  pick,
  strategiesFor,
  type ChosenPlan,
  type PlanWeights,
} from './buildPlanning.js';
import { IslandCentres } from './botTurn.js';
import { Gunner } from './combat.js';
import { PlanningSlots } from './planning.js';
import { Siting } from './siting.js';

/** What beginning a build search costs of the table's simulated pieces (`PlanningSlots`). */
const SEARCH_SETUP_STEPS = 8;

/** How a bot spends its build phases beyond its level and personality. */
export interface BotOptions {
  /** Plays each build phase out in advance for several strategies and keeps the best. */
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
    const islands = new IslandCentres();
    this.gunner = new Gunner(playerId, this.profile, islands);
    this.slots = slots;
    this.builder = new Builder(playerId, this.profile, slots);
    this.siting = new Siting(playerId, this.profile, slots, islands, this.builder);
  }

  private readonly slots: PlanningSlots;

  /** The search for the coming build phase's plan, while it runs, and its round. */
  private search: { round: number; search: PlanSearch; seed: number } | null = null;

  /** The plan chosen for the current or coming build phase, and its round. */
  private chosen: {
    round: number;
    plan: ChosenPlan;
    next: number;
    rng: Rng;
    /** False once the board has gone otherwise than the rollout said. */
    onPlan: boolean;
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
        if (this.options.plansAhead === true) this.planAhead(state, rng);
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
      // Weighing the walls a search starts from costs about what a dozen simulated pieces
      // do: eight bots doing it on one tick took 130-180 ms (Level 8, 2026-10-12).
      if (!this.slots.takeAllSteps(state.tick, SEARCH_SETUP_STEPS)) return false;
      const offered = strategiesFor(state, this.playerId);
      const order =
        this.options.planStrategies !== undefined
          ? pick(offered, this.options.planStrategies)
          : inOrder(offered, this.options.planOrder ?? DEFAULT_PLAN_ORDER);
      const seed = rng.nextU32();
      const search = PlanSearch.start(
        state,
        this.playerId,
        this.profile,
        seed,
        this.weights,
        order,
      );
      if (search === null) return true;
      this.search = { round: state.round, search, seed };
    }
    const { search, seed } = this.search;
    // Every strategy plays its first piece on the same tick, its time from the phase's start.
    const deadline = search.firstPieceTick ?? Number.POSITIVE_INFINITY;
    if (state.tick < deadline && !search.complete) {
      const share = Math.max(1, Math.floor(this.slots.stepsPerTick / state.players.length));
      search.work(this.slots.takeSteps(state.tick, share));
    }
    if (!search.complete && state.tick < deadline) return false;

    const plan = search.best();
    this.search = null;
    // When every plan weighed fails the round, or none was played out in time, the ladder
    // builds live, as it did before planning.
    const fails = plan === null || plan.score <= -this.weights.failure / 2;
    this.builder.strategy = fails ? null : plan.strategy;
    this.chosen =
      plan === null
        ? null
        : { round: state.round, plan, next: 0, rng: new Rng(seed), onPlan: !fails };
    return true;
  }

  private get weights(): PlanWeights {
    return this.options.planWeights ?? DEFAULT_PLAN_WEIGHTS;
  }

  /**
   * The chosen rollout's pieces, each on its tick. Should the board have gone otherwise — a
   * piece refused, its tick missed — the builder takes over with the same strategy.
   */
  private playPlan(state: MatchState): Action | null {
    const chosen = this.chosen as NonNullable<typeof this.chosen>;
    const next = chosen.plan.placements[chosen.next];
    if (next === undefined) return null;
    if (state.tick < next.tick) return null;
    if (
      state.tick === next.tick &&
      canPlacePiece(state, this.playerId, next.rotation, next.x, next.y) === null
    ) {
      chosen.next++;
      const { x, y, rotation } = next;
      return { kind: 'place_piece', player: this.playerId, x, y, rotation };
    }
    this.diverged++;
    chosen.onPlan = false;
    return this.builder.build(state, chosen.rng);
  }

  /** Phases whose plan did not come true, for the harness. */
  diverged = 0;
}
