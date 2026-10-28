import type { VolumeKind } from './audio.js';
import type { TextKey } from '@bollwerk/config';

import { t } from './i18n.js';
import { ICONS } from './icons.js';

/** What the sliders need of the sound: its volumes, and a cue to hear one by. */
export interface VolumeTarget {
  volume(kind: VolumeKind): number;
  setVolume(kind: VolumeKind, value: number): void;
  play(cue: 'select'): void;
}

/** Each slider's label, as the menus name them: "Effects" is already the visual setting. */
const SLIDERS: readonly [VolumeKind, TextKey][] = [
  ['music', 'volume.music'],
  ['sounds', 'volume.sounds'],
];

/** The level a silenced slider's speaker brings back when nothing was remembered: full, the default. */
const RESTORED = 1;

/**
 * What a slider's speaker does: from any level to silence, remembering the level; from
 * silence back to the level remembered, or full when there is none — a slider dragged to
 * nothing has no level of its own to go back to.
 */
export function speakerToggle(
  current: number,
  remembered: number | null,
): { value: number; remembered: number | null } {
  if (current > 0) return { value: 0, remembered: current };
  return { value: remembered !== null && remembered > 0 ? remembered : RESTORED, remembered: null };
}

/** A volume as the percentage shown beside its slider. */
export function volumePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/**
 * The two volume sliders (PLAN 11.18 Y4), for the main menu and the pause menu alike:
 * music and sounds, each 0 to 100. The sounds slider plays a click as it is let go, at its
 * new level, so the player hears what they set. A speaker at each slider's left end silences
 * it and brings it back, and the percentage shows while the pointer is on the row or the
 * slider is dragged (2026-10-28).
 */
export function volumeSliders(target: VolumeTarget): HTMLElement {
  const node = document.createElement('div');
  node.className = 'volumes';
  for (const [kind, key] of SLIDERS) {
    const name = t(key);
    const row = document.createElement('div');
    row.className = 'volume';
    const label = document.createElement('span');
    label.className = 'volume-name';
    label.textContent = name;
    const speaker = document.createElement('button');
    speaker.type = 'button';
    speaker.className = 'speaker';
    speaker.dataset.kind = kind;
    speaker.setAttribute('aria-label', t('volume.speaker', { name }));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.setAttribute('aria-label', t('volume.aria', { name }));
    slider.dataset.kind = kind;
    const percent = document.createElement('output');
    percent.className = 'percent';
    let remembered: number | null = null;
    const show = (): void => {
      const value = target.volume(kind);
      slider.value = String(Math.round(value * 100));
      percent.textContent = volumePercent(value);
      speaker.innerHTML = value > 0 ? ICONS.sound : ICONS.mute;
      speaker.classList.toggle('off', value === 0);
    };
    slider.addEventListener('input', () => {
      target.setVolume(kind, Number(slider.value) / 100);
      remembered = null;
      row.classList.add('dragging');
      show();
    });
    slider.addEventListener('change', () => {
      row.classList.remove('dragging');
      if (kind === 'sounds') target.play('select');
    });
    speaker.addEventListener('click', () => {
      const next = speakerToggle(target.volume(kind), remembered);
      remembered = next.remembered;
      target.setVolume(kind, next.value);
      show();
      if (kind === 'sounds' && next.value > 0) target.play('select');
    });
    show();
    row.append(label, speaker, slider, percent);
    node.append(row);
  }
  return node;
}

/** Brings sliders up to date with the volumes as they stand, as a menu reopens. */
export function refreshVolumeSliders(node: HTMLElement, target: VolumeTarget): void {
  for (const slider of node.querySelectorAll<HTMLInputElement>('input[type=range]')) {
    const kind = slider.dataset.kind as VolumeKind;
    const value = target.volume(kind);
    slider.value = String(Math.round(value * 100));
    const row = slider.closest('.volume');
    const percent = row?.querySelector('.percent');
    if (percent) percent.textContent = volumePercent(value);
    const speaker = row?.querySelector<HTMLElement>('.speaker');
    if (speaker) {
      speaker.innerHTML = value > 0 ? ICONS.sound : ICONS.mute;
      speaker.classList.toggle('off', value === 0);
    }
  }
}
