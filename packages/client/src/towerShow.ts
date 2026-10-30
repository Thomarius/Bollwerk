import { defaultRuleset, variantCost, variantKind, type TowerVariant } from '@bollwerk/config';
import {
  advanceWaves,
  applyEnclosure,
  drainEvents,
  fire,
  inFlight,
  repairWalls,
  resolveImpacts,
  stateFromAscii,
  withSpecials,
  type MatchEvent,
  type MatchState,
} from '@bollwerk/sim';

/**
 * What a special tower does, played by the rules themselves for the tower menu's preview
 * (the user's, 2026-10-16): two small islands, the chooser's on the left with their tower —
 * or an ordinary cannon, for none — and a rival's on the right, and a loop of shots fired
 * with the sim's own `fire`, landed by `resolveImpacts` and, for the Architect, rebuilt by
 * `repairWalls`. So every number is the chosen variant's own: Bertha's cross and her flight,
 * the Architect's reach, the Rapid's barrels, the Laser's walls pierced, the Subwoofer's waves
 * and its cooldown between them. No Pixi here; `towerPreview.ts` draws it.
 */

/** `XX` is the chooser's gun, as `stateFromAscii` writes it: `*`, or a tower's letter. */
const BOARD = `
  ............................
  .,,,,,,,,,,,....,,,,,,,,,,,.
  .,#########,....,#########,.
  .,#,,,,,,,#,....,#,,,,,,,#,.
  .,#,@@,,XX#,....,#**,**@@#,.
  .,#,@@,,XX#,....,#**,**@@#,.
  .,#,,,,,,,#,....,#,,,,,,,#,.
  .,#########,....,#########,.
  .,,,,,,,,,,,....,,,,,,,,,,,.
  ............................
`;
/** Where the rival's island begins: everything from this column on is theirs. */
const RIVAL_FROM = 16;

/** The rival's west wall, facing the chooser's gun across the channel. */
const FACING = [
  { x: 17, y: 4 },
  { x: 17, y: 3 },
  { x: 17, y: 5 },
] as const;
/**
 * The Laser Tower's aim: the rival's top wall, from the gun at (8.5, 4.5), so the beam runs
 * along it — through the west wall's top, then that wall a block after another, as many as the
 * variant pierces (two, and at cost 3 a third half the time).
 */
const ALONG_TOP = { x: 22, y: 2 } as const;
/**
 * The Subwoofer's aim: the board's east edge, level with its gun, so its lanes cross the rival's
 * west wall and then its east wall each in a row of its own. From a 2x2 gun's centre no aim is
 * quite level; aimed at the wall itself, its upper lane crept a row up by the far wall.
 */
const FAR_EAST = { x: 27, y: 4 } as const;
/**
 * The rival's barrage on the chooser's Architect, at (8, 4): the east wall beside it, which
 * both costs rebuild; the top wall above it, which only cost 3's wider reach takes in; and a
 * corner far from it, which neither does — so the reach is seen where it ends.
 */
const ON_ARCHITECT = [
  { x: 10, y: 4 },
  { x: 10, y: 6 },
  { x: 9, y: 2 },
  { x: 4, y: 7 },
] as const;

const GLYPH: Record<TowerVariant, string> = {
  bertha2: 'b',
  bertha3: 'B',
  architect2: 'a',
  architect3: 'A',
  rapid2: 'r',
  rapid3: 'R',
  lightning2: 'l',
  lightning3: 'L',
  biggest2: 'g',
  biggest3: 'G',
  laser2: 'x',
  laser3: 'X',
  frost2: 'f',
  frost3: 'F',
  lullaby2: 'z',
  lullaby3: 'Z',
  subwoofer2: 'w',
  subwoofer3: 'W',
};

/** Before the first shot of a loop, after its last lands, and before the repair. */
const AIM_MS = 700;
const AFTER_MS = 1400;
const REPAIR_MS = 600;
/** Between the Rapid Cannon's barrels, so they are seen firing in turn. */
const BARREL_MS = 260;

/** The board for a variant: both rings sealed, every gun active, towers played. */
export function showState(variant: TowerVariant | null): MatchState {
  const art = BOARD.replaceAll('X', variant === null ? '*' : GLYPH[variant]);
  const islands = art
    .split('\n')
    .map((row) =>
      [...row]
        .map((c, x) => {
          const at = x - (row.length - row.trimStart().length);
          return at >= RIVAL_FROM && c !== '.' && c !== ' ' ? '2' : c === ' ' ? ' ' : '.';
        })
        .join(''),
    )
    .join('\n');
  const state = stateFromAscii(art, withSpecials(defaultRuleset), islands);
  state.phase = 'combat';
  state.phaseEndTick = Number.MAX_SAFE_INTEGER;
  for (const player of state.players) {
    const castle = state.castles.find((c) => c.islandId === player.islandId);
    player.startingCastleId = castle?.id ?? null;
  }
  const chooser = state.players[0];
  if (chooser !== undefined) chooser.special = variant;
  applyEnclosure(state);
  return state;
}

