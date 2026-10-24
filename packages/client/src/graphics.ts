import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * How much the screen is asked to draw, one choice in place of the old Effects' Glowing and
 * Sharpness's Fast. Each step down drops the dearest thing left:
 *
 * - **High**: the screen's own density, and the glow of Night, Cyberpunk and Electric bloomed
 *   by a real blur filter, which costs frame rate at eight players (ARCHIVE 12r).
 * - **Medium**: the screen's own density, the glow drawn as wider shapes only.
 * - **Low**: one pixel a pixel, scaled up by the browser. A screen of density 2 — Retina, 4K,
 *   a laptop scaled to 200% — has four times the pixels to fill, and on an integrated chip
 *   that, more than the drawing, holds the frame rate down; a little softer, often not noticed
 *   at the game's speed. On a screen of density 1 it is Medium, which the user accepted.
 *
 * Motion is not part of it: reducing it is a matter of comfort, not of the machine
 * (`motion.ts`). Chosen in the menu and the pause menu, taken at once.
 */
export type GraphicsLevel = 'high' | 'medium' | 'low';

const KEY = 'bollwerk.graphics';

export const GRAPHICS: readonly GraphicsLevel[] = ['high', 'medium', 'low'];

export function parseGraphics(saved: string | null | undefined): GraphicsLevel | null {
  return saved === 'high' || saved === 'medium' || saved === 'low' ? saved : null;
}

/**
 * The level carried over from the two settings it replaced: Fast was chosen for a slow
 * machine, so it wins over Glowing; Glowing alone is High; anything else Medium.
 */
export function carriedGraphics(effects: string | null, sharpness: string | null): GraphicsLevel {
  if (sharpness === 'fast') return 'low';
  return effects === 'high' ? 'high' : 'medium';
}

/** Read once and kept: the bloom and the renderer ask for it as looks are made. */
let level: GraphicsLevel | null = null;

export function storedGraphics(): GraphicsLevel {
  level ??=
    parseGraphics(stored(KEY)) ??
    carriedGraphics(stored('bollwerk.effects'), stored('bollwerk.sharpness'));
  return level;
}

const listeners = new Set<() => void>();

// Another tab of the game changing it: stored there, so read again here.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key === KEY) level = null;
});

/** Saved, and every screen drawing a board told, so a match takes it at once. */
export function saveGraphics(chosen: GraphicsLevel): void {
  level = chosen;
  store(KEY, chosen);
  for (const listener of listeners) listener();
}

/** Called as the level changes; returns the call that stops it. */
export function onGraphics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The dark styles' glow bloomed by a blur filter (`render/bloom.ts`). */
export function bloomWanted(chosen: GraphicsLevel = storedGraphics()): boolean {
  return chosen === 'high';
}

/**
 * The renderer's resolution: the screen's density, at most 2 — beyond it nobody sees more —
 * or 1 at Low.
 */
export function renderResolution(
  chosen: GraphicsLevel = storedGraphics(),
  density: number = globalThis.devicePixelRatio || 1,
): number {
  return chosen === 'low' ? 1 : Math.min(2, density);
}

/** The choices as the menus offer them, for a `<select>`. */
export function graphicsOptions(): string {
  return GRAPHICS.map(
    (value) => `<option value="${value}">${escape(t(`graphics.${value}`))}</option>`,
  ).join('');
}
