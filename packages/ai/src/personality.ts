import { TRAIT_VALUES, type Personality } from '@rampart/config';
import { streamFor } from '@rampart/sim';

/**
 * A bot's personality, dealt rather than chosen (PLAN 11.6): each trait's value drawn
 * evenly, from a stream of the match seed named for the player, so the server and a local
 * match deal the same and a replay reproduces it. Hidden during play; the summary reveals
 * it at game over.
 */
export function dealPersonality(seed: number, player: number): Personality {
  const rng = streamFor(seed, `personality:${player}`);
  const pick = <T>(values: readonly T[]): T => values[rng.nextInt(values.length)] as T;
  return {
    risk: pick(TRAIT_VALUES.risk),
    targeting: pick(TRAIT_VALUES.targeting),
    cannons: pick(TRAIT_VALUES.cannons),
  };
}
