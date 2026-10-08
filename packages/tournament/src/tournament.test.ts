import { defaultConfigBundle, TOURNAMENT_LENGTHS } from '@bollwerk/config';
import { Rng, type MatchState } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { chunk, seedBracket, separate, snake } from './bracket.js';
import { createTournament, unbeatenRoad } from './create.js';
import { placings } from './placement.js';
import { matchTable, placedFrom } from './table.js';
import { knockoutSizes, largestField, loserRounds, matchdaySizes, product } from './plan.js';
import { Progress, hostHistory, recordMatch, rollHostMatch, stepsOf } from './progress.js';
import { NameDrawer } from './roster.js';
import { rollOrder } from './roll.js';
import { HOST_TEAM, parseSave, SAVE_VERSION, type Save } from './save.js';
import {
  settingsProblems,
  teamLimits,
  type SettingLimits,
  type TournamentSettings,
} from './settings.js';

const config = defaultConfigBundle.tournament;
const limits: SettingLimits = {
  players: defaultConfigBundle.ruleset.players,
  teamSize: defaultConfigBundle.server.lobbySettings.teamSize,
  maxRounds: defaultConfigBundle.tournament.maxRounds,
  continues: defaultConfigBundle.server.lobbySettings.continues,
};

function settingsFor(over: Partial<TournamentSettings> = {}): TournamentSettings {
  const teamSize = over.teamSize ?? 1;
  return {
    seed: 7,
    teamSize,
    hostName: 'Thomas',
    teamName: 'Die Wälle',
    teamBots: Array.from({ length: teamSize - 1 }, (_, i) => ({
      name: `Helper ${i + 1}`,
      level: 5,
    })),
    levels: { min: 3, max: 6 },
    archnemesis: null,
    length: 'medium',
    league: false,
    knockout: 'single',
    matchTeams: teamLimits(teamSize, limits.players) ?? { min: 2, max: 2 },
    maxRounds: 10,
    ...over,
  };
}

function make(over: Partial<TournamentSettings> = {}): Save {
  return createTournament(settingsFor(over), config, limits, { id: 't1', now: '2026-10-08' });
}

/** Records the host's match won, everyone else in the order the match lists them. */
function winNext(save: Save): Progress {
  const progress = new Progress(save);
  const teams = progress.next?.matches[progress.hostMatch] as number[];
  const order = [HOST_TEAM, ...teams.filter((t) => t !== HOST_TEAM)];
  return recordMatch(
    save,
    config,
    order.map((team) => ({ team, score: 100 })),
    'later',
  );
}

/** Records the host's match lost, the host last. */
function loseNext(save: Save): Progress {
  const progress = new Progress(save);
  const teams = progress.next?.matches[progress.hostMatch] as number[];
  const order = [...teams.filter((t) => t !== HOST_TEAM), HOST_TEAM];
  return recordMatch(
    save,
    config,
    order.map((team) => ({ team, score: 0 })),
    'later',
  );
}

function playOut(save: Save, next: (save: Save) => Progress): Progress {
  let progress = new Progress(save);
  for (let guard = 0; progress.status.kind === 'playing'; guard++) {
    if (guard > 100) throw new Error('the tournament does not end');
    progress = next(save);
  }
  return progress;
}

/** Every combination of the settings that shape a tournament, at its widest match range. */
function* shapes(): Generator<Partial<TournamentSettings>> {
  for (let teamSize = 1; teamSize <= 4; teamSize++) {
    const widest = teamLimits(teamSize, limits.players) as { min: number; max: number };
    const ranges = [
      widest,
      { min: widest.min, max: widest.min },
      { min: widest.max, max: widest.max },
    ];
    for (const length of TOURNAMENT_LENGTHS) {
      for (const league of [false, true]) {
        for (const knockout of ['single', 'double'] as const) {
          for (const matchTeams of ranges) yield { teamSize, length, league, knockout, matchTeams };
        }
      }
    }
  }
}

