/**
 * The page's saved settings — the looks, the name, the language, the volumes — read and
 * written in one place. A browser may refuse storage outright, as some private windows do,
 * and then reading finds nothing and writing keeps the choice for this page only.
 */

/** What was saved under `key`, or null when nothing was or storage is refused. */
export function stored(key: string, where: 'local' | 'session' = 'local'): string | null {
  try {
    return area(where)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Saves `value` under `key`, quietly not when storage is refused. */
export function store(key: string, value: string, where: 'local' | 'session' = 'local'): void {
  try {
    area(where)?.setItem(key, value);
  } catch {
    // Refused: the choice holds for this page only.
  }
}

function area(where: 'local' | 'session'): Storage | undefined {
  return where === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
}
