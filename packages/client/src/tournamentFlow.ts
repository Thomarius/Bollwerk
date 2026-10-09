import { defaultConfigBundle } from '@bollwerk/config';
import { PHASES, type Phase } from '@bollwerk/sim';
import {
  Progress,
  coinFor,
  mapSeed,
  matchSettingsOf,
  matchTable,
  placedFrom,
  recordMatch,
  type MatchTable,
  type Save,
} from '@bollwerk/tournament';

import { app, audio, params, showError } from './app.js';
import { t } from './i18n.js';
import type { LobbyTab, LobbyView } from './lobby.js';
import { drawLobby, wireBracket } from './lobbyFlow.js';
import { runSession, type MatchExits } from './matchScreen.js';
import { preferredStyles } from './prefs.js';
import {
  DEFAULT_BOT,
  SETTING_BOUNDS,
  localMatchFor,
  localSession,
  networkSession,
  type Setup,
} from './session.js';
import type { TournamentExits } from './tournamentMenu.js';
import { TournamentRoom, roomTable } from './tournamentRoom.js';
import { deleteTournament, loadTournament, writeTournament } from './tournamentSaves.js';
import { endingMarkup, tournamentTab } from './tournamentView.js';

/**
 * Playing a tournament (TOURNAMENT T5, T6): the screen between matches, the match, its
 * result recorded and saved as it ends, and the tournament's end.
 *
 * Only a finished match counts. One left — paused and left, or the page closed — leaves the
 * save as it was, so the same match, on the same map, is played again (§1.7).
 *
 * In a team of two or more, a room is opened on the server, if one answers, and held for as
 * long as the tournament is open, so friends can join the host's team by its code for any
 * match. A match with somebody in it is played there; one with nobody is played here.
 */

/** A tournament open on this page: the save, and its room while it has one. */
interface Open {
  save: Save;
  exits: TournamentExits;
  room: TournamentRoom | null;
  /** Whether to try for a room: a team of two or more, and a server found once. */
  online: boolean;
}

/** Opens a saved tournament where it stands, with a room for the team if it can have one. */
export async function playTournament(id: string, exits: TournamentExits): Promise<void> {
  const save = loadTournament(id);
  if (save === null) {
    exits.list(t('tournament.gone'));
    return;
  }
  const open: Open = { save, exits, room: null, online: save.settings.teamSize > 1 };
  await ensureRoom(open);
  showTournament(open, null);
}

/** A room for the team, opened if there is none and a server may answer. */
async function ensureRoom(open: Open): Promise<void> {
  if (!open.online || open.room?.open === true) return;
  if (new Progress(open.save).status.kind !== 'playing') return;
  app!.innerHTML = `<div class="menu"><h1>${t('tournament.openingRoom')}</h1><p class="note">${t('menu.lookingForServer')}</p></div>`;
  open.room = await TournamentRoom.open(open.save.settings.hostName, open.exits.isPublic);
  // No server: none will answer later either, so the tournament plays on here alone.
  if (open.room === null) open.online = false;
}

function leaveTournament(open: Open): void {
  open.room?.close();
  open.room = null;
  open.exits.menu();
}

/** The screen between matches, or the end once the tournament has one. */
function showTournament(open: Open, notice: string | null): void {
  audio.music('music_menu');
  const { save } = open;
  const progress = new Progress(save);
  if (progress.status.kind !== 'playing') {
    open.room?.close();
    open.room = null;
    showEnding(open, progress);
    return;
  }
  const room = open.room?.open === true ? open.room : null;
  const table = roomTable(save, progress);
  if (table === null) return;
  // The room is set for the coming match — and, after one, brought back to its lobby.
  room?.sendTable(table, save);
  const hostSeat = table.seats.findIndex((seat) => seat.level === null);
  // Each time it appears, the screen opens on the match (the users' choice, 2026-10-09).
  let tab: LobbyTab = 'match';

  const draw = (): void => {
    // The match's lobby as a teammate's page shows it, the host in their seat: the room's
    // last word on who sits where may still be the match before's.
    const people =
      room === null
        ? [
            {
              playerId: hostSeat,
              name: save.settings.hostName,
              isBot: false,
              connected: true,
              ready: true,
            },
          ]
        : room.people.map((p) => (p.playerId === room.hostId ? { ...p, playerId: hostSeat } : p));
    const view: LobbyView = {
      code: room?.code ?? null,
      playerCount: table.seats.length,
      hostId: hostSeat,
      humanPlayer: hostSeat,
      seats: people,
      bots: table.seats.map((seat) => seat.level ?? DEFAULT_BOT),
      settings: table.settings,
      settingBounds: SETTING_BOUNDS,
      teams: table.seats.map((seat) => seat.team),
      playerLimits: defaultConfigBundle.ruleset.players,
      seed: table.seed,
      hostBot: null,
      invite: room?.invite ?? null,
      tournament: table,
      tournamentTab: tournamentTab(save, progress, tab),
      notice,
    };
    const none = (): void => undefined;
    drawLobby(view, {
      table: none,
      bot: none,
      seed: none,
      hostBot: none,
      move: (from, to) => room?.move(from, to),
      start: () => {
        if (room !== null) {
          room.onChange = null;
          if (room.guests.length > 0) {
            playOnline(open, room, progress);
            return;
          }
        }
        playHere(open, progress);
      },
      tab: (chosen) => (tab = chosen),
    });
    wireBracket(save, progress);
    app!.querySelector('#leave')?.addEventListener('click', () => {
      audio.play('select');
      if (room !== null) room.onChange = null;
      leaveTournament(open);
    });
  };
  // Somebody arrived, left or moved: drawn again, and heard.
  if (room !== null) {
    room.onChange = () => {
      if (app!.querySelector('.tournament-lobby') === null) return;
      draw();
    };
  }
  draw();
}

