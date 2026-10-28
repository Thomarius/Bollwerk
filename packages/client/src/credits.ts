import {
  ArtStyleSchema,
  AUDIO_LICENCES,
  audioCredits,
  type ArtStyle,
  type AudioManifest,
  type CreditedFile,
} from '@bollwerk/config';

import { t } from './i18n.js';
import { escape } from './html.js';
import { lookName } from './looks.js';

/**
 * The menu's Credits: what the game owes Rampart, who made each sound and each typeface, on
 * what licence — made from the audio manifest, as `CREDITS.md` is, so the two always agree.
 */

/** The style a track is the own music of, from its path (`music/styles/<style>.mp3`), or null. */
export function trackStyle(path: string): ArtStyle | null {
  const named = /^music\/styles\/([^/.]+)\.[^/]+$/.exec(path)?.[1];
  const style = ArtStyleSchema.safeParse(named);
  return style.success ? style.data : null;
}

function item({ path, credit }: CreditedFile): string {
  if (credit === null) {
    return `<li><code>${escape(path)}</code> <em>${t('credits.uncredited')}</em></li>`;
  }
  const link = (href: string, text: string): string =>
    `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  const changes = credit.changes === undefined ? '' : ` ${escape(credit.changes)}`;
  // A style's own track named for its style: by its author alone, many had said nothing of
  // what they were (2026-10-28).
  const style = trackStyle(path);
  const what = path.endsWith('/')
    ? `${t('credits.everySound')} `
    : style === null
      ? ''
      : `<b class="style">${escape(lookName(style))}:</b> `;
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

/**
 * The menus' typefaces (PLAN §11 item 4, MS1), bundled with the game under the SIL Open Font
 * License, whose text is served beside them from `assets/fonts/`, as it asks.
 */
const FONTS = [
  {
    title: 'Inter',
    author: 'The Inter Project Authors',
    source: 'https://github.com/rsms/inter',
    licence: '/fonts/Inter-OFL.txt',
  },
  {
    title: 'Rubik',
    author: 'The Rubik Project Authors',
    source: 'https://github.com/googlefonts/rubik',
    licence: '/fonts/Rubik-OFL.txt',
  },
] as const;

function fontItem(font: (typeof FONTS)[number]): string {
  const link = (href: string, text: string): string =>
    `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  return `<li>${t('credits.item', {
    title: `“${font.title}” `,
    author: font.author,
    licence: link(font.licence, 'SIL Open Font License 1.1'),
    source: link(font.source, t('credits.source')),
  })}</li>`;
}

/** A group of credits, folded: its heading and how many it holds, opened with a click. */
function group(heading: string, items: readonly string[]): string {
  return (
    `<details class="credit-group"><summary><span>${heading}</span><span class="count">${items.length}</span></summary>` +
    `<ul>${items.join('')}</ul></details>`
  );
}

/**
 * The panel's markup, apart so a test can read it without a page: the disclaimer, then the
 * credits in folded groups — the shared music, the styles' music by style, the sound effects,
 * the typefaces — where one long list had been a wall of text (2026-10-28).
 */
export function creditsHtml(audio: AudioManifest): string {
  const { music, sfx } = audioCredits(audio);
  const styled = music
    .filter((file) => trackStyle(file.path) !== null)
    .sort((a, b) => lookName(trackStyle(a.path)!).localeCompare(lookName(trackStyle(b.path)!)));
  const shared = music.filter((file) => trackStyle(file.path) === null);
  return `
    <div class="panel">
      <h2>${t('credits.title')}</h2>
      <p class="disclaimer">${escape(t('credits.disclaimer'))}</p>
      <p class="disclaimer">${t('credits.mit')}</p>
      <div class="list">
        ${group(t('credits.music'), shared.map(item))}
        ${group(t('credits.styleMusic'), styled.map(item))}
        ${group(t('credits.sfx'), sfx.map(item))}
        ${group(t('credits.fonts'), FONTS.map(fontItem))}
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
