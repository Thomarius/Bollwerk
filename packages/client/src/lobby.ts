import {
  MAX_LEVEL,
  MIN_LEVEL,
  defaultRuleset,
  teamsBalanced,
  validPlayerCounts,
  type MatchSettings,
  type PlayerShape,
  type SettingBounds,
  type BotTower,
  type TowerVariant,
  variantCost,
  variantKind,
} from '@bollwerk/config';
import { botTowerOf, drawnSpecial } from '@bollwerk/ai';
import type { Seat, TournamentTable } from '@bollwerk/protocol';

import { t } from './i18n.js';
import { withIcon } from './icons.js';
import { PREVIEW_ASPECT } from './preview.js';
import { teamLetter } from './scores.js';
import { shapeSvg } from './shapes.js';
import { escape } from './html.js';
import { cannonSvg, dieSvg, towerSvg } from './towerIcons.js';
import { towerName, towerWhat } from './towers.js';

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
  /** The tower the bot in each seat brings, as the host set it; omitted, every one its draw. */
  botTowers?: readonly BotTower[];
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
   * The tournament's match the room is set for (ARCHIVE 12zj), or none. Its table
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
  short?: (n: number) => string,
): string {
  return values
    .map(
      (n) =>
        `<option value="${n}"${short === undefined ? '' : ` data-short="${escape(short(n))}"`}${n === selected ? ' selected' : ''}>${name(n)}</option>`,
    )
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

/**
 * The table's settings: controls for the host, a statement for everyone else. Each control's
 * meaning in a hover text, as the level pips have theirs (PLAN §11 item 4, UP3).
 */
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
    const towers = view.settings.specials ? ` ${t('lobby.specialsStatement')}` : '';
    return `<p class="note settings">${statement}${towers}</p>`;
  }
  const counts = validPlayerCounts(teamSize, view.playerLimits).filter(
    (n) => n >= view.seats.length,
  );
  // No rounds or lives: the defaults, 10 and 3, were never changed in play, so they stay in
  // the config and off the screen (the user's, 2026-10-28).
  return `
    <div class="settings">
      <label data-tip="${escape(t('lobby.teamsTitle'))}">${t('lobby.teams')}
        <select id="team-size" data-ui="seg" aria-label="${t('lobby.teamSize')}">${options(teamSizesFor(view), teamSize, teamName, (n) => (n === 1 ? t('tournament.alone') : String(n)))}</select>
      </label>
      <label>${t('lobby.players')}
        <select id="player-count" data-ui="seg" aria-label="${t('lobby.players')}">${options(counts, view.playerCount)}</select>
      </label>
      ${specialsSwitch(view.settings.specials)}
    </div>`;
}

/** The host's switch for special towers, under the table's other settings. */
export function specialsSwitch(on: boolean): string {
  const option = (value: boolean, label: string): string =>
    `<option value="${value ? 'on' : 'off'}"${value === on ? ' selected' : ''}>${label}</option>`;
  return `<label data-tip="${escape(t('lobby.specialsTitle'))}">${t('lobby.specials')}
        <select id="specials" data-ui="switch" aria-label="${t('lobby.specials')}">${option(false, t('lobby.specialsOff'))}${option(true, t('lobby.specialsOn'))}</select>
      </label>`;
}

/**
 * A seat's special tower, where the match plays them: the person's own a button opening the
 * tower menu, showing their choice — each tower at each cost, or none; a bot's, for the host,
 * the same button choosing for it, Random its draw from the seed and its seat (`drawnSpecial`,
 * the user's, 2026-10-25); anyone else's shown as the button is — icon, name and a pip a cannon
 * — but not to be pressed (the user's, 2026-10-23).
 */
