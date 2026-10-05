import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@achingbrain/ssdp`, under the UPnP library (PLAN 11.21), reads its own `package.json` at
 * run time to sign its messages — `require('../../package.json')` — which no bundle can
 * resolve: the server died on start with "Cannot find module '../../package.json'". This
 * writes the name and version into its code as it is bundled, read from the real file then.
 * Shared by the server's bundle and the desktop app's.
 */
export const ssdpPackageJson = {
  name: 'ssdp-package-json',
  setup(build) {
    build.onLoad({ filter: /@achingbrain[\\/]ssdp[\\/]dist[\\/]src[\\/]ssdp\.js$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { name, version } = JSON.parse(
        readFileSync(join(args.path, '..', '..', '..', 'package.json'), 'utf8'),
      );
      const call = "req('../../package.json')";
      if (!source.includes(call)) {
        throw new Error('@achingbrain/ssdp no longer reads its package.json as expected');
      }
      return { contents: source.replace(call, JSON.stringify({ name, version })), loader: 'js' };
    });
  },
};
