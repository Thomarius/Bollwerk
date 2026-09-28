import { execFileSync } from 'node:child_process';

/**
 * Which code this server is: the commit it runs, marked `-dirty` when the working tree
 * holds changes to tracked files, since a recording replays exactly only against the code
 * that made it (PLAN §9). `RAMPART_COMMIT` first, which the image is built with, since it
 * carries no repository; otherwise asked of git; otherwise unknown, and recordings go
 * without it rather than the server without recordings.
 */
export function codeVersion(root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const given = env.RAMPART_COMMIT?.trim();
  if (given) return given;
  try {
    const git = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const commit = git('rev-parse', '--short=12', 'HEAD');
    const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return null;
  }
}
