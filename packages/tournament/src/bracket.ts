/**
 * Seeding a knockout of any match sizes (TOURNAMENT §1.5).
 *
 * The bracket is a tree whose root is the final, with as many branches as the final has
 * teams, and so on down to the first round's matches. Seeds are dealt to a node's branches
 * in a snake — 1, 2, …, s, then s, …, 2, 1 — and each branch deals its own the same way.
 * For matches of two this is the familiar bracket, 1 v 8 and 4 v 5 in one half, 2 v 7 and
 * 3 v 6 in the other; for any sizes it keeps the best seeds apart until the latest round.
 */

/** Deals items to `groups` in a snake, so each group's best is as even as can be. */
export function snake<T>(items: readonly T[], groups: number): T[][] {
  const out = Array.from({ length: groups }, () => [] as T[]);
  items.forEach((item, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    out[row % 2 === 0 ? col : groups - 1 - col]?.push(item);
  });
  return out;
}

/**
 * The bracket's first-round order: `ranked` (best seed first, as many as the product of
 * `rounds`) laid out so that the first round's matches are consecutive runs of
 * `rounds[0]`, the next round's of `rounds[1]` such runs, and so on.
 */
export function seedBracket(ranked: readonly number[], rounds: readonly number[]): number[] {
  if (rounds.length === 0) return [...ranked];
  const root = rounds[rounds.length - 1] as number;
  const below = rounds.slice(0, -1);
  return snake(ranked, root).flatMap((branch) => seedBracket(branch, below));
}

/**
 * Moves `mover` out of `keep`'s branch of the final, if they share one, by swapping it
 * with the team at the same place in the next branch along — so the two can meet no
 * earlier than the final. The archnemesis is moved, never the host.
 */
export function separate(
  leaves: readonly number[],
  rounds: readonly number[],
  keep: number,
  mover: number,
): number[] {
  const out = [...leaves];
  const branches = rounds[rounds.length - 1] as number;
  const span = out.length / branches;
  const k = out.indexOf(keep);
  const m = out.indexOf(mover);
  if (k < 0 || m < 0 || Math.floor(k / span) !== Math.floor(m / span)) return out;
  const target = ((Math.floor(m / span) + 1) % branches) * span + (m % span);
  out[m] = out[target] as number;
  out[target] = mover;
  return out;
}

/** Consecutive runs of `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
