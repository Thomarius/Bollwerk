import { z } from 'zod';

/*
 * The game's texts, one file a language in `config/locale/` (PLAN 11.20): flat keys grouped
 * by screen, whole sentences with named placeholders (`{name}`), since word order differs
 * between languages and a sentence assembled from pieces cannot be translated. Adding a
 * language is adding a file and a name below. English is the reference: every other
 * language must have exactly its keys and, in each, the same placeholders.
 */

/** The forms a plural may take, as `Intl.PluralRules` names them. */
export const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralForm = (typeof PLURAL_FORMS)[number];

/**
 * A text: a sentence, or a plural — the forms the language needs, `other` always among
 * them, the count given as `{n}`.
 */
export const LocaleTextSchema = z.union([
  z.string(),
  z
    .strictObject({
      zero: z.string().optional(),
      one: z.string().optional(),
      two: z.string().optional(),
      few: z.string().optional(),
      many: z.string().optional(),
      other: z.string(),
    })
    .readonly(),
]);
export type LocaleText = z.infer<typeof LocaleTextSchema>;

export const LocaleSchema = z.record(z.string(), LocaleTextSchema);
export type Locale = z.infer<typeof LocaleSchema>;

/** The languages the game speaks, by code, each named in itself for the chooser. */
export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English' };

/** The placeholders a text uses, across all its forms. */
export function placeholders(text: LocaleText): Set<string> {
  const found = new Set<string>();
  const forms = typeof text === 'string' ? [text] : Object.values(text);
  for (const form of forms) {
    if (form === undefined) continue;
    for (const match of form.matchAll(/\{(\w+)\}/g)) found.add(match[1]!);
  }
  return found;
}

/**
 * What is wrong with `locale` against the English reference: keys missing or unknown, and
 * keys whose placeholders differ — a translation that drops `{name}` would show a sentence
 * about nobody. Empty when it is complete.
 */
export function localeProblems(reference: Locale, locale: Locale): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(reference)) {
    const text = locale[key];
    if (text === undefined) {
      problems.push(`missing: ${key}`);
      continue;
    }
    const want = [...placeholders(reference[key]!)].sort().join(',');
    const have = [...placeholders(text)].sort().join(',');
    if (want !== have) problems.push(`placeholders of ${key}: {${have}}, not {${want}}`);
  }
  for (const key of Object.keys(locale)) {
    if (!(key in reference)) problems.push(`unknown: ${key}`);
  }
  return problems;
}
