import {
  applySettings,
  artForStyle,
  chooseStyle,
  stylesFor,
  defaultArtConfig,
  defaultConfigBundle,
  defaultSettings,
  defaultTeams,
  MAX_LEVEL,
  MIN_LEVEL,
  mergeSettings,
  parsePersonality,
  reshapeTable,
  validateConfigBundle,
  type ArtLook,
  type ArtStyle,
  type ArtStyles,
  type BotSetup,
  type MatchSettings,
  type Personality,
  type Table,
} from '@rampart/config';
import {
  PHASES,
  computeEnclosure,
  owesCastleChoice,
  type Action,
  type MatchEvent,
  type MatchState,
  type Phase,
} from '@rampart/sim';

import { Audio } from './audio.js';
import { countdownBeat, showsClock } from './clock.js';
import { Controls, inputMode, readyCannons } from './controls.js';
import { bannersFor, type LifeLost, type PointsGained } from './banners.js';
import { matchPalette, playerCssColour, useMatchPalette } from './colours.js';
import { matchShapes, playerShape, useMatchShapes } from './shapes.js';
import { NetworkBadge, type NetworkReading } from './network.js';
import { howToPlaySeen, openHowToPlay } from './howToPlay.js';
import { WatchingStrip } from './watching.js';
import { volumeSliders } from './volume.js';
import { stylePreview } from './stylePreview.js';
import { escape, lobbyMarkup, type LobbyView } from './lobby.js';
import { REFRESH_MS, gamesMarkup, joinRefusedNotice, parseRoomList } from './browser.js';
import { Hud, type IslandBanner } from './hud.js';
import { MatchAudio } from './matchAudio.js';
import { LocalMatch } from './localMatch.js';
import {
  announcementLines,
  announcementTitle,
  isTeamMatch,
  ranking,
  teamLetter,
} from './scores.js';
import { buildHints, type BuildHints } from './hints.js';
import { timerSpot } from './timerSpot.js';
import { SplitTitle, installBackdrop } from './decor.js';
import { MatchLog, botSetupsFromSeats, revealLines } from './summary.js';
import { applyEffects, motionReduced, saveEffects, storedEffects } from './motion.js';
import { PauseControls } from './pause.js';
import { openingShot, winnerShot } from './camera.js';
import { drawPreview, tablePreview } from './preview.js';
import { RecordingUpload } from './recordingUpload.js';
import {
  floodFrom,
  floodOver,
  sealGlow,
  drainWash,
  drainsFrom,
  releaseDrains,
  territoryDuring,
  type Flood,
  type SealGlow,
} from './seal.js';
import {
  bannerProgress,
  boardWithStanding,
  crumbleOutward,
  looksAround,
  lostWalls,
  holdsCombatEnclosure,
  stillStanding,
  type Look,
  type Ruin,
  type SweptWall,
} from './transition.js';
import { ServerConnection } from './net/connection.js';
import { NetworkMatch } from './net/networkMatch.js';
import type { RoomListing, ServerMessage } from '@rampart/protocol';
import { Scene, createTheme, type Ghost, type SceneLook } from './render/scene.js';
import type { Choice } from './render/theme.js';

/**
 * Rampart client.
 *
 * A match is played either locally against stopgap opponents or against an
 * authoritative server. Both drive the same renderer, controls and HUD through one
 * session interface, so the netcode changes where the state comes from and nothing
 * about how the game is presented.
 */

const problems = validateConfigBundle(defaultConfigBundle);
if (problems.length > 0) {
  throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
}

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app');
installBackdrop(defaultConfigBundle.art);
applyEffects();

/** Surfaces failures on the page: a renderer that throws otherwise looks like a black screen. */
function showError(source: string, detail: unknown): void {
  const message =
    detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : String(detail);
  const box = document.createElement('pre');
  box.className = 'crash';
  box.textContent = `${source}\n\n${message}`;
  app?.replaceChildren(box);
}
globalThis.addEventListener('error', (event) =>
  showError('Uncaught error', event.error ?? event.message),
);
globalThis.addEventListener('unhandledrejection', (event) =>
  showError('Unhandled rejection', event.reason),
);

/**
 * Sound, shared by the menu and every match.
 *
 * A browser will not start an audio context without a user gesture, so the first
 * click or keypress anywhere is what switches it on — the menu's own buttons are
 * usually that gesture, but `?autostart=1` skips the menu entirely and then the first
 * input in the match does it instead.
 */
const audio = new Audio(defaultConfigBundle.audio);
const unlock = (): void => audio.unlock();
globalThis.addEventListener('pointerdown', unlock, { capture: true });
globalThis.addEventListener('keydown', unlock, { capture: true });

/**
 * A sound switch on every screen, showing whether sound is on. Mute is remembered by the
 * browser, so without it a mute set once — as the old M key did whenever a name with an
 * "m" was typed in the lobby — silenced every later visit with nothing on screen to say
 * so, and nothing outside a match to undo it.
 */
/** Brings the corner switch up to date, for when the pause menu changes the sound. */
let showSoundButton: () => void = () => undefined;

function installSoundButton(): void {
  const button = document.createElement('button');
  button.id = 'sound';
  const show = (): void => {
    button.textContent = audio.isMuted ? 'Sound off' : 'Sound on';
    button.classList.toggle('off', audio.isMuted);
    button.setAttribute('aria-pressed', String(!audio.isMuted));
  };
  button.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted);
    show();
  });
  show();
  showSoundButton = show;
  document.body.append(button);
}
installSoundButton();

const params = new URLSearchParams(globalThis.location.search);

/** Where the menu remembers the two looks, so they survive a reload. */
const STYLES_KEY = 'rampart.styles';

/** What the menu saved, unchecked: `chooseStyle` decides whether each is still usable. */
function storedStyles(): Partial<Record<ArtLook, unknown>> {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(STYLES_KEY) ?? '{}');
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

/**
 * The look for building and the look for combat. `?style=` sets both, which is what the
 * screenshot script and older links mean by it; `?buildStyle=` and `?combatStyle=` set
 * one each. Then what the menu last saved, then the configured default pair — each only
 * if it is a style made for that look, so `?style=` naming a combat-only style changes
 * combat and leaves building alone.
 */
function preferredStyles(): ArtStyles {
  const stored = storedStyles();
  const fallback = defaultArtConfig.styles;
  const both = params.get('style');
  return {
    build: chooseStyle('build', [params.get('buildStyle'), both, stored.build], fallback.build),
    combat: chooseStyle(
      'combat',
      [params.get('combatStyle'), both, stored.combat],
      fallback.combat,
    ),
  };
}
const timeScale = Math.max(1, Number(params.get('speed') ?? 1));

