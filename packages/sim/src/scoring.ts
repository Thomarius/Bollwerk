import type { Ruleset } from '@bollwerk/config';

import type { EnclosureResult } from './enclosure.js';
import type { MatchState } from './types.js';

/**
 * The scoring formula for held ground, in one place (PLAN §1.7, docs/SCORING.md): the
 * resolution banks it, and the bots value a wall they might build by it — so a bot never
 * weighs ground by a rule the match no longer plays.
 */

/** What a player holds, as the scoring counts it. */
export interface Holding {
  /** Sealed tiles, castle and gun footprints and pockets included (PLAN §1.3). */
  tiles: number;
  /** Sealed castles; none means nothing held scores. */
  castles: number;
  /** Guns standing on the player's sealed territory, so firing. */
  guns: number;
}

export interface HeldPoints {
  territoryPoints: number;
  gunPoints: number;
}

/**
 * The points a holding is worth at a resolution. Ground is `tilePoints` a tile, multiplied
 * by the castles sealed only under the old rule (`castleMultiplier`, kept so recordings
 * made before 2026-10-14 replay): the product grew with the square of the castles held,
 * so a minimal ring round an outer castle doubled everything already held. Each gun firing
 * earns `gunPoints` instead, so a castle pays through the guns it brings, round by round.
 * Nothing without a sealed castle: a pocket alone never scores.
 */
export function heldPoints(scoring: Ruleset['scoring'], holding: Holding): HeldPoints {
  if (holding.castles <= 0) return { territoryPoints: 0, gunPoints: 0 };
  const multiplier = scoring.castleMultiplier ? holding.castles : 1;
  return {
    territoryPoints: scoring.tilePoints * holding.tiles * multiplier,
    gunPoints: scoring.gunPoints * holding.guns,
  };
}

/** `heldPoints` as one number, for the bots weighing one wall against another. */
export function heldValue(scoring: Ruleset['scoring'], holding: Holding): number {
  const { territoryPoints, gunPoints } = heldPoints(scoring, holding);
  return territoryPoints + gunPoints;
}

/** The parts of an enclosure the scoring reads. */
export type ScoredEnclosure = Pick<
  EnclosureResult,
  'territory' | 'enclosedCastlesByPlayer' | 'cannonActive'
>;

/**
 * Every player's holding, by player id, in one pass over the board: under `enclosure`, a
 * wall a bot is weighing, or without it as the state last resolved it — which mid-combat
 * still counts a breached wall as sealed.
 */
export function holdingsOf(state: MatchState, enclosure?: ScoredEnclosure): Holding[] {
  const territory = enclosure?.territory ?? state.territory;
  const holdings = state.players.map((player) => ({
    tiles: 0,
    castles: enclosure
      ? (enclosure.enclosedCastlesByPlayer[player.id] ?? 0)
      : player.enclosedCastles,
    guns: 0,
  }));
  for (let i = 0; i < territory.length; i++) {
    const mark = territory[i] as number;
    if (mark > 0) {
      const holding = holdings[mark - 1];
      if (holding) holding.tiles++;
    }
  }
  for (let c = 0; c < state.cannons.length; c++) {
    const cannon = state.cannons[c] as (typeof state.cannons)[number];
    const holding = holdings[cannon.owner];
    if (holding && (enclosure ? enclosure.cannonActive[c] : cannon.active)) holding.guns++;
  }
  return holdings;
}

/** One player's holding, as `holdingsOf` counts it. */
export function holdingOf(
  state: MatchState,
  playerId: number,
  enclosure?: ScoredEnclosure,
): Holding {
  return holdingsOf(state, enclosure)[playerId] ?? { tiles: 0, castles: 0, guns: 0 };
}
