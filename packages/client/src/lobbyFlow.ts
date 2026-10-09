import {
  artForStyle,
  defaultArtConfig,
  defaultConfigBundle,
  defaultTeams,
  reshapeTable,
  type MatchSettings,
  type Table,
} from '@bollwerk/config';
import { type ServerMessage } from '@bollwerk/protocol';
import { Progress, parseSave, type Save } from '@bollwerk/tournament';

import { lobbyMarkup, type LobbyTab, type LobbyView } from './lobby.js';
import { joinRefusedNotice, refusalText } from './browser.js';
import { t } from './i18n.js';
import { motionReduced } from './motion.js';
import { drawPreview, tablePreview } from './preview.js';
import { ServerConnection } from './net/connection.js';
import { NetworkMatch } from './net/networkMatch.js';
import { store, stored } from './storage.js';
import { app, showError, audio, params } from './app.js';
import { preferredStyles, randomSeed, chosenSeed } from './prefs.js';
import type { Setup } from './session.js';
import {
  SETTING_BOUNDS,
  DEFAULT_SETTINGS,
  localMatchFor,
  DEFAULT_BOT,
  DEFAULT_PLAYERS,
  localSession,
  networkSession,
} from './session.js';
import type { Common } from './menu.js';
import { showMenu } from './menu.js';
import { runSession } from './matchScreen.js';
import { openBracket } from './tournamentBracketView.js';
import { endingMarkup, tournamentTab } from './tournamentView.js';

/** The lobby, one screen whether a server holds the table or the browser does. */

const TOKEN_KEY = 'bollwerk.seat';

/** How long to wait for a server before setting the table locally instead. */
const SERVER_WAIT_MS = 2000;

/** What the lobby's controls do, whichever backend is behind them. */
export interface LobbyHandlers {
  table(change: { settings?: MatchSettings; playerCount?: number; teams?: number[] }): void;
  bot(seat: number, level: number): void;
  /** A new map: a seed typed in, or a fresh random one. */
  seed(seed: number): void;
  /** A bot to play the host's own seat while they watch, or null to play it. */
  hostBot(level: number | null): void;
  /** The person in seat `from` to seat `to`, swapping with whoever sits there. */
  move(from: number, to: number): void;
  start(): void;
  /** A tab chosen, to be kept open as the lobby is drawn again. */
  tab?(tab: LobbyTab): void;
}

