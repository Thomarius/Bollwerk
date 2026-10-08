import { PROTOCOL_VERSION, RoomListSchema, type RoomListing } from '@bollwerk/protocol';

import { escape } from './html.js';
import type { TextKey } from '@bollwerk/config';

import { t } from './i18n.js';

/**
 * The open games browser in the menu (PLAN 11.12 F3): public rooms still being set, each
 * with a Join button, refreshed every few seconds while the menu is open. Fetched over
 * plain HTTP, since the menu has no socket open.
 */

/** How often the menu asks again. */
export const REFRESH_MS = 3000;

/**
 * The rooms a server listed, or null when there is nothing to show a browser for: no
 * server at all — the dev server answers any path with its page, not JSON — or one on
 * another protocol, whose rooms this page could not join.
 */
export function parseRoomList(body: unknown): RoomListing[] | null {
  const parsed = RoomListSchema.safeParse(body);
  if (!parsed.success || parsed.data.protocol !== PROTOCOL_VERSION) return null;
  return parsed.data.rooms;
}

/** The list's markup: a row per room, or a line saying there are none yet. */
export function gamesMarkup(rooms: readonly RoomListing[]): string {
  if (rooms.length === 0) {
    return `<p class="note">${t('browser.none')}</p>`;
  }
  const rows = rooms.map((room) => {
    const detail = [
      ...(room.tournament === null ? [] : [t('browser.tournament', { team: room.tournament })]),
      t('browser.seated', { people: room.people, players: room.playerCount }),
      ...(room.teamSize > 1 ? [t('browser.teams', { n: room.teamSize })] : []),
      t('browser.rounds', { n: room.maxRounds }),
    ].join(' · ');
    return (
      `<li><span class="host">${escape(room.host)}</span>` +
      `<span class="detail">${detail}</span>` +
      `<button class="join-open" data-code="${escape(room.code)}">${t('browser.join')}</button></li>`
    );
  });
  return `<ul class="open-games">${rows.join('')}</ul>`;
}

/** The refusals a player can be told of in their own language, by the server's code. */
const REFUSALS: Record<string, TextKey> = {
  bad_message: 'refusal.bad_message',
  no_capacity: 'refusal.no_capacity',
  no_room: 'refusal.no_room',
  room_full: 'refusal.room_full',
};

/**
 * What a server's refusal says, in the player's language where the code is known; a code
 * this page does not know — a newer server's — keeps the server's own English words, so it
 * still says something.
 */
export function refusalText(code: string, message: string): string {
  const key = REFUSALS[code];
  return key === undefined ? message : t(key);
}

/** What the menu is told when a room it chose went while it was looking. */
export function joinRefusedNotice(code: string): string | null {
  switch (code) {
    case 'room_full':
      return t('browser.refused.full');
    case 'no_room':
      return t('browser.refused.closed');
    default:
      return null;
  }
}
