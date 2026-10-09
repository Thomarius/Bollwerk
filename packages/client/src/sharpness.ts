import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * How sharp the board is drawn: at the screen's own density, or at one pixel a pixel and
 * scaled up by the browser. A screen of density 2 — Retina, 4K, a laptop scaled to 200% —
 * has four times the pixels to fill, and on an integrated graphics chip that, more than the
 * drawing, is what holds the frame rate down: the glows, the light and the wipes fill the
 * whole screen. Fast is a little softer and often not noticed at the game's speed. Chosen in
 * the menu and the pause menu, beside the Effects.
 */
export type Sharpness = 'sharp' | 'fast';

const KEY = 'bollwerk.sharpness';

export const SHARPNESS: readonly Sharpness[] = ['sharp', 'fast'];

export function parseSharpness(saved: string | null | undefined): Sharpness {
  return saved === 'fast' ? 'fast' : 'sharp';
}

export function storedSharpness(): Sharpness {
  return parseSharpness(stored(KEY));
}

const listeners = new Set<() => void>();

/** Saved, and every screen drawing a board told, so a match takes it at once. */
export function saveSharpness(chosen: Sharpness): void {
  store(KEY, chosen);
  for (const listener of listeners) listener();
}

/** Called as the sharpness changes; returns the call that stops it. */
export function onSharpness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The renderer's resolution: the screen's density, at most 2 — beyond it nobody sees more —
 * or 1 when fast.
 */
export function renderResolution(
  sharpness: Sharpness = storedSharpness(),
  density: number = globalThis.devicePixelRatio || 1,
): number {
  return sharpness === 'fast' ? 1 : Math.min(2, density);
}

/** The choices as the menus offer them, for a `<select>`. */
export function sharpnessOptions(): string {
  return SHARPNESS.map(
    (value) => `<option value="${value}">${escape(t(`sharpness.${value}`))}</option>`,
  ).join('');
}
