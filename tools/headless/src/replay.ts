import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { statsOfRecording, type StatRow } from '@rampart/analysis';
import { personalityWords, type ConfigBundle } from '@rampart/config';
import { parseRecording, setupOfRecorded } from '@rampart/protocol';
import type { MatchState } from '@rampart/sim';

/**
 * Replays recordings of real matches (see `recording.ts` in the protocol) through the
 * same statistics a bot soak writes, so rounds played by people land in the same table
 * as rounds played by bots, a person's seat marked `human`.
 */

/**
 * Paths as typed, which is relative to where the command was run: `npm start -w` runs
 * the harness from its own package directory, and npm passes the original one along.
 */
function asTyped(path: string): string {
  return resolve(process.env['INIT_CWD'] ?? process.cwd(), path);
}

function recordingFiles(paths: readonly string[]): string[] {
  return paths.map(asTyped).flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((name) => name.endsWith('.jsonl'))
          .sort()
          .map((name) => join(path, name))
      : [path],
  );
}

function outcomeOf(state: MatchState): string {
  if (state.phase !== 'game_over') return `unfinished, round ${state.round}`;
  if (state.draw) return 'draw';
  const who = state.winners.map((id) => state.players[id]?.name ?? `player ${id}`).join(' + ');
  return state.endedBy === 'round_cap' ? `${who} on points` : `${who} last standing`;
}

export function replayAll(bundle: ConfigBundle, paths: readonly string[]): StatRow[] {
  const rows: StatRow[] = [];
  const files = recordingFiles(paths);
  console.log(`replaying ${files.length} recording(s)\n`);
  for (const file of files) {
    let lines;
    try {
      lines = parseRecording(readFileSync(file, 'utf8'));
    } catch (error) {
      console.log(`  ${file}: not a recording (${String(error).slice(0, 80)})`);
      continue;
    }
    const header = lines[0];
    if (header?.kind !== 'header') {
      console.log(`  ${file}: no header`);
      continue;
    }
    const tierOf = (player: number): string => {
      const setup = setupOfRecorded(header.players[player]);
      return setup === null ? 'human' : `L${setup.level} ${personalityWords(setup.personality)}`;
    };
    const { rows: matchRows, replay: result } = statsOfRecording(bundle, lines);
    rows.push(...matchRows);

    const who = header.players.map((p, id) => `${p.name}(${tierOf(id)})`).join(' ');
    // Exact unless the simulation has changed since the recording was made: its rules
    // and terrain travel in the header, but the code does not.
    const exact =
      result.mismatches.length === 0 && result.refused === 0
        ? 'exact'
        : `DIVERGED at tick ${result.mismatches[0] ?? '?'}, ${result.refused} refused — ` +
          (header.commit === undefined
            ? 'recorded with different code'
            : `recorded with ${header.commit}; check that out to replay it`);
    console.log(
      `  ${header.id}  ${header.source}  ${String(result.state.round).padStart(2)} rounds  ` +
        `${outcomeOf(result.state)}  [${exact}]\n    ${who}` +
        (header.commit === undefined ? '' : `  (code ${header.commit})`),
    );
  }
  return rows;
}
