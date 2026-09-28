import type { ArtConfig, ParchmentStyleConfig } from '@rampart/config';
import { Rng, Structure, Terrain, type MatchState, type Shot } from '@rampart/sim';
import { Graphics, Sprite, Texture } from 'pixi.js';

import { timerSpot, type TimerSpot } from '../timerSpot.js';

import { seaDepth } from './pixel.js';
import {
  FlagHoist,
  Fireworks,
  GunAims,
  Landings,
  ReloadRings,
  dimEliminated,
  drawAimLine,
  drawBuildHints,
  drawChoices,
  drawSelectable,
  drawFireReticle,
  drawOvertimeBorder,
  drawSealGlow,
  drawShotTarget,
  hex,
  mixed,
  playerColour,
  shotLift,
  tileX,
  tileY,
  type Cell,
  type Debris,
  type EffectFrame,
  type Ghost,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
} from './theme.js';
import { hatch, outline, trace, wallGeometry, type Segment } from './walls.js';

/** Squares tried for the compass rose, largest first. */
const ROSE_SIZES = [4, 3] as const;

/**
 * Where the compass rose goes: open water as near the bottom-right of the window as fits
 * it, in tile coordinates, which may lie outside the map in the sea round it.
 *
 * It first sat under the big timer, the one place in the sea certain to be open, and
 * muddied its figures. The bottom-right corner is the one the HUD leaves alone — the
 * bar is along the top, the sound switch and the hint along the bottom's left and
 * middle. `right` and `bottom` are the whole tiles of sea on screen beyond the map on
 * those sides — not the sheet drawn, which runs past the window, nor the margin above,
 * which the HUD's inset makes deeper than the one below. The rose keeps a tile clear of
 * the window's edge, and never overlaps `avoid`, the timer's square.
 */
