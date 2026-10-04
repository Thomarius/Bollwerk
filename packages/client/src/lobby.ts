import {
  MAX_LEVEL,
  MIN_LEVEL,
  teamsBalanced,
  validPlayerCounts,
  type MatchSettings,
  type PlayerShape,
  type SettingBounds,
} from '@bollwerk/config';
import type { Seat } from '@bollwerk/protocol';

import { t } from './i18n.js';
import { teamLetter } from './scores.js';
import { shapeSvg } from './shapes.js';

/**
 * The lobby, as markup — one lobby for online and offline.
 *
 * Built as a function of the table rather than assembled in place so it can be checked
 * without a server and a browser: whether a guest is shown the host's controls is the
 * kind of thing that is obvious in the code and still wrong on the screen. The same view
 * is fed by a room when a server is reachable and by a local model when not, so the two
 * cannot grow apart.
 */

export interface LobbyView {
  /** The room's code, or null when no server could be reached and the table is local. */
  code: string | null;
  /** Seats at the table, including the ones nobody has taken. */
  playerCount: number;
  /** The host's seat. */
  hostId: number;
  /** The seat this browser holds, or -1 before the server has said. */
  humanPlayer: number;
  /** Seats people hold, by seat. The rest are played by bots. */
  seats: readonly Seat[];
  /** Skill level of the bot in each seat, 1 to 10. */
  bots: readonly number[];
  settings: MatchSettings;
  settingBounds: SettingBounds;
  /** Each seat's team, by seat. */
  teams: readonly number[];
  /** Player counts the rules allow at all, before the team size narrows them. */
  playerLimits: { min: number; max: number };
  /** The map's seed, fixed while the table is set so the map can be shown. */
  seed: number;
  /** The level of the bot the host has put in their own seat to watch instead, or null. */
  hostBot: number | null;
  /** The colour each seat will play in, as CSS, once the deal is known. */
  seatColours?: readonly string[];
  /** The shape each seat will carry, dealt as the colours are. */
  seatShapes?: readonly PlayerShape[];
  /** Seats somebody has just taken, to be marked as they arrive. */
  arrived?: readonly number[];
}

/** The levels a seat's bot may play at, as the lobby offers them. */
const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i);

export function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Every whole number in a range, as options with one selected. */
export function rangeOptions(min: number, max: number, selected: number): string {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
    .map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`)
    .join('');
}

function options(
  values: readonly number[],
  selected: number,
  name: (n: number) => string = String,
): string {
  return values
    .map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${name(n)}</option>`)
    .join('');
}

/** Team sizes that make at least one table seating everyone who has joined. */
export function teamSizesFor(view: LobbyView): number[] {
  const { min, max } = view.settingBounds.teamSize;
  const out: number[] = [];
  for (let size = min; size <= max; size++) {
    const counts = validPlayerCounts(size, view.playerLimits);
    if (counts.some((n) => n >= view.seats.length)) out.push(size);
  }
  return out;
}

/** The table's settings: controls for the host, a statement for everyone else. */
function tableControls(view: LobbyView, isHost: boolean): string {
  const { maxRounds, teamSize } = view.settings;
  const teamName = (size: number): string =>
    size === 1 ? t('lobby.freeForAll') : t('lobby.teamsOf', { n: size });
  if (!isHost) {
    const statement = t('lobby.statement', {
      players: view.playerCount,
      teams: teamName(teamSize),
      rounds: maxRounds,
    });
    return `<p class="note settings">${statement}</p>`;
  }
  const counts = validPlayerCounts(teamSize, view.playerLimits).filter(
    (n) => n >= view.seats.length,
  );
  const { min, max } = view.settingBounds.maxRounds;
  return `
    <div class="settings">
      <label>${t('lobby.teams')}
        <select id="team-size" aria-label="${t('lobby.teamSize')}">${options(teamSizesFor(view), teamSize, teamName)}</select>
      </label>
      <label>${t('lobby.players')}
        <select id="player-count" aria-label="${t('lobby.players')}">${options(counts, view.playerCount)}</select>
      </label>
      <label>${t('lobby.rounds')}
        <select id="max-rounds" aria-label="${t('lobby.rounds')}">${rangeOptions(min, max, maxRounds)}</select>
      </label>
    </div>`;
}

