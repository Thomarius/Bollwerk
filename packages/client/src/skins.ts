import type { ArtStyle } from '@bollwerk/config';

/**
 * The HUD in each look (PLAN 11.11 W7): the bar, the clock and the cannon count,
 * dressed as the banners are. A record over every style, so a new style must bring one.
 * Medieval and Night share the dark bar with gold that every style once had. Apart from the
 * HUD, so the menus can wear a look's skin without the HUD (PLAN §11 item 4, MS4).
 */
export const HUD_SKIN: Record<ArtStyle, string> = {
  flat: 'hud-flat',
  pixel: 'hud-classic',
  night: 'hud-classic',
  cyberpunk: 'hud-neon',
  blueprint: 'hud-plan',
  parchment: 'hud-ink',
  bricks: 'hud-bricks',
  glass: 'hud-glass',
  chocolate: 'hud-chocolate',
  halloween: 'hud-halloween',
  sakura: 'hud-sakura',
  oktoberfest: 'hud-wiesn',
  opera: 'hud-opera',
  office: 'hud-office',
  undersea: 'hud-undersea',
  electric: 'hud-electric',
  cartoon: 'hud-cartoon',
  christmas: 'hud-christmas',
  noir: 'hud-noir',
  sports: 'hud-sports',
  pirates: 'hud-pirates',
  anime: 'hud-anime',
  mythology: 'hud-mythology',
  wildwest: 'hud-wildwest',
};
