import { describe, expect, it } from 'vitest';

import { formatNumber, language, listOf, ordinal, t } from './i18n.js';

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
});
