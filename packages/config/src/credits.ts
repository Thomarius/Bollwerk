import en from '../../../config/locale/en.json' with { type: 'json' };

import { AUDIO_LICENCES, audioCredits, type AudioManifest, type CreditedFile } from './audio.js';

/**
 * The game's attribution, said once and shown in the menu, the Credits, the desktop app
 * and `CREDITS.md`. Bollwerk takes its rules from Rampart and nothing else — no code,
 * graphics or sound — and must never read as the original or as endorsed by its owner.
 * The English texts, from the English locale: the game shows them in the player's language
 * (`credits.inspiredBy`, `credits.disclaimer`), `CREDITS.md` always in English.
 */
export const INSPIRED_BY = en['credits.inspiredBy'];

export const DISCLAIMER = en['credits.disclaimer'];

/** Credits are free text: whatever Markdown would read as formatting is shown as itself. */
function plain(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, '\\$&');
}

function line({ path, credit }: CreditedFile): string {
  if (credit === null) return `- \`${path}\`: not yet credited`;
  const what = path.endsWith('/') ? `Every file in \`${path}\`` : `\`${path}\``;
  const title = credit.title === undefined ? '' : `“${plain(credit.title)}” `;
  const changes = credit.changes === undefined ? '' : ` Changes: ${plain(credit.changes)}`;
  return (
    `- ${what}: ${title}by ${plain(credit.author)}, ` +
    `[${credit.licence}](${AUDIO_LICENCES[credit.licence]}), from <${credit.source}>.${changes}`
  );
}

/**
 * `CREDITS.md`, made from the manifest by `npm run credits` and checked against it by a
 * test, so the file in the repository cannot fall behind the sounds the game plays.
 */
export function creditsMarkdown(audio: AudioManifest): string {
  const { music, sfx } = audioCredits(audio);
  return [
    '# Credits',
    '',
    DISCLAIMER.replace(/Bollwerk/, '_Bollwerk_').replace(/Rampart/g, '_Rampart_'),
    '',
    'The code is under the MIT licence.',
    '',
    '## Audio',
    '',
    'Made from `config/audio.manifest.json` by `npm run credits`: edit the manifest, not',
    'this file.',
    '',
    '### Music',
    '',
    ...music.map(line),
    '',
    '### Sound effects',
    '',
    ...sfx.map(line),
    '',
  ].join('\n');
}
