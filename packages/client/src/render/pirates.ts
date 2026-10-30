import type { ArtConfig, PiratesStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type MatchState, type Shot } from '@bollwerk/sim';
import { Container, Graphics, type GraphicsContext } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { perf } from '../perf.js';
import type { TimerSpot } from '../timerSpot.js';

import { cannonBase } from './cannonBase.js';
import { clearDrawn } from './clearDrawn.js';
import { climaxLevel, cornerSpot, hurry } from './corner.js';
import { IslandParts } from './islandParts.js';
import { BONE, DOUBLOON_SHINE, TAR, drawDoubloon, drawSkullAndBones } from './jolly.js';
import { hash } from './noise.js';
import { outerOcean } from './ocean.js';
import { release } from './release.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
import { PiratesSeaLife } from './seaLife.js';
import { ShapeTheme } from './shapeTheme.js';
import { Discs, StampBook, Stamps, viewKey } from './stamps.js';
import { TerrainStrips, whole, type TerrainPass, type TerrainPlan } from './terrainStrips.js';
import {
  looksLoaded,
  Fireworks,
  FlagHoist,
  GhostMotion,
  GunAims,
  Landings,
  MainCastles,
  RuinSmoke,
  WinnerBanners,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawCannonGhost,
  drawChoices,
  drawDrain,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
  drawSealPreview,
  drawSelectable,
  drawShotTarget,
  hex,
  mixed,
  shotLift,
  shotProgress,
  shotScale,
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
} from './theme.js';
import { hatch, outline, trace, wallGeometry } from './walls.js';

/** The stockade's timber, its stake tops and its shaded face, before the owner's stain. */
const WOOD_TOP = 0xd09a5e;
const WOOD_FACE = 0x8a5a30;
const WOOD_DARK = 0x6a4424;
/** Grey driftwood: a stockade whose player is out, rubble, a fort abandoned. */
const DRIFT = 0xaaa498;
const DRIFT_DARK = 0x77726a;
/** How much of the owner's colour the stockade's timber takes: enough to read whose at a glance. */
const STAIN_TOP = 0.6;
const STAIN_FACE = 0.45;
/** A gun platform's planks. */
const DECK = 0xb88a56;
/** A ship's cannon's iron, its highlight, and the wooden plug stopping a silenced one's muzzle. */
const IRON = 0x2a2a30;
const IRON_LIGHT = 0x6a6a74;
const TAMPION = 0xa0582a;
/** A parrot's beak and its tricorn hat. */
const HORN = 0xf0dca0;
const HAT = 0x16120e;
/** Gunsmoke, a torch's bamboo and its flame. */
const SMOKE = 0xe0dcd4;
const BAMBOO = 0xc8a868;
const FLAME = 0xffa838;
const FLAME_HOT = 0xfff0a0;
/** A ghost crab, pale as the sand it runs over. */
const CRAB = 0xead2a4;
const CRAB_DARK = 0x9a7450;
/** The Kraken's hide and its suckers: slate, so it is no player's colour. */
const KRAKEN = 0x4e5e66;
const KRAKEN_DARK = 0x222e36;
const SUCKER = 0xd8cfc0;

/** A gun's kick and its smoke after a shot; a muzzle's flash. */
const FIRE_MS = 300;
const FLASH_MS = 90;
/** A splash where a shot came down in the sea, a coin flung from a stockade, a puff. */
const SPLASH_MS = 750;
const COIN_MS = 950;

/** The barrel's pivot on its carriage, its elevation, and how far it droops when silenced. */
const PIVOT = { x: 0.02, y: -0.55 } as const;
const ELEVATION = 0.22;
const DROOP = -0.06;
/** The barrel's muzzle along it, from the pivot, in tiles. */
const MUZZLE = 0.72;
/** Where on the barrel the parrot perches, from the pivot along it and up from its axis. */
const PERCH_ALONG = -0.3;
const PERCH_UP = 0.18;
/** The parrot drawn a little larger than its tile would make it, so it reads at 16 pixels. */
const PARROT_SCALE = 1.2;
/** How high over its gun a parrot circles while the gun reloads, in tiles. */
const HOVER_UP = 1.3;
/** The cannon icon's figure, filling its square. */
const ICON_FILL = 1.15;

/** How the pirates send off their winners: doubloons and jewels, and the Jolly Roger hoisted. */
const FINISH: FinishLook = { spark: 'doubloons', flag: 'jolly' };

/** Something with a place and an age. */
interface Aged {
  x: number;
  y: number;
  age: number;
}

/** A crater in the sand, fading over the rounds. */
interface Crater {
  x: number;
  y: number;
  round: number;
}

/** A thing thrown: a splinter of the stockade in its owner's stain, or a puff of sand or smoke. */
interface Thrown {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  angle: number;
  spin: number;
  /** The splinter's colour; null for a puff. */
  colour: number | null;
  puff: number;
  r: number;
}

/** A doubloon flung out of a stockade by a hit, spinning as it flies and falls. */
interface Coin extends Aged {
  vx: number;
  vy: number;
  turn: number;
}

/** A ghost crab: where it is, where it is going, how long it waits there. */
interface Crab {
  x: number;
  y: number;
  tx: number;
  ty: number;
  wait: number;
  running: boolean;
  dir: 1 | -1;
}

/** Where one of the Kraken's arms rises, in tiles, and which way it leans and curls. */
interface Arm {
  x: number;
  y: number;
  lean: number;
  curl: 1 | -1;
  phase: number;
  length: number;
}

/** A parrot's flight from its gun and back, as far as it has come (`parrotFlight`). */
export type ParrotFlight =
  | { mode: 'perch' }
  | { mode: 'hover' }
  | { mode: 'takeoff'; k: number }
  | { mode: 'landing'; k: number };

/**
 * Where a gun's parrot is: perched while its gun is ready, circling over it while it reloads,
 * and on its way between the two for a moment either side. `perched` is whether it should be
 * on its gun, and `since` when that last changed.
 */
export function parrotFlight(
  perched: boolean,
  since: number,
  now: number,
  takeOffMs: number,
  landMs: number,
): ParrotFlight {
  const age = now - since;
  if (perched) return age < landMs ? { mode: 'landing', k: age / landMs } : { mode: 'perch' };
  return age < takeOffMs ? { mode: 'takeoff', k: age / takeOffMs } : { mode: 'hover' };
}

/**
 * The tiki torches round each player's sealed ground, in tiles: one at its convex corners, just
 * inside them, at most `cap` a player, spread round the ground as far apart as they will go.
 * From the board alone, so every redraw puts them where they were.
 */