function towerControl(
  view: LobbyView,
  index: number,
  special: TowerVariant | null | 'bot',
  isHost: boolean,
): string {
  if (!view.settings.specials) return '';
  // Small, after the seat's number and before its name, so a seat keeps to one line at eight
  // players (the user's, 2026-10-28); its name and what it does on hover.
  const named = (shown: TowerVariant | null): string =>
    shown === null ? towerName(null) : towerName(variantKind(shown));
  const badge = (shown: TowerVariant | null, mark = ''): string => {
    const what = shown === null ? t('towerMenu.noneWhat') : towerWhat(shown);
    return `<span class="tower-mini tower-badge" data-tip="${escape(`${named(shown)}: ${what}`)}">${towerFace(shown)}${mark}</span>`;
  };
  if (special === 'bot') {
    const choice = botTowerOf(view.botTowers, index);
    const shown =
      choice === 'drawn' ? drawnSpecial(view.seed, index, defaultRuleset.specials) : choice;
    const mark =
      choice === 'drawn'
        ? `<span class="drawn-mark" data-tip="${escape(t('towerMenu.random'))}">${dieSvg('currentColor')}</span>`
        : '';
    if (!isHost) return badge(shown, mark);
    const label = escape(`${named(shown)} · ${t('towerMenu.openBot', { n: index + 1 })}`);
    return (
      `<button type="button" class="tower-mini tower-button bot-tower" data-seat="${index}" data-choice="${choice ?? 'none'}" ` +
      `data-tip="${label}" aria-label="${label}">${towerFace(shown)}${mark}</button>`
    );
  }
  if (index !== view.humanPlayer) return badge(special);
  // A button showing the choice, opening the tower menu (`towerMenu.ts`): the list of every
  // variant had stopped scaling (the user's, 2026-10-16). What it does is told in the menu.
  const label = escape(`${named(special)} · ${t('towerMenu.open')}`);
  return (
    `<button type="button" id="my-special" class="tower-mini tower-button" data-variant="${special ?? ''}" ` +
    `data-tip="${label}" aria-label="${label}">${towerFace(special)}</button>`
  );
}

/** A tower as a seat shows it: its icon, and under it a dot for each cannon it costs. */
export function towerFace(special: TowerVariant | null): string {
  if (special === null) return `${cannonSvg('currentColor')}<span class="pips"></span>`;
  const pips = `<span class="pips">${'•'.repeat(variantCost(special))}</span>`;
  return `${towerSvg(variantKind(special), 'currentColor')}${pips}`;
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
  return `<span class="pips" data-tip="${t('lobby.level', { n: level })}" aria-hidden="true">${pips}</span>`;
}

function levelControl(level: number, isHost: boolean, attributes: string, label_: string): string {
  if (!isHost) {
    return `<em class="tag level">${t('lobby.level', { n: level })}</em>${levelPips(level)}`;
  }
  // A stepper showing the level's number beside the pips (`choices.ts`).
  return `${levelPips(level)}<select ${attributes} data-ui="step" aria-label="${label_}">${LEVELS.map(
    (n) =>
      `<option value="${n}" data-short="${n}"${n === level ? ' selected' : ''}>${t('lobby.level', { n })}</option>`,
  ).join('')}</select>`;
}

/**
 * The host's own seat: a switch between playing it and a bot playing it, and for a bot its
 * level as every other bot's is set — where one list had held both, unlike the rest (the
 * user's, 2026-10-28).
 */
