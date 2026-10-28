import {
  SPECIAL_KINDS,
  defaultRuleset,
  offeredVariants,
  variantCost,
  variantKind,
  type BotTower,
  type SpecialKind,
  type TowerVariant,
} from '@bollwerk/config';

import { escape } from './html.js';
import { language, t } from './i18n.js';
import { store, stored } from './storage.js';
import { cannonSvg, dieSvg, towerSvg } from './towerIcons.js';
import { towerCostText, towerName, towerWhat, variantName } from './towers.js';

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

/**
 * The menu's cards in the order they are shown: by name, alphabetically in the language shown
 * (the user's, 2026-10-21) — not `SPECIAL_KINDS`' order, which is the order they were added and
 * which the bots' draws keep.
 */
export function menuTowers(): { kind: SpecialKind; costs: number[] }[] {
  const lang = language();
  return offeredTowers().sort((a, b) => towerName(a.kind).localeCompare(towerName(b.kind), lang));
}

/**
 * The menu's choosing part, drawn again on every choice; the preview stays beside it. No tower
 * the first card, then every tower by name — ten cards with the tower still to come, two rows
 * of five (the user's, 2026-10-25; none had been left out since 2026-10-21). A bot's menu, given
 * `drawn` — its seat's draw — offers Random above them: the draw it brings unless the host
 * chooses, its tower's card marked as drawn rather than chosen.
 */
export function towerMenuMarkup(
  chosen: BotTower,
  drawn: TowerVariant | null = null,
  /** Random offered with no draw yet to show (a tournament's teammate, drawn as it is made). */
  later = false,
): string {
  const kind = chosen === null ? 'none' : chosen === 'drawn' ? null : variantKind(chosen);
  const drawnKind = chosen === 'drawn' && drawn !== null ? variantKind(drawn) : null;
  const card = (k: SpecialKind | 'none', icon: string, name: string): string =>
    `<button type="button" class="card${k === kind ? ' chosen' : ''}${k === drawnKind ? ' drawn' : ''}" data-kind="${k}">` +
    `${icon}<span class="name">${escape(name)}</span></button>`;
  const towers = menuTowers();
  const cards =
    card('none', cannonSvg('currentColor'), towerName(null)) +
    towers.map((o) => card(o.kind, towerSvg(o.kind, 'currentColor'), towerName(o.kind))).join('');
  const random =
    drawn === null && !later
      ? ''
      : `<button type="button" class="random${chosen === 'drawn' ? ' chosen' : ''}">` +
        `${dieSvg('currentColor')}<span>${escape(t('towerMenu.random'))}</span></button>`;
  // Shown for none and Random too, both costs off, so the menu keeps its height between choices.
  const variant = chosen === null || chosen === 'drawn' ? null : chosen;
  const offered = towers.find((o) => o.kind === kind)?.costs ?? [];
  const buttons = [2, 3]
    .map((cost) => {
      const on = variant !== null && variantCost(variant) === cost;
      const off = !offered.includes(cost);
      return `<button type="button" class="cost${on ? ' chosen' : ''}" data-cost="${cost}"${off ? ' disabled' : ''}>${escape(towerCostText(cost))}</button>`;
    })
    .join('');
  const costs = `<div class="costs"><span>${escape(t('towerMenu.cost'))}</span>${buttons}</div>`;
  // Every text the menu can show, stacked in one cell with only the chosen one visible, so
  // the cell is the longest text's height and the menu keeps its size (the user's, 2026-10-28).
  const choices: BotTower[] = [
    null,
    ...towers.flatMap((o) => o.costs.map((cost) => `${o.kind}${cost}` as TowerVariant)),
    ...(random === '' ? [] : ['drawn' as const]),
  ];
  if (!choices.includes(chosen)) choices.push(chosen);
  const whats = choices
    .map((c) => {
      const on = c === chosen;
      return `<p class="what${on ? ' on' : ''}"${on ? '' : ' aria-hidden="true"'}>${whatOf(c, drawn)}</p>`;
    })
    .join('');
  return `${random}<div class="cards">${cards}</div>${costs}<div class="whats">${whats}</div>`;
}

/** What a choice does, by its own numbers and when it can be afforded. */
function whatOf(choice: BotTower, drawn: TowerVariant | null): string {
  const shown = choice === 'drawn' ? drawn : choice;
  if (shown === null) {
    return escape(t(choice === 'drawn' ? 'towerMenu.randomLater' : 'towerMenu.noneWhat'));
  }
  const lead =
    choice === 'drawn'
      ? `${escape(t('towerMenu.randomWhat', { tower: variantName(shown) }))} `
      : '';
  const afford = t(variantCost(shown) >= 3 ? 'tower.affordSecond' : 'tower.affordMain');
  return `${lead}${escape(towerWhat(shown))} <em>${escape(afford)}</em>`;
}

/** Remembers the cost of a variant just chosen, for the next click on any tower's card. */
export function rememberCost(variant: TowerVariant): void {
  store(COST_KEY, String(variantCost(variant)));
}