export function torchSpots(
  territory: Uint8Array,
  width: number,
  players: number,
  cap: number,
): { x: number; y: number; player: number }[] {
  const height = territory.length / width;
  const owned = (x: number, y: number, p: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && territory[y * width + x] === p;
  const out: { x: number; y: number; player: number }[] = [];
  if (cap <= 0) return out;
  for (let player = 0; player < players; player++) {
    const p = player + 1;
    const corners: { x: number; y: number }[] = [];
    for (let i = 0; i < territory.length; i++) {
      if (territory[i] !== p) continue;
      const x = i % width;
      const y = (i - x) / width;
      const up = !owned(x, y - 1, p);
      const down = !owned(x, y + 1, p);
      const left = !owned(x - 1, y, p);
      const right = !owned(x + 1, y, p);
      if (up && left) corners.push({ x: x + 0.3, y: y + 0.35 });
      if (up && right) corners.push({ x: x + 0.7, y: y + 0.35 });
      if (down && left) corners.push({ x: x + 0.3, y: y + 0.8 });
      if (down && right) corners.push({ x: x + 0.7, y: y + 0.8 });
    }
    if (corners.length === 0) continue;
    // The first corner found, then each next the one farthest from all those chosen.
    const chosen = [corners[0] as { x: number; y: number }];
    const nearest = corners.map((c) => Math.hypot(c.x - chosen[0]!.x, c.y - chosen[0]!.y));
    while (chosen.length < Math.min(cap, corners.length)) {
      let best = -1;
      let far = 1.5;
      for (let k = 0; k < corners.length; k++) {
        if ((nearest[k] as number) > far) {
          far = nearest[k] as number;
          best = k;
        }
      }
      if (best < 0) break;
      const next = corners[best] as { x: number; y: number };
      chosen.push(next);
      for (let k = 0; k < corners.length; k++) {
        const c = corners[k] as { x: number; y: number };
        nearest[k] = Math.min(nearest[k] as number, Math.hypot(c.x - next.x, c.y - next.y));
      }
    }
    for (const c of chosen) out.push({ ...c, player });
  }
  return out;
}

/** The parrot's perch on its gun, from the gun's feet, facing right, in tiles. */
function perchPoint(): { x: number; y: number } {
  const c = Math.cos(ELEVATION);
  const s = Math.sin(ELEVATION);
  return {
    x: PIVOT.x + PERCH_ALONG * c + PERCH_UP * s,
    y: PIVOT.y - PERCH_ALONG * s - PERCH_UP * c,
  };
}

/** The muzzle's mouth, from the gun's feet, facing right, in tiles. */
function muzzlePoint(): { x: number; y: number } {
  return {
    x: PIVOT.x + Math.cos(ELEVATION) * MUZZLE,
    y: PIVOT.y - Math.sin(ELEVATION) * MUZZLE,
  };
}

/**
 * The Pirates look, for either look (ARCHIVE 14q): a pirates' cove in bright Caribbean daylight
 * — deep blue ocean, turquoise shallows over the reef, white sand beaches round jungle. Walls are
 * a log stockade, sharpened stakes stained with the owner's colour and lashed with a rope of it;
 * castles timber forts, **flying the Jolly Roger in the owner's colour while sealed**. **The guns
 * are ship's cannon** on wooden carriages, and a gun ready to fire has its parrot on it, in the
 * owner's colour under a pirate hat: firing scares it up, and it circles over the gun until the
 * gun is loaded again, then lands. A silenced gun has a plug in its muzzle, and no parrot. Shots
 * are chain shot; a hit throws splinters and now and then a doubloon, a miss in the sea a column
 * of spray. Sealed ground is lit by tiki torches at its corners; ghost crabs scuttle over the
 * open sand. A galleon rides at anchor in the corner, and at the climax the Kraken rises.
 */
export class PiratesTheme extends ShapeTheme implements Theme {
  readonly id = 'pirates' as const;

  private style!: PiratesStyleConfig;
  private readonly seaLife = new PiratesSeaLife();

  /** The sea, the reef's shallows, the beaches and the jungle, in strips of rows. */
  private readonly terrainStrips = new TerrainStrips();
  private readonly craterGfx = new Graphics();
  private cratersDrawn = '';
  /** The galleon in the corner, rocked as a whole and drawn again only when it changes. */
  private readonly galleonGfx = new Graphics();
  private galleonKey = '';
  private readonly territory = new IslandParts(1, 'territory');
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawPiratesScenery(g, view, items),
    () => 0xf1dfab,
  );
  /** The stockades and the guns' platforms, an island to a `Graphics`. */
  private readonly structures = new IslandParts();
  private readonly book = new StampBook();
  private readonly underGfx = new Graphics();
  private readonly crabStamps = new Stamps();
  private readonly torchStamps = new Stamps();
  private readonly castleStamps = new Stamps();
  private readonly crowns = new MainCastles();
  private readonly gunStamps = new Stamps();
  private readonly parrotStamps = new Stamps();
  private readonly effectGfx = new Graphics();
  private readonly shadowStamps = new Stamps();
  private readonly shotStamps = new Stamps();
  private readonly burstStamps = new Stamps();
  private readonly lateGfx = new Graphics();
  /** The torches' light and the muzzles' flashes, added. */
  private readonly glow = new Discs();
  private readonly overlayGfx = new Graphics();

  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly landings = new Landings();
  private readonly aims = new GunAims();
  private readonly flags = new FlagHoist();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);

  private clock = 0;
  private round = 0;
  private corner: TimerSpot | null = null;
  private roll = 0;
  private craters: Crater[] = [];
  private thrown: Thrown[] = [];
  private splashes: Aged[] = [];
  private coins: Coin[] = [];
  private flashes: Aged[] = [];
  private crabs: Crab[] = [];
  private arms: Arm[] = [];
  private drops: { x: number; y: number }[] = [];
  private torches: { x: number; y: number; player: number }[] = [];
  private torchKey = -1;
  /** Whether each gun's parrot should be on it, and since when. */
  private readonly parrots = new Map<number, { perched: boolean; since: number }>();

  constructor(private readonly seed = 1) {
    super();
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.pirates;
    this.glow.container.blendMode = 'add';
    layers.terrain.addChild(this.terrainStrips.container, this.craterGfx, this.galleonGfx);
    layers.territory.addChild(this.territory.container, this.scenery.gfx);
    layers.structures.addChild(this.structures.container);
    layers.effects.addChild(
      this.underGfx,
      this.crabStamps.container,
      this.torchStamps.container,
      this.castleStamps.container,
      this.crowns.gfx,
      this.gunStamps.container,
      this.parrotStamps.container,
      this.effectGfx,
      this.shadowStamps.container,
      this.shotStamps.container,
      this.burstStamps.container,
      this.lateGfx,
      this.glow.container,
    );
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.territory.destroy();
    this.structures.destroy();
    this.scenery.destroy();
    for (const s of [
      this.crabStamps,
      this.torchStamps,
      this.castleStamps,
      this.gunStamps,
      this.parrotStamps,
      this.shadowStamps,
      this.shotStamps,
      this.burstStamps,
    ]) {
      s.destroy();
    }
    this.glow.destroy();
    this.book.destroy();
    release(this.terrainStrips.container);
    for (const g of [
      this.craterGfx,
      this.galleonGfx,
      this.underGfx,
      this.crowns.gfx,
      this.effectGfx,
      this.lateGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The deep blue ocean, lighter over the slope round each island, turquoise over the reef's
   * shallows, foam along the beach; each island white sand round its jungle.
   */
  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrainStrips.draw(state, view, () => this.planTerrain(state, view));
  }

  private planTerrain(state: MatchState, view: ViewTransform): TerrainPlan {
    this.terrain = state.terrain;
    this.width = state.width;
    this.height = state.height;
    this.scenery.refresh(state, view, this.art, true);
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean => this.land(x, y);
    /** Whether land lies within `r` tiles, corners too. */
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (land(x + dx, y + dy)) return true;
      }
      return false;
    };
    const shallow = (x: number, y: number): boolean => !land(x, y) && near(x, y, 1);
    const slope = (x: number, y: number): boolean => !land(x, y) && near(x, y, 3);
    /** The beach: land with the sea beside it, corners too. */
    const beach = (x: number, y: number): boolean => {
      if (!land(x, y)) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (!land(x + dx, y + dy)) return true;
      }
      return false;
    };
    const jungle = (x: number, y: number): boolean => land(x, y) && !beach(x, y);

    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const x1 = state.width + marginX;
    const y1 = state.height + marginY;
    const sea = (g: Graphics): void => {
      g.rect(tileX(view, x0), tileY(view, y0), (x1 - x0) * t, (y1 - y0) * t);
    };
    const cells = (
      from: number,
      to: number,
      keep: (x: number, y: number) => boolean,
      pad = 3,
    ): Cell[] => {
      const out: Cell[] = [];
      for (let y = Math.max(-pad, from); y < Math.min(state.height + pad, to); y++) {
        for (let x = -pad; x < state.width + pad; x++) if (keep(x, y)) out.push({ x, y });
      }
      return out;
    };
    const fill = (g: Graphics, list: readonly Cell[]): void => {
      for (const { x, y } of list) g.rect(tileX(view, x), tileY(view, y), t, t);
    };
    const passes: TerrainPass[] = [
      whole((g) => {
        sea(g);
        g.fill({ color: hex(palette.waterDeep) });
      }),
      // Swell on the open ocean: short arcs, one tile in seven, drawn once.
      (g, from, to) => {
        for (let y = Math.max(y0, from); y < Math.min(y1, to); y++) {
          for (let x = x0; x < x1; x++) {
            if (near(x, y, 3) || hash(x, y, 9300) > 0.14) continue;
            const cx = tileX(view, x + 0.3 + 0.4 * hash(x, y, 9301));
            const cy = tileY(view, y + 0.5);
            g.moveTo(cx - t * 0.32, cy).quadraticCurveTo(cx, cy - t * 0.22, cx + t * 0.32, cy);
          }
        }
        g.stroke({ width: Math.max(1, t * 0.07), color: hex(palette.waterMid), cap: 'round' });
      },
      (g, from, to) => {
        fill(g, cells(from, to, slope));
        g.fill({ color: hex(palette.waterMid) });
      },
      (g, from, to) => {
        fill(g, cells(from, to, shallow));
        g.fill({ color: hex(palette.waterShallow) });
      },
      // The reef's edge, where the shallows drop away, faint.
      (g, from, to) => {
        trace(
          g,
          outline(cells(from, to, shallow), (x, y) => shallow(x, y) || land(x, y), view),
        );
        g.stroke({ width: Math.max(1, t * 0.08), color: hex(palette.waterFoam), alpha: 0.35 });
      },
      (g, from, to) => {
        fill(g, cells(from, to, land, 1));
        g.fill({ color: hex(palette.sand) });
      },
      // Foam along the beach.
      (g, from, to) => {
        trace(g, outline(cells(from, to, land, 1), land, view));
        g.stroke({ width: Math.max(1.5, t * 0.14), color: hex(palette.waterFoam), alpha: 0.9 });
      },
      // The jungle, lighter in clearings, its edge darker where it meets the sand.
      (g, from, to) => {
        fill(g, cells(from, to, jungle, 0));
        g.fill({ color: hex(palette.grassMid) });
      },
      // Clearings, faint: at full strength their tiles made a chequer.
      (g, from, to) => {
        fill(
          g,
          cells(from, to, (x, y) => jungle(x, y) && hash(x, y, 9310) < 0.3, 0),
        );
        g.fill({ color: hex(palette.grassLight), alpha: 0.45 });
      },
      (g, from, to) => {
        trace(g, outline(cells(from, to, jungle, 0), jungle, view));
        g.stroke({ width: Math.max(1, t * 0.08), color: hex(palette.grassDark) });
      },
      // Shells and pebbles on the sand.
      (g, from, to) => {
        for (const { x, y } of cells(from, to, beach, 0)) {
          if (hash(x, y, 9320) > 0.18) continue;
          g.circle(
            tileX(view, x + 0.2 + 0.6 * hash(x, y, 9321)),
            tileY(view, y + 0.2 + 0.6 * hash(x, y, 9322)),
            Math.max(1, t * 0.05),
          );
        }
        g.fill({ color: hex(palette.rockLight) });
      },
    ];

    this.corner = cornerSpot(state, view);
    this.seaLife.corner = this.corner;
    this.seaLife.layout(state, view, this.art);
    this.layoutArms(state, view);
    this.layoutCrabs(state);
    this.cratersDrawn = '';
    this.galleonKey = '';
    return { rows: [y0, y1], passes };
  }

  /** Scorched pits in the sand where shots came down, fading over the rounds. */
  private drawCraters(state: MatchState, view: ViewTransform): void {
    const rounds = this.art.generators.fx.craterRounds;
    this.craters = this.craters.filter((c) => state.round - c.round < rounds);
    const key = `${state.round}|${this.craters.length}|${viewKey(view)}`;
    if (key === this.cratersDrawn) return;
    this.cratersDrawn = key;
    const g = this.craterGfx;
    clearDrawn(g);
    const t = view.tile;
    const { palette } = this.art;
    for (const c of this.craters) {
      const fade = 1 - (state.round - c.round) / rounds;
      const x = tileX(view, c.x + 0.5);
      const y = tileY(view, c.y + 0.5);
      g.ellipse(x, y, t * 0.4, t * 0.28);
      g.fill({ color: hex(palette.craterMid), alpha: 0.75 * fade });
      g.ellipse(x + t * 0.03, y + t * 0.03, t * 0.24, t * 0.15);
      g.fill({ color: hex(palette.craterDark), alpha: 0.85 * fade });
    }
  }

  // ------------------------------------------------------------------ the galleon

  /**
   * The galleon at anchor in the corner, rocking on the swell, its sails furled, a lookout in
   * the crow's nest sweeping his spyglass, the black flag at the main. When the clock presses
   * (`hurry`) it rolls quicker, the flag flies harder and the lookout sweeps faster.
   */
  private drawGalleon(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.galleonGfx;
    const spot = this.corner;
    if (spot === null) {
      if (this.galleonKey !== '') clearDrawn(g);
      this.galleonKey = '';
      return;
    }
    const still = motionReduced();
    const quick = hurry(state, this.art);
    const { galleonRollMs, galleonHurriedRollMs } = this.style;
    const period = galleonRollMs + (galleonHurriedRollMs - galleonRollMs) * quick;
    if (!still) this.roll += (deltaMs / period) * Math.PI * 2;
    const s = spot.size * view.tile;
    g.position.set(tileX(view, spot.x), tileY(view, spot.y) + s * 0.22);
    g.rotation = still ? 0 : Math.sin(this.roll) * 0.035;
    // The flag and the spyglass in steps, so the ship is drawn again only a few times a second.
    const flap = still ? 0 : Math.floor(this.clock / (220 - 120 * quick)) % 3;
    const sweep = still ? 0 : Math.round(Math.sin(this.clock / (900 - 600 * quick)) * 4);
    const key = `${viewKey(view)}|${spot.size}|${flap}|${sweep}`;
    if (key === this.galleonKey) return;
    this.galleonKey = key;
    clearDrawn(g);
    drawGalleonShip(g, s, flap, sweep / 4);
  }

  // ------------------------------------------------------------------ territory

  /** Sealed ground as swept sand under a wash of the owner's colour, edged in it. */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.territory.draw(state, view, (g, island) => this.drawSealed(g, island, view));
  }

  private drawSealed(g: Graphics, state: MatchState, view: ViewTransform): void {
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
      // The sand swept pale, then the owner's colour over it: over the jungle's green alone it
      // muddied, as the stadium's wash over its turf did.
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: 0xfff6dc, alpha: 0.5 });
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({ color: this.colour(player, 'light'), alpha: this.style.floorAlpha });
      // Raked in furrows, so it never reads as the shallows: an azure wash over pale sand alone
      // was the reef's own turquoise.
      for (const { x, y } of cells) {
        trace(g, hatch({ x: tileX(view, x), y: tileY(view, y), w: t, h: t }, t * 0.34, '/'));
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: this.colour(player, 'dark'), alpha: 0.28 });
      const edge = outline(cells, owned, view);
      trace(g, edge);
      g.stroke({ width: Math.max(2, t * 0.14), color: this.colour(player, 'base'), alpha: 0.8 });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    this.structures.draw(state, view, (g, island) => this.drawIsland(g, island, view));
  }

  private drawIsland(g: Graphics, state: MatchState, view: ViewTransform): void {
    const t = view.tile;
    const wallAt = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;
    // The guns' platforms first, planks laid across their footprints, under everything.
    for (const cannon of state.cannons) {
      cannonBase(g, view, cannon, DECK, TAR, 0.9);
      for (const f of [1 / 3, 2 / 3]) {
        const y = tileY(view, cannon.y + cannon.h * f);
        g.moveTo(tileX(view, cannon.x + 0.12), y).lineTo(
          tileX(view, cannon.x + cannon.w - 0.12),
          y,
        );
      }
      g.stroke({ width: Math.max(1, t * 0.04), color: WOOD_DARK, alpha: 0.7 });
    }
    for (let owner = 0; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const out = owner === 0 || state.players[owner - 1]?.eliminated !== false;
      this.drawStockade(g, view, cells, (x, y) => wallAt(x, y) === owner, out ? -1 : owner - 1);
    }
  }

  /**
   * Walls as a log stockade: the stakes' sharpened tops stained with the owner's colour, three
   * to a tile, poking up along the open side; the face darker, a rope of the owner's light
   * colour lashed along it, twisted; a shadow on the sand below. A player's who is out, and
   * rubble, grey driftwood.
   */
  private drawStockade(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const t = view.tile;
    const dead = player < 0;
    const top = dead ? DRIFT : mixed(WOOD_TOP, this.colour(player, 'base'), STAIN_TOP);
    const face = dead ? DRIFT_DARK : mixed(WOOD_FACE, this.colour(player, 'dark'), STAIN_FACE);
    const rope = dead ? 0xc8c2b4 : this.colour(player, 'light');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    for (const b of wall.blocks) {
      if (joins(b.x, b.y + 1)) continue;
      g.rect(b.left + t * 0.06, b.top + t + (b.faced ? wall.face : 0) - t * 0.04, t, t * 0.2);
    }
    g.fill({ color: 0x000000, alpha: 0.22 });
    // The stakes' points where nothing stands north of them.
    const tip = t * 0.16;
    for (const b of wall.blocks) {
      if (joins(b.x, b.y - 1)) continue;
      for (let k = 0; k < 3; k++) {
        const a = b.left + (k * t) / 3;
        g.poly([a, b.top + tip * 0.3, a + t / 6, b.top - tip, a + t / 3, b.top + tip * 0.3]);
      }
    }
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: top });
    for (const b of wall.blocks) {
      if (joins(b.x, b.y - 1)) continue;
      for (let k = 0; k < 3; k++) {
        const a = b.left + (k * t) / 3;
        g.poly([a, b.top + tip * 0.3, a + t / 6, b.top - tip, a + t / 3, b.top + tip * 0.3]);
      }
      g.stroke({ width: Math.max(1, t * 0.05), color: TAR, join: 'round' });
    }
    // The seams between stakes, down the tops and the faces.
    for (const b of wall.blocks) {
      for (const k of [1, 2]) {
        const x = b.left + (k * t) / 3;
        g.moveTo(x, b.top).lineTo(x, b.faced ? b.lip + wall.face : b.lip);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.04), color: TAR, alpha: 0.55 });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: face });
    for (const b of wall.blocks) {
      if (!b.faced) continue;
      for (const k of [1, 2]) {
        const x = b.left + (k * t) / 3;
        g.moveTo(x, b.lip).lineTo(x, b.lip + wall.face);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.04), color: TAR, alpha: 0.6 });
    // The rope, lashed along the face, twisted.
    trace(g, wall.strips);
    g.stroke({ width: Math.max(1.5, t * 0.13), color: rope });
    for (const s of wall.strips) {
      for (let x = s.x1 + t * 0.12; x < s.x2; x += t * 0.25) {
        g.moveTo(x - t * 0.05, s.y1 - t * 0.05).lineTo(x + t * 0.05, s.y1 + t * 0.05);
      }
    }
    g.stroke({ width: Math.max(1, t * 0.035), color: TAR, alpha: 0.7 });
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: Math.max(1, t * 0.07), color: TAR, cap: 'square' });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    this.scare(x + 0.5, y + 0.5);
    if (!this.land(x, y) && debris.length === 0) {
      if (!motionReduced()) this.splashes.push({ x, y, age: 0 });
      return;
    }
    this.puff(x + 0.5, y + 0.45, 3, hex(this.art.palette.sand));
    if (debris.length === 0) {
      this.craters.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      const colour = this.timber(block.owner - 1);
      for (let k = 0; k < 6; k++) this.splinter(block.x + 0.5, block.y + 0.4, colour);
      if (motionReduced() || Math.random() >= this.style.coinOdds) continue;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const v = 3 + Math.random() * 2;
      this.coins.push({
        x: block.x + 0.5,
        y: block.y + 0.3,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 1.5,
        age: 0,
        turn: Math.random() * Math.PI,
      });
    }
  }

  /** The stockade's stained timber for a player, or driftwood. */
  private timber(player: number): number {
    const out = player < 0 || this.art.players[player] === undefined;
    return out ? DRIFT : mixed(WOOD_TOP, this.colour(player, 'base'), STAIN_TOP);
  }

  private puff(x: number, y: number, count: number, colour: number, rise = 0.5): void {
    for (let k = 0; k < count; k++) {
      this.thrown.push({
        x: x + (Math.random() - 0.5) * 0.4,
        y,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -rise * (0.8 + Math.random() * 0.6),
        age: 0,
        life: 700 + Math.random() * 300,
        angle: 0,
        spin: 0,
        colour: null,
        puff: colour,
        r: 0.22 + Math.random() * 0.14,
      });
    }
  }

  private splinter(x: number, y: number, colour: number): void {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const v = 2.5 + Math.random() * 3.5;
    this.thrown.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: 600 + Math.random() * 400,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 14,
      colour,
      puff: 0,
      r: 0,
    });
  }

  /** The sweep: a lone stretch of stockade toppling in a puff of sand. */
  noteCrumble(block: Debris): void {
    this.puff(block.x + 0.5, block.y + 0.5, 1, hex(this.art.palette.sand));
    const colour = this.timber(block.owner - 1);
    for (let k = 0; k < 3; k++) this.splinter(block.x + 0.5, block.y + 0.5, colour);
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    const under = this.underGfx;
    clearDrawn(under);
    clearDrawn(this.effectGfx);
    clearDrawn(this.lateGfx);
    this.glow.begin(view.tile);
    perf.begin('flow');
    this.drawCraters(state, view);
    this.drawGalleon(state, view, frame.deltaMs);
    perf.end('flow');
    this.seaLife.draw(under, view, this.art, frame.deltaMs);
    drawDrain(under, view, frame.drain, this.art);
    drawSealGlow(under, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(under, view, frame.deltaMs);
    this.landings.draw(under, view, this.art, frame.deltaMs);
    this.ruins.draw(under, view, state, 0x8a8478, null, frame.deltaMs);
    drawChoices(under, view, frame.choices, this.art);
    this.drawCrabs(state, view, frame.deltaMs);
    this.drawTorches(state, view);
    this.drawForts(state, view, frame);
    this.crowns.draw(view, state, this.art, frame.castleSealed);
    this.drawGuns(state, view, frame.deltaMs);
    this.shadowStamps.begin();
    this.shotStamps.begin();
    this.drawShots(state, view, frame);
    this.shotStamps.end();
    this.shadowStamps.end();
    this.burstStamps.begin();
    this.drawFlashes(view, frame.deltaMs);
    this.drawThrown(view, frame.deltaMs);
    this.burstStamps.end();
    this.drawSplashes(view, frame.deltaMs);
    this.drawCoins(view, frame.deltaMs);
    this.drawClimax(state, view, frame.deltaMs);
    this.winnerBanners.draw(this.lateGfx, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(this.lateGfx, view, this.art, frame.celebrate, frame.deltaMs);
    this.glow.end();
  }

  /**
   * The tiki torches at the corners of sealed ground: a bamboo pole and a flame flickering on
   * its own beat, a warm light round it. Placed again only when the territory changes.
   */
  private drawTorches(state: MatchState, view: ViewTransform): void {
    let key = state.players.length;
    for (let i = 0; i < state.territory.length; i++) {
      const v = state.territory[i] as number;
      if (v !== 0) key = (Math.imul(key, 31) + i * 7 + v) | 0;
    }
    if (key !== this.torchKey) {
      this.torchKey = key;
      this.torches = torchSpots(
        state.territory,
        state.width,
        state.players.length,
        this.style.torchesPerPlayer,
      );
    }
    const t = view.tile;
    const still = motionReduced();
    const pole = this.book.get('torch', t, (k) => {
      k.rect(-t * 0.035, -t * 0.5, t * 0.07, t * 0.5);
      k.fill({ color: BAMBOO });
      k.stroke({ width: Math.max(1, t * 0.025), color: TAR });
      k.poly([-t * 0.09, -t * 0.5, t * 0.09, -t * 0.5, t * 0.06, -t * 0.62, -t * 0.06, -t * 0.62]);
      k.fill({ color: WOOD_DARK });
      k.stroke({ width: Math.max(1, t * 0.025), color: TAR });
    });
    const flame = this.book.get('flame', t, (k) => {
      k.moveTo(0, 0)
        .quadraticCurveTo(t * 0.12, -t * 0.08, 0, -t * 0.3)
        .quadraticCurveTo(-t * 0.12, -t * 0.08, 0, 0);
      k.fill({ color: FLAME });
      k.moveTo(0, 0)
        .quadraticCurveTo(t * 0.06, -t * 0.05, 0, -t * 0.17)
        .quadraticCurveTo(-t * 0.06, -t * 0.05, 0, 0);
      k.fill({ color: FLAME_HOT });
    });
    this.torchStamps.begin();
    for (const [k, c] of this.torches.entries()) {
      if (state.players[c.player]?.eliminated !== false) continue;
      const x = tileX(view, c.x);
      const y = tileY(view, c.y);
      const flick = still ? 1 : 0.85 + 0.15 * Math.sin(this.clock / 80 + k * 1.9);
      this.torchStamps.place(pole, x, y);
      this.torchStamps.place(flame, x, y - t * 0.6, {
        scale: flick,
        scaleY: still ? 1 : flick * (0.95 + 0.1 * Math.sin(this.clock / 53 + k)),
      });
      this.glow.disc(x, y - t * 0.7, t * 0.55 * flick, FLAME, 0.22);
    }
    this.torchStamps.end();
  }

  /**
   * The forts: a timber blockhouse under a roof in the owner's colour, a flagpole on it — and
   * **while sealed the Jolly Roger in the owner's colour flies at its top**, hoisted as a castle
   * is sealed and struck as it is breached (`FlagHoist`), its windows lit. A fort whose player is
   * out stands grey, its pole snapped.
   */
  private drawForts(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const still = motionReduced();
    this.flags.update(frame.castleSealed, this.clock, this.art);
    this.castleStamps.begin();
    for (const castle of state.castles) {
      const player = castle.islandId - 1;
      const out = state.players[player]?.eliminated !== false;
      const level = out ? null : this.flags.raised(castle.id, this.clock, this.art);
      const lit = !out && frame.castleSealed[castle.id] === true;
      const fort = this.book.get(`fort|${out ? -1 : player}|${lit}`, t, (k) =>
        drawFort(
          k,
          t,
          out ? DRIFT : this.colour(player, 'base'),
          out ? DRIFT_DARK : this.colour(player, 'dark'),
          out ? 'out' : lit ? 'lit' : 'dark',
        ),
      );
      const x = tileX(view, castle.x + castle.w / 2);
      const y = tileY(view, castle.y + castle.h) - t * 0.08;
      this.castleStamps.place(fort, x, y);
      if (level === null || level <= 0) continue;
      const wave = still ? 0 : Math.floor((this.clock + castle.id * 133) / 160) % 3;
      const flag = this.book.get(`jolly|${player}|${wave}`, t, (k) =>
        drawFortFlag(k, t, this.colour(player, 'base'), wave),
      );
      // Up the pole from the roof's ridge until its head is at the pole's top.
      const low = y - t * 1.5;
      const high = y - t * 2.1;
      this.castleStamps.place(flag, x, low + (high - low) * level);
    }
    this.castleStamps.end();
  }

  /**
   * The cannon icon: the board's gun, ready, its parrot on it, on a disc of sand: what a gun
   * ready to fire looks like.
   */
  drawCannonIcon(root: Container, size: number, player: number): void {
    const t = (size * ICON_FILL) / 2.2;
    const gun = new Graphics();
    drawCannon(gun, t, this.colour(player, 'base'), this.colour(player, 'dark'), 'live', false);
    const parrot = new Graphics();
    drawParrot(
      parrot,
      t,
      this.colour(player, 'base'),
      this.colour(player, 'dark'),
      this.colour(player, 'light'),
      'perch',
    );
    const at = perchPoint();
    parrot.position.set(at.x * t, at.y * t);
    parrot.scale.set(PARROT_SCALE);
    const box = new Container();
    box.addChild(gun, parrot);
    const b = box.getLocalBounds();
    box.position.set(size / 2 - (b.x + b.width / 2), size / 2 - (b.y + b.height / 2));
    const sand = new Graphics();
    sand.circle(size / 2, size / 2, size * 0.48);
    sand.fill({ color: hex(this.art.palette.sand) });
    sand.stroke({ width: Math.max(1, size * 0.04), color: TAR });
    root.addChild(sand, box);
  }

  /**
   * The guns, ship's cannon on their carriages, facing the target: kicking back as they fire,
   * smoke from the muzzle. A gun ready to fire has its parrot perched on the breech, bobbing; a
   * shot scares it up, and it circles over the gun until the gun is loaded again, then lands.
   * A silenced gun's barrel droops, a plug in its muzzle, and it has no parrot.
   */
  private drawGuns(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const still = motionReduced();
    const { parrotBobMs, parrotTakeOffMs, parrotLandMs } = this.style;
    const perch = perchPoint();
    const muzzle = muzzlePoint();
    this.gunStamps.begin();
    this.parrotStamps.begin();
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      const fresh = aim.firedAgo === 0;
      aim.firedAgo += deltaMs;
      const dir = Math.sin(aim.angle) >= 0 ? 1 : -1;
      const owner = cannon.owner;
      const out = state.players[owner]?.eliminated !== false;
      const pose: GunPose = out || !cannon.active ? 'silenced' : 'live';
      const key = out ? -1 : owner;
      const gun = this.book.get(`gun|${key}|${pose}`, t, (k) =>
        drawCannon(
          k,
          t,
          out ? DRIFT : this.colour(owner, 'base'),
          out ? DRIFT_DARK : this.colour(owner, 'dark'),
          pose,
        ),
      );
      let x = tileX(view, cannon.x + cannon.w / 2);
      const y = tileY(view, cannon.y + cannon.h) - t * 0.35;
      const firing = cannon.active && aim.firedAgo < FIRE_MS && !still;
      if (firing) {
        // Kicked back by the shot, then run out again.
        const q = aim.firedAgo / FIRE_MS;
        x -= dir * t * 0.16 * (q < 0.2 ? q / 0.2 : 1 - (q - 0.2) / 0.8);
      }
      this.gunStamps.place(gun, x, y, { scale: dir, scaleY: 1 });
      if (fresh && cannon.active && !out) {
        const mx = cannon.x + cannon.w / 2 + dir * muzzle.x;
        const my = cannon.y + cannon.h - 0.35 + muzzle.y;
        this.flashes.push({ x: mx + dir * 0.08, y: my, age: 0 });
        if (!still) {
          for (let k = 0; k < 3; k++) {
            this.thrown.push({
              x: mx + dir * 0.1,
              y: my,
              vx: dir * (0.6 + Math.random() * 0.8),
              vy: -0.3 - Math.random() * 0.4,
              age: 0,
              life: 800 + Math.random() * 400,
              angle: 0,
              spin: 0,
              colour: null,
              puff: SMOKE,
              r: 0.18 + Math.random() * 0.12,
            });
          }
        }
      }

      // The parrot, on its gun while the gun is ready, over it while it reloads.
      if (out || !cannon.active) continue;
      const perched = looksLoaded(cannon);
      let seen = this.parrots.get(cannon.id);
      if (seen === undefined) {
        seen = { perched, since: -1e9 };
        this.parrots.set(cannon.id, seen);
      } else if (seen.perched !== perched) {
        seen.perched = perched;
        seen.since = this.clock;
      }
      const flight = still
        ? perched
          ? ({ mode: 'perch' } as const)
          : null
        : parrotFlight(seen.perched, seen.since, this.clock, parrotTakeOffMs, parrotLandMs);
      if (flight === null) continue;
      const px = x + dir * perch.x * t;
      const py = y + perch.y * t;
      // Circling over the gun, a flattened ring, facing the way it flies.
      const ring = (this.clock / 800 + cannon.id * 0.7) * Math.PI;
      const hx = x - dir * t * 0.1 + Math.cos(ring) * t * 0.3;
      const hy = y - t * HOVER_UP + Math.sin(ring) * t * 0.12;
      const flies = Math.sin(ring) >= 0 ? -1 : 1;
      const flapping = Math.floor(this.clock / 110 + cannon.id) % 2 === 0 ? 'up' : 'down';
      const colours = [
        this.colour(owner, 'base'),
        this.colour(owner, 'dark'),
        this.colour(owner, 'light'),
      ] as const;
      const parrot = (p: ParrotPose): GraphicsContext =>
        this.book.get(`parrot|${owner}|${p}`, t, (k) => drawParrot(k, t, ...colours, p));
      if (flight.mode === 'perch') {
        const bob = still
          ? 0
          : Math.max(0, Math.sin(((this.clock + cannon.id * 410) / parrotBobMs) * Math.PI * 2));
        // Now and then it squawks, its beak open.
        const squawk = !still && hash(cannon.id, Math.floor(this.clock / 700), 9340) < 0.08;
        this.parrotStamps.place(parrot(squawk ? 'squawk' : 'perch'), px, py - bob * t * 0.04, {
          scale: dir * PARROT_SCALE,
          scaleY: PARROT_SCALE * (1 - bob * 0.04),
        });
        continue;
      }
      if (flight.mode === 'hover') {
        this.parrotStamps.place(parrot(flapping), hx, hy, {
          scale: flies * dir * PARROT_SCALE,
          scaleY: PARROT_SCALE,
        });
        continue;
      }
      // Taking off from the perch to the ring, or landing back from it, eased.
      const k = flight.k;
      const e = flight.mode === 'takeoff' ? 1 - (1 - k) * (1 - k) : k * k;
      const [ax, ay, bx, by] =
        flight.mode === 'takeoff' ? [px, py - t * 0.2, hx, hy] : [hx, hy, px, py - t * 0.2];
      this.parrotStamps.place(parrot(flapping), ax + (bx - ax) * e, ay + (by - ay) * e, {
        scale: (bx >= ax ? 1 : -1) * PARROT_SCALE,
        scaleY: PARROT_SCALE,
      });
    }
    this.gunStamps.end();
    this.parrotStamps.end();
    this.aims.prune(state);
    if (this.parrots.size > state.cannons.length) {
      const live = new Set(state.cannons.map((c) => c.id));
      for (const id of this.parrots.keys()) if (!live.has(id)) this.parrots.delete(id);
    }
  }

  /** Chain shot: two iron balls on a chain, whirling as they fly, a shadow on the sea below. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    const still = motionReduced();
    const chain = this.book.get('chain', t, (k) => drawChainShot(k, t));
    const shadow = this.book.get('shadow', t, (k) => {
      k.ellipse(0, 0, t * 0.26, t * 0.08);
      k.fill({ color: 0x000000 });
    });
    for (const shot of state.shots) {
      const p = shotProgress(shot, now);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const lift = shotLift(shot, p);
      const high = Math.min(1, lift / 3);
      const scale = (1 + 0.25 * high) * shotScale(shot, this.art);
      this.shadowStamps.place(shadow, gx, gy, { scale: 1 - 0.3 * high, alpha: 0.3 - 0.1 * high });
      const along = Math.atan2(shot.toY - shot.fromY, shot.toX - shot.fromX);
      const turn = still ? along + Math.PI / 2 : now * 0.45 + shot.id;
      this.shotStamps.place(chain, gx, gy - lift * t, { rotation: turn, scale });
      drawShotTarget(this.effectGfx, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** A muzzle's flash, a white-gold star for a moment, and its light. */
  private drawFlashes(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const star = this.book.get('flash', t, (k) => {
      const points: number[] = [];
      for (let n = 0; n < 12; n++) {
        const a = (n / 12) * Math.PI * 2;
        const d = n % 2 === 0 ? t * 0.36 : t * 0.16;
        points.push(Math.cos(a) * d, Math.sin(a) * d);
      }
      k.poly(points);
      k.fill({ color: FLAME_HOT });
    });
    for (const f of this.flashes) {
      f.age += deltaMs;
      const k = f.age / FLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, f.x);
      const y = tileY(view, f.y);
      this.burstStamps.place(star, x, y, { scale: 0.7 + 0.5 * k, alpha: 1 - k });
      this.glow.disc(x, y, view.tile * 0.7, FLAME, 0.35 * (1 - k));
    }
    this.flashes = this.flashes.filter((f) => f.age < FLASH_MS);
  }

  /** Splinters flying in the stockade's stain; puffs of sand and gunsmoke swelling and thinning. */
  private drawThrown(view: ViewTransform, deltaMs: number): void {
    const t = view.tile;
    const splinter = this.book.get('splinter', t, (k) => {
      k.poly([-t * 0.15, -t * 0.03, t * 0.15, -t * 0.05, t * 0.12, t * 0.04, -t * 0.13, t * 0.03]);
      k.fill({ color: 0xffffff });
      k.stroke({ width: Math.max(1, t * 0.03), color: TAR });
    });
    const puff = this.book.get('puff', t, (k) => {
      k.circle(0, 0, t * 0.5);
      k.fill({ color: 0xffffff, alpha: 0.85 });
    });
    const dt = deltaMs / 1000;
    for (const s of this.thrown) {
      s.age += deltaMs;
      if (s.colour === null) {
        s.vx *= Math.exp(-1.2 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      } else {
        s.vy += 8 * dt;
        s.vx *= Math.exp(-1.5 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.angle += s.spin * dt;
      }
      const k = s.age / s.life;
      if (k >= 1) continue;
      if (s.colour === null) {
        this.burstStamps.place(puff, tileX(view, s.x), tileY(view, s.y), {
          scale: (s.r / 0.5) * (0.6 + 1.1 * k),
          alpha: 0.7 * (1 - k),
          tint: s.puff,
        });
      } else {
        this.burstStamps.place(splinter, tileX(view, s.x), tileY(view, s.y), {
          rotation: s.angle,
          alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
          tint: s.colour,
        });
      }
    }
    this.thrown = this.thrown.filter((s) => s.age < s.life);
  }

  /** A shot into the sea: a column of spray thrown up and falling back, a ring spreading. */
  private drawSplashes(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const foam = hex(this.art.palette.waterFoam);
    for (const s of this.splashes) {
      s.age += deltaMs;
      const k = s.age / SPLASH_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x + 0.5);
      const y = tileY(view, s.y + 0.55);
      g.ellipse(x, y, t * (0.25 + 0.6 * k), t * (0.1 + 0.25 * k));
      g.stroke({ width: Math.max(1, t * 0.07), color: foam, alpha: 1 - k });
      const up = Math.sin(Math.min(1, k * 1.4) * Math.PI) * t * 1.1;
      if (up > 1) {
        const w = t * (0.22 - 0.08 * k);
        g.poly([x - w, y, x - w * 0.35, y - up, x + w * 0.35, y - up, x + w, y]);
        g.fill({ color: foam, alpha: 0.85 * (1 - k) });
        g.circle(x, y - up, w * 0.6);
        g.fill({ color: foam, alpha: 0.85 * (1 - k) });
      }
      // Drops falling off its sides.
      for (let n = 0; n < 4; n++) {
        const side = n % 2 === 0 ? -1 : 1;
        const spread = t * (0.25 + 0.5 * k) * (1 + (n >> 1) * 0.4);
        const dy = up * (0.7 - (n >> 1) * 0.25) - k * k * t * 0.6;
        g.circle(x + side * spread, y - Math.max(0, dy), t * 0.06);
      }
      g.fill({ color: foam, alpha: 1 - k });
    }
    this.splashes = this.splashes.filter((s) => s.age < SPLASH_MS);
  }

  /** Doubloons flung from a hit stockade, spinning, falling and glinting as they go. */
  private drawCoins(view: ViewTransform, deltaMs: number): void {
    const g = this.lateGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const c of this.coins) {
      c.age += deltaMs;
      c.vy += 10 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.turn += 12 * dt;
      const k = c.age / COIN_MS;
      if (k >= 1) continue;
      const alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      drawDoubloon(g, tileX(view, c.x), tileY(view, c.y), t * 0.16, c.turn, alpha);
      if (Math.abs(Math.cos(c.turn)) > 0.95) {
        this.glow.disc(tileX(view, c.x), tileY(view, c.y), t * 0.3, DOUBLOON_SHINE, 0.4 * alpha);
      }
    }
    this.coins = this.coins.filter((c) => c.age < COIN_MS);
  }

  // ------------------------------------------------------------------ crabs

  /** A couple of ghost crabs on each island's open sand, set down afresh as the board is. */
  private layoutCrabs(state: MatchState): void {
    this.crabs = [];
    const count = this.style.crabsPerIsland;
    if (count <= 0) return;
    const byIsland = new Map<number, number[]>();
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land || state.structure[i] !== Structure.Empty) continue;
      const id = state.islandId[i] as number;
      const list = byIsland.get(id) ?? [];
      list.push(i);
      byIsland.set(id, list);
    }
    for (const list of byIsland.values()) {
      for (let k = 0; k < count && list.length > 0; k++) {
        const i = list[Math.floor(Math.random() * list.length)] as number;
        const x = (i % state.width) + 0.5;
        const y = Math.floor(i / state.width) + 0.5;
        this.crabs.push({ x, y, tx: x, ty: y, wait: Math.random() * 2000, running: false, dir: 1 });
      }
    }
  }

  /** Whether a crab may stand on a tile: open sand, no wall, gun, fort or sealed ground. */
  private open(state: MatchState, x: number, y: number): boolean {
    if (!this.land(x, y)) return false;
    const i = y * state.width + x;
    return state.structure[i] === Structure.Empty && state.territory[i] === 0;
  }

  /** Every crab near a shot landing runs for it, sideways, away from the blast. */
  private scare(x: number, y: number): void {
    if (this.terrain === null) return;
    for (const c of this.crabs) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d > 3.5) continue;
      const away = c.x >= x ? 1 : -1;
      c.tx = c.x + away * (2 + Math.random() * 2);
      c.ty = c.y + (Math.random() - 0.5);
      c.running = true;
      c.wait = 0;
    }
  }

  /**
   * The crabs: ambling a tile or two sideways now and then, running from shots, and off any
   * tile something has been put on. Under the forts and guns, and never on sealed ground, so
   * none hides anything that counts.
   */
  private drawCrabs(state: MatchState, view: ViewTransform, deltaMs: number): void {
    this.crabStamps.begin();
    if (this.crabs.length === 0 || motionReduced()) {
      this.crabStamps.end();
      return;
    }
    const t = view.tile;
    const dt = deltaMs / 1000;
    // Stamped, a context a step of its legs: drawn afresh each frame, sixteen crabs' discs were
    // most of the vertices rebuilt in a frame at eight players.
    const crabs = [0, 1].map((step) =>
      this.book.get(`crab|${step}`, t, (k) => drawCrab(k, 0, 0, t, step, 1)),
    );
    for (const c of this.crabs) {
      const cx = Math.floor(c.x);
      const cy = Math.floor(c.y);
      // Its tile taken, or its way barred: it picks another way, at a run if it must.
      const tx = Math.floor(c.tx);
      const ty = Math.floor(c.ty);
      if (!this.open(state, tx, ty)) {
        const options: Cell[] = [];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (this.open(state, cx + dx, cy + dy)) options.push({ x: cx + dx, y: cy + dy });
          }
        }
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick === undefined) continue;
        c.tx = pick.x + 0.5;
        c.ty = pick.y + 0.5;
        c.running = !this.open(state, cx, cy);
      }
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        c.running = false;
        c.wait -= deltaMs;
        if (c.wait <= 0) {
          // Off sideways, as crabs go.
          const step = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
          c.tx = c.x + step;
          c.ty = c.y + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0);
          c.wait = 900 + Math.random() * 2600;
        }
      } else {
        const v = (c.running ? this.style.crabTilesPerSecond : 0.7) * dt;
        const k = Math.min(1, v / d);
        c.x += dx * k;
        c.y += dy * k;
        if (Math.abs(dx) > 0.01) c.dir = dx > 0 ? 1 : -1;
      }
      const moving = d >= 0.05;
      const step = moving ? Math.floor(this.clock / (c.running ? 60 : 120)) % 2 : 0;
      this.crabStamps.place(crabs[step] as GraphicsContext, tileX(view, c.x), tileY(view, c.y), {
        scale: c.dir,
        scaleY: 1,
      });
    }
    this.crabStamps.end();
  }

  // ------------------------------------------------------------------ the climax

  /** Where the Kraken's arms rise: spots on the outer ocean round the screen's sides, spread. */
  private layoutArms(state: MatchState, view: ViewTransform): void {
    const ocean = outerOcean(state, view);
    const count = this.style.krakenArms;
    const width = ocean.x1 - ocean.x0;
    const bottom = Math.max(...ocean.cells.map((c) => c.y));
    // In a band a few tiles in from the screen's sides and foot, not so near it is cut off.
    const band = (d: number): boolean => d >= 2 && d < 5;
    // Clear of the galleon, by a couple of tiles all round its square.
    const corner = this.corner;
    const clear = (c: Cell): boolean =>
      corner === null ||
      Math.max(Math.abs(c.x + 0.5 - corner.x), Math.abs(c.y + 0.5 - corner.y)) >
        corner.size / 2 + 2;
    const edge = (c: Cell): boolean =>
      clear(c) &&
      c.y > ocean.y0 + 3 &&
      (band(c.x - ocean.x0) || band(ocean.x1 - c.x) || band(bottom - c.y));
    const cells = ocean.cells.filter(edge);
    this.arms = [];
    if (cells.length === 0 || count <= 0) return;
    const first = cells[Math.floor(hash(this.seed, 1, 9350) * cells.length)] as Cell;
    const chosen = [first];
    while (chosen.length < count) {
      let best: Cell | null = null;
      let far = 2;
      for (const c of cells) {
        const d = Math.min(...chosen.map((o) => Math.hypot(o.x - c.x, o.y - c.y)));
        if (d > far) {
          far = d;
          best = c;
        }
      }
      if (best === null) break;
      chosen.push(best);
    }
    const middle = ocean.x0 + width / 2;
    this.arms = chosen.map((c, k) => ({
      x: c.x + 0.5,
      y: c.y + 0.7,
      // Leaning in, towards the islands.
      lean: (c.x + 0.5 < middle ? 1 : -1) * (0.25 + 0.2 * hash(c.x, c.y, 9351)),
      curl: hash(c.x, c.y, 9352) < 0.5 ? 1 : -1,
      phase: hash(c.x, c.y, 9353) * Math.PI * 2 + k,
      length: 3 + 1.2 * hash(c.x, c.y, 9354),
    }));
  }

  /**
   * The climax (`climaxLevel`): the squall comes in, the sky darkening and rain driving across;
   * and the Kraken rises — its arms coming up out of the outer ocean round the board, curling
   * and swaying, the sea foaming round each. Nothing at level 0.
   */
  private drawClimax(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const level = climaxLevel(state, this.art);
    if (level === 0) {
      this.drops = [];
      return;
    }
    const g = this.lateGfx;
    const t = view.tile;
    const still = motionReduced();
    g.rect(0, view.top, view.width, view.height - view.top);
    g.fill({ color: 0x0a1822, alpha: this.style.squallAlpha * level });
    for (const arm of this.arms) {
      if (!still) arm.phase += (deltaMs / 1000) * (1.1 + 0.6 * level);
      drawArm(g, view, arm, level);
    }
    if (still) return;
    // Rain driving across on the wind, thickening as the squall comes in.
    const want = Math.round(this.style.rainCount * level);
    while (this.drops.length < want) {
      this.drops.push({ x: Math.random() * view.width, y: Math.random() * view.height });
    }
    this.drops.length = want;
    // A long frame, as a snapshot jumps the clock, would send every drop round at once.
    const dt = Math.min(0.05, deltaMs / 1000);
    for (const d of this.drops) {
      d.x -= t * 6 * dt;
      d.y += t * 22 * dt;
      if (d.y > view.height) {
        d.y = view.top + Math.random() * t * 2;
        d.x = Math.random() * view.width * 1.2;
      }
      if (d.x < 0) d.x += view.width;
      if (d.y < view.top) continue;
      g.moveTo(d.x, d.y).lineTo(d.x + t * 0.18, d.y - t * 0.6);
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: 0xd8e8f0, alpha: 0.45 });
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    clearDrawn(g);
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
      // The piece in hand in the owner's colour, roped round in hemp; where it does not fit,
      // grey, its rope shaking — the difference in form, since red is a player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'base') : hex(palette.rockMid),
        alpha: ghost.valid ? 0.55 : 0.45,
      });
      const edge = outline(cells, inPiece, view);
      const shake = ghost.valid ? 0 : Math.sin(now / 30) * t * 0.05;
      const moved = edge.map((s) => ({
        x1: s.x1 + shake,
        y1: s.y1 - shake,
        x2: s.x2 + shake,
        y2: s.y2 - shake,
      }));
      trace(g, moved);
      g.stroke({ width: Math.max(2, t * 0.16), color: TAR, alpha: 0.7 });
      trace(g, moved);
      g.stroke({ width: Math.max(1.5, t * 0.1), color: 0xe8d8a8, alpha: ghost.valid ? 1 : 0.8 });
      // The rope's twist, a tick across it every quarter tile.
      for (const s of moved) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const ux = (s.x2 - s.x1) / len;
        const uy = (s.y2 - s.y1) / len;
        for (let d = t * 0.12; d < len; d += t * 0.25) {
          const cx = s.x1 + ux * d;
          const cy = s.y1 + uy * d;
          const w = t * 0.05;
          g.moveTo(cx - ux * w - uy * w, cy - uy * w + ux * w);
          g.lineTo(cx + ux * w + uy * w, cy + uy * w - ux * w);
        }
      }
      g.stroke({ width: Math.max(1, t * 0.03), color: TAR, alpha: 0.7 });
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      drawCannonGhost(g, view, ghost, colour, Math.max(1.5, t * 0.1));
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