function hostSeatControl(view: LobbyView): string {
  const playing = view.hostBot === null;
  const option = (value: string, label: string, on: boolean): string =>
    `<option value="${value}"${on ? ' selected' : ''}>${label}</option>`;
  const who =
    `<select id="host-play" data-ui="seg" aria-label="${t('lobby.whoPlays')}">` +
    `${option('person', t('lobby.seatYou'), playing)}${option('bot', t('lobby.seatBot'), !playing)}</select>`;
  if (playing) return who;
  return who + levelControl(view.hostBot ?? 5, true, 'id="host-bot"', t('lobby.whoPlays'));
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
  // The seat's colour, edging its card (PLAN §11 item 4, MS3).
  const colour = view.seatColours?.[index];
  const who = colour === undefined ? '' : ` style="--who:${colour}"`;

  if (seat) {
    const isHostSeat = seat.playerId === view.hostId;
    const tags = [
      // Not on the host's own seat for the host, whose You | Bot switch and tinted card say so,
      // and whose seat as a bot otherwise ran onto a second line (2026-10-28).
      seat.playerId === view.humanPlayer && !(isHost && isHostSeat)
        ? `<em class="tag you">${t('lobby.tagYou')}</em>`
        : '',
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
    if (isHostSeat && isHost) control = hostSeatControl(view);
    else if (isHostSeat && view.hostBot !== null) {
      control = levelControl(view.hostBot, false, '', '');
    }
    // A teammate at a tournament's table plays in place of one of the team's bots.
    const stands = view.tournament?.seats[index];
    if (stands?.open === true && stands.level !== null) {
      blurb = `<small class="blurb">${escape(t('tournament.inPlaceOf', { bot: stands.name }))}</small>`;
    }
    // A host watching has a bot in their seat, which brings the seat's draw.
    const watched = isHostSeat && view.hostBot !== null;
    const tower = towerControl(view, index, watched ? 'bot' : seat.special, isHost);
    return `<li class="seat${mine}${arrived}"${who}>${seatBadge(view, index)}${tower}${occupant(view, index, seats, seat.name)}${tags}${control}${blurb}</li>`;
  }

  const control = levelControl(
    view.bots[index] ?? defaultLevel,
    isHost,
    `class="bot-select" data-seat="${index}"`,
    t('lobby.botLevelAria', { n: index + 1 }),
  );
  const bot = view.tournament?.seats[index]?.name ?? t('lobby.bot', { n: index + 1 });
  return `<li class="seat bot${arrived}"${who}>${seatBadge(view, index)}${towerControl(view, index, 'bot', isHost)}${occupant(view, index, seats, bot)}${control}</li>`;
}

/** The map and the seed it comes from: the host may draw another or type one in. */
function mapControls(view: LobbyView, isHost: boolean): string {
  // Shaped by `PREVIEW_ASPECT`, never by the map, so the lobby keeps its size.
  const canvas = `<canvas id="map-preview" class="map-preview" style="aspect-ratio:1/${PREVIEW_ASPECT}" aria-label="${t('lobby.mapAria')}"></canvas>`;
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
    : `<button id="begin" class="primary"${blocked === null ? '' : ' disabled'}>${withIcon('play', t(view.tournament ? 'tournament.play' : 'lobby.start'))}</button>` +
      (blocked === null ? '' : `<p class="note warn">${escape(blocked)}</p>`);
  const roomNote =
    view.tournament && hosts && view.code !== null
      ? `<p class="note">${escape(t('tournament.roomNote'))}</p>`
      : '';

  const chip =
    view.code === null
      ? ''
      : `<div class="code-chip">
        <code id="room-code" class="room-code">${escape(view.code)}</code>
        <button id="copy-code" class="quiet">${t('lobby.copy')}</button>
      </div>`;
  const code =
    view.code === null
      ? ''
      : (view.invite
          ? `<div class="code-row invite-row">
        <span class="invite-label">${t('lobby.invite')}</span>
        <code id="invite-link" class="invite-link">${escape(view.invite)}</code>
        <button id="copy-invite" class="quiet">${t('lobby.copy')}</button>
      </div>`
          : '') + roomNote;

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
      <div class="lobby-head">
        <h1>${view.tournament ? escape(t('lobby.tournament', { team: view.tournament.teamNames[view.tournament.seats.find((s) => s.level === null)?.team ?? 0] ?? '' })) : view.code === null ? t('lobby.table') : t('lobby.room')}</h1>
        ${chip}
      </div>
      ${view.notice ? `<p class="note warn">${escape(view.notice)}</p>` : ''}
      ${code}
      ${panels}
      ${start}
      <button id="leave" class="quiet">${withIcon('back', leave)}</button>
    </div>
  `;
}
