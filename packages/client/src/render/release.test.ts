import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { release } from './release.js';

describe('release', () => {
  it('destroys the drawing every Graphics in the tree owns', () => {
    const root = new Container();
    const inner = new Container();
    const top = new Graphics();
    const deep = new Graphics();
    inner.addChild(deep);
    root.addChild(top, inner);
    const contexts = [top.context, deep.context];
    release(root);
    for (const context of contexts) expect(context.destroyed).toBe(true);
    expect(root.destroyed).toBe(true);
    expect(inner.destroyed).toBe(true);
  });

  it('leaves a shared drawing to its owner', () => {
    const shared = new GraphicsContext().rect(0, 0, 1, 1).fill(0xffffff);
    const root = new Container();
    root.addChild(new Graphics(shared), new Graphics(shared));
    release(root);
    expect(shared.destroyed).toBe(false);
  });

  it('is what destroy with children fails to do', () => {
    // The trap it answers: Pixi hands the options down, and a Graphics given any keeps its own.
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    const context = g.context;
    root.destroy({ children: true });
    expect(context.destroyed).toBe(false);
  });
});
