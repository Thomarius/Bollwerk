import { defaultConfigBundle, validateConfigBundle } from '@bollwerk/config';

import { Audio } from './audio.js';
import { onLanguageChange, setLanguage, startingLanguage, t } from './i18n.js';
import { withIcon } from './icons.js';
import { installBackdrop } from './decor.js';
import { applyMotion } from './motion.js';
import { perf } from './perf.js';

/**
 * The page itself, shared by the menu, the lobby and every match: the root element, sound,
 * the query parameters, and the error box. Set up once, as the page loads.
 */

const problems = validateConfigBundle(defaultConfigBundle);

if (problems.length > 0) {
  throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
}

export const app = document.querySelector<HTMLElement>('#app');

if (!app) throw new Error('missing #app');

// The language before anything is written: `&lang=` for screenshots, else the saved
// choice, else the browser's own if the game speaks it (PLAN 11.20).
setLanguage(startingLanguage(new URLSearchParams(globalThis.location.search).get('lang')));

installBackdrop(defaultConfigBundle.art);

applyMotion();

/** Surfaces failures on the page: a renderer that throws otherwise looks like a black screen. */
export function showError(source: string, detail: unknown): void {
  const message =
    detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : String(detail);
  const box = document.createElement('pre');
  box.className = 'crash';
  box.textContent = `${source}\n\n${message}`;
  app?.replaceChildren(box);
}

globalThis.addEventListener('error', (event) =>
  showError(t('error.uncaught'), event.error ?? event.message),
);

globalThis.addEventListener('unhandledrejection', (event) =>
  showError(t('error.unhandled'), event.reason),
);

/**
 * Sound, shared by the menu and every match.
 *
 * A browser will not start an audio context without a user gesture, so the first
 * click or keypress anywhere is what switches it on — the menu's own buttons are
 * usually that gesture, but `?autostart=1` skips the menu entirely and then the first
 * input in the match does it instead. It is tried at once as well: a browser that lets
 * the site play sound unasked (a permission given it, the desktop app's window) starts
 * the music as the page opens; one that does not leaves the context waiting, and the
 * first gesture resumes it (the users' wish, 2026-10-09).
 */
export const audio = new Audio(defaultConfigBundle.audio);

const unlock = (): void => audio.unlock();

globalThis.addEventListener('pointerdown', unlock, { capture: true });

globalThis.addEventListener('keydown', unlock, { capture: true });

unlock();

/**
 * A sound switch on every screen, showing whether sound is on. Mute is remembered by the
 * browser, so without it a mute set once — as the old M key did whenever a name with an
 * "m" was typed in the lobby — silenced every later visit with nothing on screen to say
 * so, and nothing outside a match to undo it.
 */
function installSoundButton(): void {
  const button = document.createElement('button');
  button.id = 'sound';
  const show = (): void => {
    button.innerHTML = audio.isMuted
      ? withIcon('mute', t('sound.off'))
      : withIcon('sound', t('sound.on'));
    button.classList.toggle('off', audio.isMuted);
    button.setAttribute('aria-pressed', String(!audio.isMuted));
  };
  button.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted);
    show();
  });
  show();
  onLanguageChange(show);
  corner.append(button);
}

/**
 * The bottom left's row of switches on every screen — Sound, Full screen, and Pause during a
 * match (`pause.ts`) — laid out by their widths, which change with the language.
 */
const corner = document.createElement('div');
corner.id = 'corner';
document.body.append(corner);

installSoundButton();

/**
 * Full screen, beside Sound (PLAN §11 item 4, UP2): F11 is a key, and the game is played with
 * the mouse. The page's own, so the browser's Esc takes it back as well; left out where the
 * page may not go full screen.
 */
function installFullscreenButton(): void {
  if (!document.fullscreenEnabled) return;
  const button = document.createElement('button');
  button.id = 'fullscreen';
  const show = (): void => {
    button.innerHTML =
      document.fullscreenElement === null
        ? withIcon('expand', t('fullscreen.enter'))
        : withIcon('shrink', t('fullscreen.leave'));
  };
  button.addEventListener('click', () => {
    if (document.fullscreenElement === null) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
    // Off the button, so Space or Enter later cannot press it again unseen.
    button.blur();
  });
  document.addEventListener('fullscreenchange', show);
  onLanguageChange(show);
  show();
  corner.append(button);
}

installFullscreenButton();

export const params = new URLSearchParams(globalThis.location.search);

export const timeScale = Math.max(1, Number(params.get('speed') ?? 1));

// The frame-time readout (PLAN 11.22).
perf.enabled = params.get('perf') === '1';

// For a script driving the page, which reads the figures rather than clicking Copy.
if (perf.enabled) Object.assign(globalThis, { bollwerkPerf: perf });
