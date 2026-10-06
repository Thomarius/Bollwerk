import type { Container } from 'pixi.js';

/**
 * Destroys a container and everything under it, each `Graphics` with the drawing it owns.
 *
 * Pixi's `destroy({ children: true })` hands its options down, and a `Graphics` destroyed
 * with any options at all keeps its own context, still registered with the renderer, which
 * then holds it and its geometry for good: every look thrown away leaked so, 255 contexts
 * and about 170 MB a pass through the fourteen styles at eight players (PLAN 11.23). A
 * `Graphics` given a shared context, as a stamp is, leaves it to its owner either way.
 */
export function release(node: Container): void {
  for (const child of [...node.children]) release(child);
  node.destroy();
}
