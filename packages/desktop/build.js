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
const shared = { bundle: true, logLevel: 'info', target: 'node22' };

await build({
  ...shared,
  entryPoints: [resolve(here, 'src', 'main.ts')],
  outfile: resolve(here, 'dist', 'main.js'),
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
