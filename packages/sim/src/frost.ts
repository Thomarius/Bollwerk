import type { FrostVariant, TowerCost } from '@bollwerk/config';

import { Terrain, type Freeze, type MatchState, type Shot } from './types.js';

/**
 * The Frost Cannon's freeze (the user's design, 2026-10-21; docs/SPECIAL_TOWERS.md §2.7): its
 * shot lands as an ordinary one, and the tile it hits — a wall it clears or bare ground — is
 * frozen for the first `freezeShare` of the next build phase, nothing to be built on it; 1 is
 * the whole phase, its overtime too where `throughOvertime` says so. The cannon phase after is never touched: every freeze is
 * gone as the build phase ends. An Architect in reach thaws it (`repairWalls`), and a continue,
 * wiping the island, wipes its freezes with it.
 */

/** A freeze's `thawTick` until its build phase opens. */
export const FREEZE_PENDING = -1;
/** A freeze's `thawTick` when it lasts the whole build phase, overtime and all. */
export const FROZEN_TO_END = 0x7fffffff;

/** A Frost Cannon's levers at this cost. */
function frostOf(state: MatchState, cost: number): FrostVariant {
  const frost = state.ruleset.specials.frost?.[cost as TowerCost] as FrostVariant | undefined;
  if (frost === undefined) throw new Error(`no frost at cost ${cost} in this ruleset`);
  return frost;
}

/** Whether a freeze lasts the whole build phase, its overtime and all. */
function toEnd(f: Pick<Freeze, 'share' | 'throughOvertime'>): boolean {
  return f.share >= 1 && f.throughOvertime;
}

/**
 * A Frost Cannon's shot has landed: its tile frozen for the next build phase, if it is land —
 * the sea takes no piece anyway. A tile frozen twice keeps the longer of the two.
 */
export function freezeTile(state: MatchState, shot: Shot): void {
  const { width, height } = state;
  if (shot.toX < 0 || shot.toY < 0 || shot.toX >= width || shot.toY >= height) return;
  const tile = shot.toY * width + shot.toX;
  if (state.terrain[tile] !== Terrain.Land) return;
  const { freezeShare: share, throughOvertime } = frostOf(state, shot.cost);
  const fresh = { tile, share, throughOvertime, thawTick: FREEZE_PENDING };
  const known = state.frozen.find((f) => f.tile === tile);
  // Replaced, never changed in place: a rollout's copy of the match shares nothing it writes.
  if (known === undefined) {
    state.frozen = [...state.frozen, fresh];
  } else if (known.share < share || (known.share === share && toEnd(fresh) && !toEnd(known))) {
    state.frozen = state.frozen.map((f) => (f === known ? fresh : f));
  }
  state.events.push({
    kind: 'tile_frozen',
    tick: state.tick,
    shotId: shot.id,
    owner: shot.owner,
    tile,
  });
}

/** As a build phase opens: every freeze waiting for it starts, and is given the tick it thaws. */
export function startFreezes(state: MatchState): void {
  if (state.frozen.length === 0) return;
  // As `ticksFor` has it, which lives with the phases this module's caller runs.
  const phaseTicks = Math.ceil((state.ruleset.phases.buildMs * state.ruleset.tickRateHz) / 1000);
  state.frozen = state.frozen.map((f): Freeze => ({
    ...f,
    // A whole phase's that stops at the overtime thaws on the tick the clock runs out, which
    // is the tick the overtime begins.
    thawTick: toEnd(f) ? FROZEN_TO_END : state.tick + Math.ceil(f.share * phaseTicks),
  }));
}

/** Whether nothing may be built on this tile now: frozen, in the build phase it was meant for. */
export function isFrozen(state: MatchState, tile: number): boolean {
  if (state.frozen.length === 0 || state.phase !== 'build') return false;
  for (const f of state.frozen) {
    if (f.tile === tile && f.thawTick !== FREEZE_PENDING && state.tick < f.thawTick) return true;
  }
  return false;
}

/** Every tick of a build phase: the freezes whose time is up, gone. */
export function thawExpired(state: MatchState): void {
  if (state.frozen.length === 0) return;
  if (state.frozen.some((f) => f.thawTick !== FREEZE_PENDING && state.tick >= f.thawTick)) {
    state.frozen = state.frozen.filter(
      (f) => f.thawTick === FREEZE_PENDING || state.tick < f.thawTick,
    );
  }
}

/** Thaws these tiles, whatever is left of their freeze. */
export function thawTiles(state: MatchState, tiles: ReadonlySet<number>): void {
  if (tiles.size === 0) return;
  state.frozen = state.frozen.filter((f) => !tiles.has(f.tile));
}
