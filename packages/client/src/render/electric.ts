import type { ArtConfig, ElectricStyleConfig } from '@bollwerk/config';
import { Structure, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { BlurFilter, Graphics } from 'pixi.js';

import { bloomWanted, motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { hash } from './noise.js';
import { climax, cornerSpot, pressing } from './corner.js';
import { IslandParts } from './islandParts.js';
import { outerOcean } from './ocean.js';
import { weatherFor, type Weather } from './pixel/atmosphere.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { ElectricSeaLife } from './seaLife.js';
import {
  ARC_HALO,
  ARC_WHITE,
  BRASS,
  COPPER,
  COPPER_DARK,
  drawArc,
  drawBall,
  drawBolt,
  jag,
} from './spark.js';
import { Discs, Memos, StampBook, Stamps, viewKey } from './stamps.js';
import {
  FlagHoist,
  GhostMotion,
  Fireworks,
  WinnerBanners,
  GunAims,
  RuinSmoke,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawSealPreview,
  drawChoices,
  drawSelectable,
  drawFireReticle,
  drawOvertimeBorder,
  drawDrain,
  drawSealGlow,
  drawMainCastles,
  drawShotTarget,
  hex,
  mixed,
  shotLift,
  tileX,
  tileY,
  type Cell,
  type Debris,
  type EffectFrame,
  type FinishLook,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
  shotProgress,
} from './theme.js';
import { hatch, outline, trace, wallGeometry, type Segment } from './walls.js';
import { ShapeTheme } from './shapeTheme.js';

/** Something with a place and an age: a flash, a fizz, a short, a puff of smoke. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A hit on a wall, the arc chaining on through the cage to the blocks next to it. */
interface Chain {
  x: number;
  y: number;
  age: number;
  owner: number;
  /** The wall cells it leaps to, in order, found on its first frame. */
  path: Cell[] | null;
}

/** A spark thrown off a hit, a short or a weld, in tiles. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** Current running along a player's wall for a moment: the cells it crosses. */
interface Crackle {
  path: Cell[];
  owner: number;
  age: number;
}

/** A piece set down, welded in. */
interface Weld {
  cells: readonly Cell[];
  age: number;
}

/** Where a shot came down on the rock: a burnt Lichtenberg figure, fading over the rounds. */
interface Scorch {
  x: number;
  y: number;
  round: number;
}

/** A bolt from the storm onto the outer sea: where it strikes, in screen pixels. */
interface SkyBolt {
  x: number;
  y: number;
  age: number;
}

/**
 * Over land, one raindrop in this many is drawn: the full rain over the board hid it in the
 * build phase (S9). Chosen by eye in a rainy match at three and eight players.
 */
const RAIN_OVER_LAND = 3;

/** A raindrop or a hailstone falling, in tiles on screen. */
interface Drop {
  x: number;
  y: number;
  speed: number;
  floor: number;
}

/** A stretch of the charged floor's grid, along line `line` from `from` to `to`, in tiles. */
interface FieldRun {
  across: boolean;
  line: number;
  from: number;
  to: number;
  owner: number;
}

/** A stroke of a burn's Lichtenberg figure, in tiles, and how far out along its tree it lies. */
interface Branch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
}

const FIRE_MS = 260;
const CHAIN_MS = 420;
const FLASH_MS = 180;
const FIZZ_MS = 900;
const SHORT_MS = 700;
const WELD_MS = 380;
const SMOKE_MS = 1400;
const CRACKLE_MS = 260;
const BOLT_MS = 380;
/** How often a plasma globe's filaments are drawn anew: lightning jitters, it does not glide. */
const FILAMENT_MS = 70;

const PORCELAIN = 0xe8ecf0;
const GLASS_DARK = 0x0a0e1c;
const VERDIGRIS = 0x4f8a78;
const VERDIGRIS_DARK = 0x2a4a40;
const SMOKE = 0x8a8e96;

/** How Electric sends off the winners: forked lightning, and a lightning rod for the flag. */
const FINISH: FinishLook = { spark: 'bolts', flag: 'rod' };

/**
 * The Electric look, for either look: a storm laboratory. Each island is dark rock under a
 * thunderstorm in a slate sea, the rain slanting across; walls are a Faraday cage — mesh in
 * the owner's light framed in their colour — current crackling along them now and then;
 * castles are plasma globes on brass pedestals, and sealed is the globe lit, its filaments
 * dancing in the owner's colour, a breach flickering it out; sealed ground is a charged floor,
 * plates and a grid in the owner's colour with current pulsing along it. Guns are Tesla towers,
 * a drum, rings and a sphere, an arc leaping from the sphere as they fire ball lightning; a
 * silenced one is grounded, its cable hanging loose. A hit chains through the cage to the blocks
 * beside it. A Jacob's ladder climbs in the corner; as the storm breaks — overtime and the
 * final round — bolts fork down onto the outer sea, and the sky flickers. The storm's own
 * lightning is white: a player's colour in an arc means it is theirs, and live.
 */
export class ElectricTheme extends ShapeTheme implements Theme {
  readonly id = 'electric' as const;

  private style!: ElectricStyleConfig;
  private weather: Weather = 'clear';
  /** Life on the outer sea (`seaLife.ts`). */
  private readonly seaLife = new ElectricSeaLife();

  private readonly terrainGfx = new Graphics();
  /** Lichtenberg burns where shots struck the rock: redrawn when one is added or fades. */
  private readonly scorchGfx = new Graphics();
  private scorchesDrawn = '';
  /** The Jacob's ladder: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  /** Sealed ground, an island to a `Graphics`, redrawn where it changes. */
  private readonly territory = new IslandParts(1, 'territory');
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawElectricScenery(g, view, items, this.art),
    () => 0x8a8e96,
  );
  /** The charged floor's pulses, over sealed ground and under everything standing on it. */
  private readonly pulseStamps = new Stamps();
  private fieldRuns: FieldRun[] = [];
  /** Cages, globes on their pedestals and the Tesla towers, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  /** The globes' filaments, a `Graphics` each, drawn anew only every `FILAMENT_MS`. */
  private readonly globeMemos = new Memos();
  private readonly book = new StampBook();
  private readonly effectGfx = new Graphics();
  /** The halos of every arc, added, and bloomed under "Glowing". */
  private readonly glowGfx = new Graphics();
  /** Ball lightning in flight, a stamp of one ball a colour. */
  private readonly ballStamps = new Stamps();
  /** Everything over the balls: chains, sparks, smoke, the sky's bolts, the finish. */
  private readonly lateGfx = new Graphics();
  /** Rain and hail, stamps of one streak and one stone. */
  private readonly dropStamps = new Stamps();
  /** Ionised mist in a foggy match. */
  private readonly mist = new Discs();
  /** The sky's flicker over the whole screen as a bolt strikes. */
  private readonly flashGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private round = 0;
  private ladder: TimerSpot | null = null;
  /** Tiles of outer sea a bolt may strike without crossing the board on its way down. */
  private boltCells: Cell[] = [];
  private scorches: Scorch[] = [];
  private chains: Chain[] = [];
  private flashes: Aged[] = [];
  private fizzes: Aged[] = [];
  private shorts: Aged[] = [];
  private smokes: Aged[] = [];
  private sparks: Spark[] = [];
  private crackles: Crackle[] = [];
  private untilCrackle = new Map<number, number>();
  private welds: Weld[] = [];
  private skyBolts: SkyBolt[] = [];
  private untilBolt = -1;
  private drops: Drop[] = [];
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The globes lit, raised as a flag is: by sealing, and flickered out by a breach. */
  private readonly globes = new FlagHoist();
  private clock = 0;

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.electric;
    this.weather = weatherFor(this.seed, art.pixel.weatherOdds);
    this.glowGfx.blendMode = 'add';
    // "Glowing": the halos bloomed, at half resolution as Cyberpunk's are (ARCHIVE 12r).
    if (bloomWanted()) {
      this.glowGfx.filters = [new BlurFilter({ strength: 5, quality: 2, resolution: 0.5 })];
    }
    layers.terrain.addChild(this.terrainGfx, this.scorchGfx, this.flowGfx);
    layers.territory.addChild(
      this.scenery.gfx,
      this.territory.container,
      this.pulseStamps.container,
    );
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.globeMemos.container,
      this.effectGfx,
      this.ballStamps.container,
      this.lateGfx,
      this.glowGfx,
      this.dropStamps.container,
      this.mist.container,
      this.flashGfx,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    this.globeMemos.destroy();
    this.pulseStamps.destroy();
    this.ballStamps.destroy();
    this.dropStamps.destroy();
    this.mist.destroy();
    this.book.destroy();
    for (const g of [
      this.terrainGfx,
      this.scorchGfx,
      this.flowGfx,
      this.effectGfx,
      this.glowGfx,
      this.lateGfx,
      this.flashGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  private get dark(): number {
    return hex(this.art.palette.shadow);
  }

  /** As the storm breaks: overtime, and the final round. */
  private storm(state: MatchState): boolean {
    return climax(state);
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    const g = this.terrainGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);

    // The sea, slate out to the window's edge, a little lighter where it breaks on the rock.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    g.fill({ color: hex(palette.waterDeep) });
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    for (const [r, colour] of [
      [3, palette.waterMid],
      [1, palette.waterShallow],
    ] as const) {
      for (let y = -r; y < state.height + r; y++) {
        for (let x = -r; x < state.width + r; x++) {
          if (land(x, y) || !near(x, y, r)) continue;
          g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), t * 0.8);
        }
      }
      g.fill({ color: hex(colour) });
    }
    // Whitecaps whipped up by the wind, all leaning one way.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (land(x, y) || hash(x, y, 1000) > 0.07) continue;
        const sx = tileX(view, x + hash(x, y, 1001) * 0.6);
        const sy = tileY(view, y + 0.3 + hash(x, y, 1002) * 0.5);
        g.moveTo(sx, sy)
          .lineTo(sx + t * 0.18, sy - t * 0.07)
          .lineTo(sx + t * 0.4, sy);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.waterFoam), alpha: 0.22 });

    // The rock: dark slate, flagged here and there with lighter stone, cracked.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x >> 1, y >> 1, 1003) > 0.4) continue;
      g.rect(tileX(view, x), tileY(view, y), t, t);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.35 });
    for (const { x, y } of ground) {
      if (hash(x, y, 1004) > 0.16) continue;
      const sx = tileX(view, x + 0.15 + hash(x, y, 1005) * 0.3);
      const sy = tileY(view, y + 0.2 + hash(x, y, 1006) * 0.5);
      g.moveTo(sx, sy)
        .lineTo(sx + t * 0.25, sy + t * 0.12)
        .lineTo(sx + t * 0.32, sy + t * 0.38);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: hex(palette.grassDark), alpha: 0.8 });
    // A faint tint of the owner over each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.06 });
    }
    // Surf breaking white along the rock, and its dark wet edge.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.22, color: hex(palette.waterFoam), alpha: 0.3, cap: 'square' });
    trace(g, coast);
    g.stroke({ width: Math.max(1.5, t * 0.08), color: hex(palette.sand), cap: 'square' });
    trace(g, coast);
    g.stroke({ width: 1, color: this.dark, alpha: 0.7, cap: 'square' });

    // The Jacob's ladder's place, in the corner the compass rose takes in Parchment.
    this.ladder = cornerSpot(state, view);
    this.seaLife.corner = this.ladder;
    this.seaLife.layout(state, view, this.art);

    // Where a bolt may strike: outer sea beside the land or above it, and far enough off that
    // neither the bolt coming down from the top of the screen nor a branch swinging out of it
    // crosses an island, where a flash is an impact. A window with no such sea gets only the
    // sky's flicker.
    let bx0 = state.width;
    let bx1 = -1;
    let by0 = state.height;
    for (const { x, y } of ground) {
      bx0 = Math.min(bx0, x);
      bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y);
    }
    this.boltCells = outerOcean(state, view).cells.filter(
      (c) =>
        (c.x < bx0 - 5 || c.x > bx1 + 5 || c.y < by0 - 5) &&
        (this.ladder === null ||
          Math.abs(c.x + 0.5 - this.ladder.x) > this.ladder.size ||
          Math.abs(c.y + 0.5 - this.ladder.y) > this.ladder.size),
    );
    this.scorchesDrawn = '';
  }

  /** The burns, drawn again only when one comes or fades. */
  private drawScorches(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.scorches = this.scorches.filter((s) => state.round - s.round < rounds);
    const key = `${state.round}|${this.scorches.length}|${viewKey(view)}`;
    if (key === this.scorchesDrawn) return;
    this.scorchesDrawn = key;
    const g = this.scorchGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    for (const s of this.scorches) {
      const fade = 1 - (state.round - s.round) / rounds;
      const cx = s.x + 0.5;
      const cy = s.y + 0.5;
      g.circle(tileX(view, cx), tileY(view, cy), t * 0.22);
      g.fill({ color: hex(palette.craterDark), alpha: 0.7 * fade });
      const branches = lichtenberg(
        [{ x: cx, y: cy }],
        (x, y) => Math.hypot(x - cx, y - cy) < 1.1,
        mulberry(s.x * 7919 + s.y * 104729),
        0.22,
        7,
        40,
      );
      for (const b of branches) {
        g.moveTo(tileX(view, b.x1), tileY(view, b.y1)).lineTo(tileX(view, b.x2), tileY(view, b.y2));
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: hex(palette.craterDark), alpha: 0.8 * fade });
    }
  }

  // ------------------------------------------------------------------ the ladder

  /**
   * The Jacob's ladder in the corner: two copper rods on porcelain insulators, spreading
   * apart as they rise; an arc strikes across at their foot where they are closest, climbs
   * as the heated air carries it, stretching as the rods part, and snaps at the top in a
   * puff — and strikes again below. Quicker while the clock presses.
   */
  private drawLadder(
    g: Graphics,
    glow: Graphics,
    view: ViewTransform,
    spot: TimerSpot,
    hurry: boolean,
  ): void {
    const t = view.tile;
    const s = spot.size * t;
    const cx = tileX(view, spot.x);
    const base = tileY(view, spot.y) + s * 0.42;
    const still = motionReduced();
    // Its stand: a slate block, two insulators on it.
    g.rect(cx - s * 0.26, base - s * 0.08, s * 0.52, s * 0.08);
    g.fill({ color: 0x2a2e36 });
    g.stroke({ width: 1, color: 0x5a6270 });
    for (const side of [-1, 1]) {
      const ix = cx + side * s * 0.1;
      for (let k = 0; k < 3; k++) {
        g.rect(
          ix - s * (0.05 - k * 0.008),
          base - s * (0.12 + k * 0.05),
          s * (0.1 - k * 0.016),
          s * 0.04,
        );
      }
    }
    g.fill({ color: PORCELAIN });
    // The rods: close at the foot, wide at the top.
    const foot = base - s * 0.24;
    const top = base - s * 0.92;
    const rodAt = (side: number, f: number): [number, number] => [
      cx + side * s * (0.06 + 0.24 * f),
      foot + (top - foot) * f,
    ];
    for (const side of [-1, 1]) {
      g.moveTo(cx + side * s * 0.1, base - s * 0.2)
        .lineTo(...rodAt(side, 0))
        .lineTo(...rodAt(side, 1));
    }
    g.stroke({ width: Math.max(1.5, s * 0.025), color: COPPER });
    // The arc, climbing.
    const span = hurry ? this.style.hurriedLadderMs : this.style.ladderMs;
    const f = still ? 0.45 : (this.clock % span) / span;
    if (f < 0.92) {
      const [lx, ly] = rodAt(-1, f);
      const [rx, ry] = rodAt(1, f);
      const sag = s * 0.06 * (1 + f);
      const mid = jag(lx, ly, (lx + rx) / 2, ly - sag, 4, s * 0.025);
      const rest = jag((lx + rx) / 2, ry - sag, rx, ry, 4, s * 0.025);
      const points = [...mid, ...rest.slice(2)];
      drawArc(
        g,
        glow,
        points,
        ARC_HALO,
        Math.max(1, s * 0.012),
        still ? 0.9 : 0.85 + 0.15 * Math.random(),
      );
    } else if (!still) {
      // Snapped at the top: a puff of hot air and a last spark.
      const q = (f - 0.92) / 0.08;
      g.circle(cx, top - s * 0.04 - q * s * 0.08, s * (0.06 + 0.1 * q));
      g.fill({ color: 0xcfd8e8, alpha: 0.4 * (1 - q) });
    }
    if (!still) {
      glow.circle(cx, foot + (top - foot) * Math.min(f, 0.92), s * 0.3);
      glow.fill({ color: ARC_HALO, alpha: 0.1 });
    }
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a charged floor (`drawField`), current running along its grid
   * (`drawPulses`). Lichtenberg figures growing out from the castles were tried first and
   * dropped by the user: they left much of the ground empty and vanished under the towers.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.layField(state);
    this.territory.draw(state, view, (g, island) => this.drawField(g, island, view));
  }

  /**
   * Where the charged floor's current runs: every stretch of grid line between two tiles of
   * one player's sealed ground, across and down, in tiles.
   */
  private layField(state: MatchState): void {
    const runs: FieldRun[] = [];
    const at = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? (state.territory[y * state.width + x] as number)
        : 0;
    for (const across of [true, false]) {
      const lines = across ? state.height : state.width;
      const along = across ? state.width : state.height;
      for (let l = 1; l < lines; l++) {
        let start = -1;
        let owner = 0;
        for (let u = 0; u <= along; u++) {
          const a = u < along ? (across ? at(u, l) : at(l, u)) : 0;
          const b = u < along ? (across ? at(u, l - 1) : at(l - 1, u)) : 0;
          const on = a !== 0 && a === b;
          if (on && start >= 0 && a === owner) continue;
          if (start >= 0 && u - start >= 3)
            runs.push({ across, line: l, from: start, to: u, owner: owner - 1 });
          start = on ? u : -1;
          owner = on ? a : 0;
        }
      }
    }
    this.fieldRuns = runs;
  }

  /**
   * Sealed ground as a charged floor: deck plates washed in the owner's colour, the grid
   * between them lines in the owner's light with a stud where four plates meet, and its edge
   * in the owner's colour; pulses of current run along the lines (`drawPulses`).
   */
  private drawField(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    for (let player = 0; player < state.players.length; player++) {
      const owned = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: this.colour(player, 'base'), alpha: this.style.territoryAlpha });
      // Each plate lit by the charge inside its edge, so the floor reads as plated. Lit, not
      // shaded: a darker plate sank into the slate and olive islands until a small pocket
      // hardly read as sealed beside the cage walls (style review, S1).
      for (const { x, y } of cells) {
        g.rect(tileX(view, x) + t * 0.14, tileY(view, y) + t * 0.14, t * 0.72, t * 0.72);
      }
      g.fill({ color: this.colour(player, 'light'), alpha: 0.3 });
      // The grid between the plates.
      for (const { x, y } of cells) {
        const left = tileX(view, x);
        const top = tileY(view, y);
        if (owned(x, y - 1)) g.moveTo(left, top).lineTo(left + t, top);
        if (owned(x - 1, y)) g.moveTo(left, top).lineTo(left, top + t);
      }
      g.stroke({ width: Math.max(1, t * 0.06), color: this.colour(player, 'light'), alpha: 0.85 });
      const stud = Math.max(2, t * 0.14);
      for (const { x, y } of cells) {
        if (!owned(x - 1, y) || !owned(x, y - 1) || !owned(x - 1, y - 1)) continue;
        g.rect(tileX(view, x) - stud / 2, tileY(view, y) - stud / 2, stud, stud);
      }
      g.fill({ color: this.colour(player, 'light') });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: this.colour(player, 'base'), alpha: 0.9 });
    }
    dimEliminated(g, state, view, this.dark);
  }

  /**
   * The charged floor's current: a bright pulse running along every other grid line, each its
   * own way and out of step with the next, in the owner's light. Stamps of one dash, so it
   * costs a placing each; none with motion reduced.
   */
  private drawPulses(state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    this.pulseStamps.begin();
    if (!motionReduced()) {
      const dash = this.book.get('pulse', t, (k) => {
        k.moveTo(-t * 0.45, 0).lineTo(t * 0.45, 0);
        k.stroke({ width: Math.max(3, t * 0.22), color: 0xffffff, alpha: 0.35 });
        k.moveTo(-t * 0.35, 0).lineTo(t * 0.35, 0);
        k.stroke({ width: Math.max(1.5, t * 0.08), color: 0xffffff });
      });
      const run = (this.clock / 1000) * this.style.pulseTilesPerSecond;
      this.fieldRuns.forEach((r, n) => {
        if ((r.line + r.from) % 2 === 1 || state.players[r.owner]?.eliminated !== false) return;
        const length = r.to - r.from;
        const phase = (run + hash(r.line, r.from, 1060) * length * 3) % (length + 2);
        const along = n % 2 === 0 ? r.from - 1 + phase : r.to + 1 - phase;
        if (along < r.from + 0.3 || along > r.to - 0.3) return;
        const x = r.across ? along : r.line;
        const y = r.across ? r.line : along;
        this.pulseStamps.place(dash, tileX(view, x), tileY(view, y), {
          rotation: r.across ? 0 : Math.PI / 2,
          tint: this.colour(r.owner, 'light'),
        });
      });
    }
    this.pulseStamps.end();
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  /** One island's structures, for `IslandParts`: the board holds that island's alone. */
  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const wallAt = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;
    for (let owner = 0; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      this.drawCage(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }
    for (const castle of state.castles) this.drawGlobe(g, view, castle);
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, 0x1e222a, this.colour(cannon.owner, 'base'));
      this.drawCoil(
        g,
        view,
        cannon.x + cannon.w / 2,
        cannon.y + cannon.h / 2,
        cannon.owner,
        cannon.active,
      );
    }
  }

  /**
   * Walls as a Faraday cage: each block a frame in the owner's colour round copper mesh over
   * the dark inside, so a shot visibly tears one out; the faces barred in copper; standing to
   * the shared height. A player's who is out (`player` -1) has gone green with verdigris.
   * Straight strokes only: a wall is redrawn at every hit on its island.
   */
  private drawCage(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const frame = dead ? VERDIGRIS : this.colour(player, 'base');
    const inside = dead ? VERDIGRIS_DARK : mixed(this.colour(player, 'dark'), 0x000000, 0.15);
    // The mesh in the owner's light: in copper, every player's walls read as one orange.
    const mesh = dead ? 0x8ac8b0 : this.colour(player, 'light');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: inside });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: mixed(inside, 0x000000, 0.3) });
    // The mesh, on one lattice across the whole wall, and the bars down each face.
    const lattice: Segment[] = [];
    for (const r of wall.tops) {
      lattice.push(...hatch(r, t * 0.3, '/'), ...hatch(r, t * 0.3, '\\'));
    }
    trace(g, lattice);
    g.stroke({ width: Math.max(1, t * 0.06), color: mesh, alpha: 0.9 });
    for (const r of wall.faces) {
      for (let x = r.x + t * 0.16; x < r.x + r.w; x += t * 0.2)
        g.moveTo(x, r.y).lineTo(x, r.y + r.h);
    }
    g.stroke({ width: 1, color: dead ? mesh : COPPER, alpha: 0.8 });
    // Each block's frame, thin, in the owner's colour: thick frames with rivets at their
    // corners read as tartan, not a cage — the mesh must lead.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.rect(b.left + t * 0.04, b.top + t * 0.04, t - t * 0.08, h - t * 0.08);
    }
    g.stroke({ width: Math.max(1, t * 0.08), color: frame });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.06), color: this.dark, alpha: 0.9 });
  }

  /** Where a castle's globe stands, its middle and radius, in screen pixels. */
  private globeAt(view: ViewTransform, castle: Castle): { x: number; y: number; r: number } {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const foot = tileY(view, castle.y + castle.h) - t * 0.06;
    const r = W * 0.36;
    return { x: tileX(view, castle.x + castle.w / 2), y: foot - W * 0.24 - r, r };
  }

  /**
   * A castle as a plasma globe: a brass pedestal banded in the owner's colour, and on it the
   * glass sphere, dark, its electrode in the middle; the filaments are drawn with the effects.
   */
  private drawGlobe(g: Graphics, view: ViewTransform, castle: Castle): void {
    const owner = castle.islandId - 1;
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const { x, y, r } = this.globeAt(view, castle);
    const foot = tileY(view, castle.y + castle.h) - t * 0.06;
    g.ellipse(x + W * 0.04, foot, W * 0.4, W * 0.08);
    g.fill({ color: 0x000000, alpha: 0.4 });
    // The pedestal: a stepped brass base, the owner's band round it.
    g.poly([
      x - W * 0.34,
      foot,
      x + W * 0.34,
      foot,
      x + W * 0.22,
      foot - W * 0.26,
      x - W * 0.22,
      foot - W * 0.26,
    ]);
    g.fill({ color: mixed(BRASS, 0x000000, 0.25) });
    g.stroke({ width: 1, color: this.dark, alpha: 0.8 });
    g.rect(x - W * 0.29, foot - W * 0.15, W * 0.58, W * 0.07);
    g.fill({ color: this.colour(owner, 'base') });
    g.rect(x - W * 0.2, foot - W * 0.27, W * 0.4, W * 0.04);
    g.fill({ color: BRASS });
    // The sphere, dark until it is lit, and its electrode.
    g.circle(x, y, r);
    g.fill({ color: GLASS_DARK, alpha: 0.92 });
    g.circle(x, y, r * 0.16);
    g.fill({ color: 0x6a6e76 });
    g.circle(x, y, r);
    g.stroke({ width: Math.max(1, t * 0.06), color: 0xb8c4d8, alpha: 0.7 });
    g.moveTo(x - r * 0.55, y - r * 0.45).lineTo(x - r * 0.3, y - r * 0.68);
    g.stroke({ width: Math.max(1, t * 0.06), color: 0xffffff, alpha: 0.6 });
  }

  /** Where a Tesla tower's sphere is, its middle, in screen pixels: where its arcs leap from. */
  private torusAt(view: ViewTransform, cx: number, cy: number): { x: number; y: number } {
    return { x: tileX(view, cx), y: tileY(view, cy) - view.tile * 0.7 };
  }

  /**
   * A gun as a Tesla tower, built in levels: a squat drum of riveted plates in the owner's
   * colour, a band of vents lit from inside; a brass collar on it; a rod rising through three
   * copper rings, each smaller than the one below; and a steel sphere on top, which the arcs
   * leap from. A silenced one is grounded — vents dark, rings and sphere dull, a cable hanging
   * slack from the sphere to the rock.
   */
  private drawCoil(
    g: Graphics,
    view: ViewTransform,
    cx: number,
    cy: number,
    owner: number,
    active: boolean,
  ): void {
    const t = view.tile;
    const x = tileX(view, cx);
    const foot = tileY(view, cy) + t * 0.62;
    const R = t * 0.5;
    const rim = t * 0.15;
    const drumTop = foot - t * 0.5;
    const plate = this.colour(owner, 'base');
    g.ellipse(x + t * 0.08, foot + t * 0.04, R * 1.25, rim * 1.2);
    g.fill({ color: 0x000000, alpha: 0.4 });
    // The drum: its front, shaded round to the right, and its curved foot.
    g.rect(x - R, drumTop, R * 2, foot - drumTop);
    g.ellipse(x, foot, R, rim);
    g.fill({ color: plate });
    g.rect(x + R * 0.35, drumTop, R * 0.65, foot - drumTop);
    g.fill({ color: this.colour(owner, 'dark'), alpha: 0.55 });
    // The seams between its plates, and a row of rivets under its rim.
    for (const f of [-0.5, 0, 0.5])
      g.moveTo(x + R * f, drumTop + rim).lineTo(x + R * f, foot + rim * 0.8);
    g.stroke({ width: 1, color: this.dark, alpha: 0.45 });
    const dot = Math.max(1, t * 0.05);
    for (let k = -3; k <= 3; k++)
      g.rect(x + (R * k) / 3.6 - dot / 2, drumTop + rim + t * 0.04, dot, dot);
    g.fill({ color: BRASS });
    // The vents, lit from inside while it is live.
    for (const f of [-0.55, 0, 0.55]) {
      g.rect(x + R * f - t * 0.09, drumTop + t * 0.27, t * 0.18, t * 0.11);
    }
    g.fill({ color: active ? 0xcfe4ff : 0x14171d });
    if (active) {
      for (const f of [-0.55, 0, 0.55])
        g.rect(x + R * f - t * 0.09, drumTop + t * 0.27, t * 0.18, t * 0.04);
      g.fill({ color: 0xffffff, alpha: 0.8 });
    }
    g.ellipse(x, foot, R, rim);
    g.stroke({ width: 1, color: this.dark, alpha: 0.8 });
    g.moveTo(x - R, drumTop).lineTo(x - R, foot);
    g.moveTo(x + R, drumTop).lineTo(x + R, foot);
    g.stroke({ width: 1, color: this.dark, alpha: 0.8 });
    // Its top, and the brass collar on it.
    g.ellipse(x, drumTop, R, rim);
    g.fill({ color: mixed(plate, 0xffffff, 0.25) });
    g.stroke({ width: 1, color: this.dark, alpha: 0.8 });
    const collarTop = drumTop - t * 0.16;
    g.poly([
      x - R * 0.75,
      drumTop,
      x + R * 0.75,
      drumTop,
      x + R * 0.3,
      collarTop,
      x - R * 0.3,
      collarTop,
    ]);
    g.fill({ color: BRASS });
    g.poly([
      x + R * 0.2,
      drumTop,
      x + R * 0.75,
      drumTop,
      x + R * 0.3,
      collarTop,
      x + R * 0.1,
      collarTop,
    ]);
    g.fill({ color: COPPER_DARK, alpha: 0.4 });
    // The rod, and the rings stacked on it, smaller as they rise.
    const sphere = this.torusAt(view, cx, cy);
    g.rect(x - t * 0.04, sphere.y, t * 0.08, collarTop - sphere.y);
    g.fill({ color: 0x9aa3ad });
    const ring = active ? COPPER : 0x5a5e66;
    for (let k = 0; k < 3; k++) {
      const y = collarTop - t * (0.12 + 0.17 * k);
      g.ellipse(x, y, t * (0.42 - 0.07 * k), t * 0.1);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: ring });
      g.moveTo(x - t * (0.3 - 0.06 * k), y - t * 0.08).lineTo(
        x + t * (0.1 - 0.02 * k),
        y - t * 0.1,
      );
      g.stroke({ width: 1, color: active ? 0xf0b080 : 0x8a8e96, alpha: 0.9 });
    }
    // The sphere.
    const r = t * 0.17;
    g.circle(sphere.x, sphere.y, r);
    g.fill({ color: active ? mixed(0xc9ccd2, this.colour(owner, 'light'), 0.25) : 0x6a6e76 });
    g.stroke({ width: 1, color: this.dark, alpha: 0.9 });
    g.circle(sphere.x - r * 0.35, sphere.y - r * 0.35, r * 0.3);
    g.fill({ color: 0xffffff, alpha: active ? 0.9 : 0.4 });
    if (active) return;
    // Grounded: a cable from the sphere, slack, down to the rock.
    g.moveTo(sphere.x + r, sphere.y)
      .lineTo(sphere.x + t * 0.55, sphere.y + t * 0.6)
      .lineTo(sphere.x + t * 0.62, foot)
      .lineTo(sphere.x + t * 0.8, foot + t * 0.08);
    g.stroke({ width: Math.max(1.5, t * 0.07), color: 0x16181c });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    this.flashes.push({ x, y, age: 0, owner: -1 });
    if (!this.land(x, y) && debris.length === 0) {
      this.fizzes.push({ x, y, age: 0, owner: -1 });
      return;
    }
    if (debris.length === 0) {
      this.scorches.push({ x, y, round: this.round });
      this.throwSparks(x + 0.5, y + 0.5, 6);
      return;
    }
    for (const block of debris) {
      this.chains.push({ x: block.x, y: block.y, age: 0, owner: block.owner, path: null });
      this.smokes.push({ x: block.x, y: block.y, age: 0, owner: -1 });
      this.throwSparks(block.x + 0.5, block.y + 0.4, 12);
    }
  }

  private throwSparks(x: number, y: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 3;
      const v = 2 + Math.random() * 4;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: 250 + Math.random() * 350,
      });
    }
  }

  /** The sweep: a block left standing alone shorts out with a pop and a puff of smoke. */
  noteCrumble(block: Debris): void {
    this.shorts.push({ x: block.x, y: block.y, age: 0, owner: block.owner });
    this.smokes.push({ x: block.x, y: block.y, age: 0, owner: -1 });
    this.throwSparks(block.x + 0.5, block.y + 0.5, 5);
  }

  noteLanding(cells: readonly Cell[], _owner: number): void {
    this.scenery.land(cells);
    this.welds.push({ cells, age: 0 });
    for (let k = 0; k < Math.min(3, cells.length); k++) {
      const c = cells[Math.floor(Math.random() * cells.length)]!;
      this.throwSparks(c.x + 0.5, c.y + 0.5, 4);
    }
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const g = this.effectGfx;
    g.clear();
    this.glowGfx.clear();
    this.lateGfx.clear();
    this.flashGfx.clear();
    perf.begin('flow');
    this.drawScorches(state, view);
    this.flowGfx.clear();
    if (this.ladder !== null) {
      this.drawLadder(this.flowGfx, this.glowGfx, view, this.ladder, pressing(state));
    }
    perf.end('flow');
    this.drawPulses(state, view);
    this.seaLife.draw(g, view, this.art, frame.deltaMs, this.glowGfx);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, SMOKE, ARC_HALO, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.drawGlobes(state, view, frame);
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.drawCoils(state, view, frame.deltaMs);
    this.drawCrackles(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawChains(state, view, frame.deltaMs);
    this.drawFlashes(view, frame.deltaMs);
    this.drawFizzes(view, frame.deltaMs);
    this.drawShorts(view, frame.deltaMs);
    this.drawWelds(view, frame.deltaMs);
    this.drawSparks(view, frame.deltaMs);
    this.drawSmoke(view, frame.deltaMs);
    this.drawSky(state, view, frame.deltaMs);
    this.drawWeather(state, view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * The globes, lit as a flag is raised: while a castle is sealed its filaments dance from the
   * electrode to the glass in the owner's colour, the sphere glowing; a breach flickers them
   * out. A globe of a player who is out is cracked. Each globe is drawn anew only every
   * `FILAMENT_MS`, as lightning jumps rather than glides, and not at all while it is dark.
   */
  private drawGlobes(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const still = motionReduced();
    const where = viewKey(view);
    const tick = still ? 0 : Math.floor(this.clock / FILAMENT_MS);
    this.globes.update(frame.castleSealed, this.clock, this.art);
    this.globeMemos.begin();
    for (const castle of state.castles) {
      const owner = state.players[castle.islandId - 1];
      const out = owner === undefined || owner.eliminated;
      let lit = this.globes.raised(castle.id, this.clock, this.art) ?? 0;
      // Going out, it sputters: on and off by turns as it fades.
      if (this.globes.lowering(castle.id) && !still && hash(castle.id, tick, 1020) < 0.4) lit = 0;
      const level = Math.round(lit * 10) / 10;
      const at = this.globeAt(view, castle);
      const player = castle.islandId - 1;
      this.globeMemos.draw(castle.id, `${where}|${level}|${out}|${level > 0 ? tick : 0}`, (k) => {
        if (out) {
          k.moveTo(at.x - at.r * 0.2, at.y - at.r * 0.9)
            .lineTo(at.x + at.r * 0.05, at.y - at.r * 0.3)
            .lineTo(at.x - at.r * 0.15, at.y + at.r * 0.2)
            .lineTo(at.x + at.r * 0.25, at.y + at.r * 0.7);
          k.stroke({ width: 1, color: 0xdfe4ec, alpha: 0.8 });
          return;
        }
        if (level === 0) return;
        k.circle(at.x, at.y, at.r * 0.92);
        k.fill({ color: this.colour(player, 'dark'), alpha: 0.45 * level });
        const rand = mulberry((castle.id + 1) * 7919 + tick * 104729);
        for (let n = 0; n < 6; n++) {
          const a = rand() * Math.PI * 2;
          const ex = at.x + Math.cos(a) * at.r * 0.9;
          const ey = at.y + Math.sin(a) * at.r * 0.9;
          const points = jag(at.x, at.y, ex, ey, 4, at.r * 0.18, rand);
          drawArc(k, null, points, this.colour(player, 'light'), Math.max(1, at.r * 0.05), level);
          // Where it touches the glass, a spot of light.
          k.circle(ex, ey, Math.max(1, at.r * 0.09));
          k.fill({ color: ARC_WHITE, alpha: level });
        }
        k.circle(at.x, at.y, at.r * 0.2);
        k.fill({ color: ARC_WHITE, alpha: level });
      });
      if (lit > 0 && !out) {
        this.glowGfx.circle(at.x, at.y, at.r * 1.6);
        this.glowGfx.fill({ color: this.colour(player, 'base'), alpha: 0.18 * lit });
      }
    }
    this.globeMemos.end();
  }

  /**
   * The Tesla towers: as one fires, an arc leaps from its sphere toward its target in the
   * owner's colour; a live one throws a little crackle off its sphere now and then, and in a
   * foggy match St. Elmo's fire burns on it; a grounded one smokes.
   */
  private drawCoils(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const glow = this.glowGfx;
    const t = view.tile;
    const still = motionReduced();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const torus = this.torusAt(view, cannon.x + cannon.w / 2, cannon.y + cannon.h / 2);
      const owner = cannon.owner;
      if (!cannon.active) {
        if (still) continue;
        const p = ((this.clock + cannon.id * 577) % 2200) / 2200;
        g.circle(
          torus.x + Math.sin(p * 5) * t * 0.1,
          torus.y - t * (0.2 + 0.8 * p),
          t * (0.08 + 0.15 * p),
        );
        g.fill({ color: SMOKE, alpha: 0.4 * (1 - p) });
        continue;
      }
      if (aim.firedAgo < FIRE_MS) {
        const reach = t * 1.6;
        const q = aim.firedAgo / FIRE_MS;
        drawBolt(
          g,
          glow,
          torus.x,
          torus.y,
          torus.x + Math.sin(aim.angle) * reach,
          torus.y - Math.cos(aim.angle) * reach - t * 0.4,
          this.colour(owner, 'light'),
          Math.max(1, t * 0.07),
          1 - q * 0.6,
        );
        glow.circle(torus.x, torus.y, t * 0.9);
        glow.fill({ color: this.colour(owner, 'base'), alpha: 0.3 * (1 - q) });
      } else if (!still && hash(cannon.id, Math.floor(this.clock / 90), 1030) < 0.18) {
        const a = -Math.PI / 2 + (hash(cannon.id, Math.floor(this.clock / 90), 1031) - 0.5) * 2.4;
        const r = t * 0.55;
        const from = { x: torus.x + Math.cos(a) * t * 0.4, y: torus.y + Math.sin(a) * t * 0.12 };
        drawArc(
          g,
          glow,
          jag(from.x, from.y, from.x + Math.cos(a) * r, from.y + Math.sin(a) * r, 3, r * 0.3),
          this.colour(owner, 'light'),
          Math.max(1, t * 0.04),
        );
      }
      if (this.weather === 'fog') {
        const flicker = still ? 1 : 0.7 + 0.3 * Math.sin(this.clock / 80 + cannon.id);
        glow.circle(torus.x, torus.y - t * 0.1, t * 0.5);
        glow.fill({ color: ARC_HALO, alpha: 0.18 * flicker });
      }
    }
    this.aims.prune(state);
  }

  /**
   * Current running along a player's walls for a moment now and then, each player on their
   * own beat: an arc from block to block across the tops of a few, in the owner's light.
   */
  private drawCrackles(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    if (!motionReduced()) {
      for (const player of state.players) {
        if (player.eliminated) continue;
        const until =
          (this.untilCrackle.get(player.id) ?? Math.random() * this.style.crackleEveryMs) - deltaMs;
        if (until > 0) {
          this.untilCrackle.set(player.id, until);
          continue;
        }
        this.untilCrackle.set(player.id, this.style.crackleEveryMs * (0.5 + Math.random()));
        const path = this.wallRun(state, player.id, null, 4);
        if (path.length >= 2) this.crackles.push({ path, owner: player.id, age: 0 });
      }
    }
    const lift = (this.faceFraction() * t) / 2;
    for (const c of this.crackles) {
      c.age += deltaMs;
      if (c.age >= CRACKLE_MS) continue;
      const points: number[] = [];
      c.path.forEach((cell, n) => {
        const x = tileX(view, cell.x + 0.5);
        const y = tileY(view, cell.y + 0.5) - lift;
        if (n === 0) {
          points.push(x, y);
          return;
        }
        const prev = c.path[n - 1]!;
        points.push(
          ...jag(
            tileX(view, prev.x + 0.5),
            tileY(view, prev.y + 0.5) - lift,
            x,
            y,
            3,
            t * 0.15,
          ).slice(2),
        );
      });
      drawArc(
        this.lateGfx,
        this.glowGfx,
        points,
        this.colour(c.owner, 'light'),
        Math.max(1, t * 0.045),
        1 - c.age / CRACKLE_MS,
      );
    }
    this.crackles = this.crackles.filter((c) => c.age < CRACKLE_MS);
  }

  /**
   * A run of up to `steps` more wall cells joined edge to edge, from `start` or from a wall
   * cell of `owner`'s chosen at random: the way current runs through a cage.
   */
  private wallRun(state: MatchState, owner: number, start: Cell | null, steps: number): Cell[] {
    const wall = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.structure[y * state.width + x] === Structure.Wall &&
      (owner < 0 || state.owner[y * state.width + x] === owner + 1);
    let first = start;
    if (first === null) {
      const mine: number[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] === Structure.Wall && state.owner[i] === owner + 1) mine.push(i);
      }
      if (mine.length === 0) return [];
      const i = mine[Math.floor(Math.random() * mine.length)]!;
      first = { x: i % state.width, y: Math.floor(i / state.width) };
    }
    const path: Cell[] = [first];
    const seen = new Set([`${first.x},${first.y}`]);
    for (let k = 0; k < steps; k++) {
      const at = path[path.length - 1]!;
      const next = [
        { x: at.x + 1, y: at.y },
        { x: at.x - 1, y: at.y },
        { x: at.x, y: at.y + 1 },
        { x: at.x, y: at.y - 1 },
      ].filter((c) => wall(c.x, c.y) && !seen.has(`${c.x},${c.y}`));
      if (next.length === 0) break;
      const c = next[Math.floor(Math.random() * next.length)]!;
      seen.add(`${c.x},${c.y}`);
      path.push(c);
    }
    return path;
  }

  /** Shots: ball lightning in the owner's colour, crackling as it flies, a glow below it. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    this.ballStamps.begin();
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const x = gx;
      const y = gy - shotLift(shot, p) * t;
      const high = Math.min(1, shotLift(shot, p) / 3);
      g.ellipse(gx, gy, t * 0.2, t * 0.07);
      g.fill({ color: 0x000000, alpha: 0.3 - 0.1 * high });
      this.glowGfx.circle(gx, gy, t * 0.35);
      this.glowGfx.fill({ color: this.colour(shot.owner, 'base'), alpha: 0.12 });
      const ball = this.book.get(`ball|${shot.owner}`, t, (k) =>
        drawBall(k, t * 0.19, this.colour(shot.owner, 'base'), this.colour(shot.owner, 'light')),
      );
      const pulse = still ? 1 : 0.9 + 0.2 * Math.random();
      this.ballStamps.place(ball, x, y, { scale: (1 + 0.25 * high) * pulse });
      if (!still) {
        // Tendrils licking off it, fresh every frame.
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = t * (0.3 + Math.random() * 0.25);
          drawArc(
            this.lateGfx,
            null,
            jag(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, 3, r * 0.35),
            this.colour(shot.owner, 'light'),
            Math.max(1, t * 0.035),
            0.9,
          );
        }
      }
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
    this.ballStamps.end();
  }

  /** A hit on a wall: the arc chaining on through the cage to the blocks beside it. */
  private drawChains(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const lift = (this.faceFraction() * t) / 2;
    for (const c of this.chains) {
      c.age += deltaMs;
      if (c.age >= CHAIN_MS) continue;
      if (c.path === null) {
        // Its first frame: through whatever cage stands round the hole now, anyone's.
        const around = [
          { x: c.x + 1, y: c.y },
          { x: c.x - 1, y: c.y },
          { x: c.x, y: c.y + 1 },
          { x: c.x, y: c.y - 1 },
        ].filter(
          (n) =>
            n.x >= 0 &&
            n.y >= 0 &&
            n.x < state.width &&
            n.y < state.height &&
            state.structure[n.y * state.width + n.x] === Structure.Wall,
        );
        c.path = [{ x: c.x, y: c.y }];
        for (const n of around.slice(0, 2)) c.path.push(...this.wallRun(state, -1, n, 2));
      }
      const k = c.age / CHAIN_MS;
      const shown = Math.min(c.path.length, 1 + Math.floor(k * 2.5 * c.path.length));
      const colour = c.owner < 0 ? ARC_HALO : this.colour(c.owner, 'light');
      for (let n = 1; n < shown; n++) {
        const to = c.path[n]!;
        // Each leap from the nearest cell before it that it touches, else from the hole.
        const from =
          c.path
            .slice(0, n)
            .reverse()
            .find((p) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y) === 1) ?? c.path[0]!;
        drawArc(
          this.lateGfx,
          this.glowGfx,
          jag(
            tileX(view, from.x + 0.5),
            tileY(view, from.y + 0.5) - lift,
            tileX(view, to.x + 0.5),
            tileY(view, to.y + 0.5) - lift,
            3,
            t * 0.2,
          ),
          colour,
          Math.max(1, t * 0.05),
          1 - k,
        );
      }
    }
    this.chains = this.chains.filter((c) => c.age < CHAIN_MS);
  }

  /** The flash where anything strikes: brief, white, and the one flash at a spot there is. */
  private drawFlashes(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    for (const f of this.flashes) {
      f.age += deltaMs;
      const k = f.age / FLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, f.x + 0.5);
      const y = tileY(view, f.y + 0.5);
      this.lateGfx.circle(x, y, t * (0.3 + 0.4 * k));
      this.lateGfx.fill({ color: ARC_WHITE, alpha: 0.8 * (1 - k) });
      this.glowGfx.circle(x, y, t * 1.2);
      this.glowGfx.fill({ color: ARC_HALO, alpha: 0.35 * (1 - k) });
    }
    this.flashes = this.flashes.filter((f) => f.age < FLASH_MS);
  }

  /** A ball in the sea: it fizzes out, a ring spreading, sparks skating over the water, steam. */
  private drawFizzes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const f of this.fizzes) {
      f.age += deltaMs;
      const k = f.age / FIZZ_MS;
      if (k >= 1) continue;
      const x = tileX(view, f.x + 0.5);
      const y = tileY(view, f.y + 0.5);
      g.ellipse(x, y, t * (0.2 + 0.7 * k), t * (0.12 + 0.4 * k));
      g.stroke({ width: Math.max(1, t * 0.05), color: 0xcfe0f0, alpha: 0.7 * (1 - k) });
      if (k < 0.45) {
        for (let n = 0; n < 4; n++) {
          const a = (n / 4) * Math.PI * 2 + f.x;
          const r = t * (0.3 + 0.6 * k);
          drawArc(
            g,
            this.glowGfx,
            jag(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.55, 3, r * 0.3),
            ARC_HALO,
            Math.max(1, t * 0.035),
            1 - k / 0.45,
          );
        }
      }
      for (let n = 0; n < 3; n++) {
        g.circle(x + (n - 1) * t * 0.2, y - k * t * (0.8 + 0.2 * n), t * (0.12 + 0.2 * k));
      }
      g.fill({ color: 0xdfe6ee, alpha: 0.3 * (1 - k) });
    }
    this.fizzes = this.fizzes.filter((f) => f.age < FIZZ_MS);
  }

  /** A swept block shorting out: a pop of light where it stood, and the block gone black. */
  private drawShorts(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.shorts) {
      s.age += deltaMs;
      const k = s.age / SHORT_MS;
      if (k >= 1) continue;
      const shrink = (1 - k) * t * 0.8;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.5);
      g.rect(x - shrink / 2, y - shrink / 2, shrink, shrink);
      g.fill({ color: 0x14161a, alpha: 1 - k });
      if (k < 0.25) {
        this.glowGfx.circle(x, y, t * 0.7);
        this.glowGfx.fill({
          color: s.owner < 0 ? ARC_HALO : this.colour(s.owner, 'light'),
          alpha: 0.5 * (1 - k / 0.25),
        });
      }
    }
    this.shorts = this.shorts.filter((s) => s.age < SHORT_MS);
  }

  /** A piece set down welded in: a white flash over its blocks, fading. */
  private drawWelds(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    for (const w of this.welds) {
      w.age += deltaMs;
      const k = w.age / WELD_MS;
      if (k >= 1) continue;
      for (const { x, y } of w.cells) this.lateGfx.rect(tileX(view, x), tileY(view, y), t, t);
      this.lateGfx.fill({ color: ARC_WHITE, alpha: 0.45 * (1 - k) * (1 - k) });
    }
    this.welds = this.welds.filter((w) => w.age < WELD_MS);
  }

  /** Sparks thrown off, falling and dying: white-hot streaks along their flight. */
  private drawSparks(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const s of this.sparks) {
      s.age += deltaMs;
      s.vy += 9 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age >= s.life) continue;
      const x = tileX(view, s.x);
      const y = tileY(view, s.y);
      g.moveTo(x, y).lineTo(x - s.vx * t * 0.03, y - s.vy * t * 0.03);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: 0xfff4d8 });
    this.sparks = this.sparks.filter((s) => s.age < s.life);
  }

  /** Smoke from a hit or a short, rising and drifting off on the storm's wind. */
  private drawSmoke(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    for (const s of this.smokes) {
      s.age += deltaMs;
      const k = s.age / SMOKE_MS;
      if (k >= 1) continue;
      for (let n = 0; n < 3; n++) {
        g.circle(
          tileX(view, s.x + 0.5 + k * (0.8 + n * 0.2)),
          tileY(view, s.y + 0.3 - k * (0.8 + n * 0.3)),
          t * (0.15 + 0.3 * k),
        );
      }
      g.fill({ color: SMOKE, alpha: 0.35 * (1 - k) });
    }
    this.smokes = this.smokes.filter((s) => s.age < SMOKE_MS);
  }

  /**
   * The storm overhead: now and then a bolt forks down onto the outer sea — never over the
   * board, where a flash at a spot is an impact — flickering two or three times, and the sky
   * flickers over the whole screen with it, faintly. Far more often as the storm breaks; in
   * a clear match only the flicker, heat lightning far off. None of it with motion reduced.
   */
  private drawSky(state: MatchState, view: ViewTransform, deltaMs: number): void {
    if (motionReduced()) return;
    const storm = this.storm(state);
    const every = storm ? this.style.stormBoltEveryMs : this.style.boltEveryMs;
    if (this.untilBolt < 0) this.untilBolt = every * Math.random();
    this.untilBolt -= deltaMs;
    if (this.untilBolt <= 0) {
      this.untilBolt = every * (0.5 + Math.random());
      const cell = this.boltCells[Math.floor(Math.random() * this.boltCells.length)];
      const strikes = cell !== undefined && (this.weather !== 'clear' || storm);
      this.skyBolts.push({
        x: strikes ? tileX(view, cell.x + 0.5) : Number.NaN,
        y: strikes ? tileY(view, cell.y + 0.5) : Number.NaN,
        age: 0,
      });
    }
    let flash = 0;
    for (const b of this.skyBolts) {
      b.age += deltaMs;
      if (b.age >= BOLT_MS) continue;
      // Three strokes down the same channel, the first the brightest.
      const phase = b.age / BOLT_MS;
      const on = phase < 0.22 || (phase > 0.38 && phase < 0.5) || (phase > 0.7 && phase < 0.78);
      if (!on) continue;
      flash = Math.max(flash, phase < 0.22 ? 1 : 0.5);
      if (Number.isNaN(b.x)) continue;
      drawBolt(
        this.lateGfx,
        this.glowGfx,
        b.x + (hash(Math.round(b.x), 1, 1040) - 0.5) * view.tile * 3,
        view.top,
        b.x,
        b.y,
        ARC_HALO,
        Math.max(1.5, view.tile * 0.08),
      );
      this.glowGfx.circle(b.x, b.y, view.tile * 1.5);
      this.glowGfx.fill({ color: ARC_HALO, alpha: 0.3 });
    }
    this.skyBolts = this.skyBolts.filter((b) => b.age < BOLT_MS);
    if (flash > 0) {
      this.flashGfx.rect(0, view.top, view.width, view.height - view.top);
      this.flashGfx.fill({ color: 0xe8f0ff, alpha: this.style.flashAlpha * flash });
    }
  }

  /**
   * The weather from the seed, as a storm has it: rain slanting on the wind, heavier as the
   * storm breaks; "snow" is hail, bouncing; fog is ionised mist, St. Elmo's fire burning on
   * the coils (`drawCoils`); a clear match is dry until the storm breaks.
   */
  private drawWeather(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const cols = view.width / t;
    const rows = (view.height - view.top) / t;
    this.dropStamps.begin();
    this.mist.begin(t);
    const storm = this.storm(state);
    const hail = this.weather === 'snow';
    const count = hail
      ? this.style.hailCount
      : this.weather === 'rain'
        ? this.style.rainCount * (storm ? 1.5 : 1)
        : this.weather === 'overcast' || storm
          ? this.style.rainCount * 0.4
          : 0;
    if (!still && count > 0) {
      while (this.drops.length < count) {
        this.drops.push({
          x: Math.random() * cols,
          y: Math.random() * rows,
          speed: hail ? 7 + Math.random() * 3 : 12 + Math.random() * 5,
          floor: Math.random() * rows,
        });
      }
      if (this.drops.length > count) this.drops.length = Math.floor(count);
      const streak = this.book.get('rain', t, (k) => {
        k.moveTo(0, 0).lineTo(-t * 0.25, -t * 0.85);
        k.stroke({ width: Math.max(1, t * 0.04), color: 0xc9d6e8 });
      });
      const stone = this.book.get('hail', t, (k) => {
        k.circle(0, 0, Math.max(1, t * 0.07));
        k.fill({ color: 0xf0f4f8 });
      });
      const dt = deltaMs / 1000;
      for (const [n, d] of this.drops.entries()) {
        d.y += d.speed * dt;
        d.x += d.speed * 0.3 * dt;
        if (d.y > (hail ? d.floor + 0.3 : rows)) {
          d.y = -1;
          d.x = Math.random() * cols;
          d.floor = Math.random() * rows;
        }
        // A hailstone bounces once where it lands, then is gone.
        const y = hail && d.y > d.floor ? d.floor - (d.y - d.floor) : d.y;
        // Over land the rain is thinned, one streak in RAIN_OVER_LAND kept and fainter, so
        // the board reads through it in the build phase; the sea keeps the whole storm (S9).
        // By the drop's place in the list, so a streak does not flicker as it crosses a coast.
        const sx = d.x * t;
        const sy = view.top + y * t;
        const onLand =
          !hail &&
          this.land(Math.floor((sx - view.originX) / t), Math.floor((sy - view.originY) / t));
        if (onLand && n % RAIN_OVER_LAND !== 0) continue;
        this.dropStamps.place(hail ? stone : streak, sx, sy, {
          alpha: hail ? 0.9 : onLand ? 0.35 : 0.5,
        });
      }
    }
    if (this.weather === 'fog') {
      const { mistBanks, mistAlpha } = this.style;
      for (let n = 0; n < mistBanks; n++) {
        const drift = still ? 0 : this.clock / 50000;
        const fx = (((hash(n, this.seed, 1050) + drift * (0.5 + hash(n, 1, 1051))) % 1) + 1) % 1;
        const fy = 0.1 + 0.8 * hash(n, this.seed, 1052);
        const x = fx * (view.width + 6 * t) - 3 * t;
        const y = view.top + fy * (view.height - view.top);
        for (const [dx, dy, r] of [
          [0, 0, 3.2],
          [2.5, 0.5, 2.4],
          [-2.3, 0.6, 2.2],
        ] as const) {
          for (const f of [1, 0.75, 0.5]) {
            this.mist.disc(x + dx * t, y + dy * t, r * t * f, 0x9ab0d0, mistAlpha / 3);
          }
        }
      }
    }
    this.dropStamps.end();
    this.mist.end();
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const now = performance.now();
    drawOvertimeBorder(g, state, view, this.art, now);
    drawSelectable(g, view, ghost, this.art, now);
    drawBuildHints(g, view, ghost, this.art, now);
    drawSealPreview(g, view, ghost, this.art);
    this.ghostMotion.draw(g, g, view, ghost, this.art);
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      // The piece in hand as a live wire, current pulsing round it; where it does not fit, a
      // short circuit — the wire broken in places, sparking across the breaks. The difference
      // is in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark),
        alpha: ghost.valid ? 0.3 : 0.45,
      });
      const still = motionReduced();
      const edge = outline(cells, inPiece, view);
      if (ghost.valid) {
        trace(g, edge);
        g.stroke({ width: Math.max(2, t * 0.14), color: this.dark });
        trace(g, edge);
        g.stroke({ width: Math.max(1, t * 0.06), color: COPPER });
        // Pulses of current gliding round the wire, two tiles apart, at a calm pace: on one
        // lattice across the screen, so they run on from stretch to stretch. They first
        // jumped a stretch every 45 ms, which the user found hectic and unnerving.
        const flow = still ? 0 : (now / 1000) * 1.2;
        for (const s of edge) {
          const across = s.y1 === s.y2;
          const u0 =
            (Math.min(across ? s.x1 : s.y1, across ? s.x2 : s.y2) -
              (across ? view.originX : view.originY)) /
            t;
          const length = Math.abs(across ? s.x2 - s.x1 : s.y2 - s.y1) / t;
          const first = u0 + ((((flow - u0) % 2) + 2) % 2);
          for (let u = first; u <= u0 + length; u += 2) {
            const px = across ? view.originX + u * t : s.x1;
            const py = across ? s.y1 : view.originY + u * t;
            g.circle(px, py, Math.max(1.5, t * 0.09));
          }
        }
        g.fill({ color: ARC_WHITE });
        return;
      }
      // Broken: every third stretch of the wire missing, an arc jumping each gap.
      edge.forEach((s, n) => {
        if (n % 3 === 1) return;
        g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
      });
      g.stroke({ width: Math.max(2, t * 0.12), color: COPPER_DARK });
      edge.forEach((s, n) => {
        if (n % 3 !== 1) return;
        // A new shape about six times a second, not every frame: drawn afresh each frame the
        // arcs were hectic.
        const beat = still ? 0 : Math.floor(now / 160);
        drawArc(
          g,
          null,
          jag(s.x1, s.y1, s.x2, s.y2, 3, t * 0.15, mulberry(beat * 977 + n * 7919)),
          ARC_HALO,
          Math.max(1, t * 0.05),
          0.85,
        );
      });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // The coil's place, a ring of copper, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const x = tileX(view, anchor.x);
      const y = tileY(view, anchor.y);
      const w = ghost.footprint.w * t;
      const h = ghost.footprint.h * t;
      g.ellipse(x + w / 2, y + h / 2, w / 2 - t * 0.12, h / 2 - t * 0.12);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(x + t * 0.3, y + h - t * 0.3).lineTo(x + w - t * 0.3, y + t * 0.3);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/** A small seeded random source, for a figure drawn the same each time it is drawn. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A Lichtenberg figure, in tiles: branches growing out from each root in strokes of about
 * `step`, wandering and forking, never leaving where `inside` allows; up to `depth` strokes
 * from a root and `limit` strokes in all.
 */
