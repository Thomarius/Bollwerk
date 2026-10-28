import type { TextKey } from '@bollwerk/config';

import {
  isLanguage,
  languageOptions,
  onLanguageChange,
  saveLanguage,
  setLanguage,
  t,
} from './i18n.js';
import { escape } from './html.js';
import { graphicsOptions, parseGraphics, saveGraphics, storedGraphics } from './graphics.js';
import { motionOptions, parseMotion, saveMotion, storedMotion } from './motion.js';
import {
  parseStyleMusic,
  saveStyleMusic,
  storedStyleMusic,
  styleMusicOptions,
} from './styleMusicSetting.js';
import { refreshVolumeSliders, volumeSliders, type VolumeTarget } from './volume.js';

/**
 * Pausing a match: a button beside the Sound switch, Esc, and an overlay saying who
 * paused. For the test sessions anyone at the table may pause and anyone resume, with no
 * limit (PLAN 11.12 F2). Esc is the one keyboard shortcut the game keeps beyond the listed
 * controls, being what games use for this; everything it does also has something on
 * screen to click.
 *
 * The overlay is the match's menu (PLAN 11.18 Y2): Resume, the Graphics, Motion, Style music and
 * Sound settings
 * as the main menu has them, How to play, and Leave match, which asks once more before it goes — one
 * stray click should not end somebody's match.
 */

/** The overlay's line: who paused, from the viewer's side. */
export function pauseText(pausedBy: number, humanPlayer: number, names: readonly string[]): string {
  if (pausedBy === humanPlayer || pausedBy < 0) return t('pause.you');
  const name = names[pausedBy];
  return name === undefined ? t('pause.anyone') : t('pause.by', { name });
}

/**
 * Whether a match pauses as its window loses focus (PLAN §11 item 4, UP1): a local one a
 * person plays, still running — never online, where a pause stops everyone, nor a bot match
 * only watched. A hidden page already stood still, its frames stopped and the time on return
 * capped (`LocalMatch.advance`), but came back straight into play; a window left for another
 * in view played on.
 */
export function pausesOnBlur(match: {
  online: boolean;
  humanPlayer: number;
  pausedBy: number | null;
  over: boolean;
}): boolean {
  return !match.online && match.humanPlayer >= 0 && match.pausedBy === null && !match.over;
}

/** What the pause menu does, given by the match it belongs to. */
export interface PauseActions {
  /** Pauses or resumes, for everyone once a server agrees. */
  toggle(paused: boolean): void;
  /** Leaves the match for the main menu. */
  leave(): void;
  /** What Leave match asks before it goes, where leaving means more than leaving. */
  leaveConfirm?: TextKey;
  /** The sound's state, shared with the corner switch. */
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** The menu's click. */
  click(): void;
  /** The music and sounds volumes, for the sliders. */
  volumes: VolumeTarget;
  /** Opens the gallery of looks, to change them mid-match (ARCHIVE 12b). */
  looks?(): void;
  /** Opens How to play at the phase being played, returning its closing (ARCHIVE 14zq). */
  howToPlay?(): () => void;
}

