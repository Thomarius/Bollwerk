import { describe, expect, it } from 'vitest';

import { locales } from './defaults.js';
import { LANGUAGES, LANGUAGE_NAMES, localeProblems, placeholders } from './locale.js';

describe('the locales', () => {
  it('has a file and a name for every language', () => {
    for (const language of LANGUAGES) {
      expect(locales[language]).toBeDefined();
      expect(LANGUAGE_NAMES[language].length).toBeGreaterThan(0);
    }
  });

  // As the credits' test fails on a sound without a credit: a text added to the game cannot
  // be forgotten in a language, nor a placeholder dropped from a translation.
  it('gives every language exactly English’s texts, with the same placeholders', () => {
    for (const language of LANGUAGES) {
      expect(localeProblems(locales.en, locales[language]), language).toEqual([]);
    }
  });

  it('counts a plural’s placeholders across all its forms', () => {
    expect([...placeholders('{name} — {n} lives left')].sort()).toEqual(['n', 'name']);
    expect([...placeholders({ one: 'a life', other: '{n} lives' })]).toEqual(['n']);
  });

  it('reports what a translation lacks, adds, or garbles', () => {
    const reference = { a: 'Hello {name}', b: 'Bye', c: { one: '{n} life', other: '{n} lives' } };
    expect(
      localeProblems(reference, { a: 'Hallo', c: { other: '{n} Leben' }, d: 'extra' }),
    ).toEqual(['placeholders of a: {}, not {name}', 'missing: b', 'unknown: d']);
  });

  it('keeps the names the disclaimer must carry, in every language', () => {
    // credits.ts marks them in the text by pattern.
    for (const language of LANGUAGES) {
      const text = locales[language]['credits.disclaimer'];
      expect(text).toMatch(/Bollwerk/);
      expect(text).toMatch(/Rampart/);
    }
  });
});
