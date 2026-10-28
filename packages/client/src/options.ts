import { t } from './i18n.js';
import { settingsRows } from './settingsRows.js';
import type { VolumeTarget } from './volume.js';

/**
 * The menu's Options (2026-10-24, the user's): the settings that are not about a match —
 * the language, the Graphics, the Motion, the two volumes and how often the styles' own music
 * plays — in a panel over the menu, so
 * the menu itself keeps the looks, one of the game's highlights, and the ways into a match.
 * The overlay and panel of How to play and the Credits, so the three read as one family; the
 * rows the pause menu's too (`settingsRows.ts`).
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
        <button class="close quiet">${t('credits.close')}</button>
      </div>`;
    root.querySelector('h2')?.after(
      settingsRows({
        click,
        volumes: actions.audio,
        languageChanged: () => {
          actions.languageChanged();
          // This panel too, in the new language.
          fill();
        },
      }),
    );
    root.querySelector('.close')?.addEventListener('click', close);
  };

  fill();
  document.body.append(root);
  // A click on the dimmed menu around the panel closes it too, as the Credits' does.
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
}
