import type { ArtConfig, OperaStyleConfig } from '@bollwerk/config';
import { Structure, Terrain, type Castle, type MatchState, type Shot } from '@bollwerk/sim';
import { Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { inFinalRound } from '../scores.js';
import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { hash } from './chocolate.js';
import { GOLD, drawLyre, drawQuaver, drawRest } from './music.js';
import { roseSpot } from './parchment.js';
import { OperaSeaLife } from './seaLife.js';
import type { SceneryItem } from './scenery.js';
import { SceneryLayer } from './sceneryLayer.js';
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
  playerColour,
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
} from './theme.js';
import { outline, trace, wallGeometry } from './walls.js';

/** Something with a place and an age: rings of sound, a sour note, a chord, a glissando. */
interface Aged {
  x: number;
  y: number;
  age: number;
  owner: number;
}

/** A note riding a stave on the sea: along it, which stave, and where on the stave. */
interface Rider {
  x: number;
  stave: number;
  step: number;
  flags: number;
}

/** A key knocked out of a wall, flying and falling, in tiles. */
interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  floor: number;
  colour: number;
  angle: number;
  spin: number;
  black: boolean;
}

/** Where a shot came down on the stage: a blot of ink, as on a smudged score. */
interface Blot {
  x: number;
  y: number;
  round: number;
}

/** A note rising from a house while it plays, by the house and its age. */
interface Rising {
  castle: number;
  age: number;
  dx: number;
  flags: number;
}

/** An opera house on a castle's tiles: where its parts stand on screen. */
interface House {
  cx: number;
  foot: number;
  W: number;
  /** The top of the facade, where the dome sits, and the top of the dome. */
  cornice: number;
  domeTop: number;
  windows: { x: number; y: number; w: number; h: number }[];
}

const RECOIL_MS = 200;
const RING_MS = 1000;
const SOUR_MS = 1100;
const CHORD_MS = 700;
const GLISS_MS = 1000;
const RISE_MS = 2200;

/** Polished black for the black keys and the piano; ivory; graphite for the sketch. */
const EBONY = 0x16141a;
const IVORY = 0xf3eee2;
const GRAPHITE = 0x4a4a55;
const PAPER = 0xf6efdc;
const BRASS = 0xe0b84a;
const BRASS_DARK = 0x8a6a1a;

/** How Opera sends off the winners (PLAN 11.19 Z4). */
const FINISH: FinishLook = { spark: 'roses', flag: 'lyre' };

/** A colour between two, `t` of the way from the first. */
function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  const m = (s: number): number => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** Whether the keys either side of a seam after key `n` have a black key between them. */
function blackAfter(n: number): boolean {
  const k = ((n % 7) + 7) % 7;
  // C D E F G A B: there is no black key between E and F, or between B and C.
  return k !== 2 && k !== 6;
}

/**
 * The Opera look, for either look: a night at the opera, built of music itself. The sea is
 * midnight blue, and its waves are staves — five gold lines swelling across the water, notes
 * riding them as the melody runs on; every coast is the gilded edge of a stage with its
 * footlights lit, and the land a polished stage floor. A conductor stands on his podium in
 * the corner Parchment gives its compass rose, beating time. Walls are piano keys in the
 * owner's colour, the black keys in their true pattern across the seams; castles are opera
 * houses with domes in the owner's colour, and sealed is the house playing — its windows lit
 * and notes rising from its dome; a breach stops the music, a rest where the notes were.
 * Sealed ground is a page of the score, ruled in the owner's colour, a melody written on it.
 * Guns are brass horns, muted when silenced; shots are notes. A hit on a wall knocks a key
 * out with a sour note; the sweep runs off in a glissando; a piece set down lands as a
 * chord. In the finale — overtime and the final round — the staves swell and spotlights
 * sweep the board.
 */
export class OperaTheme implements Theme {
  readonly id = 'opera' as const;

  private art!: ArtConfig;
  private style!: OperaStyleConfig;
  /** Life on the outer sea (`seaLife.ts`). */
  private readonly seaLife = new OperaSeaLife();

  private readonly terrainGfx = new Graphics();
  /** The staves and their notes, the conductor, the blots: redrawn each frame. */
  private readonly flowGfx = new Graphics();
  private readonly territoryGfx = new Graphics();
  private readonly ghostMotion = new GhostMotion();
  private readonly ruins = new RuinSmoke();
  private readonly scenery = new SceneryLayer(
    (g, view, items) => drawOperaScenery(g, view, items, this.art),
    () => PAPER,
  );
  private readonly structureGfx = new Graphics();
  private readonly effectGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private terrain: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private round = 0;
  /** How far each tile of the sheet is from land, for keeping the staves off the coast. */
  private depth: Int8Array = new Int8Array(0);
  private sheet = { x0: 0, y0: 0, w: 0, h: 0 };
  private riders: Rider[] = [];
  private conductor: TimerSpot | null = null;
  /** The conductor's beat so far, in crotchets, so a change of tempo never jumps his arm. */
  private beats = 0;
  private blots: Blot[] = [];
  private rings: Aged[] = [];
  private sours: Aged[] = [];
  private chords: Aged[] = [];
  private glisses: Aged[] = [];
  private bits: Bit[] = [];
  private rising: Rising[] = [];
  private sinceNote = new Map<number, number>();
  private readonly aims = new GunAims();
  private readonly fireworks = new Fireworks(FINISH);
  private readonly winnerBanners = new WinnerBanners(FINISH);
  /** The houses playing, raised as a flag is: by sealing, and silenced by a breach. */
  private readonly playing = new FlagHoist();
  private clock = 0;

