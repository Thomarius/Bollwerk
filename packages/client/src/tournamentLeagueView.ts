import { HOST_TEAM, type Progress, type Save } from '@bollwerk/tournament';

import { escape } from './html.js';
import { formatNumber, ordinal, t } from './i18n.js';
import { stageName } from './tournamentText.js';
import { leagueTableMarkup } from './tournamentView.js';

/**
 * The league in a window of its own over the tournament screen, opened where the knockout's
 * bracket is once the knockout begins (the test session of 2026-10-12: the bracket showed
 * nothing of the league being played). The whole table, every team rather than the tab's
 * excerpt, and every matchday, played or to come — all drawn at creation, so the fixtures
 * are known from the start. Mouse only: Close is a button.
 */

function teamName(save: Save, id: number): string {
  const name = escape(save.teams[id]?.name ?? '?');
  if (id === HOST_TEAM)
    return `${name} <em class="you">${escape(t('tournament.yourTeamTag'))}</em>`;
  return save.teams[id]?.archnemesis === true
    ? `${name} <em class="arch">${escape(t('tournament.archTag'))}</em>`
    : name;
}

/** One matchday: its matches, the host's first, placed where played and listed where to come. */
function matchday(save: Save, progress: Progress, day: number): string {
  const record = save.steps[day];
  const fixtures = save.plan.matchdays[day] ?? [];
  const matches = fixtures.map((teams, index) => {
    const result = record?.matches[index];
    const host = teams.includes(HOST_TEAM);
    const list =
      result === undefined
        ? teams.map((id) => `<li>${teamName(save, id)}</li>`).join('')
        : result.order
            .map((id, place) => {
              const score = result.scores?.[place];
              return (
                `<li><span class="place">${escape(ordinal(place + 1))}</span> ${teamName(save, id)}` +
                (score === undefined
                  ? ''
                  : ` <span class="score">${escape(formatNumber(score))}</span>`) +
                `</li>`
              );
            })
            .join('');
    const tag = result === undefined ? 'ul' : 'ol';
    return { host, markup: `<${tag} class="match${host ? ' host' : ''}">${list}</${tag}>` };
  });
  // The host's match leads its day; the rest keep the draw's order.
  matches.sort((a, b) => Number(b.host) - Number(a.host));
  const state = record !== undefined ? 'played' : day === progress.done ? 'next' : 'later';
  const note =
    record === undefined ? ` <span class="note">${escape(t('league.toPlay'))}</span>` : '';
  return (
    `<section class="matchday ${state}"><h3>${escape(stageName(save, day))}${note}</h3>` +
    `<div class="matches">${matches.map((m) => m.markup).join('')}</div></section>`
  );
}

export function leagueMarkup(save: Save, progress: Progress): string {
  const days = save.plan.matchdays.map((_, day) => matchday(save, progress, day)).join('');
  const table =
    progress.done === 0
      ? `<p class="note">${escape(t('tournament.leagueAhead', { days: save.plan.matchdays.length, n: save.plan.advance }))}</p>`
      : leagueTableMarkup(
          save,
          progress.table().map((row, i) => ({ row, rank: i + 1 })),
        );
  return (
    `<div class="panel league-panel"><h2>${escape(t('league.title'))}</h2>` +
    `<p class="note">${escape(t('tournament.through', { n: save.plan.advance, of: save.teams.length }))} ${escape(t('league.seeding'))}</p>` +
    `<div class="league-columns">` +
    `<section class="league-standings"><h3>${escape(t('league.table'))}</h3>${table}</section>` +
    `<section class="league-days"><h3>${escape(t('league.matchdays'))}</h3>${days}</section>` +
    `</div><button class="close">${escape(t('howTo.close'))}</button></div>`
  );
}

/** Opens the league over whatever is on screen; `click` sounds as the menu's buttons do. */
export function openLeague(save: Save, progress: Progress, click: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'bracket-overlay league-overlay';
  overlay.innerHTML = leagueMarkup(save, progress);
  document.body.append(overlay);
  overlay.querySelector('.close')?.addEventListener('click', () => {
    click();
    overlay.remove();
  });
}
