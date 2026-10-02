import {
  AUDIO_LICENCES,
  DISCLAIMER,
  audioCredits,
  type AudioManifest,
  type CreditedFile,
} from '@bollwerk/config';

import { escape } from './lobby.js';

/**
 * The menu's Credits: what the game owes Rampart, and who made each sound, on what
 * licence — made from the audio manifest, as `CREDITS.md` is, so the two always agree.
 */

function item({ path, credit }: CreditedFile): string {
  if (credit === null) return `<li><code>${escape(path)}</code> <em>not yet credited</em></li>`;
  const link = (href: string, text: string): string =>
    `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  const changes = credit.changes === undefined ? '' : ` ${escape(credit.changes)}`;
  return (
    `<li>“${escape(credit.title)}” by ${escape(credit.author)} — ` +
    `${link(AUDIO_LICENCES[credit.licence], credit.licence)}, ` +
    `${link(credit.source, 'source')}.${changes}</li>`
  );
}

/** The panel's markup, apart so a test can read it without a page. */
export function creditsHtml(audio: AudioManifest): string {
  const { music, sfx } = audioCredits(audio);
  return `
    <div class="panel">
      <h2>Credits</h2>
      <p class="disclaimer">${escape(DISCLAIMER)}</p>
      <p class="disclaimer">The code is under the MIT licence.</p>
      <div class="list">
        <h3>Music</h3>
        <ul>${music.map(item).join('')}</ul>
        <h3>Sound effects</h3>
        <ul>${sfx.map(item).join('')}</ul>
      </div>
      <button class="close quiet">Close</button>
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
