import { SPECIAL_KINDS, type SpecialKind } from '@bollwerk/config';
import { specialRefusal, towerCost, type MatchState } from '@bollwerk/sim';

import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * The special towers as people meet them (docs/SPECIAL_TOWERS.md): their names, what each
 * does, the choice a player last made, and the line the HUD shows in a cannon phase.
 */

const NAME_KEY = {
  bertha: 'tower.bertha',
  architect: 'tower.architect',
  rapid: 'tower.rapid',
} as const;

const WHAT_KEY = {
  bertha: 'tower.berthaWhat',
  architect: 'tower.architectWhat',
  rapid: 'tower.rapidWhat',
} as const;

export function towerName(kind: SpecialKind | null): string {
  return kind === null ? t('tower.none') : t(NAME_KEY[kind]);
}

/** One line on what a tower does. */
export function towerWhat(kind: SpecialKind): string {
  return t(WHAT_KEY[kind]);
}

/** A tower's price as words: "3 cannons". */
export function towerCostText(cost: number): string {
  return t('tower.cost', { n: cost });
}

/** Where the menu remembers the tower last chosen, as it does the name. */
const TOWER_KEY = 'bollwerk.tower';

/** The tower the player chose last, or none the first time. */
export function preferredTower(): SpecialKind | null {
  const saved = stored(TOWER_KEY);
  return (SPECIAL_KINDS as readonly string[]).includes(saved ?? '') ? (saved as SpecialKind) : null;
}

export function saveTower(kind: SpecialKind | null): void {
  store(TOWER_KEY, kind ?? 'none');
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
  const tower = towerName(player.special);
  const cost = towerCostText(towerCost(state.ruleset, player.special));
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
      return player.cannonsToPlace > 0 ? t('hud.towerDear', { tower, cost }) : null;
    default:
      return null;
  }
}
