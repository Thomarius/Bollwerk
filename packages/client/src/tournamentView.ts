import {
  HOST_TEAM,
  hostHistory,
  stepsOf,
  type Progress,
  type Save,
  type TableRow,
  type Team,
} from '@bollwerk/tournament';

import type { Seat, TournamentTable } from '@bollwerk/protocol';

import { escape } from './html.js';
import { formatNumber, ordinal, t } from './i18n.js';
import { levelPips } from './lobby.js';
import { isLastStep, settingsLine, stageLabel, stageName } from './tournamentText.js';

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

/** A team's name, marked as the host's or the archnemesis's. */
function teamLabel(save: Save, id: number): string {
  const team = save.teams[id] as Team;
  const tag =
    id === HOST_TEAM
      ? ` <em class="tag you">${t('tournament.yourTeamTag')}</em>`
      : team.archnemesis
        ? ` <em class="tag arch">${t('tournament.archTag')}</em>`
        : '';
  return `${escape(team.name)}${tag}`;
}

/** A team as a card: its name, then each member with a level, the host as a person. */
function teamCard(save: Save, id: number): string {
  const team = save.teams[id] as Team;
  const members = team.members
    .map((m) =>
      m.level === null
        ? `<li><span class="who">${escape(m.name)}</span></li>`
        : `<li><span class="who">${escape(m.name)}</span>${levelPips(m.level)}</li>`,
    )
    .join('');
  const solo = team.members.length === 1 && team.members[0]?.name === team.name;
  const mine = id === HOST_TEAM ? ' mine' : team.archnemesis ? ' arch' : '';
  return (
    `<li class="team-card${mine}"><b>${teamLabel(save, id)}</b>` +
    (solo && team.members[0]?.level === null ? '' : `<ul>${members}</ul>`) +
    `</li>`
  );
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

/** The tournament's room as its panel shows it (TOURNAMENT §1.7). */
export interface RoomPanel {
  code: string;
  invite: string | null;
  /** The table the room was last sent. */
  table: TournamentTable;
  /** The people at it, the host among them. */
  people: readonly Seat[];
  hostId: number;
}

/**
 * The room, for the host: its code and invitation, and the host's team's seats — each
 * teammate's bot, or the person who took its seat, who may be moved to another so that a
 * different bot sits the match out.
 */
export function roomPanelMarkup(panel: RoomPanel): string {
  const { table, people } = panel;
  const hostTeam = table.seats[panel.hostId]?.team ?? 0;
  const open = table.seats.flatMap((seat, index) => (seat.open ? [index] : []));
  const rows = table.seats
    .map((seat, index) => {
      if (seat.team !== hostTeam) return '';
      if (index === panel.hostId) {
        return `<li class="seat you"><span class="who">${escape(t('tournament.you', { name: seat.name }))}</span></li>`;
      }
      const person = people.find((p) => p.playerId === index);
      if (person === undefined) {
        return `<li class="seat bot"><span class="who">${escape(seat.name)}</span><em class="tag">${t('tournament.botTag')}</em></li>`;
      }
      const choices = open
        .map(
          (to) =>
            `<option value="${to}"${to === index ? ' selected' : ''}>${escape(t('tournament.inPlaceOf', { bot: table.seats[to]?.name ?? '' }))}</option>`,
        )
        .join('');
      const place =
        open.length > 1
          ? `<select class="sit-in" data-seat="${index}" aria-label="${escape(t('tournament.sitInAria', { name: person.name }))}">${choices}</select>`
          : `<em class="tag">${escape(t('tournament.inPlaceOf', { bot: seat.name }))}</em>`;
      return `<li class="seat person"><span class="who">${escape(person.name)}</span>${place}</li>`;
    })
    .join('');
  const invite = panel.invite
    ? `<div class="code-row invite-row"><span class="invite-label">${t('lobby.invite')}</span><code id="invite-link" class="invite-link">${escape(panel.invite)}</code><button id="copy-invite" class="quiet">${t('lobby.copy')}</button></div>`
    : '';
  return (
    `<section class="room-panel"><h2>${t('tournament.room')}</h2>` +
    `<div class="code-row"><code id="room-code" class="room-code">${escape(panel.code)}</code><button id="copy-code" class="quiet">${t('lobby.copy')}</button></div>` +
    `${invite}<p class="note">${escape(t('tournament.roomNote'))}</p><ul class="seats">${rows}</ul></section>`
  );
}

/** The tournament between matches: the last result, the standings, and the next match. */
export function tournamentMarkup(
  save: Save,
  progress: Progress,
  notice: string | null,
  room: RoomPanel | null = null,
): string {
  const steps = stepsOf(save);
  const next = progress.next;
  const step = steps[progress.done];
  const match = next?.matches[progress.hostMatch] ?? [];
  const inLeague = step?.kind === 'league';
  const standings = inLeague
    ? progress.done === 0
      ? `<p class="note">${escape(t('tournament.leagueAhead', { days: save.plan.matchdays.length, n: save.plan.advance }))}</p>`
      : leagueTable(save, progress)
    : knockoutView(save, progress);
  return `
    <div class="menu lobby tournament-view">
      <h1>${escape(save.teams[0]?.name ?? '')}</h1>
      <p class="note subtitle">${escape(settingsLine(save.settings))}</p>
      ${notice === null ? '' : `<p class="note warn">${escape(notice)}</p>`}
      ${lastResult(save)}
      <div class="lobby-body">
        <section class="next-match${isLastStep(save, progress.done) ? ' last-match' : ''}">
          <h2>${escape(t('tournament.nextMatch', { stage: stageLabel(save, progress.done) }))}</h2>
          ${isLastStep(save, progress.done) ? `<p class="last-line">${escape(t('tournament.lastMatch'))}</p>` : ''}
          <ul class="team-cards">${match.map((id) => teamCard(save, id)).join('')}</ul>
        </section>
        <section class="standings">
          <h2>${inLeague ? t('tournament.league') : t('tournament.knockout')}</h2>
          ${standings}
        </section>
      </div>
      ${room === null ? '' : roomPanelMarkup(room)}
      <button id="play">${t('tournament.play')}</button>
      <button id="bracket" class="quiet">${t('tournament.bracket')}</button>
      <button id="back" class="quiet">${t('watching.back')}</button>
    </div>`;
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
      <table class="road"><thead><tr><th>${t('tournament.stage')}</th><th>${t('tournament.against')}</th><th>${t('tournament.place')}</th><th>${t('tournament.score')}</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <button id="bracket" class="quiet">${t('tournament.bracket')}</button>
      <button id="back">${t('watching.back')}</button>
    </div>`;
}
