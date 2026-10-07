import { defaultArtConfig, type ArtLook } from '@bollwerk/config';

import { chooseLook, type LookChoices } from './looks.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';
import { params } from './app.js';

/** What the menu remembers between visits — the looks and the name — and a new table's map. */

/** Where the menu remembers the two looks, so they survive a reload. */
const STYLES_KEY = 'bollwerk.styles';

/** What the menu saved, unchecked: `chooseLook` decides whether each is still usable. */
function storedStyles(): Partial<Record<ArtLook, unknown>> {
  try {
    const raw: unknown = JSON.parse(stored(STYLES_KEY) ?? '{}');
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
export function preferredStyles(): LookChoices {
  const stored = storedStyles();
  const fallback = defaultArtConfig.styles;
  const both = params.get('style');
  return {
    build: chooseLook('build', [params.get('buildStyle'), both, stored.build], fallback.build),
    combat: chooseLook('combat', [params.get('combatStyle'), both, stored.combat], fallback.combat),
  };
}

/** Saves the two looks for next time, as they are chosen. */
export function saveStyles(choices: LookChoices): void {
  store(STYLES_KEY, JSON.stringify(choices));
}

/** A seed from the browser's own entropy, for a table nobody has asked a map of. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

/**
 * The map for a new table: `?seed=N` when testing wants a particular one, otherwise a
 * fresh random one every time a lobby opens.
 */
export function chosenSeed(): number {
  const asked = params.get('seed');
  const n = Number(asked);
  return asked !== null && Number.isInteger(n) && n >= 0 ? n >>> 0 : randomSeed();
}

/** Where the menu remembers the player's name, as it does the looks. */
const NAME_KEY = 'bollwerk.name';

export function storedName(): string {
  return stored(NAME_KEY)?.trim() || t('menu.defaultName');
}

export function saveName(name: string): void {
  store(NAME_KEY, name);
}