/** Draws the lobby and wires its controls to whichever backend holds the table. */
export function drawLobby(view: LobbyView, on: LobbyHandlers): void {
  // The map, which island each seat is dealt and the colour it plays in: all known now,
  // since the seed is fixed while the table is set. See `preview.ts`.
  const { art, terrain } = defaultConfigBundle;
  const preview = tablePreview(view.seed, view.playerCount, view.teams, art, terrain);
  app!.innerHTML = lobbyMarkup({
    ...view,
    seatColours: preview.colourOfSeat.map((c) => c.base),
    seatShapes: preview.shapeOfSeat,
  });
  // The map in the colours of the build look chosen in the menu, which is how the match
  // will open — the default's, when it is drawn at random as the match starts;
  // the seat cards keep the shared colours, which read on the lobby's panel.
  const chosen = preferredStyles().build;
  const look = artForStyle(art, chosen === 'random' ? defaultArtConfig.styles.build : chosen);
  const map = tablePreview(view.seed, view.playerCount, view.teams, look, terrain);
  const canvas = document.querySelector<HTMLCanvasElement>('#map-preview');
  if (canvas !== null) {
    // Alive while the lobby is open (PLAN 11.11 W7): redrawn each frame until the canvas
    // is replaced — every change to the table redraws the lobby — or the lobby goes. Still
    // under reduced motion.
    const frame = (now: number): void => {
      if (!canvas.isConnected) return;
      drawPreview(canvas, map, view.humanPlayer, look, 320, art, motionReduced() ? 0 : now);
      if (!motionReduced()) requestAnimationFrame(frame);
    };
    frame(performance.now());
  }
  const number = (id: string, apply: (n: number) => void): void => {
    const field = document.querySelector<HTMLSelectElement>(id);
    field?.addEventListener('change', () => {
      audio.play('select');
      apply(Number(field.value));
    });
  };
  number('#team-size', (teamSize) => on.table({ settings: { ...view.settings, teamSize } }));
  number('#player-count', (playerCount) => on.table({ playerCount }));
  number('#max-rounds', (maxRounds) => on.table({ settings: { ...view.settings, maxRounds } }));
  number('#lives', (lives) => on.table({ settings: { ...view.settings, continues: lives - 1 } }));
  for (const field of document.querySelectorAll<HTMLSelectElement>('.bot-select')) {
    field.addEventListener('change', () => {
      audio.play('select');
      on.bot(Number(field.dataset.seat), Number(field.value));
    });
  }
  const seedField = document.querySelector<HTMLInputElement>('#seed');
  seedField?.addEventListener('change', () => {
    const n = Number(seedField.value);
    if (Number.isInteger(n) && n >= 0) on.seed(n >>> 0);
  });
  document.querySelector('#reroll')?.addEventListener('click', () => {
    audio.play('select');
    on.seed(randomSeed());
  });
  const hostBot = document.querySelector<HTMLSelectElement>('#host-bot');
  hostBot?.addEventListener('change', () => {
    audio.play('select');
    on.hostBot(hostBot.value === '' ? null : Number(hostBot.value));
  });
  // Who sits where. Teams belong to seats, so this is how people choose sides.
  for (const field of document.querySelectorAll<HTMLSelectElement>('.occupant')) {
    field.addEventListener('change', () => {
      if (field.value === '') return;
      audio.play('select');
      on.move(Number(field.value), Number(field.dataset.seat));
    });
  }

  // Copying beats reading a code aloud, and the fallback matters: the clipboard API
  // is unavailable over plain http on anything but localhost, which is exactly how
  // somebody will first try this on a home network. There `navigator.clipboard` is
  // undefined, and an optional call on it once skipped the fallback too, so the button
  // did nothing at all (reported from Linux Mint over a LAN address).
  wireCopy('#copy-code', '#room-code', view.code ?? '');
  // The link for friends outside the house, while the host's port is open (PLAN 11.21).
  if (view.invite) wireCopy('#copy-invite', '#invite-link', view.invite);
  document.querySelector('#begin')?.addEventListener('click', () => {
    audio.play('select');
    on.start();
  });
  // A tournament's tabs, switched in place: the lobby is drawn again only when it changes.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.lobby-tabs .tab')];
  for (const button of tabs) {
    button.addEventListener('click', () => {
      const chosen = button.dataset.tab as LobbyTab;
      audio.play('select');
      for (const other of tabs) {
        other.classList.toggle('on', other === button);
        other.setAttribute('aria-selected', String(other === button));
      }
      for (const panel of document.querySelectorAll<HTMLElement>('.tab-panel')) {
        panel.hidden = panel.dataset.panel !== chosen;
      }
      on.tab?.(chosen);
    });
  }
}

/** The bracket's button, where a tournament's tab or end shows one. */
export function wireBracket(save: Save, progress: Progress): void {
  document.querySelector('#bracket')?.addEventListener('click', () => {
    audio.play('select');
    openBracket(save, progress, () => audio.play('select'));
  });
}

/** A tournament's end, won or out, as the host's page and their teammates' show it. */
export function showEnding(save: Save, progress: Progress, back: () => void): void {
  app!.innerHTML = endingMarkup(save, progress);
  audio.music(progress.status.kind === 'won' ? 'music_victory' : 'music_defeat');
  wireBracket(save, progress);
  app!.querySelector('#back')?.addEventListener('click', () => {
    audio.play('select');
    back();
  });
}

/** A button that copies `text`, shown in the node `shown`; see the lobby's copy above. */
export function wireCopy(button: string, shown: string, text: string): void {
  const copy = document.querySelector<HTMLButtonElement>(button);
  copy?.addEventListener('click', () => {
    audio.play('select');
    const code = text;
    const copied = (): void => {
      copy.textContent = t('lobby.copied');
      setTimeout(() => (copy.textContent = t('lobby.copy')), 1200);
    };
    // The old way, still honoured over plain http: select the code and copy the selection.
    // Failing that, it is left selected so it can be copied by hand.
    const bySelection = (): void => {
      const node = document.querySelector(shown);
      if (node) globalThis.getSelection()?.selectAllChildren(node);
      let ok: boolean;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) copied();
      else copy.textContent = t('lobby.selectCopy');
    };
    if (globalThis.isSecureContext && navigator.clipboard !== undefined) {
      navigator.clipboard.writeText(code).then(copied, bySelection);
    } else {
      bySelection();
    }
  });
}

