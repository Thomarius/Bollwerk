import { TIERS, type StatRow, type Tier } from '@rampart/analysis';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The summary worth reading without opening the file.
 *
 * Active cannons and cannon room are the two numbers the stalemate is made of: a bot
 * whose wall has nowhere to put a gun cannot spend what it earns, and a table of
 * those cannot finish a match however long it runs.
 */
export function summariseStats(rows: StatRow[]): void {
  const byTier = new Map<Tier, StatRow[]>();
  for (const row of rows) {
    if (row.eliminated) continue;
    const list = byTier.get(row.difficulty);
    if (list === undefined) byTier.set(row.difficulty, [row]);
    else list.push(row);
  }
  if (byTier.size === 0) return;

  console.log('\nper surviving player-round, averaged:');
  console.log('  tier     sealed  owned  active  idle%   room  wall  pieces/budget   terr   dmg');
  for (const tier of TIERS) {
    const list = byTier.get(tier);
    if (list === undefined) continue;
    const owned = mean(list.map((r) => r.cannonsOwned));
    const active = mean(list.map((r) => r.cannonsActive));
    const idle = owned === 0 ? 0 : (1 - active / owned) * 100;
    // A person has no budget, and gets a dash rather than a ratio.
    const rated = list.filter((r) => r.piecesBudget !== null && r.piecesBudget > 0);
    const used =
      rated.length === 0
        ? null
        : mean(rated.map((r) => r.piecesPlaced / (r.piecesBudget as number)));
    console.log(
      `  ${tier.padEnd(8)} ${mean(list.map((r) => r.enclosedCastles))
        .toFixed(2)
        .padStart(5)}  ${owned.toFixed(1).padStart(5)}  ${active.toFixed(1).padStart(6)}  ` +
        `${idle.toFixed(0).padStart(4)}%  ${mean(list.map((r) => r.cannonRoom))
          .toFixed(1)
          .padStart(4)}  ${mean(list.map((r) => r.wallTiles))
          .toFixed(0)
          .padStart(
            4,
          )}  ${(used === null ? '—' : `${(used * 100).toFixed(0)}%`).padStart(12)}  ${mean(
          list.map((r) => r.territoryPoints),
        )
          .toFixed(0)
          .padStart(5)}  ${mean(list.map((r) => r.damagePoints))
          .toFixed(0)
          .padStart(4)}`,
    );
  }
}
