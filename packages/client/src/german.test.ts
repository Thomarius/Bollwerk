import { defaultAudioManifest, locales, placeholders, type TextKey } from '@bollwerk/config';
import type { Seat } from '@bollwerk/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gamesMarkup } from './browser.js';
import { creditsHtml } from './credits.js';
import { setLanguage, t } from './i18n.js';
import { lobbyMarkup, type LobbyView } from './lobby.js';
import { galleryMarkup } from './looks.js';

/*
 * The main screens in German (PLAN 11.20): a key or a `{placeholder}` showing through would
 * mean a text the mechanism missed, which the English tests cannot see.
 */

function seat(playerId: number, name: string): Seat {
  return { playerId, name, isBot: false, connected: true, ready: false };
}

function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    code: 'ABC123',
    playerCount: 4,
    hostId: 0,
    humanPlayer: 0,
    seats: [seat(0, 'Ada'), seat(1, 'Bo')],
    bots: [5, 5, 5, 5],
    settings: { maxRounds: 10, teamSize: 2, continues: 2 },
    settingBounds: {
      maxRounds: { min: 5, max: 20 },
      teamSize: { min: 1, max: 4 },
      continues: { min: 0, max: 4 },
    },
    teams: [0, 0, 1, 1],
    playerLimits: { min: 2, max: 8 },
    seed: 42,
    hostBot: null,
    ...over,
  };
}

/** A key of the locale, written as one ("menu.play", "award.wrecker.detail"). */
const KEY = new RegExp(
  `\\b(${Object.keys(locales.en)
    .map((k) => k.replace(/\./g, '\\.'))
    .join('|')})\\b`,
);

function clean(html: string): void {
  expect(html).not.toMatch(/\{\w+\}/);
  expect(html).not.toMatch(KEY);
}

describe('in German', () => {
  beforeAll(() => setLanguage('de'));
  afterAll(() => setLanguage('en'));

  it('writes the lobby in German, for the host and for a guest', () => {
    const host = lobbyMarkup(view());
    clean(host);
    expect(host).toContain('Spiel starten');
    expect(host).toContain('Team A');
    clean(
      lobbyMarkup(view({ humanPlayer: 1, settings: { maxRounds: 10, teamSize: 1, continues: 2 } })),
    );
  });

  it('writes the open games, the gallery and the credits in German', () => {
    clean(
      gamesMarkup([
        {
          code: 'ABC123',
          host: 'Ada',
          people: 1,
          playerCount: 4,
          teamSize: 2,
          maxRounds: 10,
          tournament: null,
        },
      ]),
    );
    clean(gamesMarkup([]));
    const gallery = galleryMarkup({ build: 'pixel', combat: 'random' }, 'build');
    clean(gallery);
    expect(gallery).toContain('Mittelalter');
    const credits = creditsHtml(defaultAudioManifest);
    clean(credits);
    expect(credits).toContain('Bollwerk ist ein inoffizielles Fanspiel');
  });

  it('fills every text, given its placeholders', () => {
    for (const key of Object.keys(locales.en) as TextKey[]) {
      const params = Object.fromEntries(
        [...placeholders(locales.en[key]!)].map((name) => [name, name === 'n' ? 2 : 'X']),
      );
      expect(t(key, params), key).not.toMatch(/\{\w+\}/);
    }
  });
});