/** The table as the local lobby holds it, and as a room reports it. */
interface TableState extends Table {
  seed: number;
  hostBot: number | null;
  /** Where the host sits: they may move to any seat, and the seat decides the team. */
  hostSeat: number;
  bots: number[];
}

/**
 * Plays a table on this computer: the person in seat 0 unless watching, bots in the
 * rest, islands shuffled among the seats exactly as the server would.
 */
function playLocally(common: Common, table: TableState): void {
  const setup: Setup = {
    ...common,
    seed: table.seed,
    // The host's seat is theirs unless they put a bot in it — then it is a match of bots
    // alone, and the host watches.
    seats: table.bots
      .slice(0, table.playerCount)
      .map((tier, seat) => (seat === table.hostSeat ? table.hostBot : tier)),
    settings: table.settings,
    teams: table.teams,
  };
  // A rematch reopens this table as it was, on a new map (PLAN 11.18 Y6).
  const rematch = (): void => localLobby(common, table.playerCount, randomSeed(), table);
  void runSession(localSession(localMatchFor(setup), rematch), setup).catch((error: unknown) =>
    showError(t('error.failedToStart'), error),
  );
}

/**
 * Opens the lobby: a room if a server answers, a table on this computer if not.
 *
 * "Answers" means a welcome within the wait, not merely an open socket: under the dev
 * server the socket's address is the dev server's own, which may accept the connection
 * and then say nothing. Solo play never waits on a network for longer than that. Joining
 * by code does need the server, so that fails plainly rather than dropping the player at
 * a table of their own.
 */
export async function openLobby(
  common: Common,
  code: string | null,
  playerCount = DEFAULT_PLAYERS,
): Promise<void> {
  const seed = chosenSeed();
  app!.innerHTML = `<div class="menu"><h1>${t('menu.settingTable')}</h1><p class="note">${t('menu.lookingForServer')}</p></div>`;
  const connection = new ServerConnection(ServerConnection.defaultUrl());
  const answered = new Promise<ServerMessage | null>((resolve) => {
    connection.onMessage((message) => {
      if (message.type === 'welcome' || message.type === 'error') resolve(message);
    });
    setTimeout(() => resolve(null), SERVER_WAIT_MS);
  });
  connection.connect().catch(() => undefined);

  const seat = stored(TOKEN_KEY, 'session')?.split(':') ?? [];
  if (code === null) connection.createRoom(common.name, playerCount, common.isPublic);
  else if (seat[0] === code.toUpperCase() && seat[1])
    connection.joinRoom(common.name, code, seat[1]);
  else connection.joinRoom(common.name, code);

  const first = await answered;
  if (first?.type === 'welcome') {
    // A room draws its own random map; a seed asked for in the address is the host's
    // to set, like any other choice of theirs.
    if (code === null && params.get('seed') !== null) connection.send({ type: 'configure', seed });
    roomLobby(common, connection, code, first);
    return;
  }
  connection.close();
  // A game picked from the list may have filled or gone since it was listed: say so, and
  // back to the menu, whose list is fresh as it opens.
  const refused = first?.type === 'error' && code !== null ? joinRefusedNotice(first.code) : null;
  if (refused !== null) {
    showMenu(refused);
    return;
  }
  if (first?.type === 'error') {
    showError(t('error.refused', { code: first.code }), refusalText(first.code, first.message));
    return;
  }
  if (code !== null) {
    showError(t('error.couldNotJoin'), t('error.noServer', { url: ServerConnection.defaultUrl() }));
    return;
  }
  localLobby(common, playerCount, seed);
}

