import type { TextKey } from '@bollwerk/config';

import { t } from './i18n.js';
import { escape } from './lobby.js';
import { saveEffects, storedEffects, type EffectsLevel } from './motion.js';
import { refreshVolumeSliders, volumeSliders, type VolumeTarget } from './volume.js';

/**
 * Pausing a match: a button beside the Sound switch, Esc, and an overlay saying who
 * paused. For the test sessions anyone at the table may pause and anyone resume, with no
 * limit (PLAN 11.12 F2). Esc is the one keyboard shortcut the game keeps beyond the listed
 * controls, being what games use for this; everything it does also has something on
 * screen to click.
 *
 * The overlay is the match's menu (PLAN 11.18 Y2): Resume, the Effects and Sound settings
 * as the main menu has them, and Leave match, which asks once more before it goes — one
 * stray click should not end somebody's match.
 */

/** The overlay's line: who paused, from the viewer's side. */
export function pauseText(pausedBy: number, humanPlayer: number, names: readonly string[]): string {
  if (pausedBy === humanPlayer || pausedBy < 0) return t('pause.you');
  const name = names[pausedBy];
  return name === undefined ? t('pause.anyone') : t('pause.by', { name });
}

/** What the pause menu does, given by the match it belongs to. */
export interface PauseActions {
  /** Pauses or resumes, for everyone once a server agrees. */
  toggle(paused: boolean): void;
  /** Leaves the match for the main menu. */
  leave(): void;
  /** The sound's state, shared with the corner switch. */
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** The menu's click. */
  click(): void;
  /** The music and sounds volumes, for the sliders. */
  volumes: VolumeTarget;
  /** Opens the gallery of looks, to change them mid-match (ARCHIVE 12b). */
  looks?(): void;
}

/** The Effects choices as the main menu names them. */
export const EFFECTS: readonly [EffectsLevel, TextKey][] = [
  ['high', 'effects.high'],
  ['full', 'effects.full'],
  ['reduced', 'effects.reduced'],
];

export class PauseControls {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly line: HTMLParagraphElement;
  private readonly sound: HTMLButtonElement;
  private readonly leaving: HTMLButtonElement;
  private readonly glowNote: HTMLElement;
  private readonly sliders: HTMLElement;
  /** What the line says, so the DOM is touched only when it changes. */
  private shown: string | null = null;
  private paused = false;
  private over = false;
  private readonly key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.over) return;
    event.preventDefault();
    this.actions.toggle(!this.paused);
  };

  constructor(private readonly actions: PauseActions) {
    this.button = document.createElement('button');
    this.button.id = 'pause';
    this.button.textContent = t('pause.button');
    this.button.title = t('pause.buttonTitle');
    this.button.addEventListener('click', () => {
      actions.click();
      actions.toggle(!this.paused);
      // Off the button, so Space or Enter later cannot press it again unseen.
      this.button.blur();
    });

    // Built once and kept: rewriting it while open would replace a control under the mouse.
    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay';
    this.overlay.hidden = true;
    const options = EFFECTS.map(
      ([value, key]) => `<option value="${value}">${escape(t(key))}</option>`,
    ).join('');
    this.overlay.innerHTML =
      `<div class="panel"><strong>${t('pause.title')}</strong><p class="who"></p>` +
      `<button class="resume">${t('pause.resume')}</button>` +
      `<div class="settings">` +
      `<label>${t('settings.effects')} <select class="effects">${options}</select></label>` +
      `<button class="sound quiet"></button>` +
      (actions.looks === undefined
        ? ''
        : `<button class="looks quiet">${t('pause.looks')}</button>`) +
      `</div><small class="glow-note" hidden>${t('pause.glowNote')}</small>` +
      `<button class="leave-match quiet">${t('pause.leave')}</button>` +
      `<small>${t('pause.escHint')}</small></div>`;
    this.line = this.overlay.querySelector<HTMLParagraphElement>('.who')!;
    this.sound = this.overlay.querySelector<HTMLButtonElement>('.sound')!;
    this.leaving = this.overlay.querySelector<HTMLButtonElement>('.leave-match')!;
    this.glowNote = this.overlay.querySelector<HTMLElement>('.glow-note')!;
    this.sliders = volumeSliders(actions.volumes);
    this.overlay.querySelector('.settings')?.after(this.sliders);
    const effects = this.overlay.querySelector<HTMLSelectElement>('.effects')!;
    const glowAtStart = storedEffects() === 'high';

    this.overlay.querySelector('.resume')?.addEventListener('click', () => {
      actions.click();
      actions.toggle(false);
    });
    // Motion takes effect at once; the glow is a filter chosen as a match's looks are made.
    effects.addEventListener('change', () => {
      actions.click();
      const level = (EFFECTS.find(([value]) => value === effects.value)?.[0] ??
        'full') as EffectsLevel;
      saveEffects(level);
      this.glowNote.hidden = (level === 'high') === glowAtStart;
    });
    this.overlay.querySelector('.looks')?.addEventListener('click', () => {
      actions.click();
      actions.looks?.();
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
      this.leaving.textContent = t('pause.leaveConfirm');
    });

    document.body.append(this.button, this.overlay);
    globalThis.addEventListener('keydown', this.key);
  }

  private showSound(): void {
    this.sound.textContent = this.actions.isMuted() ? t('sound.off') : t('sound.on');
    this.sound.classList.toggle('off', this.actions.isMuted());
  }

  /** Called every frame with the match as it stands. */
  update(pausedBy: number | null, humanPlayer: number, names: readonly string[], over: boolean) {
    this.over = over;
    this.paused = pausedBy !== null;
    this.button.hidden = over;
    this.button.textContent = this.paused ? t('pause.resume') : t('pause.button');
    const text = pausedBy === null || over ? null : pauseText(pausedBy, humanPlayer, names);
    if (text === this.shown) return;
    const opening = this.shown === null && text !== null;
    this.shown = text;
    this.overlay.hidden = text === null;
    this.line.textContent = text ?? '';
    if (opening) {
      // As the menu opens: the settings as they stand, and the leave asked for afresh.
      this.overlay.querySelector<HTMLSelectElement>('.effects')!.value = storedEffects();
      this.showSound();
      refreshVolumeSliders(this.sliders, this.actions.volumes);
      this.leaving.classList.remove('confirm');
      this.leaving.textContent = t('pause.leave');
    }
  }

  destroy(): void {
    globalThis.removeEventListener('keydown', this.key);
    this.button.remove();
    this.overlay.remove();
  }
}
