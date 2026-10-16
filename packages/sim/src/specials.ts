import {
  variantConfig,
  variantCost,
  variantOf,
  type CraterPattern,
  type Ruleset,
  type TowerCost,
  type TowerVariant,
} from '@bollwerk/config';

import type { Rejection } from './placement.js';
import {
  Structure,
  type Cannon,
  type CannonKind,
  type MatchState,
  type PlayerState,
} from './types.js';

/**
 * The special towers' rules (docs/SPECIAL_TOWERS.md): what one costs, where it may stand,
 * how its shots fly and land, and the Architect's repair. With `specials.enabled` off no
 * player can buy one, every cannon is an ordinary one, and nothing here changes a match.
 *
 * Every tower comes at two costs (the user's, 2026-10-16), each its own variant with its
 * own levers in `ruleset.specials`: so a gun's rules are read by its kind and its cost,
 * an ordinary cannon's cost being 1.
 */

/**
 * Whether a kind's shot does something of its own where it lands. Such a tower fires
 * before any other gun whenever it is ready, so a player aims it by when they click; a
 * tower that fires ordinary shots, however quickly, fires as any gun.
 */
export function isImpactTower(kind: CannonKind): boolean {
  return kind === 'bertha';
}

/** The variant a tower of this kind and cost is; null for an ordinary cannon. */
function variantFor(kind: CannonKind, cost: number): TowerVariant | null {
  return kind === 'cannon' ? null : variantOf(kind, cost as TowerCost);
}

/** The footprint a gun of this kind and cost stands on. */
export function footprintOf(
  ruleset: Ruleset,
  kind: CannonKind,
  cost: number,
): readonly [number, number] {
  const variant = variantFor(kind, cost);
  return variant === null
    ? ruleset.cannons.footprint
    : variantConfig(ruleset.specials, variant).footprint;
}

/** The factor on a shot's flight — its reload — for a gun of this kind and cost. */
export function flightFactorOf(ruleset: Ruleset, kind: CannonKind, cost: number): number {
  const variant = variantFor(kind, cost);
  return variant === null ? 1 : variantConfig(ruleset.specials, variant).flightFactor;
}

/** The crater a shot from a gun of this kind and cost clears. */
export function craterOf(ruleset: Ruleset, kind: CannonKind, cost: number): CraterPattern {
  if (kind !== 'bertha') return ruleset.shots.craterPattern;
  const bertha = ruleset.specials.bertha[cost as TowerCost];
  if (bertha === undefined) throw new Error(`no bertha at cost ${cost} in this ruleset`);
  return bertha.crater;
}

/** The Architect's repair radius at this cost, in tiles from its footprint's centre. */
export function repairRadiusOf(ruleset: Ruleset, cost: number): number {
  const architect = ruleset.specials.architect[cost as TowerCost];
  if (architect === undefined) throw new Error(`no architect at cost ${cost} in this ruleset`);
  return architect.repairRadius;
}

/**
 * Whether tile (x, y) lies within an Architect's reach: its centre no farther than `radius`
 * from the footprint's centre, a circle (the user's, 2026-10-16). A square's reach moved in
 * whole rings, 16 tiles round a 2x2 to 36, with nothing between; a circle's radius moves a
 * few tiles at a time — 2.2 is the 4x4 square, 2.6 adds the middle of each side (24), 3
 * the 6x6 without its corners (32). In doubled coordinates, so only the radius is fractional.
 */
export function inRepairReach(
  footprint: { x: number; y: number; w: number; h: number },
  radius: number,
  x: number,
  y: number,
): boolean {
  const dx = 2 * x + 1 - (2 * footprint.x + footprint.w);
  const dy = 2 * y + 1 - (2 * footprint.y + footprint.h);
  return dx * dx + dy * dy <= 4 * radius * radius;
}

/**
 * Shots a gun may have in the air at once. A Rapid Cannon is as many cannons stacked on
 * one footprint as it cost (the user's design, 2026-10-16), a barrel each with its own
 * flight and so its own reload; every other gun has one.
 */
export function barrelsOf(cannon: Pick<Cannon, 'kind' | 'cost'>): number {
  return cannon.kind === 'rapid' ? cannon.cost : 1;
}

/** Whether a gun has a barrel free to fire — it may still be inert. */
export function isLoaded(cannon: Pick<Cannon, 'kind' | 'cost' | 'shotIds'>): boolean {
  return cannon.shotIds.length < barrelsOf(cannon);
}

/**
 * How many guns a gun scores as: a tower as many as the cannons it cost (the user's
 * balance, 2026-10-14), so buying one costs no gun points — Big Bertha at three would
 * otherwise have cost two guns' points every round she stood.
 */
export function gunsWorth(cannon: Pick<Cannon, 'cost'>): number {
  return cannon.cost;
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
  if (player.cannonsToPlace < variantCost(player.special)) return 'special_too_dear';
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
 * Architect rebuilds its owner's walls lost to shots within its cost's `repairRadius` of its
 * footprint's centre (`inRepairReach`), where the tile is still free, in seat order. A breach the owner has already
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
  for (const player of state.players) {
    if (player.eliminated) continue;
    const tiles: number[] = [];
    for (const cannon of state.cannons) {
      if (cannon.owner !== player.id || cannon.kind !== 'architect' || !cannon.active) continue;
      const r = repairRadiusOf(state.ruleset, cannon.cost);
      for (const i of lost) {
        if (state.islandId[i] !== player.islandId || state.structure[i] !== Structure.Empty) {
          continue;
        }
        const x = i % state.width;
        const y = (i - x) / state.width;
        if (!inRepairReach(cannon, r, x, y)) continue;
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
