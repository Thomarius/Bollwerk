import { Container, Graphics, GraphicsContext, Sprite, type Texture } from 'pixi.js';

import { release } from './release.js';

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
    release(this.container);
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

/**
 * A `Graphics` for each of many things — a gun each — drawn again only when its `key`
 * changes (PLAN 11.22). For what is still most of the time but drawn every frame because
 * it sometimes moves: a barrel turns when its gun fires and kicks for a moment after, and
 * stands still between. The drawing code is the style's own, unchanged; the key must name
 * everything it reads.
 *
 * `begin`, a `draw` per thing, `end`: what was not drawn this frame is thrown away.
 */
export class Memos {
  readonly container = new Container();
  private readonly entries = new Map<number | string, { g: Graphics; key: string; seen: number }>();
  private frame = 0;

  begin(): void {
    this.frame++;
  }

  draw(id: number | string, key: string, draw: (g: Graphics) => void): void {
    let entry = this.entries.get(id);
    if (entry === undefined) {
      entry = { g: new Graphics(), key: '', seen: 0 };
      this.entries.set(id, entry);
      this.container.addChild(entry.g);
    }
    entry.seen = this.frame;
    if (entry.key === key) return;
    entry.key = key;
    entry.g.clear();
    draw(entry.g);
  }

  end(): void {
    for (const [id, entry] of this.entries) {
      if (entry.seen === this.frame) continue;
      entry.g.destroy();
      this.entries.delete(id);
    }
  }

  destroy(): void {
    this.entries.clear();
    release(this.container);
  }
}

/** The part of a key that says where the board is drawn: a change redraws everything. */
export function viewKey(view: { tile: number; originX: number; originY: number }): string {
  return `${view.tile},${view.originX},${view.originY}`;
}

/**
 * Filled discs as stamps of one white disc, scaled, tinted and faded: for a layer of soft
 * light drawn in circles every frame (Night's torches, pools and glows). Meant for an added
 * layer, where the order of what is drawn does not change the sum.
 */
export class Discs {
  readonly stamps = new Stamps();
  private readonly book = new StampBook();
  private tile = 1;

  get container(): Container {
    return this.stamps.container;
  }

  begin(tile: number): void {
    this.tile = tile;
    this.stamps.begin();
  }

  disc(x: number, y: number, radius: number, color: number, alpha: number): void {
    const tile = this.tile;
    const disc = this.book.get('disc', tile, (g) => {
      g.circle(0, 0, tile);
      g.fill({ color: 0xffffff });
    });
    this.stamps.place(disc, x, y, { scale: radius / tile, tint: color, alpha });
  }

  end(): void {
    this.stamps.end();
  }

  destroy(): void {
    this.stamps.destroy();
    this.book.destroy();
  }
}

/**
 * Sprites lent out for a frame and taken back at the next: a layer emptied and filled
 * again every frame keeps its sprites rather than making new ones and leaving the old to
 * the collector, as Medieval's guns, shots and flags did, two hundred a frame at eight
 * players. Each is handed out as a new one would be, untinted and opaque.
 */
export class SpritePool {
  private readonly sprites: Sprite[] = [];
  private used = 0;

  begin(): void {
    this.used = 0;
  }

  take(texture: Texture): Sprite {
    let sprite = this.sprites[this.used];
    if (sprite === undefined) {
      sprite = new Sprite(texture);
      this.sprites.push(sprite);
    } else {
      sprite.texture = texture;
      sprite.tint = 0xffffff;
      sprite.alpha = 1;
    }
    this.used++;
    return sprite;
  }

  destroy(): void {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites.length = 0;
  }
}
