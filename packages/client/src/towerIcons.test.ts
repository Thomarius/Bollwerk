import { defaultArtConfig } from '@bollwerk/config';
import { describe, expect, it } from 'vitest';

import { ICON_ANGLE, iconFrame } from './render/theme.js';
import { cannonImg, cannonSvg, placeIconsHtml, switchHintHtml } from './towerIcons.js';

const styled = cannonImg('data:image/png;base64,AAAA');

describe('the cannon icons beside the cursor', () => {
  it('draw the style’s own gun by default', () => {
    expect(defaultArtConfig.cannonIcons).toBe('style');
  });

  it('use the generic cannon unless given the style’s', () => {
    expect(placeIconsHtml(2, null, '#fff')).toBe(cannonSvg('#fff').repeat(2));
    expect(placeIconsHtml(2, null, '#fff', styled)).toBe(styled.repeat(2));
  });

  it('lead with the tower, which keeps its emblem, and count what does not fit', () => {
    const row = placeIconsHtml(12, { kind: 'bertha', cost: 2 }, '#fff', styled);
    expect(row.startsWith('<svg class="icon tower"')).toBe(true);
    expect(row.split(styled).length - 1).toBe(7);
    expect(row.endsWith('<b>+3</b>')).toBe(true);
  });

  it('strike through the style’s gun when none is left, the page greying it', () => {
    expect(placeIconsHtml(0, null, '#fff', styled)).toBe(`<span class="none">${styled}</span>`);
    expect(placeIconsHtml(0, null, '#fff')).toContain('#8a8a9a');
  });

  it('switch back to the style’s gun in the right button’s hint', () => {
    expect(switchHintHtml('rapid', false, '#fff', styled).endsWith(styled)).toBe(true);
    expect(switchHintHtml('rapid', true, '#fff', styled)).not.toContain(styled);
    expect(switchHintHtml('rapid', false, '#fff').endsWith(cannonSvg('#fff'))).toBe(true);
  });
});

describe('the frame a style draws its icon in', () => {
  it('centres the 2×2 footprint in the box, as wide as asked', () => {
    const { view, cannon, aim } = iconFrame(20, 3, 1.5);
    expect(view.tile).toBe(15);
    expect(view.originX).toBe(-5);
    expect(view.originY).toBe(-5);
    expect(view.originX + cannon.w * view.tile).toBe(25);
    expect(cannon).toMatchObject({ owner: 3, active: true, kind: 'cannon', shotIds: [] });
    expect(aim).toEqual({ angle: ICON_ANGLE, firedAgo: Number.POSITIVE_INFINITY });
  });
});