/** The lobby with no server: the table lives here, under the same rules as a room's. */
/** `kept` is a table to open as it was, for a rematch; otherwise a fresh one. */
function localLobby(
  common: Common,
  playerCount: number,
  seed: number,
  kept: TableState | null = null,
): void {
  const limits = defaultConfigBundle.ruleset.players;
  const start = reshapeTable(
    { settings: DEFAULT_SETTINGS, playerCount: limits.min, teams: defaultTeams(limits.min, 1) },
    { playerCount },
    limits,
    1,
  );
  let table: TableState =
    kept === null
      ? {
          ...start,
          bots: Array.from({ length: limits.max }, () => DEFAULT_BOT),
          seed,
          hostBot: null,
          hostSeat: 0,
        }
      : { ...kept, bots: [...kept.bots], teams: [...kept.teams], seed };

  const redraw = (): void =>
    drawLobby(
      {
        code: null,
        playerCount: table.playerCount,
        hostId: table.hostSeat,
        humanPlayer: table.hostSeat,
        seats: [
          {
            playerId: table.hostSeat,
            name: common.name,
            isBot: false,
            connected: true,
            ready: true,
          },
        ],
        bots: table.bots.slice(0, table.playerCount),
        settings: table.settings,
        settingBounds: SETTING_BOUNDS,
        teams: table.teams,
        playerLimits: limits,
        seed: table.seed,
        hostBot: table.hostBot,
      },
      {
        table: (change) => {
          table = { ...table, ...reshapeTable(table, change, limits, 1) };
          // A table shrunk out from under the host brings them to the first seat.
          if (table.hostSeat >= table.playerCount) table.hostSeat = 0;
          redraw();
        },
        bot: (seat, tier) => {
          table.bots[seat] = tier;
          redraw();
        },
        seed: (seed) => {
          table.seed = seed;
          redraw();
        },
        hostBot: (tier) => {
          table.hostBot = tier;
          redraw();
        },
        move: (from, to) => {
          // Only the host can be moved here; the bot in the seat they take gets theirs.
          if (from !== table.hostSeat || to >= table.playerCount) return;
          [table.bots[from], table.bots[to]] = [
            table.bots[to] ?? DEFAULT_BOT,
            table.bots[from] ?? DEFAULT_BOT,
          ];
          table.hostSeat = to;
          redraw();
        },
        start: () => playLocally(common, table),
      },
    );
  redraw();
  document.querySelector('#leave')?.addEventListener('click', () => showMenu());
}

/**
 * The lobby as a room on the server. At the start, a table nobody else has joined is
 * played locally from the room's settings, and the room is left: there is nobody to
 * share a server with.
 */
