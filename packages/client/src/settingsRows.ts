import { graphicsOptions, parseGraphics, saveGraphics, storedGraphics } from './graphics.js';
import { escape } from './html.js';
import { enhanceChoices, syncChoices } from './choices.js';
import { isLanguage, languageOptions, saveLanguage, setLanguage, t } from './i18n.js';
import { motionOptions, parseMotion, saveMotion, storedMotion } from './motion.js';
import {
  parseStyleMusic,
  saveStyleMusic,
  storedStyleMusic,
  styleMusicOptions,
} from './styleMusicSetting.js';
import { refreshVolumeSliders, volumeSliders, type VolumeTarget } from './volume.js';

/**
 * The player's settings — the language, the Graphics, the Motion, the two volumes and how
 * often the styles' own music plays — as one column of rows, built here for the menu's Options
 * and the pause menu alike, so the two look and order them the same (2026-10-28: the pause
 * menu's had been smaller, dimmer and in another order).
 */
export interface SettingsActions {
  /** The menus' click. */
  click(): void;
  /** The volumes, for the sliders. */
  volumes: VolumeTarget;
  /** Called once a new language is in use, for whatever holds the rows to be written afresh. */
  languageChanged(): void;
}

/** The rows, their controls wired, each setting saved and taken as it is chosen. */
export function settingsRows(actions: SettingsActions): HTMLElement {
  const node = document.createElement('div');
  node.className = 'settings-rows';
  node.innerHTML =
    `<label>${t('settings.language')} <select class="language" data-ui="seg">${languageOptions()}</select></label>` +
    `<label data-tip="${escape(t('settings.graphicsTitle'))}">${t('settings.graphics')} <select class="graphics" data-ui="seg">${graphicsOptions()}</select></label>` +
    `<label>${t('settings.motion')} <select class="motion" data-ui="seg">${motionOptions()}</select></label>` +
    `<label data-tip="${escape(t('settings.styleMusicTitle'))}">${t('settings.styleMusic')} <select class="style-music" data-ui="seg">${styleMusicOptions()}</select></label>`;
  node.querySelector('.motion')?.closest('label')?.after(volumeSliders(actions.volumes));

  const language = node.querySelector<HTMLSelectElement>('.language')!;
  language.addEventListener('change', () => {
    actions.click();
    if (!isLanguage(language.value)) return;
    saveLanguage(language.value);
    setLanguage(language.value);
    actions.languageChanged();
  });
  // Both taken at once in a match: it redraws at the level's resolution (`onGraphics`), its
  // bloom put on or taken off (`render/bloom.ts`), and the motion read every frame.
  const graphics = node.querySelector<HTMLSelectElement>('.graphics')!;
  graphics.addEventListener('change', () => {
    actions.click();
    saveGraphics(parseGraphics(graphics.value) ?? 'medium');
  });
  const motion = node.querySelector<HTMLSelectElement>('.motion')!;
  motion.addEventListener('change', () => {
    actions.click();
    saveMotion(parseMotion(motion.value) ?? 'full');
  });
  // Taken at the next look's start, the track playing left to finish (`matchScreen.ts`).
  const styleMusic = node.querySelector<HTMLSelectElement>('.style-music')!;
  styleMusic.addEventListener('change', () => {
    actions.click();
    saveStyleMusic(parseStyleMusic(styleMusic.value) ?? 'always');
  });
  showStored(node);
  // Each choice a row of buttons in front of its select, now the selects stand as stored.
  enhanceChoices(node);
  return node;
}

/** The selects as the settings are stored. */
function showStored(node: HTMLElement): void {
  node.querySelector<HTMLSelectElement>('.graphics')!.value = storedGraphics();
  node.querySelector<HTMLSelectElement>('.motion')!.value = storedMotion();
  node.querySelector<HTMLSelectElement>('.style-music')!.value = storedStyleMusic();
}

/** The rows brought up to date with the settings as they stand, as a menu reopens. */
export function refreshSettingsRows(node: HTMLElement, volumes: VolumeTarget): void {
  showStored(node);
  // Set by script, so shown afresh.
  syncChoices(node);
  refreshVolumeSliders(node, volumes);
}
