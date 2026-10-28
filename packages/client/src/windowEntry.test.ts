import { describe, expect, it } from 'vitest';

import { windowKind } from './windowEntry.js';

/** Just enough of an element for the kind: its classes. */
const element = (...classes: string[]) => ({ classList: classes }) as unknown as Element;

describe('a window arriving', () => {
  it('is known by its classes, so a lobby redrawn is the same window', () => {
    expect(windowKind(element('menu', 'lobby'))).toBe('menu lobby');
    expect(windowKind(element('menu', 'lobby', 'entering'))).toBe('menu lobby');
    expect(windowKind(element('menu', 'home'))).not.toBe(windowKind(element('menu', 'lobby')));
  });

  it('is no window at all outside the menus', () => {
    expect(windowKind(element('hud'))).toBeNull();
    expect(windowKind(null)).toBeNull();
  });
});
