import { defaultAudioManifest, type AudioManifest } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { creditsHtml } from './credits.js';

describe('the Credits', () => {
  it('names the original and its owner, and lists every file', () => {
    const html = creditsHtml(defaultAudioManifest);
    expect(html).toContain('inspired by Rampart (Atari Games, 1990)');
    expect(html).toContain('Warner Bros. Entertainment');
    expect(html).toContain('<code>sfx/shot_impact.9.wav</code> <em>not yet credited</em>');
  });

  it('shows a credit with its licence and source linked, and escapes what it was given', () => {
    const audio: AudioManifest = {
      ...defaultAudioManifest,
      credits: {
        'sfx/select.wav': {
          title: 'Click <1>',
          author: 'A & B',
          licence: 'CC-BY 4.0',
          source: 'https://opengameart.org/content/click',
          changes: 'Trimmed.',
        },
      },
    };
    const html = creditsHtml(audio);
    expect(html).toContain('“Click &lt;1&gt;” by A &amp; B');
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(html).toContain('href="https://opengameart.org/content/click"');
    expect(html).toContain('Trimmed.');
    expect(html).not.toContain('<code>sfx/select.wav</code>');
  });
});
