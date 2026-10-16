import { variantCost, variantKind, type ArtConfig, type SpecialKind } from '@bollwerk/config';
import { inRepairReach, repairRadiusOf, type MatchState } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { EMBLEMS } from '../towerIcons.js';
import { clearDrawn } from './clearDrawn.js';
import { viewKey } from './stamps.js';
import {
  IMPACT_GLOW,
  playerColour,
  tileX,
  tileY,
  type Ghost,
  type ViewTransform,
} from './theme.js';

/**
 * The special towers on the board (docs/SPECIAL_TOWERS.md §3.4), one layer over both looks,
 * as the main castle's crown is one mark in every style: each style draws a tower as its own
 * cannon, and this puts the tower's emblem at its foot, in its owner's colour from the look in
 * front. Also the ghost's emblem while the right button has switched to the tower, and the
 * towers' effects — Big Bertha's blast, the Architect's walls coming back — generic and cheap:
 * nothing is drawn while none of it is going on.
 *
 * And what a tower will do, shown where it is decided (play-testing, 2026-10-16): the player's
 * own Architects' reach outlined faintly while they build and place guns — the circle was
 * invisible, so nobody knew which walls would come back — and the ghost's while placing one;
 * while a Big Bertha is ready, her cross outlined under the cursor and flames round it.
 */

/**
 * An emblem's badge: a dark disc this wide, in tiles, its centre this far below its gun's
 * foot, the emblem inside it at `INNER` of its width. Bare shapes in the owner's colour
 * read as their outline alone at a tile of 16 pixels, and vanished on a ground of the same
 * colour; on the disc they read in every style.
 */
const BADGE = 1.05;
const DROP = 0.05;
const INNER = 0.68;
/**
 * The cost's pips under the badge, one a cannon it cost (every tower comes at two costs,
 * 2026-10-16): each this wide in tiles, this far apart, on a dark backing as the badge is.
 */
const PIP = 0.17;
const PIP_GAP = 0.27;

function drawEmblem(
  g: Graphics,
  view: ViewTransform,
  kind: SpecialKind,
  cost: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  alpha = 1,
): void {
  const cx = tileX(view, x + w / 2);
  const cy = tileY(view, y + h) + view.tile * DROP;
  const radius = (view.tile * BADGE) / 2;
  g.circle(cx, cy, radius);
  g.fill({ color: 0x0a0a12, alpha: 0.82 * alpha });
  g.stroke({ width: Math.max(1, view.tile / 14), color: fill, alpha });
  const size = radius * 2 * INNER;
  const left = cx - size / 2;
  const top = cy - size / 2;
  for (const part of EMBLEMS[kind]) {
    const points: number[] = [];
    for (let i = 0; i < part.length; i += 2) {
      points.push(left + (part[i] as number) * size, top + (part[i + 1] as number) * size);
    }
    g.poly(points);
    g.fill({ color: fill, alpha });
  }
  const pip = (view.tile * PIP) / 2;
  const py = cy + radius + pip * 0.6;
  const first = cx - ((cost - 1) * view.tile * PIP_GAP) / 2;
  for (let k = 0; k < cost; k++) g.circle(first + k * view.tile * PIP_GAP, py, pip * 1.55);
  g.fill({ color: 0x0a0a12, alpha: 0.82 * alpha });
  for (let k = 0; k < cost; k++) g.circle(first + k * view.tile * PIP_GAP, py, pip);
  g.fill({ color: fill, alpha });
}

/** A Big Bertha's blast as it plays: where, and how far through. */
interface Blast {
  x: number;
  y: number;
  ms: number;
}

/** Walls an Architect rebuilt, shimmering as they come back. */
interface Repair {
  tiles: readonly number[];
  width: number;
  colour: number;
  ms: number;
}

const BLAST_MS = 520;
const REPAIR_MS = 900;

/**
 * Outlines a set of tiles, given as `y * width + x`: the edges between a tile in the set and
 * one out of it, so a reach or a crater reads as one shape rather than a grid of squares.
 */
