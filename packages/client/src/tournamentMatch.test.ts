import { applySettings, defaultConfigBundle } from '@bollwerk/config';
import { replayRecording, type RecordingLine } from '@bollwerk/protocol';
import {
  HOST_TEAM,
  Progress,
  coinFor,
  createTournament,
  mapSeed,
  matchTable,
  placedFrom,
  recordMatch,
  type Save,
} from '@bollwerk/tournament';
import { describe, expect, it } from 'vitest';

import { LocalMatch } from './localMatch.js';

const config = defaultConfigBundle.tournament;
const limits = {
  players: defaultConfigBundle.ruleset.players,
  teamSize: defaultConfigBundle.server.lobbySettings.teamSize,
  maxRounds: defaultConfigBundle.server.lobbySettings.maxRounds,
};

function tournament(): Save {
  return createTournament(
    {
      seed: 21,
      teamSize: 2,
      hostName: 'Thomas',
      teamName: 'Die Wälle',
      teamBots: [{ name: 'Mausi', level: 6 }],
      levels: { min: 4, max: 6 },
      archnemesis: null,
      length: 'short',
      league: false,
      knockout: 'single',
      matchTeams: { min: 2, max: 2 },
      maxRounds: limits.maxRounds.min,
    },
    config,
    limits,
    { id: 'tournament-test', now: '2026-10-08T10:00:00Z' },
  );
}

describe('a tournament match, played locally', () => {
  it('seats every bot as the tournament has it and records the result back', () => {
    const save = tournament();
    const progress = new Progress(save);
    const teams = progress.next?.matches[progress.hostMatch] as number[];
    const table = matchTable(save, teams);
    expect(table.seats.map((s) => s.team)).toEqual([0, 0, 1, 1]);

    // The host's seat played by a bot here, so the match runs to its end on its own.
    const lines: RecordingLine[] = [];
    const match = new LocalMatch({
      seed: mapSeed(save, progress.done),
      seats: table.seats.map((s) => s.level ?? 5),
      names: table.seats.map((s) => s.name),
      personalities: table.seats.map((s) => s.personality),
      teams: table.seats.map((s) => s.team),
      ruleset: applySettings(defaultConfigBundle.ruleset, {
        maxRounds: save.settings.maxRounds,
        teamSize: save.settings.teamSize,
      }),
      tournament: { id: save.id, step: progress.done },
      record: (line) => lines.push(line),
      thinkBudgetMs: Number.POSITIVE_INFINITY,
    });

    // Every seat is the tournament's: names, levels and personalities, wherever the deal
    // put it on the map.
    const opponents = save.teams[teams[1] as number];
    for (const member of opponents?.members ?? []) {
      const player = match.state.players.find((p) => p.name === member.name);
      expect(player, member.name).toBeDefined();
      expect(match.setups.get(player?.id ?? -1)).toEqual({
        level: member.level,
        personality: member.personality,
      });
    }
    const host = match.state.players.find((p) => p.name === 'Thomas');
    expect(host?.team).toBe(0);

    const header = lines[0];
    expect(header?.kind === 'header' && header.tournament).toEqual({
      id: 'tournament-test',
      step: progress.done,
    });

    for (let frame = 0; frame < 200_000 && !match.finished; frame++) match.advance(1000);
    expect(match.finished).toBe(true);
    expect(replayRecording(lines).mismatches).toEqual([]);

    const placed = placedFrom(match.state, table, coinFor(save, progress.done));
    expect(placed.map((p) => p.team).sort()).toEqual([...teams].sort());
    const after = recordMatch(save, config, placed, '2026-10-08T11:00:00Z');
    const result = save.steps[progress.done]?.matches[progress.hostMatch];
    expect(result?.order).toEqual(placed.map((p) => p.team));
    expect(result?.scores).toEqual(placed.map((p) => p.score));
    // Won, on to the next round; lost, out of a single elimination.
    expect(after.status.kind).toBe(placed[0]?.team === HOST_TEAM ? 'playing' : 'out');
    // A whole match of bots: under 4 s alone, past the default 5 s beside every other test.
  }, 60_000);
});
