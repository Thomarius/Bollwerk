import type { SceneryConfig } from '@rampart/config';
import { Rng, Structure, Terrain, type MatchState } from '@rampart/sim';

import type { Cell } from './theme.js';

/**
 * What stands on open land: copses of broadleaf trees and pines with bushes at their
 * edges, and here and there a lone tree, bush or boulder. Every style draws its own —
 * trees in Pixel art, plan symbols in Blueprint, inked trees in Parchment, lit nodes in
 * Cyberpunk, a faint dot in Minimal — from the one placement, so the looks agree as a
 * banner swaps them.
 *
 * Display only, and **it must never read as wall**: it is round, green or faint where
 * wall is square and in its owner's colour, and it is gone from any tile once built on.
 */
export type SceneryKind = 'tree' | 'pine' | 'bush' | 'rock';

export interface SceneryItem extends Cell {
  kind: SceneryKind;
  /** For drawing variety: which of a kind's variants, and a little offset in the tile. */
  variant: number;
  /** The tile it stands on, as an index into the board. */
  index: number;
}

/**
 * Where the scenery goes on this map, from its seed alone, so every look places it alike
 * and a replay shows the same. Only on land a step in from the coast, since a tree on the
 * beach looked washed up, and not on or beside a castle.
 */
export function placeScenery(state: MatchState, config: SceneryConfig): SceneryItem[] {
  const { width: w, height: h, terrain } = state;
  const land = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === Terrain.Land;
  const nearCastle = new Uint8Array(w * h);
  for (const castle of state.castles) {
    for (let y = castle.y - 1; y < castle.y + castle.h + 1; y++) {
      for (let x = castle.x - 1; x < castle.x + castle.w + 1; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) nearCastle[y * w + x] = 1;
      }
    }
  }
  const open = (x: number, y: number): boolean =>
    land(x, y) &&
    land(x + 1, y) &&
    land(x - 1, y) &&
    land(x, y + 1) &&
    land(x, y - 1) &&
    nearCastle[y * w + x] === 0;

  const candidates: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (open(x, y)) candidates.push({ x, y });
  if (candidates.length === 0) return [];

  const rng = new Rng((state.seed ^ 0x5cee4e) >>> 0);
  const items = new Map<number, SceneryItem>();
  const put = (x: number, y: number, kind: SceneryKind): void => {
    const index = y * w + x;
    if (!open(x, y) || items.has(index)) return;
    items.set(index, { x, y, kind, variant: rng.nextInt(4), index });
  };

  // Copses: a centre, and tiles round it filled more thinly toward the edge.
  const copses = Math.round((candidates.length * config.clustersPerHundredTiles) / 100);
  const reach = Math.ceil(config.clusterRadiusTiles);
  for (let k = 0; k < copses; k++) {
    const centre = candidates[rng.nextInt(candidates.length)] as Cell;
    const pines = rng.nextFloat() < 0.4;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy) / config.clusterRadiusTiles;
        if (d > 1 || rng.nextFloat() > config.clusterFill * (1 - d * 0.6)) continue;
        const kind: SceneryKind =
          d > 0.7 && rng.nextFloat() < 0.5 ? 'bush' : pines ? 'pine' : 'tree';
        put(centre.x + dx, centre.y + dy, kind);
      }
    }
  }
  // And a few standing alone.
  const singles = Math.round((candidates.length * config.singlesPerHundredTiles) / 100);
  for (let k = 0; k < singles; k++) {
    const at = candidates[rng.nextInt(candidates.length)] as Cell;
    const roll = rng.nextFloat();
    put(at.x, at.y, roll < 0.3 ? 'rock' : roll < 0.65 ? 'bush' : 'tree');
  }
  return [...items.values()].sort((a, b) => a.index - b.index);
}

/**
 * One look's scenery through a match: placed once for the map, and cleared from a tile
 * for good once anything is built on it or it is sealed — cleared ground stays cleared,
 * so nothing grows back as a wall comes down or a breach opens. Each look keeps its own,
 * since a hidden look catches up only as a wipe reveals it.
 */
export class SceneryTracker {
  private items: SceneryItem[] = [];
  private key = '';
  private readonly cleared = new Set<number>();
  /** What was drawn last, which is what a landing piece can be seen to clear. */
  private drawn = new Set<number>();

  /**
   * Brings the scenery up to the board, returning whether anything must be redrawn.
   * `territory` is what this look shows as sealed, which may be held from before combat.
   */
  sync(state: MatchState, config: SceneryConfig): boolean {
    const key = `${state.seed}:${state.width}x${state.height}`;
    let changed = false;
    if (key !== this.key) {
      this.key = key;
      this.items = placeScenery(state, config);
      this.cleared.clear();
      this.drawn = new Set();
      changed = true;
    }
    for (const item of this.items) {
      if (this.cleared.has(item.index)) continue;
      if (
        state.structure[item.index] !== Structure.Empty ||
        (state.territory[item.index] as number) > 0
      ) {
        this.cleared.add(item.index);
        changed = true;
      }
    }
    return changed;
  }

  /** What stands now, in board order; noted as drawn. */
  visible(): SceneryItem[] {
    const shown = this.items.filter((item) => !this.cleared.has(item.index));
    this.drawn = new Set(shown.map((item) => item.index));
    return shown;
  }

  /**
   * A piece has landed on `cells`: what of the scenery drawn there it clears, each item
   * once, for the look to throw up a puff. Landings reach a look before its redraw, and
   * only a look on screen is told of them, so a hidden look never puffs for a tree it
   * was never seen to have.
   */
  take(cells: readonly Cell[], width: number): SceneryItem[] {
    const taken: SceneryItem[] = [];
    for (const cell of cells) {
      const index = cell.y * width + cell.x;
      if (!this.drawn.delete(index)) continue;
      const item = this.items.find((it) => it.index === index);
      if (item !== undefined) taken.push(item);
    }
    return taken;
  }
}
