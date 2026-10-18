import type { CraterPattern } from '@bollwerk/config';

import { distanceFixed, distanceSquared } from './math.js';
import { playerOf, type Rejection } from './placement.js';
import { strikeLightning } from './lightning.js';
import {
  craterTilesOf,
  fixedFlightMsOf,
  flightFactorOf,
  isImpactTower,
  isLoaded,
  noteLostWall,
} from './specials.js';
import { sameTeam } from './teams.js';
import { Structure, type Cannon, type MatchState, type Shot } from './types.js';

/** Tiles a landed shot clears, relative to the impact tile. */
export function craterOffsets(pattern: CraterPattern): readonly (readonly [number, number])[] {
  switch (pattern) {
    case 'single':
      return [[0, 0]];
    case 'plus5':
      return [
        [0, 0],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];
    case 'square9':
      return [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [0, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
  }
}

function cannonCentreX(cannon: Cannon): number {
  return cannon.x + (cannon.w - 1) / 2;
}

function cannonCentreY(cannon: Cannon): number {
  return cannon.y + (cannon.h - 1) / 2;
}

/**
 * The nearest cannon that is active and has a barrel free — but a ready impact tower
 * (Big Bertha) before any other gun, the nearest of them if several are ready.
 *
 * Nearest rather than round-robin keeps the player thinking about targets instead of
 * inventory, and makes front-line cannons the workhorses. Ties break on cannon id so
 * the choice is reproducible. An impact tower first lets every shot stay one click: the
 * player aims it by when they click, with the cursor telling them it is next (the user's
 * design, 2026-10-14).
 */
export function findReadyCannon(state: MatchState, playerId: number, tx: number, ty: number) {
  let best: Cannon | null = null;
  let bestDistance = Infinity;
  let bestImpact = false;
  for (const cannon of state.cannons) {
    if (cannon.owner !== playerId || !cannon.active || !isLoaded(cannon)) continue;
    const impact = isImpactTower(cannon.kind);
    if (bestImpact && !impact) continue;
    const d = distanceSquared(cannonCentreX(cannon), cannonCentreY(cannon), tx, ty);
    const nearer = d < bestDistance || (d === bestDistance && best !== null && cannon.id < best.id);
    if (nearer || (impact && !bestImpact)) {
      bestDistance = d;
      best = cannon;
      bestImpact = impact;
    }
  }
  return best;
}

/**
 * Flight time grows with distance, so distant targets must be led — and a cannon
 * cannot fire again until its shot has landed, which is the only rate limit.
 *
 * Distance uses an exact integer square root rather than `Math.sqrt`: the spec allows
 * engines to approximate `Math.sqrt`, and a one-tick disagreement on impact time
 * between client and server is a desync.
 */
export function flightTicks(
  state: MatchState,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  factor = 1,
): number {
  const { baseFlightMs, perTileFlightMs } = state.ruleset.shots;
  const distance256 = distanceFixed(fromX, fromY, tx, ty);
  // A tower's factor scales the whole flight; at 1 the product is exact, so an ordinary
  // gun's flight is what it always was.
  const flightMs = (baseFlightMs + (perTileFlightMs * distance256) / 256) * factor;
  return Math.max(1, Math.ceil((flightMs * state.ruleset.tickRateHz) / 1000));
}

/**
 * A shot's flight from this gun, in ticks: by distance, times the gun's factor — or the
 * Allerdickste Bertha's, fixed whatever the distance.
 */
function shotFlightTicks(
  state: MatchState,
  cannon: Cannon,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
): number {
  const fixed = fixedFlightMsOf(state.ruleset, cannon.kind, cannon.cost);
  if (fixed !== null) return Math.max(1, Math.ceil((fixed * state.ruleset.tickRateHz) / 1000));
  const factor = flightFactorOf(state.ruleset, cannon.kind, cannon.cost);
  return flightTicks(state, fromX, fromY, tx, ty, factor);
}

export function fire(
  state: MatchState,
  playerId: number,
  tx: number,
  ty: number,
): { rejection: Rejection } | { shot: Shot } {
  if (state.phase !== 'combat') return { rejection: 'wrong_phase' };
  const player = playerOf(state, playerId);
  if (!player) return { rejection: 'unknown_player' };
  if (player.eliminated) return { rejection: 'eliminated' };
  if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) {
    return { rejection: 'out_of_bounds' };
  }
  // Refused rather than fired and wasted: a shot here could only ever hit your own
  // wall, which neither damages it nor scores.
  const island = state.islandId[ty * state.width + tx] as number;
  if (!state.ruleset.shots.damagesOwnWalls && island === player.islandId) {
    return { rejection: 'own_island' };
  }
  // A teammate's island never, whatever the rules say about your own: a team cannot
  // attack itself in any way.
  if (island !== 0 && island !== player.islandId && sameTeam(state, playerId, island - 1)) {
    return { rejection: 'teammate_island' };
  }

  const cannon = findReadyCannon(state, playerId, tx, ty);
  if (!cannon) return { rejection: 'no_ready_cannon' };

  const fromX = cannonCentreX(cannon);
  const fromY = cannonCentreY(cannon);

  const maxRange = state.ruleset.shots.maxRangeTiles;
  if (maxRange !== null && distanceSquared(fromX, fromY, tx, ty) > maxRange * maxRange) {
    return { rejection: 'out_of_range' };
  }

  const shot: Shot = {
    id: state.nextShotId++,
    cannonId: cannon.id,
    owner: playerId,
    kind: cannon.kind,
    cost: cannon.cost,
    fromX,
    fromY,
    toX: tx,
    toY: ty,
    launchTick: state.tick,
    impactTick: state.tick + shotFlightTicks(state, cannon, fromX, fromY, tx, ty),
  };
  cannon.shotIds.push(shot.id);
  state.shots.push(shot);
  state.events.push({ kind: 'shot_fired', tick: state.tick, shot });
  if (shot.kind === 'lightning') strikeLightning(state, shot);
  return { shot };
}

/**
 * Whether a wall at this tile is one a player's strike clears: a live opponent's, else
 * only where `damagesOwnWalls` says so — never a teammate's, even to a crater wider than
 * the aim. As `resolveImpacts` always judged it, now shared with the Lightning Tower.
 */
export function strikable(state: MatchState, playerId: number, i: number): boolean {
  if (!state.ruleset.shots.damagesWalls || state.structure[i] !== Structure.Wall) return false;
  const owner = state.owner[i] as number;
  const shooterIsland = state.players[playerId]?.islandId ?? 0;
  const teammate = owner !== 0 && owner !== shooterIsland && sameTeam(state, playerId, owner - 1);
  if (teammate) return false;
  return isOpponents(state, playerId, owner) || state.ruleset.shots.damagesOwnWalls;
}

function isOpponents(state: MatchState, playerId: number, owner: number): boolean {
  return owner !== 0 && !sameTeam(state, playerId, owner - 1);
}

/**
 * A strike on one tile: clears the wall there if `strikable`, crediting the shooter for an
 * opponent's, and notes it for the Architects' repair. Whether a wall fell. The owner is
 * read before the tile is cleared, since clearing it is what zeroes the owner.
 */
export function strikeWall(state: MatchState, playerId: number, i: number): boolean {
  if (!strikable(state, playerId, i)) return false;
  const shooter = state.players[playerId];
  if (shooter && isOpponents(state, playerId, state.owner[i] as number)) shooter.wallsDestroyed++;
  state.structure[i] = Structure.Empty;
  state.owner[i] = 0;
  noteLostWall(state, i);
  return true;
}

/**
 * Lands every shot due this tick. Craters clear walls only — castles and cannons
 * are indestructible, so a breach is the sole thing artillery can achieve.
 *
 * Only a live opponent's wall is cleared unless `damagesOwnWalls` says otherwise, and
 * only that ever credits the shooter. Checked here as well as at `fire`, because a
 * crater wider than one tile reaches ground the aim never pointed at. The owner is
 * read before the tile is cleared, since clearing it is what zeroes the owner.
 */
export function resolveImpacts(state: MatchState): void {
  if (state.shots.length === 0) return;
  const remaining: Shot[] = [];

  for (const shot of state.shots) {
    if (shot.impactTick > state.tick) {
      remaining.push(shot);
      continue;
    }

    const cannon = state.cannons.find((c) => c.id === shot.cannonId);
    if (cannon) {
      const barrel = cannon.shotIds.indexOf(shot.id);
      if (barrel >= 0) cannon.shotIds.splice(barrel, 1);
    }
    // The Lightning Tower struck as it fired (`strikeLightning`): what is in the air until now
    // is only its reload, an ordinary shot's flight, which lands nothing.
    if (shot.kind === 'lightning') continue;

    const offsets = craterTilesOf(state.ruleset, shot.kind, shot.cost);
    const destroyed: number[] = [];
    for (const [ox, oy] of offsets) {
      const tx = shot.toX + ox;
      const ty = shot.toY + oy;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
      const i = ty * state.width + tx;
      if (strikeWall(state, shot.owner, i)) destroyed.push(i);
    }

    state.events.push({
      kind: 'shot_impact',
      tick: state.tick,
      shotId: shot.id,
      x: shot.toX,
      y: shot.toY,
      destroyed,
    });
  }

  state.shots = remaining;
}
