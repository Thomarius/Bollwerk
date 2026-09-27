import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

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

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Every path a cue may load: its file, and `.2`, `.3`, … up to its variant count. */
function pathsOf(file: string, variants = 1): string[] {
  const paths = [file];
  for (let n = 2; n <= variants; n++) paths.push(file.replace(/(\.[^.]+)$/, `.${n}$1`));
  return paths;
}

const entries = [
  ...Object.entries(defaultAudioManifest.sfx),
  ...Object.entries(defaultAudioManifest.music),
].map(([cue, entry]) => ({ cue, paths: pathsOf(entry.file, entry.variants) }));

describe('audio files and the manifest', () => {
  it('registers every audio file in the folder', () => {
    const named = new Set(entries.flatMap((e) => e.paths));
    const onDisk = filesUnder(audioDir)
      .map((path) => relative(audioDir, path).split('\\').join('/'))
      .filter((path) => !path.endsWith('.md'));
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
});