describe('a tournament', () => {
  it('runs as long as its length says for a team that never loses, in every shape', () => {
    for (const shape of shapes()) {
      const save = make(shape);
      const length = config.lengths[shape.length as keyof typeof config.lengths];
      const progress = playOut(save, winNext);
      expect(progress.status, JSON.stringify(shape)).toEqual({ kind: 'won' });
      // The length's rounds, unless matches so large a minimum would burst the cap.
      const range = shape.matchTeams as { min: number; max: number };
      const rounds = Math.min(
        length.knockoutRounds,
        Math.max(1, Math.floor(Math.log(config.maxField) / Math.log(range.min))),
      );
      expect(save.plan.rounds).toHaveLength(rounds);
      const expected =
        (shape.league === true ? length.leagueMatchdays : 0) +
        rounds +
        (shape.knockout === 'double' ? 1 : 0);
      expect(hostHistory(save).length, JSON.stringify(shape)).toBe(expected);
      expect(unbeatenRoad(save.settings, config)).toBe(expected);
      expect(progress.winner).toBe(HOST_TEAM);
    }
  });

  it('plays only matches of legal sizes', () => {
    for (const shape of shapes()) {
      for (const policy of [winNext, loseNext, (s: Save) => rollHostMatch(s, config, 5)]) {
        const save = make(shape);
        playOut(save, policy);
        const range = shape.matchTeams as { min: number; max: number };
        const steps = stepsOf(save);
        save.steps.forEach((record, index) => {
          const kind = steps[index]?.kind;
          for (const match of record.matches) {
            const n = match.teams.length;
            expect(new Set(match.order).size).toBe(n);
            expect(n).toBeLessThanOrEqual(range.max);
            if (kind === 'final') expect(n).toBe(2);
            // The losers' bracket may finish with a match below the minimum, never above.
            else if (kind !== 'losers') expect(n).toBeGreaterThanOrEqual(range.min);
            else expect(n).toBeGreaterThanOrEqual(2);
          }
        });
      }
    }
  });

  it('ends at once for a team that loses in single elimination', () => {
    const save = make({ knockout: 'single' });
    const progress = loseNext(save);
    expect(progress.status).toEqual({ kind: 'out', step: 0 });
    expect(save.steps).toHaveLength(1);
  });

  it('sends a team that loses in double elimination to the losers, and out after a second loss', () => {
    const save = make({ knockout: 'double', length: 'long' });
    let progress = loseNext(save);
    expect(progress.status.kind).toBe('playing');
    const steps = stepsOf(save);
    expect(steps[progress.done]?.kind).toBe('losers');
    progress = loseNext(save);
    expect(progress.status.kind).toBe('out');
  });

  it('can win from the losers bracket, through a longer road', () => {
    const save = make({ knockout: 'double', length: 'medium', matchTeams: { min: 2, max: 4 } });
    loseNext(save);
    const progress = playOut(save, winNext);
    expect(progress.status).toEqual({ kind: 'won' });
    // Long, but not absurd: the losers' bracket roughly doubles the road.
    expect(hostHistory(save).length).toBeGreaterThan(4);
    expect(hostHistory(save).length).toBeLessThanOrEqual(10);
  });

  it('caps the knockout field', () => {
    for (let seed = 0; seed < 20; seed++) {
      const min = 2 + (seed % 7);
      const save = make({ seed, length: 'long', matchTeams: { min, max: 8 } });
      expect(save.plan.advance).toBeLessThanOrEqual(config.maxField);
      expect(save.plan.advance).toBe(product(save.plan.rounds));
    }
  });

  it('is the same tournament from the same seed, and another from another', () => {
    const settings = { league: true, knockout: 'double' as const, teamSize: 2 };
    const a = make(settings);
    const b = make(settings);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    playOut(a, (s) => rollHostMatch(s, config, 6));
    playOut(b, (s) => rollHostMatch(s, config, 6));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(make({ ...settings, seed: 8 }).teams)).not.toBe(JSON.stringify(a.teams));
  });

  it('rolls the rest of a step the same whatever the host did', () => {
    const won = make({ league: true });
    const lost = JSON.parse(JSON.stringify(won)) as Save;
    const step = won.steps.length;
    winNext(won);
    loseNext(lost);
    const others = (save: Save): unknown =>
      save.steps[step]?.matches.filter((m) => !m.teams.includes(HOST_TEAM));
    expect(others(won)).toEqual(others(lost));
  });

  it('gives every team and bot a name of its own', () => {
    const save = make({
      teamSize: 2,
      league: true,
      length: 'long',
      matchTeams: { min: 4, max: 4 },
    });
    const bots = save.teams.flatMap((t) => t.members.map((m) => m.name));
    expect(new Set(bots).size).toBe(bots.length);
    const teams = save.teams.map((t) => t.name);
    expect(new Set(teams).size).toBe(teams.length);
    expect(save.teams[0]?.name).toBe('Die Wälle');
    expect(save.teams[0]?.members.map((m) => m.level)).toEqual([null, 5]);
  });

  it('names a team of one after its player', () => {
    const save = make({ teamSize: 1 });
    expect(save.teams[0]?.name).toBe('Thomas');
    for (const team of save.teams.slice(1)) expect(team.name).toBe(team.members[0]?.name);
  });

  it('deals levels in the range, and the archnemesis one above, leading its team', () => {
    const save = make({ teamSize: 3, archnemesis: 'Nemesis', levels: { min: 4, max: 7 } });
    const arch = save.teams.filter((t) => t.archnemesis);
    expect(arch).toHaveLength(1);
    expect(arch[0]?.members[0]).toMatchObject({ name: 'Nemesis', level: 8 });
    // His teammates the strongest the range allows.
    expect(arch[0]?.members.slice(1).map((m) => m.level)).toEqual([7, 7]);
    for (const team of save.teams.slice(1)) {
      for (const [seat, member] of team.members.entries()) {
        if (team.archnemesis && seat === 0) continue;
        expect(member.level).toBeGreaterThanOrEqual(4);
        expect(member.level).toBeLessThanOrEqual(7);
        expect(member.personality).not.toBeNull();
      }
    }
  });

  it('never puts the archnemesis out before the final, unless the host does', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const shape of [
        { knockout: 'single' as const, matchTeams: { min: 2, max: 4 } },
        { knockout: 'double' as const, league: true, length: 'long' as const },
        { knockout: 'double' as const, matchTeams: { min: 3, max: 3 } },
      ]) {
        const save = make({ seed, archnemesis: 'Nemesis', ...shape });
        const arch = save.teams.findIndex((t) => t.archnemesis);
        // The host as strong as can be, so tournaments go deep; or weak, out at once.
        const level = seed % 2 === 0 ? 10 : 1;
        const progress = playOut(save, (s) => rollHostMatch(s, config, level));
        const out = progress.outStep(arch);
        if (out === null) continue;
        const steps = stepsOf(save);
        const last = out === steps.length - 1;
        const byHost = save.steps[out]?.matches.some(
          (m) => m.teams.includes(arch) && m.teams.includes(HOST_TEAM),
        );
        expect(last || byHost, `seed ${seed}, out at step ${out}`).toBe(true);
      }
    }
  });

  it('lets the archnemesis drop to the losers bracket by chance in double elimination', () => {
    let dropped = 0;
    for (let seed = 0; seed < 80; seed++) {
      const save = make({ seed, archnemesis: 'Nemesis', knockout: 'double', length: 'long' });
      const arch = save.teams.findIndex((t) => t.archnemesis);
      const progress = playOut(save, (s) => rollHostMatch(s, config, 10));
      const steps = stepsOf(save);
      if (
        save.steps.some(
          (record, i) =>
            steps[i]?.kind === 'losers' && record.matches.some((m) => m.teams.includes(arch)),
        )
      )
        dropped++;
      void progress;
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('keeps the archnemesis from the host until the final', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const shape of [
        { matchTeams: { min: 2, max: 2 } },
        { matchTeams: { min: 2, max: 8 }, length: 'long' as const },
        { league: true, matchTeams: { min: 3, max: 5 } },
      ]) {
        const save = make({ seed, archnemesis: 'Nemesis', ...shape });
        playOut(save, winNext);
        const arch = save.teams.findIndex((t) => t.archnemesis);
        const steps = stepsOf(save);
        for (const { step, match } of hostHistory(save)) {
          const final = step === steps.length - 1;
          if (steps[step]?.kind === 'knockout' && !final) expect(match.teams).not.toContain(arch);
        }
      }
    }
  });
});