// ------------------------------------------------------------------ figures

type GunPose = 'live' | 'silenced';
type ParrotPose = 'perch' | 'squawk' | 'up' | 'down';
type FortLook = 'lit' | 'dark' | 'out';

/**
 * A ship's cannon facing right, its foot's middle at the origin, `t` a tile: a black iron
 * barrel on a stepped wooden truck carriage painted in the owner's colour, two solid wooden
 * wheels. `silenced`, the barrel droops and a wooden plug stops its muzzle. `grounded` casts its
 * shadow, which the icon leaves out.
 */
function drawCannon(
  g: Graphics,
  t: number,
  body: number,
  dark: number,
  pose: GunPose,
  grounded = true,
): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.05));
  if (grounded) {
    g.ellipse(0, 0, u(0.74), u(0.13));
    g.fill({ color: 0x000000, alpha: 0.22 });
  }
  // The carriage's cheek, stepped down towards the back.
  const cheek = [
    [-0.62, -0.12],
    [0.46, -0.12],
    [0.46, -0.46],
    [0.12, -0.5],
    [0.12, -0.56],
    [-0.24, -0.56],
    [-0.24, -0.47],
    [-0.62, -0.4],
  ].flatMap(([x, y]) => [u(x as number), u(y as number)]);
  g.poly(cheek);
  g.fill({ color: body });
  g.rect(u(-0.62), u(-0.22), u(1.08), u(0.1));
  g.fill({ color: dark });
  g.poly(cheek);
  g.stroke({ width: ink, color: TAR, join: 'round' });
  // The barrel: turned first and then moved, as Cartoon's is.
  const angle = pose === 'silenced' ? DROOP : ELEVATION;
  g.save();
  g.rotateTransform(-angle);
  g.translateTransform(u(PIVOT.x), u(PIVOT.y));
  const barrel = [
    [-0.5, -0.19],
    [0.1, -0.17],
    [0.6, -0.13],
    [0.64, -0.16],
    [MUZZLE, -0.16],
    [MUZZLE, 0.16],
    [0.64, 0.16],
    [0.6, 0.13],
    [0.1, 0.17],
    [-0.5, 0.19],
  ].flatMap(([x, y]) => [u(x as number), u(y as number)]);
  g.circle(u(-0.58), 0, u(0.08));
  g.fill({ color: IRON });
  g.stroke({ width: ink, color: 0x000000 });
  g.poly(barrel);
  g.fill({ color: IRON });
  g.stroke({ width: ink, color: 0x000000, join: 'round' });
  g.moveTo(u(-0.44), -u(0.1)).lineTo(u(0.58), -u(0.07));
  g.stroke({ width: Math.max(1, u(0.05)), color: IRON_LIGHT, cap: 'round' });
  for (const rx of [-0.3, 0.12]) g.moveTo(u(rx), -u(0.18)).lineTo(u(rx), u(0.18));
  g.stroke({ width: Math.max(1, u(0.035)), color: IRON_LIGHT, alpha: 0.8 });
  if (pose === 'silenced') {
    g.ellipse(u(MUZZLE + 0.01), 0, u(0.05), u(0.13));
    g.fill({ color: TAMPION });
    g.stroke({ width: Math.max(1, ink * 0.7), color: TAR });
    g.circle(u(MUZZLE + 0.06), 0, u(0.04));
    g.fill({ color: TAMPION });
  } else {
    g.ellipse(u(MUZZLE), 0, u(0.035), u(0.11));
    g.fill({ color: 0x000000 });
  }
  g.restore();
  // The trunnion's cap, and the wheels in front of everything.
  g.circle(u(PIVOT.x), u(PIVOT.y), u(0.06));
  g.fill({ color: IRON_LIGHT });
  for (const wx of [-0.42, 0.3]) {
    g.circle(u(wx), -u(0.15), u(0.15));
    g.fill({ color: WOOD_DARK });
    g.stroke({ width: ink, color: TAR });
    g.circle(u(wx), -u(0.15), u(0.04));
    g.fill({ color: IRON });
  }
}

