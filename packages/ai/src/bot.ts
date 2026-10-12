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
  DEFAULT_PLAN_WEIGHTS,
  choosePlan,
  type ChosenPlan,
  type PlanWeights,
} from './buildPlanning.js';
import { IslandCentres } from './botTurn.js';
import { Gunner } from './combat.js';
import { PlanningSlots } from './planning.js';
import { Siting } from './siting.js';

/** How a bot spends its build phases beyond its level and personality. */
export interface BotOptions {
  /** Plays each build phase out in advance for several strategies and keeps the best. */
  plansAhead?: boolean;
  planWeights?: PlanWeights;
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
    this.builder = new Builder(playerId, this.profile, slots);
    this.siting = new Siting(playerId, this.profile, slots, islands, this.builder);
  }

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
   * In the intermission before a build phase, once the last shot is down and the board
   * fixed: the phase played out for every strategy, and the best kept (BUILD_PLANNING.md).
   * Its random draws, for a sloppy level's fits, come from a stream seeded now, so the
   * phase plays as the rollout did.
   */
  private planAhead(state: MatchState, rng: Rng): void {
    if (state.pendingPhase !== 'build' || state.shots.length > 0) return;
    if (this.chosen?.round === state.round) return;
    const seed = rng.nextU32();
    const plan = choosePlan(
      state,
      this.playerId,
      this.profile,
      seed,
      this.options.planWeights ?? DEFAULT_PLAN_WEIGHTS,
    );
    this.builder.strategy = plan?.strategy ?? null;
    this.chosen =
      plan === null
        ? null
        : { round: state.round, plan, next: 0, rng: new Rng(seed), onPlan: true };
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
