import { type BotProfile } from '@bollwerk/config';
import {
  Rng,
  Structure,
  computeEnclosure,
  pieceById,
  poolForRound,
  type MatchState,
} from '@bollwerk/sim';

import { Builder, type Stage, type Strategy } from './building.js';
import { PlanningSlots } from './planning.js';
import { rollOutBuild, type Placement, type Rollout } from './rollout.js';
import { SealPlanner, cannonRoom } from './tactics.js';

/**
 * A build phase chosen by playing it out (BUILD_PLANNING.md, step 2): the ways a bot might
 * spend it, each rolled out on a copy of the match, and the one whose outcome scores best
 * kept — its pieces then laid as they were in the rollout.
 */

/**
 * What a plan's outcome is worth beyond the round's points, in points. Hand-set for the
 * first measurement (step 2), to be tuned (step 3).
 */
export interface PlanWeights {
  /** Each gun ready for the next barrage: firing, or a reward with room to stand. */
  gun: number;
  /** The best castle nearly sealed: the points it would add, times how nearly. */
  prospect: number;
  /** A round failed, a life spent: never chosen while anything seals. */
  failure: number;
}

export const DEFAULT_PLAN_WEIGHTS: PlanWeights = { gun: 20, prospect: 0.5, failure: 100_000 };

/** The share of a phase's cells a bot can count on for a wall after the barrage's repairs. */
const NEXT_PHASE_SHARE = 0.5;

export interface ChosenPlan {
  strategy: Strategy | null;
  name: string;
  placements: Placement[];
  score: number;
  /** Every strategy weighed, for the harness: its name and score. */
  weighed: { name: string; score: number }[];
}

/**
 * The ways to spend the coming build phase. The ladder first, as it is: at worst the bot
 * does what it would have done. Then, from each first wall — the walls it holds, or when
 * breached the tightest repair keeping the guns and each castle walled alone without them —
 * that wall thickened or reaching on; with room; with each castle beyond it, tight and with
 * room; and with every castle.
 */
export function strategiesFor(state: MatchState, playerId: number): Strategy[] {
  const player = state.players[playerId];
  const out: Strategy[] = [{ name: 'ladder', stages: [], spare: 'ladder' }];
  if (player === undefined) return out;
  const mine = state.castles.filter((c) => c.islandId === player.islandId);
  if (mine.length === 0) return out;
  const enclosure = computeEnclosure(state);
  const sealed = mine.filter((c) => enclosure.castleEnclosed[c.id] === true).map((c) => c.id);
  const stage = (castleIds: number[], radius: number, keepCannons: boolean): Stage => ({
    castleIds,
    radius,
    keepCannons,
  });

  const firsts: { name: string; stage: Stage }[] = [];
  if (sealed.length > 0) {
    firsts.push({ name: 'hold', stage: stage(sealed, 0, true) });
  } else {
    const tight = new SealPlanner(state, playerId).cheapest(1, mine.length, true, 0);
    if (tight !== null) firsts.push({ name: 'guns', stage: stage(tight.castleIds, 0, true) });
    for (const castle of mine) {
      firsts.push({ name: `c${castle.id}`, stage: stage([castle.id], 0, false) });
    }
  }

  for (const { name, stage: first } of firsts) {
    const held = first.castleIds;
    const keep = first.keepCannons;
    out.push({ name: `${name}/thicken`, stages: [first], spare: 'thicken' });
    out.push({ name: `${name}/next`, stages: [first], spare: 'next' });
    out.push({ name: `${name}/room`, stages: [first, stage(held, 2, keep)], spare: 'next' });
    const beyond = mine.filter((c) => !held.includes(c.id));
    for (const castle of beyond) {
      for (const radius of [0, 2]) {
        out.push({
          name: `${name}/reach${radius}`,
          stages: [first, stage([...held, castle.id], radius, keep)],
          spare: 'next',
        });
      }
    }
    if (beyond.length > 1) {
      out.push({
        name: `${name}/reachAll`,
        stages: [
          first,
          stage(
            mine.map((c) => c.id),
            0,
            keep,
          ),
        ],
        spare: 'next',
      });
    }
  }
  return out;
}

