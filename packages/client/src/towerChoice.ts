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

/** Where the menu remembers the cost last chosen for each tower, for a click on its card. */
const COSTS_KEY = 'bollwerk.towerCosts';

const ROLE_KEY = {
  none: 'tower.role.none',
  bertha: 'tower.role.bertha',
  architect: 'tower.role.architect',
  rapid: 'tower.role.rapid',
} as const;

export function rememberedCosts(): Partial<Record<SpecialKind, number>> {
  try {
    const raw: unknown = JSON.parse(stored(COSTS_KEY) ?? '{}');
    return typeof raw === 'object' && raw !== null
      ? (raw as Partial<Record<SpecialKind, number>>)
      : {};
  } catch {
    return {};
  }
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
 * The variant a click on a tower's card chooses: at the cost last chosen for it where the
 * rules still offer that, else its cheapest.
 */
export function variantForCard(
  kind: SpecialKind,
  remembered: Partial<Record<SpecialKind, number>> = rememberedCosts(),
): TowerVariant | null {
  const tower = offeredTowers().find((o) => o.kind === kind);
  if (tower === undefined) return null;
  const want = remembered[kind];
  const cost = want !== undefined && tower.costs.includes(want) ? want : tower.costs[0];
  return `${kind}${cost}` as TowerVariant;
}

/** The menu's choosing part, drawn again on every choice; the preview stays beside it. */
export function towerMenuMarkup(chosen: TowerVariant | null): string {
  const kind = chosen === null ? null : variantKind(chosen);
  const card = (k: SpecialKind | null): string => {
    const icon = k === null ? cannonSvg('currentColor') : towerSvg(k, 'currentColor');
    return (
      `<button type="button" class="card${k === kind ? ' chosen' : ''}" data-kind="${k ?? 'none'}">` +
      `${icon}<span class="name">${escape(towerName(k))}</span>` +
      `<small class="role">${escape(t(ROLE_KEY[k ?? 'none']))}</small></button>`
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

/** Remembers the cost of a variant just chosen, for the next click on its tower's card. */
export function rememberCost(variant: TowerVariant): void {
  store(
    COSTS_KEY,
    JSON.stringify({ ...rememberedCosts(), [variantKind(variant)]: variantCost(variant) }),
  );
}
