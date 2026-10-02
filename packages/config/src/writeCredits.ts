import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { creditsMarkdown } from './credits.js';
import { defaultAudioManifest } from './defaults.js';

/** `npm run credits`: writes `CREDITS.md` at the repository root from the audio manifest. */
const target = fileURLToPath(new URL('../../../CREDITS.md', import.meta.url));
writeFileSync(target, creditsMarkdown(defaultAudioManifest));
process.stdout.write(`wrote ${target}\n`);
