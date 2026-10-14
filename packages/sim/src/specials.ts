import type { CraterPattern, Ruleset, SpecialKind } from '@bollwerk/config';

import type { Rejection } from './placement.js';
import { Structure, type CannonKind, type MatchState, type PlayerState } from './types.js';

/**
 * The special towers' rules (docs/SPECIAL_TOWERS.md): what one costs, where it may stand,
 * how its shots fly and land, and the Architect's repair. With `specials.enabled` off no
 * player can buy one, every cannon is an ordinary one, and nothing here changes a match.
 */

/**
 * Whether a kind's shot does something of its own where it lands. Such a tower fires
 * before any other gun whenever it is ready, so a player aims it by when they click; a
 * tower that fires ordinary shots, however quickly, fires as any gun.
 */
export function isImpactTower(kind: CannonKind): boolean {
  return kind === 'bertha';
}

/** The footprint a gun of this kind stands on. */
export function footprintOf(ruleset: Ruleset, kind: CannonKind): readonly [number, number] {
  return kind === 'cannon' ? ruleset.cannons.footprint : ruleset.specials[kind].footprint;
}

/** The factor on a shot's flight — its reload — for a gun of this kind. */
export function flightFactorOf(ruleset: Ruleset, kind: CannonKind): number {
  return kind === 'cannon' ? 1 : ruleset.specials[kind].flightFactor;
}

/** The crater a shot from a gun of this kind clears. */
export function craterOf(ruleset: Ruleset, kind: CannonKind): CraterPattern {
  return kind === 'bertha' ? ruleset.specials.bertha.crater : ruleset.shots.craterPattern;
}

/** What a tower of this kind costs in cannon placements. */
export function towerCost(ruleset: Ruleset, kind: SpecialKind): number {
  return ruleset.specials[kind].cost;
}

/** Special towers standing on this player's island. */
export function towersOwned(state: MatchState, playerId: number): number {
  let count = 0;
  for (const cannon of state.cannons) {
    if (cannon.owner === playerId && cannon.kind !== 'cannon') count++;
  }
  return count;
}

/**
 * Why this player may not buy their tower now, wherever it would stand; null if they may.
 * Checked before the footprint, so a refusal names the rule rather than the ground.
 */
export function specialRefusal(state: MatchState, player: PlayerState): Rejection | null {
  const { specials } = state.ruleset;
  if (!specials.enabled) return 'special_off';
  if (player.special === null) return 'no_special';
  if (player.openingPlacement) return 'special_at_opening';
  if (player.specialsBought >= specials.perRound) return 'special_this_round';
  if (specials.maxOwned !== null && towersOwned(state, player.id) >= specials.maxOwned) {
    return 'special_cap';
  }
  if (player.cannonsToPlace < towerCost(state.ruleset, player.special)) return 'special_too_dear';
  return null;
}

/**
 * Notes a wall tile a shot has just cleared, for the Architects' repair. Kept only while
 * towers are played, so a classic match's state is as it always was.
 */
export function noteLostWall(state: MatchState, tile: number): void {
  if (state.ruleset.specials.enabled) state.lostWalls.push(tile);
}

/**
 * The Architects' repair, once a barrage is over and its last shot down: each active
 * Architect rebuilds its owner's walls lost to shots within `repairRadius` of its
 * footprint, where the tile is still free, in seat order. A breach the owner has already
 * built over, or a wall swept as an orphan, is never touched — only what shots took.
 *
 * Active as of the last time the enclosure was solved, the rule that lets a gun fire:
 * shots landing do not refresh it, so an Architect behind a breach still repairs, which
 * is the point of it. The attacker keeps the points for the walls, since the shots landed.
 */
export function repairWalls(state: MatchState): void {
  const lost = state.lostWalls;
  if (lost.length === 0) return;
  state.lostWalls = [];
  const r = state.ruleset.specials.architect.repairRadius;
  for (const player of state.players) {
    if (player.eliminated) continue;
    const tiles: number[] = [];
    for (const cannon of state.cannons) {
      if (cannon.owner !== player.id || cannon.kind !== 'architect' || !cannon.active) continue;
      const x0 = cannon.x - r;
      const y0 = cannon.y - r;
      const x1 = cannon.x + cannon.w - 1 + r;
      const y1 = cannon.y + cannon.h - 1 + r;
      for (const i of lost) {
        if (state.islandId[i] !== player.islandId || state.structure[i] !== Structure.Empty) {
          continue;
        }
        const x = i % state.width;
        const y = (i - x) / state.width;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        state.structure[i] = Structure.Wall;
        state.owner[i] = player.islandId;
        tiles.push(i);
      }
    }
    if (tiles.length > 0) {
      state.events.push({ kind: 'walls_repaired', tick: state.tick, player: player.id, tiles });
    }
  }
}
