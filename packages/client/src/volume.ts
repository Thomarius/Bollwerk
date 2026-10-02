import type { VolumeKind } from './audio.js';

/** What the sliders need of the sound: its volumes, and a cue to hear one by. */
export interface VolumeTarget {
  volume(kind: VolumeKind): number;
  setVolume(kind: VolumeKind, value: number): void;
  play(cue: 'select'): void;
}

/** Each slider's label, as the menus name them: "Effects" is already the visual setting. */
const SLIDERS: readonly [VolumeKind, string][] = [
  ['music', 'Music'],
  ['sounds', 'Sounds'],
];

/**
 * The two volume sliders (PLAN 11.18 Y4), for the main menu and the pause menu alike:
 * music and sounds, each 0 to 100. The sounds slider plays a click as it is let go, at its
 * new level, so the player hears what they set.
 */
export function volumeSliders(target: VolumeTarget): HTMLElement {
  const node = document.createElement('div');
  node.className = 'volumes';
  for (const [kind, name] of SLIDERS) {
    const label = document.createElement('label');
    label.className = 'volume';
    label.textContent = name;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(Math.round(target.volume(kind) * 100));
    slider.setAttribute('aria-label', `${name} volume`);
    slider.dataset.kind = kind;
    slider.addEventListener('input', () => target.setVolume(kind, Number(slider.value) / 100));
    if (kind === 'sounds') slider.addEventListener('change', () => target.play('select'));
    label.append(slider);
    node.append(label);
  }
  return node;
}

/** Brings sliders up to date with the volumes as they stand, as a menu reopens. */
export function refreshVolumeSliders(node: HTMLElement, target: VolumeTarget): void {
  for (const slider of node.querySelectorAll<HTMLInputElement>('input[type=range]')) {
    const kind = slider.dataset.kind as VolumeKind;
    slider.value = String(Math.round(target.volume(kind) * 100));
  }
}