export class PauseControls {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private line!: HTMLParagraphElement;
  private sound!: HTMLButtonElement;
  private leaving!: HTMLButtonElement;
  private sliders!: HTMLElement;
  /** How to play, while it is open over this menu: it goes as the match resumes. */
  private closeHowTo: (() => void) | null = null;
  /** What the line says, so the DOM is touched only when it changes. */
  private shown: string | null = null;
  private paused = false;
  private over = false;
  private readonly stopListening: () => void;
  private readonly key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.over) return;
    event.preventDefault();
    this.actions.toggle(!this.paused);
  };

  constructor(private readonly actions: PauseActions) {
    this.button = document.createElement('button');
    this.button.id = 'pause';
    this.button.addEventListener('click', () => {
      actions.click();
      actions.toggle(!this.paused);
      // Off the button, so Space or Enter later cannot press it again unseen.
      this.button.blur();
    });

    // Built once and kept: rewriting it while open would replace a control under the mouse —
    // except when the language changes, which is chosen in it, and fills it afresh.
    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay';
    this.overlay.hidden = true;
    this.fill();
    this.stopListening = onLanguageChange(() => {
      this.fill();
      // The line and the settings are written again at the next frame, as on opening.
      this.shown = null;
    });

    // In the corner's row beside Sound and Full screen (`app.ts`), where there is one.
    (document.querySelector('#corner') ?? document.body).append(this.button);
    document.body.append(this.overlay);
    globalThis.addEventListener('keydown', this.key);
  }

  /** The overlay's contents, in the language in use, its controls wired. */
  private fill(): void {
    const actions = this.actions;
    this.button.textContent = this.paused ? t('pause.resume') : t('pause.button');
    this.button.title = t('pause.buttonTitle');
    this.overlay.innerHTML =
      `<div class="panel"><strong>${t('pause.title')}</strong><p class="who"></p>` +
      `<button class="resume">${t('pause.resume')}</button>` +
      `<div class="settings">` +
      `<label title="${escape(t('settings.graphicsTitle'))}">${t('settings.graphics')} <select class="graphics">${graphicsOptions()}</select></label>` +
      `<label>${t('settings.motion')} <select class="motion">${motionOptions()}</select></label>` +
      `<label title="${escape(t('settings.styleMusicTitle'))}">${t('settings.styleMusic')} <select class="style-music">${styleMusicOptions()}</select></label>` +
      `<label>${t('settings.language')} <select class="language">${languageOptions()}</select></label>` +
      `</div>` +
      // The buttons in a row of their own under the settings and volumes, which are a column
      // as the menu's Options lays them out: in one long row they nearly filled the screen.
      `<div class="actions">` +
      `<button class="sound quiet"></button>` +
      (actions.looks === undefined
        ? ''
        : `<button class="looks quiet">${t('pause.looks')}</button>`) +
      (actions.howToPlay === undefined
        ? ''
        : `<button class="how-to quiet">${t('menu.howToPlay')}</button>`) +
      `</div>` +
      `<button class="leave-match quiet">${t('pause.leave')}</button>` +
      `<small>${t('pause.escHint')}</small></div>`;
    this.line = this.overlay.querySelector<HTMLParagraphElement>('.who')!;
    this.sound = this.overlay.querySelector<HTMLButtonElement>('.sound')!;
    this.leaving = this.overlay.querySelector<HTMLButtonElement>('.leave-match')!;
    this.sliders = volumeSliders(actions.volumes);
    this.overlay.querySelector('.settings')?.after(this.sliders);
    // Both taken at once: the match redraws at the level's resolution (`onGraphics`), its
    // bloom put on or taken off (`render/bloom.ts`), and the motion read every frame.
    const graphics = this.overlay.querySelector<HTMLSelectElement>('.graphics')!;
    graphics.value = storedGraphics();
    graphics.addEventListener('change', () => {
      actions.click();
      saveGraphics(parseGraphics(graphics.value) ?? 'medium');
    });
    const motion = this.overlay.querySelector<HTMLSelectElement>('.motion')!;
    motion.value = storedMotion();
    motion.addEventListener('change', () => {
      actions.click();
      saveMotion(parseMotion(motion.value) ?? 'full');
    });
    // Taken at the next look's start, the track playing left to finish (`matchScreen.ts`).
    const styleMusic = this.overlay.querySelector<HTMLSelectElement>('.style-music')!;
    styleMusic.value = storedStyleMusic();
    styleMusic.addEventListener('change', () => {
      actions.click();
      saveStyleMusic(parseStyleMusic(styleMusic.value) ?? 'always');
    });
    this.showSound();

    this.overlay.querySelector('.resume')?.addEventListener('click', () => {
      actions.click();
      actions.toggle(false);
    });
    // The language, mid-match: the HUD takes it at the next frame, this menu at once.
    const language = this.overlay.querySelector<HTMLSelectElement>('.language')!;
    language.addEventListener('change', () => {
      actions.click();
      if (!isLanguage(language.value)) return;
      saveLanguage(language.value);
      setLanguage(language.value);
    });
    this.overlay.querySelector('.looks')?.addEventListener('click', () => {
      actions.click();
      actions.looks?.();
    });
    this.overlay.querySelector('.how-to')?.addEventListener('click', () => {
      actions.click();
      this.closeHowTo?.();
      this.closeHowTo = actions.howToPlay?.() ?? null;
    });
    this.sound.addEventListener('click', () => {
      actions.setMuted(!actions.isMuted());
      actions.click();
      this.showSound();
    });
    this.leaving.addEventListener('click', () => {
      actions.click();
      if (this.leaving.classList.contains('confirm')) {
        actions.leave();
        return;
      }
      this.leaving.classList.add('confirm');
      this.leaving.textContent = t(actions.leaveConfirm ?? 'pause.leaveConfirm');
    });
  }

  private showSound(): void {
    this.sound.textContent = this.actions.isMuted() ? t('sound.off') : t('sound.on');
    this.sound.classList.toggle('off', this.actions.isMuted());
  }

  /** Called every frame with the match as it stands. */
  update(pausedBy: number | null, humanPlayer: number, names: readonly string[], over: boolean) {
    this.over = over;
    this.paused = pausedBy !== null;
    // Written only on a change: this runs every frame.
    if (this.button.hidden !== over) this.button.hidden = over;
    const label = this.paused ? t('pause.resume') : t('pause.button');
    if (this.button.textContent !== label) this.button.textContent = label;
    const text = pausedBy === null || over ? null : pauseText(pausedBy, humanPlayer, names);
    if (text === this.shown) return;
    const opening = this.shown === null && text !== null;
    this.shown = text;
    this.overlay.hidden = text === null;
    if (text === null) this.hideHowTo();
    this.line.textContent = text ?? '';
    if (opening) {
      // As the menu opens: the settings as they stand, and the leave asked for afresh.
      this.overlay.querySelector<HTMLSelectElement>('.graphics')!.value = storedGraphics();
      this.overlay.querySelector<HTMLSelectElement>('.motion')!.value = storedMotion();
      this.overlay.querySelector<HTMLSelectElement>('.style-music')!.value = storedStyleMusic();
      this.showSound();
      refreshVolumeSliders(this.sliders, this.actions.volumes);
      this.leaving.classList.remove('confirm');
      this.leaving.textContent = t('pause.leave');
    }
  }

  private hideHowTo(): void {
    this.closeHowTo?.();
    this.closeHowTo = null;
  }

  destroy(): void {
    this.hideHowTo();
    globalThis.removeEventListener('keydown', this.key);
    this.stopListening();
    this.button.remove();
    this.overlay.remove();
  }
}