function outlineTiles(
  g: Graphics,
  view: ViewTransform,
  tiles: ReadonlySet<number>,
  width: number,
): void {
  const has = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && tiles.has(y * width + x);
  for (const i of tiles) {
    const x = i % width;
    const y = (i - x) / width;
    const [left, top, right, bottom] = [
      tileX(view, x),
      tileY(view, y),
      tileX(view, x + 1),
      tileY(view, y + 1),
    ];
    if (!has(x, y - 1)) g.moveTo(left, top).lineTo(right, top);
    if (!has(x, y + 1)) g.moveTo(left, bottom).lineTo(right, bottom);
    if (!has(x - 1, y)) g.moveTo(left, top).lineTo(left, bottom);
    if (!has(x + 1, y)) g.moveTo(right, top).lineTo(right, bottom);
  }
}

/** The tiles of an island an Architect standing here, at this cost, would rebuild. */
function reachOf(
  state: MatchState,
  island: number,
  footprint: { x: number; y: number; w: number; h: number },
  cost: number,
  into: Set<number>,
): void {
  const r = repairRadiusOf(state.ruleset, cost);
  const out = Math.ceil(r);
  for (
    let y = Math.max(0, footprint.y - out);
    y < Math.min(state.height, footprint.y + footprint.h + out);
    y++
  ) {
    for (
      let x = Math.max(0, footprint.x - out);
      x < Math.min(state.width, footprint.x + footprint.w + out);
      x++
    ) {
      const i = y * state.width + x;
      if (state.islandId[i] === island && inRepairReach(footprint, r, x, y)) into.add(i);
    }
  }
}

/** Phases whose player plans walls, where an Architect's reach is worth seeing. */
const REACH_PHASES: ReadonlySet<string> = new Set(['cannon_place', 'build']);

/** Big Bertha's flames: tongues round the cursor's ring, flickering on beats of their own. */
const FLAMES = 12;
const FLAME_OUTER = 0xff5a1f;
const FLAME_INNER = 0xffd23f;

function drawFlames(g: Graphics, cx: number, cy: number, r: number, nowMs: number): void {
  const t = motionReduced() ? 0 : nowMs;
  g.circle(cx, cy, r);
  g.stroke({ width: r * 0.22, color: FLAME_OUTER, alpha: 0.3 });
  const half = (Math.PI / FLAMES) * 0.9;
  for (const [colour, alpha, reach, narrow] of [
    [FLAME_OUTER, 0.85, 1, 1],
    [FLAME_INNER, 0.95, 0.5, 0.5],
  ] as const) {
    for (let k = 0; k < FLAMES; k++) {
      const a = (k / FLAMES) * Math.PI * 2;
      const flicker = 0.5 + 0.5 * Math.sin(t * 0.013 + k * 1.7) * Math.cos(t * 0.007 + k * 2.3);
      // Fire rises: the tongues over the ring are the longest, those under it short, and
      // every tip bends upward and sways, so the ring burns rather than shines.
      const upness = 0.5 - 0.5 * Math.sin(a);
      const length = r * reach * (0.32 + 0.38 * flicker) * (0.55 + 0.9 * upness);
      const sway = r * 0.12 * Math.sin(t * 0.009 + k * 1.3);
      const w = half * narrow;
      const [bx, by] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const tipX = bx + Math.cos(a) * length * 0.45 + sway;
      const tipY = by + Math.sin(a) * length * 0.45 - length * 0.75;
      const [lx, ly] = [cx + Math.cos(a - w) * r, cy + Math.sin(a - w) * r];
      const [rx, ry] = [cx + Math.cos(a + w) * r, cy + Math.sin(a + w) * r];
      g.moveTo(lx, ly);
      g.quadraticCurveTo(lx + (tipX - bx) * 0.3, ly + (tipY - by) * 0.6, tipX, tipY);
      g.quadraticCurveTo(rx + (tipX - bx) * 0.3, ry + (tipY - by) * 0.6, rx, ry);
      g.closePath();
    }
    g.fill({ color: colour, alpha });
  }
}

