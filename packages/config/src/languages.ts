/*
 * The languages the game speaks, apart from their texts and their schema so the desktop
 * window can choose one without bundling the whole configuration (PLAN 11.20).
 */

/** The languages the game speaks, by code, each named in itself for the chooser. */
export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch' };

/** Whether `code` names a language the game speaks. */
export function isLanguage(code: string | null | undefined): code is Language {
  return code !== null && code !== undefined && (LANGUAGES as readonly string[]).includes(code);
}

/**
 * The first language of the browser's own the game speaks — "de-AT" is German — or English.
 * What a first visit starts in, before anybody has chosen.
 */
export function detectLanguage(preferences: readonly string[]): Language {
  for (const preference of preferences) {
    const code = preference.toLowerCase().split('-')[0];
    if (isLanguage(code)) return code;
  }
  return 'en';
}
