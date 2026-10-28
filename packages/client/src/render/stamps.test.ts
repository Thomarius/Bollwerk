import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { StampBook, Stamps } from './stamps.js';

/** A destroyed context has no instructions left, which Pixi's render then reads (ARCHIVE 15a). */
const alive = (g: Graphics): boolean =>
  (g.context as unknown as { instructions: unknown[] | null }).instructions !== null;

const square = (size: number) => (g: Graphics) => {
  g.rect(0, 0, size, size).fill({ color: 0xffffff });
};

describe('stamps when the tile size changes', () => {
  it('leaves no stamp showing a destroyed shape, placed again or not', async () => {
    const book = new StampBook();
    // Two layers drawn from one book, as a look's terrain and its effects are.
    const terrain = new Stamps();
    const effects = new Stamps();
    terrain.begin();
    const left = terrain.place(book.get('tile', 16, square(16)), 0, 0);
    terrain.end();
    effects.begin();
    effects.place(book.get('tile', 16, square(16)), 0, 0);
    effects.end();

    // The window resized: the effects drawn at the new size, the terrain not yet.
    effects.begin();
    const placed = effects.place(book.get('tile', 24, square(24)), 0, 0);
    effects.end();
    await Promise.resolve();

    expect(alive(placed)).toBe(true);
    expect(placed.visible).toBe(true);
    // The one left behind shows nothing until its layer draws it again, rather than a
    // destroyed shape.
    expect(alive(left)).toBe(true);
    expect(left.visible).toBe(false);
    terrain.begin();
    const again = terrain.place(book.get('tile', 24, square(24)), 0, 0);
    terrain.end();
    expect(again).toBe(left);
    expect(again.visible).toBe(true);
    expect(again.context).toBe(placed.context);

    terrain.destroy();
    effects.destroy();
    book.destroy();
  });

  it('empties a stamp still showing a shape as its book is thrown away', () => {
    const book = new StampBook();
    const stamps = new Stamps();
    stamps.begin();
    const g = stamps.place(book.get('tile', 16, square(16)), 0, 0);
    book.destroy();
    expect(alive(g)).toBe(true);
    stamps.destroy();
  });
});