export class TowerMarks {
  readonly root = new Container({ label: 'towers' });
  /** The player's Architects' reach, drawn again only when it changes. */
  private readonly reach = new Graphics();
  private reachKey = '';
  /**
   * The reach shown whatever the phase: the tower menu's preview plays a combat, and the
   * Architect's circle is what it is there to show.
   */
  reachAlways = false;
  /** The towers' emblems, drawn again only when one changes. */
  private readonly emblems = new Graphics();
  /** The ghost's emblem, every frame while there is one. */
  private readonly ghost = new Graphics();
  /** The effects, every frame while any plays. */
  private readonly effects = new Graphics();
  private key = '';
  private blasts: Blast[] = [];
  private repairs: Repair[] = [];

  constructor() {
    this.root.addChild(this.reach, this.emblems, this.effects, this.ghost);
  }

  /** Every tower's emblem: its owner's light colour while it fires, stone grey while inert. */
  draw(state: MatchState, view: ViewTransform, art: ArtConfig, humanPlayer: number): void {
    this.drawReach(state, view, art, humanPlayer);
    let key = `${viewKey(view)}|${art.players.map((p) => p.light).join(',')}`;
    for (const c of state.cannons) {
      if (c.kind !== 'cannon')
        key += `|${c.kind}${c.cost}${c.owner}:${c.x},${c.y},${c.w},${c.h},${c.active}`;
    }
    if (key === this.key) return;
    this.key = key;
    clearDrawn(this.emblems);
    for (const c of state.cannons) {
      if (c.kind === 'cannon') continue;
      const fill = c.active ? playerColour(art, c.owner, 'light') : 0x9a9aa4;
      drawEmblem(this.emblems, view, c.kind, c.cost, c.x, c.y, c.w, c.h, fill);
    }
  }

  /**
   * The player's own Architects' reach while they place guns and build, a faint line in their
   * colour round the island's tiles it covers — grey for one standing inert, which rebuilds
   * nothing. Only their own: everyone's would clutter the busy styles (the user's, 2026-10-16).
   */
  private drawReach(state: MatchState, view: ViewTransform, art: ArtConfig, human: number): void {
    const player = state.players[human];
    const shown =
      player !== undefined &&
      !player.eliminated &&
      (this.reachAlways || REACH_PHASES.has(state.phase));
    let key = shown ? `${viewKey(view)}|${playerColour(art, human, 'light')}` : '';
    if (shown) {
      for (const c of state.cannons) {
        if (c.owner === human && c.kind === 'architect')
          key += `|${c.cost}:${c.x},${c.y},${c.active}`;
      }
    }
    if (key === this.reachKey) return;
    this.reachKey = key;
    clearDrawn(this.reach);
    if (!shown) return;
    const active = new Set<number>();
    const inert = new Set<number>();
    for (const c of state.cannons) {
      if (c.owner !== human || c.kind !== 'architect') continue;
      reachOf(state, player.islandId, c, c.cost, c.active ? active : inert);
    }
    for (const i of active) inert.delete(i);
    const width = Math.max(1, view.tile / 12);
    outlineTiles(this.reach, view, inert, state.width);
    this.reach.stroke({ width, color: 0x9a9aa4, alpha: 0.4 });
    outlineTiles(this.reach, view, active, state.width);
    this.reach.stroke({ width, color: playerColour(art, human, 'light'), alpha: 0.55 });
  }

  /**
   * Every frame: the emblem on the cannon ghost while it would place the player's tower, with
   * an Architect's reach from there; while a Big Bertha is ready, her cross and her flames.
   */
  drawGhost(
    state: MatchState,
    view: ViewTransform,
    ghost: Ghost,
    art: ArtConfig,
    humanPlayer: number,
  ): void {
    clearDrawn(this.ghost);
    this.drawBertha(state, view, ghost);
    const variant = ghost.tower;
    if (
      variant === null ||
      variant === undefined ||
      ghost.tile === null ||
      ghost.footprint === null
    ) {
      return;
    }
    const { w, h } = ghost.footprint;
    const fill = ghost.valid ? playerColour(art, humanPlayer, 'light') : 0x9a9aa4;
    const [kind, cost] = [variantKind(variant), variantCost(variant)];
    const player = state.players[humanPlayer];
    if (kind === 'architect' && player !== undefined) {
      const tiles = new Set<number>();
      reachOf(state, player.islandId, { ...ghost.tile, w, h }, cost, tiles);
      outlineTiles(this.ghost, view, tiles, state.width);
      this.ghost.stroke({ width: Math.max(1, view.tile / 10), color: fill, alpha: 0.75 });
    }
    drawEmblem(this.ghost, view, kind, cost, ghost.tile.x, ghost.tile.y, w, h, fill, 0.85);
  }

