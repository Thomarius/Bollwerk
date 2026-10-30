import type { SubwooferVariant, TowerCost } from '@bollwerk/config';

import { isAwake } from './lullaby.js';
import { strikable, strikeWall } from './shots.js';
import type { Cannon, MatchState, Wave, WaveDirection, WaveLane } from './types.js';

/**
 * The Subwoofer (the user's design, 2026-10-30; docs/SPECIAL_TOWERS.md §2.9): the one tower no
 * click fires. Every `cooldownMs` of a combat phase — its first wave too, so it is never ready
 * as the phase begins — it sends a wave towards the nearest enemy wall in the four cardinal
 * directions, `waveWidth` lanes wide, centred on its footprint — a lane a row or column. Each
 * lane travels on its own and clears the first wall it reaches that it may (`strikable`), so a
 * wave clears a wall a lane at most; a lane meeting none runs off the map. No chance anywhere: the direction is the nearest wall's,
 * ties by the other lane's distance, then north, east, south, west.
 */

/** Each direction's step, by `WaveDirection`: north, east, south, west. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const DIRECTIONS: readonly WaveDirection[] = [0, 1, 2, 3];

/** A Subwoofer's levers at this cost. */
export function subwooferOf(state: MatchState, cost: number): SubwooferVariant {
  const subwoofer = state.ruleset.specials.subwoofer?.[cost as TowerCost];
  if (subwoofer === undefined) throw new Error(`no subwoofer at cost ${cost} in this ruleset`);
  return subwoofer;
}

/** The step a wave in this direction takes, a tile at a time. */
export function waveStep(dir: WaveDirection): readonly [number, number] {
  return STEPS[dir] as readonly [number, number];
}

/**
 * The first tile of each of a wave's `width` lanes from this footprint in this direction, on the
 * line just beyond its edge: centred on the footprint, so a 2x2 tower's wave four wide has a lane
 * more on either side (the user's, 2026-10-30); an odd extra lane goes east or south.
 */
export function waveLanes(
  footprint: Pick<Cannon, 'x' | 'y' | 'w' | 'h'>,
  dir: WaveDirection,
  width: number,
): { x: number; y: number }[] {
  const { x, y, w, h } = footprint;
  const across = dir === 0 || dir === 2 ? w : h;
  const first = -Math.floor((width - across) / 2);
  const lanes: { x: number; y: number }[] = [];
  for (let i = first; i < first + width; i++) {
    if (dir === 0 || dir === 2) lanes.push({ x: x + i, y: dir === 0 ? y - 1 : y + h });
    else lanes.push({ x: dir === 3 ? x - 1 : x + w, y: y + i });
  }
  return lanes;
}

/**
 * Tiles from a lane's first tile to the first wall this player may clear on it, 0 for the first
 * tile itself; Infinity if it meets none before the map's edge.
 */
export function laneDistance(
  state: MatchState,
  owner: number,
  x: number,
  y: number,
  dir: WaveDirection,
): number {
  const [sx, sy] = waveStep(dir);
  for (let k = 0; ; k++) {
    const tx = x + sx * k;
    const ty = y + sy * k;
    if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return Infinity;
    if (strikable(state, owner, ty * state.width + tx)) return k;
  }
}

/**
 * Where a Subwoofer standing on this footprint would send its wave now: the direction of the
 * nearest wall its owner may clear, judged by the nearer lane, ties by the other lanes in order
 * of distance, then north, east, south, west — and each lane's distance in it. Null when no
 * lane in any direction meets one. Pure, so a bot can weigh a site with it.
 */
export function aimWave(
  state: MatchState,
  owner: number,
  footprint: Pick<Cannon, 'x' | 'y' | 'w' | 'h'>,
  width: number,
): { dir: WaveDirection; distances: number[] } | null {
  let best: { dir: WaveDirection; distances: number[]; sorted: number[] } | null = null;
  for (const dir of DIRECTIONS) {
    const distances = waveLanes(footprint, dir, width).map((l) =>
      laneDistance(state, owner, l.x, l.y, dir),
    );
    const sorted = [...distances].sort((a, b) => a - b);
    if (sorted[0] === Infinity) continue;
    if (best === null || nearer(sorted, best.sorted)) best = { dir, distances, sorted };
  }
  return best === null ? null : { dir: best.dir, distances: best.distances };
}

