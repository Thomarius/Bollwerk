import { defaultConfigBundle } from '@bollwerk/config';
import {
  SAVE_VERSION,
  createTournament,
  Progress,
  recordMatch,
  settingsProblems,
  stepsOf,
  type Save,
  type TableRow,
} from '@bollwerk/tournament';
import { describe, expect, it } from 'vitest';

import { setLanguage } from './i18n.js';
import { resumeMarkup } from './tournamentResume.js';
import {
  deleteTournament,
  loadTournament,
  savedTournaments,
  writeTournament,
} from './tournamentSaves.js';
import {
  TOURNAMENT_LIMITS,
  defaultForm,
  reshapeForm,
  settingsOf,
  setupMarkup,
  type NameSource,
} from './tournamentSetup.js';
import { settingsLine, stageName } from './tournamentText.js';
import { endingMarkup, tableExcerpt, tournamentMarkup } from './tournamentView.js';

const config = defaultConfigBundle.tournament;

/** Names in turn, so a test knows which it gets. */
function names(): NameSource {
  let n = 0;
  return { team: () => `Team ${++n}`, player: () => `Mate ${++n}` };
}

/** A Storage over a map, as the browser's would hold the saves. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}

function tournament(id: string, playedAt: string, over: Partial<Save['settings']> = {}): Save {
  return createTournament(
    {
      seed: 3,
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
    { id, now: playedAt },
  );
}

describe('the new tournament form', () => {
  it('starts on settings that make a tournament', () => {
    setLanguage('en');
    const form = defaultForm(names());
    expect(settingsProblems(settingsOf(form, 'Ada', 1), TOURNAMENT_LIMITS)).toEqual([]);
  });

  it('gives the team a named teammate for each seat, and takes them away again', () => {
    const source = names();
    let form = reshapeForm(defaultForm(source), { teamSize: 3 }, source);
    expect(form.teamBots).toHaveLength(2);
    expect(new Set(form.teamBots.map((b) => b.name)).size).toBe(2);
    expect(form.teamBots.every((b) => b.level === defaultConfigBundle.server.botLevel)).toBe(true);
    form = reshapeForm(form, { teamSize: 2 }, source);
    expect(form.teamBots).toHaveLength(1);
  });

  it('brings the teams a match within what the team size allows', () => {
    const source = names();
    let form = reshapeForm(defaultForm(source), { matchTeams: { min: 5, max: 8 } }, source);
    expect(form.matchTeams).toEqual({ min: 5, max: 8 });
    form = reshapeForm(form, { teamSize: 2 }, source);
    expect(form.matchTeams).toEqual({ min: 4, max: 4 });
    form = reshapeForm(form, { teamSize: 4 }, source);
    expect(form.matchTeams).toEqual({ min: 2, max: 2 });
  });

  it('never lets a range cross, the end not moved giving way', () => {
    const source = names();
    const form = defaultForm(source);
    expect(reshapeForm(form, { levels: { min: 8, max: form.levels.max } }, source).levels).toEqual({
      min: 8,
      max: 8,
    });
    expect(reshapeForm(form, { levels: { min: form.levels.min, max: 2 } }, source).levels).toEqual({
      min: 2,
      max: 2,
    });
  });

  it('keeps the range below the last level with an archnemesis', () => {
    const source = names();
    let form = reshapeForm(defaultForm(source), { levels: { min: 10, max: 10 } }, source);
    form = reshapeForm(form, { archnemesis: true }, source);
    expect(form.levels).toEqual({ min: 9, max: 9 });
    expect(settingsOf(form, 'Ada', 1).archnemesis).toBe(form.archName);
  });

  it('shows a team name and the teams a match only where they apply', () => {
    const source = names();
    const alone = setupMarkup(defaultForm(source), 'Ada');
    expect(alone).not.toContain('id="team-name"');
    expect(alone).toContain('id="match-teams-min"');
    const three = setupMarkup(reshapeForm(defaultForm(source), { teamSize: 3 }, source), 'Ada');
    expect(three).toContain('id="team-name"');
    expect(three).not.toContain('id="match-teams-min"');
    expect(three.match(/class="mate-name/g)).toHaveLength(2);
  });

  it('falls back on the host for an empty team name', () => {
    const source = names();
    const form = reshapeForm(defaultForm(source), { teamSize: 2, teamName: '  ' }, source);
    expect(settingsOf(form, 'Ada', 1).teamName).toBe('Ada');
  });
});

describe('saved tournaments', () => {
  it('are written, listed played last first, read back and deleted', () => {
    const area = memoryStorage();
    const older = tournament('t-1', '2026-10-01T10:00:00Z');
    const newer = tournament('t-2', '2026-10-05T10:00:00Z');
    expect(writeTournament(older, area)).toBe(true);
    expect(writeTournament(newer, area)).toBe(true);
    area.setItem('bollwerk.name', 'not a tournament');
    expect(savedTournaments(area).map((s) => s.id)).toEqual(['t-2', 't-1']);
    expect(loadTournament('t-1', area)).toEqual(older);
    deleteTournament('t-1', area);
    expect(savedTournaments(area).map((s) => s.id)).toEqual(['t-2']);
    expect(loadTournament('t-1', area)).toBeNull();
  });

  it('tell a save of another version, named as far as it can be, from a damaged one', () => {
    const area = memoryStorage();
    const save = tournament('t-1', '2026-10-01T10:00:00Z');
    area.setItem('bollwerk.tournament.t-1', JSON.stringify({ ...save, version: SAVE_VERSION + 1 }));
    area.setItem('bollwerk.tournament.t-2', '{ not json');
    const [old, broken] = savedTournaments(area);
    expect(old).toMatchObject({ id: 't-1', kind: 'version', name: 'Ada' });
    expect(broken).toMatchObject({ id: 't-2', kind: 'invalid', name: null });
    const markup = resumeMarkup(savedTournaments(area), null, null);
    expect(markup).not.toContain('class="resume"');
    expect(markup.match(/class="delete/g)).toHaveLength(2);
  });

  it('report a write the browser refuses', () => {
    const area = memoryStorage();
    area.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writeTournament(tournament('t-1', '2026-10-01T10:00:00Z'), area)).toBe(false);
    expect(writeTournament(tournament('t-1', '2026-10-01T10:00:00Z'), null)).toBe(false);
  });

  it('ask before a delete, and offer no resume while asking', () => {
    const area = memoryStorage();
    writeTournament(tournament('t-1', '2026-10-01T10:00:00Z'), area);
    const asking = resumeMarkup(savedTournaments(area), 't-1', null);
    expect(asking).toContain('class="confirm-delete"');
    expect(asking).not.toContain('class="resume"');
    expect(resumeMarkup([], null, null)).toContain('No tournament is saved');
  });
});

describe('a tournament in words', () => {
  it('names the knockout rounds back from the final', () => {
    setLanguage('en');
    const save = tournament('t', 'now', { length: 'long' });
    const steps = stepsOf(save);
    expect(steps.map((_, i) => stageName(save, i))).toEqual([
      'Knockout, round 1',
      'Quarter-final',
      'Semi-final',
      'Final',
    ]);
  });

  it('names the league, both brackets and the final of double elimination', () => {
    setLanguage('en');
    const save = tournament('t', 'now', { league: true, knockout: 'double', length: 'short' });
    const names = stepsOf(save).map((_, i) => stageName(save, i));
    expect(names[0]).toBe('League, matchday 1 of 2');
    expect(names).toContain("Winners' final");
    expect(names).toContain("Losers' final");
    expect(names.at(-1)).toBe('Final');
    expect(settingsLine(save.settings)).toBe('Short · Solo · League · Double elimination');
  });

  it('has the next stage of a tournament under way', () => {
    setLanguage('en');
    const save = tournament('t', 'now');
    const progress = new Progress(save);
    const teams = progress.next?.matches[progress.hostMatch] ?? [];
    const order = [0, ...teams.filter((team) => team !== 0)];
    recordMatch(
      save,
      config,
      order.map((team) => ({ team, score: 1 })),
      'later',
    );
    const markup = resumeMarkup([{ id: 't', kind: 'ok', save }], null, null);
    expect(markup).toContain('Next: Semi-final');
  });
});

describe('the tournament between matches', () => {
  const row = (team: number): TableRow => ({ team, points: 0, buchholz: 0, played: 0 });

  it('cuts the table to its top, the host, and the cut', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0, 19, 20].map(
      row,
    );
    const lines = tableExcerpt(rows, 10);
    const ranks = lines.map((l) => (l === 'gap' ? 'gap' : l.rank));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 'gap', 10, 11, 'gap', 17, 18, 19, 20, 21]);
  });

  it('shows the whole table when it is short', () => {
    const lines = tableExcerpt([0, 1, 2, 3].map(row), 2);
    expect(lines).toHaveLength(4);
  });

  it('shows the next match, the league table and the last result', () => {
    setLanguage('en');
    const save = tournament('t', 'now', {
      league: true,
      archnemesis: 'Nemesis',
      levels: { min: 4, max: 6 },
    });
    const progress = new Progress(save);
    const ahead = tournamentMarkup(save, progress, null);
    expect(ahead).toContain('Next: League, matchday 1 of 3');
    expect(ahead).toContain('the top');
    expect(ahead).not.toContain('class="last-result');
    const teams = progress.next?.matches[progress.hostMatch] ?? [];
    recordMatch(
      save,
      config,
      [0, ...teams.filter((t) => t !== 0)].map((team) => ({ team, score: 1234 })),
      'later',
    );
    const after = tournamentMarkup(save, new Progress(save), 'A notice');
    expect(after).toContain('Last match, League, matchday 1 of 3: 1st of 2 · 1234 points');
    expect(after).toContain('class="league-table"');
    expect(after).toContain('A notice');
  });

  it('shows the knockout around the host, the archnemesis by name', () => {
    setLanguage('en');
    const save = tournament('t', 'now', {
      archnemesis: 'Nemesis',
      knockout: 'double',
      length: 'long',
    });
    const markup = tournamentMarkup(save, new Progress(save), null);
    expect(markup).toContain('Nemesis, the archnemesis, is still in.');
    expect(markup).toMatch(/Your team is in the winners(&#39;|') bracket/);
    expect(markup).toContain('The other matches');
  });

  it('ends with the road, won or out', () => {
    setLanguage('en');
    const won = tournament('t', 'now', { length: 'short' });
    let progress = new Progress(won);
    while (progress.status.kind === 'playing') {
      const teams = progress.next?.matches[progress.hostMatch] ?? [];
      progress = recordMatch(
        won,
        config,
        [0, ...teams.filter((t) => t !== 0)].map((team) => ({ team, score: 9 })),
        'later',
      );
    }
    const champion = endingMarkup(won, progress);
    expect(champion).toContain('Champions!');
    expect(champion.match(/<tr class="won">/g)).toHaveLength(2);

    const out = tournament('t', 'now');
    const first = new Progress(out);
    const teams = first.next?.matches[first.hostMatch] ?? [];
    progress = recordMatch(
      out,
      config,
      [...teams.filter((t) => t !== 0), 0].map((team) => ({ team, score: 9 })),
      'later',
    );
    const exit = endingMarkup(out, progress);
    expect(exit).toContain('Out of the tournament');
    expect(exit).toContain('Knocked out: Quarter-final.');
  });
});
