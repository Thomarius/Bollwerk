import { stylesFor } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import {
  chooseLook,
  galleryMarkup,
  lookName,
  lookOptions,
  resolveLooks,
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

describe('resolving random looks', () => {
  it('keeps a chosen style as it is', () => {
    expect(resolveLooks({ build: 'flat', combat: 'pixel' }, sequence(0.5))).toEqual({
      build: 'flat',
      combat: 'pixel',
    });
  });

  it('draws from every style, and never the other look’s while another is left', () => {
    const all = stylesFor('combat');
    // The draw that would land on the build look's style lands on the next one instead.
    const at = all.indexOf('glass');
    const picked = resolveLooks({ build: 'glass', combat: 'random' }, sequence(at / all.length));
    expect(picked.combat).not.toBe('glass');
    // Two randoms come out different, whatever the source gives.
    for (const v of [0, 0.3, 0.5, 0.99]) {
      const both = resolveLooks({ build: 'random', combat: 'random' }, sequence(v));
      expect(both.build).not.toBe(both.combat);
    }
  });

  it('reaches every style over enough draws', () => {
    const seen = new Set<string>();
    const draws = stylesFor('build').length;
    for (let k = 0; k < draws; k++) {
      seen.add(
        resolveLooks({ build: 'random', combat: 'flat' }, sequence((k + 0.5) / draws)).build,
      );
    }
    // Every style but the combat look's own.
    expect(seen.size).toBe(stylesFor('build').length - 1);
    expect(seen.has('flat')).toBe(false);
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
