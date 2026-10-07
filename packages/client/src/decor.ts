import type { ArtConfig, ArtLook, ArtStyle } from '@bollwerk/config';

import { Pixels } from './render/pixel/canvas.js';
import { water } from './render/pixel/generators.js';
import { motionReduced } from './motion.js';
import { GAME_TITLE, TITLE_LETTERS_PX, titleFor, titleLayout, titleWidth } from './titles.js';

/**
 * The menu and lobby's dressing: the title in both chosen looks at once, split by a
 * banner's line that sweeps across (the titles themselves are titles.ts), and the game's
 * own animated sea behind the panel.
 */

/** Where the line across the title is, and which look is above it. */
export interface TitleFrame {
  /** From the top of the letters, as a fraction of their height; outside 0..1 is off them. */
  split: number;
  /** The look above the line: the arriving one, as a banner crossing the board has it. */
  upper: ArtLook;
}

/** At rest the title is split through the middle, building above and combat below. */
export const TITLE_AT_REST: TitleFrame = { split: 0.5, upper: 'build' };

/** Just past the letters, so the line enters and leaves out of sight of them. */
const BEYOND = 0.12;

/**
 * The title's line, `ms` into a sweep of `span`: a round of the game in miniature. The
 * line carries on down out of the letters with building above it, so the whole word is
 * the build look; a banner then crosses it top to bottom bringing combat, as "Fire!"
 * does; and a last one brings building back and stops halfway. Each stage starts where
 * the last left the word, so nothing on it changes except under the line.
 */
export function titleSweep(ms: number, span: number): TitleFrame {
  const t = ms / span;
  if (t <= 0 || t >= 1) return TITLE_AT_REST;
  const ease = (u: number): number => 1 - (1 - u) * (1 - u);
  // A fifth to clear the word, two fifths for each banner.
  if (t < CLEARED) return { split: 0.5 + (0.5 + BEYOND) * ease(t / CLEARED), upper: 'build' };
  if (t < CROSSED) {
    return {
      split: -BEYOND + (1 + 2 * BEYOND) * ((t - CLEARED) / (CROSSED - CLEARED)),
      upper: 'combat',
    };
  }
  return { split: -BEYOND + (0.5 + BEYOND) * ease((t - CROSSED) / (1 - CROSSED)), upper: 'build' };
}

/** How far into a sweep the word is all the build look, the combat half out of sight. */
const CLEARED = 0.2;
/** How far into a sweep the combat banner has crossed, the build half out of sight. */
const CROSSED = 0.6;

/**
 * The half of the title a sweep may give a new style at `t` of the way through it, having
 * been at `before`: each half while it is wholly out of sight, as a banner on the board
 * changes a look it is about to reveal (PLAN 11.23) — the combat half once the line has
 * left the word in the build look, the build half once the combat banner has crossed.
 */
export function titleTurn(before: number, t: number): ArtLook | null {
  if (before < CLEARED && t >= CLEARED) return 'combat';
  if (before < CROSSED && t >= CROSSED) return 'build';
  return null;
}

/** Where the title's looks come from: `LookRotation`, the match's own. */
export interface TitleRotation {
  opening(): Record<ArtLook, ArtStyle>;
  isRandom(look: ArtLook): boolean;
  next(look: ArtLook, beside: ArtStyle | null): ArtStyle;
}

/**
 * The menu's title as both chosen looks at once: the build look's title above a banner's
 * gold line and the combat look's below it, the letters of the two coinciding, so the
 * word reads as one cut through by the line. The line sweeps across as either choice
 * changes and now and again while the menu is open; the same style for both is one
 * title and no line, as a banner then changes nothing.
 */