/**
 * The end, won or out. The save goes now, as it is shown: a tournament ended but never
 * shown its end — the page closed on the match's summary — is still saved, and opening it
 * shows the end then.
 */
function showEnding(open: Open, progress: Progress): void {
  deleteTournament(open.save.id);
  app!.innerHTML = endingMarkup(open.save, progress);
  audio.music(progress.status.kind === 'won' ? 'music_victory' : 'music_defeat');
  wireBracket(open.save, progress);
  app!.querySelector('#back')?.addEventListener('click', () => {
    audio.play('select');
    open.exits.menu();
  });
}

/** The host's next match: its table, and how the match screen leads back here. */
function matchFor(
  open: Open,
  progress: Progress,
): { setup: Setup; table: MatchTable; exits: MatchExits } | null {
  const { save } = open;
  const step = progress.done;
  const teams = progress.next?.matches[progress.hostMatch];
  if (teams === undefined) return null;
  const table = matchTable(save, teams);
  const setup: Setup = {
    seats: table.seats.map((s) => s.level),
    seed: mapSeed(save, step),
    styles: preferredStyles(),
    name: save.settings.hostName,
    settings: matchSettingsOf(save, defaultConfigBundle.ruleset.elimination.continues),
    teams: table.seats.map((s) => s.team),
    names: table.seats.map((s) => s.name),
    personalities: table.seats.map((s) => s.personality),
    tournament: { id: save.id, step },
    teamNames: teams.map((id) => save.teams[id]?.name ?? ''),
  };
  let saved = true;
  const exits: MatchExits = {
    // Recorded and saved the moment the match is over, before its summary shows, so
    // nothing after it — the page closed on the summary — can lose the result.
    finished: (state) => {
      const placed = placedFrom(state, table, coinFor(save, step));
      recordMatch(save, defaultConfigBundle.tournament, placed, new Date().toISOString());
      saved = writeTournament(save);
    },
    // Left before the end: nothing was recorded, and the match waits to be played again.
    // Online, leaving closed the room; a new one is opened.
    leave: () => void ensureRoom(open).then(() => showTournament(open, t('tournament.replayNote'))),
    leaveConfirm: 'tournament.leaveConfirm',
    next: {
      label: 'tournament.continue',
      go: () =>
        void ensureRoom(open).then(() =>
          showTournament(open, saved ? null : t('tournament.couldNotSave')),
        ),
    },
    back: () => leaveTournament(open),
  };
  return { setup, table, exits };
}

/** A match with nobody else in it, played on this computer, as offline. */
function playHere(open: Open, progress: Progress): void {
  const prepared = matchFor(open, progress);
  if (prepared === null) return;
  const { setup, exits } = prepared;
  // `&snapshot=PHASE` (and `&round=`, `&idle=1`) as `?autostart` has them, for looking at a
  // tournament's match deep in — `game_over` plays it out at once, its result counted.
  const phase = params.get('snapshot');
  const match = localMatchFor(setup, phase === null);
  if (phase !== null && PHASES.includes(phase as Phase)) {
    match.fastForwardTo(
      phase as Phase,
      Number(params.get('round') ?? 0),
      params.get('idle') === '1',
    );
  }
  void runSession(localSession(match, null), setup, exits).catch((error: unknown) =>
    showError(t('error.failedToStart'), error),
  );
}

/** A match with teammates in it, played in the room, the room's table being this match's. */
function playOnline(open: Open, room: TournamentRoom, progress: Progress): void {
  const prepared = matchFor(open, progress);
  if (prepared === null) return;
  const { setup, exits } = prepared;
  let started = false;
  room.onSnapshot = () => {
    if (started) return;
    started = true;
    void runSession(
      networkSession(room.match, room.connection, false, () => true),
      setup,
      {
        ...exits,
        // Online the room closes as the page leaves; the tournament keeps its own record.
        back: () => leaveTournament(open),
      },
    ).catch((error: unknown) => showError(t('error.matchFailed'), error));
  };
  app!.innerHTML = `<div class="menu"><h1>${t('tournament.starting')}</h1></div>`;
  room.start();
}
