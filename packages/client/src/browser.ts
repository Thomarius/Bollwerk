import { PROTOCOL_VERSION, RoomListSchema, type RoomListing } from '@bollwerk/protocol';

import { escape } from './lobby.js';

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
    return '<p class="note">No open games</p>';
  }
  const rows = rooms.map((room) => {
    const teams = room.teamSize > 1 ? ` · teams of ${room.teamSize}` : '';
    return (
      `<li><span class="host">${escape(room.host)}</span>` +
      `<span class="detail">${room.people} of ${room.playerCount} seated${teams} · ${room.maxRounds} rounds</span>` +
      `<button class="join-open" data-code="${escape(room.code)}">Join</button></li>`
    );
  });
  return `<ul class="open-games">${rows.join('')}</ul>`;
}

/** What the menu is told when a room it chose went while it was looking. */
export function joinRefusedNotice(code: string): string | null {
  switch (code) {
    case 'room_full':
      return 'That game filled up or started before you got there. Here are the open ones now.';
    case 'no_room':
      return 'That game has closed. Here are the open ones now.';
    default:
      return null;
  }
}
