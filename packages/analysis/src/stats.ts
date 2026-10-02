import {
  personalityWords,
  skillAt,
  BALANCED,
  type BotSetup,
  type ConfigBundle,
} from '@bollwerk/config';
import { cannonRoom, cheapestPlanFor, pocketCount } from '@bollwerk/ai';
import {
  Structure,
  Terrain,
  pieceCells,
  poolForRound,
  type MatchEvent,
  type MatchState,
} from '@bollwerk/sim';

/** Who played a seat: a bot's level and personality, or a person, from a recording. */
export type Tier = BotSetup | 'human';

/**
 * How a table names who played a row: `human`, or the level — `L5` — with the
 * personality after it when it is not balanced, so a soak's summary groups like with like.
 */
export function rowLabel(row: Pick<StatRow, 'level' | 'personality'>): string {
  if (row.level === null) return 'human';
  const balanced = personalityWords(BALANCED);
  return row.personality === '' || row.personality === balanced
    ? `L${row.level}`
    : `L${row.level} ${row.personality}`;
}

// ------------------------------------------------------------------------- stats

/**
 * One row per player per round, sampled at the resolution that ends a build phase.
 *
 * That moment and no other: `enclosedCastles` is live during a build phase, so it is
 * legitimately zero mid-repair, and the sweep runs inside the same step — so the
 * cannon and wall counts here are what the next barrage will actually meet.
 */
export interface StatRow {
  /** Which match: `sim-<seed>` for a bot soak, the recording's id for a replay. */
  match: string;
  seed: number;
  round: number;
  player: number;
  /** A bot's skill level, or null for a person. */
  level: number | null;
  /** A bot's personality in words (`personalityWords`), or empty for a person. */
  personality: string;
  enclosedCastles: number;
  cannonsAwarded: number;
  eliminated: boolean;
  cannonsOwned: number;
  cannonsActive: number;
  cannonRoom: number;
  /** Pockets held — sealed ground with no castle (§1.3) — after the sweep. */
  pockets: number;
  wallTiles: number;
  piecesPlaced: number;
  /** Null for a person, who has no pace to price a phase with. */
  piecesBudget: number | null;
  shotsFired: number;
  territoryPoints: number;
  damagePoints: number;
  /** Banked total after this round. */
  score: number;
  /**
   * Cells the tightest possible seal needed as the build phase opened, and how many it
   * still needed on the phase's last tick. Together they say why a round failed:
   * a repair larger than the phase could ever build, or one that fit and was missed.
   */
  repairAtBuild: number;
  repairLeft: number;
  /**
   * Of the cells still missing on the last tick, how many no piece in this player's bag
   * could cover at all — holes the round's pieces are too big for.
   */
  repairStuck: number;
}

const STAT_COLUMNS: (keyof StatRow)[] = [
  'match',
  'seed',
  'round',
  'player',
  'level',
  'personality',
  'enclosedCastles',
  'cannonsAwarded',
  'eliminated',
  'cannonsOwned',
  'cannonsActive',
  'cannonRoom',
  'pockets',
  'wallTiles',
  'piecesPlaced',
  'piecesBudget',
  'shotsFired',
  'territoryPoints',
  'damagePoints',
  'score',
  'repairAtBuild',
  'repairLeft',
  'repairStuck',
];

/**
 * Pieces this tier could lay in a whole build phase.
 *
 * The same arithmetic the bot itself prices a plan with — base plus per-cell over an
 * average piece of 3.5 cells — so `piecesPlaced / piecesBudget` reads directly as how
 * much of the phase a bot actually used. A bot that seals early and then stands idle
 * shows up here as a ratio well under one, with nothing else needing to be measured.
 */
export function piecesBudget(bundle: ConfigBundle, tier: Tier): number | null {
  // A person has no pace to price a phase with; their pieces are counted, not rated. A
  // zero here once read in the table as "used none of it".
  if (tier === 'human') return null;
  const profile = skillAt(bundle.ai, tier.level);
  const perPiece = profile.placementBaseMs + profile.placementPerCellMs * 3.5;
  return bundle.ruleset.phases.buildMs / perPiece;
}

function wallTilesOf(state: MatchState, playerId: number): number {
  const islandId = state.players[playerId]?.islandId;
  let tiles = 0;
  for (let i = 0; i < state.structure.length; i++) {
    if (state.structure[i] === Structure.Wall && state.islandId[i] === islandId) tiles++;
  }
  return tiles;
}

/** Whether any piece in the player's current bag can legally cover tile `i`. */
function coverable(state: MatchState, playerId: number, i: number): boolean {
  const player = state.players[playerId];
  if (player === undefined) return false;
  const tx = i % state.width;
  const ty = (i - tx) / state.width;
  const fits = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false;
    const j = y * state.width + x;
    return (
      state.terrain[j] === Terrain.Land &&
      state.structure[j] === Structure.Empty &&
      state.islandId[j] === player.islandId
    );
  };
  for (const id of poolForRound(state.ruleset, player.pieceRound).ids) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const cells = pieceCells(id, rotation);
      // Every way of laying this piece so that one of its cells lands on the tile.
      for (const [ax, ay] of cells) {
        if (cells.every(([cx, cy]) => fits(tx - ax + cx, ty - ay + cy))) return true;
      }
    }
  }
  return false;
}

