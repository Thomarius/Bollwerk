/* global process */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { build } from 'esbuild';

/** Resolved from this file, so the script works from any working directory. */
const here = import.meta.dirname;

/**
 * Bundles the desktop app (PLAN 11.17 A2): Electron's main process, the server and the
 * whole simulation with it, as one file, as the server's own build does for the image;
 * the preload, which Electron runs sandboxed and so wants CommonJS; and the window's own
 * script. Electron itself is provided at run time and left out.
 */
/**
 * The commit this build is of, baked into the app so recordings it makes replay against
 * the right code (PLAN §9): `RAMPART_COMMIT` first, as CI sets it, then git, marked
 * `-dirty` with uncommitted changes; null when neither can tell.
 */
function commit() {
  const given = process.env.RAMPART_COMMIT?.trim();
  if (given) return given;
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: here,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const head = git('rev-parse', '--short=12', 'HEAD');
    return git('status', '--porcelain', '--untracked-files=no') === '' ? head : `${head}-dirty`;
  } catch {
    return null;
  }
}

const shared = { bundle: true, logLevel: 'info', target: 'node22' };

await build({
  ...shared,
  entryPoints: [resolve(here, 'src', 'main.ts')],
  outfile: resolve(here, 'dist', 'main.js'),
  define: { __RAMPART_COMMIT__: JSON.stringify(commit()) },
  platform: 'node',
  format: 'esm',
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  // ws is CommonJS, and needs a real `require` inside an ES module; see the server's build.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

await build({
  ...shared,
  entryPoints: [resolve(here, 'src', 'preload.ts')],
  outfile: resolve(here, 'dist', 'preload.cjs'),
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});

await build({
  ...shared,
  entryPoints: [resolve(here, 'src', 'window.ts')],
  outfile: resolve(here, 'dist', 'window.js'),
  platform: 'browser',
  format: 'esm',
  target: 'chrome130',
});
