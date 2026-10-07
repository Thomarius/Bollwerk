// Whole bot matches for the tests, shared by the bot test files. They are split by the
// matches they play, since vitest runs a file on one worker and these are the slowest
// tests in the repository: one file of them took 98 of the suite's 103 seconds.

import {
  defaultRuleset,
  defaultTerrainConfig,
  tierSetup,
  type DifficultyName,
} from '@bollwerk/config';
import {
  Rng,
  applyAction,
  createMatch,
  drainEvents,
  step,
  Structure,
  type MatchState,
  type Rejection,
} from '@bollwerk/sim';

import { Bot } from './bot.js';
import { cannonRoom } from './tactics.js';

/** The old tiers, as the level and personality each now stands for. */
export type Difficulty = DifficultyName;
export const bot = (id: number, tier: Difficulty): Bot => new Bot(id, tierSetup(tier));

export interface Outcome {
  state: MatchState;
  rejections: Rejection[];
  /** Pieces player 0 laid in each build phase, in order. */
  placementsPerPhase: number[];
  /**
   * What each surviving player held at each round resolution.
   *
   * Sampled there and nowhere else. `enclosedCastles` is live during a build phase, so
   * it is legitimately zero mid-repair — a bot redrawing a wider wall is unsealed for
   * most of the phase and sealed at the end of it, which is the only moment the rules
   * ask about. The sweep runs inside the same step, so these are the walls and guns
   * the next barrage actually meets.
   */
  resolutions: Resolution[];
}

export interface Resolution {
  round: number;
  player: number;
  enclosedCastles: number;
  activeCannons: number;
  cannonRoom: number;
}

export function play(
  seed: number,
  kinds: Difficulty[],
  maxTicks = 30_000,
  ruleset = defaultRuleset,
): Outcome {
  const state = createMatch({
    seed,
    ruleset,
    terrainConfig: defaultTerrainConfig,
    players: kinds.map((k, i) => ({ name: `${k}${i}`, isBot: true })),
  });
  const rng = new Rng(seed);
  const bots = state.players.map((p) => bot(p.id, kinds[p.id] as Difficulty));
  const rejections: Rejection[] = [];
  const placementsPerPhase: number[] = [];
  const resolutions: Resolution[] = [];
  let placed = 0;
  let phase = state.phase;

  while (state.phase !== 'game_over' && state.tick < maxTicks) {
    for (const player of state.players) {
      const action = bots[player.id]?.think(state, rng) ?? null;
      if (action === null) continue;
      const rejection = applyAction(state, action);
      if (rejection !== null) rejections.push(rejection);
      else if (action.kind === 'place_piece' && player.id === 0) placed++;
    }
    step(state);
    for (const event of drainEvents(state)) {
      if (event.kind !== 'round_resolved') continue;
      for (const result of event.results) {
        if (result.eliminated) continue;
        resolutions.push({
          round: event.round,
          player: result.player,
          enclosedCastles: result.enclosedCastles,
          activeCannons: state.cannons.filter((c) => c.owner === result.player && c.active).length,
          cannonRoom: cannonRoom(state, result.player),
        });
      }
    }
    if (state.phase !== phase) {
      if (phase === 'build') {
        placementsPerPhase.push(placed);
        placed = 0;
      }
      phase = state.phase;
    }
  }
  return { state, rejections, placementsPerPhase, resolutions };
}

/**
 * Whether a castle is sealed, worked out a second way: a depth-first search outward from
 * the castle, rather than the solver's flood inward from the border. Same rule — the
 * escape is 8-connected across every non-wall tile, water included — different code, so
 * a bug in one is not repeated in the other.
 */
export function sealedByOracle(state: MatchState, castleId: number): boolean {
  const castle = state.castles[castleId]!;
  const { width: w, height: h } = state;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let oy = 0; oy < castle.h; oy++) {
    for (let ox = 0; ox < castle.w; ox++) stack.push((castle.y + oy) * w + castle.x + ox);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (seen[i] === 1) continue;
    seen[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * w + x + dx;
        if (seen[j] === 0 && state.structure[j] !== Structure.Wall) stack.push(j);
      }
    }
  }
  return true;
}
