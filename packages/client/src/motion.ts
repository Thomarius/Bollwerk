/**
 * How much the screen moves: full, or reduced — no shake, no flicker, no beat, no slide,
 * no sweep of the title — for anyone who wants that without changing their system's
 * reduced-motion setting, which is honoured as well. Chosen in the menu, kept with the
 * looks.
 */
export type EffectsLevel = 'high' | 'full' | 'reduced';

const KEY = 'rampart.effects';

export function storedEffects(): EffectsLevel {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    return stored === 'reduced' || stored === 'high' ? stored : 'full';
  } catch {
    return 'full';
  }
}

export function saveEffects(level: EffectsLevel): void {
  try {
    globalThis.localStorage?.setItem(KEY, level);
  } catch {
    // Storage refused, as in some private windows: the choice holds for this page only.
  }
  applyEffects(level);
}

/**
 * High is full with the glow of the dark styles bloomed by a real blur filter, which
 * costs frame rate at eight players and so is asked for rather than given.
 */
export function bloomWanted(): boolean {
  return storedEffects() === 'high';
}

/** Motion is reduced when the player chose so, or their system asks for it. */
export function isMotionReduced(level: EffectsLevel, systemAsks: boolean): boolean {
  return level === 'reduced' || systemAsks;
}

export function motionReduced(): boolean {
  return isMotionReduced(
    storedEffects(),
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
}

/** The page's class for the stylesheet, which reduces what it animates as the media query does. */
export function applyEffects(level: EffectsLevel = storedEffects()): void {
  globalThis.document?.body?.classList.toggle('reduced-effects', level === 'reduced');
}
