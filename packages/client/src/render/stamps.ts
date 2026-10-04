import { Container, Graphics, GraphicsContext } from 'pixi.js';

/**
 * Shapes built once and only moved (PLAN 11.22). Pixi cuts a `Graphics` into triangles on
 * the CPU, in JavaScript, every time it is rebuilt — and a style that clears and redraws its
 * moving parts every frame rebuilds them sixty times a second, which a fast graphics card
 * cannot help with. A `GraphicsContext` drawn once and shared by many `Graphics` is cut
 * once; moving, turning, scaling, tinting and fading those costs next to nothing.
 *
 * `Stamps` is a pool of such `Graphics`, placed afresh each frame in the order placed, so
 * code that drew everything into one `Graphics` keeps its shape: `begin`, a `place` per
 * thing, `end`. Later stamps lie over earlier ones, as later shapes in one `Graphics` did.
 */
export class Stamps {
  readonly container = new Container();
  private used = 0;

  begin(): void {
    this.used = 0;
  }

  /**
   * One copy of `context` at (`x`, `y`). A shape drawn in white takes `tint` as its colour;
   * one drawn in colour is multiplied by it.
   */
  place(
    context: GraphicsContext,
    x: number,
    y: number,
    options: {
      rotation?: number;
      scale?: number;
      scaleY?: number;
      alpha?: number;
      tint?: number;
    } = {},
  ): Graphics {
    let g = this.container.children[this.used] as Graphics | undefined;
    if (g === undefined) {
      g = new Graphics(context);
      this.container.addChild(g);
    } else if (g.context !== context) {
      g.context = context;
    }
    this.used++;
    const scale = options.scale ?? 1;
    g.visible = true;
    g.position.set(x, y);
    g.rotation = options.rotation ?? 0;
    g.scale.set(scale, options.scaleY ?? scale);
    g.alpha = options.alpha ?? 1;
    g.tint = options.tint ?? 0xffffff;
    return g;
  }

  /** Hides what was placed last frame and not this one. */
  end(): void {
    const children = this.container.children;
    for (let i = this.used; i < children.length; i++) (children[i] as Graphics).visible = false;
  }

  destroy(): void {
    // The contexts belong to their `StampBook`, which a `Graphics` given one never destroys.
    this.container.destroy({ children: true });
  }
}

/**
 * The contexts the stamps are made from, by name, drawn for the tile size they are shown at
 * and drawn again when it changes, so a stamp is never a scaled-up blur of a small one.
 */
export class StampBook {
  private tile = 0;
  private readonly contexts = new Map<string, GraphicsContext>();

  /** The context called `key` at tile size `tile`, drawn by `draw` the first time, at the origin. */
  get(key: string, tile: number, draw: (g: Graphics) => void): GraphicsContext {
    if (tile !== this.tile) this.clear(tile);
    let context = this.contexts.get(key);
    if (context === undefined) {
      context = new GraphicsContext();
      // Drawn through a `Graphics` so the styles' own drawing helpers serve; it leaves the
      // context it was given alone when destroyed.
      const g = new Graphics(context);
      draw(g);
      g.destroy();
      this.contexts.set(key, context);
    }
    return context;
  }

  private clear(tile: number): void {
    // Not destroyed at once: a stamp may still show the old context until it is next placed.
    const old = [...this.contexts.values()];
    this.contexts.clear();
    this.tile = tile;
    queueMicrotask(() => {
      for (const c of old) c.destroy();
    });
  }

  destroy(): void {
    for (const c of this.contexts.values()) c.destroy();
    this.contexts.clear();
  }
}
