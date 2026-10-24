import { BlurFilter, type BlurFilterOptions, type Container, type Filter } from 'pixi.js';

import { bloomWanted, onGraphics } from '../graphics.js';

interface Bloomed {
  make: () => Filter;
  /** Made the first time the level asks for it, then kept for the layer's life. */
  blur: Filter | null;
}

/**
 * Every layer a style blooms, put on or taken off as the Graphics level changes, so High
 * takes effect on the looks already made rather than from the next match. A layer leaves as
 * it is destroyed, its blur with it: every one belongs to a look's root, which `Scene.drop`
 * releases whole.
 */
const bloomed = new Map<Container, Bloomed>();

function show(layer: Container, entry: Bloomed, on: boolean): void {
  if (on) entry.blur ??= entry.make();
  layer.filters = on && entry.blur !== null ? [entry.blur] : [];
}

/** Blooms `layer` by a blur of these options while the level asks for it. */
export function bloom(
  layer: Container,
  options: BlurFilterOptions,
  make: (options: BlurFilterOptions) => Filter = (o) => new BlurFilter(o),
): void {
  const entry: Bloomed = { make: () => make(options), blur: null };
  bloomed.set(layer, entry);
  show(layer, entry, bloomWanted());
  layer.once('destroyed', () => {
    bloomed.delete(layer);
    entry.blur?.destroy();
  });
}

onGraphics(() => {
  const on = bloomWanted();
  for (const [layer, entry] of bloomed) show(layer, entry, on);
});
