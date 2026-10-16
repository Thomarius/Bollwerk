import {
  TOWER_VARIANTS,
  defaultRuleset,
  variantConfig,
  variantCost,
  variantKind,
  type Ruleset,
  type SpecialKind,
  type TowerVariant,
} from '@bollwerk/config';
import { specialRefusal, type MatchState } from '@bollwerk/sim';

import { placeableCannons } from './controls.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * The special towers as people meet them (docs/SPECIAL_TOWERS.md): their names, what each
 * variant does, the choice a player last made, and the line the HUD shows in a cannon phase.
 * A loadout is a tower at a cost (`bertha3`); one list of every variant for now, a chooser
 * of tower and cost apart to come (the user's, 2026-10-16).
 */

const NAME_KEY = {
  bertha: 'tower.bertha',
  architect: 'tower.architect',
  rapid: 'tower.rapid',
} as const;

/** A tower's name, without its cost. */
export function towerName(kind: SpecialKind | null): string {
  return kind === null ? t('tower.none') : t(NAME_KEY[kind]);
}

/** A variant's name with its cost: "Big Bertha · 3 cannons"; or "No tower". */
export function variantName(variant: TowerVariant | null): string {
  if (variant === null) return towerName(null);
  return t('tower.option', {
    tower: towerName(variantKind(variant)),
    cost: towerCostText(variantCost(variant)),
  });
}

/**
 * One line on what a variant does, with its own numbers from the rules: the Architect's
 * reach, the Rapid Cannon's barrels, a Big Bertha whose shell flies slower than a gun's.
 */
export function towerWhat(variant: TowerVariant, ruleset: Ruleset = defaultRuleset): string {
  const kind = variantKind(variant);
  const cost = variantCost(variant);
  const config = variantConfig(ruleset.specials, variant);
  switch (kind) {
    case 'bertha':
      return t(config.flightFactor > 1 ? 'tower.berthaSlowWhat' : 'tower.berthaWhat');
    case 'architect':
      // Its reach is a circle from the footprint's centre; told as blocks across, a whole number.
      return t('tower.architectWhat', {
        n: 'repairRadius' in config ? Math.round(2 * config.repairRadius) : 0,
      });
    case 'rapid':
      return t('tower.rapidWhat', { n: cost });
  }
}

/** A tower's price as words: "3 cannons". */
export function towerCostText(cost: number): string {
  return t('tower.cost', { n: cost });
}

/** Where the menu remembers the tower last chosen, as it does the name. */
const TOWER_KEY = 'bollwerk.tower';

/**
 * The tower the player chose last, or none the first time — and for a choice saved before
 * towers came at two costs, a bare kind, which names no variant.
 */
export function preferredTower(): TowerVariant | null {
  const saved = stored(TOWER_KEY);
  return (TOWER_VARIANTS as readonly string[]).includes(saved ?? '')
    ? (saved as TowerVariant)
    : null;
}

export function saveTower(variant: TowerVariant | null): void {
  store(TOWER_KEY, variant ?? 'none');
}

/**
 * What the HUD says of the player's tower in a cannon phase, or null where it has nothing
 * to say: towers not played, none brought, or a castle still to choose. `placing` is whether
 * the right button has switched the ghost to the tower.
 */
export function towerLine(state: MatchState, playerId: number, placing: boolean): string | null {
  const player = state.players[playerId];
  if (player === undefined || player.eliminated || player.special === null) return null;
  if (state.phase !== 'cannon_place' || player.startingCastleId === null) return null;
  // Nowhere left for a gun, so nothing to offer or refuse: the cursor shows none left.
  if (placeableCannons(state, playerId) === 0) return null;
  const tower = towerName(variantKind(player.special));
  const cost = towerCostText(variantCost(player.special));
  switch (specialRefusal(state, player)) {
    case null:
      return placing ? t('hud.towerPlacing', { tower }) : t('hud.towerOffer', { tower, cost });
    case 'special_at_opening':
      return t('hud.towerOpening', { tower });
    case 'special_this_round':
      return t('hud.towerBought', { tower });
    case 'special_cap':
      return t('hud.towerCap', { tower });
    case 'special_too_dear':
      return t('hud.towerDear', { tower, cost });
    default:
      return null;
  }
}
