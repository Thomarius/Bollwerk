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

/** How far into a pass the line is at the middle of the letters. */
const MIDDLE = (0.5 + BEYOND) / (1 + 2 * BEYOND);

/**
 * Passes of the line since the title began gliding, as a whole and a fraction: begun in
 * the second pass with the line at the middle, so the glide starts where the title rests.
 */
function passes(ms: number, passMs: number): number {
  return 1 + MIDDLE + ms / passMs;
}

/**
 * The title's line, `ms` into its glide: down across the letters at an even pace, out of
 * sight below them, and in again from above, each pass a banner bringing the other look
 * over the whole word — combat, then building, as a round's banners do. Without a pause, at
 * one speed: the line stopped at the middle and waited between sweeps until the test session
 * of 2026-10-08 asked for it slower and never still. Leaving at the foot and entering at the
 * head, the line is out of sight both times, so nothing on the word jumps.
 */
export function titleGlide(ms: number, passMs: number): TitleFrame {
  const u = passes(ms, passMs);
  const pass = Math.floor(u);
  return {
    split: -BEYOND + (1 + 2 * BEYOND) * (u - pass),
    upper: pass % 2 === 0 ? 'combat' : 'build',
  };
}

/**
 * The half of the title that may take a new style between `before` and `ms` into the glide,
 * or null: at the start of each pass, the half that pass brings — wholly out of sight then,
 * since the word is all the other look — as a banner on the board changes a look it is about
 * to reveal (PLAN 11.23). A frame that skips past the moment still turns it.
 */
export function titleTurn(before: number, ms: number, passMs: number): ArtLook | null {
  const was = Math.floor(passes(before, passMs));
  const now = Math.floor(passes(ms, passMs));
  if (now === was) return null;
  return now % 2 === 0 ? 'combat' : 'build';
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
 * word reads as one cut through by the line, which glides across it without end while the
 * menu is open (`titleGlide`); the same style for both is one title and no line, as a
 * banner then changes nothing.
 */
export class SplitTitle {
  private readonly layers: Record<ArtLook, HTMLElement>;
  private readonly line: HTMLElement;
  private shown: Partial<Record<ArtLook, ArtStyle>> = {};
  private same = false;
  /** When the glide began, or null while the title rests. */
  private glideStart: number | null = null;
  /** How far into the glide the last frame was. */
  private glidedTo = 0;
  private rotation: TitleRotation | null = null;

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
   * Shows the looks a rotation opens with — a choice changed shows at once — and gives a
   * random half a new style at every pass after.
   */
  use(rotation: TitleRotation): void {
    this.rotation = rotation;
    const styles = rotation.opening();
    for (const look of ['build', 'combat'] as const) this.dress(look, styles[look]);
    if (this.glideStart === null) this.frame(TITLE_AT_REST);
    this.glide();
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

  /**
   * Sets the line gliding, from where the title rests, unless it already is, motion is
   * unwelcome, or one style shows both — then there is no line to move.
   */
  glide(): void {
    if (this.glideStart !== null || this.same || motionReduced()) return;
    this.glideStart = performance.now();
    this.glidedTo = 0;
    requestAnimationFrame(this.tick);
  }

  /** A frame of the glide, until the title has left the page or one style shows both. */
  private readonly tick = (now: number): void => {
    if (this.glideStart === null) return;
    if (!this.root.isConnected || this.same) {
      this.glideStart = null;
      this.frame(TITLE_AT_REST);
      return;
    }
    const passMs = this.art.menu.titlePassMs;
    const ms = now - this.glideStart;
    const turn = titleTurn(this.glidedTo, ms, passMs);
    this.glidedTo = ms;
    if (turn !== null && this.rotation?.isRandom(turn) === true) {
      const other = turn === 'build' ? 'combat' : 'build';
      this.dress(turn, this.rotation.next(turn, this.shown[other] ?? null));
    }
    this.frame(titleGlide(ms, passMs));
    requestAnimationFrame(this.tick);
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
