import {
  AUDIO_LICENCES,
  audioCredits,
  type AudioManifest,
  type CreditedFile,
} from '@bollwerk/config';

import { t } from './i18n.js';
import { escape } from './lobby.js';

/**
 * The menu's Credits: what the game owes Rampart, and who made each sound, on what
 * licence — made from the audio manifest, as `CREDITS.md` is, so the two always agree.
 */

function item({ path, credit }: CreditedFile): string {
  if (credit === null) {
    return `<li><code>${escape(path)}</code> <em>${t('credits.uncredited')}</em></li>`;
  }
  const link = (href: string, text: string): string =>
    `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  const changes = credit.changes === undefined ? '' : ` ${escape(credit.changes)}`;
  const what = path.endsWith('/') ? `${t('credits.everySound')} ` : '';
  // The credit's title, author and licence are the work's own and never translated.
  const title = credit.title === undefined ? '' : `“${escape(credit.title)}” `;
  const body = t('credits.item', {
    title,
    author: escape(credit.author),
    licence: link(AUDIO_LICENCES[credit.licence], credit.licence),
    source: link(credit.source, t('credits.source')),
  });
  return `<li>${what}${body}${changes}</li>`;
}

/** The panel's markup, apart so a test can read it without a page. */
export function creditsHtml(audio: AudioManifest): string {
  const { music, sfx } = audioCredits(audio);
  return `
    <div class="panel">
      <h2>${t('credits.title')}</h2>
      <p class="disclaimer">${escape(t('credits.disclaimer'))}</p>
      <p class="disclaimer">${t('credits.mit')}</p>
      <div class="list">
        <h3>${t('credits.music')}</h3>
        <ul>${music.map(item).join('')}</ul>
        <h3>${t('credits.sfx')}</h3>
        <ul>${sfx.map(item).join('')}</ul>
      </div>
      <button class="close quiet">${t('credits.close')}</button>
    </div>`;
}

export function openCredits(audio: AudioManifest, click: () => void = () => {}): void {
  const root = document.createElement('div');
  // The overlay and panel of How to play, so the two read as one family.
  root.className = 'how-to-play credits';
  root.innerHTML = creditsHtml(audio);
  document.body.append(root);
  root.querySelector('.close')?.addEventListener('click', () => {
    click();
    root.remove();
  });
  // A click on the dimmed menu around the panel closes it too, as How to play's does.
  root.addEventListener('click', (event) => {
    if (event.target === root) root.remove();
  });
}