/** The rows as CSV, a header line first — for a file, wherever the caller keeps it. */
export function statsCsv(rows: readonly StatRow[]): string {
  const lines = [STAT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      STAT_COLUMNS.map((column) => {
        const value = row[column];
        if (value === null) return '';
        return typeof value === 'number' ? Number(value.toFixed(2)) : String(value);
      }).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A table `statsCsv` wrote, read back — a soak's or a recording's alike. Columns are found
 * by name, so a file from before a column was added still reads, the new one at its
 * zero; an empty level is a person's.
 */
export function parseStatsCsv(text: string): StatRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = (header ?? '').split(',');
  if (!names.includes('match') || !names.includes('score')) throw new Error('not a stats table');
  return lines.map((line) => {
    const cells = line.split(',');
    const raw = (column: keyof StatRow): string => cells[names.indexOf(column)] ?? '';
    const num = (column: keyof StatRow): number => Number(raw(column) || 0);
    const row = {} as Record<keyof StatRow, unknown>;
    for (const column of STAT_COLUMNS) row[column] = num(column);
    row.match = raw('match');
    row.personality = raw('personality');
    row.eliminated = raw('eliminated') === 'true';
    row.level = raw('level') === '' ? null : num('level');
    row.piecesBudget = raw('piecesBudget') === '' ? null : num('piecesBudget');
    return row as unknown as StatRow;
  });
}

/**
 * Gathers the rows for one match as it is stepped — bots in a soak, or a recording being
 * replayed — so people and bots are measured by exactly the same code.
 *
 * Call `observe` after every step with the events that step produced.
 */
export class RoundStats {
  readonly rows: StatRow[] = [];
  // Reset at every resolution, so a row counts only its own round's work.
  private readonly placed = new Map<number, number>();
  private readonly fired = new Map<number, number>();
  private readonly repairAtBuild = new Map<number, number>();
  private readonly repairLeft = new Map<number, number>();
  private readonly repairStuck = new Map<number, number>();

  constructor(
    private readonly bundle: ConfigBundle,
    private readonly match: string,
    private readonly seed: number,
    private readonly tierOf: (player: number) => Tier,
  ) {}

  observe(state: MatchState, events: readonly MatchEvent[]): void {
    /**
     * The tightest wall that would seal a castle, in cells still to fill — zero for a
     * wall that stands. Asked of the min cut rather than of `enclosedCastles`, which is
     * not recomputed when shots land and so still says "sealed" as a breached phase
     * opens.
     */
    const tightestRepair = (id: number): number =>
      cheapestPlanFor(state, id, 1, 1)?.cost ?? Number.POSITIVE_INFINITY;

    // Measured once as the phase opens and once on its last tick, which is the last
    // moment before the resolution wipes a failed island.
    if (state.phase === 'build' && state.tick === state.phaseEndTick - 1) {
      for (const p of state.players) {
        if (p.eliminated) continue;
        const plan = cheapestPlanFor(state, p.id, 1, 1);
        this.repairLeft.set(p.id, plan?.cost ?? Number.POSITIVE_INFINITY);
        const missing = plan?.tiles.filter((i) => state.structure[i] === Structure.Empty) ?? [];
        this.repairStuck.set(p.id, missing.filter((i) => !coverable(state, p.id, i)).length);
      }
    }

    for (const event of events) {
      if (event.kind === 'phase_changed' && event.phase === 'build') {
        for (const p of state.players) {
          if (!p.eliminated) this.repairAtBuild.set(p.id, tightestRepair(p.id));
        }
      } else if (event.kind === 'piece_placed') {
        this.placed.set(event.player, (this.placed.get(event.player) ?? 0) + 1);
      } else if (event.kind === 'shot_fired') {
        this.fired.set(event.shot.owner, (this.fired.get(event.shot.owner) ?? 0) + 1);
      } else if (event.kind === 'round_resolved') {
        // Sampled after the step that produced the event, so the sweep has already
        // run and these are the walls and guns the next barrage will meet.
        for (const result of event.results) {
          let owned = 0;
          let active = 0;
          for (const cannon of state.cannons) {
            if (cannon.owner !== result.player) continue;
            owned++;
            if (cannon.active) active++;
          }
          const tier = this.tierOf(result.player);
          this.rows.push({
            match: this.match,
            seed: this.seed,
            round: event.round,
            player: result.player,
            level: tier === 'human' ? null : tier.level,
            personality: tier === 'human' ? '' : personalityWords(tier.personality),
            enclosedCastles: result.enclosedCastles,
            cannonsAwarded: result.cannonsAwarded,
            eliminated: result.eliminated,
            cannonsOwned: owned,
            cannonsActive: active,
            cannonRoom: cannonRoom(state, result.player),
            pockets: pocketCount(state, result.player),
            wallTiles: wallTilesOf(state, result.player),
            piecesPlaced: this.placed.get(result.player) ?? 0,
            piecesBudget: piecesBudget(this.bundle, tier),
            shotsFired: this.fired.get(result.player) ?? 0,
            territoryPoints: result.territoryPoints,
            damagePoints: result.damagePoints,
            score: state.players[result.player]?.score ?? 0,
            repairAtBuild: this.repairAtBuild.get(result.player) ?? 0,
            repairLeft: this.repairLeft.get(result.player) ?? 0,
            repairStuck: this.repairStuck.get(result.player) ?? 0,
          });
        }
        this.placed.clear();
        this.fired.clear();
        this.repairAtBuild.clear();
        this.repairLeft.clear();
        this.repairStuck.clear();
      }
    }
  }
}
