import {
  defaultRuleset,
  offeredVariants,
  variantConfig,
  variantCost,
  variantKind,
  type Ruleset,
  type SpecialKind,
  type TowerVariant,
} from '@bollwerk/config';
import { circleOffsets, specialRefusal, type MatchState } from '@bollwerk/sim';

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
  lightning: 'tower.lightning',
  biggest: 'tower.biggest',
  laser: 'tower.laser',
  frost: 'tower.frost',
  lullaby: 'tower.lullaby',
  subwoofer: 'tower.subwoofer',
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
 * reach, the Rapid Cannon's barrels, a Big Bertha's shell against a gun's, the Lightning
 * Tower's jumps and their reach, the Laser Tower's walls pierced.
 */
export function towerWhat(variant: TowerVariant, ruleset: Ruleset = defaultRuleset): string {
  const kind = variantKind(variant);
  const cost = variantCost(variant);
  const config = variantConfig(ruleset.specials, variant);
  switch (kind) {
    case 'bertha':
      // Her two costs differ by the shell's flight, which is her reload, so it is told
      // against a cannon's: as fast, faster or slower (the user's, 2026-10-16).
      return t(
        !('flightFactor' in config) || config.flightFactor === 1
          ? 'tower.berthaWhat'
          : config.flightFactor > 1
            ? 'tower.berthaSlowWhat'
            : 'tower.berthaFastWhat',
      );
    case 'architect':
      // Its reach is a circle from the footprint's centre; told as blocks across, a whole number.
      return t('tower.architectWhat', {
        n: 'repairRadius' in config ? Math.round(2 * config.repairRadius) : 0,
      });
    case 'rapid':
      return t('tower.rapidWhat', { n: cost });
    case 'lightning':
      return 'jumps' in config
        ? t('tower.lightningWhat', { n: config.jumps, r: config.jumpRadius })
        : '';
    case 'biggest':
      // Its crater told by the tiles it covers, as the rules count them (`circleOffsets`): both
      // costs are 5 across, so blocks across could not tell 13 tiles from 21 (the user's).
      return 'craterRadius' in config
        ? t('tower.biggestWhat', {
            n: circleOffsets(config.craterRadius).length,
            s: config.flightMs / 1000,
          })
        : '';
    case 'laser': {
      // A fraction of `pierce` is the chance of one wall more, told as such.
      if (!('pierce' in config)) return '';
      const whole = Math.floor(config.pierce);
      const chance = Math.round((config.pierce - whole) * 100);
      return chance === 0
        ? t('tower.laserWhat', { n: whole })
        : t('tower.laserChanceWhat', { n: whole, p: chance });
    }
    case 'frost':
      // The whole phase, overtime too, at 1; else the share of it, from its start.
      if (!('freezeShare' in config)) return '';
      if (config.freezeShare < 1) {
        return t('tower.frostShareWhat', { p: Math.round(config.freezeShare * 100) });
      }
      return t(config.throughOvertime ? 'tower.frostWhat' : 'tower.frostClockWhat');
    case 'lullaby':
      if (!('sleepMs' in config)) return '';
      {
        // A tower's lullabies, told by the dearer of the costs where it has none of its own.
        const lulls = config.towerLulls ?? 3;
        return config.sleepRadius === null
          ? t('tower.lullabyAnyWhat', { n: config.targets, s: config.sleepMs / 1000, t: lulls })
          : t('tower.lullabyWhat', {
              n: config.targets,
              s: config.sleepMs / 1000,
              r: config.sleepRadius,
              t: lulls,
            });
      }
    case 'subwoofer':
      // Its cooldown told as how often it fires in a barrage, as the rules will count it: the
      // first wave a cooldown in too.
      if (!('cooldownMs' in config)) return '';
      return t('tower.subwooferWhat', {
        s: config.cooldownMs / 1000,
        n: Math.floor(ruleset.phases.combatMs / config.cooldownMs),
        w: config.waveWidth,
      });
  }
}

/** A tower's price as words: "3 cannons". */
export function towerCostText(cost: number): string {
  return t('tower.cost', { n: cost });
}

/** Where the menus remember whether the last table played special towers. */
const SPECIALS_KEY = 'bollwerk.specials';

/**
 * Whether a new table plays special towers: as the host last set one, in the lobby or a
 * tournament's setup — never set, the rules' default (off, ARCHIVE 13zw).
 */
export function preferredSpecials(): boolean {
  const saved = stored(SPECIALS_KEY);
  return saved === null ? defaultRuleset.specials.enabled : saved === '1';
}

export function saveSpecials(on: boolean): void {
  store(SPECIALS_KEY, on ? '1' : '0');
}

/** Where the menu remembers the tower last chosen, as it does the name. */
const TOWER_KEY = 'bollwerk.tower';

/** A tower drawn for a player who has not chosen one, the same for the whole visit. */
let drawn: TowerVariant | null = null;

/**
 * The tower the player chose last, or none if they chose none (back since 2026-10-25, the user's)
 * — or, never chosen, a tower drawn at random among every one the rules offer at either cost, as
 * a bot's is. Drawn once a visit and not saved, so it stays a surprise until the player chooses;
 * the same for one saved before towers came at two costs, a bare kind, which names no variant.
 */
export function preferredTower(): TowerVariant | null {
  const saved = stored(TOWER_KEY);
  if (saved === 'none') return null;
  const offered = offeredVariants(defaultRuleset.specials);
  if ((offered as readonly string[]).includes(saved ?? '')) return saved as TowerVariant;
  drawn ??= offered[Math.floor(Math.random() * offered.length)] as TowerVariant;
  return drawn;
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