/** A seed from the browser's own entropy, for a table nobody has asked a map of. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

/**
 * The map for a new table: `?seed=N` when testing wants a particular one, otherwise a
 * fresh random one every time a lobby opens.
 */
function chosenSeed(): number {
  const asked = params.get('seed');
  const n = Number(asked);
  return asked !== null && Number.isInteger(n) && n >= 0 ? n >>> 0 : randomSeed();
}

/** What the render loop needs, whichever way the match is being played. */
interface Session {
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

// ------------------------------------------------------------------------ menu

interface Setup {
  /** One per seat: null for the person, otherwise the bot's skill. */
  /** One per seat: null for the person, otherwise the bot's level, 1 to 10. */
  seats: (number | null)[];
  seed: number;
  styles: ArtStyles;
  name: string;
  /** The host's choices, offline as online, so a round limit can be felt out alone. */
  settings: MatchSettings;
  /** Each seat's team, by seat. Omitted, free-for-all. */
  teams?: readonly number[];
}

const SETTING_BOUNDS = defaultConfigBundle.server.lobbySettings;
const DEFAULT_SETTINGS = defaultSettings(defaultConfigBundle.ruleset, SETTING_BOUNDS);

/** `?personality=offensive` and the like: every bot of a local match plays it (PLAN 11.6). */
const FIXED_PERSONALITY: Personality | null =
  params.get('personality') === null ? null : parsePersonality(params.get('personality') ?? '');

/**
 * An offline match on the default rules with the menu's settings over them, recorded
 * for tuning unless `record` is false — a dev shortcut into a phase is not a match
 * anyone played. The recording goes to the server the page came from; see
 * `recordingUpload.ts`.
 */
function localMatchFor(setup: Setup, record = true): LocalMatch {
  return new LocalMatch({
    seed: setup.seed,
    seats: setup.seats,
    // ?personality= fixes every bot's, for testing; otherwise each is dealt from the seed.
    ...(FIXED_PERSONALITY === null ? {} : { personality: FIXED_PERSONALITY }),
    ...(setup.teams === undefined ? {} : { teams: setup.teams }),
    ruleset: applySettings(defaultConfigBundle.ruleset, setup.settings),
    ...(record ? { record: new RecordingUpload().write } : {}),
  });
}

/** A new seat's bot, at the server's default level. */
const DEFAULT_BOT = defaultConfigBundle.server.botLevel;

/** Height of the HUD's top bar — the phase, timer and roster — kept clear of the board. */
const HUD_BAR_PX = 64;

const DEFAULT_PLAYERS = 3;

/** What the menu gathers before a table is set: who you are and how it looks. */
interface Common {
  name: string;
  styles: ArtStyles;
  /** Whether a table this player opens is listed in the games browser. */
  isPublic: boolean;
}

/** The menu's two style choices, saved for next time as they are read. */
function readStyles(): ArtStyles {
  const fallback = preferredStyles();
  const styles: ArtStyles = {
    build: chooseStyle(
      'build',
      [document.querySelector<HTMLSelectElement>('#build-style')?.value],
      fallback.build,
    ),
    combat: chooseStyle(
      'combat',
      [document.querySelector<HTMLSelectElement>('#combat-style')?.value],
      fallback.combat,
    ),
  };
  try {
    globalThis.localStorage?.setItem(STYLES_KEY, JSON.stringify(styles));
  } catch {
    // Storage refused, as in some private windows: the choice holds for this match only.
  }
  return styles;
}

/** Names for the styles, as the menu offers them, each look only those made for it. */
const STYLE_NAMES: Record<ArtStyle, string> = {
  flat: 'Minimal',
  pixel: 'Medieval',
  night: 'Night',
  cyberpunk: 'Cyberpunk',
  blueprint: 'Blueprint',
  parchment: 'Parchment',
  bricks: 'Toy bricks',
  glass: 'Stained glass',
};

function styleOptions(look: ArtLook): string {
  return stylesFor(look)
    .map((style) => `<option value="${style}">${STYLE_NAMES[style]}</option>`)
    .join('');
}

/** Where the menu remembers the player's name, as it does the looks. */
const NAME_KEY = 'rampart.name';

function storedName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY)?.trim() || 'Player';
  } catch {
    return 'Player';
  }
}

function readCommon(): Common {
  const name = document.querySelector<HTMLInputElement>('#name')?.value.trim() || 'Player';
  try {
    globalThis.localStorage?.setItem(NAME_KEY, name);
  } catch {
    // Storage refused, as in some private windows: the name holds for this visit only.
  }
  const isPublic =
    document.querySelector<HTMLButtonElement>('#visibility')?.dataset.public !== 'false';
  return { styles: readStyles(), name, isPublic };
}

/**
 * Keeps the menu's list of open games current while the menu is up: asks at once and
 * every few seconds, and stops by itself once the menu has gone. Without a server, or with
 * one this page cannot join, the section stays hidden.
 */
function watchOpenGames(): void {
  const section = document.querySelector<HTMLElement>('#open-games-section');
  const list = document.querySelector<HTMLElement>('#open-games');
  if (!section || !list) return;
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.join-open');
    const code = button?.dataset.code;
    if (code === undefined) return;
    audio.play('select');
    void openLobby(readCommon(), code).catch((e: unknown) => showError('Could not join', e));
  });
  let shown = '';
  const refresh = async (): Promise<void> => {
    let rooms: RoomListing[] | null;
    try {
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      rooms = parseRoomList(await response.json());
    } catch {
      rooms = null;
    }
    if (!section.isConnected) return;
    section.hidden = rooms === null;
    const html = rooms === null ? '' : gamesMarkup(rooms);
    // Only when it changed, so a Join button is not replaced under a pressed mouse.
    if (html !== shown) list.innerHTML = shown = html;
  };
  void refresh();
  const timer = setInterval(() => {
    if (section.isConnected) void refresh();
    else clearInterval(timer);
  }, REFRESH_MS);
}

/**
 * The menu: only who you are and how the game looks. Everything about the table —
 * players, teams, bots, rounds — is set in the lobby, which is one screen whether or
 * not a server is there.
 */
