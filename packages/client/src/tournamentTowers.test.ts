import { defaultConfigBundle, offeredVariants, TOWER_VARIANTS } from '@bollwerk/config';
import { TournamentTableSchema } from '@bollwerk/protocol';
import {
  HOST_TEAM,
  Progress,
  createTournament,
  matchTable,
  type Save,
  type TournamentSettings,
} from '@bollwerk/tournament';
import { describe, expect, it } from 'vitest';

import { roomTable } from './tournamentRoom.js';
import { seatTowers } from './tournamentTowers.js';

const limits = {
  players: defaultConfigBundle.ruleset.players,
  teamSize: defaultConfigBundle.server.lobbySettings.teamSize,
  maxRounds: defaultConfigBundle.tournament.maxRounds,
  continues: defaultConfigBundle.server.lobbySettings.continues,
};

function tournament(over: Partial<TournamentSettings> = {}, towers = true): Save {
  return createTournament(
    {
      seed: 21,
      teamSize: 2,
      hostName: 'Thomas',
      teamName: 'Die Wälle',
      teamBots: [{ name: 'Mausi', level: 6, tower: 'frost2' }],
      levels: { min: 4, max: 6 },
      archnemesis: null,
      length: 'short',
      league: false,
      knockout: 'single',
      matchTeams: { min: 2, max: 3 },
      maxRounds: limits.maxRounds.min,
      specials: true,
      ...over,
    },
    defaultConfigBundle.tournament,
    limits,
    { id: 'towers-test', now: '2026-10-28T10:00:00Z' },
    towers ? offeredVariants(defaultConfigBundle.ruleset.specials) : [],
  );
}

describe('the bots’ towers at a tournament’s matches', () => {
  it('brings each bot the tower the tournament fixed for it, and the host none', () => {
    const save = tournament();
    const opponent = save.teams.findIndex((team, id) => id !== HOST_TEAM && team.members.length);
    const table = matchTable(save, [HOST_TEAM, opponent]);
    expect(seatTowers(save, table)).toEqual([
      'drawn',
      'frost2',
      save.teams[opponent]?.members[0]?.tower,
      save.teams[opponent]?.members[1]?.tower,
    ]);
  });

  it('draws a tower for each bot of a save from before, the same at every match', () => {
    // As a save made before towers were fixed: none kept in it.
    const save = tournament({}, false);
    for (const team of save.teams) for (const m of team.members) expect(m.tower).toBeUndefined();
    const first = seatTowers(save, matchTable(save, [HOST_TEAM, 3]));
    const again = seatTowers(save, matchTable(save, [5, 3, HOST_TEAM]));
    // Team 3's two bots, wherever they sit at the table.
    expect(again.slice(2, 4)).toEqual(first.slice(2, 4));
    for (const tower of first.slice(1)) expect(TOWER_VARIANTS).toContain(tower);
  });

  it('brings none where the tournament plays no towers', () => {
    const save = tournament({ specials: false });
    expect(new Set(seatTowers(save, matchTable(save, [HOST_TEAM, 1])))).toEqual(new Set(['drawn']));
  });

  it('sends the room a table its schema takes, each bot with its tower', () => {
    const save = tournament();
    const table = roomTable(save, new Progress(save));
    expect(table).not.toBeNull();
    const parsed = TournamentTableSchema.safeParse(table);
    expect(parsed.success).toBe(true);
    const host = table?.seats.find((seat) => seat.level === null);
    expect(host?.tower).toBeUndefined();
    for (const seat of table?.seats.filter((s) => s.level !== null) ?? []) {
      expect(seat.tower).toBeDefined();
    }
  });
});
