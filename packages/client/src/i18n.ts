import {
  LANGUAGES,
  LANGUAGE_NAMES,
  detectLanguage,
  isLanguage,
  locales,
  type Language,
  type LocaleText,
  type TextKey,
} from '@bollwerk/config';
import { store, stored } from './storage.js';

/*
 * The language the page speaks, and its texts (PLAN 11.20). Everything a player reads goes
 * through `t`, so the pure functions that make markup and lines — `lobbyMarkup`,
 * `bannersFor`, the awards, the summary — take the language in use without being told, and
 * their tests run in English, the default. Nothing translated travels: players at one table
 * may each play in their own language.
 */

let current: Language = 'en';

/**
 * The tag `Intl` is given for each language: British English, as the game is written, so a
 * list of three has no comma before "and".
 */
const INTL: Record<Language, string> = { en: 'en-GB', de: 'de-DE' };
const listeners = new Set<(language: Language) => void>();

export function language(): Language {
  return current;
}

/**
 * Changes the language, and tells whoever redraws text that it has changed. The page's own
 * `lang` follows, so CSS uppercase writes German's ß as SS, and a screen reader reads aloud
 * in the right voice.
 */
export function setLanguage(next: Language): void {
  if (globalThis.document !== undefined) document.documentElement.lang = next;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(next);
}

export { detectLanguage, isLanguage };

/** Where the menu remembers the choice, as it does the looks and the name. */
const LANGUAGE_KEY = 'bollwerk.language';

export function saveLanguage(language: Language): void {
  store(LANGUAGE_KEY, language);
}

function savedLanguage(): string | null {
  return stored(LANGUAGE_KEY);
}

/**
 * The language a page opens in: `&lang=` for screenshots and tests, which is not saved;
 * otherwise the choice saved; otherwise the browser's own, if the game speaks it.
 */
export function startingLanguage(asked: string | null): Language {
  if (isLanguage(asked)) return asked;
  const saved = savedLanguage();
  if (isLanguage(saved)) return saved;
  return detectLanguage(globalThis.navigator?.languages ?? []);
}

/** The options of a language chooser, each language named in itself, the current chosen. */
export function languageOptions(): string {
  return LANGUAGES.map(
    (code) =>
      `<option value="${code}"${code === current ? ' selected' : ''}>${LANGUAGE_NAMES[code]}</option>`,
  ).join('');
}

/** Called whenever the language changes; returns the way to stop listening. */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A parameter of a text: shown as given, a number in the language's own way. */
export type TextParams = Record<string, string | number>;

/**
 * The text for `key` in the language in use, its `{placeholders}` filled from `params`. A
 * plural takes the form its `n` asks for, by the language's own rules. A text a language
 * lacks is shown in English, never as its key.
 */
export function t(key: TextKey, params: TextParams = {}): string {
  const text: LocaleText | undefined = locales[current][key] ?? locales.en[key];
  if (text === undefined) return key;
  let form: string;
  if (typeof text === 'string') {
    form = text;
  } else {
    const n = typeof params.n === 'number' ? params.n : 0;
    const which = plurals(INTL[current], 'cardinal').select(n);
    form = text[which] ?? text.other;
  }
  return form.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? formatNumber(value) : value;
  });
}

/**
 * The `Intl` formatters, made once a language and kept: building one is costly, and the HUD
 * formats every figure it shows every frame through `t` — twenty and more a frame at eight
 * players.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
const listFormats = new Map<string, Intl.ListFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function plurals(locale: string, type: Intl.PluralRuleType): Intl.PluralRules {
  const key = `${locale}:${type}`;
  let rules = pluralRules.get(key);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale, { type });
    pluralRules.set(key, rules);
  }
  return rules;
}

/** A place as the language writes it: "3rd" in English, "3." in German. */
export function ordinal(n: number): string {
  const text = locales[current].ordinal ?? locales.en.ordinal;
  if (text === undefined) return String(n);
  const form =
    typeof text === 'string'
      ? text
      : (text[plurals(INTL[current], 'ordinal').select(n)] ?? text.other);
  return form.replace('{n}', String(n));
}

/** A number as the language writes it: `18.6` in English, `18,6` in German. */
export function formatNumber(value: number, fractionDigits?: number): string {
  const key = `${INTL[current]}:${fractionDigits ?? ''}`;
  let format = numberFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(INTL[current], {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits ?? 20,
      useGrouping: false,
    });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Names joined as the language joins them: "Ada, Bo and Cy". */
export function listOf(names: readonly string[]): string {
  const locale = INTL[current];
  let format = listFormats.get(locale);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
    listFormats.set(locale, format);
  }
  return format.format(names);
}