  /** A ready Big Bertha's cross under the cursor, the tiles her shot would clear, and flames. */
  private drawBertha(state: MatchState, view: ViewTransform, ghost: Ghost): void {
    const next = ghost.nextTower;
    if (!ghost.aiming || ghost.tile === null || next?.kind !== 'bertha') return;
    if (ghost.impact?.ready !== true) return;
    const { x, y } = ghost.tile;
    if (ghost.valid) {
      const tiles = new Set<number>();
      for (const [dx, dy] of next.crater) {
        const [tx, ty] = [x + dx, y + dy];
        if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
        tiles.add(ty * state.width + tx);
        this.ghost.rect(tileX(view, tx), tileY(view, ty), view.tile, view.tile);
      }
      this.ghost.fill({ color: IMPACT_GLOW, alpha: 0.16 });
      outlineTiles(this.ghost, view, tiles, state.width);
      this.ghost.stroke({ width: Math.max(1.5, view.tile / 9), color: IMPACT_GLOW, alpha: 0.9 });
    }
    drawFlames(
      this.ghost,
      tileX(view, x + 0.5),
      tileY(view, y + 0.5),
      view.tile * 1.1,
      performance.now(),
    );
  }

  /** A Big Bertha's shot has landed here. */
  noteBlast(x: number, y: number): void {
    this.blasts.push({ x, y, ms: 0 });
  }

  /** An Architect has rebuilt these walls, of a board this wide, for this player. */
  noteRepair(tiles: readonly number[], width: number, colour: number): void {
    this.repairs.push({ tiles, width, colour, ms: 0 });
  }

  drawEffects(view: ViewTransform, deltaMs: number): void {
    if (this.blasts.length === 0 && this.repairs.length === 0) {
      clearDrawn(this.effects);
      return;
    }
    const g = this.effects;
    g.clear();
    // Under reduced motion each flashes once, held, rather than spreading or rising.
    const still = motionReduced();
    for (const blast of this.blasts) {
      blast.ms += deltaMs;
      const t = Math.min(1, blast.ms / BLAST_MS);
      const cx = tileX(view, blast.x + 0.5);
      const cy = tileY(view, blast.y + 0.5);
      // The crater's cross, flashing, and a ring spreading past it.
      const fade = 1 - t;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        g.rect(tileX(view, blast.x + dx), tileY(view, blast.y + dy), view.tile, view.tile);
      }
      g.fill({ color: IMPACT_GLOW, alpha: 0.45 * fade });
      const r = view.tile * (still ? 1.6 : 0.6 + 1.6 * t);
      g.circle(cx, cy, r);
      g.stroke({ width: Math.max(2, view.tile * 0.22 * fade), color: IMPACT_GLOW, alpha: fade });
    }
    for (const repair of this.repairs) {
      repair.ms += deltaMs;
      const t = Math.min(1, repair.ms / REPAIR_MS);
      const fade = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      const rise = still ? 0 : (1 - t) * view.tile * 0.5;
      for (const i of repair.tiles) {
        const x = i % repair.width;
        const y = (i - x) / repair.width;
        const inset = view.tile * 0.08;
        g.rect(
          tileX(view, x) + inset,
          tileY(view, y) + inset - rise,
          view.tile - 2 * inset,
          view.tile - 2 * inset,
        );
      }
      g.stroke({ width: Math.max(1.5, view.tile * 0.12), color: 0xffffff, alpha: 0.9 * fade });
      for (const i of repair.tiles) {
        const x = i % repair.width;
        const y = (i - x) / repair.width;
        g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
      }
      g.fill({ color: repair.colour, alpha: 0.35 * fade });
    }
    this.blasts = this.blasts.filter((b) => b.ms < BLAST_MS);
    this.repairs = this.repairs.filter((r) => r.ms < REPAIR_MS);
  }
}
