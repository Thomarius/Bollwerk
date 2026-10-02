import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cuePaths } from './audio.js';
import { creditsMarkdown } from './credits.js';
import { defaultAudioManifest } from './defaults.js';

/**
 * The audio folder and the manifest, kept in step.
 *
 * A file the manifest does not name is never played, and the game cannot say so: absent
 * and unregistered sound the same, which is silence. Nor can the browser tell a missing
 * numbered variant from a present one without fetching it. So both directions are checked
 * here, against the files actually committed. A cue with no file at all is fine — missing
 * sound is silent by design — but a cue that has files must name exactly the ones it has.
 */

const audioDir = fileURLToPath(new URL('../../../assets/audio', import.meta.url));
const creditsFile = fileURLToPath(new URL('../../../CREDITS.md', import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const entries = [
  ...Object.entries(defaultAudioManifest.sfx),
  ...Object.entries(defaultAudioManifest.music),
].map(([cue, entry]) => ({ cue, paths: cuePaths(entry) }));

const onDisk = filesUnder(audioDir)
  .map((path) => relative(audioDir, path).split('\\').join('/'))
  .filter((path) => !path.endsWith('.md'));

describe('audio files and the manifest', () => {
  it('registers every audio file in the folder', () => {
    const named = new Set(entries.flatMap((e) => e.paths));
    expect(onDisk.filter((path) => !named.has(path))).toEqual([]);
  });

  it('claims no more variants than a supplied cue has', () => {
    const short = entries.flatMap(({ cue, paths }) => {
      const present = paths.filter((path) => existsSync(join(audioDir, path)));
      // Not supplied at all is allowed: that cue is simply silent until it is.
      return present.length === 0 || present.length === paths.length
        ? []
        : [`${cue}: ${present.length} of ${paths.length}`];
    });
    expect(short).toEqual([]);
  });

  /**
   * Every file shipped must say who made it: the attribution licences require it. Until
   * the credits are gathered a missing one is a warning here, and an error under
   * `BOLLWERK_REQUIRE_CREDITS=1`, which the release workflow sets — so no release can
   * go out with a sound uncredited.
   */
  it('credits every audio file in the folder', () => {
    const uncredited = onDisk.filter((path) => defaultAudioManifest.credits[path] === undefined);
    if (process.env.BOLLWERK_REQUIRE_CREDITS === '1') expect(uncredited).toEqual([]);
    else if (uncredited.length > 0) {
      console.warn(`${uncredited.length} audio files not yet credited in the manifest`);
    }
  });

  it('has CREDITS.md made from the manifest as it stands', () => {
    // `npm run credits` writes it; a stale one would credit sounds the game no longer plays.
    expect(readFileSync(creditsFile, 'utf8')).toBe(creditsMarkdown(defaultAudioManifest));
  });
});