/**
 * Who sits in a seat: for the host, a choice of every person at the table or the seat's
 * bot; for everyone else, just the name. Choosing somebody moves them here, swapping with
 * whoever sat here — which, since teams belong to seats, is how people are put on the same
 * team or on opposing ones. A choice of one is no choice, so it is shown as a name.
 */
function occupant(view: LobbyView, index: number, isHost: boolean, name: string): string {
  const people = [...view.seats].sort((a, b) => a.playerId - b.playerId);
  const here = people.find((seat) => seat.playerId === index);
  const choices = here === undefined ? people.length : people.length - 1;
  if (!isHost || choices === 0) return `<span class="who">${escape(name)}</span>`;
  const bot = here === undefined ? `<option value="" selected>${escape(name)}</option>` : '';
  const names = people
    .map(
      (seat) =>
        `<option value="${seat.playerId}"${seat.playerId === index ? ' selected' : ''}>${escape(seat.name)}</option>`,
    )
    .join('');
  return `<select class="occupant who" data-seat="${index}" aria-label="${t('lobby.seatAria', { n: index + 1 })}">${bot}${names}</select>`;
}

/**
 * The seat's number, in the colour it will play in, and beside it the shape it will carry,
 * as its island is labelled on the map.
 */
function seatBadge(view: LobbyView, index: number): string {
  const colour = view.seatColours?.[index];
  const style = colour === undefined ? '' : ` style="background:${colour}"`;
  const shape = view.seatShapes?.[index];
  const mark = shape === undefined ? '' : shapeSvg(shape, colour ?? 'currentColor');
  return `<b class="num"${style}>${index + 1}</b>${mark}`;
}

/**
 * A bot's level: a choice of Level 1 to 10 for the host — as arcade games number them,
 * where the military ranks before were hard to read — and a tag for everyone else.
 */
/**
 * A bot's level as pips beside its choice (PLAN 11.18 Y4): ten, filled up to the level, so a
 * glance down the seats tells how hard a table is without reading a number in each.
 */
export function levelPips(level: number): string {
  const pips = LEVELS.map((n) => `<i${n <= level ? ' class="on"' : ''}></i>`).join('');
  return `<span class="pips" title="${t('lobby.level', { n: level })}" aria-hidden="true">${pips}</span>`;
}

function levelControl(
  level: number,
  isHost: boolean,
  attributes: string,
  label_: string,
  withPerson = false,
): string {
  if (!isHost) {
    return `<em class="tag level">${t('lobby.level', { n: level })}</em>${levelPips(level)}`;
  }
  const person = withPerson ? `<option value="">${t('lobby.youPlay')}</option>` : '';
  return `${levelPips(level)}<select ${attributes} aria-label="${label_}">${person}${LEVELS.map(
    (n) =>
      `<option value="${n}"${n === level ? ' selected' : ''}>${t('lobby.level', { n })}</option>`,
  ).join('')}</select>`;
}