interface Planned {
  player: number;
  x: number;
  y: number;
  /** Not fired before this many milliseconds into the loop. */
  at: number;
}

/** One frame's news for the drawing: the sim's events, and whether the board was reset. */
export interface ShowFrame {
  events: MatchEvent[];
  reset: boolean;
}

export class TowerShow {
  readonly state: MatchState;
  private readonly structure: MatchState['structure'];
  private readonly owner: MatchState['owner'];
  private ticks = 0;
  /** Milliseconds into the current loop. */
  private ms = 0;
  private plan: Planned[] = [];
  /** The Architect's repair still to come, at this time; null once done or for no repair. */
  private repairAt: number | null = null;
  /** When the loop's last shot landed (and its repair ran); null while it is going on. */
  private doneAt: number | null = null;

  constructor(readonly variant: TowerVariant | null) {
    this.state = showState(variant);
    this.structure = this.state.structure.slice();
    this.owner = this.state.owner.slice();
    this.begin();
  }

  /** Plays on by `deltaMs` of real time, at the rules' tick rate. */
  advance(deltaMs: number): ShowFrame {
    const state = this.state;
    let reset = false;
    this.ms += deltaMs;
    this.ticks += (deltaMs * state.ruleset.tickRateHz) / 1000;
    while (state.tick < Math.floor(this.ticks)) {
      state.tick++;
      resolveImpacts(state);
      advanceWaves(state);
    }
    // A gun fires once it is loaded: a plan waits on its barrel, as a click would.
    while (this.plan.length > 0 && this.ms >= (this.plan[0] as Planned).at) {
      const next = this.plan[0] as Planned;
      if ('rejection' in fire(state, next.player, next.x, next.y)) break;
      this.plan.shift();
    }
    const quiet = this.plan.length === 0 && !inFlight(state);
    if (quiet && this.repairAt === null && this.doneAt === null) {
      if (this.isArchitect()) this.repairAt = this.ms + REPAIR_MS;
      else this.doneAt = this.ms;
    }
    if (this.repairAt !== null && this.ms >= this.repairAt) {
      repairWalls(state);
      this.repairAt = null;
      this.doneAt = this.ms;
    }
    if (this.doneAt !== null && this.ms >= this.doneAt + AFTER_MS) {
      this.restore();
      this.begin();
      reset = true;
    }
    return { events: drainEvents(state), reset };
  }

  /** How far into its tick the show is, 0 to 1, for the waves to glide between ticks. */
  get tickFraction(): number {
    return this.ticks - Math.floor(this.ticks);
  }

  private isArchitect(): boolean {
    return this.variant !== null && variantKind(this.variant) === 'architect';
  }

  /** The loop's shots: the chooser's at the rival's wall, or the rival's at the Architect. */
  private begin(): void {
    this.ms = 0;
    this.doneAt = null;
    this.repairAt = null;
    const variant = this.variant;
    if (variant !== null && variantKind(variant) === 'architect') {
      this.plan = ON_ARCHITECT.map((t) => ({ player: 1, ...t, at: AIM_MS }));
    } else if (variant !== null && variantKind(variant) === 'rapid') {
      this.plan = FACING.slice(0, variantCost(variant)).map((t, k) => ({
        player: 0,
        ...t,
        at: AIM_MS + k * BARREL_MS,
      }));
    } else if (variant !== null && variantKind(variant) === 'laser') {
      this.plan = [{ player: 0, ...ALONG_TOP, at: AIM_MS }];
    } else if (variant !== null && variantKind(variant) === 'subwoofer') {
      // Two waves at the rival's wall facing it, the second once reloaded: the first opens a gap
      // as wide as the wave, the second goes through it to the wall behind.
      this.plan = [0, 1].map(() => ({ player: 0, ...FAR_EAST, at: AIM_MS }));
    } else {
      this.plan = [{ player: 0, ...FACING[0], at: AIM_MS }];
    }
  }

  /** The walls back as they were, every gun loaded, for the next loop. */
  private restore(): void {
    const state = this.state;
    state.structure.set(this.structure);
    state.owner.set(this.owner);
    state.shots = [];
    state.waves = [];
    state.lostWalls = [];
    state.frozen = [];
    for (const cannon of state.cannons) {
      cannon.shotIds = [];
      delete cannon.asleepUntil;
      delete cannon.lulled;
    }
  }
}
