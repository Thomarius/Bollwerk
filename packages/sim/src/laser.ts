import { variantConfig, variantOf, type LaserVariant, type TowerCost } from '@bollwerk/config';

import { streamFor } from './rng.js';
import { strikable, strikeWall } from './shots.js';
import type { MatchState, Shot } from './types.js';

/** Where a beam goes: the walls it clears, in order along it, and where it ends. */
export interface LaserBeam {
  /** Tiles whose wall the beam clears, nearest the tower first. */
  cleared: number[];
  /** Where the beam ends, in tile coordinates: the last wall's middle, or the map's edge. */
  endX: number;
  endY: number;
}

/**
 * The Laser Tower's beam (the user's design, 2026-10-21; docs/SPECIAL_TOWERS.md): a ray from
 * the tower's centre through the centre of the tile aimed at, on to the map's edge, clearing
 * the first `count` walls on it that the player may strike (`strikable`) — any live opponent's,
 * across a channel too; their own, a teammate's and the rubble of the eliminated it passes over.
 * The click sets only the direction. Pure, so a bot can try aims with it.
 *
 * Every tile the ray passes through, by an exact walk in doubled coordinates, where tile i spans
 * 2i - 1 to 2i + 1 and every centre is an integer. A ray through a tile's corner steps
 * diagonally, touching neither side tile: a sealing wall is 4-connected, so a corner it holds
 * is always one of the two tiles the ray does enter, and no beam slips through a wall.
 */
export function traceLaser(
  state: MatchState,
  owner: number,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  count: number,
): LaserBeam {
  const ax = Math.round(2 * fromX);
  const ay = Math.round(2 * fromY);
  const cleared: number[] = [];
  const ray = { ax, ay, dx: 2 * tx - ax, dy: 2 * ty - ay };
  if (ray.dx === 0 && ray.dy === 0) return { cleared, endX: tx, endY: ty };
  const end = walkRay(state, ray, (i) => {
    if (strikable(state, owner, i)) cleared.push(i);
    return cleared.length >= count;
  });
  return { cleared, endX: end.x, endY: end.y };
}

/**
 * A ray in doubled coordinates, where tile i spans 2i - 1 to 2i + 1 and every tile's centre is
 * an even integer: from (ax, ay), through (ax + dx, ay + dy) and on. Not both of dx, dy 0.
 */
export interface Ray {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
}

/**
 * Every tile a ray passes through, in order, by an exact walk (`traceLaser`): `visit` is handed
 * each tile and the share of the way from the ray's start to its second point at which the ray
 * crosses that tile's middle — where it enters and where it leaves, halved — and stops the walk
 * by returning true. Where the walk ended: the middle of the tile it stopped on, or the map's
 * edge, as a point in tiles and as that share (`at`), with whether it was the edge.
 */
export function walkRay(
  state: Pick<MatchState, 'width' | 'height'>,
  { ax, ay, dx, dy }: Ray,
  visit: (i: number, at: number) => boolean,
): { x: number; y: number; at: number; edge: boolean } {
  const { width, height } = state;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  // The start tile; a centre on a boundary (a footprint of even size) starts in the tile the
  // ray heads into.
  let ix = ax % 2 === 0 ? ax / 2 : (ax + (sx >= 0 ? 1 : -1)) / 2;
  let iy = ay % 2 === 0 ? ay / 2 : (ay + (sy >= 0 ? 1 : -1)) / 2;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // The parameter along the ray, t = n / scale, scale = adx * ady (or the one that is not 0
  // for a ray along a row or column), so every crossing's n is an integer: along x, t at a
  // crossing is |boundary - ax| / adx, which is |boundary - ax| * ady / scale.
  const mx = sy === 0 ? 1 : ady;
  const my = sx === 0 ? 1 : adx;
  const crossX = (): number => (sx === 0 ? Infinity : Math.abs(2 * ix + sx - ax) * mx);
  const crossY = (): number => (sy === 0 ? Infinity : Math.abs(2 * iy + sy - ay) * my);
  const scale = sx === 0 ? ady : adx * mx;
  const endAt = (n: number, edge: boolean) => ({
    x: (ax + (dx * n) / scale) / 2,
    y: (ay + (dy * n) / scale) / 2,
    at: n / scale,
    edge,
  });

  let entered = 0;
  for (;;) {
    const nx = crossX();
    const ny = crossY();
    const left = Math.min(nx, ny);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return endAt(entered, true);
    if (visit(iy * width + ix, (entered + left) / 2 / scale)) {
      return endAt((entered + left) / 2, false);
    }
    if (nx <= ny) ix += sx;
    if (ny <= nx) iy += sy;
    entered = left;
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return endAt(left, true);
  }
}

/** The walls this shot's beam clears at most: the variant's `pierce`, a fraction by chance. */
export function laserCount(state: MatchState, shot: Shot): number {
  const config = variantConfig(
    state.ruleset.specials,
    variantOf('laser', shot.cost as TowerCost),
  ) as LaserVariant;
  const whole = Math.floor(config.pierce);
  // Drawn for every shot, whole lever or not, from a stream of the shot's own: every client
  // draws the same, and nothing else's draws move.
  const roll = streamFor(state.seed, `laser:${shot.id}`).nextFloat();
  return whole + (roll < config.pierce - whole ? 1 : 0);
}

/** Clears the beam's walls on the tick the tower fires, crediting the shooter as any shot. */
export function fireLaser(state: MatchState, shot: Shot, beam: LaserBeam): void {
  const destroyed: number[] = [];
  for (const i of beam.cleared) if (strikeWall(state, shot.owner, i)) destroyed.push(i);
  state.events.push({
    kind: 'laser_fired',
    tick: state.tick,
    shotId: shot.id,
    owner: shot.owner,
    fromX: shot.fromX,
    fromY: shot.fromY,
    endX: beam.endX,
    endY: beam.endY,
    destroyed,
  });
}
