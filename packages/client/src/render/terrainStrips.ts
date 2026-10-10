import type { MatchState } from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { clearDrawn } from './clearDrawn.js';
import { outOfBudget } from './islandParts.js';
import { release } from './release.js';
import type { ViewTransform } from './theme.js';

/**
 * Strips of rows the terrain is cut into. Drawn whole, a style's terrain was one drawing of
 * 1 to 54 ms and a first render of 12 to 118 ms at eight players (ARCHIVE 13n): a new look's
 * one long frame, which no budget could split. An eighth is a few milliseconds of either.
 */
export const STRIPS = 8;

/**
 * One pass of a terrain drawing — a fill, a stroke, a kind of mark — over the rows `from` to
 * `to`, `to` excluded, in board rows (negative in the margin above the board). `strip`
 * counts from 0, for a pass drawn whole in the first (`whole`). A style of sprites, Pixel's
 * and Night's, places them in a container a strip rather than drawing in a `Graphics`.
 */
export type TerrainPass<T extends Container = Graphics> = (
  g: T,
  from: number,
  to: number,
  strip: number,
) => void;

export interface TerrainPlan<T extends Container = Graphics> {
  /** The rows the terrain covers, margins included: the first, and the one past the last. */
  rows: readonly [number, number];
  /** In the order they are drawn, each over every strip before the next begins. */
  passes: readonly TerrainPass<T>[];
}

/** A pass drawn all at once, in the first strip: a shape that is not laid out by rows. */
export function whole<T extends Container = Graphics>(draw: (g: T) => void): TerrainPass<T> {
  return (g, _from, _to, strip) => {
    if (strip === 0) draw(g);
  };
}

/**
 * The container of a style's terrain strips: a container a pass, a `Graphics` a strip in
 * each. The scene renders it first a strip at a time, every pass of one strip together
 * (`Scene.warmChains`).
 */
export class StripContainer extends Container {
  /** For each strip, its drawing in every pass. */
  strips(): Container[][] {
    const passes = this.children as Container[];
    return Array.from({ length: STRIPS }, (_, s) =>
      passes.map((pass) => pass.children[s] as Container),
    );
  }
}

/**
 * A style's terrain drawn in strips of rows (ARCHIVE 13n), so that a look made or readied
 * under a budget (`withDrawBudget`) draws it a few strips a frame, and the scene renders it
 * first a strip at a time. Each pass keeps a `Graphics` a strip, and every strip of a pass
 * comes before any of the next, so the drawing is laid down in the order it was when whole:
 * a pass's strips are its rows in order, as its one loop over them drew them.
 *
 * `draw` takes up a drawing a budget cut short where it stopped, as long as the board and
 * the view are the ones it began with; any other call draws it all again from its plan.
 */
export class TerrainStrips<T extends Container = Graphics> {
  readonly container = new StripContainer({ label: 'terrain strips' });
  private plan: TerrainPlan<T> | null = null;
  /** The strips drawn of the drawing under way. */
  private done = STRIPS;
  private key = '';
  private terrainOf: Uint8Array | null = null;

  /** `strip` makes a strip's drawing: by default a `Graphics`, emptied before each drawing. */
  constructor(private readonly strip: () => T = () => new Graphics() as Container as T) {}

  /**
   * Draws the terrain: `plan` is called once a drawing, for whatever the style works out
   * across the board first, and returns the rows and the passes over them.
   */
  draw(state: MatchState, view: ViewTransform, plan: () => TerrainPlan<T>): void {
    const key = `${view.tile}|${view.originX}|${view.originY}|${view.width}|${view.height}`;
    const resume =
      this.done < STRIPS && key === this.key && state.terrain === this.terrainOf && this.plan;
    if (!resume) {
      this.key = key;
      this.terrainOf = state.terrain;
      this.plan = plan();
      this.done = 0;
      this.layout(this.plan.passes.length);
    }
    const { rows, passes } = this.plan as TerrainPlan<T>;
    const [first, end] = rows;
    const span = end - first;
    const layers = this.container.children as Container[];
    let drawn = 0;
    while (this.done < STRIPS) {
      if (outOfBudget(drawn)) return;
      const s = this.done;
      const from = first + Math.floor((span * s) / STRIPS);
      const to = first + Math.floor((span * (s + 1)) / STRIPS);
      passes.forEach((pass, p) => pass((layers[p] as Container).children[s] as T, from, to, s));
      this.done++;
      drawn++;
    }
  }

  /** A container for each pass, each with a drawing a strip, all of them empty. */
  private layout(passes: number): void {
    const layers = this.container.children as Container[];
    while (layers.length < passes) {
      const pass = new Container();
      for (let s = 0; s < STRIPS; s++) pass.addChild(this.strip());
      this.container.addChild(pass);
    }
    while (layers.length > passes) release(layers.at(-1) as Container);
    for (const pass of layers) {
      for (const g of pass.children) {
        if (g instanceof Graphics) clearDrawn(g);
        else g.removeChildren();
      }
    }
  }
}
