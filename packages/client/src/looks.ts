import {
  ArtStyleSchema,
  stylesFor,
  styleServes,
  type ArtLook,
  type ArtStyle,
  type ArtStyles,
} from '@bollwerk/config';

import { escape } from './lobby.js';
import { stylePreview } from './stylePreview.js';

/**
 * Choosing the two looks (ARCHIVE 12b): a style each for building and for combat, or
 * "random", drawn afresh from every style as each match starts. One gallery of every
 * style's picture serves both, a switch at its top saying which look is being chosen; the
 * menu keeps a picture of each with arrows to step through them without opening it, and
 * the pause menu opens the same gallery to change the looks mid-match.
 */

export type LookChoice = ArtStyle | 'random';
export type LookChoices = Record<ArtLook, LookChoice>;

export const RANDOM = 'random' as const;

/** Names for the styles, as the menu and the gallery offer them. */
export const STYLE_NAMES: Record<ArtStyle, string> = {
  flat: 'Minimal',
  pixel: 'Medieval',
  night: 'Night',
  cyberpunk: 'Cyberpunk',
  blueprint: 'Blueprint',
  parchment: 'Parchment',
  bricks: 'Toy bricks',
  glass: 'Stained glass',
  chocolate: 'Chocolate',
  halloween: 'Halloween',
  sakura: 'Sakura',
};

export function lookName(choice: LookChoice): string {
  return choice === RANDOM ? 'Random' : STYLE_NAMES[choice];
}

/**
 * The first of `candidates` that is "random" or names a style made for `look` — a link's,
 * then what the menu saved, say — falling through a stale or hand-typed one to `fallback`.
 */
export function chooseLook(
  look: ArtLook,
  candidates: readonly unknown[],
  fallback: LookChoice,
): LookChoice {
  for (const candidate of candidates) {
    if (candidate === RANDOM) return RANDOM;
    const style = ArtStyleSchema.safeParse(candidate);
    if (style.success && styleServes(style.data, look)) return style.data;
  }
  return fallback;
}

/**
 * The styles a match is drawn in: each choice as it is, and "random" drawn from every
 * style made for that look — never the other look's style while there is another to draw,
 * since one style for both makes the banners change nothing. Cosmetic, and the page's own,
 * so an ordinary random source.
 */
export function resolveLooks(choices: LookChoices, random: () => number = Math.random): ArtStyles {
  const pick = (look: ArtLook, avoid: ArtStyle | null): ArtStyle => {
    const all = stylesFor(look);
    const pool = all.length > 1 && avoid !== null ? all.filter((s) => s !== avoid) : all;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  };
  const fixedBuild = choices.build === RANDOM ? null : choices.build;
  const fixedCombat = choices.combat === RANDOM ? null : choices.combat;
  const build = fixedBuild ?? pick('build', fixedCombat);
  const combat = fixedCombat ?? pick('combat', build);
  return { build, combat };
}

/**
 * Every choice the gallery and the arrows offer for a look: the styles by name, in
 * alphabetical order, so a new one finds its place as the list grows, and "random" last.
 */
export function lookOptions(look: ArtLook): LookChoice[] {
  const styles = [...stylesFor(look)].sort((a, b) => STYLE_NAMES[a].localeCompare(STYLE_NAMES[b]));
  return [...styles, RANDOM];
}

/** The choice `step` places along from `current`, round from the last to the first. */
export function stepLook(look: ArtLook, current: LookChoice, step: number): LookChoice {
  const options = lookOptions(look);
  const at = Math.max(0, options.indexOf(current));
  return options[(((at + step) % options.length) + options.length) % options.length]!;
}

/**
 * The picture for "random": a die, its face a question mark, drawn rather than rendered
 * since there is no one style to render.
 */