  constructor(private readonly seed = 1) {}

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.opera;
    layers.terrain.addChild(this.terrainGfx, this.flowGfx);
    layers.territory.addChild(this.scenery.gfx, this.territoryGfx);
    layers.structures.addChild(this.structureGfx);
    layers.effects.addChild(this.effectGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    this.scenery.destroy();
    for (const g of [
      this.terrainGfx,
      this.flowGfx,
      this.territoryGfx,
      this.structureGfx,
      this.effectGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  private ink(view: ViewTransform): number {
    return Math.max(1, view.tile * 0.07);
  }

  private get dark(): number {
    return hex(this.art.palette.shadow);
  }

  private land(x: number, y: number): boolean {
    return (
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      this.terrain[y * this.width + x] === Terrain.Land
    );
  }

  /** Open water, well off any coast, where a stave may run. */
  private open(x: number, y: number): boolean {
    const { x0, y0, w, h } = this.sheet;
    const lx = Math.floor(x) - x0;
    const ly = Math.floor(y) - y0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) return true;
    const d = this.depth[ly * w + lx]!;
    return d < 0 || d >= 2;
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

    // The night sea runs out past the board to the window's edge, a little lighter near the
    // stages, in overlapping rounds so it curves with the coast.
    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const x0 = -marginX;
    const y0 = -marginY;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    this.sheet = { x0, y0, w, h };
    const depth = new Int8Array(w * h).fill(-1);
    const queue: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!land(x + x0, y + y0)) continue;
        depth[y * w + x] = 0;
        queue.push(y * w + x);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const d = depth[i]!;
      if (d >= 4) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || depth[ny * w + nx] !== -1) continue;
        depth[ny * w + nx] = d + 1;
        queue.push(ny * w + nx);
      }
    }
    this.depth = depth;
    const bands = [
      hex(palette.waterShallow),
      mix(hex(palette.waterShallow), hex(palette.waterMid), 0.5),
      hex(palette.waterMid),
      hex(palette.waterDeep),
    ];
    g.rect(tileX(view, x0), tileY(view, y0), w * t, h * t);
    g.fill({ color: bands[3]! });
    for (let band = 2; band >= 0; band--) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (depth[y * w + x] !== band + 1) continue;
          g.circle(tileX(view, x + x0 + 0.5), tileY(view, y + y0 + 0.5), t * 0.8);
        }
      }
      g.fill({ color: bands[band]! });
    }
    // A few stars caught in the water.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (depth[y * w + x] === 0 || hash(x + x0, y + y0, 500) > 0.02) continue;
        g.circle(
          tileX(view, x + x0 + hash(x, y, 501)),
          tileY(view, y + y0 + hash(x, y, 502)),
          Math.max(1, t * 0.05),
        );
      }
    }
    g.fill({ color: 0xfff4d0, alpha: 0.6 });

    // The stage: polished boards, their joints staggered.
    const ground: Cell[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) if (land(x, y)) ground.push({ x, y });
    }
    for (const { x, y } of ground) g.rect(tileX(view, x), tileY(view, y), t, t);
    g.fill({ color: hex(palette.grassMid) });
    for (const { x, y } of ground) {
      if (hash(x, y, 1) < 0.3) g.rect(tileX(view, x), tileY(view, y), t, t);
    }
    g.fill({ color: hex(palette.grassLight), alpha: 0.25 });
    for (const { x, y } of ground) {
      const left = tileX(view, x);
      const top = tileY(view, y);
      for (const f of [0.25, 0.5, 0.75, 1])
        g.moveTo(left, top + t * f).lineTo(left + t, top + t * f);
      for (let k = 0; k < 4; k++) {
        const jx = left + t * (((hash(x, y * 4 + k, 510) * 4) % 1) * 0.9 + 0.05);
        g.moveTo(jx, top + t * k * 0.25).lineTo(jx, top + t * (k + 1) * 0.25);
      }
    }
    g.stroke({ width: 1, color: hex(palette.grassDark), alpha: 0.45 });
    // A faint tint of the owner over each island, as the other styles give.
    for (let player = 1; player <= state.players.length; player++) {
      let any = false;
      for (const { x, y } of ground) {
        if (state.islandId[y * state.width + x] !== player) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
        any = true;
      }
      if (any) g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.07 });
    }

    // The stage's gilded edge, and its footlights along every coast.
    const coast = outline(ground, land, view);
    trace(g, coast);
    g.stroke({ width: t * 0.34, color: hex(palette.sand), cap: 'square' });
    trace(g, coast);
    g.stroke({ width: 1, color: this.dark, alpha: 0.6, cap: 'square' });
    const lamps: { x: number; y: number }[] = [];
    for (const [n, s] of coast.entries()) {
      if (n % 2 !== 0) continue;
      lamps.push({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
    }
    for (const l of lamps) g.circle(l.x, l.y, t * 0.45);
    g.fill({ color: hex(palette.emberMid), alpha: 0.1 });
    for (const l of lamps) g.circle(l.x, l.y, t * 0.09);
    g.fill({ color: hex(palette.emberHot) });

    // The conductor's place, in the corner the compass rose takes in Parchment.
    const right = Math.floor((view.width - view.originX) / t) - state.width;
    const bottom = Math.floor((view.height - view.originY) / t) - state.height;
    this.conductor = roseSpot(state, right, bottom, timerSpot(state));
    this.seaLife.conductor = this.conductor;
    this.seaLife.layout(state, view, this.art);
    this.layoutRiders();
  }

  private layoutRiders(): void {
    const { x0, w, h } = this.sheet;
    const staves = Math.ceil(h / this.style.staveEveryTiles) + 1;
    const count = Math.min(90, Math.floor((w * h) / this.style.noteTiles));
    this.riders = [];
    for (let k = 0; k < count; k++) {
      this.riders.push({
        x: x0 + w * hash(k, this.seed, 520),
        stave: Math.floor(staves * hash(k, this.seed, 521)),
        step: Math.floor(9 * hash(k, this.seed, 522)),
        flags: Math.floor(3 * hash(k, this.seed, 523)),
      });
    }
  }

  // ------------------------------------------------------------------ the sea, moving

  /** Where stave `n`'s top line runs at `x`, in tiles, as the waves stand now. */
  private staveY(n: number, x: number, finale: boolean): number {
    const s = this.style;
    const amp = s.staveAmplitudeTiles * (finale ? 1.7 : 1);
    const speed = s.staveTilesPerSecond * (finale ? 1.6 : 1);
    const phase = motionReduced() ? 0 : (this.clock / 1000) * speed;
    return (
      this.sheet.y0 +
      1.5 +
      n * s.staveEveryTiles +
      amp * Math.sin(((x - phase) / s.staveWavelengthTiles) * Math.PI * 2 + n * 1.3)
    );
  }

  /**
   * Each frame, under everything: the staves swelling across the sea, the notes riding them,
   * the blots of ink, and the conductor beating time.
   */
  private drawFlow(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.flowGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    const still = motionReduced();
    const finale = (state.phase === 'build' && state.overtime) || inFinalRound(state);

    // Ink where a shot came down on the stage, fading over the rounds after.
    const rounds = this.art.generators.fx.craterRounds;
    this.blots = this.blots.filter((b) => state.round - b.round < rounds);
    for (const b of this.blots) {
      const fade = 1 - (state.round - b.round) / rounds;
      const cx = tileX(view, b.x + 0.5);
      const cy = tileY(view, b.y + 0.5);
      g.circle(cx, cy, t * 0.3);
      for (let k = 0; k < 4; k++) {
        const a = hash(b.x + k, b.y, 530) * Math.PI * 2;
        g.circle(cx + Math.cos(a) * t * 0.36, cy + Math.sin(a) * t * 0.36, t * 0.07);
      }
      g.fill({ color: this.dark, alpha: 0.6 * fade });
    }

    // The staves: five lines each, following the swell, broken off short of every coast.
    const { x0, w, h } = this.sheet;
    const staves = Math.ceil(h / this.style.staveEveryTiles) + 1;
    const step = 0.5;
    for (let n = 0; n < staves; n++) {
      for (let line = 0; line < 5; line++) {
        let drawing = false;
        for (let x = x0; x <= x0 + w; x += step) {
          const y = this.staveY(n, x, finale) + line * 0.2;
          const ok = this.open(x, y);
          if (ok && drawing) g.lineTo(tileX(view, x), tileY(view, y));
          else if (ok) g.moveTo(tileX(view, x), tileY(view, y));
          drawing = ok;
        }
      }
    }
    g.stroke({ width: 1, color: hex(palette.waterFoam), alpha: 0.32 });
    // The notes riding them, running on with the melody.
    const run = still ? 0 : (this.style.staveTilesPerSecond * (finale ? 1.6 : 1) * deltaMs) / 1000;
    for (const r of this.riders) {
      r.x += run;
      if (r.x > x0 + w) r.x -= w;
      const y = this.staveY(r.stave, r.x, finale) + r.step * 0.1 + 0.05;
      if (!this.open(r.x, y)) continue;
      drawQuaver(
        g,
        tileX(view, r.x),
        tileY(view, y),
        t * 0.6,
        hex(palette.waterFoam),
        0.75,
        r.flags,
      );
    }

    if (this.conductor !== null) this.drawConductor(g, state, view, this.conductor, deltaMs);
  }

  /**
   * The conductor, seen from the orchestra: on his podium, tailcoat and a shock of white hair,
   * his baton beating time in four — down, in, out, up — quicker over a phase's last seconds
   * and in overtime.
   */
  private drawConductor(
    g: Graphics,
    state: MatchState,
    view: ViewTransform,
    spot: TimerSpot,
    deltaMs: number,
  ): void {
    const t = view.tile;
    const s = spot.size * t;
    const cx = tileX(view, spot.x);
    const base = tileY(view, spot.y) + s * 0.38;
    const left = (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz;
    const hurried = (state.phase === 'build' && state.overtime) || left < 5;
    const beatMs = hurried ? this.style.hurriedBeatMs : this.style.beatMs;
    if (!motionReduced()) this.beats += deltaMs / beatMs;
    // The podium.
    g.rect(cx - s * 0.28, base - s * 0.12, s * 0.56, s * 0.12);
    g.fill({ color: 0x4a2c18 });
    g.rect(cx - s * 0.28, base - s * 0.12, s * 0.56, s * 0.025);
    g.fill({ color: GOLD });
    // Legs, the tailcoat with its tails, shoulders.
    const hip = base - s * 0.12;
    g.moveTo(cx - s * 0.05, hip).lineTo(cx - s * 0.06, hip - s * 0.16);
    g.moveTo(cx + s * 0.05, hip).lineTo(cx + s * 0.06, hip - s * 0.16);
    g.stroke({ width: Math.max(1.5, s * 0.05), color: 0x111018 });
    const shoulder = hip - s * 0.42;
    g.poly([
      cx - s * 0.11,
      shoulder,
      cx + s * 0.11,
      shoulder,
      cx + s * 0.1,
      hip - s * 0.18,
      cx + s * 0.13,
      hip - s * 0.04,
      cx + s * 0.02,
      hip - s * 0.14,
      cx - s * 0.02,
      hip - s * 0.14,
      cx - s * 0.13,
      hip - s * 0.04,
      cx - s * 0.1,
      hip - s * 0.18,
    ]);
    g.fill({ color: 0x15141c });
    // The beat: where the baton hand is in the pattern of four, easing between beats.
    const pattern: [number, number][] = [
      [0.08, -0.02],
      [-0.12, -0.12],
      [0.28, -0.12],
      [0.12, -0.36],
    ];
    const beat = Math.floor(this.beats) % 4;
    const frac = this.beats - Math.floor(this.beats);
    const ease = frac < 0.5 ? 2 * frac * frac : 1 - 2 * (1 - frac) * (1 - frac);
    const [ax, ay] = pattern[beat]!;
    const [bx, by] = pattern[(beat + 1) % 4]!;
    const hx = cx + s * (ax + (bx - ax) * ease);
    const hy = shoulder + s * (ay + (by - ay) * ease) + s * 0.1;
    // The left hand marks the beat less, mirrored.
    const lx = cx - s * (0.18 + 0.06 * Math.sin(this.beats * Math.PI));
    const ly = shoulder + s * (0.02 - 0.08 * Math.abs(Math.sin(this.beats * Math.PI)));
    g.moveTo(cx + s * 0.09, shoulder + s * 0.02).lineTo(hx, hy);
    g.moveTo(cx - s * 0.09, shoulder + s * 0.02).lineTo(lx, ly);
    g.stroke({ width: Math.max(1.5, s * 0.055), color: 0x15141c, cap: 'round' });
    for (const [x, y] of [
      [hx, hy],
      [lx, ly],
    ] as const) {
      g.circle(x, y, s * 0.025);
    }
    g.fill({ color: 0xf2d0b0 });
    // The baton, pointing on out from the hand.
    const ox = hx - (cx + s * 0.09);
    const oy = hy - (shoulder + s * 0.02);
    const len = Math.hypot(ox, oy) || 1;
    g.moveTo(hx, hy).lineTo(hx + (ox / len) * s * 0.16, hy + (oy / len) * s * 0.16);
    g.stroke({ width: Math.max(1, s * 0.015), color: 0xffffff, cap: 'round' });
    // His head, from behind: a collar, and white hair flying.
    g.rect(cx - s * 0.035, shoulder - s * 0.03, s * 0.07, s * 0.04);
    g.fill({ color: 0xffffff });
    for (const [dx, dy, r] of [
      [0, -0.1, 0.075],
      [-0.06, -0.08, 0.05],
      [0.06, -0.08, 0.05],
      [-0.04, -0.15, 0.05],
      [0.05, -0.15, 0.045],
    ] as const) {
      g.circle(cx + s * dx, shoulder + s * dy, s * r);
    }
    g.fill({ color: 0xeeeef2 });
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a page of the score: paper ruled in staves of the owner's colour, bar
   * lines across them and a melody written in — every stave on one lattice, so neighbouring
   * tiles make one page; edged in the owner's colour.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.territoryGfx;
    g.clear();
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
      g.fill({ color: PAPER, alpha: this.style.territoryAlpha });
      // A stave every two rows: four of its lines in the first, its last in the second.
      for (const { x, y } of cells) {
        const offsets = y % 2 === 0 ? [0.35, 0.55, 0.75, 0.95] : [0.15];
        for (const f of offsets) {
          g.moveTo(tileX(view, x), tileY(view, y + f)).lineTo(
            tileX(view, x + 1),
            tileY(view, y + f),
          );
        }
      }
      g.stroke({ width: 1, color: this.colour(player, 'base'), alpha: 0.6 });
      for (const { x, y } of cells) {
        if (y % 2 !== 0 || x % 4 !== 0) continue;
        g.moveTo(tileX(view, x), tileY(view, y + 0.35)).lineTo(
          tileX(view, x),
          tileY(view, y + 1.15),
        );
      }
      g.stroke({ width: 1, color: this.colour(player, 'dark'), alpha: 0.6 });
      for (const { x, y } of cells) {
        if (y % 2 !== 0 || hash(x, y, 540) > 0.45) continue;
        const stepOn = Math.floor(hash(x, y, 541) * 7);
        drawQuaver(
          g,
          tileX(view, x + 0.45),
          tileY(view, y + 0.45 + stepOn * 0.1),
          t * 0.5,
          this.colour(player, 'dark'),
          0.85,
          Math.floor(hash(x, y, 542) * 3),
        );
      }
      trace(g, outline(cells, owned, view));
      g.stroke({ width: Math.max(1.5, t * 0.1), color: this.colour(player, 'base'), alpha: 0.95 });
    }
    dimEliminated(g, state, view, this.dark);
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    this.scenery.refresh(state, view, this.art);
    const g = this.structureGfx;
    g.clear();
    const t = view.tile;
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
      this.drawKeys(g, view, cells, (x, y) => wallAt(x, y) === owner, owner - 1);
    }

    for (const castle of state.castles) this.drawHouse(g, view, castle);

    // Guns: a round stand in the owner's colour on three legs; the horn on it is drawn with
    // the effects, turned to its target.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = Math.min(cannon.w, cannon.h) * t * 0.38;
      for (const a of [Math.PI * 0.6, Math.PI * 0.4, Math.PI * 1.5]) {
        g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8);
      }
      g.stroke({ width: Math.max(1.5, t * 0.07), color: 0x2a2228, cap: 'round' });
      g.circle(cx, cy, r * 0.55);
      g.fill({ color: this.colour(cannon.owner, cannon.active ? 'base' : 'dark') });
      g.stroke({ width: Math.max(1, t * 0.05), color: GOLD });
    }
  }

  /**
   * Walls as piano keys: each block a key in the owner's colour, polished along its top, the
   * black keys across the seams in a keyboard's true pattern — none between E and F, or B
   * and C — so a run reads as a keyboard whichever way it goes; standing to the shared height.
   * A player's who is out (`player` -1) has keys gone grey and dusty, a broken string curling
   * off one here and there.
   */
  private drawKeys(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const dead = player < 0;
    const key = dead ? hex(palette.rockMid) : this.colour(player, 'base');
    const keyLight = dead ? hex(palette.rockLight) : this.colour(player, 'light');
    const keyDark = dead ? hex(palette.rockDark) : this.colour(player, 'dark');
    const wall = wallGeometry(cells, joins, view, this.faceFraction());

    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: key });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: keyDark });
    // The polish along each key.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      g.rect(b.left + t * 0.12, b.top + h * 0.1, t * 0.18, h * 0.8);
    }
    g.fill({ color: keyLight, alpha: 0.5 });
    // The gaps between keys.
    for (const b of wall.blocks)
      g.rect(b.left, b.top, t, b.lip - b.top + (b.faced ? wall.face : 0));
    g.stroke({ width: 1, color: this.dark, alpha: 0.75 });
    // The black keys, across the seams: along a row at the back of the keys, down a column
    // at their left.
    for (const b of wall.blocks) {
      const h = b.lip - b.top;
      if (joins(b.x + 1, b.y) && blackAfter(b.x)) {
        g.roundRect(b.left + t * 0.84, b.top, t * 0.32, h * 0.5, t * 0.05);
      }
      const column = !joins(b.x + 1, b.y) && !joins(b.x - 1, b.y);
      if (column && joins(b.x, b.y + 1) && blackAfter(b.y)) {
        g.roundRect(b.left, b.top + t * 0.84, t * 0.5, t * 0.32, t * 0.05);
      }
    }
    g.fill({ color: dead ? hex(palette.rockDark) : EBONY });
    for (const b of wall.blocks) {
      if (joins(b.x + 1, b.y) && blackAfter(b.x)) {
        g.rect(b.left + t * 0.88, b.top + 1, t * 0.06, (b.lip - b.top) * 0.4);
      }
      const column = !joins(b.x + 1, b.y) && !joins(b.x - 1, b.y);
      if (column && joins(b.x, b.y + 1) && blackAfter(b.y)) {
        g.rect(b.left + 1, b.top + t * 0.88, t * 0.4, t * 0.06);
      }
    }
    g.fill({ color: 0xffffff, alpha: 0.18 });
    if (dead) {
      // Dust, and a broken string curling off a key or two.
      for (const b of wall.blocks) {
        if (hash(b.x, b.y, 550) > 0.25) continue;
        const x = b.left + t * 0.7;
        const y = b.top + t * 0.2;
        g.moveTo(x, y).bezierCurveTo(
          x + t * 0.5,
          y - t * 0.3,
          x + t * 0.1,
          y - t * 0.6,
          x + t * 0.45,
          y - t * 0.7,
        );
      }
      g.stroke({ width: 1, color: 0xcfcfd8, alpha: 0.85 });
    }
    trace(g, wall.rim);
    trace(g, wall.faceEdges);
    g.stroke({ width: this.ink(view), color: this.dark, alpha: 0.85 });
  }

  private house(view: ViewTransform, castle: Castle): House {
    const t = view.tile;
    const W = Math.min(castle.w, castle.h) * t;
    const cx = tileX(view, castle.x + castle.w / 2);
    const foot = tileY(view, castle.y + castle.h) - t * 0.05;
    const cornice = foot - W * 0.46;
    const windows: House['windows'] = [];
    for (let k = 0; k < 5; k++) {
      const x = cx - W * 0.27 + k * W * 0.135;
      windows.push({ x: x - W * 0.035, y: foot - W * 0.33, w: W * 0.07, h: W * 0.16 });
    }
    return { cx, foot, W, cornice, domeTop: cornice - W * 0.24, windows };
  }

  /**
   * A castle as an opera house: broad steps, a colonnade of six columns with arched windows
   * between, a gilded cornice, and over it a dome in the owner's colour, ribbed, a lantern on
   * top and a golden lyre on that. Its light and its music are drawn with the effects.
   */
  private drawHouse(g: Graphics, view: ViewTransform, castle: Castle): void {
    const owner = castle.islandId - 1;
    const k = this.house(view, castle);
    const { cx, foot, W, cornice } = k;
    const ink = this.ink(view);
    g.ellipse(cx + W * 0.05, foot, W * 0.52, W * 0.09);
    g.fill({ color: this.dark, alpha: 0.35 });
    // The dome, behind the facade, its ribs and lantern.
    g.ellipse(cx, cornice, W * 0.27, W * 0.24);
    g.fill({ color: this.colour(owner, 'base') });
    g.stroke({ width: ink, color: this.dark, alpha: 0.85 });
    for (const f of [-0.6, -0.2, 0.2, 0.6]) {
      g.moveTo(cx, k.domeTop).quadraticCurveTo(
        cx + W * 0.27 * f * 1.2,
        cornice - W * 0.14,
        cx + W * 0.27 * f,
        cornice,
      );
    }
    g.stroke({ width: 1, color: this.colour(owner, 'dark'), alpha: 0.9 });
    g.ellipse(cx - W * 0.1, cornice - W * 0.14, W * 0.05, W * 0.03);
    g.fill({ color: 0xffffff, alpha: 0.3 });
    g.rect(cx - W * 0.03, k.domeTop - W * 0.05, W * 0.06, W * 0.06);
    g.fill({ color: GOLD });
    drawLyre(g, cx, k.domeTop - W * 0.13, W * 0.16);
    // The steps and the facade.
    g.rect(cx - W * 0.46, foot - W * 0.06, W * 0.92, W * 0.06);
    g.fill({ color: 0xd8d2c4 });
    g.rect(cx - W * 0.42, cornice + W * 0.02, W * 0.84, foot - W * 0.06 - cornice - W * 0.02);
    g.fill({ color: IVORY });
    g.stroke({ width: ink, color: this.dark, alpha: 0.85 });
    for (const w of k.windows) {
      g.moveTo(w.x, w.y + w.h).lineTo(w.x, w.y + w.w / 2);
      g.arc(w.x + w.w / 2, w.y + w.w / 2, w.w / 2, Math.PI, 0);
      g.lineTo(w.x + w.w, w.y + w.h).closePath();
    }
    g.fill({ color: 0x2a2433 });
    for (let c = 0; c < 6; c++) {
      const x = cx - W * 0.34 + c * W * 0.135;
      g.rect(x - W * 0.022, foot - W * 0.38, W * 0.044, W * 0.32);
    }
    g.fill({ color: 0xffffff });
    for (let c = 0; c < 6; c++) {
      const x = cx - W * 0.34 + c * W * 0.135;
      g.moveTo(x + W * 0.022, foot - W * 0.38).lineTo(x + W * 0.022, foot - W * 0.06);
    }
    g.stroke({ width: 1, color: 0xb8b0a0 });
    // The cornice, gilded.
    g.rect(cx - W * 0.45, cornice, W * 0.9, W * 0.06);
    g.fill({ color: GOLD });
    g.stroke({ width: Math.max(1, ink * 0.7), color: this.dark, alpha: 0.7 });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    this.aims.fire(shot);
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const atSea = this.terrain !== null && x >= 0 && y >= 0 && x < this.width && !this.land(x, y);
    if (atSea) {
      this.rings.push({ x, y, age: 0, owner: -1 });
      return;
    }
    if (debris.length === 0) {
      if (this.land(x, y)) this.blots.push({ x, y, round: this.round });
      return;
    }
    for (const block of debris) {
      // The key knocked out, flying, and a sour note jumping out of the wall.
      this.sours.push({ x: block.x + 0.5, y: block.y + 0.3, age: 0, owner: block.owner });
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const v = 1.6 + Math.random() * 1.6;
        const black = k === 3;
        this.bits.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          age: 0,
          life: this.art.generators.fx.debrisMs * 1.4,
          floor: block.y + 0.85 + Math.random() * 0.3,
          colour: black
            ? EBONY
            : block.owner < 0
              ? hex(this.art.palette.rockMid)
              : this.colour(block.owner, 'base'),
          angle: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 12,
          black,
        });
      }
    }
  }

  /** The sweep: a key left alone runs off in a glissando, a scale of notes skipping away. */
  noteCrumble(block: Debris): void {
    this.glisses.push({ x: block.x + 0.2, y: block.y + 0.8, age: 0, owner: block.owner });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.scenery.land(cells);
    const first = cells[0];
    if (first !== undefined)
      this.chords.push({ x: first.x + 0.5, y: first.y + 0.5, age: 0, owner });
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, given: EffectFrame): void {
    // A frame's time may come in negative or not at all as a snapshot jumps the clock.
    const frame = { ...given, deltaMs: Math.max(0, given.deltaMs || 0) };
    this.round = state.round;
    this.clock += frame.deltaMs;
    this.drawFlow(state, view, frame.deltaMs);
    const g = this.effectGfx;
    g.clear();
    this.seaLife.draw(g, view, this.art, frame.deltaMs);
    drawDrain(g, view, frame.drain, this.art);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.scenery.drawPuffs(g, view, frame.deltaMs);
    this.ruins.draw(g, view, state, 0xc8c0d0, null, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    drawMainCastles(g, view, state, this.art, frame.castleSealed);
    this.drawPlaying(state, view, frame);
    this.drawHorns(state, view, frame.deltaMs);
    this.drawShots(state, view, frame);
    this.drawRings(view, frame.deltaMs);
    this.drawBits(view, frame.deltaMs);
    this.drawSours(view, frame.deltaMs);
    this.drawChords(view, frame.deltaMs);
    this.drawGlisses(view, frame.deltaMs);
    this.drawSpotlights(state, view);
    this.winnerBanners.draw(g, view, state, this.art, frame.celebrate, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /**
   * The houses playing, raised as a flag is: while a castle is sealed its windows are lit and
   * notes rise from its dome; a breach stops the music, and a rest hangs where the notes were
   * as the light goes down — so "sealed" is the house playing.
   */
  private drawPlaying(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const still = motionReduced();
    this.playing.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const lit = this.playing.raised(castle.id, this.clock, this.art);
      if (lit === null) continue;
      const k = this.house(view, castle);
      for (const w of k.windows) {
        g.rect(w.x, w.y + w.w / 2, w.w, w.h - w.w / 2);
        g.circle(w.x + w.w / 2, w.y + w.w / 2, w.w / 2);
      }
      g.fill({ color: hex(this.art.palette.emberHot), alpha: lit });
      if (this.playing.lowering(castle.id)) {
        drawRest(
          g,
          k.cx + k.W * 0.3,
          k.domeTop - k.W * 0.1,
          k.W * 0.45,
          IVORY,
          Math.sin(Math.PI * (1 - lit)),
        );
        continue;
      }
      if (still || lit < 0.9) continue;
      const since = (this.sinceNote.get(castle.id) ?? castle.id * 113) + frame.deltaMs;
      if (since >= this.style.risingNoteEveryMs) {
        this.sinceNote.set(castle.id, 0);
        this.rising.push({
          castle: castle.id,
          age: 0,
          dx: (Math.random() - 0.5) * 0.4,
          flags: Math.floor(Math.random() * 3),
        });
      } else {
        this.sinceNote.set(castle.id, since);
      }
    }
    for (const r of this.rising) {
      r.age += frame.deltaMs;
      const castle = state.castles.find((c) => c.id === r.castle);
      if (castle === undefined || this.playing.lowering(r.castle)) {
        r.age = RISE_MS;
        continue;
      }
      const p = r.age / RISE_MS;
      if (p >= 1) continue;
      const k = this.house(view, castle);
      const alpha = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.4);
      drawQuaver(
        g,
        k.cx + k.W * (r.dx + 0.25 * Math.sin(p * Math.PI * 2 + r.castle)),
        k.domeTop - k.W * (0.2 + 1.1 * p),
        k.W * 0.32,
        GOLD,
        alpha,
        r.flags,
        Math.sin(p * 6) * 0.25,
      );
    }
    this.rising = this.rising.filter((r) => r.age < RISE_MS);
  }

  /**
   * The horns: brass, coiled at the stand, the bell turned to the target, kicking back as
   * they fire with notes bursting from the bell. A silenced horn is muted — a mute stuffed in
   * its bell, the bell turned down.
   */
  private drawHorns(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2) - t * 0.08;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const angle = cannon.active ? aim.angle : Math.PI * 0.75;
      const dx = Math.sin(angle);
      const dy = -Math.cos(angle) * 0.8;
      const nx = -dy;
      const ny = dx;
      const reach = t * (0.7 - 0.22 * kick);
      const ex = cx + dx * reach;
      const ey = cy + dy * reach;
      // The coil, and the tube out to the bell.
      g.circle(cx, cy, t * 0.26);
      g.stroke({ width: Math.max(2, t * 0.11), color: BRASS_DARK });
      g.circle(cx, cy, t * 0.26);
      g.stroke({ width: Math.max(1.5, t * 0.07), color: BRASS });
      g.moveTo(cx, cy).lineTo(ex, ey);
      g.stroke({ width: Math.max(2, t * 0.12), color: BRASS, cap: 'round' });
      // The bell, flaring.
      const bell = t * 0.32;
      const fx = ex + dx * t * 0.28;
      const fy = ey + dy * t * 0.28;
      g.poly([
        ex + nx * t * 0.07,
        ey + ny * t * 0.07,
        fx + nx * bell,
        fy + ny * bell,
        fx - nx * bell,
        fy - ny * bell,
        ex - nx * t * 0.07,
        ey - ny * t * 0.07,
      ]);
      g.fill({ color: BRASS });
      g.stroke({ width: 1, color: BRASS_DARK });
      g.ellipse(
        fx,
        fy,
        bell * 0.55 + Math.abs(nx) * bell * 0.45,
        bell * 0.55 + Math.abs(ny) * bell * 0.45,
      );
      g.fill({ color: 0x5a4010 });
      if (!cannon.active) {
        // The mute, stuffed in the bell.
        g.circle(fx - dx * t * 0.05, fy - dy * t * 0.05, bell * 0.5);
        g.fill({ color: 0x3a2a1c });
        g.circle(fx - dx * t * 0.05, fy - dy * t * 0.05, bell * 0.2);
        g.fill({ color: 0x6a5038 });
        continue;
      }
      if (aim.firedAgo < 650) {
        const k = aim.firedAgo / 650;
        for (let n = 0; n < 2; n++) {
          const d = t * (0.3 + 0.9 * k);
          drawQuaver(
            g,
            fx + dx * d + nx * t * (n - 0.5) * 0.6,
            fy + dy * d + ny * t * (n - 0.5) * 0.6 - k * t * 0.3,
            t * 0.4,
            GOLD,
            1 - k,
            n + 1,
          );
        }
      }
    }
    this.aims.prune(state);
  }

  /** Shots: notes in the owner's colour, rocking as they fly, a glow round each. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const lift = shotLift(shot, p);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      const x = gx;
      const y = gy - lift * t;
      const high = Math.min(1, lift / 3);
      g.ellipse(gx, gy, t * 0.22, t * 0.1);
      g.fill({ color: 0x000000, alpha: 0.25 - 0.1 * high });
      g.circle(x, y - t * 0.2, t * 0.42);
      g.fill({ color: this.colour(shot.owner, 'light'), alpha: 0.35 });
      const size = t * (0.7 + 0.2 * high);
      const rock = motionReduced() ? 0 : Math.sin(this.clock / 140 + shot.id) * 0.35;
      drawQuaver(g, x + 1, y + 1, size, this.dark, 0.7, 1 + (shot.id % 2), rock);
      drawQuaver(g, x, y, size, this.colour(shot.owner, 'base'), 1, 1 + (shot.id % 2), rock);
      drawShotTarget(g, view, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** A shot at sea: rings of sound spreading on the water. */
  private drawRings(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const s of this.rings) {
      s.age += deltaMs;
      const k = s.age / RING_MS;
      if (k >= 1) continue;
      for (let n = 0; n < 3; n++) {
        const q = k - n * 0.15;
        if (q <= 0) continue;
        g.ellipse(
          tileX(view, s.x + 0.5),
          tileY(view, s.y + 0.5),
          t * (0.2 + 1.1 * q),
          t * (0.12 + 0.6 * q),
        );
        g.stroke({ width: Math.max(1, t * 0.06), color: GOLD, alpha: 0.7 * (1 - q) });
      }
    }
    this.rings = this.rings.filter((s) => s.age < RING_MS);
  }

  /** Keys knocked out of a wall, tumbling and bouncing once. */
  private drawBits(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    const dt = deltaMs / 1000;
    for (const b of this.bits) {
      b.age += deltaMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 7 * dt;
      b.angle += b.spin * dt;
      if (b.y > b.floor && b.vy > 0) {
        b.y = b.floor;
        b.vy *= -0.3;
        b.vx *= 0.5;
        b.spin *= 0.5;
      }
      const alpha = Math.max(0, 1 - b.age / b.life);
      const x = tileX(view, b.x);
      const y = tileY(view, b.y);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const l = t * (b.black ? 0.18 : 0.28);
      g.moveTo(x - c * l, y - s * l).lineTo(x + c * l, y + s * l);
      g.stroke({
        width: Math.max(2, t * (b.black ? 0.12 : 0.16)),
        color: b.colour,
        alpha,
        cap: 'butt',
      });
    }
    this.bits = this.bits.filter((b) => b.age < b.life);
  }

  /** The sour note a hit knocks out of a wall: crooked, cracked, jumping up and fading. */
  private drawSours(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const s of this.sours) {
      s.age += deltaMs;
      const k = s.age / SOUR_MS;
      if (k >= 1) continue;
      const x = tileX(view, s.x) + Math.sin(k * 20) * t * 0.08;
      const y = tileY(view, s.y) - Math.sin(k * Math.PI * 0.6) * t * 1.2;
      const alpha = Math.min(1, (1 - k) / 0.4);
      drawQuaver(g, x, y, t * 0.75, IVORY, alpha, 1, 0.5);
      // Its crack: a jagged stroke beside it.
      g.moveTo(x + t * 0.28, y - t * 0.6)
        .lineTo(x + t * 0.42, y - t * 0.45)
        .lineTo(x + t * 0.3, y - t * 0.32)
        .lineTo(x + t * 0.46, y - t * 0.16);
      g.stroke({ width: Math.max(1, t * 0.06), color: IVORY, alpha, cap: 'round', join: 'round' });
    }
    this.sours = this.sours.filter((s) => s.age < SOUR_MS);
  }

  /** A piece set down lands as a chord: three heads stacked on one stem, rising and fading. */
  private drawChords(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const c of this.chords) {
      c.age += deltaMs;
      const k = c.age / CHORD_MS;
      if (k >= 1) continue;
      const x = tileX(view, c.x);
      const y = tileY(view, c.y) - k * t * 0.6;
      const alpha = 1 - k;
      for (let n = 0; n < 3; n++)
        drawQuaver(g, x, y - n * t * 0.2, t * (0.7 + n * 0.2), GOLD, alpha, n === 2 ? 1 : 0);
    }
    this.chords = this.chords.filter((c) => c.age < CHORD_MS);
  }

  /** A swept key's glissando: a run of small notes skipping up and away, one after another. */
  private drawGlisses(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const s of this.glisses) {
      s.age += deltaMs;
      const k = s.age / GLISS_MS;
      if (k >= 1) continue;
      for (let n = 0; n < 6; n++) {
        const appear = n / 8;
        if (k < appear) continue;
        const life = (k - appear) / (1 - appear);
        drawQuaver(
          g,
          tileX(view, s.x + n * 0.22),
          tileY(view, s.y - n * 0.18) - life * t * 0.3,
          t * 0.4,
          s.owner < 0 ? IVORY : this.colour(s.owner, 'light'),
          1 - life,
          0,
        );
      }
    }
    this.glisses = this.glisses.filter((s) => s.age < GLISS_MS);
  }

  /** The finale — overtime and the final round: spotlights sweeping across the board. */
  private drawSpotlights(state: MatchState, view: ViewTransform): void {
    const finale = (state.phase === 'build' && state.overtime) || inFinalRound(state);
    if (!finale) return;
    const g = this.effectGfx;
    const t = view.tile;
    const still = motionReduced();
    const top = view.top;
    const h = view.height - top;
    for (let k = 0; k < this.style.spotlights; k++) {
      const time = still ? k * 3000 : this.clock;
      const x = view.width * (0.5 + 0.38 * Math.sin(time / 3100 + k * 2.2));
      const y = top + h * (0.5 + 0.32 * Math.sin(time / 2300 + k * 1.4));
      for (const [r, a] of [
        [6, 0.35],
        [4.5, 0.55],
        [3.2, 1],
      ] as const) {
        g.circle(x, y, t * r);
        g.fill({ color: 0xfff6dc, alpha: this.style.spotlightAlpha * a });
      }
    }
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
      // The piece in hand sketched in pencil on the manuscript; where it does not fit, it is
      // crossed out as a composer corrects a bar — the difference in form, since red is a
      // player's.
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = (x: number, y: number): boolean => cells.some((c) => c.x === x && c.y === y);
      for (const { x, y } of cells) g.rect(tileX(view, x), tileY(view, y), t, t);
      g.fill({
        color: ghost.valid ? this.colour(humanPlayer, 'light') : hex(palette.rockDark),
        alpha: ghost.valid ? 0.4 : 0.3,
      });
      const edge = outline(cells, inPiece, view);
      // A sketcher's line goes round twice, never quite on itself.
      for (const s of edge) {
        g.moveTo(s.x1 - 1, s.y1 + 1).lineTo(s.x2 + 1, s.y2 - 1);
        g.moveTo(s.x1 + 1, s.y1 - 1).lineTo(s.x2 - 1, s.y2 + 1);
      }
      g.stroke({
        width: Math.max(1, t * 0.05),
        color: ghost.valid ? IVORY : GRAPHITE,
        alpha: 0.95,
      });
      if (!ghost.valid) {
        for (const { x, y } of cells) {
          const px = tileX(view, x);
          const py = tileY(view, y);
          g.moveTo(px + t * 0.1, py + t * 0.8);
          for (let k = 1; k <= 4; k++) {
            g.lineTo(px + t * (0.1 + 0.2 * k), py + t * (k % 2 === 0 ? 0.8 : 0.2));
          }
        }
        g.stroke({
          width: Math.max(1.5, t * 0.08),
          color: hex(palette.uiInvalid),
          cap: 'round',
          join: 'round',
        });
      }
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      // An empty stand's outline, struck through where it cannot go.
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = Math.min(ghost.footprint.w, ghost.footprint.h) * t * 0.38;
      g.circle(cx, cy, r * 0.8);
      g.fill({ color: colour, alpha: 0.22 });
      g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      if (!ghost.valid) {
        g.moveTo(cx - r * 0.7, cy + r * 0.7).lineTo(cx + r * 0.7, cy - r * 0.7);
        g.stroke({ width: Math.max(1.5, t * 0.1), color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}

/**
 * Opera's scenery, none like a key, a horn or a note: a tree a golden harp; a pine a music
 * stand with its chair, so a copse of them is a section of the orchestra; a bush a singer of
 * the choir in a black robe, mouth open; a boulder a metronome — one in three a grand piano
 * with its lid up.
 */
function drawOperaScenery(
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
      // A harp: its pillar, the curved neck, the soundboard slanting down, strings between.
      const s = t * 0.85;
      g.ellipse(cx + t * 0.05, cy + s * 0.45, s * 0.3, s * 0.07);
      g.fill({ color: ink, alpha: 0.3 });
      for (let k = 1; k <= 5; k++) {
        const f = k / 6;
        g.moveTo(cx - s * 0.25 + f * s * 0.45, cy - s * 0.38 + f * 0.1 * s).lineTo(
          cx - s * 0.25 + f * s * 0.45,
          cy + s * 0.4 - f * s * 0.62,
        );
      }
      g.stroke({ width: 1, color: 0xfff4d0, alpha: 0.85 });
      g.moveTo(cx - s * 0.25, cy + s * 0.42).lineTo(cx - s * 0.25, cy - s * 0.4);
      g.quadraticCurveTo(cx, cy - s * 0.25, cx + s * 0.22, cy - s * 0.45);
      g.moveTo(cx - s * 0.25, cy + s * 0.42).lineTo(cx + s * 0.22, cy - s * 0.25);
      g.stroke({ width: Math.max(1.5, t * 0.08), color: GOLD, cap: 'round' });
    } else if (item.kind === 'pine') {
      // A music stand with its chair: the seat and back, the stand's post and its desk.
      g.rect(cx - t * 0.12, cy + t * 0.02, t * 0.26, t * 0.22);
      g.fill({ color: 0x3a2418 });
      g.rect(cx - t * 0.12, cy + t * 0.2, t * 0.26, t * 0.06);
      g.fill({ color: 0x24160e });
      g.moveTo(cx + t * 0.02, cy - t * 0.05).lineTo(cx + t * 0.02, cy - t * 0.25);
      g.stroke({ width: 1, color: ink });
      g.poly([
        cx - t * 0.2,
        cy - t * 0.42,
        cx + t * 0.24,
        cy - t * 0.42,
        cx + t * 0.2,
        cy - t * 0.22,
        cx - t * 0.16,
        cy - t * 0.22,
      ]);
      g.fill({ color: 0x1a1a1e });
      g.rect(cx - t * 0.12, cy - t * 0.4, t * 0.28, t * 0.14);
      g.fill({ color: PAPER });
    } else if (item.kind === 'bush') {
      // A singer of the choir: black robe, white collar, head up, mouth open in song.
      const skins = [0xf2d0b0, 0xd9a47a, 0x8a5a3a];
      g.poly([
        cx - t * 0.22,
        cy + t * 0.38,
        cx + t * 0.22,
        cy + t * 0.38,
        cx + t * 0.12,
        cy - t * 0.05,
        cx - t * 0.12,
        cy - t * 0.05,
      ]);
      g.fill({ color: 0x111018 });
      g.ellipse(cx, cy - t * 0.04, t * 0.11, t * 0.04);
      g.fill({ color: 0xffffff });
      g.circle(cx, cy - t * 0.18, t * 0.11);
      g.fill({ color: skins[item.variant % skins.length]! });
      g.ellipse(cx, cy - t * 0.23, t * 0.11, t * 0.05);
      g.fill({ color: 0x2a1c14 });
      g.ellipse(cx, cy - t * 0.13, t * 0.035, t * 0.045);
      g.fill({ color: 0x3a1218 });
    } else if (item.variant % 3 === 0) {
      // A grand piano: its curved black case, the keyboard along the front, the lid raised.
      const s = t * 0.9;
      g.moveTo(cx - s * 0.4, cy + s * 0.3);
      g.lineTo(cx - s * 0.4, cy - s * 0.35);
      g.quadraticCurveTo(cx + s * 0.1, cy - s * 0.45, cx + s * 0.15, cy - s * 0.1);
      g.quadraticCurveTo(cx + s * 0.4, cy + s * 0.05, cx + s * 0.4, cy + s * 0.3);
      g.closePath();
      g.fill({ color: EBONY });
      g.stroke({ width: 1, color: 0x5a5a66 });
      g.rect(cx - s * 0.4, cy + s * 0.3, s * 0.8, s * 0.1);
      g.fill({ color: IVORY });
      for (let k = 1; k < 8; k++)
        g.moveTo(cx - s * 0.4 + k * s * 0.1, cy + s * 0.3).lineTo(
          cx - s * 0.4 + k * s * 0.1,
          cy + s * 0.36,
        );
      g.stroke({ width: 1, color: EBONY });
      g.moveTo(cx - s * 0.38, cy - s * 0.32).lineTo(cx + s * 0.2, cy - s * 0.62);
      g.stroke({ width: Math.max(1, t * 0.05), color: 0x2a2a32 });
    } else {
      // A metronome: a wooden pyramid, its pendulum ticking off to one side.
      const s = t * 0.7;
      g.poly([
        cx - s * 0.3,
        cy + s * 0.4,
        cx + s * 0.3,
        cy + s * 0.4,
        cx + s * 0.12,
        cy - s * 0.45,
        cx - s * 0.12,
        cy - s * 0.45,
      ]);
      g.fill({ color: 0x6a3e20 });
      g.stroke({ width: 1, color: ink, alpha: 0.7 });
      g.moveTo(cx, cy + s * 0.3).lineTo(
        cx + (item.variant % 2 === 0 ? 1 : -1) * s * 0.22,
        cy - s * 0.4,
      );
      g.stroke({ width: Math.max(1, t * 0.05), color: GOLD });
    }
  }
}
