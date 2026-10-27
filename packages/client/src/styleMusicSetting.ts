import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * How often a style's own track plays as its look starts (2026-10-27, the user's): always,
 * half the time, or never — the shared music only. The pause of `styleTrackPauseRounds` after
 * a track has played holds at either of the first two (`chooseStyleTrack`). Always is the
 * default, the chance the game had before the choice (ARCHIVE 14za).
 */
export type StyleMusicSetting = 'always' | 'half' | 'never';

const KEY = 'bollwerk.styleMusic';

export const STYLE_MUSIC_SETTINGS: readonly StyleMusicSetting[] = ['always', 'half', 'never'];

const CHANCES: Readonly<Record<StyleMusicSetting, number>> = { always: 1, half: 0.5, never: 0 };

export function parseStyleMusic(saved: string | null | undefined): StyleMusicSetting | null {
  return STYLE_MUSIC_SETTINGS.find((setting) => setting === saved) ?? null;
}

export function storedStyleMusic(): StyleMusicSetting {
  return parseStyleMusic(stored(KEY)) ?? 'always';
}

export function saveStyleMusic(chosen: StyleMusicSetting): void {
  store(KEY, chosen);
}

/** The chance, 0 to 1, that `chooseStyleTrack` is given. */
export function styleTrackChance(setting: StyleMusicSetting = storedStyleMusic()): number {
  return CHANCES[setting];
}

/** The choices as the menu offers them, for a `<select>`. */
export function styleMusicOptions(): string {
  return STYLE_MUSIC_SETTINGS.map(
    (value) => `<option value="${value}">${escape(t(`styleMusic.${value}`))}</option>`,
  ).join('');
}
