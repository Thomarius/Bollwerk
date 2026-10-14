import type { ArtConfig, SpecialKind } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
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
 */

/** Each emblem as a polygon in a unit box, its top left at 0,0: simple shapes a tile wide. */
const EMBLEMS: Record<SpecialKind, readonly (readonly number[])[]> = {
  // A heavy shell standing on its base.
  bertha: [
    [0.32, 1, 0.68, 1, 0.68, 0.46, 0.62, 0.24, 0.5, 0.04, 0.38, 0.24, 0.32, 0.46],
    [0.26, 1, 0.74, 1, 0.74, 0.86, 0.26, 0.86],
  ],
  // A hammer: its head, and the handle under it.
  architect: [
    [0.12, 0.1, 0.88, 0.1, 0.88, 0.4, 0.12, 0.4],
    [0.41, 0.4, 0.59, 0.4, 0.59, 1, 0.41, 1],
  ],
  // Two chevrons, pointing up: speed.
  rapid: [
    [0.1, 0.42, 0.5, 0, 0.9, 0.42, 0.9, 0.62, 0.5, 0.22, 0.1, 0.62],
    [0.1, 0.8, 0.5, 0.38, 0.9, 0.8, 0.9, 1, 0.5, 0.6, 0.1, 1],
  ],
};

/**
 * An emblem's badge: a dark disc this wide, in tiles, its centre this far below its gun's
 * foot, the emblem inside it at `INNER` of its width. Bare shapes in the owner's colour
 * read as their outline alone at a tile of 16 pixels, and vanished on a ground of the same
 * colour; on the disc they read in every style.
 */
const BADGE = 1.05;
const DROP = 0.05;
const INNER = 0.68;

function drawEmblem(
  g: Graphics,
  view: ViewTransform,
  kind: SpecialKind,
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

export class TowerMarks {
  readonly root = new Container({ label: 'towers' });
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
    this.root.addChild(this.emblems, this.effects, this.ghost);
  }

  /** Every tower's emblem: its owner's light colour while it fires, stone grey while inert. */
  draw(state: MatchState, view: ViewTransform, art: ArtConfig): void {
    let key = `${viewKey(view)}|${art.players.map((p) => p.light).join(',')}`;
    for (const c of state.cannons) {
      if (c.kind !== 'cannon')
        key += `|${c.kind}${c.owner}:${c.x},${c.y},${c.w},${c.h},${c.active}`;
    }
    if (key === this.key) return;
    this.key = key;
    clearDrawn(this.emblems);
    for (const c of state.cannons) {
      if (c.kind === 'cannon') continue;
      const fill = c.active ? playerColour(art, c.owner, 'light') : 0x9a9aa4;
      drawEmblem(this.emblems, view, c.kind, c.x, c.y, c.w, c.h, fill);
    }
  }

  /** The emblem on the cannon ghost while it would place the player's tower. */
  drawGhost(view: ViewTransform, ghost: Ghost, art: ArtConfig, humanPlayer: number): void {
    clearDrawn(this.ghost);
    const kind = ghost.tower;
    if (kind === null || kind === undefined || ghost.tile === null || ghost.footprint === null) {
      return;
    }
    const { w, h } = ghost.footprint;
    const fill = ghost.valid ? playerColour(art, humanPlayer, 'light') : 0x9a9aa4;
    drawEmblem(this.ghost, view, kind, ghost.tile.x, ghost.tile.y, w, h, fill, 0.85);
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
