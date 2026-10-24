import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * How much the screen moves: full, or reduced — no shake, no flicker, no beat, no slide,
 * no sweep of the title — for anyone who wants that without changing their system's
 * reduced-motion setting, which is honoured as well. A switch of its own, beside the
 * Graphics: it is a matter of comfort, not of the machine.
 */
export type Motion = 'full' | 'reduced';

const KEY = 'bollwerk.motion';

export const MOTIONS: readonly Motion[] = ['full', 'reduced'];

export function parseMotion(saved: string | null | undefined): Motion | null {
  return saved === 'full' || saved === 'reduced' ? saved : null;
}

/**
 * The choice as last read or saved. The styles ask for it per particle and per point of a
 * curve, and reading storage and building a media query each time cost Opera 48 ms a frame
 * at eight players (PLAN 11.22), so it is read once and kept.
 */
let motion: Motion | null = null;

/** Carried over from the old Effects setting, whose Reduced it was. */
export function storedMotion(): Motion {
  motion ??=
    parseMotion(stored(KEY)) ?? (stored('bollwerk.effects') === 'reduced' ? 'reduced' : 'full');
  return motion;
}

// Another tab of the game changing it: stored there, so read again here.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key === KEY) motion = null;
});

export function saveMotion(chosen: Motion): void {
  motion = chosen;
  store(KEY, chosen);
  applyMotion(chosen);
}

/** Motion is reduced when the player chose so, or their system asks for it. */
export function isMotionReduced(chosen: Motion, systemAsks: boolean): boolean {
  return chosen === 'reduced' || systemAsks;
}

/** The system's setting, made once: its `matches` follows the setting as it changes. */
let systemQuery: MediaQueryList | null | undefined;

export function motionReduced(): boolean {
  systemQuery ??= globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  return isMotionReduced(storedMotion(), systemQuery?.matches ?? false);
}

/** The page's class for the stylesheet, which reduces what it animates as the media query does. */
export function applyMotion(chosen: Motion = storedMotion()): void {
  globalThis.document?.body?.classList.toggle('reduced-motion', chosen === 'reduced');
}

/** The choices as the menus offer them, for a `<select>`. */
export function motionOptions(): string {
  return MOTIONS.map(
    (value) => `<option value="${value}">${escape(t(`motion.${value}`))}</option>`,
  ).join('');
}
