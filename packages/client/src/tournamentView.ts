import {
  HOST_TEAM,
  hostHistory,
  stepsOf,
  type Progress,
  type Save,
  type TableRow,
  type Team,
} from '@bollwerk/tournament';

import { escape } from './html.js';
import { formatNumber, ordinal, t } from './i18n.js';
import type { LobbyTab, TournamentTab } from './lobby.js';
import { isLastStep, settingsLine, stageName } from './tournamentText.js';

/**
 * A tournament between its matches, as markup (TOURNAMENT §1.8): where it stands — the
 * league's table, or the knockout around the host's road — the match to play next and the
 * last one played; and its two endings. Pure, so it is tested without a page.
 */

/** A line of the league's table as shown, or a gap where lines are left out. */
export type TableLine = { row: TableRow; rank: number } | 'gap';

/**
 * The table cut down to what matters (TOURNAMENT §1.8): its top, the host's neighbourhood,
 * and the lines either side of the cut, in order, with a gap wherever lines are skipped.
 */
export function tableExcerpt(
  rows: readonly TableRow[],
  advance: number,
  top = 5,
  around = 2,
): TableLine[] {
  const host = rows.findIndex((r) => r.team === HOST_TEAM);
  const keep = (i: number): boolean =>
    i < top || Math.abs(i - host) <= around || i === advance - 1 || i === advance;
  const out: TableLine[] = [];
  rows.forEach((row, i) => {
    if (keep(i)) out.push({ row, rank: i + 1 });
    else if (out.at(-1) !== 'gap') out.push('gap');
  });
  return out;
}

function teamName(save: Save, id: number): string {
  return (save.teams[id] as Team).name;
}

/** The tag after a team's name: the host's, the archnemesis's, or none. */
function teamTag(save: Save, id: number): string {
  if (id === HOST_TEAM) return ` <em class="tag you">${t('tournament.yourTeamTag')}</em>`;
  return save.teams[id]?.archnemesis === true
    ? ` <em class="tag arch">${t('tournament.archTag')}</em>`
    : '';
}

/** A team's name, marked as the host's or the archnemesis's. */
function teamLabel(save: Save, id: number): string {
  return `${escape((save.teams[id] as Team).name)}${teamTag(save, id)}`;
}

/** The host's last match, in a line: where, the place, and the score where one was played. */
function lastResult(save: Save): string {
  const last = hostHistory(save).at(-1);
  if (last === undefined) return '';
  const place = last.match.order.indexOf(HOST_TEAM);
  const score = last.match.scores?.[place];
  const text = t('tournament.lastResult', {
    stage: stageName(save, last.step),
    place: ordinal(place + 1),
    of: last.match.teams.length,
  });
  const points =
    score === undefined ? '' : ` · ${t('tournament.points', { n: formatNumber(score) })}`;
  return `<p class="last-result${place === 0 ? ' won' : ''}">${escape(text + points)}</p>`;
}

function leagueTable(save: Save, progress: Progress): string {
  const lines = tableExcerpt(progress.table(), save.plan.advance)
    .map((line) => {
      if (line === 'gap') return `<tr class="gap"><td colspan="4">…</td></tr>`;
      const { row, rank } = line;
      const classes = [
        row.team === HOST_TEAM ? 'mine' : '',
        rank <= save.plan.advance ? 'through' : '',
        rank === save.plan.advance ? 'cut' : '',
      ].filter((c) => c !== '');
      return (
        `<tr${classes.length > 0 ? ` class="${classes.join(' ')}"` : ''}><td>${rank}</td><td>${teamLabel(save, row.team)}</td>` +
        `<td>${row.points}</td><td>${row.buchholz}</td></tr>`
      );
    })
    .join('');
  return (
    `<table class="league-table"><thead><tr><th>#</th><th>${t('tournament.team')}</th>` +
    `<th title="${escape(t('tournament.pointsTitle'))}">${t('tournament.pointsShort')}</th>` +
    `<th title="${escape(t('tournament.buchholzTitle'))}">${t('tournament.buchholzShort')}</th></tr></thead>` +
    `<tbody>${lines}</tbody></table>` +
    `<p class="note">${escape(t('tournament.through', { n: save.plan.advance, of: save.teams.length }))}</p>`
  );
}