function lichtenberg(
  roots: readonly { x: number; y: number }[],
  inside: (x: number, y: number) => boolean,
  rand: () => number,
  step: number,
  depth: number,
  limit: number,
): Branch[] {
  const out: Branch[] = [];
  const stack: { x: number; y: number; a: number; d: number }[] = [];
  for (const r of roots) {
    const arms = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < arms; k++) {
      stack.push({ x: r.x, y: r.y, a: (k / arms) * Math.PI * 2 + rand() * 0.6, d: 0 });
    }
  }
  while (stack.length > 0 && out.length < limit) {
    // Taken from the front, so every arm grows a little before any grows far.
    const b = stack.shift()!;
    if (b.d >= depth) continue;
    const len = step * (0.6 + rand() * 0.6);
    const x = b.x + Math.cos(b.a) * len;
    const y = b.y + Math.sin(b.a) * len;
    if (!inside(x, y)) continue;
    out.push({ x1: b.x, y1: b.y, x2: x, y2: y, depth: b.d });
    stack.push({ x, y, a: b.a + (rand() - 0.5) * 1.1, d: b.d + 1 });
    if (rand() < 0.32)
      stack.push({ x, y, a: b.a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6), d: b.d + 1 });
  }
  return out;
}

/**
 * Electric's scenery, none like a cage, a coil or a ball: a tree is one split by lightning,
 * charred; a pine a telegraph pole with porcelain insulators on its crossarm; a bush a
 * fulgurite — the glassy tube lightning melts into sand — or a lightning rod on a stone; a
 * boulder slate, or one in three a Wimshurst machine on its crate, its two discs and brass
 * spheres.
 */
