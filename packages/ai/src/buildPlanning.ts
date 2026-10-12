import { type BotProfile } from '@bollwerk/config';
import {
  Rng,
  Structure,
  computeEnclosure,
  pieceById,
  poolForRound,
  type Castle,
  type MatchState,
} from '@bollwerk/sim';

import { Builder, type Stage, type Strategy } from './building.js';
import { PlanningSlots } from './planning.js';
import { RolloutRun, snapshot, type Placement, type Rollout } from './rollout.js';
import { SealPlanner, cannonRoom, type SealPlan } from './tactics.js';

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

/**
 * The strategies a search tries first, most promising first: the greedy choice over 960
 * planned phases at Levels 3–10 (BUILD_PLANNING.md), each adding the most to the best of
 * those before it. The rest follow as offered, while time lasts.
 */
export const DEFAULT_PLAN_ORDER: readonly string[] = [
  'leanLadder',
  'alone1/reachAll',
  'alone2/next',
  'alone1/next',
  'alone2/reachAll',
  'alone1/reach2#2',
  'alone3/reachAll',
  'guns/reach2#1',
];

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
  const out: Strategy[] = [
    { name: 'ladder', stages: [], spare: 'ladder' },
    // The ladder planning again only once its plan is built: in a rollout, faster by half
    // and better (Level 8, four players: 110 -> 66 ms, score 395 -> 433), since it no
    // longer abandons a wall half built for one a little cheaper.
    { name: 'leanLadder', stages: [], spare: 'ladder', lean: true },
  ];
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

  // Castles are named by how dear their wall is, cheapest first, never by id, so a strategy
  // means the same on every island and in every phase and can be weighed across them.
  const seal = new SealPlanner(state, playerId);
  const byCost = (castles: readonly Castle[], wall: (c: Castle) => SealPlan | null): Castle[] =>
    castles
      .map((castle) => ({ castle, cost: wall(castle)?.cost ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.cost - b.cost)
      .map((x) => x.castle);

  const firsts: { name: string; stage: Stage }[] = [];
  if (sealed.length > 0) {
    firsts.push({ name: 'hold', stage: stage(sealed, 0, true) });
  } else {
    const tight = seal.cheapest(1, mine.length, true, 0);
    if (tight !== null) firsts.push({ name: 'guns', stage: stage(tight.castleIds, 0, true) });
    byCost(mine, (c) => seal.wall([c], false, 0)).forEach((castle, k) => {
      firsts.push({ name: `alone${k + 1}`, stage: stage([castle.id], 0, false) });
    });
  }

  for (const { name, stage: first } of firsts) {
    const held = first.castleIds;
    const keep = first.keepCannons;
    out.push({ name: `${name}/thicken`, stages: [first], spare: 'thicken' });
    out.push({ name: `${name}/next`, stages: [first], spare: 'next' });
    out.push({ name: `${name}/room`, stages: [first, stage(held, 2, keep)], spare: 'next' });
    const heldCastles = mine.filter((c) => held.includes(c.id));
    const beyond = byCost(
      mine.filter((c) => !held.includes(c.id)),
      (c) => seal.wall([...heldCastles, c], keep, 0),
    );
    for (const [k, castle] of beyond.entries()) {
      for (const radius of [0, 2]) {
        out.push({
          name: `${name}/reach${radius}#${k + 1}`,
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
  /** The strategies to weigh, by name, or every one `strategiesFor` offers. */
  only: readonly string[] | null = null,
): ChosenPlan | null {
  const offered = strategiesFor(state, playerId);
  const search = PlanSearch.start(
    state,
    playerId,
    profile,
    seed,
    weights,
    only === null ? offered : pick(offered, only),
  );
  if (search === null) return null;
  search.work(Number.POSITIVE_INFINITY);
  return search.best();
}

/** The ladder as a strategy: no walls of its own, the ladder's choice throughout. */
function isLadder(strategy: Strategy): boolean {
  return strategy.stages.length === 0 && strategy.spare === 'ladder';
}

/**
 * A bot's search for its build phase, done a simulated piece at a time so it can be spread
 * over ticks and stopped when time is up (BUILD_PLANNING.md, step 5): the strategies in
 * the order given, each rolled out on a snapshot of the board taken when the search began.
 * Strategies beginning with the same wall play alike until it stands, so that start is
 * played once and branched (`RolloutRun.fork`) into each of them.
 */
export class PlanSearch {
  private next = 0;
  private current: RolloutRun | null = null;
  /** Each shared start, by its wall, once begun, and how its last piece went. */
  private readonly starts = new Map<
    string,
    { run: RolloutRun; at: 'placed' | 'halted' | 'done' }
  >();
  private chosen: ChosenPlan | null = null;
  private readonly weighed: ChosenPlan['weighed'] = [];

  private constructor(
    private readonly board: MatchState,
    private readonly playerId: number,
    private readonly profile: BotProfile,
    private readonly seed: number,
    private readonly weights: PlanWeights,
    private readonly order: readonly Strategy[],
  ) {}

  /** A search from the board as it is now; null outside the window before a build phase. */
  static start(
    state: MatchState,
    playerId: number,
    profile: BotProfile,
    seed: number,
    weights: PlanWeights,
    order: readonly Strategy[],
  ): PlanSearch | null {
    const before = state.phase === 'intermission' && state.pendingPhase === 'build';
    if ((!before && state.phase !== 'build') || state.shots.length > 0) return null;
    // The board as it is now, never as it will be: a search that runs on into the build
    // phase must still play every strategy from the same start.
    return new PlanSearch(snapshot(state), playerId, profile, seed, weights, order);
  }

  /** Whether every strategy has been played out. */
  get complete(): boolean {
    return this.next >= this.order.length;
  }

  /** How many strategies have been played out. */
  get finished(): number {
    return this.weighed.length;
  }

  /** The best plan played out so far, or null before any. */
  best(): ChosenPlan | null {
    return this.chosen;
  }

  /** Plays on for up to `steps` simulated pieces; true once the search is complete. */
  work(steps: number): boolean {
    let left = steps;
    while (left > 0 && !this.complete) {
      const strategy = this.order[this.next] as Strategy;
      if (this.current === null) {
        const begun = this.begin(strategy);
        if (begun === 'stepped') {
          left--;
          continue;
        }
        if (begun !== null) {
          this.finish(strategy, begun);
          continue;
        }
      }
      const run = this.current as RolloutRun;
      const at = run.advance();
      left--;
      if (at !== 'placed') this.finish(strategy, run.outcome());
    }
    return this.complete;
  }

  /**
   * Sets up the rollout of a strategy: the ladder from the start, any other from where its
   * first wall stands. Its shared start is played first, a piece a call — `stepped`, the
   * piece spent — and when the phase ended before that wall stood, the outcome is the
   * start's own, alike for every strategy sharing it.
   */
  private begin(strategy: Strategy): 'stepped' | Rollout | null {
    const fresh = (builder: Builder): RolloutRun =>
      RolloutRun.start(this.board, this.playerId, builder, new Rng(this.seed)) as RolloutRun;
    if (isLadder(strategy)) {
      const builder = new Builder(this.playerId, this.profile, new PlanningSlots());
      builder.lean = strategy.lean === true;
      this.current = fresh(builder);
      return null;
    }
    const key = JSON.stringify(strategy.stages[0]);
    let start = this.starts.get(key);
    if (start === undefined) {
      const builder = new Builder(this.playerId, this.profile, new PlanningSlots());
      builder.strategy = { name: 'start', stages: strategy.stages.slice(0, 1), spare: 'halt' };
      start = { run: fresh(builder), at: 'placed' };
      this.starts.set(key, start);
    }
    if (start.at === 'placed') {
      start.at = start.run.advance();
      return 'stepped';
    }
    if (start.at === 'done') return start.run.outcome();
    this.current = start.run.fork(strategy);
    return null;
  }

  /**
   * The tick of the first piece any strategy played out lays, once one has: the same for
   * every strategy, its time counted from the phase's start, and the search's deadline.
   */
  firstPieceTick: number | null = null;

  private finish(strategy: Strategy, rollout: Rollout): void {
    const first = rollout.placements[0]?.tick;
    if (first !== undefined && (this.firstPieceTick === null || first < this.firstPieceTick)) {
      this.firstPieceTick = first;
    }
    const score = scoreOf(rollout, this.playerId, this.profile, this.weights);
    this.weighed.push({ name: strategy.name, score });
    if (this.chosen === null || score > this.chosen.score) {
      this.chosen = {
        strategy: isLadder(strategy) ? null : strategy,
        name: strategy.name,
        placements: rollout.placements,
        score,
        weighed: this.weighed,
      };
    }
    this.current = null;
    this.next++;
  }
}

/**
 * The strategies offered, those named first in the order named — a bot short of time plays
 * the most promising first — then the rest as offered.
 */
export function inOrder(offered: readonly Strategy[], names: readonly string[]): Strategy[] {
  const first = pick(offered, names);
  return [...first, ...offered.filter((s) => !first.includes(s))];
}

/**
 * The strategies named, in their order, as far as they are offered. A strategy beginning
 * from the cheapest castle walled alone (`alone1/…`) means, when the bot is sealed, the same
 * from the walls it holds (`hold/…`).
 */
export function pick(offered: readonly Strategy[], names: readonly string[]): Strategy[] {
  const out: Strategy[] = [];
  for (const name of names) {
    const found =
      offered.find((s) => s.name === name) ??
      offered.find((s) => s.name === name.replace(/^alone1\//, 'hold/'));
    if (found !== undefined && !out.includes(found)) out.push(found);
  }
  return out;
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
