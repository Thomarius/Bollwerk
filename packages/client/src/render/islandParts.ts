import type { MatchState } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { release } from './release.js';
import type { ViewTransform } from './theme.js';

/**
 * A theme's structures drawn an island to a `Graphics` (PLAN 11.22), so a shot landing
 * redraws the island it hit rather than all of them. Drawn whole, Oktoberfest's walls at
 * eight players were 200 000 vertices cut into triangles at every hit — a frame of 50 to
 * 100 ms, the stutter players felt in combat.
 *
 * `drawPart` is the theme's old drawing of the whole board, given a board holding one
 * island's structures, castles and guns; it must depend on nothing else but the view,
 * since a part whose own cells have not changed is not drawn again. Walls never touch
 * across islands, which the sea separates, so a wall's neighbours are all in its part.
 * Part 0 holds whatever stands on no island.
 *
 * The same serves sealed ground, `of: 'territory'`: there the board holds one island's
 * territory, and its `islandId` only that island's cells, so a knocked-out player's island
 * is dimmed once, by its own part (`dimEliminated`).
 *
 * A style drawing its structures in several layers — Cyberpunk's additive glow under its
 * walls — asks for that many: each layer is a container of its own, holding that layer
 * of every island, so all the glow stays under all the walls as before.
 */
export class IslandParts {
  readonly containers: Container[];
  private parts: { layers: Graphics[]; key: string }[] = [];
  private cells: number[][] = [];
  private islandsOf: Uint8Array | null = null;
  private viewKey = '';

  private readonly of: 'structures' | 'territory';

  constructor(layers = 1, of: 'structures' | 'territory' = 'structures') {
    this.of = of;
    this.containers = Array.from({ length: layers }, () => new Container());
  }

  /** The first layer's container, which is all of it for a style drawing in one. */
  get container(): Container {
    return this.containers[0] as Container;
  }

  draw(
    state: MatchState,
    view: ViewTransform,
    drawPart: (g: Graphics, part: MatchState, layers: readonly Graphics[]) => void,
  ): void {
    if (state.islandId !== this.islandsOf) this.layout(state);
    const viewKey = `${view.tile}|${view.originX}|${view.originY}|${view.width}|${view.height}|${state.players.map((p) => p.eliminated).join()}`;
    const viewChanged = viewKey !== this.viewKey;
    this.viewKey = viewKey;
    const islandAt = (x: number, y: number): number =>
      (state.islandId[Math.floor(y) * state.width + Math.floor(x)] as number | undefined) ?? 0;

    for (let part = 0; part < this.cells.length; part++) {
      const cells = this.cells[part] as number[];
      const castles = state.castles.filter((c) => islandAt(c.x, c.y) === part);
      const cannons = state.cannons.filter((c) => islandAt(c.x, c.y) === part);
      // FNV-1a over the part's cells as they stand, then its castles and guns.
      let hash = 0x811c9dc5;
      if (this.of === 'territory') {
        for (const i of cells) hash = Math.imul(hash ^ (state.territory[i] as number), 0x01000193);
      } else {
        for (const i of cells) {
          hash = Math.imul(hash ^ (state.structure[i] as number), 0x01000193);
          hash = Math.imul(hash ^ (state.owner[i] as number), 0x01000193);
        }
      }
      const key = `${hash >>> 0}|${JSON.stringify(castles)}|${JSON.stringify(cannons)}`;
      const entry = this.parts[part] as { layers: Graphics[]; key: string };
      if (!viewChanged && key === entry.key) continue;
      entry.key = key;
      for (const g of entry.layers) g.clear();
      drawPart(
        entry.layers[0] as Graphics,
        this.partOf(state, cells, castles, cannons),
        entry.layers,
      );
    }
  }

  /** The board with one part's cells in it, and nothing of the others'. */
  private partOf(
    state: MatchState,
    cells: readonly number[],
    castles: MatchState['castles'],
    cannons: MatchState['cannons'],
  ): MatchState {
    if (this.of === 'territory') {
      const territory = new Uint8Array(state.territory.length);
      const islandId = new Uint8Array(state.islandId.length);
      for (const i of cells) {
        territory[i] = state.territory[i] as number;
        islandId[i] = state.islandId[i] as number;
      }
      return { ...state, territory, islandId, castles, cannons };
    }
    const structure = new Uint8Array(state.structure.length);
    for (const i of cells) structure[i] = state.structure[i] as number;
    return { ...state, structure, castles, cannons };
  }

  /** Which cells make each part, measured again for a new board. */
  private layout(state: MatchState): void {
    this.islandsOf = state.islandId;
    let islands = 0;
    for (const id of state.islandId) islands = Math.max(islands, id);
    this.cells = Array.from({ length: islands + 1 }, () => []);
    for (let i = 0; i < state.islandId.length; i++) {
      (this.cells[state.islandId[i] as number] as number[]).push(i);
    }
    for (const p of this.parts) for (const g of p.layers) g.destroy();
    this.parts = this.cells.map(() => ({
      layers: this.containers.map(() => new Graphics()),
      key: '',
    }));
    this.containers.forEach((c, n) => {
      c.removeChildren();
      c.addChild(...this.parts.map((p) => p.layers[n] as Graphics));
    });
  }

  destroy(): void {
    for (const c of this.containers) release(c);
  }
}
