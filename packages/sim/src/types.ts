import type { Ruleset, SpecialKind, TerrainConfig, TowerVariant } from '@bollwerk/config';

export const Terrain = { Water: 0, Land: 1 } as const;
export type TerrainKind = (typeof Terrain)[keyof typeof Terrain];

export const Structure = { Empty: 0, Wall: 1, Castle: 2, Cannon: 3 } as const;
export type StructureKind = (typeof Structure)[keyof typeof Structure];

/** An ordinary gun, or one of the special towers (docs/SPECIAL_TOWERS.md). */
export type CannonKind = 'cannon' | SpecialKind;

export const PHASES = [
  'lobby',
  'castle_select',
  /** Between phases: shots land, then the next phase is announced. */
  'intermission',
  'combat',
  'build',
  'cannon_place',
  'game_over',
] as const;
export type Phase = (typeof PHASES)[number];

export interface PlayerState {
  /** 0-based. The island a player owns is `id + 1`, matching the islandId layer. */
  id: number;
  islandId: number;
  name: string;
  isBot: boolean;
  eliminated: boolean;
  eliminatedRound: number | null;
  /** Castle chosen during castle_select; the auto-built ring surrounds it. */
  startingCastleId: number | null;
  /** Castles sealed at the last resolution — drives the cannon reward. */
  enclosedCastles: number;
  /** Cannons still to be placed this cannon_place phase. */
  cannonsToPlace: number;
  /** Position in this round's queue. */
  pieceIndex: number;
  /**
   * The team this player is on. Every match is a team match: free-for-all is teams of
   * one, so a rule written for teams is the free-for-all rule too.
   */
  team: number;
  /**
   * The round this player's piece schedule is at, which is not always the match's.
   *
   * A continue rewinds it to zero, so the next round deals the small pieces a player
   * starting again needs to close a ring. For anyone who has never continued it tracks
   * `round` exactly.
   */
  pieceRound: number;
  /** Whether this player has placed their one piece of the build phase's overtime. */
  overtimeSpent: boolean;
  /** Points banked at resolutions. Only a sealed round adds to it. */
  score: number;
  /**
   * Opponents' wall tiles this player destroyed since the last resolution — not yet
   * points, because failing to seal forfeits them.
   */
  wallsDestroyed: number;
  /** The special tower this player brings to the match, at its cost, or null; fixed at its start. */
  special: TowerVariant | null;
  /** Towers bought in this cannon phase, against `specials.perRound`; zeroed as combat begins. */
  specialsBought: number;
  /**
   * Whether this player's coming or current cannon phase is an opening placement — the
   * match's first, or the one after a continue — in which no tower may be bought. Set as
   * a castle is owed, cleared as the cannon phase ends, since the castle chosen during it
   * no longer tells the two apart.
   */
  openingPlacement: boolean;
}

/**
 * What a team holds in common: its lives. Score is not here — each member keeps their
 * own, and the team's is their sum (`teamScore`).
 */
export interface TeamState {
  id: number;
  /**
   * Lives left in the pool: the sum of every member's continues at the start. A member
   * who fails to seal spends one; failing with none left puts the whole team out.
   */
  continuesRemaining: number;
  /** The pool as it started, so a continue can count how many the team has spent. */
  continuesAtStart: number;
}

export interface Castle {
  id: number;
  islandId: number;
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  enclosed: boolean;
}

export interface Cannon {
  id: number;
  /** Owning player id. */
  owner: number;
  kind: CannonKind;
  /** Cannon placements it cost: 1 for an ordinary cannon, a tower's 2 or 3 (its variant). */
  cost: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** False when the cannon sits outside an enclosed region: it survives but cannot fire. */
  active: boolean;
  /**
   * Its shots in flight, oldest first. A gun is ready while it has a barrel free
   * (`isLoaded`): one for every gun but a Rapid Cannon, which has one per cannon it cost.
   */
  shotIds: number[];
}

export interface Shot {
  id: number;
  cannonId: number;
  owner: number;
  /** The kind of gun that fired it and that gun's cost, which decide its crater. */
  kind: CannonKind;
  cost: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  launchTick: number;
  impactTick: number;
}

export type Action =
  | { kind: 'select_castle'; player: number; castleId: number }
  | { kind: 'fire'; player: number; x: number; y: number }
  | { kind: 'place_piece'; player: number; x: number; y: number; rotation: number }
  /** `special` places the player's tower instead of an ordinary cannon. */
  | { kind: 'place_cannon'; player: number; x: number; y: number; special?: true | undefined };

