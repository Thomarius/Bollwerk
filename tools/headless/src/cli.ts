import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What the harness and the soak share: where the repository is, and reading their flags. */

/** The repository, from this file's place in it: tools/headless/src -> ../../.. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Stops with a usage error: a mistyped flag ran the defaults, and a soak hours long with them. */
export function usageError(message: string): never {
  console.error(message);
  process.exit(2);
}

/** A flag's value as a whole number of at least `min`, or a usage error naming the flag. */
export function wholeNumber(flag: string, value: string, min = 0): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n) || n < min) {
    usageError(`--${flag} wants a whole number of at least ${min}, not "${value}"`);
  }
  return n;
}
