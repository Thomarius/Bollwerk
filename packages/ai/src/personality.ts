import { TRAIT_VALUES, type Personality } from '@rampart/config';
import { streamFor, type Rng } from '@rampart/sim';

/**
 * Every player's personality for a match, by player, dealt rather than chosen (PLAN 11.6)
 * from a stream of the match seed, so the server, a local match and the client's reveal
 * deal the same and a replay reproduces it. Hidden during play; the summary reveals it at
 * game over.
 *
 * **From a bag per trait**, so a table is mixed: each trait's values shuffled, drawn
 * without replacement, and shuffled afresh once all are out. Drawn independently, two bots
 * at a table of three were the same in risk one time in three. Now no two share a value
 * until a bag is spent — three risks, four targetings, three cannon spaces.
 *
 * **Bots draw first**, in player order, then the people's seats, whose personality is
 * only for the bot that covers them if they drop: drawing in turn, a person between two
 * bots could empty a bag and let the second bot repeat the first.
 */
export function dealPersonalities(seed: number, isBot: readonly boolean[]): Personality[] {
  const rng = streamFor(seed, 'personalities');
  const risk = bag(rng, TRAIT_VALUES.risk);
  const targeting = bag(rng, TRAIT_VALUES.targeting);
  const cannons = bag(rng, TRAIT_VALUES.cannons);
  const players = isBot.map((_, player) => player);
  const order = [...players.filter((p) => isBot[p]), ...players.filter((p) => !isBot[p])];
  const out = new Array<Personality>(isBot.length);
  for (const player of order)
    out[player] = { risk: risk(), targeting: targeting(), cannons: cannons() };
  return out;
}

/** Draws from the values without replacement, refilling and reshuffling when empty. */
function bag<T>(rng: Rng, values: readonly T[]): () => T {
  let left: T[] = [];
  return () => {
    if (left.length === 0) left = rng.shuffle([...values]);
    return left.pop() as T;
  };
}