/**
 * A parrot in the owner's colour under a black tricorn hat, facing right, `t` a tile. Perched
 * (`perch`, `squawk` with its beak open), its feet at the origin, its tail hanging behind the
 * perch; flying (`up`, `down` its wings' beat), its body's middle at the origin.
 */
function drawParrot(
  g: Graphics,
  t: number,
  body: number,
  wing: number,
  belly: number,
  pose: ParrotPose,
): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.03));
  const line = { width: ink, color: TAR, join: 'round' as const };
  const flying = pose === 'up' || pose === 'down';
  // Head, beak and hat drawn about the head's middle, wherever the body puts it.
  const head = (hx: number, hy: number, open: boolean): void => {
    g.circle(u(hx), u(hy), u(0.11));
    g.fill({ color: body });
    g.stroke(line);
    g.circle(u(hx + 0.045), u(hy), u(0.055));
    g.fill({ color: BONE });
    g.circle(u(hx + 0.05), u(hy - 0.005), u(0.022));
    g.fill({ color: 0x000000 });
    g.poly([
      u(hx + 0.09),
      u(hy - 0.04),
      u(hx + 0.2),
      u(hy + 0.0),
      u(hx + 0.17),
      u(hy + 0.08),
      u(hx + 0.1),
      u(hy + 0.05),
    ]);
    g.fill({ color: HORN });
    g.stroke(line);
    if (open) {
      g.poly([u(hx + 0.09), u(hy + 0.07), u(hx + 0.16), u(hy + 0.12), u(hx + 0.09), u(hy + 0.12)]);
      g.fill({ color: HORN });
      g.stroke(line);
    }
    // The tricorn: a brim turned up in three points, a crown, a little skull on its front.
    g.poly([
      u(hx - 0.16),
      u(hy - 0.07),
      u(hx + 0.15),
      u(hy - 0.08),
      u(hx + 0.09),
      u(hy - 0.13),
      u(hx - 0.0),
      u(hy - 0.11),
      u(hx - 0.1),
      u(hy - 0.14),
    ]);
    g.poly([
      u(hx - 0.08),
      u(hy - 0.1),
      u(hx + 0.08),
      u(hy - 0.11),
      u(hx + 0.05),
      u(hy - 0.22),
      u(hx - 0.05),
      u(hy - 0.22),
    ]);
    g.fill({ color: HAT });
    g.circle(u(hx), u(hy - 0.155), u(0.025));
    g.fill({ color: BONE });
  };
  if (!flying) {
    g.poly([u(-0.04), u(-0.12), u(0.03), u(-0.1), u(-0.08), u(0.2), u(-0.15), u(0.17)]);
    g.fill({ color: wing });
    g.stroke(line);
    g.ellipse(0, u(-0.25), u(0.12), u(0.18));
    g.fill({ color: body });
    g.stroke(line);
    g.ellipse(u(0.045), u(-0.22), u(0.055), u(0.12));
    g.fill({ color: belly });
    g.ellipse(u(-0.04), u(-0.26), u(0.07), u(0.14));
    g.fill({ color: wing });
    g.stroke(line);
    g.moveTo(u(-0.02), u(-0.08)).lineTo(u(-0.03), 0);
    g.moveTo(u(0.04), u(-0.08)).lineTo(u(0.04), 0);
    g.stroke({ width: Math.max(1, u(0.03)), color: 0x55504a, cap: 'round' });
    head(0.03, -0.47, pose === 'squawk');
    return;
  }
  // Flying: the tail streaming back, the body level, the wings beating.
  g.poly([u(-0.14), u(-0.03), u(-0.44), u(0.02), u(-0.42), u(0.08), u(-0.14), u(0.05)]);
  g.fill({ color: wing });
  g.stroke(line);
  const far = pose === 'up' ? [-0.1, -0.36, 0.1, -0.3] : [-0.1, 0.3, 0.1, 0.24];
  g.poly([u(-0.06), u(-0.02), u(far[0]!), u(far[1]!), u(far[2]!), u(far[3]!), u(0.08), 0]);
  g.fill({ color: wing });
  g.stroke(line);
  g.ellipse(0, 0, u(0.2), u(0.1));
  g.fill({ color: body });
  g.stroke(line);
  g.ellipse(u(0.03), u(0.04), u(0.12), u(0.045));
  g.fill({ color: belly });
  head(0.18, -0.08, false);
}

