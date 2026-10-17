import {
  SPECIAL_KINDS,
  defaultRuleset,
  offeredVariants,
  variantCost,
  variantKind,
  type SpecialKind,
  type TowerVariant,
} from '@bollwerk/config';

import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';
import { cannonSvg, towerSvg } from './towerIcons.js';
import { towerCostText, towerName, towerWhat } from './towers.js';

/**
 * What the special tower menu offers and how it is drawn (`towerMenu.ts`), apart from the
 * window and its preview, so it can be tested without a page.
 */

/**
 * Where the menu remembers the cost last chosen, one for every tower: a cost remembered by
 * tower switched back as its card was clicked, which the users found confusing (2026-10-17).
 */
const COST_KEY = 'bollwerk.towerCost';

export function rememberedCost(): number | null {
  const cost = Number(stored(COST_KEY));
  return Number.isInteger(cost) && cost > 0 ? cost : null;
}

/** The towers the rules offer, each with its costs, cheapest first. */
export function offeredTowers(): { kind: SpecialKind; costs: number[] }[] {
  const offered = offeredVariants(defaultRuleset.specials);
  return SPECIAL_KINDS.map((kind) => ({
    kind,
    costs: offered
      .filter((v) => variantKind(v) === kind)
      .map(variantCost)
      .sort((a, b) => a - b),
  })).filter((tower) => tower.costs.length > 0);
}

/**
 * The variant a click on a tower's card chooses: the tower and cost independent, so at the
 * cost already chosen — the tower in hand's, or the last one chosen when none is — where the
 * rules offer it for this tower, else its cheapest.
 */
export function variantForCard(
  kind: SpecialKind,
  want: number | null = rememberedCost(),
): TowerVariant | null {
  const tower = offeredTowers().find((o) => o.kind === kind);
  if (tower === undefined) return null;
  const cost = want !== null && tower.costs.includes(want) ? want : tower.costs[0];
  return `${kind}${cost}` as TowerVariant;
}

/** The menu's choosing part, drawn again on every choice; the preview stays beside it. */
export function towerMenuMarkup(chosen: TowerVariant | null): string {
  const kind = chosen === null ? null : variantKind(chosen);
  const card = (k: SpecialKind | null): string => {
    const icon = k === null ? cannonSvg('currentColor') : towerSvg(k, 'currentColor');
    return (
      `<button type="button" class="card${k === kind ? ' chosen' : ''}" data-kind="${k ?? 'none'}">` +
      `${icon}<span class="name">${escape(towerName(k))}</span></button>`
    );
  };
  const towers = offeredTowers();
  const cards = [card(null), ...towers.map((o) => card(o.kind))].join('');
  let costs = '';
  if (kind !== null) {
    const offered = towers.find((o) => o.kind === kind)?.costs ?? [];
    const buttons = [2, 3]
      .map((cost) => {
        const on = chosen !== null && variantCost(chosen) === cost;
        const off = !offered.includes(cost);
        return `<button type="button" class="cost${on ? ' chosen' : ''}" data-cost="${cost}"${off ? ' disabled' : ''}>${escape(towerCostText(cost))}</button>`;
      })
      .join('');
    costs = `<div class="costs"><span>${escape(t('towerMenu.cost'))}</span>${buttons}</div>`;
  }
  const what =
    chosen === null
      ? escape(t('tower.noneWhat'))
      : `${escape(towerWhat(chosen))} <em>${escape(t(variantCost(chosen) >= 3 ? 'tower.affordSecond' : 'tower.affordMain'))}</em>`;
  return `<div class="cards">${cards}</div>${costs}<p class="what">${what}</p>`;
}

/** Remembers the cost of a variant just chosen, for the next click on any tower's card. */
export function rememberCost(variant: TowerVariant): void {
  store(COST_KEY, String(variantCost(variant)));
}
