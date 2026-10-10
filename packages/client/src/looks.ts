import {
  ArtStyleSchema,
  stylesFor,
  styleServes,
  type ArtLook,
  type ArtStyle,
  type ArtStyles,
  type TextKey,
} from '@bollwerk/config';

import { LivePreview } from './galleryLive.js';
import { t } from './i18n.js';
import { escape } from './html.js';
import { store, stored } from './storage.js';
import { stylePreview } from './stylePreview.js';

/**
 * Choosing the two looks (ARCHIVE 12b): a style each for building and for combat, or
 * "random", a new style at every banner (PLAN 11.23). One gallery of every
 * style's picture serves both, a switch at its top saying which look is being chosen; the
 * menu keeps a picture of each with arrows to step through them without opening it, and
 * the pause menu opens the same gallery to change the looks mid-match.
 *
 * A style may be hearted as a favourite, and random then draws only from the favourites —
 * one set for both looks, each look drawing from those made for it, or from all its styles
 * when none is.
 */

export type LookChoice = ArtStyle | 'random';
export type LookChoices = Record<ArtLook, LookChoice>;

export const RANDOM = 'random' as const;

/** The texts naming the styles, as the menu and the gallery offer them. */
const STYLE_NAMES: Record<LookChoice, TextKey> = {
  flat: 'style.flat',
  pixel: 'style.pixel',
  night: 'style.night',
  cyberpunk: 'style.cyberpunk',
  blueprint: 'style.blueprint',
  parchment: 'style.parchment',
  bricks: 'style.bricks',
  glass: 'style.glass',
  chocolate: 'style.chocolate',
  halloween: 'style.halloween',
  sakura: 'style.sakura',
  oktoberfest: 'style.oktoberfest',
  opera: 'style.opera',
  office: 'style.office',
  undersea: 'style.undersea',
  electric: 'style.electric',
  cartoon: 'style.cartoon',
  christmas: 'style.christmas',
  noir: 'style.noir',
  random: 'style.random',
};