/**
 * A fort, its foot's middle at the origin, `t` a tile: a timber blockhouse of logs laid along
 * it, a plank roof in the owner's colour, a door and two windows — `lit` warm while sealed,
 * dark while open — and a flagpole up from the ridge. `out`, all grey, the pole snapped.
 */
function drawFort(g: Graphics, t: number, roof: number, dark: number, look: FortLook): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, u(0.05));
  const out = look === 'out';
  const logs = out ? DRIFT : 0xa8743e;
  const logsDark = out ? DRIFT_DARK : WOOD_DARK;
  g.ellipse(0, -u(0.02), u(0.95), u(0.16));
  g.fill({ color: 0x000000, alpha: 0.25 });
  // The flagpole first, behind the roof.
  if (out) {
    g.moveTo(0, -u(1.4)).lineTo(u(0.18), -u(1.9));
    g.stroke({ width: Math.max(1.5, u(0.07)), color: DRIFT_DARK, cap: 'round' });
  } else {
    g.moveTo(0, -u(1.4)).lineTo(0, -u(2.6));
    g.stroke({ width: Math.max(1.5, u(0.07)), color: TAR, cap: 'round' });
    g.circle(0, -u(2.62), u(0.06));
    g.fill({ color: 0xc8a050 });
  }
  // The walls of logs, each with a rounded end showing at the corners.
  g.rect(-u(0.78), -u(0.95), u(1.56), u(0.95));
  g.fill({ color: logs });
  for (let k = 1; k < 5; k++) {
    const y = -u(0.95) + (u(0.95) * k) / 5;
    g.moveTo(-u(0.78), y).lineTo(u(0.78), y);
  }
  g.stroke({ width: Math.max(1, u(0.035)), color: logsDark });
  for (let k = 0; k < 5; k++) {
    const y = -u(0.95) + (u(0.95) * (k + 0.5)) / 5;
    for (const side of [-1, 1]) g.circle(side * u(0.8), y, u(0.085));
  }
  g.fill({ color: out ? DRIFT : 0xd8a868 });
  g.rect(-u(0.78), -u(0.95), u(1.56), u(0.95));
  g.stroke({ width: ink, color: TAR });
  // The door and the windows.
  g.roundRect(-u(0.17), -u(0.5), u(0.34), u(0.5), u(0.06));
  g.fill({ color: TAR });
  for (const side of [-1, 1]) g.rect(side * u(0.48) - u(0.1), -u(0.72), u(0.2), u(0.16));
  g.fill({ color: look === 'lit' ? 0xffc860 : 0x1c140c });
  for (const side of [-1, 1]) g.rect(side * u(0.48) - u(0.1), -u(0.72), u(0.2), u(0.16));
  g.stroke({ width: Math.max(1, ink * 0.7), color: TAR });
  // The roof: planks in the owner's colour, overhanging, a dark ridge beam.
  const roofLine = [-0.92, -0.9, 0.92, -0.9, 0.62, -1.42, -0.62, -1.42].map(u);
  g.poly(roofLine);
  g.fill({ color: out ? DRIFT_DARK : roof });
  for (const f of [0.35, 0.68]) {
    const y = -u(0.9) - u(0.52) * f;
    const half = u(0.92) - u(0.3) * f;
    g.moveTo(-half, y).lineTo(half, y);
  }
  g.stroke({ width: Math.max(1, u(0.035)), color: out ? 0x5a564e : dark });
  g.poly(roofLine);
  g.stroke({ width: ink, color: TAR, join: 'round' });
  if (out) {
    // A hole stove in the roof.
    g.poly([-u(0.2), -u(1.1), u(0.1), -u(1.25), u(0.28), -u(1.05), u(0.02), -u(0.98)]);
    g.fill({ color: TAR });
  }
}