function showMenu(notice: string | null = null): void {
  audio.music('music_menu');
  app!.innerHTML = `
    <div class="menu">
      <h1 class="title"><span class="title-split" id="title"></span></h1>
      <p>Shoot down their walls. Rebuild yours before the next barrage.
         Fail to seal a castle and you lose a life.</p>
      <label>Name <input id="name" type="text" maxlength="16" value="Player" /></label>
      <label class="look">Building look <img id="build-preview" class="style-preview" alt="" /><select id="build-style">${styleOptions('build')}</select></label>
      <label class="look">Combat look <img id="combat-preview" class="style-preview" alt="" /><select id="combat-style">${styleOptions('combat')}</select></label>
      <label>Effects <select id="effects"><option value="high">Glowing</option><option value="full">Standard</option><option value="reduced">Reduced</option></select></label>
      <div class="split play-row">
        <button id="play">Play</button>
        <button id="visibility" data-public="true" title="Public tables are listed under Open games; a private one is joined by its code alone">Public</button>
      </div>
      <button id="how-to-play" class="quiet${howToPlaySeen() ? '' : ' fresh'}">How to play</button>
      <div class="split">
        <input id="code" type="text" maxlength="8" placeholder="room code" />
        <button id="join">Join</button>
      </div>
      <p class="note">Play sets a table others can join — from the list below if it is
        public, by its code either way. If nobody does, the match runs on this computer.</p>
      <section id="open-games-section" class="open-games-section"${notice === null ? ' hidden' : ''}>
        <h2>Open games</h2>
        ${notice === null ? '' : `<p class="notice">${escape(notice)}</p>`}
        <div id="open-games"></div>
      </section>
    </div>
  `;
  // Public or private, chosen as the table is made: a switch beside Play.
  const visibility = document.querySelector<HTMLButtonElement>('#visibility');
  visibility?.addEventListener('click', () => {
    audio.play('select');
    const isPublic = visibility.dataset.public === 'false';
    visibility.dataset.public = String(isPublic);
    visibility.textContent = isPublic ? 'Public' : 'Private';
  });
  watchOpenGames();
  // The banners either side of combat swap one look for the other as they cross the
  // board, as the original did; the same style for both switches nothing.
  const styles = preferredStyles();
  // Set as a property rather than written into the markup, so a saved name needs no escaping.
  const nameField = document.querySelector<HTMLInputElement>('#name');
  if (nameField) nameField.value = storedName();
  const buildField = document.querySelector<HTMLSelectElement>('#build-style');
  if (buildField) buildField.value = styles.build;
  const combatField = document.querySelector<HTMLSelectElement>('#combat-style');
  if (combatField) combatField.value = styles.combat;
  const effectsField = document.querySelector<HTMLSelectElement>('#effects');
  // The two volumes, under the looks and Effects (PLAN 11.18 Y4).
  effectsField?.closest('label')?.after(volumeSliders(audio));
  if (effectsField) {
    effectsField.value = storedEffects();
    effectsField.addEventListener('change', () =>
      saveEffects(
        effectsField.value === 'reduced' || effectsField.value === 'high'
          ? effectsField.value
          : 'full',
      ),
    );
  }

  // The title in both chosen looks at once, split by a banner's line that sweeps across
  // as either choice changes — what the two choices mean, shown rather than said.
  const titleRoot = document.querySelector<HTMLElement>('#title');
  if (titleRoot) {
    const title = new SplitTitle(titleRoot, defaultConfigBundle.art);
    const chosen = (): Record<ArtLook, ArtStyle> => ({
      build: chooseStyle('build', [buildField?.value], styles.build),
      combat: chooseStyle('combat', [combatField?.value], styles.combat),
    });
    title.show(chosen());
    title.sweep();
    title.repeat();
    for (const field of [buildField, combatField]) {
      field?.addEventListener('change', () => title.show(chosen()));
    }
  }

  // A picture of each chosen look beside its choice (PLAN 11.16 S1), drawn by the style's
  // own theme. After the title's first sweep, so building the pictures cannot stutter it.
  for (const [field, id] of [
    [buildField, '#build-preview'],
    [combatField, '#combat-preview'],
  ] as const) {
    const image = document.querySelector<HTMLImageElement>(id);
    if (field === null || image === null) continue;
    const show = (): void => {
      const style = field.value as ArtStyle;
      image.classList.remove('ready');
      void stylePreview(style).then(
        (url) => {
          // Only if the choice still stands: a slow picture must not replace a newer one.
          if (field.value !== style) return;
          image.src = url;
          image.classList.add('ready');
        },
        () => undefined,
      );
    };
    field.addEventListener('change', show);
    setTimeout(show, defaultConfigBundle.art.menu.titleSweepMs);
  }

  document.querySelector('#play')?.addEventListener('click', () => {
    audio.play('select');
    void openLobby(readCommon(), null).catch((e: unknown) =>
      showError('Could not open a table', e),
    );
  });
  // How to play (PLAN 11.16 H1): pages of pictures over the menu, marked until first opened.
  const howTo = document.querySelector<HTMLButtonElement>('#how-to-play');
  howTo?.addEventListener('click', () => {
    audio.play('select');
    howTo.classList.remove('fresh');
    howTo.blur();
    openHowToPlay(undefined, () => audio.play('select'));
  });
  document.querySelector('#join')?.addEventListener('click', () => {
    audio.play('select');
    const code = document.querySelector<HTMLInputElement>('#code')?.value.trim() ?? '';
    if (code.length === 0) return;
    void openLobby(readCommon(), code).catch((e: unknown) => showError('Could not join', e));
  });
}

function localSession(match: LocalMatch, rematch: (() => void) | null = null): Session {
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
    status: () => (match.humanPlayer < 0 ? 'watching' : ''),
    network: () => null,
    leave: () => undefined,
    rematch: rematch === null ? null : 'mine',
    requestRematch: () => rematch?.(),
  };
}

// ----------------------------------------------------------------------- lobby

const TOKEN_KEY = 'rampart.seat';

/** How long to wait for a server before setting the table locally instead. */
const SERVER_WAIT_MS = 2000;

/** What the lobby's controls do, whichever backend is behind them. */
interface LobbyHandlers {
  table(change: { settings?: MatchSettings; playerCount?: number; teams?: number[] }): void;
  bot(seat: number, level: number): void;
  /** A new map: a seed typed in, or a fresh random one. */
  seed(seed: number): void;
  /** A bot to play the host's own seat while they watch, or null to play it. */
  hostBot(level: number | null): void;
  /** The person in seat `from` to seat `to`, swapping with whoever sits there. */
  move(from: number, to: number): void;
  start(): void;
}

