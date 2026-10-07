import { defaultConfigBundle } from '@bollwerk/config';
import { computeEnclosure, type MatchState } from '@bollwerk/sim';

import type { Scene } from './render/scene.js';
import type { Choice } from './render/theme.js';
import {
  drainWash,
  drainsFrom,
  floodFrom,
  floodOver,
  releaseDrains,
  sealGlow,
  territoryDuring,
  type Flood,
  type SealGlow,
} from './seal.js';
import {
  boardWithStanding,
  holdsCombatEnclosure,
  crumbleOutward,
  lostWalls,
  stillStanding,
  type Look,
  type Ruin,
  type SweptWall,
} from './transition.js';

type Enclosure = ReturnType<typeof computeEnclosure>;

/**
 * The board as a match screen draws it, which is not quite the board as it stands: walls
 * the sim swept still standing until the banner's line reaches them, walls lost with a
 * life crumbling outward, the enclosure combat began with held up through combat, newly
 * sealed ground flooding out from its castle and lost ground draining away, the tally's
 * glow, and the bursts of castles just chosen. Reads the match afresh every time, so a
 * snapshot replacing it is seen at once.
 */
export class BoardEffects {
  /**
   * Walls the sim swept at the last resolution that the banner has not yet reached; see
   * `transition.ts`. Owners are read from the board as last drawn, because the sweep
   * has already zeroed them in the state.
   */
  private swept: SweptWall[] = [];
  /** The owner layer as last drawn, for exactly that. */
  private drawnOwner: Uint8Array;
  /**
   * Walls lost with a life, crumbling outward from the middle of the island; see
   * `crumbleOutward`. Drawn standing until each one's moment comes.
   */
  private ruins: Ruin[] = [];
  /** The structure layer as last drawn, beside the owners, to find what a wipe took. */
  private drawnStructure: Uint8Array;
  /** Castles chosen lately, for the burst each choice sets off; see `drawChoices`. */
  private choices: { castleId: number; owner: number; at: number }[] = [];

  /** The board's enclosure as it stands, for display; see `Scene.drawTerritory`. */
  live: Enclosure;
  /**
   * The enclosure as combat began, held for the combat look and the HUD until building
   * begins (`holdsCombatEnclosure`); null outside that. A breach counts for nothing until
   * then, so nothing that says "sealed" should come down with the wall.
   */
  private held: Enclosure | null = null;

  /**
   * Newly sealed ground flooding out from its castle; see `seal.ts`. Started whenever
   * the enclosure gains territory — a breach closed, a castle chosen, a loop widened —
   * and drawn in both looks, since it shows exactly what was sealed.
   */
  private floods: Flood[] = [];
  /**
   * Ground lost to breaches draining away (`drainsFrom`), in the build look — the
   * enclosure combat began with against the board as it stands. Each island's drain
   * starts as the "Rebuild" banner's line reaches it (`releaseDrains`). With one style
   * for both looks the held board stays up until building begins, so the drains wait for
   * that: `drainDue` keeps the held enclosure until then.
   */
  private drains: Flood[] = [];
  private drainDue: Enclosure | null = null;
  /**
   * The tally at a resolution: a glow sweeping each scoring island's territory outward
   * from its castles while its points count up, timed to finish together (`tallyMs`).
   * Glow only — the ground is already held, so nothing is hidden.
   */
  private tallies: { flood: Flood; speed: number }[] = [];
  /** Players whose points were just banked, tallied once the enclosure is refreshed. */
  private readonly tallyDue: number[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly match: { readonly state: MatchState },
  ) {
    this.drawnOwner = match.state.owner.slice();
    this.drawnStructure = match.state.structure.slice();
    this.live = computeEnclosure(match.state);
  }

  private get state(): MatchState {
    return this.match.state;
  }

  /** One style for both looks: one set of layers, which shows the held board in combat. */
  private oneLook(): boolean {
    return this.scene.styles.build === this.scene.styles.combat;
  }

  /** The enclosure a look shows. */
  enclosureFor(look: Look): Enclosure {
    return this.held !== null && (look === 'combat' || this.oneLook()) ? this.held : this.live;
  }

  /** Walls, castles and cannons, with any swept or ruined wall still standing put back. */
  drawBoard(): void {
    const board = boardWithStanding(this.state, [...this.swept, ...this.ruins]);
    this.scene.drawStructures({ ...this.state, ...board });
    this.drawnOwner = board.owner.slice();
    this.drawnStructure = board.structure.slice();
  }

