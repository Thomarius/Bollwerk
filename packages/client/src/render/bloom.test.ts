import type { Filter } from 'pixi.js';
import { Container } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { saveGraphics } from '../graphics.js';
import { bloom } from './bloom.js';

/** A stand-in for the blur, which needs a DOM to be made. */
function fakeBlur(made: Filter[]): () => Filter {
  return () => {
    const blur = { destroy: () => made.splice(made.indexOf(blur), 1) } as unknown as Filter;
    made.push(blur);
    return blur;
  };
}

describe('the bloom', () => {
  afterEach(() => saveGraphics('medium'));

  it('is put on and taken off a look already made as the level changes', () => {
    saveGraphics('medium');
    const made: Filter[] = [];
    const layer = new Container();
    bloom(layer, { strength: 5 }, fakeBlur(made));
    // Below High no blur is made at all.
    expect(layer.filters).toHaveLength(0);
    expect(made).toHaveLength(0);
    saveGraphics('high');
    expect(layer.filters).toEqual(made);
    expect(made).toHaveLength(1);
    saveGraphics('low');
    expect(layer.filters).toHaveLength(0);
    // The same blur again, not a new one each time.
    saveGraphics('high');
    expect(made).toHaveLength(1);
  });

  it('lets a destroyed layer go, its blur destroyed with it', () => {
    saveGraphics('high');
    const made: Filter[] = [];
    const layer = new Container();
    bloom(layer, { strength: 4 }, fakeBlur(made));
    expect(made).toHaveLength(1);
    layer.destroy();
    expect(made).toHaveLength(0);
    // Gone from the registry: a change of level no longer makes it a blur.
    saveGraphics('medium');
    saveGraphics('high');
    expect(made).toHaveLength(0);
  });
});