export const RANDOM_PICTURE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="224" height="160" viewBox="0 0 224 160">` +
      `<rect width="224" height="160" fill="#1c1d2b"/>` +
      `<g transform="rotate(-8 112 80)"><rect x="72" y="40" width="80" height="80" rx="14" fill="#f2efe6" stroke="#d8b84a" stroke-width="4"/>` +
      `<text x="112" y="100" font-family="sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="#1c1d2b">?</text></g>` +
      `<g fill="#d8b84a" opacity="0.7"><circle cx="34" cy="34" r="6"/><circle cx="190" cy="126" r="6"/><circle cx="196" cy="30" r="4"/><circle cx="28" cy="130" r="4"/></g>` +
      `</svg>`,
  );

/** The gallery's inside, apart so a test can read it without a page. */
export function galleryMarkup(choices: LookChoices, active: ArtLook): string {
  const tab = (look: ArtLook, label: string): string =>
    `<button class="tab${look === active ? ' active' : ''}" data-look="${look}">` +
    `${label} <b>${escape(lookName(choices[look]))}</b></button>`;
  const cards = lookOptions(active)
    .map((choice) => {
      const badges = (['build', 'combat'] as const)
        .filter((look) => choices[look] === choice)
        .map((look) => `<i class="badge ${look}">${look === 'build' ? 'Building' : 'Combat'}</i>`)
        .join('');
      const chosen = choices[active] === choice ? ' chosen' : '';
      return (
        `<button class="card${chosen}" data-choice="${choice}">` +
        `<img alt="" data-preview="${choice}" />` +
        `<span class="name">${escape(lookName(choice))}</span>${badges}</button>`
      );
    })
    .join('');
  return (
    `<div class="panel"><h2>Looks</h2>` +
    `<div class="tabs">${tab('build', 'Building')}${tab('combat', 'Combat')}</div>` +
    `<div class="cards">${cards}</div>` +
    `<button class="done">Done</button></div>`
  );
}

/** A choice's picture: the style's own, rendered on first asking, or the die for random. */
export function lookPicture(choice: LookChoice): Promise<string> {
  return choice === RANDOM ? Promise.resolve(RANDOM_PICTURE) : stylePreview(choice);
}

export interface GalleryOptions {
  choices: LookChoices;
  /** Which look the switch starts on: the one whose picture was clicked. */
  active: ArtLook;
  /** Whether "random" is offered: mid-match there is nothing left to draw it for. */
  random?: boolean;
  /** Every change, as it is made. */
  onChange(choices: LookChoices): void;
  /** Closed, by Done or a click outside the panel. */
  onClose?(choices: LookChoices): void;
  click?(): void;
}

/**
 * The gallery over whatever is on screen: every style's picture as a card, the switch at
 * the top saying which look a click chooses, each card wearing a badge for the look it is
 * chosen for. Clicks only, as everything is (the user's rule); closed by Done or a click
 * on the dimmed screen round it.
 */
export function openLookGallery(options: GalleryOptions): void {
  const choices = { ...options.choices };
  let active = options.active;
  const click = options.click ?? ((): void => undefined);
  const root = document.createElement('div');
  root.className = 'look-gallery';
  const render = (): void => {
    root.innerHTML = galleryMarkup(choices, active);
    if (options.random === false) root.querySelector(`[data-choice="${RANDOM}"]`)?.remove();
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-preview]')) {
      const choice = image.dataset.preview as LookChoice;
      void lookPicture(choice).then(
        (url) => {
          image.src = url;
          image.classList.add('ready');
        },
        () => undefined,
      );
    }
  };
  const close = (): void => {
    root.remove();
    options.onClose?.(choices);
  };
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === root) {
      close();
      return;
    }
    const tab = target.closest<HTMLElement>('.tab');
    if (tab !== null) {
      click();
      active = tab.dataset.look === 'combat' ? 'combat' : 'build';
      render();
      return;
    }
    const card = target.closest<HTMLElement>('.card');
    if (card !== null) {
      click();
      choices[active] = chooseLook(active, [card.dataset.choice], choices[active]);
      options.onChange({ ...choices });
      render();
      return;
    }
    if (target.closest('.done') !== null) {
      click();
      close();
    }
  });
  render();
  document.body.append(root);
}
