import { graphicsOptions, parseGraphics, saveGraphics, storedGraphics } from './graphics.js';
import { escape } from './html.js';
import { enhanceChoices } from './choices.js';
import { isLanguage, languageOptions, saveLanguage, setLanguage, t } from './i18n.js';
import { motionOptions, parseMotion, saveMotion, storedMotion } from './motion.js';
import {
  parseStyleMusic,
  saveStyleMusic,
  storedStyleMusic,
  styleMusicOptions,
} from './styleMusicSetting.js';
import { volumeSliders, type VolumeTarget } from './volume.js';

/**
 * The menu's Options (2026-10-24, the user's): the settings that are not about a match —
 * the language, the Graphics, the Motion, the two volumes and how often the styles' own music
 * plays — in a panel over the menu, so
 * the menu itself keeps the looks, one of the game's highlights, and the ways into a match.
 * The overlay and panel of How to play and the Credits, so the three read as one family.
 */
export interface OptionsActions {
  /** The menu's click, and the volumes for the sliders. */
  audio: VolumeTarget;
  /** Called after the language has changed, so the menu behind is written afresh. */
  languageChanged(): void;
}

export function openOptions(actions: OptionsActions): void {
  const root = document.createElement('div');
  root.className = 'how-to-play options';
  const click = (): void => actions.audio.play('select');
  const close = (): void => {
    click();
    root.remove();
  };

  const fill = (): void => {
    root.innerHTML = `
      <div class="panel">
        <h2>${t('menu.options')}</h2>
        <label>${t('settings.language')} <select class="language" data-ui="seg">${languageOptions()}</select></label>
        <label data-tip="${escape(t('settings.graphicsTitle'))}">${t('settings.graphics')} <select class="graphics" data-ui="seg">${graphicsOptions()}</select></label>
        <label>${t('settings.motion')} <select class="motion" data-ui="seg">${motionOptions()}</select></label>
        <label data-tip="${escape(t('settings.styleMusicTitle'))}">${t('settings.styleMusic')} <select class="style-music" data-ui="seg">${styleMusicOptions()}</select></label>
        <button class="close quiet">${t('credits.close')}</button>
      </div>`;
    root.querySelector('.motion')?.closest('label')?.after(volumeSliders(actions.audio));

    const language = root.querySelector<HTMLSelectElement>('.language')!;
    language.addEventListener('change', () => {
      click();
      if (!isLanguage(language.value)) return;
      saveLanguage(language.value);
      setLanguage(language.value);
      actions.languageChanged();
      // This panel too, in the new language.
      fill();
    });
    const graphics = root.querySelector<HTMLSelectElement>('.graphics')!;
    graphics.value = storedGraphics();
    graphics.addEventListener('change', () => {
      click();
      saveGraphics(parseGraphics(graphics.value) ?? 'medium');
    });
    const motion = root.querySelector<HTMLSelectElement>('.motion')!;
    motion.value = storedMotion();
    motion.addEventListener('change', () => {
      click();
      saveMotion(parseMotion(motion.value) ?? 'full');
    });
    const styleMusic = root.querySelector<HTMLSelectElement>('.style-music')!;
    styleMusic.value = storedStyleMusic();
    styleMusic.addEventListener('change', () => {
      click();
      saveStyleMusic(parseStyleMusic(styleMusic.value) ?? 'always');
    });
    // Each choice a row of buttons in front of its select, now the selects stand as stored.
    enhanceChoices(root);
    root.querySelector('.close')?.addEventListener('click', close);
  };

  fill();
  document.body.append(root);
  // A click on the dimmed menu around the panel closes it too, as the Credits' does.
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
}