/**
 * The Jolly Roger on a fort's pole, its foot of the hoist at the origin and flying to the right:
 * the owner's colour, a skull and crossbones in bone, `wave` one of three steps of its flutter.
 */
function drawFortFlag(g: Graphics, t: number, colour: number, wave: number): void {
  const u = (v: number): number => v * t;
  const w = u(0.72);
  const h = u(0.48);
  const lift = [0, u(0.05), -u(0.04)][wave] ?? 0;
  const cloth = [
    0,
    -h,
    w * 0.5,
    -h - lift,
    w,
    -h + lift * 0.5,
    w,
    lift * 0.5,
    w * 0.5,
    -lift,
    0,
    0,
  ];
  g.poly(cloth);
  g.fill({ color: colour });
  g.poly(cloth);
  g.stroke({ width: Math.max(1, u(0.04)), color: TAR, join: 'round' });
  drawSkullAndBones(g, w * 0.5, -h * 0.55 - lift * 0.4, h * 0.2, BONE, colour);
}

/** Chain shot, its middle at the origin: two iron balls joined by a short chain of links. */
function drawChainShot(g: Graphics, t: number): void {
  const r = t * 0.1;
  const half = t * 0.2;
  for (let k = -1; k <= 1; k++) g.ellipse(k * t * 0.07, 0, t * 0.04, t * 0.025);
  g.stroke({ width: Math.max(1, t * 0.03), color: IRON_LIGHT });
  for (const side of [-1, 1]) {
    g.circle(side * half, 0, r);
    g.fill({ color: IRON });
    g.stroke({ width: Math.max(1, t * 0.03), color: 0x000000 });
    g.circle(side * half - r * 0.3, -r * 0.3, r * 0.3);
    g.fill({ color: IRON_LIGHT, alpha: 0.9 });
  }
}

