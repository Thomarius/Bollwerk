import { defaultConfigBundle, validateConfigBundle } from '@bollwerk/config';

import { Audio } from './audio.js';
import { onLanguageChange, setLanguage, startingLanguage, t } from './i18n.js';
import { installBackdrop } from './decor.js';
import { applyEffects } from './motion.js';
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

applyEffects();

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
/** Brings the corner switch up to date, for when the pause menu changes the sound. */
export let showSoundButton: () => void = () => undefined;

function installSoundButton(): void {
  const button = document.createElement('button');
  button.id = 'sound';
  const show = (): void => {
    button.textContent = audio.isMuted ? t('sound.off') : t('sound.on');
    button.classList.toggle('off', audio.isMuted);
    button.setAttribute('aria-pressed', String(!audio.isMuted));
  };
  button.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted);
    show();
  });
  show();
  showSoundButton = show;
  onLanguageChange(show);
  document.body.append(button);
}

installSoundButton();

export const params = new URLSearchParams(globalThis.location.search);

export const timeScale = Math.max(1, Number(params.get('speed') ?? 1));

// The frame-time readout (PLAN 11.22).
perf.enabled = params.get('perf') === '1';

// For a script driving the page, which reads the figures rather than clicking Copy.
if (perf.enabled) Object.assign(globalThis, { bollwerkPerf: perf });
