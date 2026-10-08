import { defaultConfigBundle } from '@bollwerk/config';
import {
  HOST_TEAM,
  Progress,
  createTournament,
  recordMatch,
  type Save,
  type TournamentSettings,
} from '@bollwerk/tournament';
import { describe, expect, it } from 'vitest';

import { bracketLayout } from './tournamentBracket.js';
import { TOURNAMENT_LIMITS } from './tournamentSetup.js';

const config = defaultConfigBundle.tournament;

function tournament(over: Partial<TournamentSettings>): Save {
  return createTournament(
    {
      seed: 4,
      teamSize: 1,
      hostName: 'Ada',
      teamName: 'Ada',
      teamBots: [],
      levels: { min: 4, max: 6 },
      archnemesis: null,
      length: 'medium',
      league: false,
      knockout: 'single',
      matchTeams: { min: 2, max: 2 },
      maxRounds: 10,
      ...over,
    },
    config,
    TOURNAMENT_LIMITS,
    { id: 't', now: 'now' },
  );
}

function win(save: Save): Progress {
  const progress = new Progress(save);
  const teams = progress.next?.matches[progress.hostMatch] ?? [];
  const order = [HOST_TEAM, ...teams.filter((t) => t !== HOST_TEAM)];
  return recordMatch(
    save,
    config,
    order.map((team) => ({ team, score: 1 })),
    'later',
  );
}

describe('the bracket', () => {
  it('draws a knockout of eight in pairs as a tree of seven matches', () => {
    const save = tournament({});
    const layout = bracketLayout(save, new Progress(save));
    expect(layout.nodes.map((n) => n.x)).toEqual([0, 0, 0, 0, 1, 1, 2]);
    expect(layout.edges).toHaveLength(6);
    // Each later match level with the middle of the two it draws on.
    const [a, b, , , ab] = layout.nodes;
    expect(ab?.y).toBe(((a?.y ?? 0) + (b?.y ?? 0)) / 2);
    expect(layout.losersTop).toBeNull();
    // The first round known, its host's match the next; the rest still to come.
    expect(layout.nodes.filter((n) => n.state === 'next')).toHaveLength(4);
    expect(layout.nodes.filter((n) => n.host)).toHaveLength(1);
    expect(layout.nodes.filter((n) => n.state === 'later' && n.teams === null)).toHaveLength(3);
  });

  it('shows the host road in gold as it is played', () => {
    const save = tournament({});
    const progress = win(save);
    const layout = bracketLayout(save, progress);
    const hosts = layout.nodes.filter((n) => n.host);
    expect(hosts.map((n) => n.x)).toEqual([0, 1]);
    expect(layout.edges.filter((e) => e.host)).toHaveLength(1);
    expect(hosts[0]?.order?.[0]).toBe(HOST_TEAM);
  });

  it('draws matches of four as boxes too, with no edges crossing columns', () => {
    const save = tournament({ matchTeams: { min: 4, max: 4 }, length: 'short' });
    const layout = bracketLayout(save, new Progress(save));
    expect(layout.nodes.map((n) => n.x)).toEqual([0, 0, 0, 0, 1]);
    expect(layout.edges).toHaveLength(4);
  });

  it('adds the losers bracket below and the final at the right in double elimination', () => {
    const save = tournament({ knockout: 'double' });
    const layout = bracketLayout(save, new Progress(save));
    const final = layout.nodes.filter((n) => n.section === 'final');
    expect(final).toHaveLength(1);
    expect(final[0]?.x).toBe(layout.columns - 1);
    const losers = layout.nodes.filter((n) => n.section === 'losers');
    expect(losers.length).toBeGreaterThan(0);
    expect(losers.every((n) => n.y >= (layout.losersTop ?? Infinity) - 0.5)).toBe(true);
    expect(layout.edges.filter((e) => e.to === final[0]?.key)).toHaveLength(2);
  });

  it('marks the archnemesis wherever he plays', () => {
    const save = tournament({ archnemesis: 'Nemesis', levels: { min: 4, max: 6 } });
    const layout = bracketLayout(save, new Progress(save));
    expect(layout.nodes.filter((n) => n.arch)).toHaveLength(1);
  });
});
