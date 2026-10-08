import {
  applySettings,
  defaultConfigBundle,
  defaultSettings,
  mergeSettings,
  parsePersonality,
  type BotSetup,
  type MatchSettings,
  type Personality,
} from '@bollwerk/config';
import { type Action, type MatchEvent, type MatchState } from '@bollwerk/sim';

import { type NetworkReading } from './network.js';
import { type LookChoices } from './looks.js';
import { t } from './i18n.js';
import { LocalMatch } from './localMatch.js';
import { RecordingUpload } from './recordingUpload.js';
import type { ServerConnection } from './net/connection.js';
import type { NetworkMatch } from './net/networkMatch.js';
import { params, timeScale } from './app.js';

/** A match as the render loop sees it, played on this computer or against a server. */

/** What the render loop needs, whichever way the match is being played. */
export interface Session {
  readonly state: MatchState;
  readonly humanPlayer: number;
  readonly tickFraction: number;
  readonly finished: boolean;
  advance(elapsedMs: number): MatchEvent[];
  submit(action: Action): void;
  /**
   * Who paused the match — a player id, or -1 for somebody watching a local match — or
   * null while it runs. A paused match is not stepped, so every clock in it waits.
   */
  readonly pausedBy: number | null;
  /** Pauses or resumes: at once locally, and for everyone once a server agrees. */
  setPaused(paused: boolean): void;
  /** Each bot's level and personality, by player, for the reveal at game over. */
  readonly setups: ReadonlyMap<number, BotSetup>;
  /** Extra line for the HUD: watching, or the last move the server refused. */
  status(): string;
  /** The connection, for the badge beside Pause; null for a match on this computer. */
  network(): NetworkReading | null;
  /**
   * Leaving for the menu: online the connection closes, so the seat goes to a bot after
   * the grace a dropped player gets (§6), and no ping is left running behind the menu.
   */
  leave(): void;
  /**
   * The rematch at the end (PLAN 11.18 Y6): the player's to call, the host's to call while
   * they wait, or none — a match started from a link, with no table to go back to.
   */
  readonly rematch: 'mine' | 'host' | null;
  requestRematch(): void;
}

export interface Setup {
  /** One per seat: null for the person, otherwise the bot's level, 1 to 10. */
  seats: (number | null)[];
  seed: number;
  styles: LookChoices;
  name: string;
  /** The host's choices, offline as online, so a round limit can be felt out alone. */
  settings: MatchSettings;
  /** Each seat's team, by seat. Omitted, free-for-all. */
  teams?: readonly number[];
  /** Each seat's name, by seat, where the table names it rather than numbering bots. */
  names?: readonly (string | null)[];
  /** Each seat's bot's personality, by seat, where the table gives one. */
  personalities?: readonly (Personality | null)[];
  /** The tournament the match belongs to, for its recording. */
  tournament?: { id: string; step: number };
  /** Each team's name, by team label in order, where the table names them. */
  teamNames?: readonly string[];
}

export const SETTING_BOUNDS = defaultConfigBundle.server.lobbySettings;

export const DEFAULT_SETTINGS = defaultSettings(defaultConfigBundle.ruleset, SETTING_BOUNDS);

/** `?personality=offensive` and the like: every bot of a local match plays it (PLAN 11.6). */
const FIXED_PERSONALITY: Personality | null =
  params.get('personality') === null ? null : parsePersonality(params.get('personality') ?? '');

/**
 * An offline match on the default rules with the menu's settings over them, recorded
 * for tuning unless `record` is false — a dev shortcut into a phase is not a match
 * anyone played. The recording goes to the server the page came from; see
 * `recordingUpload.ts`.
 */
export function localMatchFor(setup: Setup, record = true): LocalMatch {
  return new LocalMatch({
    seed: setup.seed,
    seats: setup.seats,
    // ?personality= fixes every bot's, for testing; otherwise each is dealt from the seed.
    ...(FIXED_PERSONALITY === null ? {} : { personality: FIXED_PERSONALITY }),
    ...(setup.teams === undefined ? {} : { teams: setup.teams }),
    ...(setup.names === undefined ? {} : { names: setup.names }),
    ...(setup.personalities === undefined ? {} : { personalities: setup.personalities }),
    ...(setup.tournament === undefined ? {} : { tournament: setup.tournament }),
    ...(setup.teamNames === undefined ? {} : { teamNames: setup.teamNames }),
    ruleset: applySettings(defaultConfigBundle.ruleset, setup.settings),
    ...(record ? { record: new RecordingUpload().write } : {}),
  });
}

/** A new seat's bot, at the server's default level. */
export const DEFAULT_BOT = defaultConfigBundle.server.botLevel;

export const DEFAULT_PLAYERS = 3;

export function localSession(match: LocalMatch, rematch: (() => void) | null = null): Session {
  // Not advancing is the whole of a local pause: the bots think inside `advance`, and a
  // recording gains a line only for a tick that was stepped.
  let pausedBy: number | null = null;
  return {
    get state() {
      return match.state;
    },
    humanPlayer: match.humanPlayer,
    get tickFraction() {
      return match.tickFraction;
    },
    get finished() {
      return match.finished;
    },
    advance: (ms) => (pausedBy === null ? match.advance(ms * timeScale) : []),
    submit: (action) => {
      if (pausedBy === null) void match.submit(action);
    },
    get pausedBy() {
      return pausedBy;
    },
    setPaused: (paused) => {
      pausedBy = paused && !match.finished ? match.humanPlayer : null;
    },
    setups: match.setups,
    status: () => (match.humanPlayer < 0 ? t('watching.status') : ''),
    network: () => null,
    leave: () => undefined,
    rematch: rematch === null ? null : 'mine',
    requestRematch: () => rematch?.(),
  };
}

export function networkSession(
  match: NetworkMatch,
  connection: ServerConnection,
  watching = false,
  setups: ReadonlyMap<number, BotSetup> = new Map(),
  isHost: () => boolean = () => false,
): Session {
  return {
    setups,
    get state() {
      if (match.state === null) throw new Error('match has no state yet');
      return match.state;
    },
    get humanPlayer() {
      return watching ? -1 : match.humanPlayer;
    },
    get tickFraction() {
      return match.tickFraction;
    },
    get finished() {
      return match.finished;
    },
    advance: (ms) => match.advance(ms),
    submit: (action) => {
      // The server drops a move made while paused; not sending it saves the trip.
      if (match.pausedBy === null) match.submit(action);
    },
    get pausedBy() {
      return match.pausedBy;
    },
    setPaused: (paused) => match.requestPause(paused),
    status: () =>
      match.lastRejection === null ? '' : t(`rejection.${match.lastRejection}` as const),
    network: () => ({
      latencyMs: connection.latencyMs,
      behind: match.behind,
      desynced: match.desynced,
    }),
    leave: () => connection.close(),
    get rematch() {
      return isHost() ? 'mine' : 'host';
    },
    requestRematch: () => connection.send({ type: 'rematch' }),
  };
}

/** `?rounds=N`, ignored when it is outside what a host could choose. */
export function settingsFromParams(): MatchSettings {
  const rounds = Number(params.get('rounds') ?? DEFAULT_SETTINGS.maxRounds);
  return mergeSettings(DEFAULT_SETTINGS, { maxRounds: rounds }, SETTING_BOUNDS) ?? DEFAULT_SETTINGS;
}
