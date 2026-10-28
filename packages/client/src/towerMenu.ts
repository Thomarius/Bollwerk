import {
  variantCost,
  variantKind,
  type BotTower,
  type SpecialKind,
  type TowerVariant,
} from '@bollwerk/config';

import { escape } from './html.js';
import { t } from './i18n.js';
import { rememberCost, rememberedCost, towerMenuMarkup, variantForCard } from './towerChoice.js';
import { TowerPreview } from './towerPreview.js';

/**
 * The special tower menu (the user's, 2026-10-16): where the lobby's list of every variant
 * had stopped scaling, a window of cards — each tower by its emblem and name, alphabetically —
 * and under them a switch for the chosen tower's cost, a line on what that
 * variant does by its own numbers and when it can be afforded, and a preview of it played by
 * the rules (`towerPreview.ts`). A click chooses at once, as in the gallery of looks; Done
 * only closes. Mouse only, every choice a click. The same menu chooses a bot's tower for the
 * host, with Random — the seat's draw — beside the cards (the user's, 2026-10-25).
 */

export interface TowerMenuOptions {
  /** The choice as it stands: `drawn` only for a bot's menu, given its draw. */
  chosen: BotTower;
  /** A bot's draw from the seed and its seat, which offers Random; absent for a person's. */
  drawn?: TowerVariant;
  /**
   * Random offered with no draw to show yet: a tournament's teammate, whose tower is drawn as
   * the tournament is made (2026-10-28).
   */
  random?: boolean;
  /** The window's title where it is not the person's own tower: "Bot 3's tower". */
  title?: string;
  /** A choice made, at once: to be saved and sent to the table. */
  onChoose: (choice: BotTower) => void;
  click?: () => void;
  /** Whether the menu still has a table to choose for; it closes itself when not. */
  alive?: () => boolean;
}

export function openTowerMenu(options: TowerMenuOptions): void {
  let chosen = options.chosen;
  const drawn = options.drawn ?? null;
  /** The tower a choice brings, for its preview: Random's, the draw. */
  const brought = (choice: BotTower): TowerVariant | null => (choice === 'drawn' ? drawn : choice);
  const click = options.click ?? ((): void => undefined);
  const root = document.createElement('div');
  root.className = 'tower-menu';
  root.innerHTML =
    `<div class="panel" role="dialog" aria-label="${escape(t('towerMenu.title'))}">` +
    `<h2>${escape(options.title ?? t('towerMenu.title'))}</h2><div class="choice"></div>` +
    `<div class="preview"><span class="label">${escape(t('towerMenu.preview'))}</span></div>` +
    `<div class="foot"><button type="button" class="done">${escape(t('looks.done'))}</button></div></div>`;
  const choice = root.querySelector<HTMLElement>('.choice')!;
  const preview = new TowerPreview();
  root.querySelector('.preview')!.append(preview.canvas);
  const render = (): void => {
    choice.innerHTML = towerMenuMarkup(chosen, drawn, options.random === true);
  };
  const choose = (next: BotTower): void => {
    click();
    if (next === chosen) return;
    const before = brought(chosen);
    chosen = next;
    if (next !== null && next !== 'drawn') rememberCost(next);
    options.onChoose(next);
    render();
    // Random over the draw's own card changes nothing to be seen.
    if (brought(next) !== before) preview.play(brought(next));
  };
  const watch = window.setInterval(() => {
    if (options.alive !== undefined && !options.alive()) close();
  }, 300);
  const close = (): void => {
    window.clearInterval(watch);
    preview.destroy();
    root.remove();
  };
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === root) {
      close();
      return;
    }
    if (target.closest('.random') !== null) {
      choose('drawn');
      return;
    }
    const card = target.closest<HTMLElement>('.card');
    if (card !== null) {
      const kind = card.dataset['kind'];
      if (kind === 'none') {
        choose(null);
        return;
      }
      // The cost stays as it is when the tower changes — the draw's, from Random.
      const held = brought(chosen);
      const cost = held !== null ? variantCost(held) : rememberedCost();
      if (kind !== undefined) choose(variantForCard(kind as SpecialKind, cost));
      return;
    }
    const cost = target.closest<HTMLButtonElement>('.cost');
    if (cost !== null && !cost.disabled && chosen !== null && chosen !== 'drawn') {
      choose(`${variantKind(chosen)}${cost.dataset['cost']}` as TowerVariant);
      return;
    }
    if (target.closest('.done') !== null) {
      click();
      close();
    }
  });
  render();
  document.body.append(root);
  preview.play(brought(chosen));
}
