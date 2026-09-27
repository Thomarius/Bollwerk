import type { ConfigBundle } from '@rampart/config';
import { replayRecording, type RecordingLine, type ReplayResult } from '@rampart/protocol';

import { RoundStats, type StatRow, type Tier } from './stats.js';

/**
 * A recorded match's per-round statistics, by replaying it through exactly the code a bot
 * soak is measured with — so rounds played by people and by bots share one table, a
 * person's seat marked `human`.
 *
 * Cheap: a whole ten-round match, every measurement included, replays in about 0.2 s,
 * the heaviest single measurement (the tightest seal still missing, as a build phase
 * ends) about 15 ms. Cheap enough for the server to do as a match ends.
 */
export function statsOfRecording(
  bundle: ConfigBundle,
  lines: readonly RecordingLine[],
): { rows: StatRow[]; replay: ReplayResult } {
  const header = lines[0];
  if (header?.kind !== 'header') throw new Error('a recording starts with its header');
  const tierOf = (player: number): Tier => header.players[player]?.difficulty ?? 'human';
  const sampler = new RoundStats(bundle, header.id, header.seed, tierOf);
  const replay = replayRecording(lines, (state, events) => sampler.observe(state, events));
  return { rows: sampler.rows, replay };
}
