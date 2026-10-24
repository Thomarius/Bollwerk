import { Structure, Terrain, type MatchState } from '@bollwerk/sim';

import { hash } from '../noise.js';

import { CLAN_HAIR, CLANS, type Clan, type Hairstyle } from './figures.js';

/**
 * Who is who in the Anime style (ARCHIVE 14w): a clan to each team, a hairstyle to
 * each gun, and where a cut-in may stand. All from the seed and the board, so every client sees
 * the same cast; nothing here reaches the simulation.
 */

/**
 * The clans in the order a match deals them to its teams: the eight shuffled by the seed, so
 * up to eight teams are each a different clan, and which clan a team is changes from match to
 * match.
 */
export function clanOrder(seed: number): Clan[] {
  const order = [...CLANS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i, seed, 7700) * (i + 1));
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

/** A team's clan: teammates are one clan, in their own hair colours. */
export function clanOfTeam(team: number, seed: number): Clan {
  const order = clanOrder(seed);
  return order[team % order.length] ?? 'karate';
}

/** A player's clan, by their team. */
export function clanOf(state: MatchState, player: number): Clan {
  return clanOfTeam(state.players[player]?.team ?? player, state.seed);
}

/** Which of its clan's two hairstyles a gun wears, by its id and the seed. */
export function hairOf(clan: Clan, cannonId: number, seed: number): Hairstyle {
  return CLAN_HAIR[clan][hash(cannonId, seed, 7710) < 0.5 ? 0 : 1];
}

/** A player's hero, as the banners show them: their clan, in its first hairstyle. */
export function heroHair(clan: Clan, player: number, seed: number): Hairstyle {
  return CLAN_HAIR[clan][hash(player, seed, 7720) < 0.5 ? 0 : 1];
}

/** A rectangle of tiles: its top-left corner and its size. */
export interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a cut-in of `w` by `h` tiles may stand nearest to (`cx`, `cy`), or null if nowhere near
 * will do (the user's rules, ARCHIVE 14w): over open sea, or over bare land with
 * nothing in play — no wall, gun, castle or sealed ground — within `clear` tiles of it, and
 * never on the island of `viewer`, who may be about to build there; inside `bounds`, the tiles
 * on screen; and clear of every box in `avoid` (the big timer, the corner piece). Searched in
 * rings out from the spot to `reach` tiles, so the nearest place wins.
 */
export function cutInSpot(
  state: MatchState,
  cx: number,
  cy: number,
  w: number,
  h: number,
  options: {
    clear: number;
    viewer: number;
    bounds: TileBox;
    avoid: readonly TileBox[];
    reach: number;
  },
): TileBox | null {
  const { clear, viewer, bounds, avoid, reach } = options;
  const { width, height } = state;
  const inPlay = new Uint8Array(width * height);
  const mark = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) inPlay[y * width + x] = 1;
  };
  const markBox = (bx: number, by: number, bw: number, bh: number): void => {
    for (let y = by - clear; y < by + bh + clear; y++) {
      for (let x = bx - clear; x < bx + bw + clear; x++) mark(x, y);
    }
  };
  for (let i = 0; i < width * height; i++) {
    if (state.structure[i] !== Structure.Wall && state.territory[i] === 0) continue;
    markBox(i % width, Math.floor(i / width), 1, 1);
  }
  for (const c of state.castles) markBox(c.x, c.y, c.w, c.h);
  for (const c of state.cannons) markBox(c.x, c.y, c.w, c.h);
  const viewerIsland = viewer >= 0 ? viewer + 1 : -1;
  const free = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    const i = y * width + x;
    if (state.terrain[i] !== Terrain.Land) return true;
    return inPlay[i] === 0 && state.islandId[i] !== viewerIsland;
  };
  const overlaps = (a: TileBox, b: TileBox): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const fits = (box: TileBox): boolean => {
    if (box.x < bounds.x || box.y < bounds.y) return false;
    if (box.x + box.w > bounds.x + bounds.w || box.y + box.h > bounds.y + bounds.h) return false;
    if (avoid.some((a) => overlaps(a, box))) return false;
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) if (!free(x, y)) return false;
    }
    return true;
  };
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  for (let r = 0; r <= reach; r++) {
    let best: TileBox | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const box = { x: x0 + dx, y: y0 + dy, w, h };
        const d = dx * dx + dy * dy;
        if (d < bestDistance && fits(box)) {
          best = box;
          bestDistance = d;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}