function roomLobby(
  common: Common,
  connection: ServerConnection,
  code: string | null,
  welcome: Extract<ServerMessage, { type: 'welcome' }>,
): void {
  const match = new NetworkMatch(connection);
  let view: LobbyView | null = null;
  /** The table as it stood before the start, which is what the seats were dealt from. */
  let table: LobbyView | null = null;
  let roomCode = code ?? '';
  let hostId = -1;
  /** Whether the host is still at the table, as the room last said: gone, nobody calls the next match. */
  let hostHere = true;
  let started = false;
  /** Takes the match down, for a rematch bringing the room back to its lobby. */
  let endMatch: (() => void) | null = null;
  /** The host's tournament as they last sent it, at a tournament's table, and where it stands. */
  let tournament: { save: Save; progress: Progress } | null = null;
  /** The tab open, and the tournament's step it was chosen at: each match opens on its own. */
  let tab: LobbyTab = 'match';
  let tabStep = -1;

  const tableOf = (v: LobbyView): TableState => ({
    settings: v.settings,
    playerCount: v.playerCount,
    teams: [...v.teams],
    bots: [...v.bots],
    seed: v.seed,
    hostBot: v.hostBot,
    hostSeat: v.hostId,
  });
  /** Seats already seen, so a newcomer can be marked as they arrive. */
  let known: Set<number> | null = null;

  const render = (): void => {
    if (started || view === null) return;
    const step = view.tournament?.tournament ?? null;
    const same = tournament !== null && step !== null && tournament.save.id === step.id;
    if (step !== null && step.step !== tabStep) {
      tab = 'match';
      tabStep = step.step;
    }
    const current: LobbyView = same
      ? { ...view, tournamentTab: tournamentTab(tournament!.save, tournament!.progress, tab) }
      : view;
    drawLobby(current, {
      table: (change) => connection.send({ type: 'configure', ...change }),
      bot: (seat, tier) => {
        const bots = [...current.bots];
        bots[seat] = tier;
        connection.send({ type: 'configure', bots });
      },
      seed: (seed) => connection.send({ type: 'configure', seed }),
      hostBot: (tier) => connection.send({ type: 'configure', hostBot: tier }),
      move: (from, to) => connection.send({ type: 'configure', move: { from, to } }),
      start: () => {
        if (current.seats.length > 1) {
          connection.send({ type: 'start' });
          return;
        }
        started = true;
        connection.close();
        playLocally(common, tableOf(current));
      },
      tab: (chosen) => (tab = chosen),
    });
    if (same) wireBracket(tournament!.save, tournament!.progress);
    document.querySelector('#leave')?.addEventListener('click', () => {
      audio.play('select');
      started = true;
      connection.close();
      showMenu();
    });
  };

  connection.onMessage((message) => {
    match.receive(message);
    switch (message.type) {
      case 'welcome':
        roomCode = message.code;
        hostId = message.hostId;
        store(TOKEN_KEY, `${message.code}:${message.token}`, 'session');
        break;
      case 'room': {
        hostId = message.hostId;
        hostHere = message.seats.some((s) => s.playerId === hostId && s.connected);
        // Somebody new at the table: marked as they arrive, and heard.
        const ids = new Set(message.seats.map((seat) => seat.playerId));
        const arrived = known === null ? [] : [...ids].filter((id) => !known?.has(id));
        if (arrived.length > 0 && !message.started) audio.play('select');
        known = ids;
        view = {
          code: roomCode,
          playerCount: message.playerCount,
          hostId,
          humanPlayer: match.humanPlayer,
          seats: message.seats,
          bots: [...message.bots],
          settings: message.settings,
          settingBounds: message.settingBounds,
          teams: [...message.teams],
          playerLimits: message.playerLimits,
          seed: message.seed,
          hostBot: message.hostBot,
          arrived,
          invite: message.internet === null ? null : `${message.internet}/?join=${roomCode}`,
          tournament: message.tournament,
        };
        if (!message.started) {
          // Unstarted again after a match: the host called a rematch, and the room is its
          // lobby once more, everyone in their old seats (PLAN 11.18 Y6).
          if (started) {
            endMatch?.();
            endMatch = null;
            started = false;
          }
          table = view;
          render();
        }
        break;
      }
      case 'tournamentSave':
        tournament = readTournament(message.save);
        // The tournament over, sent as the host's room closes: its end, as the host sees it,
        // in place of the last match's summary.
        if (started && tournament !== null && tournament.progress.status.kind !== 'playing') {
          endMatch?.();
          endMatch = null;
          connection.close();
          showEnding(tournament.save, tournament.progress, showMenu);
          break;
        }
        render();
        break;
      case 'snapshot':
        if (!started) {
          started = true;
          // A host who gave their seat to a bot watches it play, whoever else is here.
          const watching =
            view !== null && view.hostBot !== null && match.humanPlayer === view.hostId;
          // Each seat's bot level, or null for a person, in lobby order.
          const seats = Array.from({ length: table?.playerCount ?? 0 }, (_, seat) => {
            const person = table?.seats.some((s) => s.playerId === seat) ?? false;
            if (!person) return table?.bots[seat] ?? DEFAULT_BOT;
            return seat === table?.hostId && table.hostBot !== null ? table.hostBot : null;
          });
          const seed = table?.seed ?? view?.seed ?? 0;
          const setup: Setup = { ...common, seed, seats, settings: DEFAULT_SETTINGS };
          const tournament = table?.tournament ?? null;
          void runSession(
            networkSession(
              match,
              connection,
              watching,
              () => match.humanPlayer === hostId,
              () => hostHere,
            ),
            setup,
            // The next match is the host's to send from their tournament.
            tournament === null ? {} : { waitLabel: 'tournament.waitHost' },
          ).then(
            (end) => (endMatch = end),
            (e: unknown) => showError(t('error.matchFailed'), e),
          );
        }
        break;
      case 'error':
        showError(
          t('error.refused', { code: message.code }),
          refusalText(message.code, message.message),
        );
        break;
      default:
        break;
    }
  });

  // The welcome that decided there was a server arrived before this listener did.
  match.receive(welcome);
  roomCode = welcome.code;
  hostId = welcome.hostId;
  store(TOKEN_KEY, `${welcome.code}:${welcome.token}`, 'session');

  // Until the connection closes — left running, every lobby opened in the page went on
  // queueing a ping every two seconds for a socket that would never send them.
  const pinging = setInterval(() => {
    if (connection.state === 'closed') clearInterval(pinging);
    else connection.ping();
  }, 2000);
}

/**
 * The host's tournament as they sent it, and where it stands, or null if it cannot be read:
 * the lobby then has no tournament's tab, only the match.
 */
function readTournament(json: string): { save: Save; progress: Progress } | null {
  try {
    const parsed = parseSave(JSON.parse(json));
    return parsed.ok ? { save: parsed.save, progress: new Progress(parsed.save) } : null;
  } catch {
    return null;
  }
}
