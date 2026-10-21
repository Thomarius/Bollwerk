import { variantCost, variantKind, type SpecialKind, type TowerVariant } from '@bollwerk/config';

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
 * only closes. Mouse only, every choice a click.
 */

export interface TowerMenuOptions {
  chosen: TowerVariant | null;
  /** A choice made, at once: to be saved and sent to the table. */
  onChoose: (variant: TowerVariant | null) => void;
  click?: () => void;
  /** Whether the menu still has a table to choose for; it closes itself when not. */
  alive?: () => boolean;
}

export function openTowerMenu(options: TowerMenuOptions): void {
  let chosen = options.chosen;
  const click = options.click ?? ((): void => undefined);
  const root = document.createElement('div');
  root.className = 'tower-menu';
  root.innerHTML =
    `<div class="panel" role="dialog" aria-label="${escape(t('towerMenu.title'))}">` +
    `<h2>${escape(t('towerMenu.title'))}</h2><div class="choice"></div>` +
    `<div class="preview"><span class="label">${escape(t('towerMenu.preview'))}</span></div>` +
    `<div class="foot"><button type="button" class="done">${escape(t('looks.done'))}</button></div></div>`;
  const choice = root.querySelector<HTMLElement>('.choice')!;
  const preview = new TowerPreview();
  root.querySelector('.preview')!.append(preview.canvas);
  const render = (): void => {
    choice.innerHTML = towerMenuMarkup(chosen);
  };
  const choose = (variant: TowerVariant | null): void => {
    click();
    if (variant === chosen) return;
    chosen = variant;
    if (variant !== null) rememberCost(variant);
    options.onChoose(variant);
    render();
    preview.play(variant);
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
    const card = target.closest<HTMLElement>('.card');
    if (card !== null) {
      const kind = card.dataset['kind'];
      // The cost stays as it is when the tower changes.
      const cost = chosen !== null ? variantCost(chosen) : rememberedCost();
      if (kind !== undefined) choose(variantForCard(kind as SpecialKind, cost));
      return;
    }
    const cost = target.closest<HTMLButtonElement>('.cost');
    if (cost !== null && !cost.disabled && chosen !== null) {
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
  preview.play(chosen);
}