/** The knockout around the host: who is still in, the archnemesis, the step's other matches. */
function knockoutView(save: Save, progress: Progress): string {
  const lines: string[] = [];
  if (save.settings.knockout === 'double') {
    lines.push(
      t('tournament.brackets', {
        winners: progress.winnersBracket.length,
        losers: progress.losersBracket.length,
      }),
    );
    lines.push(
      progress.losersBracket.includes(HOST_TEAM)
        ? t('tournament.inLosers')
        : t('tournament.inWinners'),
    );
  } else {
    lines.push(t('tournament.stillIn', { n: progress.winnersBracket.length }));
  }
  const arch = save.teams.findIndex((team) => team.archnemesis);
  if (arch > 0) {
    // The archnemesis by name, and its team's too where that is another.
    const team = save.teams[arch] as Team;
    const leader = team.members[0]?.name ?? team.name;
    const name = leader === team.name ? leader : `${leader} (${team.name})`;
    lines.push(
      progress.outStep(arch) === null
        ? t('tournament.archIn', { name })
        : t('tournament.archOut', { name }),
    );
  }
  const others = (progress.next?.matches ?? []).filter((m) => !m.includes(HOST_TEAM));
  const shown = others.slice(0, 6).map((m) => m.map((id) => teamLabel(save, id)).join(' · '));
  const more =
    others.length > shown.length
      ? `<li class="more">${escape(t('tournament.moreMatches', { n: others.length - shown.length }))}</li>`
      : '';
  const otherList =
    others.length === 0
      ? ''
      : `<h3>${t('tournament.otherMatches')}</h3><ul class="other-matches">${shown.map((m) => `<li>${m}</li>`).join('')}${more}</ul>`;
  return `${lines.map((l) => `<p>${escape(l)}</p>`).join('')}${otherList}`;
}

/** The knockout's tree as a button: an icon beside the heading it belongs with. */
function bracketButton(): string {
  const label = escape(t('tournament.bracket'));
  return (
    `<button id="bracket" class="icon-button" title="${label}" aria-label="${label}">` +
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">` +
    `<path d="M3 4h5v6H3M3 14h5v6H3M8 7h4v10H8M12 12h4M16 12h5"/></svg></button>`
  );
}

/**
 * The tournament's tab of the lobby (TOURNAMENT §1.7, §1.8), the same on the host's page
 * and a teammate's: the settings, the last result, the standings with the bracket beside
 * them, and the step's other matches. The match itself is the other tab's.
 */
export function tournamentTab(save: Save, progress: Progress, open: LobbyTab): TournamentTab {
  const step = stepsOf(save)[progress.done];
  const inLeague = step?.kind === 'league';
  const standings = inLeague
    ? progress.done === 0
      ? `<p class="note">${escape(t('tournament.leagueAhead', { days: save.plan.matchdays.length, n: save.plan.advance }))}</p>`
      : leagueTable(save, progress)
    : knockoutView(save, progress);
  const markup = `
      <p class="note subtitle">${escape(settingsLine(save.settings))}</p>
      ${lastResult(save)}
      <section class="standings">
        <h2>${inLeague ? t('tournament.league') : t('tournament.knockout')}${bracketButton()}</h2>
        ${standings}
      </section>`;
  const match = progress.next?.matches[progress.hostMatch] ?? [];
  return {
    markup,
    open,
    lastMatch: isLastStep(save, progress.done),
    teamTags: match.map((id) => teamTag(save, id)),
  };
}

/** The end of a tournament, won or out: the team's road through it, match by match. */
export function endingMarkup(save: Save, progress: Progress): string {
  const won = progress.status.kind === 'won';
  const out = progress.status.kind === 'out' ? progress.status.step : null;
  const headline = won ? t('tournament.wonTitle') : t('tournament.outTitle');
  const line = won
    ? t('tournament.wonLine', { team: teamName(save, HOST_TEAM) })
    : out !== null &&
        stepsOf(save)[out]?.kind === 'league' &&
        hostHistory(save).at(-1)?.step === out
      ? t('tournament.outLeague', { n: save.plan.advance })
      : t('tournament.outLine', { stage: out === null ? '' : stageName(save, out) });
  const rows = hostHistory(save)
    .map(({ step, match }) => {
      const place = match.order.indexOf(HOST_TEAM);
      const score = match.scores?.[place];
      const others = match.teams
        .filter((id) => id !== HOST_TEAM)
        .map((id) => teamLabel(save, id))
        .join(' · ');
      return (
        `<tr${place === 0 ? ' class="won"' : ''}><td>${escape(stageName(save, step))}</td><td>${others}</td>` +
        `<td>${escape(t('tournament.placeOf', { place: ordinal(place + 1), of: match.teams.length }))}</td>` +
        `<td>${score === undefined ? '' : escape(formatNumber(score))}</td></tr>`
      );
    })
    .join('');
  return `
    <div class="menu lobby tournament-ending ${won ? 'won' : 'out'}">
      <h1>${escape(headline)}</h1>
      <p class="ending-line">${escape(line)}</p>
      <p class="note subtitle">${escape(settingsLine(save.settings))}</p>
      <h2>${t('tournament.yourMatches')}${bracketButton()}</h2>
      <table class="road"><thead><tr><th>${t('tournament.stage')}</th><th>${t('tournament.against')}</th><th>${t('tournament.place')}</th><th>${t('tournament.score')}</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <button id="back">${t('watching.back')}</button>
    </div>`;
}