export function lookName(choice: LookChoice): string {
  return t(STYLE_NAMES[choice]);
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

/** Where the hearted styles are kept: the page's own, as the looks are. */
const FAVOURITES_KEY = 'bollwerk.favourites';

/** The hearted styles, in the styles' own order; anything stale or hand-typed dropped. */
export function storedFavourites(): ArtStyle[] {
  try {
    const raw: unknown = JSON.parse(stored(FAVOURITES_KEY) ?? '[]');
    return Array.isArray(raw) ? ArtStyleSchema.options.filter((style) => raw.includes(style)) : [];
  } catch {
    return [];
  }
}

export function saveFavourites(styles: readonly ArtStyle[]): void {
  store(FAVOURITES_KEY, JSON.stringify(ArtStyleSchema.options.filter((s) => styles.includes(s))));
}

/**
 * The styles a random `look` draws from: the favourites made for it, or every style made
 * for it when none is. A single favourite is then the only style the look ever takes.
 */
export function drawnFrom(look: ArtLook, favourites: readonly ArtStyle[]): ArtStyle[] {
  const all = stylesFor(look);
  const hearted = all.filter((style) => favourites.includes(style));
  return hearted.length > 0 ? hearted : [...all];
}

/**
 * The styles a match is drawn in, look after look (PLAN 11.23): a chosen style stays as it
 * is, and "random" brings a new one at every banner that shows its look, repeating none
 * while any is left. The looks follow each other on screen as building, then combat at
 * "Fire!", building again at "Rebuild" and so on, and they are drawn in that order — the
 * build look's next at each "Rebuild", the combat look's at each "Fire!".
 *
 * Both random share one cycle of every style, so each shows once in it whichever look it
 * falls to; one random cycles through every style but the other look's. A new cycle keeps
 * the styles last shown to its end, so a look never comes back in the style it had, and
 * two looks one after the other are never the same, so every banner changes something. Cosmetic, and the page's own, so an ordinary
 * random source.
 *
 * Random draws from the favourites (`drawnFrom`), read afresh at every banner: hearted
 * mid-match, they count from the next. Too few of them for both rules, a look keeps its
 * style rather than following the other's, so every banner still changes something where
 * there are two.
 */
export class LookRotation {
  /** What is left of the current cycle, in the order it will be drawn. */
  private cycle: ArtStyle[] = [];
  /** The style each look was last given, which a new cycle keeps to its end. */
  private last: Partial<Record<ArtLook, ArtStyle>> = {};
  /** The favourites the cycle was made from: changed, it is made again. */
  private madeFrom = '';

  constructor(
    private readonly choices: LookChoices,
    private readonly random: () => number = Math.random,
    private readonly favourites: () => readonly ArtStyle[] = storedFavourites,
  ) {}

  /** Whether any look changes from banner to banner. */
  get rotates(): boolean {
    return this.isRandom('build') || this.isRandom('combat');
  }

  /** The two looks to open with: building's, then the combat look it gives way to. */
  opening(): ArtStyles {
    const build = this.next('build');
    return { build, combat: this.next('combat') };
  }

  /** Whether `look` takes a new style at its banners. */
  isRandom(look: ArtLook): boolean {
    return this.choices[look] === RANDOM;
  }

  /**
   * The style `look` takes when it next comes on screen; never `beside`, the other look's
   * style it will follow, while there is another.
   */
  next(look: ArtLook, beside: ArtStyle | null = null): ArtStyle {
    const choice = this.choices[look];
    if (choice !== RANDOM) return choice;
    const favourites = this.favourites();
    if (favourites.join() !== this.madeFrom) this.cycle = [];
    const from = drawnFrom(look, favourites);
    const fits = (style: ArtStyle): boolean =>
      from.includes(style) && style !== this.last[look] && style !== beside;
    let at = this.cycle.findIndex(fits);
    if (at < 0) {
      this.cycle = this.shuffled(favourites);
      at = this.cycle.findIndex(fits);
    }
    // Only with few styles to draw from does the last one have to come again — rather
    // than the other look's, so the banner still changes something — and with one, both.
    if (at < 0) at = this.cycle.findIndex((style) => from.includes(style) && style !== beside);
    if (at < 0) at = this.cycle.findIndex((style) => from.includes(style));
    const style = at < 0 ? from[0]! : this.cycle.splice(at, 1)[0]!;
    this.last[look] = style;
    return style;
  }

  /**
   * A new cycle: every style a random look may take, but a chosen look's own — unless it
   * is the only favourite that look has.
   */
  private shuffled(favourites: readonly ArtStyle[]): ArtStyle[] {
    this.madeFrom = favourites.join();
    const looks = (['build', 'combat'] as const).filter((look) => this.choices[look] === RANDOM);
    const chosen: readonly string[] = Object.values(this.choices);
    const drawn = new Set<ArtStyle>();
    for (const look of looks) {
      const from = drawnFrom(look, favourites);
      const others = from.filter((style) => !chosen.includes(style));
      for (const style of others.length > 0 ? others : from) drawn.add(style);
    }
    const pool = ArtStyleSchema.options.filter((style) => drawn.has(style));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    // The styles on screen last go to the back, so a new cycle never brings a look back
    // in the style it had, nor in the other's: drawn anywhere, the combat look once came
    // twice in one style across a cycle's end.
    const recent = Object.values(this.last);
    return [
      ...pool.filter((style) => !recent.includes(style)),
      ...pool.filter((style) => recent.includes(style)),
    ];
  }
}

/**
 * Every choice the gallery and the arrows offer for a look: the styles by name, in
 * alphabetical order, so a new one finds its place as the list grows, and "random" last.
 */
export function lookOptions(look: ArtLook): LookChoice[] {
  const styles = [...stylesFor(look)].sort((a, b) => lookName(a).localeCompare(lookName(b)));
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

/** A heart, drawn rather than a glyph, which not every look's font has: filled when hearted. */
function heart(on: boolean): string {
  return (
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.6-4.6-9.5-9.3C1.1 7.7 3.3 4.2 6.8 4.2c2.2 0 3.7 1.3 5.2 3.1 1.5-1.8 3-3.1 5.2-3.1 3.5 0 5.7 3.5 4.3 7-1.9 4.7-9.5 9.3-9.5 9.3z" ` +
    `fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`
  );
}

/** The gallery's inside, apart so a test can read it without a page. */
export function galleryMarkup(
  choices: LookChoices,
  active: ArtLook,
  favourites: readonly ArtStyle[] = [],
): string {
  const tab = (look: ArtLook, label: string): string =>
    `<button class="tab${look === active ? ' active' : ''}" data-look="${look}">` +
    `${label} <b>${escape(lookName(choices[look]))}</b></button>`;
  const cards = lookOptions(active)
    .map((choice) => {
      const badges = (['build', 'combat'] as const)
        .filter((look) => choices[look] === choice)
        .map(
          (look) =>
            `<i class="badge ${look}">${t(look === 'build' ? 'looks.build' : 'looks.combat')}</i>`,
        )
        .join('');
      const chosen = choices[active] === choice ? ' chosen' : '';
      // What random means is not obvious from a die: a new style at every round.
      const hint = choice === RANDOM ? ` title="${escape(t('looks.randomHint'))}"` : '';
      // Random draws from the hearted, so it has no heart of its own.
      const on = choice !== RANDOM && favourites.includes(choice);
      const mark =
        choice === RANDOM
          ? ''
          : `<span class="heart${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" title="${escape(t('looks.favourite'))}">${heart(on)}</span>`;
      return (
        `<button class="card${chosen}" data-choice="${choice}"${hint}>` +
        `<img alt="" data-preview="${choice}" />` +
        `<span class="name">${escape(lookName(choice))}</span>${badges}${mark}</button>`
      );
    })
    .join('');
  return (
    `<div class="panel"><div class="head"><h2>${t('looks.title')}</h2>` +
    `<div class="hearts" title="${escape(t('looks.favouritesHint'))}">` +
    `<button class="hearts-all">${heart(true)} ${t('looks.heartAll')}</button>` +
    `<button class="hearts-none">${heart(false)} ${t('looks.heartNone')}</button></div></div>` +
    `<div class="tabs">${tab('build', t('looks.build'))}${tab('combat', t('looks.combat'))}</div>` +
    `<div class="cards">${cards}</div>` +
    `<button class="done">${t('looks.done')}</button></div>`
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
  let favourites = storedFavourites();
  const favour = (styles: readonly ArtStyle[]): void => {
    click();
    favourites = [...styles];
    saveFavourites(favourites);
    render();
  };
  const click = options.click ?? ((): void => undefined);
  const root = document.createElement('div');
  root.className = 'look-gallery';
  // The hovered card's picture plays (`galleryLive.ts`).
  const live = new LivePreview();
  let hovered: HTMLElement | null = null;
  root.addEventListener('pointerover', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.card');
    if (card === hovered) return;
    hovered = card;
    const image = card?.querySelector<HTMLImageElement>('img[data-preview]');
    const choice = card?.dataset.choice;
    const style = ArtStyleSchema.safeParse(choice);
    if (image === null || image === undefined || !style.success) {
      live.hide();
      return;
    }
    live.show(style.data, image);
  });
  root.addEventListener('pointerleave', () => {
    hovered = null;
    live.hide();
  });
  const render = (): void => {
    live.hide();
    hovered = null;
    root.innerHTML = galleryMarkup(choices, active, favourites);
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
    live.destroy();
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
    // A heart is inside its card, so it is asked first: hearting a style does not choose it.
    const hearted = target.closest<HTMLElement>('.heart');
    const style = ArtStyleSchema.safeParse(hearted?.closest<HTMLElement>('.card')?.dataset.choice);
    if (hearted !== null && style.success) {
      favour(
        favourites.includes(style.data)
          ? favourites.filter((s) => s !== style.data)
          : [...favourites, style.data],
      );
      return;
    }
    if (target.closest('.hearts-all') !== null) {
      favour(ArtStyleSchema.options);
      return;
    }
    if (target.closest('.hearts-none') !== null) {
      favour([]);
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
