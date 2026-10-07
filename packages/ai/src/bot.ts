import {
  BALANCED,
  botProfile,
  defaultAiConfig,
  type AiConfig,
  type BotProfile,
  type BotSetup,
} from '@bollwerk/config';
import { type Action, type MatchState, type Rng } from '@bollwerk/sim';

import { Builder } from './building.js';
import { IslandCentres } from './botTurn.js';
import { Gunner } from './combat.js';
import { PlanningSlots } from './planning.js';
import { Siting } from './siting.js';

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
  ) {
    this.setup = setup;
    this.profile = botProfile(ai, setup);
    const islands = new IslandCentres();
    this.gunner = new Gunner(playerId, this.profile, islands);
    this.builder = new Builder(playerId, this.profile, slots);
    this.siting = new Siting(playerId, this.profile, slots, islands, this.builder);
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
      case 'build':
        return this.builder.build(state, rng);
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
}
