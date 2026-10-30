import { escape } from './html.js';
import { t } from './i18n.js';
import { store, stored } from './storage.js';

/**
 * Which special towers' emblems ride beside the aiming cursor (2026-10-30, the user's): only the
 * one ready soonest, or every one the player owns, side by side. The emblem took the place of a
 * second reload ring inside the guns' one, which the testers kept mixing up with it.
 */
export type TowerBadgesSetting = 'next' | 'all';

const KEY = 'bollwerk.towerBadges';

export const TOWER_BADGES_SETTINGS: readonly TowerBadgesSetting[] = ['next', 'all'];

export function parseTowerBadges(saved: string | null | undefined): TowerBadgesSetting | null {
  return TOWER_BADGES_SETTINGS.find((setting) => setting === saved) ?? null;
}

/** Read every frame the cursor is drawn, so kept here rather than read from storage each time. */
let current: TowerBadgesSetting | null = null;

export function storedTowerBadges(): TowerBadgesSetting {
  current ??= parseTowerBadges(stored(KEY)) ?? 'next';
  return current;
}

export function saveTowerBadges(chosen: TowerBadgesSetting): void {
  current = chosen;
  store(KEY, chosen);
}

/** The choices as the menu offers them, for a `<select>`. */
export function towerBadgesOptions(): string {
  return TOWER_BADGES_SETTINGS.map(
    (value) => `<option value="${value}">${escape(t(`towerBadges.${value}`))}</option>`,
  ).join('');
}