  /** Takes down each ruined block as its moment comes. */
  crumbleRuins(): void {
    if (this.ruins.length === 0) return;
    const now = performance.now();
    const falling = this.ruins.filter((ruin) => ruin.dueMs <= now);
    if (falling.length === 0) return;
    const width = this.state.width;
    for (const ruin of falling) {
      const x = ruin.index % width;
      this.scene.noteCrumble({ x, y: (ruin.index - x) / width, owner: ruin.owner - 1 });
    }
    this.ruins = this.ruins.filter((ruin) => ruin.dueMs > now);
    this.drawBoard();
  }

  /** A castle chosen, for its burst. */
  noteChoice(castleId: number, owner: number): void {
    this.choices.push({ castleId, owner, at: performance.now() });
  }

  /**
   * The walls the sim swept, drawn away by the next banner rather than now; see
   * `sweepUnderBanner`. A block placed in this same step was never drawn, so its island
   * says whose.
   */
  noteSwept(tiles: readonly number[]): void {
    this.swept = tiles.map((index) => ({
      index,
      owner: (this.drawnOwner[index] as number) || (this.state.islandId[index] as number),
    }));
  }

  /** A life lost: the wipe took the island's wall in one step; take it down outward instead. */
  noteWipe(island: number, centre: { x: number; y: number }): void {
    const lost = lostWalls(this.drawnStructure, this.drawnOwner, this.state.structure, island);
    this.ruins.push(
      ...crumbleOutward(
        lost,
        this.state.width,
        centre,
        performance.now(),
        defaultConfigBundle.art.effects.lifeCrumbleMs,
      ),
    );
  }

  /** Points banked for this player, tallied once the enclosure is refreshed. */
  noteTally(player: number): void {
    this.tallyDue.push(player);
  }

  /**
   * After a batch of events: the board drawn again if its structures changed, and the
   * enclosure counted afresh if anything could have moved it — floods for what was gained,
   * the tally for what was banked. Returns the castles sealed before and after, or null
   * when the enclosure was not counted.
   */
  refresh(
    structuresChanged: boolean,
    territoryChanged: boolean,
  ): { sealedBefore: boolean[]; sealedAfter: boolean[] } | null {
    if (structuresChanged) this.drawBoard();
    if (!territoryChanged && !structuresChanged) return null;
    // Taken before this batch's shots are counted, so it is the board combat began on.
    this.held = holdsCombatEnclosure(this.state) ? (this.held ?? this.live) : null;
    const before = this.live.territory;
    const sealedBefore = this.live.castleEnclosed;
    this.live = computeEnclosure(this.state);
    const now = performance.now();
    const flood = floodFrom(before, this.live.territory, this.state.width, this.state.castles, now);
    if (flood !== null) this.floods.push(flood);
    this.drawFloodedTerritory(now);
    this.startTallies(now);
    return { sealedBefore, sealedAfter: this.live.castleEnclosed };
  }

  /**
   * "Rebuild": the barrage is over, and what it took drains away as the banner reveals
   * the board — at once in the build look, or as building begins when one style draws
   * both looks and holds the old board until then.
   */
  startRebuild(): void {
    if (this.held === null) return;
    if (this.oneLook()) this.drainDue = this.held;
    else this.startDrain(this.held);
  }

  /**
   * As a banner crosses at `lineY` (null with none): swept walls go as its line passes
   * them, and each island's lost ground drains as the line reaches it — all of it once
   * the banner has gone.
   */
  underBanner(lineY: number | null): void {
    this.sweepUnderBanner(lineY);
    if (this.drains.length > 0 && !this.oneLook()) {
      releaseDrains(
        this.drains,
        this.state.phase !== 'intermission' || lineY === null
          ? Number.POSITIVE_INFINITY
          : this.scene.rowAt(lineY),
        this.state.width,
        performance.now(),
      );
    }
  }