export type ActionKind = Action['kind'];

/** A timestamped action, as recorded in an input log and replayed in tests. */
export interface LoggedAction {
  tick: number;
  action: Action;
}

export type MatchEvent =
  | {
      kind: 'phase_changed';
      tick: number;
      phase: Phase;
      round: number;
      phaseEndTick: number;
      pendingPhase: Phase | null;
    }
  | { kind: 'castle_selected'; tick: number; player: number; castleId: number }
  | { kind: 'shot_fired'; tick: number; shot: Shot }
  | { kind: 'shot_impact'; tick: number; shotId: number; x: number; y: number; destroyed: number[] }
  | {
      /** A Lightning Tower's strike, on the tick it fired: every tile struck in order. */
      kind: 'lightning_struck';
      tick: number;
      shotId: number;
      owner: number;
      fromX: number;
      fromY: number;
      path: { x: number; y: number }[];
      destroyed: number[];
    }
  | {
      kind: 'piece_placed';
      tick: number;
      player: number;
      pieceId: number;
      rotation: number;
      cells: number[];
    }
  | {
      kind: 'cannon_placed';
      tick: number;
      player: number;
      cannonId: number;
      x: number;
      y: number;
      cannonKind: CannonKind;
      cannonCost: number;
    }
  | { kind: 'round_resolved'; tick: number; round: number; results: RoundResult[] }
  | {
      /** A player failed to seal anything and spent a life rather than being knocked out. */
      kind: 'player_continued';
      tick: number;
      player: number;
      round: number;
      continuesRemaining: number;
    }
  | { kind: 'walls_swept'; tick: number; tiles: number[] }
  /** An Architect's repair as a barrage ends: the walls it rebuilt for its owner. */
  | {
      /** An Architect's repair: the walls rebuilt, and how many of the player's Architects did it. */
      kind: 'walls_repaired';
      tick: number;
      player: number;
      tiles: number[];
      towers: number;
    }
  | { kind: 'player_eliminated'; tick: number; player: number; round: number }
  | {
      kind: 'game_over';
      tick: number;
      winners: number[];
      draw: boolean;
      endedBy: MatchEnd;
    };

/**
 * How a match ended: by one player outlasting the rest, or by reaching the round cap
 * with several still in, when the highest score among them wins.
 */
export type MatchEnd = 'elimination' | 'round_cap';

export interface RoundResult {
  player: number;
  enclosedCastles: number;
  cannonsAwarded: number;
  eliminated: boolean;
  /** Banked this resolution, so nobody downstream has to recompute the formula. */
  territoryPoints: number;
  /** For the guns firing at the resolution, the ones just earned not yet among them. */
  gunPoints: number;
  damagePoints: number;
}

export interface MatchState {
  seed: number;
  ruleset: Ruleset;
  terrainConfig: TerrainConfig;

  width: number;
  height: number;

  tick: number;
  round: number;
  phase: Phase;
  phaseEndTick: number;
  /** During an intermission, the phase that begins once it ends. */
  pendingPhase: Phase | null;
  /**
   * The build phase's overtime: its clock has run out, and each player may still place
   * the piece they hold. `phaseEndTick` is then the end of the overtime.
   */
  overtime: boolean;

  players: PlayerState[];
  /** Indexed by team id. */
  teams: TeamState[];
  /**
   * Each team's name, by team id, where the table names them — a tournament's teams — or
   * null for the letters. Shown, never played: no rule reads it and the hash leaves it out.
   */
  teamNames: string[] | null;

  /** Static after generation. */
  terrain: Uint8Array;
  islandId: Uint8Array;
  /** Dynamic. */
  structure: Uint8Array;
  owner: Uint8Array;
  /** Recomputed each resolution: owning player + 1 for enclosed regions, else 0. */
  territory: Uint8Array;

  castles: Castle[];
  cannons: Cannon[];
  shots: Shot[];
  /**
   * Wall tiles shots have cleared since the last barrage ended, in the order they fell,
   * for the Architects' repair; emptied once it has run. Every island's, whoever owns an
   * Architect, so the repair needs no record kept in advance.
   */
  lostWalls: number[];

  nextCannonId: number;
  nextShotId: number;

  /**
   * Empty until the match ends, and empty after a draw. More than one is a shared win
   * on points at the cap, which is not a draw: those players did win.
   */
  winners: number[];
  draw: boolean;
  endedBy: MatchEnd | null;

  /** Drained by the server each tick and broadcast; never part of the state hash. */
  events: MatchEvent[];
}
