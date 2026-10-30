import type { SubwooferVariant, TowerCost } from '@bollwerk/config';

import { walkRay, type Ray } from './laser.js';
import { strikable, strikeWall } from './shots.js';
import type { MatchState, Shot, Wave } from './types.js';

/**
 * The Subwoofer (the user's design, 2026-10-30, reworked the same day; docs/SPECIAL_TOWERS.md
 * §2.9): an impact tower whose click sets only a direction, as the Laser Tower's does. It sends
 * a wave `waveWidth` lanes wide — 2 at cost 2, 3 at cost 3 — side by side, from the tower through
 * the tile clicked and on to the map's edge; each lane travels on its own and clears the first
 * wall it reaches that the player may (`strikable`), so a wave opens a gap as wide as itself in
 * one wall. Its reload is an ordinary shot's flight to the nearest wall a lane would clear as it
 * is fired, times `flightFactor`, as the Laser's is. No chance anywhere.
 *
 * It fired on its own at first, every cooldown towards the nearest enemy wall in the four
 * cardinal directions: soaked, the nearest walls on fixed lines were patched in the next build
 * phase however often it fired, and it stayed below a tower's worth (§5 SW).
 */

/** A Subwoofer's levers at this cost. */
export function subwooferOf(state: MatchState, cost: number): SubwooferVariant {
  const subwoofer = state.ruleset.specials.subwoofer?.[cost as TowerCost];
  if (subwoofer === undefined) throw new Error(`no subwoofer at cost ${cost} in this ruleset`);
  return subwoofer;
}

/**
 * A wave's lanes, as rays in doubled coordinates (`walkRay`): from the tower's centre through the
 * tile aimed at, `width` of them side by side a tile apart, centred on that line — shifted across
 * whichever of rows or columns the line runs along, so the lanes stay whole tiles apart at any
 * angle and every point is exact. Null when the aim is the tower's own centre.
 */
export function waveRays(
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  width: number,
): Ray[] | null {
  const ax = Math.round(2 * fromX);
  const ay = Math.round(2 * fromY);
  const dx = 2 * tx - ax;
  const dy = 2 * ty - ay;
  if (dx === 0 && dy === 0) return null;
  // Mostly along a row: the lanes are rows apart; else columns.
  const acrossRows = Math.abs(dx) >= Math.abs(dy);
  const rays: Ray[] = [];
  for (let k = 0; k < width; k++) {
    // In doubled units a tile apart is 2, centred on the line.
    const off = 2 * k - (width - 1);
    rays.push({ ax: acrossRows ? ax : ax + off, ay: acrossRows ? ay + off : ay, dx, dy });
  }
  return rays;
}

/**
 * How far along a lane a share of its way to its second point lies, in tiles along the line's
 * longer axis — the measure a wave's speed is in, exact without a square root.
 */
export function laneAlong(ray: Ray, at: number): number {
  return (at * Math.max(Math.abs(ray.dx), Math.abs(ray.dy))) / 2;
}

/**
 * The first wall each lane of a wave aimed so would clear now, by lane, null for a lane that
 * meets none; and the nearest of them along the line. Pure, so a bot can try aims with it.
 */
export function waveTargets(
  state: MatchState,
  owner: number,
  rays: readonly Ray[],
): { walls: (number | null)[]; nearest: number | null } {
  let nearest: number | null = null;
  let nearestAlong = Infinity;
  const walls = rays.map((ray) => {
    let wall: number | null = null;
    walkRay(state, ray, (i, at) => {
      if (!strikable(state, owner, i)) return false;
      wall = i;
      if (laneAlong(ray, at) < nearestAlong) {
        nearestAlong = laneAlong(ray, at);
        nearest = i;
      }
      return true;
    });
    return wall;
  });
  return { walls, nearest };
}

/**
 * How far a wave's fronts are from the tower's centre at this tick, in tiles along the line's
 * longer axis (`laneAlong`) — a fraction between ticks, for drawing.
 */
export function waveReach(state: MatchState, wave: Wave, tick: number): number {
  const speed = subwooferOf(state, wave.cost).waveTilesPerSecond;
  return Math.max(0, ((tick - wave.launchTick) * speed) / state.ruleset.tickRateHz);
}

/** A Subwoofer has fired: its wave set off along its lanes, to travel from the next tick. */
export function sendWave(state: MatchState, shot: Shot, rays: readonly Ray[]): void {
  const wave: Wave = {
    id: shot.id,
    cannonId: shot.cannonId,
    owner: shot.owner,
    cost: shot.cost,
    lanes: rays.map((r) => ({ ...r, done: false })),
    launchTick: state.tick,
  };
  state.waves.push(wave);
  state.events.push({ kind: 'wave_sent', tick: state.tick, wave });
}

/**
 * Carries every wave on by a tick: each lane looks at the tiles whose middle its front has passed
 * since the last, clearing the first wall it may and stopping there, or stopping past the map's
 * edge. Walls only fall while a wave travels — nothing is built in combat or the intermission —
 * so a tile once passed never needs looking at again. A wave is gone once all its lanes are.
 */
export function advanceWaves(state: MatchState): void {
  if (state.waves.length === 0) return;
  for (const wave of state.waves) {
    const from = waveReach(state, wave, state.tick - 1);
    const to = waveReach(state, wave, state.tick);
    wave.lanes.forEach((lane, index) => {
      if (lane.done) return;
      let hit: number | null = null;
      const end = walkRay(state, lane, (i, at) => {
        const d = laneAlong(lane, at);
        if (d > to) return true;
        if (d <= from || !strikable(state, wave.owner, i)) return false;
        hit = i;
        return true;
      });
      const struck = hit as number | null;
      const offMap = end.edge && laneAlong(lane, end.at) <= to;
      if (struck === null && !offMap) return;
      if (struck !== null) strikeWall(state, wave.owner, struck);
      lane.done = true;
      state.events.push({
        kind: 'wave_ended',
        tick: state.tick,
        waveId: wave.id,
        owner: wave.owner,
        lane: index,
        x: struck === null ? end.x : struck % state.width,
        y: struck === null ? end.y : Math.floor(struck / state.width),
        destroyed: struck,
      });
    });
  }
  state.waves = state.waves.filter((w) => w.lanes.some((l) => !l.done));
}

/** Whether anything is still in the air — a shot or a wave — that the intermission waits for. */
export function inFlight(state: Pick<MatchState, 'shots' | 'waves'>): boolean {
  return state.shots.length > 0 || state.waves.length > 0;
}