export function roseSpot(
  state: MatchState,
  right: number,
  bottom: number,
  avoid: TimerSpot | null,
): TimerSpot | null {
  const land = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < state.width &&
    y < state.height &&
    state.terrain[y * state.width + x] === Terrain.Land;
  const cornerX = state.width + right - 1;
  const cornerY = state.height + bottom - 1;
  for (const s of ROSE_SIZES) {
    let best: TimerSpot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = 1; y + s <= cornerY; y++) {
      for (let x = 1; x + s <= cornerX; x++) {
        const d = Math.hypot(cornerX - (x + s), cornerY - (y + s));
        if (d >= bestDistance) continue;
        if (avoid !== null) {
          const ax = avoid.x - avoid.size / 2;
          const ay = avoid.y - avoid.size / 2;
          if (x < ax + avoid.size && ax < x + s && y < ay + avoid.size && ay < y + s) continue;
        }
        let open = true;
        for (let dy = 0; dy < s && open; dy++) {
          for (let dx = 0; dx < s && open; dx++) if (land(x + dx, y + dy)) open = false;
        }
        if (!open) continue;
        bestDistance = d;
        best = { x: x + s / 2, y: y + s / 2, size: s };
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** An ink stain where a shot came down on land, fading over the rounds after. */
interface Stain {
  x: number;
  y: number;
  round: number;
  seed: number;
}

/** A drop of ink or a chip of stone, in tile coordinates. */
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colour: number;
  gravity: number;
}

/** Ink rings on the water where a shot went in. */
interface Ripple {
  x: number;
  y: number;
  age: number;
}

/** A block the sweep took, fading from the paper. */
interface Fade {
  x: number;
  y: number;
  age: number;
  colour: number;
}

const RECOIL_MS = 160;
const RIPPLE_MS = 700;
/** Canvas pixels per tile in the paper's grain: fine enough to read as paper. */
const GRAIN_PX = 6;

/** A number from 0 to 1 for a tile, the same every time: for the unevenness of a wash. */
function jitter(x: number, y: number, salt: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The parchment look: an old hand-drawn map, in ink and watercolour on sepia paper.
 *
 * The paper has grain, stains and darkened edges; the coast is a bold ink line with the
 * engraver's contours rippling out from it, and wave strokes on the open sea; a compass
 * rose sits in the sea's bottom-right corner. Walls are inked stone standing up as
 * the pixel style's do, their faces cross-hatched, casting a shadow on the paper. Sealed
 * ground is a watercolour wash inside a dotted border, and a sealed castle bears a wax
 * seal in its owner's colour, pressed on as it seals and cracking when it is breached.
 * Shots are ink dots on a dotted course, and leave ink stains where they land.
 *
 * The one light style: every colour it draws with is ink dark enough to read on paper,
 * which is why its palette's ink stands where others' light is.
 */
export class ParchmentTheme implements Theme {
  readonly id = 'parchment' as const;

  private art!: ArtConfig;
  private style!: ParchmentStyleConfig;
  private readonly seed: number;

  private readonly terrainGfx = new Graphics();
  private readonly roseGfx = new Graphics();
  private readonly territoryGfx = new Graphics();
  /**
   * Ink stains, over the paper but under the walls, as the pixel style's scorch marks
   * are: a block rebuilt on a stain covers it. Drawn in the effects layer, above the
   * walls, a stain showed through the wall rebuilt over it for rounds after.
   */
  private readonly stainGfx = new Graphics();
  private readonly structureGfx = new Graphics();
  private readonly effectGfx = new Graphics();
  private readonly overlayGfx = new Graphics();
  private grain: Sprite | null = null;
  private grainKey = '';

  private terrain: Uint8Array | null = null;
  private width = 0;
  private round = 0;
  private stains: Stain[] = [];
  private drops: Drop[] = [];
  private ripples: Ripple[] = [];
  private fades: Fade[] = [];
  private readonly aims = new GunAims();
  private readonly landings = new Landings();
  /** The player's own guns reloading; see `ReloadRings`. */
  private readonly reloads = new ReloadRings();
  private readonly fireworks = new Fireworks();
  private readonly flags = new FlagHoist();
  private clock = 0;
  private layers!: ThemeLayers;

  constructor(seed = 1) {
    this.seed = seed;
  }

  init(layers: ThemeLayers, art: ArtConfig): Promise<void> {
    this.art = art;
    this.style = art.parchment;
    this.layers = layers;
    layers.terrain.addChild(this.terrainGfx, this.roseGfx);
    layers.territory.addChild(this.territoryGfx, this.stainGfx);
    layers.structures.addChild(this.structureGfx);
    layers.effects.addChild(this.effectGfx);
    layers.overlay.addChild(this.overlayGfx);
    return Promise.resolve();
  }

  destroy(): void {
    for (const g of [
      this.terrainGfx,
      this.roseGfx,
      this.territoryGfx,
      this.stainGfx,
      this.structureGfx,
      this.effectGfx,
      this.overlayGfx,
    ]) {
      g.destroy();
    }
    this.grain?.texture.destroy(true);
    this.grain?.destroy();
  }

  private colour(player: number, shade: 'base' | 'light' | 'dark'): number {
    return playerColour(this.art, player, shade);
  }

  private faceFraction(): number {
    return this.art.generators.wall.frontFacePx / this.art.tileSizePx;
  }

  private castleFace(castle: { h: number }): number {
    const { frontFacePx } = this.art.generators.wall;
    return (castle.h * (frontFacePx + 2)) / (this.art.tileSizePx * 3);
  }

  /** Paper as the owner's ink tints it: a wall's top, a castle's roof. */
  private paper(player: number, amount: number): number {
    return mixed(hex(this.art.palette.grassLight), this.colour(player, 'light'), amount);
  }

  // ------------------------------------------------------------------ terrain

  drawTerrain(state: MatchState, view: ViewTransform): void {
    this.terrain = state.terrain;
    this.width = state.width;
    const g = this.terrainGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const land = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < state.width &&
      y < state.height &&
      state.terrain[y * state.width + x] === Terrain.Land;

    const marginX = Math.ceil(view.originX / t) + 1;
    const marginY = Math.ceil(view.originY / t) + 1;
    const w = state.width + marginX * 2;
    const h = state.height + marginY * 2;
    const deepest = Math.max(4, ...this.style.contourTiles) + 1;
    const depth = seaDepth(state, marginX, marginY, deepest);
    const depthAt = (x: number, y: number): number =>
      x < -marginX || y < -marginY || x >= w - marginX || y >= h - marginY
        ? deepest
        : (depth[(y + marginY) * w + (x + marginX)] as number);

    // Paler water in the shallows, as a map colours its coasts.
    for (let y = -marginY; y < h - marginY; y++) {
      for (let x = -marginX; x < w - marginX; x++) {
        if (land(x, y) || depthAt(x, y) > 1.5) continue;
        g.rect(tileX(view, x), tileY(view, y), t, t);
      }
    }
    g.fill({ color: hex(palette.waterShallow), alpha: 0.6 });

    // The engraver's contours, rippling out from every coast.
    this.style.contourTiles.forEach((k, n) => {
      const lines: Segment[] = [];
      for (let y = -marginY; y < h - marginY; y++) {
        for (let x = -marginX; x < w - marginX; x++) {
          if (land(x, y)) continue;
          const here = depthAt(x, y) < k;
          if (!here) continue;
          const left = tileX(view, x);
          const top = tileY(view, y);
          if (!land(x + 1, y) && depthAt(x + 1, y) >= k) {
            lines.push({ x1: left + t, y1: top, x2: left + t, y2: top + t });
          }
          if (!land(x - 1, y) && depthAt(x - 1, y) >= k) {
            lines.push({ x1: left, y1: top, x2: left, y2: top + t });
          }
          if (!land(x, y + 1) && depthAt(x, y + 1) >= k) {
            lines.push({ x1: left, y1: top + t, x2: left + t, y2: top + t });
          }
          if (!land(x, y - 1) && depthAt(x, y - 1) >= k) {
            lines.push({ x1: left, y1: top, x2: left + t, y2: top });
          }
        }
      }
      trace(g, lines);
      g.stroke({ width: 1, color: hex(palette.waterFoam), alpha: 0.45 - n * 0.15 });
    });

    // Wave strokes on the open sea, seeded so a map always has the same.
    const rng = new Rng(this.seed ^ 0x2f1);
    const open: Cell[] = [];
    for (let y = -marginY; y < h - marginY; y++) {
      for (let x = -marginX; x < w - marginX; x++) {
        if (!land(x, y) && depthAt(x, y) >= deepest - 1) open.push({ x, y });
      }
    }
    const waves = Math.round(open.length * this.style.wavesPerSeaTile);
    for (let k = 0; k < waves && open.length > 0; k++) {
      const cell = open[rng.nextInt(open.length)]!;
      const cx = tileX(view, cell.x + rng.nextFloat());
      const cy = tileY(view, cell.y + rng.nextFloat());
      const r = t * 0.3;
      g.moveTo(cx - r * 2, cy);
      g.quadraticCurveTo(cx - r * 1.5, cy - r, cx - r, cy);
      g.quadraticCurveTo(cx - r * 0.5, cy + r * 0.6, cx, cy);
      g.quadraticCurveTo(cx + r * 0.5, cy - r, cx + r, cy);
    }
    g.stroke({ width: 1, color: hex(palette.waterFoam), alpha: 0.5 });

    // Land as lighter paper, washed faintly in the colour of whose it is.
    for (let player = 0; player <= state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.terrain.length; i++) {
        if (state.terrain[i] !== Terrain.Land || state.islandId[i] !== player) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      for (const c of cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
      g.fill({ color: hex(palette.grassMid) });
      if (player === 0) continue;
      for (const c of cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
      g.fill({ color: this.colour(player - 1, 'base'), alpha: 0.07 });
    }

    // The coast in a bold line of ink.
    const coast: Cell[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] !== Terrain.Land) continue;
      const x = i % state.width;
      coast.push({ x, y: (i - x) / state.width });
    }
    trace(g, outline(coast, land, view));
    g.stroke({ width: this.style.inkWidthPx * 1.6, color: hex(palette.rockDark) });

    this.drawRose(state, view);
    this.layGrain(view, marginX, marginY, w, h);
  }

  /** A compass rose in a corner of the sea, clear of the big timer (`roseSpot`). */
  private drawRose(state: MatchState, view: ViewTransform): void {
    const g = this.roseGfx;
    g.clear();
    const right = Math.floor((view.width - view.originX) / view.tile) - state.width;
    const bottom = Math.floor((view.height - view.originY) / view.tile) - state.height;
    const spot = roseSpot(state, right, bottom, timerSpot(state));
    if (spot === null) return;
    const ink = hex(this.art.palette.rockDark);
    const cx = tileX(view, spot.x);
    const cy = tileY(view, spot.y);
    const r = (spot.size * view.tile) / 2 - view.tile * 0.2;
    g.circle(cx, cy, r * 0.62);
    g.stroke({ width: 1, color: ink, alpha: 0.3 });
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2;
      const long = k % 2 === 0;
      const reach = r * (long ? 1 : 0.6);
      const side = r * 0.12;
      const tip = { x: cx + Math.sin(angle) * reach, y: cy - Math.cos(angle) * reach };
      const l = {
        x: cx + Math.sin(angle - Math.PI / 2) * side,
        y: cy - Math.cos(angle - Math.PI / 2) * side,
      };
      const rr = {
        x: cx + Math.sin(angle + Math.PI / 2) * side,
        y: cy - Math.cos(angle + Math.PI / 2) * side,
      };
      // Each point in two halves, one inked and one left as paper, as roses are drawn.
      g.poly([cx, cy, tip.x, tip.y, l.x, l.y]);
      g.fill({ color: ink, alpha: long ? 0.3 : 0.2 });
      g.poly([cx, cy, tip.x, tip.y, rr.x, rr.y]);
      g.stroke({ width: 1, color: ink, alpha: long ? 0.3 : 0.2 });
    }
  }

  /**
   * The paper's grain over the whole sheet: flecks, a few stains, and edges darkened as
   * old paper is. Generated once for the area drawn, from the match seed.
   */
  private layGrain(
    view: ViewTransform,
    marginX: number,
    marginY: number,
    w: number,
    h: number,
  ): void {
    const key = `${w},${h}`;
    if (key !== this.grainKey) {
      this.grainKey = key;
      this.grain?.texture.destroy(true);
      this.grain?.destroy();
      const canvas = document.createElement('canvas');
      canvas.width = w * GRAIN_PX;
      canvas.height = h * GRAIN_PX;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const rng = new Rng(this.seed ^ 0x9a7);
        const ink = this.art.palette.shadow;
        ctx.fillStyle = ink;
        for (let k = 0; k < canvas.width * canvas.height * 0.06; k++) {
          ctx.globalAlpha = 0.05 + rng.nextFloat() * 0.12;
          ctx.fillRect(rng.nextInt(canvas.width), rng.nextInt(canvas.height), 1, 1);
        }
        for (let k = 0; k < 6; k++) {
          const x = rng.nextFloat() * canvas.width;
          const y = rng.nextFloat() * canvas.height;
          const r = (2 + rng.nextFloat() * 5) * GRAIN_PX;
          const stain = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
          stain.addColorStop(0, 'rgba(90, 60, 20, 0.12)');
          stain.addColorStop(0.85, 'rgba(90, 60, 20, 0.06)');
          stain.addColorStop(1, 'rgba(90, 60, 20, 0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = stain;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        const edge = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          Math.min(canvas.width, canvas.height) * 0.35,
          canvas.width / 2,
          canvas.height / 2,
          Math.hypot(canvas.width, canvas.height) / 2,
        );
        edge.addColorStop(0, 'rgba(60, 35, 10, 0)');
        edge.addColorStop(1, 'rgba(60, 35, 10, 0.45)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.grain = new Sprite(Texture.from(canvas));
      this.layers.terrain.addChild(this.grain);
    }
    if (this.grain === null) return;
    this.grain.x = tileX(view, -marginX);
    this.grain.y = tileY(view, -marginY);
    this.grain.width = w * view.tile;
    this.grain.height = h * view.tile;
    this.grain.alpha = this.style.grainAlpha * 2;
  }

  // ------------------------------------------------------------------ territory

  /**
   * Sealed ground as a watercolour wash in the owner's colour, uneven as a brush leaves
   * it and pooling darker along its edge, inside a dotted border.
   */
  drawTerritory(state: MatchState, view: ViewTransform): void {
    const g = this.territoryGfx;
    g.clear();
    const t = view.tile;
    const wash = this.style.washAlpha;
    for (let player = 0; player < state.players.length; player++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.territory.length; i++) {
        if (state.territory[i] !== player + 1) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      const inside = (x: number, y: number): boolean =>
        x >= 0 &&
        y >= 0 &&
        x < state.width &&
        y < state.height &&
        state.territory[y * state.width + x] === player + 1;
      const colour = this.colour(player, 'base');
      // Three passes of the brush, each missing a different few tiles.
      for (let pass = 0; pass < 3; pass++) {
        for (const c of cells) {
          if (jitter(c.x, c.y, pass) < 0.25) continue;
          g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
        }
        g.fill({ color: colour, alpha: wash / 2.2 });
      }
      const border = outline(cells, inside, view);
      // The pigment pooled along the edge, a band just inside it.
      for (const s of border) {
        const vertical = s.x1 === s.x2;
        const band = t * 0.18;
        if (vertical) {
          const inward = inside(
            Math.floor((s.x1 - view.originX) / t),
            Math.floor((s.y1 - view.originY) / t),
          );
          g.rect(inward ? s.x1 : s.x1 - band, s.y1, band, t);
        } else {
          const inward = inside(
            Math.floor((s.x1 - view.originX) / t),
            Math.floor((s.y1 - view.originY) / t),
          );
          g.rect(s.x1, inward ? s.y1 : s.y1 - band, t, band);
        }
      }
      g.fill({ color: colour, alpha: wash * 0.6 });
      // The border, dotted in the owner's ink.
      const dark = this.colour(player, 'dark');
      for (const s of border) {
        const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        for (let d = t * 0.12; d < length; d += t * 0.25) {
          g.circle(s.x1 + ((s.x2 - s.x1) * d) / length, s.y1 + ((s.y2 - s.y1) * d) / length, 0.9);
        }
      }
      g.fill({ color: dark, alpha: 0.8 });
    }
    dimEliminated(g, state, view, hex(this.art.palette.shadow));
  }

  // ------------------------------------------------------------------ structures

  drawStructures(state: MatchState, view: ViewTransform): void {
    const g = this.structureGfx;
    g.clear();
    const { palette } = this.art;
    const t = view.tile;
    const ink = this.style.inkWidthPx;
    const wallOf = (x: number, y: number): number =>
      x >= 0 && y >= 0 && x < state.width && y < state.height
        ? state.structure[y * state.width + x] === Structure.Wall
          ? (state.owner[y * state.width + x] as number)
          : -1
        : -1;

    // Shadows first, cast onto the paper south of what stands, as the light falls from
    // the north in the pixel style.
    const shade = t * 0.3;
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] === 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      if (wallOf(x, y + 1) >= 0) continue;
      g.rect(tileX(view, x) + t * 0.12, tileY(view, y + 1), t, shade);
    }
    for (const castle of state.castles) {
      g.rect(
        tileX(view, castle.x) + t * 0.12,
        tileY(view, castle.y + castle.h) - t * 0.12,
        castle.w * t,
        shade,
      );
    }
    for (const cannon of state.cannons) {
      g.ellipse(
        tileX(view, cannon.x + cannon.w / 2 + 0.12),
        tileY(view, cannon.y + cannon.h / 2 + 0.2),
        (cannon.w * t) / 2 - t * 0.2,
        (cannon.h * t) / 2 - t * 0.25,
      );
    }
    g.fill({ color: hex(palette.shadow), alpha: this.style.shadowAlpha });

    for (let owner = 1; owner <= state.players.length; owner++) {
      const cells: Cell[] = [];
      for (let i = 0; i < state.structure.length; i++) {
        if (state.structure[i] !== Structure.Wall || state.owner[i] !== owner) continue;
        const x = i % state.width;
        cells.push({ x, y: (i - x) / state.width });
      }
      if (cells.length === 0) continue;
      this.drawWall(g, view, cells, (x, y) => wallOf(x, y) === owner, owner - 1);
    }

    // An eliminated player's rubble: loose stones sketched on the paper, no face.
    for (let i = 0; i < state.structure.length; i++) {
      if (state.structure[i] !== Structure.Wall || state.owner[i] !== 0) continue;
      const x = i % state.width;
      const y = (i - x) / state.width;
      for (let k = 0; k < 3; k++) {
        const px = tileX(view, x + 0.2 + jitter(x, y, k) * 0.6);
        const py = tileY(view, y + 0.2 + jitter(x, y, k + 5) * 0.6);
        g.rect(px - t * 0.12, py - t * 0.1, t * 0.24, t * 0.2);
      }
    }
    g.fill({ color: hex(palette.rockLight), alpha: 0.6 });
    g.stroke({ width: 1, color: hex(palette.rockMid) });

    // Castles: a keep as old maps draw one, battlements along its roof and a gate in
    // its hatched front face.
    for (const castle of state.castles) {
      const owner = castle.islandId - 1;
      const x = tileX(view, castle.x);
      const y = tileY(view, castle.y);
      const w = castle.w * t;
      const h = castle.h * t;
      const inset = t * 0.12;
      const drop = this.castleFace(castle) * t;
      const lip = y + h - inset - drop;
      const dark = this.colour(owner, 'dark');
      g.rect(x + inset, lip, w - inset * 2, drop);
      g.fill({ color: mixed(this.colour(owner, 'base'), hex(palette.rockDark), 0.25) });
      trace(g, [
        ...hatch({ x: x + inset, y: lip, w: w - inset * 2, h: drop }, t * 0.16, '/'),
        ...hatch({ x: x + inset, y: lip, w: w - inset * 2, h: drop }, t * 0.16, '\\'),
      ]);
      g.stroke({ width: 1, color: hex(palette.rockDark), alpha: 0.45 });
      const gate = w * 0.16;
      g.rect(x + w / 2 - gate / 2, lip + drop * 0.25, gate, drop * 0.75);
      g.fill({ color: hex(palette.rockDark) });
      g.rect(x + inset, lip, w - inset * 2, drop);
      g.stroke({ width: ink, color: dark });

      // The roof, with merlons standing along its north edge.
      const top = y + inset + t * 0.2;
      g.rect(x + inset, top, w - inset * 2, lip - top);
      g.fill({ color: this.paper(owner, 0.35) });
      g.stroke({ width: ink, color: dark });
      const merlons = 5;
      const mw = (w - inset * 2) / (merlons * 2 - 1);
      for (let k = 0; k < merlons; k++) {
        g.rect(x + inset + k * 2 * mw, y + inset, mw, t * 0.2);
      }
      g.fill({ color: this.paper(owner, 0.35) });
      g.stroke({ width: 1, color: dark });
    }

    // Guns: a round carriage in the owner's colour. The barrel turns, so it is an effect.
    for (const cannon of state.cannons) {
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = (Math.min(cannon.w, cannon.h) * t) / 2 - t * 0.22;
      g.circle(cx, cy, r);
      g.fill({ color: cannon.active ? this.paper(cannon.owner, 0.5) : hex(palette.grassDark) });
      g.stroke({
        width: ink,
        color: cannon.active ? this.colour(cannon.owner, 'dark') : hex(palette.rockMid),
      });
      if (cannon.active) continue;
      // Silenced: struck through lightly in ink, as a map marks what is lost.
      trace(g, hatch({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, t * 0.3, '/'));
      g.stroke({ width: 1, color: hex(palette.rockMid), alpha: 0.6 });
    }
  }

  /** Inked stone: tops in paper tinted by the owner, blocks outlined, faces cross-hatched. */
  private drawWall(
    g: Graphics,
    view: ViewTransform,
    cells: readonly Cell[],
    joins: (x: number, y: number) => boolean,
    player: number,
    alpha = 1,
  ): void {
    const { palette } = this.art;
    const t = view.tile;
    const wall = wallGeometry(cells, joins, view, this.faceFraction());
    const dark = this.colour(player, 'dark');
    for (const r of wall.tops) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: this.paper(player, 0.45), alpha });
    for (const r of wall.faces) g.rect(r.x, r.y, r.w, r.h);
    g.fill({ color: mixed(this.colour(player, 'base'), hex(palette.rockDark), 0.2), alpha });
    trace(g, [
      ...wall.faces.flatMap((r) => hatch(r, t * 0.16, '/')),
      ...wall.faces.flatMap((r) => hatch(r, t * 0.16, '\\')),
    ]);
    g.stroke({ width: 1, color: hex(palette.rockDark), alpha: 0.4 * alpha });
    // Each stone's outline, fainter than the wall's.
    const inset = Math.max(1, t * 0.1);
    for (const r of wall.tops) g.rect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    g.stroke({ width: 1, color: dark, alpha: 0.4 * alpha });
    trace(g, [...wall.faceEdges, ...wall.rim]);
    g.stroke({ width: this.style.inkWidthPx, color: dark, alpha });
  }

  // ------------------------------------------------------------------ events

  noteShot(shot: Shot): void {
    const angle = this.aims.fire(shot);
    // A puff of ink wash from the muzzle, in place of smoke.
    const reach = 0.95;
    const mx = shot.fromX + 0.5 + Math.sin(angle) * reach;
    const my = shot.fromY + 0.5 - Math.cos(angle) * reach;
    for (let k = 0; k < 4; k++) {
      const spread = angle + (Math.random() - 0.5) * 0.9;
      this.drops.push({
        x: mx,
        y: my,
        vx: Math.sin(spread) * (0.6 + Math.random()),
        vy: -Math.cos(spread) * (0.6 + Math.random()),
        age: 0,
        life: 500 + Math.random() * 300,
        colour: hex(this.art.palette.rockMid),
        gravity: 0,
      });
    }
  }

  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    const inSea =
      this.terrain !== null &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      this.terrain[y * this.width + x] !== Terrain.Land;
    if (inSea) {
      this.ripples.push({ x, y, age: 0 });
      return;
    }
    this.stains = this.stains.filter((s) => s.x !== x || s.y !== y);
    this.stains.push({ x, y, round: this.round, seed: Math.random() * 100 });
    const ink = hex(this.art.palette.rockDark);
    for (let k = 0; k < 8; k++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      this.drops.push({
        x: x + 0.5,
        y: y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        age: 0,
        life: 350 + Math.random() * 300,
        colour: ink,
        gravity: 7,
      });
    }
    for (const block of debris) {
      for (let k = 0; k < this.art.generators.fx.debrisPerTile; k++) {
        this.drops.push({
          x: block.x + 0.5,
          y: block.y + 0.5,
          vx: (Math.random() - 0.5) * 4,
          vy: -2 - Math.random() * 2.5,
          age: 0,
          life: this.art.generators.fx.debrisMs,
          colour: this.paper(block.owner, 0.6),
          gravity: 9,
        });
      }
    }
  }

  noteCrumble(block: Debris): void {
    const colour = block.owner < 0 ? hex(this.art.palette.rockMid) : this.paper(block.owner, 0.45);
    this.fades.push({ x: block.x, y: block.y, age: 0, colour });
  }

  noteLanding(cells: readonly Cell[], owner: number): void {
    this.landings.add(cells, owner);
  }

  // ------------------------------------------------------------------ effects

  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    g.clear();
    this.clock += frame.deltaMs;
    if (state.round !== this.round) {
      this.round = state.round;
      const rounds = this.art.generators.fx.craterRounds;
      this.stains = this.stains.filter((s) => this.round - s.round < rounds);
    }
    this.drawStains(view);
    drawSealGlow(g, view, frame.sealGlow, this.art);
    this.landings.draw(g, view, this.art, frame.deltaMs);
    drawChoices(g, view, frame.choices, this.art);
    this.reloads.draw(
      g,
      view,
      state,
      this.art,
      frame.humanPlayer,
      frame.tickFraction,
      frame.deltaMs,
    );
    this.drawRipples(view, frame.deltaMs);
    this.drawFades(view, frame.deltaMs);
    this.drawBarrels(state, view, frame.deltaMs);
    this.drawSeals(state, view, frame);
    this.drawShots(state, view, frame);
    this.drawDrops(view, frame.deltaMs);
    this.fireworks.draw(g, view, this.art, frame.celebrate, frame.deltaMs);
  }

  /** Ink splashed where shots came down on land, fading over the rounds after. */
  private drawStains(view: ViewTransform): void {
    const g = this.stainGfx;
    g.clear();
    const t = view.tile;
    const rounds = this.art.generators.fx.craterRounds;
    for (const stain of this.stains) {
      const alpha = 0.7 * (1 - (this.round - stain.round) / rounds);
      const cx = tileX(view, stain.x + 0.5);
      const cy = tileY(view, stain.y + 0.5);
      g.circle(cx, cy, t * 0.26);
      for (let k = 0; k < 7; k++) {
        const angle = jitter(stain.seed, k, 1) * Math.PI * 2;
        const d = t * (0.3 + jitter(stain.seed, k, 2) * 0.3);
        g.circle(
          cx + Math.cos(angle) * d,
          cy + Math.sin(angle) * d,
          t * (0.04 + jitter(stain.seed, k, 3) * 0.08),
        );
      }
      g.fill({ color: hex(this.art.palette.craterDark), alpha });
    }
  }

  /** Rings of ink spreading on the water where a shot went in. */
  private drawRipples(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    for (const ripple of this.ripples) {
      ripple.age += deltaMs;
      const cx = tileX(view, ripple.x + 0.5);
      const cy = tileY(view, ripple.y + 0.5);
      for (const lag of [0, 0.3]) {
        const k = ripple.age / RIPPLE_MS - lag;
        if (k <= 0 || k >= 1) continue;
        g.ellipse(cx, cy, view.tile * (0.2 + 0.9 * k), view.tile * (0.12 + 0.55 * k));
        g.stroke({ width: 1.2, color: hex(this.art.palette.waterFoam), alpha: 1 - k });
      }
    }
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE_MS * 1.3);
  }

  /** A block the sweep took, fading off the paper. */
  private drawFades(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const span = this.art.flat.crumbleMs;
    for (const fade of this.fades) {
      fade.age += deltaMs;
      const k = fade.age / span;
      if (k >= 1) continue;
      g.rect(tileX(view, fade.x), tileY(view, fade.y), view.tile, view.tile);
      g.fill({ color: fade.colour, alpha: 1 - k });
    }
    this.fades = this.fades.filter((fade) => fade.age < span);
  }

  /** Barrels in ink, from the carriage toward the last target, kicking back on firing. */
  private drawBarrels(state: MatchState, view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const t = view.tile;
    for (const cannon of state.cannons) {
      const aim = this.aims.of(state, cannon.id);
      if (aim === null) continue;
      aim.firedAgo += deltaMs;
      const kick = Math.max(0, 1 - aim.firedAgo / RECOIL_MS);
      const length = cannon.active ? 0.95 - 0.3 * kick : 0.5;
      const cx = cannon.x + cannon.w / 2;
      const cy = cannon.y + cannon.h / 2;
      const ex = tileX(view, cx + Math.sin(aim.angle) * length);
      const ey = tileY(view, cy - Math.cos(aim.angle) * length);
      const colour = cannon.active
        ? this.colour(cannon.owner, 'dark')
        : hex(this.art.palette.rockMid);
      g.moveTo(tileX(view, cx), tileY(view, cy)).lineTo(ex, ey);
      g.stroke({
        width: Math.max(2, t * (cannon.active ? 0.24 : 0.16)),
        color: colour,
        cap: 'round',
      });
      if (!cannon.active) continue;
      g.circle(ex, ey, t * 0.13);
      g.fill({ color: this.paper(cannon.owner, 0.5) });
      g.stroke({ width: 1, color: colour });
    }
    this.aims.prune(state);
  }

  /**
   * A wax seal in the owner's colour on every sealed castle: pressed on as it seals,
   * from large and faint down onto the roof, and cracked in two and falling away when
   * a breach unseals it. Timed by the flag hoist the other styles fly their flags by.
   */
  private drawSeals(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    this.flags.update(frame.castleSealed, this.clock, this.art);
    for (const castle of state.castles) {
      const raised = this.flags.raised(castle.id, this.clock, this.art);
      if (raised === null) continue;
      const owner = castle.islandId - 1;
      const cx = tileX(view, castle.x + castle.w / 2);
      const cy = tileY(view, castle.y + (castle.h - this.castleFace(castle)) / 2 + 0.1);
      const breaking = this.flags.lowering(castle.id);
      const base = t * 0.5;
      const r = breaking ? base : base * (1 + 1.2 * (1 - raised) * (1 - raised));
      const alpha = breaking ? raised : Math.min(1, raised * 2);
      const apart = breaking ? (1 - raised) * t * 0.3 : 0;
      const wax = this.colour(owner, 'base');
      const rim = this.colour(owner, 'dark');
      for (const side of breaking ? [-1, 1] : [0]) {
        const ox = cx + side * apart;
        const oy = cy + (breaking ? (1 - raised) * t * 0.2 : 0);
        const from = side === 1 ? -Math.PI / 2 : side === -1 ? Math.PI / 2 : 0;
        const to = side === 0 ? Math.PI * 2 : from + Math.PI;
        // The blob of wax, lumpy at its edge where it spread under the stamp.
        g.moveTo(ox, oy);
        g.arc(ox, oy, r, from, to);
        g.closePath();
        g.fill({ color: wax, alpha });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + castle.id;
          if (side !== 0 && Math.sign(Math.sin(a)) !== side) continue;
          g.circle(ox + Math.sin(a) * r * 0.8, oy - Math.cos(a) * r * 0.8, r * 0.32);
        }
        g.fill({ color: wax, alpha });
        // From the arc's own start: a move to the centre drew a spoke to the rim.
        g.moveTo(ox + Math.cos(from) * r * 0.62, oy + Math.sin(from) * r * 0.62);
        g.arc(ox, oy, r * 0.62, from, to);
        g.stroke({ width: 1.2, color: rim, alpha: alpha * 0.9 });
      }
      if (!breaking) {
        // The impression in the wax: a small star.
        const s = r * 0.32;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          g.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s);
          g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        }
        g.stroke({ width: 1.2, color: rim, alpha });
      }
    }
  }

  /** Shots as ink dots on a dotted course, like a route marked on a map. */
  private drawShots(state: MatchState, view: ViewTransform, frame: EffectFrame): void {
    const g = this.effectGfx;
    const t = view.tile;
    const now = state.tick + frame.tickFraction;
    for (const shot of state.shots) {
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      const at = (tk: number): { x: number; y: number } => ({
        x: tileX(view, shot.fromX + (shot.toX - shot.fromX) * tk + 0.5),
        y: tileY(view, shot.fromY + (shot.toY - shot.fromY) * tk + 0.5 - shotLift(shot, tk)),
      });
      const ink = this.colour(shot.owner, 'dark');
      const distance = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
      const step = distance > 0 ? 0.4 / distance : 1;
      for (let k = 1; k <= 7; k++) {
        const tk = p - step * k;
        if (tk <= 0) break;
        const d = at(tk);
        g.circle(d.x, d.y, Math.max(0.8, t * 0.05));
      }
      g.fill({ color: ink, alpha: 0.6 });
      const height = Math.min(1, shotLift(shot, p) / 3);
      const gx = tileX(view, shot.fromX + (shot.toX - shot.fromX) * p + 0.5);
      const gy = tileY(view, shot.fromY + (shot.toY - shot.fromY) * p + 0.5);
      g.circle(gx, gy, t * 0.14 * (1 - 0.4 * height));
      g.fill({ color: hex(this.art.palette.shadow), alpha: 0.25 - 0.1 * height });
      const head = at(p);
      g.circle(head.x, head.y, t * (0.15 + 0.07 * height));
      g.fill({ color: ink });
      drawShotTarget(g, view, state, shot, p, this.art, frame.humanPlayer);
    }
  }

  /** Drops of ink and chips of stone flying, and gun smoke drifting as washes of ink. */
  private drawDrops(view: ViewTransform, deltaMs: number): void {
    const g = this.effectGfx;
    const dt = deltaMs / 1000;
    for (const d of this.drops) {
      d.age += deltaMs;
      const drag = Math.exp(-2.5 * dt);
      d.vx *= drag;
      d.vy = d.vy * drag + d.gravity * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const k = d.age / d.life;
      if (k >= 1) continue;
      const size =
        d.gravity === 0 ? view.tile * (0.12 + 0.25 * k) : Math.max(1.2, view.tile * 0.08);
      g.circle(tileX(view, d.x), tileY(view, d.y), size);
      g.fill({ color: d.colour, alpha: (d.gravity === 0 ? 0.35 : 0.9) * (1 - k) });
    }
    this.drops = this.drops.filter((d) => d.age < d.life);
  }

  // ------------------------------------------------------------------ overlay

  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void {
    const g = this.overlayGfx;
    g.clear();
    const t = view.tile;
    const { palette } = this.art;
    drawOvertimeBorder(g, state, view, this.art, performance.now());
    drawSelectable(g, view, ghost, this.art, performance.now());
    drawBuildHints(g, view, ghost, this.art, performance.now());
    if (!ghost.tile) return;
    const anchor = ghost.tile;

    if (state.phase === 'build' && ghost.cells.length > 0) {
      const cells = ghost.cells.map(([ox, oy]) => ({ x: anchor.x + ox, y: anchor.y + oy }));
      const inPiece = new Set(cells.map((c) => `${c.x},${c.y}`));
      const inside = (x: number, y: number): boolean => inPiece.has(`${x},${y}`);
      if (ghost.valid) {
        // The wall it would make, joined to the player's own, faces and all.
        const standing = (x: number, y: number): boolean =>
          x >= 0 &&
          y >= 0 &&
          x < state.width &&
          y < state.height &&
          state.structure[y * state.width + x] === Structure.Wall &&
          state.owner[y * state.width + x] === humanPlayer + 1;
        this.drawWall(g, view, cells, (x, y) => inside(x, y) || standing(x, y), humanPlayer, 0.8);
      } else {
        // Hollow where it does not fit, so it differs in form, not only in hue.
        for (const c of cells) g.rect(tileX(view, c.x), tileY(view, c.y), t, t);
        g.fill({ color: hex(palette.uiInvalid), alpha: 0.12 });
      }
      trace(g, outline(cells, inside, view));
      g.stroke(
        ghost.valid
          ? { width: 1, color: hex(palette.uiValid), alpha: 0.9 }
          : { width: 2, color: hex(palette.uiInvalid) },
      );
      return;
    }

    if (state.phase === 'cannon_place' && ghost.footprint) {
      const colour = ghost.valid ? hex(palette.uiValid) : hex(palette.uiInvalid);
      const cx = tileX(view, anchor.x + ghost.footprint.w / 2);
      const cy = tileY(view, anchor.y + ghost.footprint.h / 2);
      const r = (Math.min(ghost.footprint.w, ghost.footprint.h) * t) / 2 - t * 0.22;
      g.circle(cx, cy, r);
      g.fill({ color: colour, alpha: 0.15 });
      g.stroke({ width: 2, color: colour });
      if (!ghost.valid) {
        const d = r * Math.SQRT1_2;
        g.moveTo(cx - d, cy + d).lineTo(cx + d, cy - d);
        g.stroke({ width: 2, color: colour });
      }
      return;
    }

    drawAimLine(g, view, state, ghost, this.art, humanPlayer);
    if (ghost.aiming) drawFireReticle(g, view, ghost, this.art, humanPlayer);
  }
}
