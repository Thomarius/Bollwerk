import { ArtStyleSchema, stylesFor } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import {
  chooseLook,
  galleryMarkup,
  lookName,
  lookOptions,
  LookRotation,
  stepLook,
} from './looks.js';

/** A source that walks through the given values, again and again. */
function sequence(...values: number[]): () => number {
  let k = 0;
  return () => values[k++ % values.length]!;
}

describe('choosing a look', () => {
  it('takes random, or a style made for the look, and falls through anything else', () => {
    expect(chooseLook('build', ['random'], 'flat')).toBe('random');
    expect(chooseLook('combat', ['nonsense', undefined, 'glass'], 'pixel')).toBe('glass');
    expect(chooseLook('build', ['nonsense'], 'flat')).toBe('flat');
  });

  it('offers the styles by name, alphabetically, then random, and steps round both ends', () => {
    const options = lookOptions('combat');
    expect(options.at(-1)).toBe('random');
    const names = options.slice(0, -1).map((o) => lookName(o));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(new Set(options.slice(0, -1))).toEqual(new Set(stylesFor('combat')));
    expect(stepLook('combat', 'random', 1)).toBe(options[0]);
    expect(stepLook('combat', options[0]!, -1)).toBe('random');
    expect(stepLook('combat', options[0]!, 1)).toBe(options[1]);
  });
});

describe('random looks, round by round', () => {
  /** The looks in the order they come on screen: the opening's two, then by turns. */
  function onScreen(rotation: LookRotation, count: number): string[] {
    const { build, combat } = rotation.opening();
    const shown = [build, combat];
    while (shown.length < count)
      shown.push(rotation.next(shown.length % 2 === 0 ? 'build' : 'combat'));
    return shown;
  }

  it('keeps chosen styles as they are, and says nothing rotates', () => {
    const rotation = new LookRotation({ build: 'flat', combat: 'pixel' }, sequence(0.5));
    expect(rotation.rotates).toBe(false);
    expect(onScreen(rotation, 6)).toEqual(['flat', 'pixel', 'flat', 'pixel', 'flat', 'pixel']);
  });

  it('with one random, cycles through every other style before any comes again', () => {
    const others = stylesFor('combat').filter((s) => s !== 'office');
    for (const v of [0, 0.3, 0.99]) {
      const rotation = new LookRotation(
        { build: 'office', combat: 'random' },
        sequence(v, 0.7, 0.1),
      );
      expect(rotation.rotates).toBe(true);
      const combat = Array.from({ length: 3 * others.length }, () => rotation.next('combat'));
      for (let k = 0; k < 3; k++) {
        const cycle = combat.slice(k * others.length, (k + 1) * others.length);
        expect(new Set(cycle)).toEqual(new Set(others));
      }
      // A new cycle never opens with the style the last one ended on.
      for (let i = 1; i < combat.length; i++) expect(combat[i]).not.toBe(combat[i - 1]);
      expect(combat).not.toContain('office');
    }
  });

  it('with both random, shares one cycle, and every banner changes the style', () => {
    const all = ArtStyleSchema.options;
    for (const v of [0, 0.42, 0.99]) {
      const rotation = new LookRotation({ build: 'random', combat: 'random' }, sequence(v, 0.2));
      const shown = onScreen(rotation, 4 * all.length);
      for (let k = 0; k < 4; k++) {
        expect(new Set(shown.slice(k * all.length, (k + 1) * all.length))).toEqual(new Set(all));
      }
      for (let i = 1; i < shown.length; i++) expect(shown[i]).not.toBe(shown[i - 1]);
      // Nor a look in the style it had last, across a cycle's end as within one.
      for (let i = 2; i < shown.length; i++) expect(shown[i]).not.toBe(shown[i - 2]);
    }
  });

  it('shuffles: different sources give different orders', () => {
    const a = onScreen(
      new LookRotation({ build: 'random', combat: 'random' }, sequence(0.1, 0.8)),
      14,
    );
    const b = onScreen(
      new LookRotation({ build: 'random', combat: 'random' }, sequence(0.6, 0.3)),
      14,
    );
    expect(a).not.toEqual(b);
  });
});

describe('the gallery', () => {
  it('lists random and every style, marks the chosen card and badges both looks', () => {
    const html = galleryMarkup({ build: 'pixel', combat: 'halloween' }, 'combat');
    expect(html).toContain('data-choice="random"');
    for (const style of stylesFor('combat')) expect(html).toContain(`data-choice="${style}"`);
    expect(html).toMatch(/class="card chosen" data-choice="halloween"/);
    expect(html).not.toMatch(/class="card chosen" data-choice="pixel"/);
    expect(html).toMatch(/data-choice="pixel".*?badge build/);
    expect(html).toMatch(/data-choice="halloween".*?badge combat/);
    expect(html).toMatch(/class="tab active" data-look="combat"/);
    expect(html).toContain('<b>Halloween</b>');
  });

  it('badges one card twice when both looks are the same style', () => {
    const html = galleryMarkup({ build: 'random', combat: 'random' }, 'build');
    const card = html.slice(html.indexOf('data-choice="random"'), html.indexOf('class="done"'));
    expect(card).toContain('badge build');
    expect(card).toContain('badge combat');
  });
});