export class SplitTitle {
  private readonly layers: Record<ArtLook, HTMLElement>;
  private readonly line: HTMLElement;
  private shown: Partial<Record<ArtLook, ArtStyle>> = {};
  private same = false;
  private sweepStart: number | null = null;
  /** How far the sweep under way had come at the last frame, as a fraction. */
  private sweptTo = 0;
  private rotation: TitleRotation | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly art: ArtConfig,
  ) {
    root.style.width = `${titleWidth()}px`;
    root.style.height = `${TITLE_LETTERS_PX}px`;
    const layer = (look: ArtLook): HTMLElement => {
      const el = document.createElement('span');
      el.className = 'title-layer';
      const img = document.createElement('img');
      img.alt = look === 'build' ? GAME_TITLE : '';
      el.append(img);
      return el;
    };
    this.layers = { build: layer('build'), combat: layer('combat') };
    this.line = document.createElement('span');
    this.line.className = 'title-line';
    root.append(this.layers.build, this.layers.combat, this.line);
    this.frame(TITLE_AT_REST);
  }

  /**
   * Shows the looks a rotation opens with, sweeping the line across if either has changed,
   * and gives a random half a new style at every sweep after.
   */
  use(rotation: TitleRotation): void {
    this.rotation = rotation;
    const styles = rotation.opening();
    const changed = styles.build !== this.shown.build || styles.combat !== this.shown.combat;
    const first = this.shown.build === undefined;
    for (const look of ['build', 'combat'] as const) this.dress(look, styles[look]);
    this.frame(TITLE_AT_REST);
    if (changed && !first) this.sweep();
  }

  /** Draws one half in a style. */
  private dress(look: ArtLook, style: ArtStyle): void {
    if (style === this.shown[look]) return;
    const title = titleFor(style, this.art);
    const { height, margin } = titleLayout(title);
    const img = this.layers[look].querySelector('img')!;
    img.src = title.src;
    img.style.height = `${height}px`;
    img.style.left = img.style.top = `${margin}px`;
    img.style.imageRendering = title.smooth ? 'auto' : 'pixelated';
    img.classList.toggle('flicker', title.flicker);
    this.shown = { ...this.shown, [look]: style };
    this.same = this.shown.build === this.shown.combat;
  }

  /** Sweeps the line across once, unless motion is unwelcome or one style shows both. */
  sweep(): void {
    if (this.same || motionReduced()) return;
    const already = this.sweepStart !== null;
    this.sweepStart = performance.now();
    this.sweptTo = 0;
    if (!already) requestAnimationFrame(this.tick);
  }

  /** Sweeps now and then while the title is on the page, and stops once it has gone. */
  repeat(): void {
    this.timer ??= setInterval(() => {
      if (!this.root.isConnected) {
        clearInterval(this.timer!);
        this.timer = null;
        return;
      }
      this.sweep();
    }, this.art.menu.titleSweepEveryMs);
  }

  private readonly tick = (now: number): void => {
    if (this.sweepStart === null || !this.root.isConnected) return;
    const ms = now - this.sweepStart;
    const t = ms / this.art.menu.titleSweepMs;
    const turn = titleTurn(this.sweptTo, t);
    this.sweptTo = t;
    if (turn !== null && this.rotation?.isRandom(turn) === true) {
      const other = turn === 'build' ? 'combat' : 'build';
      this.dress(turn, this.rotation.next(turn, this.shown[other] ?? null));
    }
    this.frame(titleSweep(ms, this.art.menu.titleSweepMs));
    if (ms < this.art.menu.titleSweepMs) requestAnimationFrame(this.tick);
    else this.sweepStart = null;
  };

  private frame(frame: TitleFrame): void {
    const lower: ArtLook = frame.upper === 'build' ? 'combat' : 'build';
    if (this.same) {
      this.layers.build.dataset.side = 'whole';
      this.layers.combat.hidden = true;
      this.line.hidden = true;
      return;
    }
    this.layers.combat.hidden = false;
    this.layers[frame.upper].dataset.side = 'above';
    this.layers[lower].dataset.side = 'below';
    this.root.style.setProperty('--split', `${frame.split * TITLE_LETTERS_PX}px`);
    this.line.hidden = frame.split < 0 || frame.split > 1;
  }
}

/**
 * Lays the game's sea behind the whole page and sets it drifting. Once per page: the
 * match's canvas covers it entirely, so it can stay put underneath.
 */
export function installBackdrop(art: ArtConfig): void {
  if (document.querySelector('#backdrop') !== null) return;
  const frames = 4;
  const size = art.tileSizePx;
  // Several tiles side by side, so the pattern repeats less obviously than one would.
  const sheet = new Pixels(size * frames, size);
  const ctx = sheet.canvas.getContext('2d');
  for (let f = 0; f < frames; f++) {
    ctx?.drawImage(water(art, 7, size, f, frames, f).canvas, f * size, 0);
  }
  const backdrop = document.createElement('div');
  backdrop.id = 'backdrop';
  backdrop.style.backgroundImage = `url(${sheet.canvas.toDataURL()})`;
  backdrop.style.backgroundSize = `${size * frames * 3}px ${size * 3}px`;
  document.body.prepend(backdrop);
}
