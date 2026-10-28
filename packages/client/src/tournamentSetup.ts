import {
  MAX_LEVEL,
  MIN_LEVEL,
  TOURNAMENT_LENGTHS,
  defaultConfigBundle,
  type BotTower,
  type TournamentLength,
} from '@bollwerk/config';
import {
  settingsProblems,
  teamLimits,
  unbeatenRoad,
  type SettingLimits,
  type TournamentSettings,
} from '@bollwerk/tournament';

import { escape } from './html.js';
import { withIcon } from './icons.js';
import { t } from './i18n.js';
import { levelPips, rangeOptions, specialsSwitch, towerFace } from './lobby.js';
import { dieSvg } from './towerIcons.js';
import { preferredSpecials } from './towers.js';

/**
 * The new tournament's settings (TOURNAMENT §1.2), as a form: a model the controls change
 * through `reshapeForm`, which keeps the settings that constrain each other in step, and
 * markup drawn from it — pure, so what the screen offers is tested without one.
 */

export interface TournamentForm {
  teamSize: number;
  teamName: string;
  /**
   * The host's teammates, one per seat beyond the host's: each bot's tower, fixed for the
   * tournament where it plays them, drawn as it is made unless the host chooses one.
   */
  teamBots: { name: string; level: number; tower: BotTower }[];
  levels: { min: number; max: number };
  archnemesis: boolean;
  archName: string;
  length: TournamentLength;
  league: boolean;
  knockout: 'single' | 'double';
  matchTeams: { min: number; max: number };
  maxRounds: number;
  /** Lives less one, as the match settings count them. */
  continues: number;
  /** Whether every match plays special towers. */
  specials: boolean;
}

const bundle = defaultConfigBundle;

export const TOURNAMENT_LIMITS: SettingLimits = {
  players: bundle.ruleset.players,
  teamSize: bundle.server.lobbySettings.teamSize,
  maxRounds: bundle.tournament.maxRounds,
  continues: bundle.server.lobbySettings.continues,
};

/** A level for a new teammate: the level a new seat's bot gets. */
const MATE_LEVEL = bundle.server.botLevel;

/** Names to offer, drawn from the tournament's own pools by the caller. */
export interface NameSource {
  team(): string;
  player(): string;
}

/** A random name source from the tournament's pools: the menu's, not the seed's. */
export function randomNames(random: () => number = Math.random): NameSource {
  const pick = (pool: readonly string[]): string =>
    pool[Math.floor(random() * pool.length)] as string;
  return {
    team: () => pick(bundle.tournament.names.teams),
    player: () => pick(bundle.tournament.names.players),
  };
}

export function defaultForm(names: NameSource): TournamentForm {
  return {
    teamSize: 1,
    teamName: names.team(),
    teamBots: [],
    levels: { min: 4, max: 6 },
    // On unless the host turns him away (the user's, 2026-10-28).
    archnemesis: true,
    archName: t('tournament.archDefault'),
    length: 'medium',
    league: true,
    knockout: 'single',
    // Two to four teams a match: larger free-for-alls are offered, not the first thing met.
    matchTeams: { min: 2, max: 4 },
    // The rules' rounds and lives, no longer offered here (the user's, 2026-10-28).
    maxRounds: bundle.ruleset.scoring.maxRounds ?? TOURNAMENT_LIMITS.maxRounds.max,
    continues: bundle.ruleset.elimination.continues,
    // As the host last set it, here or in a lobby.
    specials: preferredSpecials(),
  };
}

