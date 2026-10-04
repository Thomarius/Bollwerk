import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectLanguage,
  formatNumber,
  isLanguage,
  language,
  languageOptions,
  listOf,
  onLanguageChange,
  ordinal,
  setLanguage,
  startingLanguage,
  t,
} from './i18n.js';

describe('the texts', () => {
  it('speaks English until told otherwise', () => {
    expect(language()).toBe('en');
    expect(t('menu.play')).toBe('Play');
  });

  it('fills placeholders, numbers as the language writes them', () => {
    expect(t('pause.by', { name: 'Ada' })).toBe('Ada paused the match');
    expect(t('round.labelOf', { round: 3, cap: 10 })).toBe('round 3 / 10');
  });

  it('takes the form a count asks for', () => {
    expect(t('banner.livesLeft', { name: 'Ada', n: 1 })).toBe('Ada — 1 life left');
    expect(t('banner.livesLeft', { name: 'Ada', n: 2 })).toBe('Ada — 2 lives left');
    expect(t('hud.cannonsLeft', { n: 0 })).toBe('0 cannons left to place');
  });

  it('writes places, lists and decimals in English', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
    ]);
    expect(listOf(['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo and Cy');
    expect(listOf(['Ada', 'Bo'])).toBe('Ada and Bo');
    expect(formatNumber(18.6, 1)).toBe('18.6');
    expect(formatNumber(19, 1)).toBe('19.0');
    expect(formatNumber(1203)).toBe('1203');
  });

  it('leaves a placeholder it was not given, rather than inventing one', () => {
    expect(t('pause.by')).toBe('{name} paused the match');
  });

  it('starts in the browser’s language if it speaks it, else English', () => {
    expect(detectLanguage(['xx-YY', 'en-GB'])).toBe('en');
    expect(detectLanguage(['EN'])).toBe('en');
    expect(detectLanguage(['de-AT', 'en'])).toBe('de');
    expect(detectLanguage(['fr-FR', 'de'])).toBe('de');
    expect(detectLanguage(['xx'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });

  it('takes a language asked for by the address only if it speaks it', () => {
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('xx')).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(startingLanguage('en')).toBe('en');
    expect(startingLanguage('de')).toBe('de');
  });

  it('offers every language in its own name, the current one chosen', () => {
    expect(languageOptions()).toContain('<option value="en" selected>English</option>');
    expect(languageOptions()).toContain('<option value="de">Deutsch</option>');
  });

  describe('in German', () => {
    beforeEach(() => setLanguage('de'));
    afterEach(() => setLanguage('en'));

    it('speaks German, with its own plurals, places, lists and decimals', () => {
      expect(t('menu.play')).toBe('Spielen');
      expect(t('banner.gainGuns', { n: 1 })).toBe('+1 Kanone');
      expect(t('banner.gainGuns', { n: 2 })).toBe('+2 Kanonen');
      expect(ordinal(3)).toBe('3.');
      expect(listOf(['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo und Cy');
      expect(t('hud.seconds', { seconds: formatNumber(18.6, 1) })).toBe('18,6 s');
    });

    it('tells whoever listens that the language changed', () => {
      const heard: string[] = [];
      const stop = onLanguageChange((language) => heard.push(language));
      setLanguage('en');
      setLanguage('en');
      stop();
      setLanguage('de');
      expect(heard).toEqual(['en']);
    });
  });
});
