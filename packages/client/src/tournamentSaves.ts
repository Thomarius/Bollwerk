import { parseSave, type Save } from '@bollwerk/tournament';

/**
 * Tournaments saved on this computer (TOURNAMENT §1.1), in the browser's local storage —
 * the desktop app's window included: one key a tournament, found by its prefix, so there is
 * no index to fall out of step with them. A save is written whole by one `setItem`, so a tab
 * closed mid-write leaves the old save or the new, never half of one.
 */

const PREFIX = 'bollwerk.tournament.';

/** A tournament found in storage: readable, or of another version, or damaged. */
export type SavedTournament =
  | { id: string; kind: 'ok'; save: Save }
  | {
      id: string;
      kind: 'version' | 'invalid';
      /** What could still be read of it, for the resume list to name it by. */
      name: string | null;
      playedAt: string | null;
    };

/** The storage tournaments live in, or null where the browser refuses it. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Every saved tournament, the one played last first. */
export function savedTournaments(area: Storage | null = storage()): SavedTournament[] {
  if (area === null) return [];
  const out: SavedTournament[] = [];
  for (let i = 0; i < area.length; i++) {
    const key = area.key(i);
    if (key === null || !key.startsWith(PREFIX)) continue;
    out.push(readSaved(key.slice(PREFIX.length), area.getItem(key)));
  }
  const played = (entry: SavedTournament): string =>
    (entry.kind === 'ok' ? entry.save.playedAt : entry.playedAt) ?? '';
  return out.sort((a, b) => played(b).localeCompare(played(a)));
}

function readSaved(id: string, text: string | null): SavedTournament {
  let raw: unknown = null;
  try {
    raw = JSON.parse(text ?? 'null');
  } catch {
    // Not JSON at all: damaged, and named by nothing.
  }
  const parsed = parseSave(raw);
  if (parsed.ok) return { id, kind: 'ok', save: parsed.save };
  const loose = raw as {
    teams?: { name?: unknown }[];
    playedAt?: unknown;
  } | null;
  const name = loose?.teams?.[0]?.name;
  const playedAt = loose?.playedAt;
  return {
    id,
    kind: parsed.reason,
    name: typeof name === 'string' ? name : null,
    playedAt: typeof playedAt === 'string' ? playedAt : null,
  };
}

/** One saved tournament by id, or null when it is gone or unreadable. */
export function loadTournament(id: string, area: Storage | null = storage()): Save | null {
  const entry = readSaved(id, area?.getItem(PREFIX + id) ?? null);
  return entry.kind === 'ok' ? entry.save : null;
}

/**
 * Saves a tournament whole. False when the browser refused — storage full or switched off —
 * which the caller must tell the player about, since the progress would be lost.
 */
export function writeTournament(save: Save, area: Storage | null = storage()): boolean {
  if (area === null) return false;
  try {
    area.setItem(PREFIX + save.id, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function deleteTournament(id: string, area: Storage | null = storage()): void {
  try {
    area?.removeItem(PREFIX + id);
  } catch {
    // Refused: nothing was deleted, and the list shows it still there.
  }
}

/** A new tournament's id: its start in base 36 and a random tail, safe as a key. */
export function newTournamentId(now: Date): string {
  const tail = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `t-${now.getTime().toString(36)}-${tail}`;
}
