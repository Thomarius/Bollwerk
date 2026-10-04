import type { MatchState } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

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
 */
export class IslandParts {
  readonly container = new Container();
  private parts: { g: Graphics; key: string }[] = [];
  private cells: number[][] = [];
  private islandsOf: Uint8Array | null = null;
  private viewKey = '';

  draw(
    state: MatchState,
    view: ViewTransform,
    drawPart: (g: Graphics, part: MatchState) => void,
  ): void {
    if (state.islandId !== this.islandsOf) this.layout(state);
    const viewKey = `${view.tile}|${view.originX}|${view.originY}|${view.width}|${view.height}|${state.players.length}`;
    const viewChanged = viewKey !== this.viewKey;
    this.viewKey = viewKey;
    const islandAt = (x: number, y: number): number =>
      (state.islandId[Math.floor(y) * state.width + Math.floor(x)] as number | undefined) ?? 0;

    for (let part = 0; part < this.cells.length; part++) {
      const cells = this.cells[part] as number[];
      const castles = state.castles.filter((c) => islandAt(c.x, c.y) === part);
      const cannons = state.cannons.filter((c) => islandAt(c.x, c.y) === part);
      // FNV-1a over the part's structure and owners, then its castles and guns as they stand.
      let hash = 0x811c9dc5;
      for (const i of cells) {
        hash = Math.imul(hash ^ (state.structure[i] as number), 0x01000193);
        hash = Math.imul(hash ^ (state.owner[i] as number), 0x01000193);
      }
      const key = `${hash >>> 0}|${JSON.stringify(castles)}|${JSON.stringify(cannons)}`;
      const entry = this.parts[part] as { g: Graphics; key: string };
      if (!viewChanged && key === entry.key) continue;
      entry.key = key;
      const structure = new Uint8Array(state.structure.length);
      for (const i of cells) structure[i] = state.structure[i] as number;
      entry.g.clear();
      drawPart(entry.g, { ...state, structure, castles, cannons });
    }
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
    for (const p of this.parts) p.g.destroy();
    this.parts = this.cells.map(() => ({ g: new Graphics(), key: '' }));
    this.container.removeChildren();
    this.container.addChild(...this.parts.map((p) => p.g));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