  /** Advances the floods and tallies by a frame, and returns the glow at their fronts. */
  advanceFloods(): SealGlow[] {
    const { sealFloodTilesPerSecond, sealGlowTiles } = defaultConfigBundle.art.effects;
    if (this.floods.length === 0 && this.tallies.length === 0) return [];
    const now = performance.now();
    const width = this.state.width;
    this.tallies = this.tallies.filter(
      ({ flood, speed }) => !floodOver(flood, now, speed, sealGlowTiles),
    );
    const tallied = this.tallies.flatMap(({ flood, speed }) =>
      sealGlow([flood], now, width, speed, sealGlowTiles),
    );
    if (this.floods.length === 0) return tallied;
    this.floods = this.floods.filter(
      (flood) => !floodOver(flood, now, sealFloodTilesPerSecond, sealGlowTiles),
    );
    this.drawFloodedTerritory(now);
    return [
      ...sealGlow(this.floods, now, width, sealFloodTilesPerSecond, sealGlowTiles),
      ...tallied,
    ];
  }

  /** Advances the draining of lost ground by a frame, and returns its wash. */
  advanceDrains(now: number): ReturnType<typeof drainWash> | [] {
    const { drainTilesPerSecond } = defaultConfigBundle.art.effects;
    if (this.drainDue !== null && this.state.phase === 'build') {
      this.startDrain(this.drainDue);
      this.drainDue = null;
      releaseDrains(this.drains, Number.POSITIVE_INFINITY, this.state.width, now);
    }
    if (this.drains.length === 0) return [];
    this.drains = this.drains.filter((drain) => !floodOver(drain, now, drainTilesPerSecond, 1));
    return drainWash(this.drains, now, this.state.width, drainTilesPerSecond);
  }

  /** The bursts of castles chosen lately, for `drawChoices`. */
  recentChoices(now: number): Choice[] {
    const span = defaultConfigBundle.art.effects.choiceBurstMs;
    this.choices = this.choices.filter((c) => now - c.at < span);
    return this.choices.flatMap((c) => {
      const castle = this.state.castles.find((k) => k.id === c.castleId);
      return castle === undefined ? [] : [{ castle, owner: c.owner, ageMs: now - c.at }];
    });
  }

  private startDrain(from: Enclosure): void {
    this.drains.push(
      ...drainsFrom(from.territory, this.live.territory, this.live.outside, this.state.width),
    );
  }

  /** Territory as each look shows it; the live board less what the floods have not reached. */
  drawFloodedTerritory(now: number): void {
    const { sealFloodTilesPerSecond } = defaultConfigBundle.art.effects;
    const flooded = territoryDuring(this.live.territory, this.floods, now, sealFloodTilesPerSecond);
    this.scene.drawTerritory(this.state, {
      build:
        this.enclosureFor('build') === this.live ? flooded : this.enclosureFor('build').territory,
      combat:
        this.enclosureFor('combat') === this.live ? flooded : this.enclosureFor('combat').territory,
    });
  }

  private startTallies(now: number): void {
    const { width, castles } = this.state;
    const { tallyMs, sealGlowTiles } = defaultConfigBundle.art.effects;
    const empty = new Uint8Array(this.live.territory.length);
    for (const player of this.tallyDue.splice(0)) {
      const theirs = this.live.territory.map((owner) => (owner === player + 1 ? owner : 0));
      const flood = floodFrom(empty, theirs, width, castles, now);
      if (flood === null) continue;
      this.tallies.push({ flood, speed: ((flood.maxDist + sealGlowTiles) * 1000) / tallyMs });
    }
  }

  /** Takes away each swept wall as the banner's line passes it. */
  private sweepUnderBanner(lineY: number | null): void {
    if (this.swept.length === 0) return;
    // Any banner will do — normally "Place cannons", but "Fire!" when nobody had guns
    // to place — and once the intermission is over, whatever is left goes.
    const over = this.state.phase !== 'intermission';
    const lineRow = over
      ? Number.POSITIVE_INFINITY
      : lineY === null
        ? Number.NEGATIVE_INFINITY
        : this.scene.rowAt(lineY);
    const standing = stillStanding(this.swept, this.state.width, lineRow);
    if (standing.length === this.swept.length) return;
    const width = this.state.width;
    const kept = new Set(standing.map((wall) => wall.index));
    for (const wall of this.swept) {
      if (kept.has(wall.index)) continue;
      const x = wall.index % width;
      this.scene.noteCrumble({ x, y: (wall.index - x) / width, owner: wall.owner - 1 });
    }
    this.swept = standing;
    this.drawBoard();
  }
}