/** A ghost crab at (x, y), facing `dir`: a pale shell, eyes on stalks, legs in one of two steps. */
function drawCrab(g: Graphics, x: number, y: number, t: number, step: number, dir: 1 | -1): void {
  const s = t * 0.16;
  const w = Math.max(1, t * 0.035);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const lift = (k + step) % 2 === 0 ? -s * 0.25 : s * 0.15;
      g.moveTo(x + side * s * 0.7, y + s * (k - 1) * 0.35).lineTo(
        x + side * s * 1.4,
        y + s * (k - 1) * 0.45 + lift,
      );
    }
  }
  g.stroke({ width: w, color: CRAB_DARK, cap: 'round' });
  for (const side of [-1, 1]) g.circle(x + side * s * 0.9 + dir * s * 0.1, y - s * 0.7, s * 0.3);
  g.fill({ color: CRAB });
  g.ellipse(x, y, s, s * 0.7);
  g.fill({ color: CRAB });
  g.stroke({ width: w, color: CRAB_DARK });
  for (const side of [-1, 1]) g.circle(x + side * s * 0.35, y - s * 0.75, s * 0.16);
  g.fill({ color: 0x1c140c });
}

/**
 * One of the Kraken's arms rising out of the sea at its spot, as far as the climax has come: a
 * tapering limb leaning in towards the islands and curling at its tip, swaying on its own
 * phase, a row of pale suckers along its inside, foam round where it breaks the water.
 */
function drawArm(g: Graphics, view: ViewTransform, arm: Arm, level: number): void {
  const t = view.tile;
  const steps = 16;
  const length = arm.length * level * t;
  const baseX = tileX(view, arm.x);
  const baseY = tileY(view, arm.y);
  const centre: [number, number][] = [];
  let x = baseX;
  let y = baseY;
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    centre.push([x, y]);
    // Rising nearly upright, leaning in a little, curling over only towards its tip.
    const angle =
      arm.lean * (0.3 + 0.5 * s) +
      arm.curl * s * s * s * (2.4 + 0.6 * Math.sin(arm.phase)) +
      0.18 * Math.sin(arm.phase + s * 2.5);
    x += Math.sin(angle) * (length / steps);
    y -= Math.cos(angle) * (length / steps);
  }
  const width = (s: number): number => t * (0.52 * (1 - s) + 0.06);
  const left: number[] = [];
  const right: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const [cx, cy] = centre[k] as [number, number];
    const [nx, ny] = (centre[Math.min(steps, k + 1)] ?? centre[k]) as [number, number];
    const [px, py] = (centre[Math.max(0, k - 1)] ?? centre[k]) as [number, number];
    const dx = nx - px;
    const dy = ny - py;
    const len = Math.hypot(dx, dy) || 1;
    const w = width(k / steps);
    left.push(cx - (dy / len) * w, cy + (dx / len) * w);
    right.unshift(cx + (dy / len) * w, cy - (dx / len) * w);
  }
  g.poly([...left, ...right]);
  g.fill({ color: KRAKEN });
  g.stroke({ width: Math.max(1, t * 0.06), color: KRAKEN_DARK, join: 'round' });
  // The suckers, along the inside of the curl.
  for (let k = 1; k < steps - 2; k += 2) {
    const [cx, cy] = centre[k] as [number, number];
    const [nx, ny] = centre[k + 1] as [number, number];
    const dx = nx - cx;
    const dy = ny - cy;
    const len = Math.hypot(dx, dy) || 1;
    const w = width(k / steps) * 0.55 * arm.curl;
    g.circle(cx + (dy / len) * w, cy - (dx / len) * w, width(k / steps) * 0.28);
  }
  g.fill({ color: SUCKER });
  g.ellipse(baseX, baseY, t * 0.6, t * 0.18);
  g.stroke({ width: Math.max(1, t * 0.08), color: 0xf2fffb, alpha: 0.8 * level });
}

/**
 * The galleon at anchor, its waterline's middle at the origin, `s` its square's side: a dark
 * hull with a gold stripe and a row of gun ports, a raised stern, three masts with their sails
 * furled on the yards, the black flag at the main — `flap` one of three steps of its flutter —
 * and a lookout in the crow's nest, `sweep` his spyglass's swing from -1 to 1. The anchor's
 * cable runs down from the bow.
 */
