/* global process, console */
import { execFileSync } from 'node:child_process';

/**
 * Packages the desktop app for the system this runs on (PLAN 11.17 A3): a portable .exe on
 * Windows, an AppImage on Linux, into `release/`. Each is built on its own system, here or
 * in CI on demand (A4); it wants `npm run build` at the repository root first, for the
 * client it carries. `BOLLWERK_VERSION` sets the release's version, as a tag does in CI.
 */
const target = { win32: '--win', linux: '--linux' }[process.platform];
if (target === undefined) {
  console.error(`no portable build for ${process.platform}: only Windows and Linux are made`);
  process.exit(1);
}
const version = process.env.BOLLWERK_VERSION?.trim();
execFileSync(
  'npx',
  [
    'electron-builder',
    target,
    '--publish',
    'never',
    ...(version ? [`-c.extraMetadata.version=${version}`] : []),
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