/** Whether lane distances `a`, nearest first, beat `b`; a tie keeps the earlier direction. */
function nearer(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * How far a wave's fronts are from their lanes' first tiles at this tick, in tiles — a fraction
 * between ticks, for drawing.
 */
export function waveReach(state: MatchState, wave: Wave, tick: number): number {
  const speed = subwooferOf(state, wave.cost).waveTilesPerSecond;
  return Math.max(0, ((tick - wave.launchTick) * speed) / state.ruleset.tickRateHz);
}

/**
 * Tiles of each lane a wave has reached by this tick: a tile is reached as the front crosses its
 * middle, so a lane's wall falls as the wave is seen to arrive.
 */
function tilesReached(state: MatchState, wave: Wave, tick: number): number {
  return Math.floor(waveReach(state, wave, tick) + 0.5);
}

function ticksOf(state: MatchState, ms: number): number {
  return Math.ceil((ms * state.ruleset.tickRateHz) / 1000);
}

/** As a combat phase begins: every Subwoofer's cooldown starts, its first wave one cooldown on. */
export function startCooldowns(state: MatchState): void {
  for (const cannon of state.cannons) {
    if (cannon.kind !== 'subwoofer') continue;
    cannon.waveTick = state.tick + ticksOf(state, subwooferOf(state, cannon.cost).cooldownMs);
  }
}

/** As a combat phase ends: no Subwoofer sends a wave outside it. Its waves in flight travel on. */
export function endCooldowns(state: MatchState): void {
  for (const cannon of state.cannons) delete cannon.waveTick;
}

/**
 * Every Subwoofer whose cooldown is over sends its wave, if it is active and awake and any lane
 * of it meets a wall it may clear; one that meets none waits, and since no wall is built in
 * combat, stays silent to the phase's end. Its cooldown starts again as it fires.
 */
export function sendWaves(state: MatchState): void {
  if (state.phase !== 'combat') return;
  for (const cannon of state.cannons) {
    if (cannon.waveTick === undefined || state.tick < cannon.waveTick) continue;
    if (!cannon.active || !isAwake(state, cannon)) continue;
    if (state.players[cannon.owner]?.eliminated !== false) continue;
    const { waveWidth } = subwooferOf(state, cannon.cost);
    const aim = aimWave(state, cannon.owner, cannon, waveWidth);
    if (aim === null) continue;
    const lanes: WaveLane[] = waveLanes(cannon, aim.dir, waveWidth).map((l) => ({
      ...l,
      done: false,
    }));
    const wave: Wave = {
      id: state.nextShotId++,
      cannonId: cannon.id,
      owner: cannon.owner,
      cost: cannon.cost,
      dir: aim.dir,
      lanes,
      launchTick: state.tick,
    };
    state.waves.push(wave);
    cannon.waveTick = state.tick + ticksOf(state, subwooferOf(state, cannon.cost).cooldownMs);
    state.events.push({ kind: 'wave_sent', tick: state.tick, wave });
  }
}

/**
 * Carries every wave on by a tick: each lane looks at the tiles its front has reached since the
 * last, clearing the first wall it may and stopping there, or stopping past the map's edge. Walls
 * only fall while a wave travels — nothing is built in combat or the intermission — so a tile
 * once passed never needs looking at again. A wave is gone once both lanes are.
 */
export function advanceWaves(state: MatchState): void {
  if (state.waves.length === 0) return;
  for (const wave of state.waves) {
    const from = tilesReached(state, wave, state.tick - 1);
    const to = tilesReached(state, wave, state.tick);
    const [sx, sy] = waveStep(wave.dir);
    wave.lanes.forEach((lane, index) => {
      for (let k = from; k < to && !lane.done; k++) {
        const x = lane.x + sx * k;
        const y = lane.y + sy * k;
        const off = x < 0 || y < 0 || x >= state.width || y >= state.height;
        const i = y * state.width + x;
        const hit = !off && strikeWall(state, wave.owner, i);
        if (!off && !hit) continue;
        lane.done = true;
        state.events.push({
          kind: 'wave_ended',
          tick: state.tick,
          waveId: wave.id,
          owner: wave.owner,
          lane: index,
          x,
          y,
          destroyed: hit ? i : null,
        });
      }
    });
  }
  state.waves = state.waves.filter((w) => w.lanes.some((l) => !l.done));
}

/** Whether anything is still in the air — a shot or a wave — that the intermission waits for. */
export function inFlight(state: Pick<MatchState, 'shots' | 'waves'>): boolean {
  return state.shots.length > 0 || state.waves.length > 0;
}