function drawGalleonShip(g: Graphics, s: number, flap: number, sweep: number): void {
  const u = (v: number): number => v * s;
  const ink = Math.max(1, u(0.012));
  const line = { width: ink, color: TAR, join: 'round' as const };
  // Its reflection and the water round it.
  g.ellipse(0, u(0.02), u(0.48), u(0.06));
  g.fill({ color: 0x0a2a48, alpha: 0.5 });
  g.ellipse(0, u(0.01), u(0.5), u(0.07));
  g.stroke({ width: Math.max(1, u(0.015)), color: 0xf2fffb, alpha: 0.6 });
  // The anchor's cable from the bow.
  g.moveTo(u(0.36), -u(0.1)).lineTo(u(0.5), u(0.03));
  g.stroke({ width: Math.max(1, u(0.012)), color: 0x3a3a3a });
  // The masts and yards, sails furled along them.
  const masts = [
    { x: -0.2, top: -0.62 },
    { x: 0.02, top: -0.78 },
    { x: 0.22, top: -0.6 },
  ];
  for (const m of masts) {
    g.moveTo(u(m.x), -u(0.1)).lineTo(u(m.x), u(m.top));
  }
  g.moveTo(u(0.34), -u(0.16)).lineTo(u(0.56), -u(0.3));
  g.stroke({ width: Math.max(1.5, u(0.02)), color: TAR, cap: 'round' });
  for (const m of masts) {
    for (const f of [0.35, 0.68]) {
      const y = -u(0.1) + (u(m.top) + u(0.1)) * f;
      const half = u(0.13 - f * 0.04);
      g.moveTo(u(m.x) - half, y).lineTo(u(m.x) + half, y);
    }
  }
  g.stroke({ width: Math.max(1, u(0.012)), color: TAR, cap: 'round' });
  for (const m of masts) {
    for (const f of [0.35, 0.68]) {
      const y = -u(0.1) + (u(m.top) + u(0.1)) * f;
      const half = u(0.12 - f * 0.04);
      g.roundRect(u(m.x) - half, y - u(0.005), half * 2, u(0.03), u(0.015));
    }
  }
  g.fill({ color: 0xefe4c8 });
  g.stroke({ width: Math.max(1, ink * 0.7), color: 0x8a7a5a });
  // Rigging from the bowsprit and the stern.
  g.moveTo(u(0.56), -u(0.3)).lineTo(u(0.22), u(-0.6));
  g.moveTo(u(0.56), -u(0.3)).lineTo(u(0.02), u(-0.78));
  g.moveTo(u(-0.42), -u(0.2)).lineTo(u(-0.2), u(-0.62));
  g.stroke({ width: 1, color: TAR, alpha: 0.6 });
  // The black flag at the main.
  const top = -0.78;
  const lift = [0, 0.012, -0.01][flap] ?? 0;
  const fw = u(0.16);
  const fh = u(0.1);
  const fx = u(0.02);
  const fy = u(top);
  g.poly([fx, fy, fx + fw * 0.5, fy - u(lift), fx + fw, fy + u(lift), fx + fw, fy + fh + u(lift)]);
  g.poly([fx, fy, fx + fw, fy + fh + u(lift), fx + fw * 0.5, fy + fh - u(lift), fx, fy + fh]);
  g.fill({ color: 0x16120e });
  drawSkullAndBones(g, fx + fw * 0.5, fy + fh * 0.45, fh * 0.2, BONE, 0x16120e);
  // The crow's nest, the lookout in it and his spyglass.
  const nestY = u(-0.6);
  const sx = u(0.02);
  g.circle(sx, nestY - u(0.035), u(0.022));
  g.fill({ color: 0xd8a878 });
  g.rect(sx - u(0.024), nestY - u(0.065), u(0.048), u(0.014));
  g.fill({ color: 0x16120e });
  const a = -0.2 + sweep * 0.5;
  g.moveTo(sx + u(0.015), nestY - u(0.035)).lineTo(
    sx + u(0.015) + Math.cos(a) * u(0.07),
    nestY - u(0.035) + Math.sin(a) * u(0.07),
  );
  g.stroke({ width: Math.max(1.5, u(0.012)), color: 0xc8a050, cap: 'round' });
  g.poly([
    sx - u(0.05),
    nestY - u(0.015),
    sx + u(0.05),
    nestY - u(0.015),
    sx + u(0.04),
    nestY + u(0.03),
    sx - u(0.04),
    nestY + u(0.03),
  ]);
  g.fill({ color: WOOD_DARK });
  g.stroke(line);
  // The hull: a raised stern at the left, the bow sweeping up at the right.
  const hull = [
    [-0.46, -0.26],
    [-0.28, -0.26],
    [-0.28, -0.17],
    [0.3, -0.17],
    [0.4, -0.22],
    [0.36, -0.08],
    [0.24, 0],
    [-0.36, 0],
    [-0.44, -0.12],
  ].flatMap(([x, y]) => [u(x as number), u(y as number)]);
  g.poly(hull);
  g.fill({ color: 0x5a3820 });
  g.rect(u(-0.42), -u(0.13), u(0.76), u(0.025));
  g.fill({ color: 0xd8a848 });
  for (let k = 0; k < 7; k++) g.rect(u(-0.32 + k * 0.095), -u(0.095), u(0.04), u(0.035));
  g.fill({ color: 0x1c140c });
  g.rect(u(-0.43), -u(0.235), u(0.1), u(0.04));
  g.fill({ color: 0xffd078, alpha: 0.85 });
  g.poly(hull);
  g.stroke(line);
}

// ------------------------------------------------------------------ scenery

/**
 * The cove's scenery, in neutral colours so none of it is a player's: a tree is a palm with
 * coconuts; a pine a taller palm, or one in three a thatched hut; a bush a barrel, or one in four
 * a treasure chest half buried; a rock a pile of cannonballs, one in three an X marked in the
 * sand, one in five a skull.
 */
function drawPiratesScenery(g: Graphics, view: ViewTransform, items: readonly SceneryItem[]): void {
  const t = view.tile;
  const ink = Math.max(1, t * 0.04);
  for (const item of items) {
    const cx = tileX(view, item.x + 0.5);
    const cy = tileY(view, item.y + 0.5);
    if (item.kind === 'tree' || (item.kind === 'pine' && item.variant % 3 !== 0)) {
      const tall = item.kind === 'pine' ? 1.25 : 1;
      const lean = (item.variant % 2 === 0 ? 1 : -1) * t * 0.22;
      drawPalm(g, cx, cy + t * 0.38, t * 0.85 * tall, lean, t, ink);
    } else if (item.kind === 'pine') {
      // A thatched hut on stilts.
      g.ellipse(cx, cy + t * 0.38, t * 0.4, t * 0.08);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.rect(cx - t * 0.28, cy - t * 0.1, t * 0.56, t * 0.42);
      g.fill({ color: 0xa07040 });
      g.stroke({ width: ink, color: TAR });
      g.rect(cx - t * 0.08, cy + t * 0.06, t * 0.16, t * 0.26);
      g.fill({ color: TAR });
      g.poly([cx - t * 0.45, cy - t * 0.05, cx, cy - t * 0.5, cx + t * 0.45, cy - t * 0.05]);
      g.fill({ color: 0xd8b060 });
      g.stroke({ width: ink, color: 0x8a6a30, join: 'round' });
    } else if (item.kind === 'bush' && item.variant % 4 === 0) {
      // A treasure chest, half buried, its lid ajar on a glint of gold.
      g.rect(cx - t * 0.3, cy - t * 0.05, t * 0.6, t * 0.3);
      g.fill({ color: 0x8a5a30 });
      g.stroke({ width: ink, color: TAR });
      g.poly([
        cx - t * 0.3,
        cy - t * 0.05,
        cx - t * 0.26,
        cy - t * 0.28,
        cx + t * 0.26,
        cy - t * 0.32,
        cx + t * 0.3,
        cy - t * 0.07,
      ]);
      g.fill({ color: 0x9a6a3a });
      g.stroke({ width: ink, color: TAR, join: 'round' });
      g.rect(cx - t * 0.26, cy - t * 0.07, t * 0.52, t * 0.04);
      g.fill({ color: 0xf0c048 });
      g.rect(cx - t * 0.04, cy - t * 0.04, t * 0.08, t * 0.1);
      g.fill({ color: 0xc8a050 });
      g.ellipse(cx, cy + t * 0.25, t * 0.38, t * 0.07);
      g.fill({ color: 0xf1dfab });
    } else if (item.kind === 'bush') {
      // A barrel, hooped in iron.
      g.ellipse(cx, cy + t * 0.3, t * 0.24, t * 0.06);
      g.fill({ color: 0x000000, alpha: 0.2 });
      g.roundRect(cx - t * 0.2, cy - t * 0.3, t * 0.4, t * 0.58, t * 0.1);
      g.fill({ color: 0x9a6a3a });
      g.stroke({ width: ink, color: TAR });
      for (const f of [-0.18, 0.16]) g.rect(cx - t * 0.2, cy + f * t, t * 0.4, t * 0.05);
      g.fill({ color: 0x4a4a50 });
      g.ellipse(cx, cy - t * 0.28, t * 0.17, t * 0.05);
      g.fill({ color: 0xb88a56 });
    } else if (item.variant % 5 === 0) {
      // A skull in the sand, more silly than grim.
      g.circle(cx, cy, t * 0.14);
      g.rect(cx - t * 0.08, cy + t * 0.06, t * 0.16, t * 0.09);
      g.fill({ color: BONE });
      g.stroke({ width: ink, color: 0x8a7a5a });
      g.circle(cx - t * 0.05, cy, t * 0.035);
      g.circle(cx + t * 0.05, cy, t * 0.035);
      g.fill({ color: TAR });
    } else if (item.variant % 3 === 0) {
      // X marks the spot.
      const r = t * 0.22;
      g.moveTo(cx - r, cy - r).lineTo(cx + r, cy + r);
      g.moveTo(cx + r, cy - r).lineTo(cx - r, cy + r);
      g.stroke({ width: Math.max(2, t * 0.09), color: 0x5a3418, cap: 'round' });
    } else {
      // A pile of cannonballs.
      for (const [ox, oy] of [
        [-0.15, 0.12],
        [0.15, 0.12],
        [0, -0.1],
      ] as const) {
        g.circle(cx + ox * t, cy + oy * t, t * 0.14);
        g.fill({ color: IRON });
        g.stroke({ width: ink, color: 0x000000 });
        g.circle(cx + (ox - 0.04) * t, cy + (oy - 0.04) * t, t * 0.04);
        g.fill({ color: IRON_LIGHT });
      }
    }
  }
}

/** A palm from its foot at (x, y), `h` tall, its top leaning `lean`: a ringed trunk, fronds, nuts. */
function drawPalm(
  g: Graphics,
  x: number,
  y: number,
  h: number,
  lean: number,
  t: number,
  ink: number,
): void {
  g.ellipse(x + lean * 0.6, y, t * 0.3, t * 0.07);
  g.fill({ color: 0x000000, alpha: 0.18 });
  const topX = x + lean;
  const topY = y - h;
  g.moveTo(x, y).quadraticCurveTo(x + lean * 0.1, y - h * 0.6, topX, topY);
  g.stroke({ width: Math.max(2, t * 0.12), color: 0x6a4a28, cap: 'round' });
  g.moveTo(x, y).quadraticCurveTo(x + lean * 0.1, y - h * 0.6, topX, topY);
  g.stroke({ width: Math.max(1, t * 0.07), color: 0xa88054, cap: 'round' });
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.75;
    const len = t * (0.42 + (k % 2) * 0.08);
    const ex = topX + Math.cos(a) * len;
    const ey = topY + Math.sin(a) * len * 0.6 + len * 0.35;
    const mx = topX + Math.cos(a) * len * 0.5;
    const my = topY + Math.sin(a) * len * 0.5 - t * 0.06;
    g.moveTo(topX, topY)
      .quadraticCurveTo(mx - t * 0.06, my - t * 0.04, ex, ey)
      .quadraticCurveTo(mx + t * 0.06, my + t * 0.06, topX, topY);
  }
  g.fill({ color: 0x3a8a3a });
  g.stroke({ width: ink, color: 0x1e5a24, join: 'round' });
  for (const ox of [-0.06, 0.05]) g.circle(topX + ox * t, topY + t * 0.06, t * 0.06);
  g.fill({ color: 0x5a3a1c });
}