/** Draws the lobby and wires its controls to whichever backend holds the table. */
function drawLobby(view: LobbyView, on: LobbyHandlers): void {
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
  // will open; the seat cards keep the shared colours, which read on the lobby's panel.
  const look = artForStyle(art, preferredStyles().build);
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
  const copy = document.querySelector<HTMLButtonElement>('#copy-code');
  copy?.addEventListener('click', () => {
    audio.play('select');
    const code = view.code ?? '';
    const copied = (): void => {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    };
    // The old way, still honoured over plain http: select the code and copy the selection.
    // Failing that, it is left selected so it can be copied by hand.
    const bySelection = (): void => {
      const node = document.querySelector('#room-code');
      if (node) globalThis.getSelection()?.selectAllChildren(node);
      let ok: boolean;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (ok) copied();
      else copy.textContent = 'Select and copy';
    };
    if (globalThis.isSecureContext && navigator.clipboard !== undefined) {
      navigator.clipboard.writeText(code).then(copied, bySelection);
    } else {
      bySelection();
    }
  });
  document.querySelector('#begin')?.addEventListener('click', () => {
    audio.play('select');
    on.start();
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
    showError('Failed to start match', error),
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
async function openLobby(
  common: Common,
  code: string | null,
  playerCount = DEFAULT_PLAYERS,
): Promise<void> {
  const seed = chosenSeed();
  app!.innerHTML = `<div class="menu"><h1>Setting the table</h1><p class="note">Looking for a server…</p></div>`;
  const connection = new ServerConnection(ServerConnection.defaultUrl());
  const answered = new Promise<ServerMessage | null>((resolve) => {
    connection.onMessage((message) => {
      if (message.type === 'welcome' || message.type === 'error') resolve(message);
    });
    setTimeout(() => resolve(null), SERVER_WAIT_MS);
  });
  connection.connect().catch(() => undefined);

  const stored = sessionStorage.getItem(TOKEN_KEY)?.split(':') ?? [];
  if (code === null) connection.createRoom(common.name, playerCount, common.isPublic);
  else if (stored[0] === code.toUpperCase() && stored[1])
    connection.joinRoom(common.name, code, stored[1]);
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
    showError(`Server refused: ${first.code}`, first.message);
    return;
  }
  if (code !== null) {
    showError('Could not join', `no server answered at ${ServerConnection.defaultUrl()}`);
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
  let started = false;
  /** Takes the match down, for a rematch bringing the room back to its lobby. */
  let endMatch: (() => void) | null = null;

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
    const current = view;
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
    });
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
        sessionStorage.setItem(TOKEN_KEY, `${message.code}:${message.token}`);
        break;
      case 'room': {
        hostId = message.hostId;
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
      case 'snapshot':
        if (!started) {
          started = true;
          // A host who gave their seat to a bot watches it play, whoever else is here.
          const watching =
            view !== null && view.hostBot !== null && match.humanPlayer === view.hostId;
          // Each seat's bot level, or null for a person, in lobby order — what the room
          // dealt the islands and personalities from — so the reveal can name every bot.
          const seats = Array.from({ length: table?.playerCount ?? 0 }, (_, seat) => {
            const person = table?.seats.some((s) => s.playerId === seat) ?? false;
            if (!person) return table?.bots[seat] ?? DEFAULT_BOT;
            return seat === table?.hostId && table.hostBot !== null ? table.hostBot : null;
          });
          const seed = table?.seed ?? view?.seed ?? 0;
          const setup: Setup = { ...common, seed, seats, settings: DEFAULT_SETTINGS };
          const setups = botSetupsFromSeats(seed, seats);
          void runSession(
            networkSession(match, connection, watching, setups, () => match.humanPlayer === hostId),
            setup,
          ).then(
            (end) => (endMatch = end),
            (e: unknown) => showError('Match failed', e),
          );
        }
        break;
      case 'error':
        showError(`Server refused: ${message.code}`, message.message);
        break;
      default:
        break;
    }
  });

  // The welcome that decided there was a server arrived before this listener did.
  match.receive(welcome);
  roomCode = welcome.code;
  hostId = welcome.hostId;
  sessionStorage.setItem(TOKEN_KEY, `${welcome.code}:${welcome.token}`);

  // Until the connection closes — left running, every lobby opened in the page went on
  // queueing a ping every two seconds for a socket that would never send them.
  const pinging = setInterval(() => {
    if (connection.state === 'closed') clearInterval(pinging);
    else connection.ping();
  }, 2000);
}