function seatRow(view: LobbyView, index: number, isHost: boolean, defaultLevel: number): string {
  const seat = view.seats.find((s) => s.playerId === index);
  const arrived = view.arrived?.includes(index) ? ' arrived' : '';

  if (seat) {
    const isHostSeat = seat.playerId === view.hostId;
    const tags = [
      seat.playerId === view.humanPlayer ? `<em class="tag you">${t('lobby.tagYou')}</em>` : '',
      isHostSeat ? `<em class="tag">${t('lobby.tagHost')}</em>` : '',
      seat.connected ? '' : `<em class="tag away">${t('lobby.tagAway')}</em>`,
    ].join('');
    const mine = seat.playerId === view.humanPlayer ? ' you' : '';
    // The host may hand their own seat to a bot and watch: with nobody else at the
    // table that is a match of bots alone, which is how watching is offered now.
    let control = '';
    let blurb = '';
    if (isHostSeat && view.hostBot !== null) {
      control = levelControl(view.hostBot, isHost, 'id="host-bot"', t('lobby.whoPlays'), true);
      blurb = `<small class="blurb">${t('lobby.watches', { name: escape(seat.name) })}</small>`;
    } else if (isHostSeat && isHost) {
      control = `<select id="host-bot" aria-label="${t('lobby.whoPlays')}"><option value="" selected>${t('lobby.youPlay')}</option>${LEVELS.map(
        (n) => `<option value="${n}">${t('lobby.level', { n })}</option>`,
      ).join('')}</select>`;
    }
    return `<li class="seat${mine}${arrived}">${seatBadge(view, index)}${occupant(view, index, isHost, seat.name)}${tags}${control}${blurb}</li>`;
  }

  const control = levelControl(
    view.bots[index] ?? defaultLevel,
    isHost,
    `class="bot-select" data-seat="${index}"`,
    t('lobby.botLevelAria', { n: index + 1 }),
  );
  const bot = t('lobby.bot', { n: index + 1 });
  return `<li class="seat bot${arrived}">${seatBadge(view, index)}${occupant(view, index, isHost, bot)}${control}</li>`;
}

/** The map and the seed it comes from: the host may draw another or type one in. */
function mapControls(view: LobbyView, isHost: boolean): string {
  const canvas = `<canvas id="map-preview" class="map-preview" aria-label="${t('lobby.mapAria')}"></canvas>`;
  if (!isHost) {
    return `${canvas}<p class="note map-note">${t('lobby.mapSeed', { seed: String(view.seed) })}</p>`;
  }
  return `${canvas}
    <div class="map-row">
      <label>${t('lobby.map')} <input id="seed" type="number" min="0" max="4294967295" step="1" value="${view.seed}" aria-label="${t('lobby.seedAria')}" /></label>
      <button id="reroll" class="quiet">${t('lobby.newMap')}</button>
    </div>`;
}

/** Seats in a list, or in one column per team when there are teams. */
function seatLists(view: LobbyView, rows: readonly string[]): string {
  if (view.settings.teamSize === 1) return `<ul class="seats">${rows.join('')}</ul>`;
  const teams = new Map<number, string[]>();
  rows.forEach((row, i) => {
    const team = view.teams[i] ?? 0;
    teams.set(team, [...(teams.get(team) ?? []), row]);
  });
  const columns = [...teams.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([team, members]) =>
        `<section class="team-column"><h2>${t('team.name', { letter: teamLetter(team) })}</h2><ul class="seats">${members.join('')}</ul></section>`,
    )
    .join('');
  return `<div class="team-columns">${columns}</div>`;
}

/** Whether the table can start as it stands, and if not, why not. */
export function startBlocked(view: LobbyView): string | null {
  if (!teamsBalanced([...view.teams], view.settings.teamSize)) {
    return t('lobby.teamsUnequal', { n: view.settings.teamSize });
  }
  return null;
}

export function lobbyMarkup(view: LobbyView): string {
  const isHost = view.humanPlayer === view.hostId;
  const rows = Array.from({ length: view.playerCount }, (_, i) => seatRow(view, i, isHost, 5));

  const blocked = startBlocked(view);
  const start = !isHost
    ? `<p class="note">${t('lobby.waiting')}</p>`
    : `<button id="begin"${blocked === null ? '' : ' disabled'}>${t('lobby.start')}</button>` +
      (blocked === null ? '' : `<p class="note warn">${escape(blocked)}</p>`);

  const code =
    view.code === null
      ? ''
      : `<div class="code-row">
        <code id="room-code" class="room-code">${escape(view.code)}</code>
        <button id="copy-code" class="quiet">${t('lobby.copy')}</button>
      </div>`;

  return `
    <div class="menu lobby">
      <h1>${view.code === null ? t('lobby.table') : t('lobby.room')}</h1>
      ${code}
      <div class="lobby-body">
        <div class="lobby-side">
          ${mapControls(view, isHost)}
          ${tableControls(view, isHost)}
        </div>
        <div class="lobby-seats">${seatLists(view, rows)}</div>
      </div>
      ${start}
      <button id="leave" class="quiet">${t('lobby.leave')}</button>
    </div>
  `;
}
