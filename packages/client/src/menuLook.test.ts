import { describe, expect, it } from 'vitest';

import { dressFrom, nextMenuStyle } from './menuLook.js';

describe('the menus in the game’s looks', () => {
  it('takes the build look and the combat look in turn, a window each', () => {
    const choices = { build: 'pixel', combat: 'cyberpunk' } as const;
    const styles = Array.from({ length: 4 }, () => nextMenuStyle(choices));
    expect(styles).toEqual(['pixel', 'cyberpunk', 'pixel', 'cyberpunk']);
  });

  it('wears a skin at Medium: its accent, edge, glow and own lettering', () => {
    const dress = dressFrom(
      (name) =>
        ({
          '--panel-accent': ' #ff6cf4',
          '--panel-on-accent': '#0a0a12',
          '--hud-box-edge': '1px solid #ff3df2',
          '--hud-box-shadow': '0 0 12px #ff3df255',
          '--hud-font': "Impact, 'Arial Black'",
        })[name] ?? '',
    );
    expect(dress.accent).toBe('#ff6cf4');
    expect(dress.edge).toBe('1px solid #ff3df2');
    expect(dress.shadow.startsWith('0 0 12px #ff3df255, ')).toBe(true);
    expect(dress.font).toBe("Impact, 'Arial Black'");
  });

  it('keeps the base where a skin draws no edge, no glow and no lettering of its own', () => {
    const dress = dressFrom((name) =>
      name === '--hud-box-shadow' ? 'none' : name === '--hud-font' ? 'inherit' : '',
    );
    expect(dress.edge).toContain('solid');
    expect(dress.shadow).not.toContain('none');
    expect(dress.font).toBeNull();
  });
});