/** The teams a match may hold at a team size; two of each at the largest sizes. */
export function matchTeamLimits(teamSize: number): { min: number; max: number } {
  return teamLimits(teamSize, TOURNAMENT_LIMITS.players) ?? { min: 2, max: 2 };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * The form with a change made, and everything it constrains brought back in line: a
 * team size resizes the team and the teams a match; a range's ends never cross, the end
 * not changed giving way; an archnemesis keeps the range's top below the last level.
 */
export function reshapeForm(
  form: TournamentForm,
  change: Partial<TournamentForm>,
  names: NameSource,
): TournamentForm {
  const next: TournamentForm = { ...form, ...change };
  const mates = next.teamSize - 1;
  next.teamBots = next.teamBots.slice(0, mates);
  while (next.teamBots.length < mates) {
    const taken = new Set(next.teamBots.map((b) => b.name));
    let name = names.player();
    for (let tries = 0; taken.has(name) && tries < 20; tries++) name = names.player();
    next.teamBots.push({ name, level: MATE_LEVEL, tower: 'drawn' });
  }

  const limits = matchTeamLimits(next.teamSize);
  let { min, max } = next.matchTeams;
  min = clamp(min, limits.min, limits.max);
  max = clamp(max, limits.min, limits.max);
  if (min > max) {
    if (change.matchTeams?.max !== undefined && change.matchTeams.max !== form.matchTeams.max)
      min = max;
    else max = min;
  }
  next.matchTeams = { min, max };

  const top = next.archnemesis ? MAX_LEVEL - 1 : MAX_LEVEL;
  let low = clamp(next.levels.min, MIN_LEVEL, top);
  let high = clamp(next.levels.max, MIN_LEVEL, top);
  if (low > high) {
    if (change.levels?.max !== undefined && change.levels.max !== form.levels.max) low = high;
    else high = low;
  }
  next.levels = { min: low, max: high };
  return next;
}

/** The settings a form makes, with the host's name and a seed. */
export function settingsOf(
  form: TournamentForm,
  hostName: string,
  seed: number,
): TournamentSettings {
  return {
    seed,
    teamSize: form.teamSize,
    hostName,
    teamName: form.teamName.trim() || hostName,
    teamBots: form.teamBots.map((b) => ({
      name: b.name.trim() || '?',
      level: b.level,
      tower: b.tower,
    })),
    levels: { ...form.levels },
    archnemesis: form.archnemesis ? form.archName.trim() || t('tournament.archDefault') : null,
    length: form.length,
    league: form.league,
    knockout: form.knockout,
    matchTeams: { ...form.matchTeams },
    maxRounds: form.maxRounds,
    continues: form.continues,
    specials: form.specials,
  };
}

/** Whether the form makes a tournament; the controls never offer one that does not. */
export function formProblems(form: TournamentForm, hostName: string): string[] {
  return settingsProblems(settingsOf(form, hostName, 0), TOURNAMENT_LIMITS);
}

function choice<T extends string | number>(
  id: string,
  label: string,
  values: readonly T[],
  selected: T,
  name: (value: T) => string,
  ui: 'seg' | 'step' | 'switch',
  short?: (value: T) => string,
): string {
  const items = values
    .map(
      (v) =>
        `<option value="${v}"${short === undefined ? '' : ` data-short="${escape(short(v))}"`}${v === selected ? ' selected' : ''}>${escape(name(v))}</option>`,
    )
    .join('');
  return `<select id="${id}" data-ui="${ui}" aria-label="${escape(label)}">${items}</select>`;
}

function numbers(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** A range as two choices, "from – to"; `off`, kept in place but disabled. */
function rangeRow(
  id: string,
  label: string,
  range: { min: number; max: number },
  values: { min: number; max: number },
  off = false,
): string {
  const all = numbers(values.min, values.max);
  const end = (which: 'min' | 'max', word: string): string => {
    const select = choice(`${id}-${which}`, `${label}: ${word}`, all, range[which], String, 'step');
    return off ? select.replace('<select ', '<select disabled ') : select;
  };
  return `<label${off ? ' class="off"' : ''}>${label}<span class="range">${end('min', t('tournament.from'))}<span class="dash">–</span>${end('max', t('tournament.to'))}</span></label>`;
}

/**
 * A teammate's tower where the tournament plays them: a small icon before their name, as a
 * seat's in the lobby, opening the tower menu — Random, a die, until the host chooses.
 */
function mateTower(
  form: TournamentForm,
  bot: TournamentForm['teamBots'][number],
  i: number,
): string {
  if (!form.specials) return '';
  const face =
    bot.tower === 'drawn'
      ? `${dieSvg('currentColor')}<span class="pips"></span>`
      : towerFace(bot.tower);
  const label = escape(t('tournament.mateTower', { name: bot.name }));
  return (
    `<button type="button" class="tower-mini tower-button mate-tower" data-mate="${i}" ` +
    `data-tip="${label}" aria-label="${label}">${face}</button>`
  );
}

/** The team's seats: the host first, then each teammate with a name and a level. */
function teamRows(form: TournamentForm, hostName: string): string {
  const host = `<li class="seat you"><span class="who">${escape(t('tournament.you', { name: hostName }))}</span></li>`;
  const mates = form.teamBots
    .map(
      (bot, i) =>
        `<li class="seat bot">${mateTower(form, bot, i)}<input class="mate-name who" data-mate="${i}" type="text" maxlength="16" value="${escape(bot.name)}" aria-label="${escape(t('tournament.mateAria', { n: i + 2 }))}" />` +
        `${levelPips(bot.level)}<select class="mate-level" data-mate="${i}" data-ui="step" aria-label="${escape(t('tournament.mateLevelAria', { n: i + 2 }))}">${rangeOptions(MIN_LEVEL, MAX_LEVEL, bot.level)}</select></li>`,
    )
    .join('');
  // Above the teammates, what they are: bots, set here, whose seats friends may take.
  const heading =
    form.teamBots.length === 0
      ? ''
      : `<h3>${t('tournament.members')}</h3><p class="note">${escape(t('tournament.membersNote'))}</p>`;
  return `${heading}<ul class="seats">${host}${mates}</ul>`;
}

export function setupMarkup(form: TournamentForm, hostName: string): string {
  const { teamSize: sizes } = TOURNAMENT_LIMITS;
  const teamName =
    form.teamSize > 1
      ? `<label>${t('tournament.teamName')}<input id="team-name" type="text" maxlength="16" value="${escape(form.teamName)}" /></label>`
      : '';
  const teamLimitsNow = matchTeamLimits(form.teamSize);
  // Always there, disabled at 2 – 2 where the team size allows only two teams a match (teams
  // of 3 and 4), so the column keeps its layout (the user's, 2026-10-28).
  const matchTeams = rangeRow(
    'match-teams',
    t('tournament.matchTeams'),
    form.matchTeams,
    teamLimitsNow,
    teamLimitsNow.max <= teamLimitsNow.min,
  );
  const levelTop = form.archnemesis ? MAX_LEVEL - 1 : MAX_LEVEL;
  // Always there, only disabled without him, so the panel keeps its size (the user's, 2026-10-28).
  const archName = `<label${form.archnemesis ? '' : ' class="off"'}>${t('tournament.archName')}<input id="arch-name" type="text" maxlength="16" value="${escape(form.archName)}"${form.archnemesis ? '' : ' disabled'} /></label>`;
  const road = unbeatenRoad(form, bundle.tournament);
  const finalNote =
    form.knockout === 'double' && form.matchTeams.min > 2
      ? `<p class="note">${escape(t('tournament.finalNote'))}</p>`
      : '';
  return `
    <div class="menu lobby tournament-setup">
      <h1>${t('tournament.new')}</h1>
      <div class="lobby-body">
        <section class="setup-team">
          <h2>${t('tournament.yourTeam')}</h2>
          <div class="settings">
            <label>${t('tournament.teamSize')}${choice(
              'team-size',
              t('tournament.teamSize'),
              numbers(sizes.min, sizes.max),
              form.teamSize,
              (n) => (n === 1 ? t('tournament.alone') : t('lobby.teamsOf', { n })),
              'seg',
              (n) => (n === 1 ? t('tournament.alone') : String(n)),
            )}</label>
            ${teamName}
          </div>
          ${teamRows(form, hostName)}
        </section>
        <section class="setup-shape">
          <h2>${t('tournament.shape')}</h2>
          <div class="settings">
            <label>${t('tournament.length')}${choice('length', t('tournament.length'), TOURNAMENT_LENGTHS, form.length, (l) => t(`tournament.length.${l}`), 'seg')}</label>
            <p class="note road">${escape(t('tournament.road', { n: road }))}</p>
            <label>${t('tournament.league')}${choice('league', t('tournament.league'), ['yes', 'no'] as const, form.league ? 'yes' : 'no', (v) => (v === 'yes' ? t('tournament.withLeague') : t('tournament.noLeague')), 'seg')}</label>
            <label>${t('tournament.knockout')}${choice('knockout', t('tournament.knockout'), ['single', 'double'] as const, form.knockout, (v) => (v === 'single' ? t('tournament.single') : t('tournament.double')), 'seg')}</label>
            ${finalNote}
            ${matchTeams}
            ${rangeRow('levels', t('tournament.opponents'), form.levels, { min: MIN_LEVEL, max: levelTop })}
            <label>${t('tournament.archnemesis')}${choice('archnemesis', t('tournament.archnemesis'), ['no', 'yes'] as const, form.archnemesis ? 'yes' : 'no', (v) => (v === 'yes' ? t('tournament.archOn') : t('tournament.archOff')), 'switch')}</label>
            ${archName}
            ${specialsSwitch(form.specials)}
          </div>
        </section>
      </div>
      <button id="create" class="primary">${withIcon('trophy', t('tournament.start'))}</button>
      <button id="back" class="quiet">${withIcon('back', t('tournament.back'))}</button>
    </div>`;
}