function drawElectricScenery(
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  art: ArtConfig,
): void {
  const t = view.tile;
  const ink = hex(art.palette.shadow);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree') {
      // Split down the middle, the halves leaning apart, charred, a few bare branches.
      g.ellipse(cx + t * 0.1, cy + t * 0.4, t * 0.32, t * 0.07);
      g.fill({ color: ink, alpha: 0.35 });
      for (const side of [-1, 1]) {
        g.poly([
          cx + side * t * 0.02,
          cy + t * 0.4,
          cx + side * t * 0.14,
          cy + t * 0.4,
          cx + side * t * 0.3,
          cy - t * 0.35,
          cx + side * t * 0.2,
          cy - t * 0.38,
        ]);
      }
      g.fill({ color: 0x2e2622 });
      for (const side of [-1, 1]) {
        g.moveTo(cx + side * t * 0.24, cy - t * 0.1).lineTo(cx + side * t * 0.42, cy - t * 0.28);
        g.moveTo(cx + side * t * 0.18, cy + t * 0.1).lineTo(cx + side * t * 0.36, cy + t * 0.02);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x2e2622 });
      g.moveTo(cx, cy + t * 0.38).lineTo(cx + t * 0.03, cy - t * 0.1);
      g.stroke({ width: Math.max(1, t * 0.04), color: 0x6a3a22, alpha: 0.8 });
    } else if (item.kind === 'pine') {
      // A telegraph pole: wood, a crossarm, three insulators.
      g.ellipse(cx + t * 0.12, cy + t * 0.42, t * 0.2, t * 0.05);
      g.fill({ color: ink, alpha: 0.35 });
      g.rect(cx - t * 0.04, cy - t * 0.45, t * 0.08, t * 0.87);
      g.rect(cx - t * 0.32, cy - t * 0.36, t * 0.64, t * 0.06);
      g.fill({ color: 0x5a4632 });
      for (const u of [-0.26, 0, 0.26])
        g.rect(cx + u * t - t * 0.04, cy - t * 0.46, t * 0.08, t * 0.1);
      g.fill({ color: PORCELAIN });
    } else if (item.kind === 'bush') {
      if (item.variant % 2 === 0) {
        // A fulgurite: a glassy tube forking where the bolt forked.
        g.moveTo(cx - t * 0.25, cy + t * 0.25)
          .lineTo(cx - t * 0.05, cy + t * 0.05)
          .lineTo(cx + t * 0.2, cy + t * 0.12)
          .lineTo(cx + t * 0.32, cy - t * 0.05);
        g.moveTo(cx - t * 0.05, cy + t * 0.05)
          .lineTo(cx + t * 0.02, cy - t * 0.22)
          .lineTo(cx - t * 0.12, cy - t * 0.32);
        g.stroke({ width: Math.max(1.5, t * 0.09), color: 0x9fb0a0 });
        g.moveTo(cx - t * 0.25, cy + t * 0.22).lineTo(cx - t * 0.05, cy + t * 0.02);
        g.stroke({ width: 1, color: 0xe8f0e8, alpha: 0.8 });
      } else {
        // A lightning rod on a stone.
        g.ellipse(cx, cy + t * 0.25, t * 0.24, t * 0.1);
        g.fill({ color: hex(art.palette.rockMid) });
        g.rect(cx - t * 0.025, cy - t * 0.38, t * 0.05, t * 0.62);
        g.fill({ color: COPPER });
        g.poly([cx - t * 0.05, cy - t * 0.38, cx, cy - t * 0.5, cx + t * 0.05, cy - t * 0.38]);
        g.fill({ color: COPPER });
      }
    } else if (item.variant % 3 === 0) {
      // A Wimshurst machine on its crate: two discs, the brass spheres of its spark gap.
      g.rect(cx - t * 0.32, cy + t * 0.05, t * 0.64, t * 0.32);
      g.fill({ color: 0x6a5038 });
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
      for (const dx of [-0.07, 0.07]) {
        g.circle(cx + dx * t, cy - t * 0.15, t * 0.22);
      }
      g.fill({ color: 0x2a2e36, alpha: 0.9 });
      for (const dx of [-0.07, 0.07]) {
        g.circle(cx + dx * t, cy - t * 0.15, t * 0.22);
      }
      g.stroke({ width: 1, color: 0x9a9ea5 });
      for (const dx of [-0.24, 0.24]) g.circle(cx + dx * t, cy - t * 0.42, t * 0.05);
      g.fill({ color: BRASS });
    } else {
      // Slate, split in layers.
      g.ellipse(cx + t * 0.05, cy + t * 0.3, t * 0.36, t * 0.08);
      g.fill({ color: ink, alpha: 0.35 });
      g.poly([
        cx - t * 0.34,
        cy + t * 0.28,
        cx - t * 0.22,
        cy - t * 0.12,
        cx + t * 0.12,
        cy - t * 0.22,
        cx + t * 0.32,
        cy + t * 0.02,
        cx + t * 0.3,
        cy + t * 0.28,
      ]);
      g.fill({ color: hex(art.palette.rockMid) });
      g.stroke({ width: 1, color: ink, alpha: 0.6 });
      g.moveTo(cx - t * 0.26, cy + t * 0.05).lineTo(cx + t * 0.28, cy - t * 0.02);
      g.stroke({ width: 1, color: hex(art.palette.rockDark), alpha: 0.8 });
    }
  }
}