function networkSession(
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
    status: () => (match.lastRejection === null ? '' : match.lastRejection.replace(/_/g, ' ')),
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

// ------------------------------------------------------------------ match loop

/**
 * Resolves once what is on the page has been painted: a frame for the layout, and the one
 * after it, by which the browser has drawn it — so work that holds the page afterwards
 * holds it with this on screen, not the screen before.
 */
function shownOnScreen(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** Plays a session; resolves with what takes it down, once it is running. */
async function runSession(session: Session, setup: Setup): Promise<() => void> {
  // Over the board until its first frame (PLAN 11.18 Y1): building both looks' sprites
  // takes about a second as a match opens, and more with every look added, which read as
  // the page freezing. Painted before that work starts, so it is on screen through it.
  app!.innerHTML =
    `<canvas id="stage"></canvas><div id="hud"></div><div id="banner"></div>` +
    `<div id="preparing" class="preparing"><p>Preparing the board</p><span class="blocks"><i></i><i></i><i></i></span></div>`;
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  const hudRoot = document.querySelector<HTMLElement>('#hud');
  const bannerRoot = document.querySelector<HTMLElement>('#banner');
  const preparing = document.querySelector<HTMLElement>('#preparing');
  if (!canvas || !hudRoot || !bannerRoot) throw new Error('missing stage');
  await shownOnScreen();

  const scene = new Scene();
  // Colours for this match: families by team in a team match, distinct otherwise. The
  // HUD takes the shared ramps, and each look its own style's restyling of them.
  const art = defaultConfigBundle.art;
  useMatchPalette(matchPalette(art, session.state));
  useMatchShapes(matchShapes(art, session.state));
  const lookFor = (style: ArtStyle): SceneLook => {
    const own = artForStyle(art, style);
    return {
      theme: createTheme(style, setup.seed),
      art: { ...own, players: matchPalette(own, session.state) },
    };
  };
  // One theme when both looks are the same style, so the wipe has nothing to change.
  const build = lookFor(setup.styles.build);
  const combat = setup.styles.combat === setup.styles.build ? build : lookFor(setup.styles.combat);
  await scene.init(canvas, { build, combat }, art);

  const hud = new Hud(hudRoot, bannerRoot);
  // What the end of the match summarises, kept from the events as they come.
  const matchLog = new MatchLog();
  hud.useLog(matchLog);
  hud.useReveal(revealLines(session.state, session.setups));
  const matchAudio = new MatchAudio(audio, session.humanPlayer);

  /**
   * Middle of each player's island, for the banners that sit over them.
   *
   * The island, not the territory: by the time a "life lost" banner shows, the wipe has
   * already taken the territory away, so there would be nothing to anchor to. Islands
   * never move, so this is measured once.
   */
  const islandCentre = new Map<number, { x: number; y: number }>();
  {
    const sums = new Map<number, { x: number; y: number; n: number }>();
    const board = session.state;
    for (let i = 0; i < board.islandId.length; i++) {
      const island = board.islandId[i] as number;
      if (island === 0) continue;
      const x = i % board.width;
      const entry = sums.get(island) ?? { x: 0, y: 0, n: 0 };
      entry.x += x;
      entry.y += (i - x) / board.width;
      entry.n++;
      sums.set(island, entry);
    }
    for (const player of board.players) {
      const sum = sums.get(player.islandId);
      if (sum !== undefined) islandCentre.set(player.id, { x: sum.x / sum.n, y: sum.y / sum.n });
    }
  }

  /** Lives lost, and the tick each announcement stops being news. */
  const livesLost = new Map<number, LifeLost>();
  const gained = new Map<number, PointsGained>();
  /** What the board points out to a player building; see `hints.ts`. */
  let hints: BuildHints = { unsealed: [] };

  // The top left of each island, for its team's letter; terrain never changes. Not the
  // top middle, which is where the big timer sits on the islands in the middle column.
  const islandTops = new Map<number, { x: number; y: number }>();
  if (isTeamMatch(session.state)) {
    const { width, islandId } = session.state;
    for (const player of session.state.players) {
      let top = Number.POSITIVE_INFINITY;
      let left = Number.POSITIVE_INFINITY;
      let right = -1;
      for (let i = 0; i < islandId.length; i++) {
        if (islandId[i] !== player.islandId) continue;
        const x = i % width;
        top = Math.min(top, (i - x) / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      if (right >= 0) islandTops.set(player.id, { x: left + 3, y: top });
    }
  }

  function drawIslandBanners(): void {
    hud.showTeamTags(
      [...islandTops].map(([player, at]) => ({
        player,
        text: `Team ${teamLetter(session.state.players[player]?.team ?? 0)}`,
        colour: playerCssColour(player),
        ...scene.screenAt(at.x, at.y - 0.3),
      })),
    );
    const banners: IslandBanner[] = [];
    for (const banner of bannersFor(session.state, livesLost, gained)) {
      const centre = islandCentre.get(banner.player);
      if (centre === undefined) continue;
      banners.push({
        ...banner,
        holdMs: defaultConfigBundle.art.hud.pointsBannerMs,
        colour: playerCssColour(banner.player),
        ...scene.screenAt(centre.x, centre.y),
      });
    }
    hud.showIslandBanners(banners);
  }
  const controls = new Controls(
    canvas,
    scene,
    session.state,
    session.humanPlayer,
    (action) => {
      session.submit(action);
    },
    // Rotating and a refused placement are the two things the player does that the
    // simulation never hears about, so they are cued here rather than from an event.
    (cue) => audio.play(cue),
  );
  // Nobody at the keyboard in a watched match, so there is nothing to listen for.
  if (session.humanPlayer >= 0) controls.attach();

  /**
   * Walls the sim swept at the last resolution that the banner has not yet reached; see
   * `transition.ts`. Owners are read from the board as last drawn, because the sweep
   * has already zeroed them in the state.
   */
  let swept: SweptWall[] = [];
  /** The owner layer as last drawn, for exactly that. */
  let drawnOwner = session.state.owner.slice();

  /** Walls, castles and cannons, with any swept wall still standing put back. */
  /**
   * Walls lost with a life, crumbling outward from the middle of the island; see
   * `crumbleOutward`. Drawn standing until each one's moment comes.
   */
  let ruins: Ruin[] = [];
  /** The structure layer as last drawn, beside the owners, to find what a wipe took. */
  let drawnStructure = session.state.structure.slice();

  /** Walls, castles and cannons, with any swept or ruined wall still standing put back. */
  function drawBoard(): void {
    const board = boardWithStanding(session.state, [...swept, ...ruins]);
    scene.drawStructures({ ...session.state, ...board });
    drawnOwner = board.owner.slice();
    drawnStructure = board.structure.slice();
  }

  /** Takes down each ruined block as its moment comes. */
  function crumbleRuins(): void {
    if (ruins.length === 0) return;
    const now = performance.now();
    const falling = ruins.filter((ruin) => ruin.dueMs <= now);
    if (falling.length === 0) return;
    const width = session.state.width;
    for (const ruin of falling) {
      const x = ruin.index % width;
      scene.noteCrumble({ x, y: (ruin.index - x) / width, owner: ruin.owner - 1 });
    }
    ruins = ruins.filter((ruin) => ruin.dueMs > now);
    drawBoard();
  }

  /** Castles chosen lately, for the burst each choice sets off; see `drawChoices`. */
  let choices: { castleId: number; owner: number; at: number }[] = [];

  /** The board's enclosure as it stands, for display; see `Scene.drawTerritory`. */
  let live = computeEnclosure(session.state);
  /**
   * The enclosure as combat began, held for the combat look and the HUD until building
   * begins (`holdsCombatEnclosure`); null outside that. A breach counts for nothing until
   * then, so nothing that says "sealed" should come down with the wall.
   */
  let held: ReturnType<typeof computeEnclosure> | null = null;
  /** One style for both looks: one set of layers, which shows the held board in combat. */
  const oneLook = setup.styles.build === setup.styles.combat;
  /** The enclosure a look shows. */
  const enclosureFor = (look: Look): ReturnType<typeof computeEnclosure> =>
    held !== null && (look === 'combat' || oneLook) ? held : live;

  /**
   * Newly sealed ground flooding out from its castle; see `seal.ts`. Started whenever
   * the enclosure gains territory — a breach closed, a castle chosen, a loop widened —
   * and drawn in both looks, since it shows exactly what was sealed.
   */
  let floods: Flood[] = [];
  const { sealFloodTilesPerSecond, sealGlowTiles, drainTilesPerSecond } =
    defaultConfigBundle.art.effects;

  /**
   * Ground lost to breaches draining away (`drainsFrom`), in the build look — the
   * enclosure combat began with against the board as it stands. Each island's drain
   * starts as the "Rebuild" banner's line reaches it (`releaseDrains`). With one style
   * for both looks the held board stays up until building begins, so the drains wait for
   * that: `drainDue` keeps the held enclosure until then.
   */
  let drains: Flood[] = [];
  let drainDue: ReturnType<typeof computeEnclosure> | null = null;
  function startDrain(from: ReturnType<typeof computeEnclosure>): void {
    drains.push(...drainsFrom(from.territory, live.territory, live.outside, session.state.width));
  }
  function advanceDrains(now: number) {
    if (drainDue !== null && session.state.phase === 'build') {
      startDrain(drainDue);
      drainDue = null;
      releaseDrains(drains, Number.POSITIVE_INFINITY, session.state.width, now);
    }
    if (drains.length === 0) return [];
    drains = drains.filter((drain) => !floodOver(drain, now, drainTilesPerSecond, 1));
    return drainWash(drains, now, session.state.width, drainTilesPerSecond);
  }

  /** Territory as each look shows it; the live board less what the floods have not reached. */
  function drawFloodedTerritory(now: number): void {
    const flooded = territoryDuring(live.territory, floods, now, sealFloodTilesPerSecond);
    scene.drawTerritory(session.state, {
      build: enclosureFor('build') === live ? flooded : enclosureFor('build').territory,
      combat: enclosureFor('combat') === live ? flooded : enclosureFor('combat').territory,
    });
  }

  const fit = (): void => {
    scene.resize(session.state, globalThis.innerWidth, globalThis.innerHeight, HUD_BAR_PX);
    scene.drawTerrain(session.state);
    drawFloodedTerritory(performance.now());
    drawBoard();
  };
  fit();
  globalThis.addEventListener('resize', fit);

  // No hidden keys: the end screen has a button back to the menu, and sound its switch in
  // the corner. R once did the first and M the second, unannounced, at the user's request
  // removed — a stray key press should not do something nobody was told about.
  const leaveMatch = (): void => {
    audio.play('select');
    session.leave();
    cleanup();
    showMenu();
  };
  hud.onLeave(leaveMatch);
  // Locally the table opens at once; online the host asks, and the room's answer brings
  // every page back to the lobby, this one included.
  hud.useRematch(session.rematch);
  hud.onRematch(() => {
    audio.play('select');
    if (session.network() === null) cleanup();
    session.requestRematch();
  });

  // Anyone may pause, and anyone resume: Esc, or the button beside the Sound switch.
  // Paused, the overlay is the match's menu: the settings, and a way out (PLAN 11.18 Y2).
  const pause = new PauseControls({
    toggle: (paused) => session.setPaused(paused),
    leave: leaveMatch,
    isMuted: () => audio.isMuted,
    setMuted: (muted) => {
      audio.setMuted(muted);
      showSoundButton();
    },
    volumes: audio,
    click: () => audio.play('select'),
  });
  // Beside Pause, online only: the connection, where a player will see it.
  const badge = session.network() === null ? null : new NetworkBadge();
  // Out, and watching, with the way back to the menu (PLAN 11.18 Y3).
  const watching = new WatchingStrip(leaveMatch);

  let frame = 0;
  const cleanup = (): void => {
    cancelAnimationFrame(frame);
    controls.detach();
    pause.destroy();
    badge?.destroy();
    watching.destroy();
    globalThis.removeEventListener('resize', fit);
    scene.app.destroy(true);
  };

  /** The intermission whose banner is showing, by the tick it ends on. */
  let announcedAt: number | null = null;
  /** Set by a resolution, so the announcement after it carries the standings. */
  let resolvedSinceAnnounce = false;

  /**
   * The announcement, and what it does to the board as it crosses: the look beneath
   * changes at its line, and swept walls go as it reaches them. Every frame, from the
   * simulation clock, so the two can never part company.
   */
  function drawTransition(): void {
    const state = session.state;
    const progress = bannerProgress(state, session.tickFraction);
    const { before, after } = looksAround(state);
    let lineY: number | null = null;
    if (progress === null) {
      hud.clearAnnouncement();
      announcedAt = null;
    } else {
      if (announcedAt !== state.phaseEndTick) {
        announcedAt = state.phaseEndTick;
        // "Rebuild": the barrage is over, and what it took drains away as the banner
        // reveals the board — at once in the build look, or as building begins when one
        // style draws both looks and holds the old board until then.
        if (state.pendingPhase === 'build' && held !== null) {
          if (oneLook) drainDue = held;
          else startDrain(held);
        }
        // After a continue the cannon phase opens with a castle to choose, and the
        // announcement should say so rather than tell them to place guns they cannot.
        const human = state.players[session.humanPlayer];
        const choosing =
          state.pendingPhase === 'cannon_place' && human !== undefined && owesCastleChoice(human);
        hud.announce(
          choosing ? 'castle_select' : (state.pendingPhase ?? 'combat'),
          announcementLines(state),
          // Drawn in the look it brings, since it is where the look changes.
          setup.styles[after],
          choosing ? null : announcementTitle(state),
          // The standings after a resolution, counted up from the round before's.
          resolvedSinceAnnounce ? ranking(state, matchLog.scores.at(-2)?.byPlayer ?? null) : [],
        );
        resolvedSinceAnnounce = false;
      }
      lineY = hud.placeAnnouncement(progress);
    }
    hud.useSkin(setup.styles[lineY === null ? before : after]);
    scene.showLooks(
      lineY === null
        ? { from: before, to: before, lineY: null }
        : { from: before, to: after, lineY },
    );
    sweepUnderBanner(lineY);
    // Each island's lost ground drains as the line reaches it; all of it once the
    // banner has gone.
    if (drains.length > 0 && !oneLook) {
      releaseDrains(
        drains,
        state.phase !== 'intermission' || lineY === null
          ? Number.POSITIVE_INFINITY
          : scene.rowAt(lineY),
        state.width,
        performance.now(),
      );
    }
  }

  /** Takes away each swept wall as the banner's line passes it. */
  function sweepUnderBanner(lineY: number | null): void {
    if (swept.length === 0) return;
    // Any banner will do — normally "Place cannons", but "Fire!" when nobody had guns
    // to place — and once the intermission is over, whatever is left goes.
    const over = session.state.phase !== 'intermission';
    const lineRow = over
      ? Number.POSITIVE_INFINITY
      : lineY === null
        ? Number.NEGATIVE_INFINITY
        : scene.rowAt(lineY);
    const standing = stillStanding(swept, session.state.width, lineRow);
    if (standing.length === swept.length) return;
    const width = session.state.width;
    const kept = new Set(standing.map((wall) => wall.index));
    for (const wall of swept) {
      if (kept.has(wall.index)) continue;
      const x = wall.index % width;
      scene.noteCrumble({ x, y: (wall.index - x) / width, owner: wall.owner - 1 });
    }
    swept = standing;
    drawBoard();
  }

  /** Open water near the middle, for the big timer. Terrain is fixed, so asked once. */
  const bigTimerAt = timerSpot(session.state);
  const TIMED: readonly Phase[] = ['castle_select', 'cannon_place', 'build', 'combat'];

  /** The big timer, and the ready count beside the aiming cursor. */
  function drawCounters(ghost: Ghost): void {
    const state = session.state;
    if (bigTimerAt !== null && TIMED.includes(state.phase) && showsClock(state)) {
      const centre = scene.screenAt(bigTimerAt.x - 0.5, bigTimerAt.y - 0.5);
      const edge = scene.screenAt(bigTimerAt.x - 0.5 + bigTimerAt.size, bigTimerAt.y - 0.5);
      const seconds = Math.max(
        0,
        Math.ceil((state.phaseEndTick - state.tick) / state.ruleset.tickRateHz),
      );
      hud.showBigTimer({ ...centre, sizePx: edge.x - centre.x }, seconds);
    } else {
      hud.showBigTimer(null, 0);
    }
    // Beside the cursor, the number that decides the next click: guns ready when
    // aiming, guns still to place when placing them.
    const mode = inputMode(state, session.humanPlayer);
    const count =
      mode === 'fire' || mode === 'aim'
        ? readyCannons(state, session.humanPlayer)
        : mode === 'cannon'
          ? (state.players[session.humanPlayer]?.cannonsToPlace ?? 0)
          : null;
    hud.showReadyCount(
      ghost.tile !== null && count !== null
        ? scene.screenAt(ghost.tile.x + 1.4, ghost.tile.y - 1.1)
        : null,
      count ?? 0,
    );
  }

  /**
   * The tally at a resolution: a glow sweeping each scoring island's territory outward
   * from its castles while its points count up, timed to finish together (`tallyMs`).
   * Glow only — the ground is already held, so nothing is hidden.
   */
  let tallies: { flood: Flood; speed: number }[] = [];
  /** Players whose points were just banked, tallied once the enclosure is refreshed. */
  const tallyDue: number[] = [];

  function startTallies(now: number): void {
    const { width, castles } = session.state;
    const empty = new Uint8Array(live.territory.length);
    for (const player of tallyDue.splice(0)) {
      const theirs = live.territory.map((owner) => (owner === player + 1 ? owner : 0));
      const flood = floodFrom(empty, theirs, width, castles, now);
      if (flood === null) continue;
      const tallyMs = defaultConfigBundle.art.effects.tallyMs;
      tallies.push({ flood, speed: ((flood.maxDist + sealGlowTiles) * 1000) / tallyMs });
    }
  }

  /** Advances the floods and tallies by a frame, and returns the glow at their fronts. */
  function advanceFloods(): SealGlow[] {
    if (floods.length === 0 && tallies.length === 0) return [];
    const now = performance.now();
    const width = session.state.width;
    tallies = tallies.filter(({ flood, speed }) => !floodOver(flood, now, speed, sealGlowTiles));
    const tallied = tallies.flatMap(({ flood, speed }) =>
      sealGlow([flood], now, width, speed, sealGlowTiles),
    );
    if (floods.length === 0) return tallied;
    floods = floods.filter(
      (flood) => !floodOver(flood, now, sealFloodTilesPerSecond, sealGlowTiles),
    );
    drawFloodedTerritory(now);
    return [...sealGlow(floods, now, width, sealFloodTilesPerSecond, sealGlowTiles), ...tallied];
  }

  function applyEvents(events: readonly MatchEvent[]): void {
    matchLog.note(events, session.state);
    let structuresChanged = false;
    let territoryChanged = false;
    for (const event of events) {
      switch (event.kind) {
        case 'shot_impact': {
          const { width, islandId } = session.state;
          const debris = event.destroyed.map((i) => ({
            x: i % width,
            y: Math.floor(i / width),
            owner: (islandId[i] as number) - 1,
          }));
          scene.noteImpact(event.x, event.y, debris);
          // Only for your own wall: shots land all over the map, all the time.
          const human = session.humanPlayer;
          if (human >= 0 && !motionReduced() && debris.some((d) => d.owner === human)) {
            scene.shake();
          }
          if (event.destroyed.length > 0) structuresChanged = true;
          break;
        }
        case 'shot_fired':
          scene.noteShot(event.shot);
          break;
        case 'piece_placed': {
          // Whose island it went on, which is not always the placer's in a team match.
          const { width, owner } = session.state;
          const cells = event.cells.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
          const first = event.cells[0];
          if (first !== undefined) scene.noteLanding(cells, (owner[first] as number) - 1);
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'castle_selected':
          choices.push({ castleId: event.castleId, owner: event.player, at: performance.now() });
          structuresChanged = true;
          territoryChanged = true;
          break;
        case 'cannon_placed': {
          // Set down as a piece is: it settles, throws up the style's dust or sparks, and
          // knocks flat whatever stood under it.
          const [w, h] = session.state.ruleset.cannons.footprint;
          const cells: { x: number; y: number }[] = [];
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) cells.push({ x: event.x + dx, y: event.y + dy });
          }
          scene.noteLanding(cells, event.player);
          structuresChanged = true;
          break;
        }
        case 'round_resolved': {
          const hold = Math.ceil(
            (defaultConfigBundle.art.hud.pointsBannerMs * session.state.ruleset.tickRateHz) / 1000,
          );
          const { tallyMs } = defaultConfigBundle.art.effects;
          const count = Math.ceil((tallyMs * session.state.ruleset.tickRateHz) / 1000);
          for (const result of event.results) {
            gained.set(result.player, {
              amount: result.territoryPoints + result.damagePoints,
              untilTick: event.tick + hold,
              // Counted up as the territory is tallied, rather than landing whole.
              fromTick: event.tick,
              countTicks: count,
              guns: result.cannonsAwarded,
            });
            if (result.territoryPoints > 0) tallyDue.push(result.player);
          }
          resolvedSinceAnnounce = true;
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'player_eliminated':
          structuresChanged = true;
          territoryChanged = true;
          break;
        case 'player_continued': {
          // The sim lengthens the intermission by continueBannerMs for exactly this,
          // so the announcement has the board to itself. Held a little longer than the
          // pause, so it does not vanish the instant the next phase starts.
          const hold = Math.ceil(
            (session.state.ruleset.phases.continueBannerMs * 2 * session.state.ruleset.tickRateHz) /
              1000,
          );
          livesLost.set(event.player, {
            remaining: event.continuesRemaining,
            untilTick: event.tick + hold,
          });
          // The wipe took the island's wall in one step; take it down outward instead.
          const island = session.state.players[event.player]?.islandId ?? event.player + 1;
          const centre = islandCentre.get(event.player);
          if (centre !== undefined) {
            const lost = lostWalls(drawnStructure, drawnOwner, session.state.structure, island);
            ruins.push(
              ...crumbleOutward(
                lost,
                session.state.width,
                centre,
                performance.now(),
                defaultConfigBundle.art.effects.lifeCrumbleMs,
              ),
            );
          }
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'walls_swept':
          // Drawn away by the next banner rather than now; see `sweepUnderBanner`. A
          // block placed in this same step was never drawn, so its island says whose.
          swept = event.tiles.map((index) => ({
            index,
            owner: (drawnOwner[index] as number) || (session.state.islandId[index] as number),
          }));
          structuresChanged = true;
          break;
        case 'phase_changed':
          controls.resetRotation();
          territoryChanged = true;
          structuresChanged = true;
          break;
        default:
          break;
      }
    }
    if (structuresChanged) drawBoard();
    if (territoryChanged || structuresChanged) {
      // Taken before this batch's shots are counted, so it is the board combat began on.
      held = holdsCombatEnclosure(session.state) ? (held ?? live) : null;
      const before = live.territory;
      const sealedBefore = live.castleEnclosed;
      live = computeEnclosure(session.state);
      matchAudio.sealed(session.state, sealedBefore, live.castleEnclosed);
      const now = performance.now();
      const flood = floodFrom(
        before,
        live.territory,
        session.state.width,
        session.state.castles,
        now,
      );
      if (flood !== null) floods.push(flood);
      drawFloodedTerritory(now);
      startTallies(now);
      hints = buildHints(session.state, session.humanPlayer, live);
    }
  }

  function recentChoices(now: number): Choice[] {
    const span = defaultConfigBundle.art.effects.choiceBurstMs;
    choices = choices.filter((c) => now - c.at < span);
    return choices.flatMap((c) => {
      const castle = session.state.castles.find((k) => k.id === c.castleId);
      return castle === undefined ? [] : [{ castle, owner: c.owner, ageMs: now - c.at }];
    });
  }

  /** When this client first saw the match over, for the push onto the winner. */
  let overAt: number | null = null;

  /**
   * The camera, moving only while nothing is playable (PLAN 11.11 W6): onto the viewer's
   * island as the match opens and out to the whole map, and slowly onto the winners at
   * game over. Still under reduced motion. Before anything is drawn over the board in
   * HTML, which is placed through it.
   */
  function pointCamera(now: number): void {
    const state = session.state;
    if (state.phase === 'game_over') overAt ??= now;
    const art = defaultConfigBundle.art.camera;
    const winners = state.winners.flatMap((id) => islandCentre.get(id) ?? []);
    const shot = motionReduced()
      ? null
      : (openingShot(state, session.tickFraction, islandCentre.get(session.humanPlayer), art) ??
        winnerShot(state, now - (overAt ?? now), winners, art));
    scene.setCamera(state, shot);

    // "You are here", from the start of the match until the viewer has chosen a castle:
    // seats are shuffled onto islands, so nobody knows which is theirs until told.
    const me = state.players[session.humanPlayer];
    const centre = islandCentre.get(session.humanPlayer);
    const opening =
      state.round === 0 &&
      (state.phase === 'castle_select' ||
        (state.phase === 'intermission' && state.pendingPhase === 'castle_select'));
    hud.showYouAreHere(
      me !== undefined && centre !== undefined && opening && me.startingCastleId === null
        ? {
            ...scene.screenAt(centre.x, centre.y),
            colour: playerCssColour(me.id),
            shape: playerShape(me.id),
          }
        : null,
    );
  }

  let last = performance.now();
  const loop = (now: number): void => {
    const delta = now - last;
    last = now;
    // The board is ready: the first frame takes the screen over it down.
    if (preparing?.isConnected) preparing.remove();

    const events = session.advance(delta);
    pause.update(
      session.pausedBy,
      session.humanPlayer,
      session.state.players.map((p) => p.name),
      session.finished,
    );
    applyEvents(events);
    matchAudio.handle(events);
    matchAudio.frame(session.state);
    pointCamera(now);
    drawTransition();
    drawIslandBanners();
    hud.update(session.state, session.humanPlayer, session.status());
    watching.update(session.state, session.humanPlayer);
    const reading = session.network();
    if (reading !== null) badge?.update(reading, session.state.ruleset.tickRateHz);

    crumbleRuins();
    // Once the match is over, fireworks over whoever won it.
    const celebrate =
      session.state.phase === 'game_over'
        ? session.state.winners.flatMap((id) => {
            const centre = islandCentre.get(id);
            return centre === undefined ? [] : [{ ...centre, owner: id }];
          })
        : [];
    scene.drawEffects(
      session.state,
      session.tickFraction,
      delta,
      {
        build: enclosureFor('build').castleEnclosed,
        combat: enclosureFor('combat').castleEnclosed,
      },
      advanceFloods(),
      session.humanPlayer,
      celebrate,
      recentChoices(now),
      advanceDrains(now),
    );
    const ghost = {
      ...controls.ghost(session.tickFraction),
      ...hints,
      beat: countdownBeat(session.state, session.tickFraction),
    };
    scene.drawOverlay(session.state, ghost, session.humanPlayer);
    drawCounters(ghost);
    scene.render();

    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return cleanup;
}

/** `?rounds=N`, ignored when it is outside what a host could choose. */
function settingsFromParams(): MatchSettings {
  const rounds = Number(params.get('rounds') ?? DEFAULT_SETTINGS.maxRounds);
  return mergeSettings(DEFAULT_SETTINGS, { maxRounds: rounds }, SETTING_BOUNDS) ?? DEFAULT_SETTINGS;
}

if (params.get('autostart') === '1') {
  const count = Number(params.get('players') ?? 3);
  // ?watch=1 fills every seat with a bot, which is how a match is observed rather
  // than played.
  const watching = params.get('watch') === '1';
  // &level=N sets every bot's skill level, 1 to 10.
  const asked = Number(params.get('level'));
  const level =
    Number.isInteger(asked) && asked >= MIN_LEVEL && asked <= MAX_LEVEL ? asked : DEFAULT_BOT;
  const setup: Setup = {
    seats: Array.from({ length: count }, (_, i) => (i === 0 && !watching ? null : level)),
    seed: chosenSeed(),
    styles: preferredStyles(),
    name: 'Player',
    settings: settingsFromParams(),
    // &teams=N puts the seats in teams of N, in seat order, when N divides the table.
    ...(Number(params.get('teams') ?? 1) > 1 && count % Number(params.get('teams')) === 0
      ? { teams: defaultTeams(count, Number(params.get('teams'))) }
      : {}),
  };
  const phase = params.get('snapshot');
  const match = localMatchFor(setup, phase === null);
  // &round=N stops at that phase in round N or later, for looking at a match deep in.
  if (phase !== null && PHASES.includes(phase as Phase)) {
    match.fastForwardTo(
      phase as Phase,
      Number(params.get('round') ?? 0),
      params.get('idle') === '1',
    );
  }
  void runSession(localSession(match), setup).catch((error: unknown) =>
    showError('Failed to start match', error),
  );
} else if (params.get('host') !== null || params.get('join') !== null) {
  // The lobby had no way in except clicking through the menu, which meant it could not
  // be looked at the way `?autostart=1` lets a match be looked at — and it went
  // un-inspected at more than four seats for exactly that long.
  const joining = params.get('join');
  const common: Common = {
    styles: preferredStyles(),
    name: params.get('name') ?? storedName(),
    isPublic: params.get('private') !== '1',
  };
  void openLobby(common, joining, Number(params.get('host') ?? DEFAULT_PLAYERS)).catch(
    (error: unknown) => showError(joining !== null ? 'Could not join' : 'Could not host', error),
  );
} else {
  showMenu();
}
