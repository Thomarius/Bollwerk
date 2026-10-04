/**
 * How much the screen moves: full, or reduced — no shake, no flicker, no beat, no slide,
 * no sweep of the title — for anyone who wants that without changing their system's
 * reduced-motion setting, which is honoured as well. Chosen in the menu, kept with the
 * looks.
 */
export type EffectsLevel = 'high' | 'full' | 'reduced';

const KEY = 'bollwerk.effects';

/**
 * The level as last read or saved. The styles ask for it per particle and per point of a
 * curve, and reading storage and building a media query each time cost Opera 48 ms a frame
 * at eight players (PLAN 11.22), so it is read once and kept.
 */
let level: EffectsLevel | null = null;

function readStored(): EffectsLevel {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    return stored === 'reduced' || stored === 'high' ? stored : 'full';
  } catch {
    return 'full';
  }
}

export function storedEffects(): EffectsLevel {
  level ??= readStored();
  return level;
}

// Another tab of the game changing it: stored there, so read again here.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key === KEY) level = null;
});

export function saveEffects(chosen: EffectsLevel): void {
  level = chosen;
  try {
    globalThis.localStorage?.setItem(KEY, chosen);
  } catch {
    // Storage refused, as in some private windows: the choice holds for this page only.
  }
  applyEffects(chosen);
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

/** The system's setting, made once: its `matches` follows the setting as it changes. */
let systemQuery: MediaQueryList | null | undefined;

export function motionReduced(): boolean {
  systemQuery ??= globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  return isMotionReduced(storedEffects(), systemQuery?.matches ?? false);
}

/** The page's class for the stylesheet, which reduces what it animates as the media query does. */
export function applyEffects(level: EffectsLevel = storedEffects()): void {
  globalThis.document?.body?.classList.toggle('reduced-effects', level === 'reduced');
}
