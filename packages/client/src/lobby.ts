import {
  MAX_LEVEL,
  MIN_LEVEL,
  teamsBalanced,
  validPlayerCounts,
  type MatchSettings,
  type PlayerShape,
  type SettingBounds,
} from '@bollwerk/config';
import type { Seat, TournamentTable } from '@bollwerk/protocol';

import { t } from './i18n.js';
import { teamLetter } from './scores.js';
import { shapeSvg } from './shapes.js';
import { escape } from './html.js';

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
  /** A link to this room from the internet, while the host's port is open there (PLAN 11.21). */
  invite?: string | null;
  /**
   * The tournament's match the room is set for (docs/TOURNAMENT.md T6), or none. Its table
   * is the tournament's: the seats' bots are named, the teams too, and nothing can be
   * changed here — the host sets it from their tournament.
   */
  tournament?: TournamentTable | null;
  /**
   * The tournament's own tab beside the match's (TOURNAMENT §1.7), or none: a single
   * match's lobby has no tabs. The host's page makes it from its save, a teammate's from
   * the save the host sends.
   */
  tournamentTab?: TournamentTab | null;
  /** A line above it all: a match left to be played again, a save the browser refused. */
  notice?: string | null;
}

/** The lobby's tabs: the match to be played, and the tournament it belongs to. */
export type LobbyTab = 'match' | 'tournament';

export interface TournamentTab {
  /** The tournament tab's content: where the tournament stands. */
  markup: string;
  /** The tab shown. */
  open: LobbyTab;
  /** The tournament's last match: its frame marked in gold. */
  lastMatch: boolean;
  /** A tag after each team's name in the match, by its place there: the host's, the archnemesis's. */
  teamTags: readonly string[];
}