describe('the league', () => {
  it('awards a point for every team finished ahead of', () => {
    const save = make({ league: true, matchTeams: { min: 2, max: 5 } });
    const progress = winNext(save);
    const total = progress.table().reduce((sum, row) => sum + row.points, 0);
    const expected = (save.steps[0]?.matches ?? []).reduce(
      (sum, m) => sum + (m.teams.length * (m.teams.length - 1)) / 2,
      0,
    );
    expect(total).toBe(expected);
    expect(progress.table().find((r) => r.team === HOST_TEAM)?.points).toBe(
      (save.steps[0]?.matches.find((m) => m.teams.includes(HOST_TEAM))?.teams.length ?? 0) - 1,
    );
  });

  it('puts every team in one match a matchday, and the table ranks by points then Buchholz', () => {
    const save = make({ league: true, length: 'long', matchTeams: { min: 2, max: 4 } });
    for (const day of save.plan.matchdays) {
      expect(day.flat().sort((a, b) => a - b)).toEqual(save.teams.map((_, id) => id));
    }
    playOut(save, winNext);
    const rows = new Progress(save).table();
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]] as [(typeof rows)[0], (typeof rows)[0]];
      expect(a.points > b.points || (a.points === b.points && a.buchholz >= b.buchholz)).toBe(true);
    }
  });

  it('sends the top of the table through and everyone else home', () => {
    const save = make({ league: true, length: 'short' });
    const league = save.plan.matchdays.length;
    let progress = new Progress(save);
    for (let i = 0; i < league; i++) progress = winNext(save);
    const through = save.teams.filter((_, id) => progress.outStep(id) === null).length;
    expect(through).toBe(save.plan.advance);
    expect(save.teams.length).toBeGreaterThanOrEqual(save.plan.advance * config.leagueFactor);
  });

  it('plays every match of a matchday at one size', () => {
    for (let seed = 0; seed < 30; seed++) {
      const save = make({ seed, league: true, length: 'long', matchTeams: { min: 2, max: 8 } });
      for (const day of save.plan.matchdays) {
        expect(new Set(day.map((m) => m.length)).size).toBe(1);
      }
    }
  });

  it('always sends a team that won every league match through', () => {
    for (let seed = 0; seed < 200; seed++) {
      const save = make({ seed, league: true, length: 'short', matchTeams: { min: 2, max: 8 } });
      let progress = new Progress(save);
      for (let day = 0; day < save.plan.matchdays.length; day++) progress = winNext(save);
      expect(progress.status.kind, `seed ${seed}`).toBe('playing');
    }
  });

  it('meets an opponent twice only when the draw cannot avoid it', () => {
    const save = make({ league: true, length: 'long', matchTeams: { min: 2, max: 2 } });
    const met = new Set<string>();
    let repeats = 0;
    for (const day of save.plan.matchdays) {
      for (const [a, b] of day as [number, number][]) {
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        if (met.has(key)) repeats++;
        met.add(key);
      }
    }
    expect(repeats).toBe(0);
  });
});

