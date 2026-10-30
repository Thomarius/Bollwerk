import type { LullabyVariant, TowerCost } from '@bollwerk/config';

import { gunsWorth, isLoaded } from './specials.js';
import { sameTeam } from './teams.js';
import type { Cannon, MatchState, Shot } from './types.js';

/**
 * The Lullaby Tower's lullaby (the user's design, 2026-10-21, reworked the same day as an area
 * of effect; docs/SPECIAL_TOWERS.md §2.8): its shot lands as an ordinary one, and the `targets`
 * viable enemy guns nearest the tile it hit, within `sleepRadius` (null for anywhere), are lulled
 * once each. A gun lulled as often as its threshold — 1 for a cannon and the Architect, which
 * fires as one (`asCannons`), a tower's `towerLulls` (2) — falls asleep for `sleepMs`: it fires nothing, its reload paused, so it may fire
 * again `sleepMs` after the moment it would have. Not viable: a gun asleep, and the kinds the
 * variant names immune (the Allerdickste Bertha). Only in combat; every gun wakes,
 * its lullabies forgotten, as the combat phase ends.
 */

/** A Lullaby Tower's levers at this cost. */
export function lullabyOf(state: MatchState, cost: number): LullabyVariant {
  const lullaby = state.ruleset.specials.lullaby?.[cost as TowerCost] as LullabyVariant | undefined;
  if (lullaby === undefined) throw new Error(`no lullaby at cost ${cost} in this ruleset`);
  return lullaby;
}

/** Whether a gun is awake now: not asleep, or its sleep is over. */
export function isAwake(state: MatchState, cannon: Pick<Cannon, 'asleepUntil'>): boolean {
  return cannon.asleepUntil === undefined || state.tick >= cannon.asleepUntil;
}

/**
 * Lullabies it takes to put a gun to sleep: 1 for a cannon and for a tower the variant lulls as
 * one (`asCannons`, the Architect); for another tower the variant's `towerLulls`, or as many as
 * it cost.
 */
export function sleepThreshold(
  cannon: Pick<Cannon, 'kind' | 'cost'>,
  variant: Pick<LullabyVariant, 'towerLulls' | 'asCannons'> | null = null,
): number {
  if (cannon.kind === 'cannon' || variant?.asCannons.includes(cannon.kind) === true) return 1;
  return variant?.towerLulls ?? gunsWorth(cannon);
}

/**
 * The guns a lullaby landing on (x, y) for this player would reach: the enemy's viable guns —
 * active, awake, of a kind not immune — nearest the tile, by the distance from the tile to the
 * nearest tile of a gun's footprint, within `radius` (null for anywhere), at most `count`, ties
 * by id, so every client picks the same. Pure, so a bot can try aims with it.
 */
export function lullTargets(
  state: MatchState,
  playerId: number,
  x: number,
  y: number,
  variant: Pick<LullabyVariant, 'sleepRadius' | 'targets' | 'immune'>,
): Cannon[] {
  const near: { gun: Cannon; d: number }[] = [];
  const r = variant.sleepRadius;
  for (const cannon of state.cannons) {
    if (!cannon.active || !isAwake(state, cannon)) continue;
    if (cannon.kind !== 'cannon' && variant.immune.includes(cannon.kind)) continue;
    if (sameTeam(state, playerId, cannon.owner)) continue;
    if (state.players[cannon.owner]?.eliminated !== false) continue;
    const dx = Math.max(cannon.x - x, 0, x - (cannon.x + cannon.w - 1));
    const dy = Math.max(cannon.y - y, 0, y - (cannon.y + cannon.h - 1));
    const d = dx * dx + dy * dy;
    if (r !== null && d > r * r) continue;
    near.push({ gun: cannon, d });
  }
  near.sort((a, b) => a.d - b.d || a.gun.id - b.gun.id);
  return near.slice(0, variant.targets).map((n) => n.gun);
}

/** A Lullaby Tower's shot has landed: the guns it reaches lulled, those at their threshold asleep. */
export function singLullaby(state: MatchState, shot: Shot): void {
  // A shot landing after the barrage lulls nothing: every gun wakes with its end.
  if (state.phase !== 'combat') return;
  const variant = lullabyOf(state, shot.cost);
  const sleepTicks = Math.ceil((variant.sleepMs * state.ruleset.tickRateHz) / 1000);
  for (const gun of lullTargets(state, shot.owner, shot.toX, shot.toY, variant)) {
    const lulled = (gun.lulled ?? 0) + 1;
    const threshold = sleepThreshold(gun, variant);
    state.events.push({
      kind: 'gun_lulled',
      tick: state.tick,
      shotId: shot.id,
      owner: shot.owner,
      cannonId: gun.id,
      lulled: Math.min(lulled, threshold),
      threshold,
    });
    if (lulled < threshold) {
      gun.lulled = lulled;
      continue;
    }
    delete gun.lulled;
    // Its reload paused: the sleep runs from when it could next have fired.
    let free = state.tick;
    // A Subwoofer could next fire as its cooldown ends; that is what its sleep pushes back.
    if (gun.waveTick !== undefined) free = Math.max(state.tick, gun.waveTick);
    else if (!isLoaded(gun)) {
      free = Infinity;
      for (const s of state.shots) if (s.cannonId === gun.id) free = Math.min(free, s.impactTick);
      if (!Number.isFinite(free)) free = state.tick;
    }
    gun.asleepUntil = free + sleepTicks;
    state.events.push({
      kind: 'gun_slept',
      tick: state.tick,
      shotId: shot.id,
      owner: shot.owner,
      cannonId: gun.id,
      until: gun.asleepUntil,
      ms: variant.sleepMs,
    });
  }
}

/**
 * As the combat phase ends: every gun awake again, its lullabies forgotten. Kept into the next
 * combat was measured and dropped (2026-10-22): no gain against towers, at radius 8 a loss.
 */
export function wakeAll(state: MatchState): void {
  for (const cannon of state.cannons) {
    delete cannon.asleepUntil;
    delete cannon.lulled;
  }
}
