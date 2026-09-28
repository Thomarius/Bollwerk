import type { ArtConfig } from '@rampart/config';
import type { MatchState } from '@rampart/sim';
import { Graphics } from 'pixi.js';

import { SceneryTracker, type SceneryItem } from './scenery.js';
import { ClearingPuffs, type Cell, type ViewTransform } from './theme.js';

/** How a style draws what stands: every item, with the board it stands on. */
export type DrawScenery = (
  g: Graphics,
  view: ViewTransform,
  items: readonly SceneryItem[],
  state: MatchState,
) => void;

/**
 * Scenery for a style drawn from shapes: the tracker, one Graphics to draw it in — put
 * into the territory layer first, under the sealed ground and the greying of the out —
 * and the puffs a landing piece throws up. The style says only how its scenery looks.
 */
export class SceneryLayer {
  readonly gfx = new Graphics();
  private readonly tracker = new SceneryTracker();
  private readonly puffs = new ClearingPuffs();
  private width = 0;

  constructor(
    private readonly draw: DrawScenery,
    private readonly puffColour: () => number,
  ) {}

  /** Brings it up to the board; `force` redraws it whatever changed, as a new view needs. */
  refresh(state: MatchState, view: ViewTransform, art: ArtConfig, force = false): void {
    this.width = state.width;
    if (!this.tracker.sync(state, art.scenery) && !force) return;
    this.gfx.clear();
    this.draw(this.gfx, view, this.tracker.visible(), state);
  }

  land(cells: readonly Cell[]): void {
    this.puffs.add(this.tracker.take(cells, this.width), this.puffColour());
  }

  drawPuffs(g: Graphics, view: ViewTransform, deltaMs: number): void {
    this.puffs.draw(g, view, deltaMs);
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