describe('the bracket', () => {
  it('seeds two-team matches as the familiar bracket', () => {
    expect(seedBracket([0, 1, 2, 3, 4, 5, 6, 7], [2, 2, 2])).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it('keeps the best seeds apart until the latest round, at any sizes', () => {
    const rounds = [3, 2, 4];
    const leaves = seedBracket(
      Array.from({ length: product(rounds) }, (_, i) => i),
      rounds,
    );
    // The final's four branches each hold one of the top four seeds.
    const branches = chunk(leaves, leaves.length / 4);
    expect(branches.map((b) => Math.min(...b)).sort()).toEqual([0, 1, 2, 3]);
    // And every first-round match holds exactly one of the top eight.
    const matches = chunk(leaves, 3);
    for (const match of matches) expect(match.filter((s) => s < 8)).toHaveLength(1);
  });

  it('moves the archnemesis out of the host branch of the final', () => {
    const leaves = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(separate(leaves, [2, 2, 2], 0, 2)).toEqual([0, 1, 6, 3, 4, 5, 2, 7]);
    expect(separate(leaves, [2, 2, 2], 0, 5)).toEqual(leaves);
  });

  it('deals in a snake', () => {
    expect(snake([0, 1, 2, 3, 4, 5], 3)).toEqual([
      [0, 5],
      [1, 4],
      [2, 3],
    ]);
  });
});

describe('the plan', () => {
  it('offers a matchday only the sizes that divide the league', () => {
    expect(matchdaySizes(48, { min: 2, max: 8 })).toEqual([2, 3, 4, 6, 8]);
    expect(matchdaySizes(18, { min: 4, max: 5 })).toEqual([]);
  });

  it('lowers the largest round first to meet the cap, then drops rounds', () => {
    expect(knockoutSizes(new Rng(1), 4, { min: 8, max: 8 }, 64)).toEqual([8, 8]);
    expect(knockoutSizes(new Rng(1), 4, { min: 3, max: 3 }, 128)).toEqual([3, 3, 3, 3]);
    expect(knockoutSizes(new Rng(1), 2, { min: 2, max: 2 }, 2)).toEqual([2]);
    const sizes = knockoutSizes(new Rng(1), 4, { min: 2, max: 8 }, 64);
    expect(product(sizes)).toBeLessThanOrEqual(64);
  });

  it('finishes the losers bracket with one team left', () => {
    for (let seed = 0; seed < 50; seed++) {
      const range = { min: 2 + (seed % 3), max: 4 + (seed % 5) };
      const rounds = knockoutSizes(new Rng(seed), 3, range, 64);
      let pool = 0;
      let alive = product(rounds);
      const losers = loserRounds(new Rng(seed), rounds, range);
      rounds.forEach((size, round) => {
        alive /= size;
        pool += alive * (size - 1);
        for (const loser of losers.filter((l) => l.after === round)) {
          expect(loser.size).toBeLessThanOrEqual(pool);
          pool = Math.floor(pool / loser.size) + (pool % loser.size);
        }
      });
      expect(pool).toBe(1);
    }
  });
});

describe('settings', () => {
  it('are refused where a tournament cannot be made of them', () => {
    expect(settingsProblems(settingsFor(), limits)).toEqual([]);
    expect(
      settingsProblems(settingsFor({ archnemesis: 'X', levels: { min: 5, max: 10 } }), limits),
    ).toHaveLength(1);
    expect(
      settingsProblems(settingsFor({ teamSize: 3, matchTeams: { min: 2, max: 3 } }), limits),
    ).toHaveLength(1);
    expect(settingsProblems(settingsFor({ teamSize: 2, teamBots: [] }), limits)).toHaveLength(1);
    expect(
      settingsProblems(settingsFor({ teamSize: 5, teamBots: [] }), limits).length,
    ).toBeGreaterThan(0);
    expect(settingsProblems(settingsFor({ levels: { min: 6, max: 5 } }), limits)).toHaveLength(1);
  });

  it('allow two to eight teams alone, two to four in pairs, and two of three or four', () => {
    expect(teamLimits(1, limits.players)).toEqual({ min: 2, max: 8 });
    expect(teamLimits(2, limits.players)).toEqual({ min: 2, max: 4 });
    expect(teamLimits(3, limits.players)).toEqual({ min: 2, max: 2 });
    expect(teamLimits(4, limits.players)).toEqual({ min: 2, max: 2 });
  });
});

describe('a save', () => {
  it('reads back what was written', () => {
    const save = make({ league: true, knockout: 'double', teamSize: 2, archnemesis: 'Nemesis' });
    winNext(save);
    const read = parseSave(JSON.parse(JSON.stringify(save)));
    expect(read).toEqual({ ok: true, save });
  });

  it('tells another version from a damaged save', () => {
    const save = make();
    expect(parseSave({ ...save, version: SAVE_VERSION + 1 })).toEqual({
      ok: false,
      reason: 'version',
    });
    expect(parseSave({ ...save, teams: 'none' })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSave(null)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('stays small at the largest field', () => {
    const save = make({
      league: true,
      length: 'long',
      knockout: 'double',
      teamSize: 2,
      matchTeams: { min: 2, max: 4 },
    });
    playOut(save, winNext);
    expect(JSON.stringify(save).length).toBeLessThan(200_000);
  });
});

describe('a played match', () => {
  const player = (team: number, score: number, eliminatedRound: number | null) => ({
    team,
    score,
    eliminated: eliminatedRound !== null,
    eliminatedRound,
  });
  const state = (players: ReturnType<typeof player>[]) => ({ players }) as unknown as MatchState;

  it('places teams still in by score, then the rest by how late they went out', () => {
    const order = placings(
      state([player(0, 50, 3), player(1, 10, null), player(2, 90, 7), player(3, 40, null)]),
      new Rng(1),
    );
    expect(order.map((p) => p.team)).toEqual([3, 1, 2, 0]);
  });

  it('sums a team and breaks a tie on score, then on the coin', () => {
    const order = placings(
      state([player(0, 30, null), player(0, 30, null), player(1, 60, null)]),
      new Rng(1),
    );
    expect(order).toEqual(
      [
        { team: 0, score: 60 },
        { team: 1, score: 60 },
      ].sort((a, b) => (a.team === order[0]?.team ? -1 : b.team === order[0]?.team ? 1 : 0)),
    );
    const out = placings(state([player(0, 20, 4), player(1, 30, 4)]), new Rng(1));
    expect(out.map((p) => p.team)).toEqual([1, 0]);
  });
});

describe('a table', () => {
  it('seats each team in turn, labelled by its place in the match, and reads a result back', () => {
    const save = make({ teamSize: 2 });
    const teams = [3, HOST_TEAM, 5];
    const table = matchTable(save, teams);
    expect(table.seats.map((s) => s.team)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(table.seats[2]).toEqual({ name: 'Thomas', level: null, personality: null, team: 1 });
    expect(table.seats[3]?.name).toBe('Helper 1');
    expect(table.seats[0]?.name).toBe(save.teams[3]?.members[0]?.name);
    // The match's team 1 is the host's, 2 the tournament's team 5, 0 its team 3.
    const players = [0, 0, 1, 1, 2, 2].map((team, i) => ({
      team,
      score: [10, 10, 50, 50, 30, 30][i],
      eliminated: false,
      eliminatedRound: null,
    }));
    const state = { players } as unknown as MatchState;
    expect(placedFrom(state, table, new Rng(1))).toEqual([
      { team: HOST_TEAM, score: 100 },
      { team: 5, score: 60 },
      { team: 3, score: 20 },
    ]);
  });
});

describe('a roll', () => {
  it('favours the stronger team in proportion', () => {
    let wins = 0;
    const rng = new Rng(9);
    for (let i = 0; i < 4000; i++) if (rollOrder([0, 1], [3, 1], rng)[0] === 0) wins++;
    expect(wins / 4000).toBeGreaterThan(0.72);
    expect(wins / 4000).toBeLessThan(0.78);
  });
});

describe('names', () => {
  it('cover the largest field without a numeral', () => {
    const { teamSize } = limits;
    for (let size = teamSize.min; size <= teamSize.max; size++) {
      const range = teamLimits(size, limits.players);
      if (range === null) continue;
      const field = largestField(config, range);
      // Every bot but the host's team's, and the few the host's own names may take from it.
      const players = (field - 1) * size + size + 1;
      expect(config.names.players.length, `teams of ${size}`).toBeGreaterThanOrEqual(players);
      if (size > 1) expect(config.names.teams.length).toBeGreaterThanOrEqual(field);
    }
  });

  it('are all plain at the largest field', () => {
    const save = make({
      teamSize: 2,
      league: true,
      length: 'long',
      matchTeams: { min: 2, max: 4 },
      archnemesis: 'Ada',
    });
    const names = save.teams.flatMap((t) => [t.name, ...t.members.map((m) => m.name)]);
    expect(names.filter((n) => / [IVX]+$/.test(n))).toEqual([]);
  });

  it('go round again with a numeral once the pool is used up', () => {
    const names = new NameDrawer(['Ada', 'Bo'], new Rng(1), ['bo']);
    const drawn = [names.next(), names.next(), names.next()];
    // "Bo" is taken, so the first lap gives only "Ada"; the second gives both.
    expect(drawn[0]).toBe('Ada');
    expect(drawn.slice(1).sort()).toEqual(['Ada II', 'Bo II']);
  });
});