/** The levels a seat's bot may play at, as the lobby offers them. */
const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i);

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
  const { maxRounds, teamSize, continues } = view.settings;
  const teamName = (size: number): string =>
    size === 1 ? t('lobby.freeForAll') : t('lobby.teamsOf', { n: size });
  if (view.tournament) {
    const statement = t('lobby.tournamentStatement', {
      stage: view.tournament.stage,
      n: maxRounds,
    });
    if (view.tournamentTab?.lastMatch !== true) {
      return `<p class="note settings">${escape(statement)}</p>`;
    }
    return `<div class="settings last-match"><p class="note">${escape(statement)}</p><p class="last-line">${escape(t('tournament.lastMatch'))}</p></div>`;
  }
  if (!isHost) {
    const statement = t('lobby.statement', {
      players: view.playerCount,
      teams: teamName(teamSize),
      rounds: maxRounds,
      lives: continues + 1,
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
      <label>${t('lobby.lives')}
        <select id="lives" aria-label="${t('lobby.lives')}">${rangeOptions(view.settingBounds.continues.min + 1, view.settingBounds.continues.max + 1, continues + 1)}</select>
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
  // At a tournament's table the host seats their teammates, in their team's open seats only.
  const table = view.tournament;
  if (table && table.seats[index]?.open !== true) return `<span class="who">${escape(name)}</span>`;
  const people = view.seats
    .filter((seat) => !table || seat.playerId !== view.hostId)
    .sort((a, b) => a.playerId - b.playerId);
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

/** `isHost` sets the table — never a tournament's; `seats` moves people between seats. */
function seatRow(
  view: LobbyView,
  index: number,
  isHost: boolean,
  seats: boolean,
  defaultLevel: number,
): string {
  const seat = view.seats.find((s) => s.playerId === index);
  const arrived = view.arrived?.includes(index) ? ' arrived' : '';

  if (seat) {
    const isHostSeat = seat.playerId === view.hostId;
    const tags = [
      seat.playerId === view.humanPlayer ? `<em class="tag you">${t('lobby.tagYou')}</em>` : '',
      isHostSeat ? `<em class="tag">${t('lobby.tagHost')}</em>` : '',
      seat.connected ? '' : `<em class="tag away">${t('lobby.tagAway')}</em>`,
      // Every guest says when they are ready; the host's Start is theirs.
      isHostSeat
        ? ''
        : seat.ready
          ? `<em class="tag ready">${t('lobby.tagReady')}</em>`
          : `<em class="tag unready">${t('lobby.tagNotReady')}</em>`,
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
    // A teammate at a tournament's table plays in place of one of the team's bots.
    const stands = view.tournament?.seats[index];
    if (stands?.open === true && stands.level !== null) {
      blurb = `<small class="blurb">${escape(t('tournament.inPlaceOf', { bot: stands.name }))}</small>`;
    }
    return `<li class="seat${mine}${arrived}">${seatBadge(view, index)}${occupant(view, index, seats, seat.name)}${tags}${control}${blurb}</li>`;
  }

  const control = levelControl(
    view.bots[index] ?? defaultLevel,
    isHost,
    `class="bot-select" data-seat="${index}"`,
    t('lobby.botLevelAria', { n: index + 1 }),
  );
  const bot = view.tournament?.seats[index]?.name ?? t('lobby.bot', { n: index + 1 });
  return `<li class="seat bot${arrived}">${seatBadge(view, index)}${occupant(view, index, seats, bot)}${control}</li>`;
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
        `<section class="team-column"><h2>${escape(view.tournament?.teamNames[team] ?? t('team.name', { letter: teamLetter(team) }))}${view.tournamentTab?.teamTags[team] ?? ''}</h2><ul class="seats">${members.join('')}</ul></section>`,
    )
    .join('');
  return `<div class="team-columns">${columns}</div>`;
}

/** The guests who have not yet said they are ready: the host may not start until none. */
export function notReady(view: LobbyView): number {
  return view.seats.filter((seat) => seat.playerId !== view.hostId && !seat.isBot && !seat.ready)
    .length;
}

/** Whether the table can start as it stands, and if not, why not. */
export function startBlocked(view: LobbyView): string | null {
  if (!teamsBalanced([...view.teams], view.settings.teamSize)) {
    return t('lobby.teamsUnequal', { n: view.settings.teamSize });
  }
  const waiting = notReady(view);
  if (waiting > 0) return t('lobby.waitingReady', { n: waiting });
  return null;
}

/**
 * A guest's button where the host's Start is: Ready, and once ready a way back, with the
 * wait for the host beside it.
 */
function readyControl(view: LobbyView): string {
  const ready = view.seats.find((seat) => seat.playerId === view.humanPlayer)?.ready === true;
  if (!ready) return `<button id="ready" data-ready="true">${t('lobby.ready')}</button>`;
  return (
    `<button id="ready" class="quiet" data-ready="false">${t('lobby.notReady')}</button>` +
    `<p class="note">${t('lobby.waiting')}</p>`
  );
}

/** The two tabs' buttons, the open one marked. */
function tabStrip(open: LobbyTab): string {
  const tab = (name: LobbyTab, label: string): string =>
    `<button class="tab${open === name ? ' on' : ''}" role="tab" data-tab="${name}" aria-selected="${open === name}">${label}</button>`;
  return `<div class="lobby-tabs" role="tablist">${tab('match', t('lobby.tabMatch'))}${tab('tournament', t('lobby.tabTournament'))}</div>`;
}

export function lobbyMarkup(view: LobbyView): string {
  const hosts = view.humanPlayer === view.hostId;
  // A tournament's table is the host's tournament's: here they only seat their teammates.
  const isHost = hosts && !view.tournament;
  const rows = Array.from({ length: view.playerCount }, (_, i) =>
    seatRow(view, i, isHost, hosts, 5),
  );

  const blocked = startBlocked(view);
  const start = !hosts
    ? readyControl(view)
    : `<button id="begin"${blocked === null ? '' : ' disabled'}>${t(view.tournament ? 'tournament.play' : 'lobby.start')}</button>` +
      (blocked === null ? '' : `<p class="note warn">${escape(blocked)}</p>`);
  const roomNote =
    view.tournament && hosts && view.code !== null
      ? `<p class="note">${escape(t('tournament.roomNote'))}</p>`
      : '';

  const code =
    view.code === null
      ? ''
      : `<div class="code-row">
        <code id="room-code" class="room-code">${escape(view.code)}</code>
        <button id="copy-code" class="quiet">${t('lobby.copy')}</button>
      </div>` +
        (view.invite
          ? `<div class="code-row invite-row">
        <span class="invite-label">${t('lobby.invite')}</span>
        <code id="invite-link" class="invite-link">${escape(view.invite)}</code>
        <button id="copy-invite" class="quiet">${t('lobby.copy')}</button>
      </div>`
          : '') +
        roomNote;

  const body = `
      <div class="lobby-body">
        <div class="lobby-side">
          ${mapControls(view, isHost)}
          ${tableControls(view, isHost)}
        </div>
        <div class="lobby-seats">${seatLists(view, rows)}</div>
      </div>`;
  const side = view.tournamentTab ?? null;
  const panels =
    side === null
      ? body
      : `${tabStrip(side.open)}
      <div class="tab-panels">
        <div class="tab-panel" data-panel="match"${side.open === 'match' ? '' : ' hidden'}>${body}</div>
        <div class="tab-panel" data-panel="tournament"${side.open === 'tournament' ? '' : ' hidden'}>${side.markup}</div>
      </div>`;
  // The host leaves a tournament for the menu, where it waits to be resumed.
  const leave = view.tournament && hosts ? t('watching.back') : t('lobby.leave');

  return `
    <div class="menu lobby${view.tournament ? ' tournament-lobby' : ''}">
      <h1>${view.tournament ? escape(t('lobby.tournament', { team: view.tournament.teamNames[view.tournament.seats.find((s) => s.level === null)?.team ?? 0] ?? '' })) : view.code === null ? t('lobby.table') : t('lobby.room')}</h1>
      ${view.notice ? `<p class="note warn">${escape(view.notice)}</p>` : ''}
      ${code}
      ${panels}
      ${start}
      <button id="leave" class="quiet">${leave}</button>
    </div>
  `;
}