/** Plays every strategy out and keeps the best; null outside the window before a build phase. */
export function choosePlan(
  state: MatchState,
  playerId: number,
  profile: BotProfile,
  seed: number,
  weights: PlanWeights = DEFAULT_PLAN_WEIGHTS,
): ChosenPlan | null {
  let best: ChosenPlan | null = null;
  const weighed: ChosenPlan['weighed'] = [];
  for (const strategy of strategiesFor(state, playerId)) {
    const builder = new Builder(playerId, profile, new PlanningSlots());
    builder.strategy = strategy.name === 'ladder' ? null : strategy;
    const rollout = rollOutBuild(state, playerId, builder, new Rng(seed));
    if (rollout === null) return null;
    const score = scoreOf(rollout, playerId, profile, weights);
    weighed.push({ name: strategy.name, score });
    if (best === null || score > best.score) {
      best = {
        strategy: builder.strategy,
        name: strategy.name,
        placements: rollout.placements,
        score,
        weighed,
      };
    }
  }
  return best;
}

/**
 * A rollout's worth: the round's points, the guns ready for the next barrage, and the best
 * castle nearly sealed — the points it would add, scaled by how much of the next phase its
 * wall would take.
 */
export function scoreOf(
  rollout: Rollout,
  playerId: number,
  profile: BotProfile,
  weights: PlanWeights,
): number {
  const { result, board } = rollout;
  if (result === null || result.eliminated) return -weights.failure * 10;
  if (result.enclosedCastles === 0) return -weights.failure;
  const points = result.territoryPoints + result.damagePoints;
  let firing = 0;
  for (const cannon of board.cannons) if (cannon.owner === playerId && cannon.active) firing++;
  const player = board.players[playerId];
  const reward = player?.cannonsToPlace ?? 0;
  const guns = firing + Math.min(reward, cannonRoom(board, playerId));
  return points + weights.gun * guns + weights.prospect * prospect(board, playerId, profile);
}

/** The best castle outside the wall: the points sealing it would add, times how nearly. */
function prospect(board: MatchState, playerId: number, profile: BotProfile): number {
  const player = board.players[playerId];
  if (player === undefined) return 0;
  const island = player.islandId;
  const mine = board.castles.filter((c) => c.islandId === island);
  const held = mine.filter((c) => c.enclosed);
  if (held.length === 0) return 0;
  const cells = cellsPerPhase(board, profile, player.pieceRound + 1) * NEXT_PHASE_SHARE;
  const tilePoints = board.ruleset.scoring.tilePoints;
  const structure = board.structure.slice();
  const valueOf = (tiles: readonly number[]): number => {
    for (const i of tiles) structure[i] = Structure.Wall;
    const e = computeEnclosure({ ...board, structure });
    for (const i of tiles) structure[i] = board.structure[i] as number;
    let area = 0;
    for (const t of e.territory) if (t === island) area++;
    return tilePoints * area * (e.enclosedCastlesByPlayer[playerId] ?? 0);
  };
  const now = valueOf([]);
  const seal = new SealPlanner(board, playerId);
  let best = 0;
  for (const castle of mine) {
    if (castle.enclosed) continue;
    const wall = seal.wall([...held, castle], true, 0);
    if (wall === null) continue;
    const nearly = Math.max(0, 1 - wall.cost / Math.max(1, cells));
    if (nearly === 0) continue;
    best = Math.max(best, (valueOf(wall.tiles) - now) * nearly);
  }
  return best;
}

/** Cells a whole build phase gives this bot, at its pace, with the bag's average piece. */
function cellsPerPhase(state: MatchState, profile: BotProfile, pieceRound: number): number {
  const pool = poolForRound(state.ruleset, pieceRound);
  let weight = 0;
  let cells = 0;
  pool.ids.forEach((id, k) => {
    const w = pool.weights[k] as number;
    weight += w;
    cells += w * pieceById(id).size;
  });
  const size = cells / Math.max(1, weight);
  const ms = profile.placementBaseMs + profile.placementPerCellMs * size;
  return (state.ruleset.phases.buildMs / ms) * size;
}
